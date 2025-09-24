#!/usr/bin/env node

/**
 * Centralized exit handler to ensure log path is always displayed
 * This module ensures that the absolute log path is shown whenever
 * the process exits, whether due to normal completion, errors, or signals.
 */

// Keep track of whether we've already shown the exit message
let exitMessageShown = false;
let absoluteLogPath = null;
let logFunction = null;

/**
 * Initialize the exit handler with required dependencies
 */
export const initializeExitHandler = (logPath, log) => {
  absoluteLogPath = logPath;
  logFunction = log;
};

/**
 * Display the exit message with log path
 */
const showExitMessage = async (reason = 'Process exiting', code = 0) => {
  if (exitMessageShown || !absoluteLogPath || !logFunction) {
    return;
  }

  exitMessageShown = true;

  // Always show the log path on exit
  await logFunction('');
  if (code === 0) {
    await logFunction(`✅ ${reason}`);
  } else {
    await logFunction(`❌ ${reason}`, { level: 'error' });
  }
  await logFunction(`📁 Full log file: ${absoluteLogPath}`);
};

/**
 * Safe exit function that ensures log path is shown
 */
export const safeExit = async (code = 0, reason = 'Process completed') => {
  await showExitMessage(reason, code);
  process.exit(code);
};

/**
 * Install global exit handlers to ensure log path is always shown
 */
export const installGlobalExitHandlers = () => {
  // Handle normal exit
  process.on('exit', (code) => {
    // Synchronous fallback - can't use async here
    if (!exitMessageShown && absoluteLogPath) {
      console.log('');
      if (code === 0) {
        console.log('✅ Process completed');
      } else {
        console.log(`❌ Process exited with code ${code}`);
      }
      console.log(`📁 Full log file: ${absoluteLogPath}`);
    }
  });

  // Handle SIGINT (CTRL+C)
  process.on('SIGINT', async () => {
    await showExitMessage('Interrupted (CTRL+C)', 130);
    process.exit(130);
  });

  // Handle SIGTERM
  process.on('SIGTERM', async () => {
    await showExitMessage('Terminated', 143);
    process.exit(143);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    if (logFunction) {
      await logFunction(`\n❌ Uncaught Exception: ${error.message}`, { level: 'error' });
    }
    await showExitMessage('Uncaught exception occurred', 1);
    process.exit(1);
  });

  // Handle unhandled rejections
  process.on('unhandledRejection', async (reason) => {
    if (logFunction) {
      await logFunction(`\n❌ Unhandled Rejection: ${reason}`, { level: 'error' });
    }
    await showExitMessage('Unhandled rejection occurred', 1);
    process.exit(1);
  });
};

/**
 * Reset the exit message flag (useful for testing)
 */
export const resetExitHandler = () => {
  exitMessageShown = false;
};