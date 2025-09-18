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
const {
  log,
  formatAligned
} = lib;

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
export const setupRepository = async (argv, owner, repo) => {
  let repoToClone = `${owner}/${repo}`;
  let forkedRepo = null;
  let upstreamRemote = null;

  if (argv.fork) {
    await log(`\n${formatAligned('🍴', 'Fork mode:', 'ENABLED')}`);
    await log(`${formatAligned('', 'Checking fork status...', '')}\n`);

    // Get current user
    const userResult = await $`gh api user --jq .login`;
    if (userResult.code !== 0) {
      await log(`${formatAligned('❌', 'Error:', 'Failed to get current user')}`);
      process.exit(1);
    }
    const currentUser = userResult.stdout.toString().trim();

    // Check if fork already exists
    const forkCheckResult = await $`gh repo view ${currentUser}/${repo} --json name 2>/dev/null`;

    if (forkCheckResult.code === 0) {
      // Fork exists
      await log(`${formatAligned('✅', 'Fork exists:', `${currentUser}/${repo}`)}`);
      repoToClone = `${currentUser}/${repo}`;
      forkedRepo = `${currentUser}/${repo}`;
      upstreamRemote = `${owner}/${repo}`;
    } else {
      // Need to create fork
      await log(`${formatAligned('🔄', 'Creating fork...', '')}`);
      const forkResult = await $`gh repo fork ${owner}/${repo} --clone=false`;

      // Check if fork creation failed or if fork already exists
      if (forkResult.code !== 0) {
        await log(`${formatAligned('❌', 'Error:', 'Failed to create fork')}`);
        await log(forkResult.stderr ? forkResult.stderr.toString() : 'Unknown error');
        process.exit(1);
      }

      // Check if the output indicates the fork already exists (from parallel worker)
      const forkOutput = forkResult.stderr ? forkResult.stderr.toString() : '';
      if (forkOutput.includes('already exists')) {
        // Fork was created by another worker - treat as if fork already existed
        await log(`${formatAligned('ℹ️', 'Fork exists:', 'Already created by another worker')}`);
        await log(`${formatAligned('✅', 'Using existing fork:', `${currentUser}/${repo}`)}`);

        // Double-check that the fork actually exists now
        const reCheckResult = await $`gh repo view ${currentUser}/${repo} --json name 2>/dev/null`;
        if (reCheckResult.code !== 0) {
          await log(`${formatAligned('❌', 'Error:', 'Fork reported as existing but not found')}`);
          await log(`${formatAligned('', 'Suggestion:', 'Try running the command again - the fork may need a moment to become available')}`);
          process.exit(1);
        }
      } else {
        await log(`${formatAligned('✅', 'Fork created:', `${currentUser}/${repo}`)}`);

        // Wait a moment for fork to be ready
        await log(`${formatAligned('⏳', 'Waiting:', 'For fork to be ready...')}`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      repoToClone = `${currentUser}/${repo}`;
      forkedRepo = `${currentUser}/${repo}`;
      upstreamRemote = `${owner}/${repo}`;
    }
  }

  return { repoToClone, forkedRepo, upstreamRemote };
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
    await log(``);
    await log(`${formatAligned('❌', 'CLONE FAILED', '')}`, { level: 'error' });
    await log(``);
    await log(`  🔍 What happened:`);
    await log(`     Failed to clone repository ${repoToClone}`);
    await log(``);
    await log(`  📦 Error details:`);
    for (const line of errorOutput.split('\n')) {
      if (line.trim()) await log(`     ${line}`);
    }
    await log(``);
    await log(`  💡 Common causes:`);
    await log(`     • Repository doesn't exist or is private`);
    await log(`     • No GitHub authentication`);
    await log(`     • Network connectivity issues`);
    if (argv.fork) {
      await log(`     • Fork not ready yet (try again in a moment)`);
    }
    await log(``);
    await log(`  🔧 How to fix:`);
    await log(`     1. Check authentication: gh auth status`);
    await log(`     2. Login if needed: gh auth login`);
    await log(`     3. Verify access: gh repo view ${owner}/${repo}`);
    if (argv.fork) {
      await log(`     4. Check fork: gh repo view ${repoToClone}`);
    }
    await log(``);
    process.exit(1);
  }

  await log(`${formatAligned('✅', 'Cloned to:', tempDir)}`);

  // Verify and fix remote configuration
  const remoteCheckResult = await $({ cwd: tempDir })`git remote -v 2>&1`;
  if (!remoteCheckResult.stdout || !remoteCheckResult.stdout.toString().includes('origin')) {
    await log(`   Setting up git remote...`, { verbose: true });
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
                await log(`${formatAligned('', 'Solution:', 'Fork sync is required for proper workflow')}`);
                await log(`${formatAligned('', 'Next steps:', '1. Check GitHub permissions for the fork')}`);
                await log(`${formatAligned('', '', '2. Ensure fork is not protected')}`);
                await log(`${formatAligned('', '', '3. Try again after resolving fork issues')}`);
                process.exit(1);
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

// Cleanup temporary directory
export const cleanupTempDirectory = async (tempDir, argv, limitReached) => {
  // Clean up temporary directory (but not when resuming, when limit reached, or when auto-continue is active)
  if (!argv.resume && !limitReached && !(argv.autoContinueLimit && global.limitResetTime)) {
    try {
      process.stdout.write('\n🧹 Cleaning up...');
      await fs.rm(tempDir, { recursive: true, force: true });
      await log(' ✅');
    } catch (cleanupError) {
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