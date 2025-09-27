#!/usr/bin/env node

// Repository management module for solve command
// Extracted from solve.mjs to keep files under 1500 lines

// Use use-m to dynamically import modules for cross-runtime compatibility
// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const os = (await use('os')).default;
const path = (await use('path')).default;
const fs = (await use('fs')).promises;

// Import shared library functions
const lib = await import('./lib.mjs');
// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

const {
  log,
  formatAligned
} = lib;

// Import exit handler
import { safeExit } from './exit-handler.lib.mjs';

// Create or find temporary directory for cloning the repository
export const setupTempDirectory = async (argv) => {
  let tempDir;
  let isResuming = argv.resume;

  if (isResuming) {
    // When resuming, try to find existing directory or create a new one
    const scriptDir = path.dirname(process.argv[1]);
    const sessionLogPattern = path.join(scriptDir, `${argv.resume}.log`);

    try {
      // Check if session log exists to verify session is valid
      await fs.access(sessionLogPattern);
      await log(`🔄 Resuming session ${argv.resume} (session log found)`);

      // For resumed sessions, create new temp directory since old one may be cleaned up
      tempDir = path.join(os.tmpdir(), `gh-issue-solver-resume-${argv.resume}-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });
      await log(`Creating new temporary directory for resumed session: ${tempDir}`);
    } catch (err) {
      reportError(err, {
        context: 'resume_session_lookup',
        sessionId: argv.resume,
        operation: 'find_session_log'
      });
      await log(`Warning: Session log for ${argv.resume} not found, but continuing with resume attempt`);
      tempDir = path.join(os.tmpdir(), `gh-issue-solver-resume-${argv.resume}-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });
      await log(`Creating temporary directory for resumed session: ${tempDir}`);
    }
  } else {
    tempDir = path.join(os.tmpdir(), `gh-issue-solver-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    await log(`\nCreating temporary directory: ${tempDir}`);
  }

  return { tempDir, isResuming };
};

// Handle fork creation and repository setup
export const setupRepository = async (argv, owner, repo, forkOwner = null) => {
  let repoToClone = `${owner}/${repo}`;
  let forkedRepo = null;
  let upstreamRemote = null;

  // Priority 1: Check --fork flag first (user explicitly wants to use their own fork)
  // This takes precedence over forkOwner to avoid trying to access someone else's fork
  if (argv.fork) {
    await log(`\n${formatAligned('🍴', 'Fork mode:', 'ENABLED')}`);
    await log(`${formatAligned('', 'Checking fork status...', '')}\n`);

    // Get current user
    const userResult = await $`gh api user --jq .login`;
    if (userResult.code !== 0) {
      await log(`${formatAligned('❌', 'Error:', 'Failed to get current user')}`);
      await safeExit(1, 'Repository setup failed');
    }
    const currentUser = userResult.stdout.toString().trim();

    // Check if fork already exists
    // GitHub may create forks with different names to avoid conflicts
    // Try standard name first: currentUser/repo
    let existingForkName = null;
    const standardForkName = `${currentUser}/${repo}`;
    const alternateForkName = `${currentUser}/${owner}-${repo}`;

    let forkCheckResult = await $`gh repo view ${standardForkName} --json name 2>/dev/null`;
    if (forkCheckResult.code === 0) {
      existingForkName = standardForkName;
    } else {
      // Try alternate name: currentUser/owner-repo
      forkCheckResult = await $`gh repo view ${alternateForkName} --json name 2>/dev/null`;
      if (forkCheckResult.code === 0) {
        existingForkName = alternateForkName;
      }
    }

    if (existingForkName) {
      // Fork exists
      await log(`${formatAligned('✅', 'Fork exists:', existingForkName)}`);
      repoToClone = existingForkName;
      forkedRepo = existingForkName;
      upstreamRemote = `${owner}/${repo}`;
    } else {
      // Need to create fork with retry logic for concurrent scenarios
      await log(`${formatAligned('🔄', 'Creating fork...', '')}`);

      const maxForkRetries = 5;
      const baseDelay = 2000; // Start with 2 seconds
      let forkCreated = false;
      let forkExists = false;
      let actualForkName = `${currentUser}/${repo}`; // Default expected fork name

      for (let attempt = 1; attempt <= maxForkRetries; attempt++) {
        // Try to create fork
        const forkResult = await $`gh repo fork ${owner}/${repo} --clone=false 2>&1`;

        // Always capture output to parse actual fork name
        const forkOutput = (forkResult.stderr ? forkResult.stderr.toString() : '') +
                          (forkResult.stdout ? forkResult.stdout.toString() : '');

        // Parse actual fork name from output (e.g., "konard/netkeep80-jsonRVM already exists")
        // GitHub may create forks with modified names to avoid conflicts
        // Use regex that won't match domain names like "github.com/user" -> "com/user"
        const forkNameMatch = forkOutput.match(/(?:github\.com\/|^|\s)([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/);
        if (forkNameMatch) {
          actualForkName = forkNameMatch[1];
        }

        if (forkResult.code === 0) {
          // Fork successfully created or already exists
          if (forkOutput.includes('already exists')) {
            await log(`${formatAligned('ℹ️', 'Fork exists:', actualForkName)}`);
            forkExists = true;
          } else {
            await log(`${formatAligned('✅', 'Fork created:', actualForkName)}`);
            forkCreated = true;
            forkExists = true;
          }
          break;
        } else {
          // Fork creation failed - check if it's because fork already exists
          if (forkOutput.includes('already exists') ||
              forkOutput.includes('Name already exists') ||
              forkOutput.includes('fork of') ||
              forkOutput.includes('HTTP 422')) {
            // Fork already exists (likely created by another concurrent worker)
            await log(`${formatAligned('ℹ️', 'Fork exists:', actualForkName)}`);
            forkExists = true;
            break;
          }

          // Check if fork was created by another worker even if error message doesn't explicitly say so
          await log(`${formatAligned('🔍', 'Checking:', 'If fork exists after failed creation attempt...')}`);
          const checkResult = await $`gh repo view ${actualForkName} --json name 2>/dev/null`;

          if (checkResult.code === 0) {
            // Fork exists now (created by another worker during our attempt)
            await log(`${formatAligned('✅', 'Fork found:', 'Created by another concurrent worker')}`);
            forkExists = true;
            break;
          }

          // Fork still doesn't exist and creation failed
          if (attempt < maxForkRetries) {
            const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
            await log(`${formatAligned('⏳', 'Retry:', `Attempt ${attempt}/${maxForkRetries} failed, waiting ${delay/1000}s before retry...`)}`);
            await log(`   Error: ${forkOutput.split('\n')[0]}`); // Show first line of error
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            // All retries exhausted
            await log(`${formatAligned('❌', 'Error:', 'Failed to create fork after all retries')}`);
            await log(forkOutput);
            await safeExit(1, 'Repository setup failed');
          }
        }
      }

      // If fork exists (either created or already existed), verify it's accessible
      if (forkExists) {
        await log(`${formatAligned('🔍', 'Verifying fork:', 'Checking accessibility...')}`);

        // Verify fork with retries (GitHub may need time to propagate)
        const maxVerifyRetries = 5;
        let forkVerified = false;

        for (let attempt = 1; attempt <= maxVerifyRetries; attempt++) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          if (attempt > 1) {
            await log(`${formatAligned('⏳', 'Verifying fork:', `Attempt ${attempt}/${maxVerifyRetries} (waiting ${delay/1000}s)...`)}`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }

          const verifyResult = await $`gh repo view ${actualForkName} --json name 2>/dev/null`;
          if (verifyResult.code === 0) {
            forkVerified = true;
            await log(`${formatAligned('✅', 'Fork verified:', `${actualForkName} is accessible`)}`);
            break;
          }
        }

        if (!forkVerified) {
          await log(`${formatAligned('❌', 'Error:', 'Fork exists but not accessible after multiple retries')}`);
          await log(`${formatAligned('', 'Suggestion:', 'GitHub may be experiencing delays - try running the command again in a few minutes')}`);
          await safeExit(1, 'Repository setup failed');
        }

        // Wait a moment for fork to be fully ready
        if (forkCreated) {
          await log(`${formatAligned('⏳', 'Waiting:', 'For fork to be fully ready...')}`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      repoToClone = actualForkName;
      forkedRepo = actualForkName;
      upstreamRemote = `${owner}/${repo}`;
    }
  } else if (forkOwner) {
    // Priority 2: If forkOwner is provided (from auto-continue/PR mode) and --fork was not used,
    // try to use that fork directly (only works if it's accessible)
    await log(`\n${formatAligned('🍴', 'Fork mode:', 'DETECTED from PR')}`);
    await log(`${formatAligned('', 'Fork owner:', forkOwner)}`);
    await log(`${formatAligned('✅', 'Using fork:', `${forkOwner}/${repo}`)}\n`);

    // Verify the fork exists and is accessible
    await log(`${formatAligned('🔍', 'Verifying fork:', 'Checking accessibility...')}`);
    const forkCheckResult = await $`gh repo view ${forkOwner}/${repo} --json name 2>/dev/null`;

    if (forkCheckResult.code === 0) {
      await log(`${formatAligned('✅', 'Fork verified:', `${forkOwner}/${repo} is accessible`)}`);
      repoToClone = `${forkOwner}/${repo}`;
      forkedRepo = `${forkOwner}/${repo}`;
      upstreamRemote = `${owner}/${repo}`;
    } else {
      await log(`${formatAligned('❌', 'Error:', 'Fork not accessible')}`);
      await log(`${formatAligned('', 'Fork:', `${forkOwner}/${repo}`)}`);
      await log(`${formatAligned('', 'Suggestion:', 'The PR may be from a fork you no longer have access to')}`);
      await log(`${formatAligned('', 'Hint:', 'Try running with --fork flag to use your own fork instead')}`);
      await safeExit(1, 'Repository setup failed');
    }
  }

  return { repoToClone, forkedRepo, upstreamRemote, prForkOwner: forkOwner };
};

// Clone repository and set up remotes
export const cloneRepository = async (repoToClone, tempDir, argv, owner, repo) => {
  // Clone the repository (or fork) using gh tool with authentication
  await log(`\n${formatAligned('📥', 'Cloning repository:', repoToClone)}`);

  // Use 2>&1 to capture all output and filter "Cloning into" message
  const cloneResult = await $`gh repo clone ${repoToClone} ${tempDir} 2>&1`;

  // Verify clone was successful
  if (cloneResult.code !== 0) {
    const errorOutput = (cloneResult.stderr || cloneResult.stdout || 'Unknown error').toString().trim();
    await log('');
    await log(`${formatAligned('❌', 'CLONE FAILED', '')}`, { level: 'error' });
    await log('');
    await log('  🔍 What happened:');
    await log(`     Failed to clone repository ${repoToClone}`);
    await log('');
    await log('  📦 Error details:');
    for (const line of errorOutput.split('\n')) {
      if (line.trim()) await log(`     ${line}`);
    }
    await log('');
    await log('  💡 Common causes:');
    await log('     • Repository doesn\'t exist or is private');
    await log('     • No GitHub authentication');
    await log('     • Network connectivity issues');
    if (argv.fork) {
      await log('     • Fork not ready yet (try again in a moment)');
    }
    await log('');
    await log('  🔧 How to fix:');
    await log('     1. Check authentication: gh auth status');
    await log('     2. Login if needed: gh auth login');
    await log(`     3. Verify access: gh repo view ${owner}/${repo}`);
    if (argv.fork) {
      await log(`     4. Check fork: gh repo view ${repoToClone}`);
    }
    await log('');
    await safeExit(1, 'Repository setup failed');
  }

  await log(`${formatAligned('✅', 'Cloned to:', tempDir)}`);

  // Verify and fix remote configuration
  const remoteCheckResult = await $({ cwd: tempDir })`git remote -v 2>&1`;
  if (!remoteCheckResult.stdout || !remoteCheckResult.stdout.toString().includes('origin')) {
    await log('   Setting up git remote...', { verbose: true });
    // Add origin remote manually
    await $({ cwd: tempDir })`git remote add origin https://github.com/${repoToClone}.git 2>&1`;
  }
};

