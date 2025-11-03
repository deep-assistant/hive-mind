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
// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

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
    reportError(error, {
      context: 'check_pr_merged',
      owner,
      repo,
      prNumber,
      operation: 'check_merge_status'
    });
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
    reportError(error, {
      context: 'check_pr_closed',
      tempDir,
      operation: 'check_close_status'
    });
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
  const maxAutoRestartIterations = argv.autoRestartMaxIterations || 3;

  await log('');
  if (isTemporaryWatch) {
    await log(formatAligned('🔄', 'AUTO-RESTART MODE ACTIVE', ''));
    await log(formatAligned('', 'Purpose:', 'Complete unfinished work from previous run', 2));
    await log(formatAligned('', 'Monitoring PR:', `#${prNumber}`, 2));
    await log(formatAligned('', 'Mode:', 'Auto-restart (NOT --watch mode)', 2));
    await log(formatAligned('', 'Stop conditions:', 'All changes committed OR PR merged OR max iterations reached', 2));
    await log(formatAligned('', 'Max iterations:', `${maxAutoRestartIterations}`, 2));
    await log(formatAligned('', 'Note:', 'No wait time between iterations in auto-restart mode', 2));
  } else {
    await log(formatAligned('👁️', 'WATCH MODE ACTIVATED', ''));
    await log(formatAligned('', 'Checking interval:', `${watchInterval} seconds`, 2));
    await log(formatAligned('', 'Monitoring PR:', `#${prNumber}`, 2));
    await log(formatAligned('', 'Stop condition:', 'PR merged by maintainer', 2));
  }
  await log('');
  await log('Press Ctrl+C to stop watching manually');
  await log('');

  // let lastCheckTime = new Date(); // Not currently used
  let iteration = 0;
  let autoRestartCount = 0;
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
        await log(formatAligned('✅', 'CHANGES COMMITTED!', 'Exiting auto-restart mode'));
        await log(formatAligned('', 'All uncommitted changes have been resolved', '', 2));
        await log('');
        break;
      }

      // Check if we've reached max iterations
      if (autoRestartCount >= maxAutoRestartIterations) {
        await log('');
        await log(formatAligned('⚠️', 'MAX ITERATIONS REACHED', `Exiting auto-restart mode after ${autoRestartCount} attempts`));
        await log(formatAligned('', 'Some uncommitted changes may remain', '', 2));
        await log(formatAligned('', 'Please review and commit manually if needed', '', 2));
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
        workStartTime: null, // In watch mode, we want to count all comments as potential feedback
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
            reportError(e, {
              context: 'check_claude_file_exists',
              owner,
              repo,
              branchName,
              operation: 'check_file_in_branch'
            });
            // Ignore errors
          }
          await log('');
          await log(formatAligned('🔄', 'Initial restart:', `Running ${argv.tool.toUpperCase()} to handle uncommitted changes...`));

          // Post a comment to PR about auto-restart
          if (prNumber) {
            try {
              autoRestartCount++;
              const remainingIterations = maxAutoRestartIterations - autoRestartCount;
              const commentBody = `## 🔄 Auto-restart ${autoRestartCount}/${maxAutoRestartIterations}\n\nDetected uncommitted changes from previous run. Starting new session to review and commit them.\n\n---\n*Auto-restart will stop after changes are committed or after ${remainingIterations} more iteration${remainingIterations !== 1 ? 's' : ''}. Please wait until working session will end and give your feedback.*`;
              await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
              await log(formatAligned('', '💬 Posted auto-restart notification to PR', '', 2));
            } catch (commentError) {
              reportError(commentError, {
                context: 'post_auto_restart_comment',
                owner,
                repo,
                prNumber,
                operation: 'comment_on_pr'
              });
              // Don't fail if comment posting fails
              await log(formatAligned('', '⚠️  Could not post comment to PR', '', 2));
            }
          }

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
            reportError(e, {
              context: 'recheck_claude_file',
              owner,
              repo,
              branchName,
              operation: 'verify_file_in_branch'
            });
            // Ignore errors
          }
        } else {
          await log(formatAligned('📢', 'FEEDBACK DETECTED!', '', 2));
          feedbackLines.forEach(async line => {
            await log(formatAligned('', `• ${line}`, '', 4));
          });
          await log('');
          await log(formatAligned('🔄', 'Restarting:', `Re-running ${argv.tool.toUpperCase()} to handle feedback...`));
        }

        // Import necessary modules for tool execution
        const memoryCheck = await import('./memory-check.mjs');
        const { getResourceSnapshot } = memoryCheck;

        let toolResult;
        if (argv.tool === 'opencode') {
          // Use OpenCode
          const opencodeExecLib = await import('./opencode.lib.mjs');
          const { executeOpenCode } = opencodeExecLib;

          // Get opencode path
          const opencodePath = argv.opencodePath || 'opencode';

          toolResult = await executeOpenCode({
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
            opencodePath,
            $
          });
        } else if (argv.tool === 'codex') {
          // Use Codex
          const codexExecLib = await import('./codex.lib.mjs');
          const { executeCodex } = codexExecLib;

          // Get codex path
          const codexPath = argv.codexPath || 'codex';

          toolResult = await executeCodex({
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
            forkActionsUrl: null,
            owner,
            repo,
            argv,
            log,
            setLogFile: () => {},
            getLogFile: () => '',
            formatAligned,
            getResourceSnapshot,
            codexPath,
            $
          });
        } else {
          // Use Claude (default)
          const claudeExecLib = await import('./claude.lib.mjs');
          const { executeClaude, calculateSessionTokens } = claudeExecLib;

          // Get claude path
          const claudePath = argv.claudePath || 'claude';

          // Check if we should use session resume for auto-restart (issue #661)
          const shouldUseSessionResume = isTemporaryWatch &&
                                         argv['resume-on-auto-restart'] &&
                                         global.previousSessionId &&
                                         firstIterationInTemporaryMode;

          // Track tokens before auto-restart for comparison
          let tokensBefore = null;
          if (shouldUseSessionResume && argv.verbose) {
            try {
              tokensBefore = await calculateSessionTokens(global.previousSessionId, tempDir);
              await log(formatAligned('', `📊 Previous session tokens: ${tokensBefore.totalTokens.toLocaleString()}`, '', 2));
            } catch {
              // Ignore token tracking errors
              await log(formatAligned('', '⚠️  Could not read previous session tokens', '', 2));
            }
          }

          // If session resume is enabled, use minimal context
          let modifiedFeedbackLines = feedbackLines;
          let modifiedArgv = argv;

          if (shouldUseSessionResume) {
            await log(formatAligned('', '🧪 EXPERIMENTAL: Using session resume with minimal context', '', 2));
            await log(formatAligned('', `   Resuming from session: ${global.previousSessionId}`, '', 2));

            // Import minimal prompt generator
            const minimalPromptLib = await import('./solve.minimal-restart-prompt.lib.mjs');
            const { generateMinimalRestartPrompt } = minimalPromptLib;

            // Generate minimal restart prompt
            const minimalPrompt = await generateMinimalRestartPrompt(tempDir, $);

            // Replace feedbackLines with minimal prompt content
            modifiedFeedbackLines = [minimalPrompt];

            // Add resume flag to argv
            modifiedArgv = {
              ...argv,
              resume: global.previousSessionId,
              minimalRestartContext: true
            };

            await log(formatAligned('', `   Minimal prompt size: ~${minimalPrompt.length} chars`, '', 2));
          }

          toolResult = await executeClaude({
            issueUrl,
            issueNumber,
            prNumber,
            prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
            branchName,
            tempDir,
            isContinueMode: true,
            mergeStateStatus,
            forkedRepo: argv.fork,
            feedbackLines: modifiedFeedbackLines,
            owner,
            repo,
            argv: modifiedArgv,
            log,
            formatAligned,
            getResourceSnapshot,
            claudePath,
            $
          });

          // Track token savings if session resume was used
          if (shouldUseSessionResume && tokensBefore && toolResult.sessionId) {
            try {
              const tokensAfter = await calculateSessionTokens(toolResult.sessionId, tempDir);
              const tokensSaved = tokensBefore.totalTokens - tokensAfter.totalTokens;
              const percentSaved = ((tokensSaved / tokensBefore.totalTokens) * 100).toFixed(1);

              await log('');
              await log(formatAligned('💰', 'TOKEN SAVINGS FROM SESSION RESUME:', ''));
              await log(formatAligned('', `Previous session: ${tokensBefore.totalTokens.toLocaleString()} tokens`, '', 2));
              await log(formatAligned('', `Current session: ${tokensAfter.totalTokens.toLocaleString()} tokens`, '', 2));
              await log(formatAligned('', `Tokens saved: ${tokensSaved.toLocaleString()} (${percentSaved}%)`, '', 2));

              if (tokensBefore.totalCostUSD && tokensAfter.totalCostUSD) {
                const costSaved = tokensBefore.totalCostUSD - tokensAfter.totalCostUSD;
                await log(formatAligned('', `Cost saved: $${costSaved.toFixed(4)}`, '', 2));
              }
              await log('');
            } catch {
              // Ignore token tracking errors
              await log(formatAligned('', '⚠️  Could not calculate token savings', '', 2));
            }
          }

          // Store the new session ID for potential next iteration
          if (toolResult.sessionId && argv['resume-on-auto-restart']) {
            global.previousSessionId = toolResult.sessionId;
          }
        }

        if (!toolResult.success) {
          await log(formatAligned('⚠️', `${argv.tool.toUpperCase()} execution failed`, 'Will retry in next check', 2));
        } else {
          await log('');
          if (isTemporaryWatch) {
            await log(formatAligned('✅', `${argv.tool.toUpperCase()} execution completed:`, 'Checking for remaining changes...'));
          } else {
            await log(formatAligned('✅', `${argv.tool.toUpperCase()} execution completed:`, 'Resuming watch mode...'));
          }
        }

        // Note: lastCheckTime tracking removed as it was not being used

        // Clear the first iteration flag after handling initial uncommitted changes
        if (firstIterationInTemporaryMode) {
          firstIterationInTemporaryMode = false;
        }
      } else {
        await log(formatAligned('', 'No feedback detected', 'Continuing to watch...', 2));
      }

    } catch (error) {
      reportError(error, {
        context: 'watch_pr_general',
        prNumber,
        owner,
        repo,
        operation: 'watch_pull_request'
      });
      await log(formatAligned('⚠️', 'Check failed:', cleanErrorMessage(error), 2));
      if (!isTemporaryWatch) {
        await log(formatAligned('', 'Will retry in:', `${watchInterval} seconds`, 2));
      }
    }

    // Wait for next interval (skip wait entirely in temporary watch mode / auto-restart)
    if (!isTemporaryWatch && !firstIterationInTemporaryMode) {
      await log(formatAligned('⏱️', 'Next check in:', `${watchInterval} seconds...`, 2));
      await log(''); // Blank line for readability
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    } else if (isTemporaryWatch && !firstIterationInTemporaryMode) {
      // In auto-restart mode, check immediately without waiting
      await log(formatAligned('', 'Checking immediately for uncommitted changes...', '', 2));
      await log(''); // Blank line for readability
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