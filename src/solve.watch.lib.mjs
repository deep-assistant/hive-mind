#!/usr/bin/env node

/**
 * Watch mode module for solve.mjs
 * Monitors for feedback continuously and restarts when changes are detected
 */

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
const { log, cleanErrorMessage, formatAligned } = lib;

// Import feedback detection functions
const feedbackLib = await import('./solve.feedback.lib.mjs');
const { detectAndCountFeedback } = feedbackLib;

/**
 * Check if PR has been merged
 */
const checkPRMerged = async (owner, repo, prNumber) => {
  try {
    const prResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.merged'`;
    if (prResult.code === 0) {
      return prResult.stdout.toString().trim() === 'true';
    }
  } catch (error) {
    // If we can't check, assume not merged
    return false;
  }
  return false;
};

/**
 * Check if there are uncommitted changes in the repository
 */
const checkForUncommittedChanges = async (tempDir, $) => {
  try {
    const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
    if (gitStatusResult.code === 0) {
      const statusOutput = gitStatusResult.stdout.toString().trim();
      return statusOutput.length > 0;
    }
  } catch (error) {
    // If we can't check, assume no uncommitted changes
  }
  return false;
};

/**
 * Monitor for feedback in a loop and trigger restart when detected
 */
export const watchForFeedback = async (params) => {
  const {
    issueUrl,
    owner,
    repo,
    issueNumber,
    prNumber,
    prBranch,
    branchName,
    tempDir,
    argv
  } = params;

  const watchInterval = argv.watchInterval || 60; // seconds
  const intervalMs = watchInterval * 1000;
  const isTemporaryWatch = argv.temporaryWatch || false;

  await log('');
  await log(formatAligned('👁️', 'WATCH MODE ACTIVATED', ''));
  await log(formatAligned('', 'Checking interval:', `${watchInterval} seconds`, 2));
  await log(formatAligned('', 'Monitoring PR:', `#${prNumber}`, 2));
  if (isTemporaryWatch) {
    await log(formatAligned('', 'Mode:', 'Temporary (will exit when changes are committed)', 2));
    await log(formatAligned('', 'Stop conditions:', 'All changes committed OR PR merged', 2));
  } else {
    await log(formatAligned('', 'Stop condition:', 'PR merged by maintainer', 2));
  }
  await log('');
  await log('Press Ctrl+C to stop watching manually');
  await log('');

  let lastCheckTime = new Date();
  let iteration = 0;
  let firstIterationInTemporaryMode = isTemporaryWatch;

  while (true) {
    iteration++;
    const currentTime = new Date();

    // Check if PR is merged
    const isMerged = await checkPRMerged(owner, repo, prNumber);
    if (isMerged) {
      await log('');
      await log(formatAligned('🎉', 'PR MERGED!', 'Stopping watch mode'));
      await log(formatAligned('', 'Pull request:', `#${prNumber} has been merged`, 2));
      await log('');
      break;
    }

    // In temporary watch mode, check if all changes have been committed
    if (isTemporaryWatch && !firstIterationInTemporaryMode) {
      const hasUncommitted = await checkForUncommittedChanges(tempDir, $);
      if (!hasUncommitted) {
        await log('');
        await log(formatAligned('✅', 'CHANGES COMMITTED!', 'Exiting temporary watch mode'));
        await log(formatAligned('', 'All uncommitted changes have been resolved', '', 2));
        await log('');
        break;
      }
    }

    // Check for feedback or handle initial uncommitted changes
    if (firstIterationInTemporaryMode) {
      await log(formatAligned('🔄', 'Initial restart:', 'Handling uncommitted changes...'));
    } else {
      await log(formatAligned('🔍', `Check #${iteration}:`, currentTime.toLocaleTimeString()));
    }

    try {
      // Get PR merge state status
      const prStateResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.mergeStateStatus'`;
      const mergeStateStatus = prStateResult.code === 0 ? prStateResult.stdout.toString().trim() : null;

      // Detect feedback using existing function
      let { feedbackLines } = await detectAndCountFeedback({
        prNumber,
        branchName: prBranch || branchName,
        owner,
        repo,
        issueNumber,
        isContinueMode: true,
        argv: { ...argv, verbose: false }, // Reduce verbosity in watch mode
        mergeStateStatus,
        log,
        formatAligned,
        cleanErrorMessage,
        $
      });

      // Check if there's any feedback or if it's the first iteration in temporary mode
      const hasFeedback = feedbackLines && feedbackLines.length > 0;
      const shouldRestart = hasFeedback || firstIterationInTemporaryMode;

      if (shouldRestart) {
        if (firstIterationInTemporaryMode) {
          await log(formatAligned('📝', 'UNCOMMITTED CHANGES:', '', 2));
          // Get uncommitted changes for display
          try {
            const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
            if (gitStatusResult.code === 0) {
              const statusOutput = gitStatusResult.stdout.toString().trim();
              for (const line of statusOutput.split('\n')) {
                await log(formatAligned('', `• ${line}`, '', 4));
              }
            }
          } catch (e) {
            // Ignore errors
          }
          await log('');
          await log(formatAligned('🔄', 'Initial restart:', 'Running Claude to handle uncommitted changes...'));

          // Add uncommitted changes info to feedbackLines for the first run
          if (!feedbackLines) {
            feedbackLines = [];
          }
          feedbackLines.push('');
          feedbackLines.push('⚠️ UNCOMMITTED CHANGES DETECTED:');
          feedbackLines.push('The following uncommitted changes were found in the repository:');

          try {
            const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
            if (gitStatusResult.code === 0) {
              const statusOutput = gitStatusResult.stdout.toString().trim();
              feedbackLines.push('');
              for (const line of statusOutput.split('\n')) {
                feedbackLines.push(`  ${line}`);
              }
              feedbackLines.push('');
              feedbackLines.push('Please review and handle these changes appropriately.');
              feedbackLines.push('Consider committing important changes or cleaning up unnecessary files.');
            }
          } catch (e) {
            // Ignore errors
          }
        } else {
          await log(formatAligned('📢', 'FEEDBACK DETECTED!', '', 2));
          feedbackLines.forEach(async line => {
            await log(formatAligned('', `• ${line}`, '', 4));
          });
          await log('');
          await log(formatAligned('🔄', 'Restarting:', 'Re-running Claude to handle feedback...'));
        }

        // Import necessary modules for claude execution
        const claudeExecLib = await import('./solve.claude-execution.lib.mjs');
        const { executeClaude } = claudeExecLib;
        const repoLib = await import('./solve.repository.lib.mjs');
        const { getResourceSnapshot } = repoLib;

        // Get claude path
        const claudePath = argv.claudePath || 'claude';

        // Execute Claude directly with the feedback
        const claudeResult = await executeClaude({
          issueUrl,
          issueNumber,
          prNumber,
          prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
          branchName,
          tempDir,
          isContinueMode: true,
          mergeStateStatus,
          forkedRepo: argv.fork,
          feedbackLines,
          owner,
          repo,
          argv,
          log,
          formatAligned,
          getResourceSnapshot,
          claudePath,
          $
        });

        if (!claudeResult.success) {
          await log(formatAligned('⚠️', 'Claude execution failed', 'Will retry in next check', 2));
        } else {
          await log('');
          await log(formatAligned('✅', 'Claude execution completed:', 'Resuming watch mode...'));
        }

        // Update last check time after restart completes
        lastCheckTime = new Date();

        // Clear the first iteration flag after handling initial uncommitted changes
        if (firstIterationInTemporaryMode) {
          firstIterationInTemporaryMode = false;
        }
      } else {
        await log(formatAligned('', 'No feedback detected', 'Continuing to watch...', 2));
      }

    } catch (error) {
      await log(formatAligned('⚠️', 'Check failed:', cleanErrorMessage(error), 2));
      await log(formatAligned('', 'Will retry in:', `${watchInterval} seconds`, 2));
    }

    // Wait for next interval (skip wait on first iteration if handling uncommitted changes)
    if (!firstIterationInTemporaryMode) {
      await log(formatAligned('⏱️', 'Next check in:', `${watchInterval} seconds...`, 2));
      await log(''); // Blank line for readability
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
};

/**
 * Start watch mode after initial execution
 */
export const startWatchMode = async (params) => {
  const { argv } = params;

  if (argv.verbose) {
    await log('');
    await log('📊 startWatchMode called with:', { verbose: true });
    await log(`   argv.watch: ${argv.watch}`, { verbose: true });
    await log(`   params.prNumber: ${params.prNumber || 'null'}`, { verbose: true });
  }

  if (!argv.watch) {
    if (argv.verbose) {
      await log('   Watch mode not enabled - exiting startWatchMode', { verbose: true });
    }
    return; // Watch mode not enabled
  }

  if (!params.prNumber) {
    await log('');
    await log(formatAligned('⚠️', 'Watch mode:', 'Requires a pull request'));
    await log(formatAligned('', 'Note:', 'Watch mode only works with existing PRs', 2));
    if (argv.verbose) {
      await log('   prNumber is missing - cannot start watch mode', { verbose: true });
    }
    return;
  }

  // Start the watch loop
  await watchForFeedback(params);
};