// Set up upstream remote and sync fork
export const setupUpstreamAndSync = async (tempDir, forkedRepo, upstreamRemote, owner, repo) => {
  if (!forkedRepo || !upstreamRemote) return;

  await log(`${formatAligned('🔗', 'Setting upstream:', upstreamRemote)}`);

  // Check if upstream remote already exists
  const checkUpstreamResult = await $({ cwd: tempDir })`git remote get-url upstream 2>/dev/null`;
  let upstreamExists = checkUpstreamResult.code === 0;

  if (upstreamExists) {
    await log(`${formatAligned('ℹ️', 'Upstream exists:', 'Using existing upstream remote')}`);
  } else {
    // Add upstream remote since it doesn't exist
    const upstreamResult = await $({ cwd: tempDir })`git remote add upstream https://github.com/${upstreamRemote}.git`;

    if (upstreamResult.code === 0) {
      await log(`${formatAligned('✅', 'Upstream set:', upstreamRemote)}`);
      upstreamExists = true;
    } else {
      await log(`${formatAligned('⚠️', 'Warning:', 'Failed to add upstream remote')}`);
      if (upstreamResult.stderr) {
        await log(`${formatAligned('', 'Error details:', upstreamResult.stderr.toString().trim())}`);
      }
    }
  }

  // Proceed with fork sync if upstream remote is available
  if (upstreamExists) {
    // Fetch upstream
    await log(`${formatAligned('🔄', 'Fetching upstream...', '')}`);
    const fetchResult = await $({ cwd: tempDir })`git fetch upstream`;
    if (fetchResult.code === 0) {
      await log(`${formatAligned('✅', 'Upstream fetched:', 'Successfully')}`);

      // Sync the default branch with upstream to avoid merge conflicts
      await log(`${formatAligned('🔄', 'Syncing default branch...', '')}`);

      // Get current branch so we can return to it after sync
      const currentBranchResult = await $({ cwd: tempDir })`git branch --show-current`;
      if (currentBranchResult.code === 0) {
        const currentBranch = currentBranchResult.stdout.toString().trim();

        // Get the default branch name from the original repository using GitHub API
        const repoInfoResult = await $`gh api repos/${owner}/${repo} --jq .default_branch`;
        if (repoInfoResult.code === 0) {
          const upstreamDefaultBranch = repoInfoResult.stdout.toString().trim();
          await log(`${formatAligned('ℹ️', 'Default branch:', upstreamDefaultBranch)}`);

          // Always sync the default branch, regardless of current branch
          // This ensures fork is up-to-date even if we're working on a different branch

          // Step 1: Switch to default branch if not already on it
          let syncSuccessful = true;
          if (currentBranch !== upstreamDefaultBranch) {
            await log(`${formatAligned('🔄', 'Switching to:', `${upstreamDefaultBranch} branch`)}`);
            const checkoutResult = await $({ cwd: tempDir })`git checkout ${upstreamDefaultBranch}`;
            if (checkoutResult.code !== 0) {
              await log(`${formatAligned('⚠️', 'Warning:', `Failed to checkout ${upstreamDefaultBranch}`)}`);
              syncSuccessful = false; // Cannot proceed with sync
            }
          }

          // Step 2: Sync default branch with upstream (only if checkout was successful)
          if (syncSuccessful) {
            const syncResult = await $({ cwd: tempDir })`git reset --hard upstream/${upstreamDefaultBranch}`;
            if (syncResult.code === 0) {
              await log(`${formatAligned('✅', 'Default branch synced:', `with upstream/${upstreamDefaultBranch}`)}`);

              // Step 3: Push the updated default branch to fork to keep it in sync
              await log(`${formatAligned('🔄', 'Pushing to fork:', `${upstreamDefaultBranch} branch`)}`);
              const pushResult = await $({ cwd: tempDir })`git push origin ${upstreamDefaultBranch}`;
              if (pushResult.code === 0) {
                await log(`${formatAligned('✅', 'Fork updated:', 'Default branch pushed to fork')}`);
              } else {
                // Fork sync failed - exit immediately as per maintainer feedback
                await log(`${formatAligned('❌', 'FATAL ERROR:', 'Failed to push updated default branch to fork')}`);
                if (pushResult.stderr) {
                  const errorMsg = pushResult.stderr.toString().trim();
                  await log(`${formatAligned('', 'Push error:', errorMsg)}`);
                }
                await log(`${formatAligned('', 'Reason:', 'Fork must be updated or process must stop')}`);
                await log(`${formatAligned('', 'Solution draft:', 'Fork sync is required for proper workflow')}`);
                await log(`${formatAligned('', 'Next steps:', '1. Check GitHub permissions for the fork')}`);
                await log(`${formatAligned('', '', '2. Ensure fork is not protected')}`);
                await log(`${formatAligned('', '', '3. Try again after resolving fork issues')}`);
                await safeExit(1, 'Repository setup failed');
              }

              // Step 4: Return to the original branch if it was different
              if (currentBranch !== upstreamDefaultBranch) {
                await log(`${formatAligned('🔄', 'Returning to:', `${currentBranch} branch`)}`);
                const returnResult = await $({ cwd: tempDir })`git checkout ${currentBranch}`;
                if (returnResult.code === 0) {
                  await log(`${formatAligned('✅', 'Branch restored:', `Back on ${currentBranch}`)}`);
                } else {
                  await log(`${formatAligned('⚠️', 'Warning:', `Failed to return to ${currentBranch}`)}`);
                  // This is not fatal, continue with sync on default branch
                }
              }
            } else {
              await log(`${formatAligned('⚠️', 'Warning:', `Failed to sync ${upstreamDefaultBranch} with upstream`)}`);
              if (syncResult.stderr) {
                await log(`${formatAligned('', 'Sync error:', syncResult.stderr.toString().trim())}`);
              }
            }
          }
        } else {
          await log(`${formatAligned('⚠️', 'Warning:', 'Failed to get default branch name')}`);
        }
      } else {
        await log(`${formatAligned('⚠️', 'Warning:', 'Failed to get current branch')}`);
      }
    } else {
      await log(`${formatAligned('⚠️', 'Warning:', 'Failed to fetch upstream')}`);
      if (fetchResult.stderr) {
        await log(`${formatAligned('', 'Fetch error:', fetchResult.stderr.toString().trim())}`);
      }
    }
  }
};

