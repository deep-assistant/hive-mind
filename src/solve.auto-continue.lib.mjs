#!/usr/bin/env node

// Auto-continue module for solve command
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

// Import shared library functions
const lib = await import('./lib.mjs');
const {
  log,
  cleanErrorMessage
} = lib;

// Import exit handler
import { safeExit } from './exit-handler.lib.mjs';

// Import GitHub-related functions
const githubLib = await import('./github.lib.mjs');
const {
  checkFileInBranch
} = githubLib;

// Import validation functions for time parsing
const validation = await import('./solve.validation.lib.mjs');

// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

// Import GitHub linking detection library
const githubLinking = await import('./github-linking.lib.mjs');
const { extractLinkedIssueNumber } = githubLinking;

// Import configuration
import { autoContinue } from './config.lib.mjs';

const {
  calculateWaitTime
} = validation;

// Auto-continue function that waits until limit resets
export const autoContinueWhenLimitResets = async (issueUrl, sessionId, argv, shouldAttachLogs) => {
  try {
    const resetTime = global.limitResetTime;
    const waitMs = calculateWaitTime(resetTime);

    await log(`\n⏰ Waiting until ${resetTime} for limit to reset...`);
    await log(`   Wait time: ${Math.round(waitMs / (1000 * 60))} minutes`);
    await log(`   Current time: ${new Date().toLocaleTimeString()}`);

    // Show countdown every 30 minutes for long waits, every minute for short waits
    const countdownInterval = waitMs > 30 * 60 * 1000 ? 30 * 60 * 1000 : 60 * 1000;
    let remainingMs = waitMs;

    const countdownTimer = setInterval(async () => {
      remainingMs -= countdownInterval;
      if (remainingMs > 0) {
        const remainingMinutes = Math.round(remainingMs / (1000 * 60));
        await log(`⏳ ${remainingMinutes} minutes remaining until ${resetTime}`);
      }
    }, countdownInterval);

    // Wait until reset time
    await new Promise(resolve => setTimeout(resolve, waitMs));
    clearInterval(countdownTimer);

    await log('\n✅ Limit reset time reached! Resuming session...');
    await log(`   Current time: ${new Date().toLocaleTimeString()}`);

    // Recursively call the solve script with --resume
    // We need to reconstruct the command with appropriate flags
    const childProcess = await import('child_process');

    // Build the resume command
    const resumeArgs = [
      process.argv[1], // solve.mjs path
      issueUrl,
      '--resume', sessionId,
      '--auto-continue-limit' // Keep auto-continue-limit enabled
    ];

    // Preserve other flags from original invocation
    if (argv.model !== 'sonnet') resumeArgs.push('--model', argv.model);
    if (argv.verbose) resumeArgs.push('--verbose');
    if (argv.fork) resumeArgs.push('--fork');
    if (shouldAttachLogs) resumeArgs.push('--attach-logs');

    await log(`\n🔄 Executing: ${resumeArgs.join(' ')}`);

    // Execute the resume command
    const child = childProcess.spawn('node', resumeArgs, {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    child.on('close', (code) => {
      process.exit(code);
    });

  } catch (error) {
    reportError(error, {
      context: 'auto_continue_with_command',
      issueUrl,
      sessionId,
      operation: 'auto_continue_execution'
    });
    await log(`\n❌ Auto-continue failed: ${cleanErrorMessage(error)}`, { level: 'error' });
    await log('\n🔄 Manual resume command:');
    await log(`./solve.mjs "${issueUrl}" --resume ${sessionId}`);
    await safeExit(1, 'Auto-continue failed');
  }
};

// Auto-continue logic: check for existing PRs if --auto-continue is enabled
export const checkExistingPRsForAutoContinue = async (argv, isIssueUrl, owner, repo, urlNumber) => {
  let isContinueMode = false;
  let prNumber = null;
  let prBranch = null;
  let issueNumber = null;

  if (argv.autoContinue && isIssueUrl) {
    issueNumber = urlNumber;
    await log(`🔍 Auto-continue enabled: Checking for existing PRs for issue #${issueNumber}...`);

    try {
      // Get all PRs linked to this issue
      const prListResult = await $`gh pr list --repo ${owner}/${repo} --search "linked:issue-${issueNumber}" --json number,createdAt,headRefName,isDraft,state --limit 10`;

      if (prListResult.code === 0) {
        const prs = JSON.parse(prListResult.stdout.toString().trim() || '[]');

        if (prs.length > 0) {
          await log(`📋 Found ${prs.length} existing PR(s) linked to issue #${issueNumber}`);

          // Find PRs that are older than 24 hours
          const now = new Date();
          const twentyFourHoursAgo = new Date(now.getTime() - autoContinue.ageThresholdHours * 60 * 60 * 1000);

          for (const pr of prs) {
            const createdAt = new Date(pr.createdAt);
            const ageHours = Math.floor((now - createdAt) / (1000 * 60 * 60));

            await log(`  PR #${pr.number}: created ${ageHours}h ago (${pr.state}, ${pr.isDraft ? 'draft' : 'ready'})`);

            // Check if PR is open (not closed)
            if (pr.state === 'OPEN') {
              // CRITICAL: Validate that branch name matches the expected pattern for this issue
              // Branch naming convention: issue-{issueNumber}-{randomHash}
              const expectedBranchPrefix = `issue-${issueNumber}-`;
              if (!pr.headRefName.startsWith(expectedBranchPrefix)) {
                await log(`  PR #${pr.number}: Branch '${pr.headRefName}' doesn't match expected pattern '${expectedBranchPrefix}*' - skipping`);
                continue;
              }

              // Check if CLAUDE.md exists in this PR branch
              const claudeMdExists = await checkFileInBranch(owner, repo, 'CLAUDE.md', pr.headRefName);

              if (!claudeMdExists) {
                await log(`✅ Auto-continue: Using PR #${pr.number} (CLAUDE.md missing - work completed, branch: ${pr.headRefName})`);

                // Switch to continue mode immediately (don't wait 24 hours if CLAUDE.md is missing)
                isContinueMode = true;
                prNumber = pr.number;
                prBranch = pr.headRefName;
                if (argv.verbose) {
                  await log('   Continue mode activated: Auto-continue (CLAUDE.md missing)', { verbose: true });
                  await log(`   PR Number: ${prNumber}`, { verbose: true });
                  await log(`   PR Branch: ${prBranch}`, { verbose: true });
                }
                break;
              } else if (createdAt < twentyFourHoursAgo) {
                await log(`✅ Auto-continue: Using PR #${pr.number} (created ${ageHours}h ago, branch: ${pr.headRefName})`);

                // Switch to continue mode
                isContinueMode = true;
                prNumber = pr.number;
                prBranch = pr.headRefName;
                if (argv.verbose) {
                  await log('   Continue mode activated: Auto-continue (24h+ old PR)', { verbose: true });
                  await log(`   PR Number: ${prNumber}`, { verbose: true });
                  await log(`   PR Branch: ${prBranch}`, { verbose: true });
                  await log(`   PR Age: ${ageHours} hours`, { verbose: true });
                }
                break;
              } else {
                await log(`  PR #${pr.number}: CLAUDE.md exists, age ${ageHours}h < 24h - skipping`);
              }
            }
          }

          if (!isContinueMode) {
            await log('⏭️  No suitable PRs found (missing CLAUDE.md or older than 24h) - creating new PR as usual');
          }
        } else {
          await log(`📝 No existing PRs found for issue #${issueNumber} - creating new PR`);
        }
      }
    } catch (prSearchError) {
      reportError(prSearchError, {
        context: 'check_existing_pr_for_issue',
        owner,
        repo,
        issueNumber,
        operation: 'search_issue_prs'
      });
      await log(`⚠️  Warning: Could not search for existing PRs: ${prSearchError.message}`, { level: 'warning' });
      await log('   Continuing with normal flow...');
    }
  }

  return { isContinueMode, prNumber, prBranch, issueNumber };
};

// Process PR URL mode and extract issue information
export const processPRMode = async (isPrUrl, urlNumber, owner, repo, argv) => {
  let isContinueMode = false;
  let prNumber = null;
  let prBranch = null;
  let issueNumber = null;
  let mergeStateStatus = null;
  let isForkPR = false;

  if (isPrUrl) {
    isContinueMode = true;
    prNumber = urlNumber;

    await log(`🔄 Continue mode: Working with PR #${prNumber}`);
    if (argv.verbose) {
      await log('   Continue mode activated: PR URL provided directly', { verbose: true });
      await log(`   PR Number set to: ${prNumber}`, { verbose: true });
      await log('   Will fetch PR details and linked issue', { verbose: true });
    }

    // Get PR details to find the linked issue and branch
    try {
      const prResult = await githubLib.ghPrView({
        prNumber,
        owner,
        repo,
        jsonFields: 'headRefName,body,number,mergeStateStatus,headRepositoryOwner'
      });

      if (prResult.code !== 0 || !prResult.data) {
        await log('Error: Failed to get PR details', { level: 'error' });

        if (prResult.output.includes('Could not resolve to a PullRequest')) {
          await githubLib.handlePRNotFoundError({ prNumber, owner, repo, argv, shouldAttachLogs: argv.attachLogs || argv['attach-logs'] });
        } else {
          await log(`Error: ${prResult.stderr || 'Unknown error'}`, { level: 'error' });
        }

        await safeExit(1, 'Auto-continue failed');
      }

      const prData = prResult.data;
      prBranch = prData.headRefName;
      mergeStateStatus = prData.mergeStateStatus;

      // Check if this is a fork PR
      isForkPR = prData.headRepositoryOwner && prData.headRepositoryOwner.login !== owner;

      await log(`📝 PR branch: ${prBranch}`);

      // Extract issue number from PR body using GitHub linking detection library
      // This ensures we only detect actual GitHub-recognized linking keywords
      const prBody = prData.body || '';
      const extractedIssueNumber = extractLinkedIssueNumber(prBody);

      if (extractedIssueNumber) {
        issueNumber = extractedIssueNumber;
        await log(`🔗 Found linked issue #${issueNumber}`);
      } else {
        // If no linked issue found, we can still continue but warn
        await log('⚠️  Warning: No linked issue found in PR body', { level: 'warning' });
        await log('   The PR should contain "Fixes #123" or similar to link an issue', { level: 'warning' });
        // Set issueNumber to PR number as fallback
        issueNumber = prNumber;
      }
    } catch (error) {
      reportError(error, {
        context: 'process_pr_in_auto_continue',
        prNumber,
        operation: 'process_pr_for_continuation'
      });
      await log(`Error: Failed to process PR: ${cleanErrorMessage(error)}`, { level: 'error' });
      await safeExit(1, 'Auto-continue failed');
    }
  }

  return { isContinueMode, prNumber, prBranch, issueNumber, mergeStateStatus, isForkPR };
};

// Process auto-continue logic for issue URLs
export const processAutoContinueForIssue = async (argv, isIssueUrl, urlNumber, owner, repo) => {
  if (!argv.autoContinue || !isIssueUrl) {
    return { isContinueMode: false };
  }

  const issueNumber = urlNumber;
  await log(`🔍 Auto-continue enabled: Checking for existing PRs for issue #${issueNumber}...`);

  // Check for existing branches in the repository (main repo or fork)
  let existingBranches = [];

  if (argv.fork) {
    // When in fork mode, check for existing branches in the fork
    try {
      // Get current user to determine fork name
      const userResult = await $`gh api user --jq .login`;
      if (userResult.code === 0) {
        const currentUser = userResult.stdout.toString().trim();
        const forkRepo = `${currentUser}/${repo}`;

        // Check if fork exists
        const forkCheckResult = await $`gh repo view ${forkRepo} --json name 2>/dev/null`;
        if (forkCheckResult.code === 0) {
          await log(`🔍 Fork mode: Checking for existing branches in ${forkRepo}...`);

          // List all branches in the fork that match the pattern issue-{issueNumber}-*
          const branchPattern = `issue-${issueNumber}-`;
          const branchListResult = await $`gh api --paginate repos/${forkRepo}/branches --jq '.[].name'`;

          if (branchListResult.code === 0) {
            const allBranches = branchListResult.stdout.toString().trim().split('\n').filter(b => b);
            existingBranches = allBranches.filter(branch => branch.startsWith(branchPattern));

            if (existingBranches.length > 0) {
              await log(`📋 Found ${existingBranches.length} existing branch(es) in fork matching pattern '${branchPattern}*':`);
              for (const branch of existingBranches) {
                await log(`  • ${branch}`);
              }
            }
          }
        }
      }
    } catch (forkBranchError) {
      reportError(forkBranchError, {
        context: 'check_fork_branches',
        owner,
        repo,
        issueNumber,
        operation: 'search_fork_branches'
      });
      await log(`⚠️  Warning: Could not check for existing branches in fork: ${forkBranchError.message}`, { level: 'warning' });
    }
  } else {
    // NOT in fork mode - check for existing branches in the main repository
    try {
      await log(`🔍 Checking for existing branches in ${owner}/${repo}...`);

      // List all branches in the main repo that match the pattern issue-{issueNumber}-*
      const branchPattern = `issue-${issueNumber}-`;
      const branchListResult = await $`gh api --paginate repos/${owner}/${repo}/branches --jq '.[].name'`;

      if (branchListResult.code === 0) {
        const allBranches = branchListResult.stdout.toString().trim().split('\n').filter(b => b);
        existingBranches = allBranches.filter(branch => branch.startsWith(branchPattern));

        if (existingBranches.length > 0) {
          await log(`📋 Found ${existingBranches.length} existing branch(es) in main repo matching pattern '${branchPattern}*':`);
          for (const branch of existingBranches) {
            await log(`  • ${branch}`);
          }
        }
      }
    } catch (mainBranchError) {
      reportError(mainBranchError, {
        context: 'check_main_repo_branches',
        owner,
        repo,
        issueNumber,
        operation: 'search_main_repo_branches'
      });
      await log(`⚠️  Warning: Could not check for existing branches in main repo: ${mainBranchError.message}`, { level: 'warning' });
    }
  }

  try {
    // Get all PRs linked to this issue
    const prListResult = await $`gh pr list --repo ${owner}/${repo} --search "linked:issue-${issueNumber}" --json number,createdAt,headRefName,isDraft,state --limit 10`;

    if (prListResult.code === 0) {
      const prs = JSON.parse(prListResult.stdout.toString().trim() || '[]');

      if (prs.length > 0) {
        await log(`📋 Found ${prs.length} existing PR(s) linked to issue #${issueNumber}`);

        // Find PRs that are older than 24 hours
        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - autoContinue.ageThresholdHours * 60 * 60 * 1000);

        for (const pr of prs) {
          const createdAt = new Date(pr.createdAt);
          const ageHours = Math.floor((now - createdAt) / (1000 * 60 * 60));

          await log(`  PR #${pr.number}: created ${ageHours}h ago (${pr.state}, ${pr.isDraft ? 'draft' : 'ready'})`);

          // Check if PR is open (not closed)
          if (pr.state === 'OPEN') {
            // CRITICAL: Validate that branch name matches the expected pattern for this issue
            // Branch naming convention: issue-{issueNumber}-{randomHash}
            const expectedBranchPrefix = `issue-${issueNumber}-`;
            if (!pr.headRefName.startsWith(expectedBranchPrefix)) {
              await log(`  PR #${pr.number}: Branch '${pr.headRefName}' doesn't match expected pattern '${expectedBranchPrefix}*' - skipping`);
              continue;
            }

            // Check if CLAUDE.md exists in this PR branch
            const claudeMdExists = await checkFileInBranch(owner, repo, 'CLAUDE.md', pr.headRefName);

            if (!claudeMdExists) {
              await log(`✅ Auto-continue: Using PR #${pr.number} (CLAUDE.md missing - work completed, branch: ${pr.headRefName})`);

              // Switch to continue mode immediately (don't wait 24 hours if CLAUDE.md is missing)
              if (argv.verbose) {
                await log('   Continue mode activated: Auto-continue (CLAUDE.md missing)', { verbose: true });
                await log(`   PR Number: ${pr.number}`, { verbose: true });
                await log(`   PR Branch: ${pr.headRefName}`, { verbose: true });
              }

              return {
                isContinueMode: true,
                prNumber: pr.number,
                prBranch: pr.headRefName,
                issueNumber
              };
            } else if (createdAt < twentyFourHoursAgo) {
              await log(`✅ Auto-continue: Using PR #${pr.number} (created ${ageHours}h ago, branch: ${pr.headRefName})`);

              if (argv.verbose) {
                await log('   Continue mode activated: Auto-continue (24h+ old PR)', { verbose: true });
                await log(`   PR Number: ${pr.number}`, { verbose: true });
                await log(`   PR Branch: ${pr.headRefName}`, { verbose: true });
                await log(`   PR Age: ${ageHours} hours`, { verbose: true });
              }

              return {
                isContinueMode: true,
                prNumber: pr.number,
                prBranch: pr.headRefName,
                issueNumber
              };
            } else {
              await log(`  PR #${pr.number}: CLAUDE.md exists, age ${ageHours}h < 24h - skipping`);
            }
          }
        }

        await log('⏭️  No suitable PRs found (missing CLAUDE.md or older than 24h) - creating new PR as usual');
      } else {
        await log(`📝 No existing PRs found for issue #${issueNumber} - creating new PR`);
      }
    }
  } catch (prSearchError) {
    reportError(prSearchError, {
      context: 'check_existing_pr_with_claude',
      owner,
      repo,
      issueNumber,
      operation: 'search_pr_with_claude_md'
    });
    await log(`⚠️  Warning: Could not search for existing PRs: ${prSearchError.message}`, { level: 'warning' });
    await log('   Continuing with normal flow...');
  }

  // If no suitable PR was found but we have existing branches, use the first one
  if (existingBranches.length > 0) {
    // Sort branches by name (newest hash suffix last) and use the most recent one
    const sortedBranches = existingBranches.sort();
    const selectedBranch = sortedBranches[sortedBranches.length - 1];

    const repoType = argv.fork ? 'fork' : 'main repo';
    await log(`✅ Using existing branch from ${repoType}: ${selectedBranch}`);
    await log(`   Found ${existingBranches.length} matching branch(es), selected most recent`);

    // Check if there's a PR for this branch (including merged/closed PRs)
    try {
      const prForBranchResult = await $`gh pr list --repo ${owner}/${repo} --head ${selectedBranch} --state all --json number,state --limit 10`;
      if (prForBranchResult.code === 0) {
        const prsForBranch = JSON.parse(prForBranchResult.stdout.toString().trim() || '[]');
        if (prsForBranch.length > 0) {
          // Check if any PR is MERGED or CLOSED
          const mergedOrClosedPr = prsForBranch.find(pr => pr.state === 'MERGED' || pr.state === 'CLOSED');
          if (mergedOrClosedPr) {
            await log(`   Branch ${selectedBranch} has a ${mergedOrClosedPr.state} PR #${mergedOrClosedPr.number} - cannot reuse`);
            await log(`   Will create a new branch for issue #${issueNumber}`);
            return { isContinueMode: false, issueNumber };
          }

          // All PRs are OPEN - find the first open PR
          const openPr = prsForBranch.find(pr => pr.state === 'OPEN');
          if (openPr) {
            await log(`   Existing open PR found: #${openPr.number}`);
            return {
              isContinueMode: true,
              prNumber: openPr.number,
              prBranch: selectedBranch,
              issueNumber
            };
          }
        }
      }
    } catch (prCheckError) {
      reportError(prCheckError, {
        context: 'check_pr_for_existing_branch',
        owner,
        repo,
        selectedBranch,
        operation: 'search_pr_for_branch'
      });
      // If we can't check for PR, still continue with the branch
      await log(`⚠️  Warning: Could not check for existing PR for branch: ${prCheckError.message}`, { level: 'warning' });
    }

    // No PR exists yet for this branch, but we can still use the branch
    await log('   No existing PR for this branch - will create PR from existing branch');

    return {
      isContinueMode: true,
      prNumber: null, // No PR yet
      prBranch: selectedBranch,
      issueNumber
    };
  }

  return { isContinueMode: false, issueNumber };
};