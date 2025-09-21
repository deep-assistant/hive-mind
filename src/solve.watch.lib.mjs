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

  await log('');
  await log(formatAligned('👁️', 'WATCH MODE ACTIVATED', ''));
  await log(formatAligned('', 'Checking interval:', `${watchInterval} seconds`, 2));
  await log(formatAligned('', 'Monitoring PR:', `#${prNumber}`, 2));
  await log(formatAligned('', 'Stop condition:', 'PR merged by maintainer', 2));
  await log('');
  await log('Press Ctrl+C to stop watching manually');
  await log('');

  let lastCheckTime = new Date();
  let iteration = 0;

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

    // Check for feedback
    await log(formatAligned('🔍', `Check #${iteration}:`, currentTime.toLocaleTimeString()));

    try {
      // Get PR merge state status
      const prStateResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.mergeStateStatus'`;
      const mergeStateStatus = prStateResult.code === 0 ? prStateResult.stdout.toString().trim() : null;

      // Detect feedback using existing function
      const { feedbackLines } = await detectAndCountFeedback({
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

      // Check if there's any feedback
      const hasFeedback = feedbackLines && feedbackLines.length > 0;

      if (hasFeedback) {
        await log(formatAligned('📢', 'FEEDBACK DETECTED!', '', 2));
        feedbackLines.forEach(async line => {
          await log(formatAligned('', `• ${line}`, '', 4));
        });
        await log('');
        await log(formatAligned('🔄', 'Restarting:', 'Triggering auto-continue mode...'));

        // Trigger restart by spawning a new solve process
        const childProcess = await import('child_process');

        // Build the restart command
        const restartArgs = [
          process.argv[1], // solve.mjs path
          `https://github.com/${owner}/${repo}/pull/${prNumber}`, // Use PR URL for continue mode
          '--auto-continue'
        ];

        // Preserve important flags
        if (argv.model && argv.model !== 'sonnet') restartArgs.push('--model', argv.model);
        if (argv.verbose) restartArgs.push('--verbose');
        if (argv.fork) restartArgs.push('--fork');
        if (argv.attachLogs) restartArgs.push('--attach-logs');
        if (argv.watch) restartArgs.push('--watch'); // Keep watch mode active
        if (argv.watchInterval !== 60) restartArgs.push('--watch-interval', argv.watchInterval.toString());

        await log(formatAligned('', 'Command:', restartArgs.slice(1).join(' '), 2));
        await log('');

        // Execute the restart command
        const child = childProcess.spawn('node', restartArgs, {
          stdio: 'inherit',
          cwd: process.cwd()
        });

        // Wait for child process to complete
        await new Promise((resolve) => {
          child.on('close', (code) => {
            resolve(code);
          });
        });

        // Update last check time after restart completes
        lastCheckTime = new Date();
        await log('');
        await log(formatAligned('✅', 'Restart completed:', 'Resuming watch mode...'));
      } else {
        await log(formatAligned('', 'No feedback detected', 'Continuing to watch...', 2));
      }

    } catch (error) {
      await log(formatAligned('⚠️', 'Check failed:', cleanErrorMessage(error), 2));
      await log(formatAligned('', 'Will retry in:', `${watchInterval} seconds`, 2));
    }

    // Wait for next interval
    await log(formatAligned('⏱️', 'Next check in:', `${watchInterval} seconds...`, 2));
    await log(''); // Blank line for readability
    await new Promise(resolve => setTimeout(resolve, intervalMs));
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