// Set up pr-fork remote for continuing someone else's fork PR with --fork flag
export const setupPrForkRemote = async (tempDir, argv, prForkOwner, repo, isContinueMode) => {
  // Only set up pr-fork remote if:
  // 1. --fork flag is used (user wants to use their own fork)
  // 2. prForkOwner is provided (continuing an existing PR from a fork)
  // 3. In continue mode (auto-continue or continuing existing PR)
  if (!argv.fork || !prForkOwner || !isContinueMode) {
    return null;
  }

  // Get current user to check if it's someone else's fork
  await log(`\n${formatAligned('🔍', 'Checking PR fork:', 'Determining if branch is in another fork...')}`);
  const userResult = await $`gh api user --jq .login`;
  if (userResult.code !== 0) {
    await log(`${formatAligned('⚠️', 'Warning:', 'Failed to get current user, cannot set up pr-fork remote')}`);
    return null;
  }

  const currentUser = userResult.stdout.toString().trim();

  // If PR is from current user's fork, no need for pr-fork remote
  if (prForkOwner === currentUser) {
    await log(`${formatAligned('ℹ️', 'PR fork owner:', 'Same as current user, using origin remote')}`);
    return null;
  }

  // This is someone else's fork - add it as pr-fork remote
  await log(`${formatAligned('🔗', 'Setting up pr-fork:', 'Branch exists in another user\'s fork')}`);
  await log(`${formatAligned('', 'PR fork owner:', prForkOwner)}`);
  await log(`${formatAligned('', 'Current user:', currentUser)}`);
  await log(`${formatAligned('', 'Action:', `Adding ${prForkOwner}/${repo} as pr-fork remote`)}`);

  const addRemoteResult = await $({ cwd: tempDir })`git remote add pr-fork https://github.com/${prForkOwner}/${repo}.git`;
  if (addRemoteResult.code !== 0) {
    await log(`${formatAligned('❌', 'Error:', 'Failed to add pr-fork remote')}`);
    if (addRemoteResult.stderr) {
      await log(`${formatAligned('', 'Details:', addRemoteResult.stderr.toString().trim())}`);
    }
    await log(`${formatAligned('', 'Suggestion:', 'The PR branch may not be accessible')}`);
    await log(`${formatAligned('', 'Workaround:', 'Remove --fork flag to continue work in the original fork')}`);
    return null;
  }

  await log(`${formatAligned('✅', 'Remote added:', 'pr-fork')}`);

  // Fetch from pr-fork to get the branch
  await log(`${formatAligned('📥', 'Fetching branches:', 'From pr-fork remote...')}`);
  const fetchPrForkResult = await $({ cwd: tempDir })`git fetch pr-fork`;
  if (fetchPrForkResult.code !== 0) {
    await log(`${formatAligned('❌', 'Error:', 'Failed to fetch from pr-fork')}`);
    if (fetchPrForkResult.stderr) {
      await log(`${formatAligned('', 'Details:', fetchPrForkResult.stderr.toString().trim())}`);
    }
    await log(`${formatAligned('', 'Suggestion:', 'Check if you have access to the fork')}`);
    return null;
  }

  await log(`${formatAligned('✅', 'Fetched:', 'pr-fork branches')}`);
  await log(`${formatAligned('ℹ️', 'Next step:', 'Will checkout branch from pr-fork remote')}`);
  return 'pr-fork';
};

// Checkout branch for continue mode (PR branch from remote)
export const checkoutPrBranch = async (tempDir, branchName, prForkRemote, prForkOwner) => {
  await log(`\n${formatAligned('🔄', 'Checking out PR branch:', branchName)}`);

  // Determine which remote to use for branch checkout
  const remoteName = prForkRemote || 'origin';

  // First fetch all branches from remote (if not already fetched from pr-fork)
  if (!prForkRemote) {
    await log(`${formatAligned('📥', 'Fetching branches:', 'From remote...')}`);
    const fetchResult = await $({ cwd: tempDir })`git fetch origin`;

    if (fetchResult.code !== 0) {
      await log('Warning: Failed to fetch branches from remote', { level: 'warning' });
    }
  } else {
    await log(`${formatAligned('ℹ️', 'Using pr-fork remote:', `Branch exists in ${prForkOwner}'s fork`)}`);
  }

  // Checkout the PR branch (it might exist locally or remotely)
  const localBranchResult = await $({ cwd: tempDir })`git show-ref --verify --quiet refs/heads/${branchName}`;

  let checkoutResult;
  if (localBranchResult.code === 0) {
    // Branch exists locally
    checkoutResult = await $({ cwd: tempDir })`git checkout ${branchName}`;
  } else {
    // Branch doesn't exist locally, try to checkout from remote
    checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName} ${remoteName}/${branchName}`;
  }

  return checkoutResult;
};

// Cleanup temporary directory
export const cleanupTempDirectory = async (tempDir, argv, limitReached) => {
  // Clean up temporary directory (but not when resuming, when limit reached, or when auto-continue is active)
  if (!argv.resume && !limitReached && !(argv.autoContinueLimit && global.limitResetTime)) {
    try {
      process.stdout.write('\n🧹 Cleaning up...');
      await fs.rm(tempDir, { recursive: true, force: true });
      await log(' ✅');
    } catch (cleanupError) {
      reportError(cleanupError, {
        context: 'cleanup_temp_directory',
        tempDir,
        operation: 'remove_temp_dir'
      });
      await log(' ⚠️  (failed)');
    }
  } else if (argv.resume) {
    await log(`\n📁 Keeping directory for resumed session: ${tempDir}`);
  } else if (limitReached && argv.autoContinueLimit) {
    await log(`\n📁 Keeping directory for auto-continue: ${tempDir}`);
  } else if (limitReached) {
    await log(`\n📁 Keeping directory for future resume: ${tempDir}`);
  }
};