/**
 * Error handling utilities for solve.mjs
 */

/**
 * Handles log attachment and PR closing on failure
 */
export const handleFailure = async (options) => {
  const {
    error,
    errorType,
    shouldAttachLogs,
    argv,
    global,
    owner,
    repo,
    log,
    getLogFile,
    attachLogToGitHub,
    cleanErrorMessage,
    sanitizeLogContent,
    $
  } = options;

  // If --attach-logs is enabled, try to attach failure logs
  if (shouldAttachLogs && getLogFile() && global.createdPR && global.createdPR.number) {
    await log('\n📄 Attempting to attach failure logs...');
    try {
      const logUploadSuccess = await attachLogToGitHub({
        logFile: getLogFile(),
        targetType: 'pr',
        targetNumber: global.createdPR.number,
        owner: global.owner || owner,
        repo: global.repo || repo,
        $,
        log,
        sanitizeLogContent,
        verbose: argv.verbose,
        errorMessage: cleanErrorMessage(error)
      });
      if (logUploadSuccess) {
        await log('📎 Failure log attached to Pull Request');
      }
    } catch (attachError) {
      await log(`⚠️  Could not attach failure log: ${attachError.message}`, { level: 'warning' });
    }
  }

  // If --auto-close-pull-request-on-fail is enabled, close the PR
  if (argv.autoClosePullRequestOnFail && global.createdPR && global.createdPR.number) {
    await log('\n🔒 Auto-closing pull request due to failure...');
    try {
      const closeMessage = errorType === 'uncaughtException'
        ? "Auto-closed due to uncaught exception. Logs have been attached for debugging."
        : errorType === 'unhandledRejection'
        ? "Auto-closed due to unhandled rejection. Logs have been attached for debugging."
        : "Auto-closed due to execution failure. Logs have been attached for debugging.";

      const result = await $`gh pr close ${global.createdPR.number} --repo ${global.owner || owner}/${global.repo || repo} --comment ${closeMessage}`;
      if (result.exitCode === 0) {
        await log('✅ Pull request closed successfully');
      }
    } catch (closeError) {
      await log(`⚠️  Could not close pull request: ${closeError.message}`, { level: 'warning' });
    }
  }
};

/**
 * Creates an uncaught exception handler
 */
export const createUncaughtExceptionHandler = (options) => {
  const {
    log,
    cleanErrorMessage,
    absoluteLogPath,
    shouldAttachLogs,
    argv,
    global,
    owner,
    repo,
    getLogFile,
    attachLogToGitHub,
    sanitizeLogContent,
    $
  } = options;

  return async (error) => {
    await log(`\n❌ Uncaught Exception: ${cleanErrorMessage(error)}`, { level: 'error' });
    await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });

    await handleFailure({
      error,
      errorType: 'uncaughtException',
      shouldAttachLogs,
      argv,
      global,
      owner,
      repo,
      log,
      getLogFile,
      attachLogToGitHub,
      cleanErrorMessage,
      sanitizeLogContent,
      $
    });

    process.exit(1);
  };
};

/**
 * Creates an unhandled rejection handler
 */
export const createUnhandledRejectionHandler = (options) => {
  const {
    log,
    cleanErrorMessage,
    absoluteLogPath,
    shouldAttachLogs,
    argv,
    global,
    owner,
    repo,
    getLogFile,
    attachLogToGitHub,
    sanitizeLogContent,
    $
  } = options;

  return async (reason, promise) => {
    await log(`\n❌ Unhandled Rejection: ${cleanErrorMessage(reason)}`, { level: 'error' });
    await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });

    await handleFailure({
      error: reason,
      errorType: 'unhandledRejection',
      shouldAttachLogs,
      argv,
      global,
      owner,
      repo,
      log,
      getLogFile,
      attachLogToGitHub,
      cleanErrorMessage,
      sanitizeLogContent,
      $
    });

    process.exit(1);
  };
};

/**
 * Handles execution errors in the main catch block
 */
export const handleMainExecutionError = async (options) => {
  const {
    error,
    log,
    cleanErrorMessage,
    absoluteLogPath,
    shouldAttachLogs,
    argv,
    global,
    owner,
    repo,
    getLogFile,
    attachLogToGitHub,
    sanitizeLogContent,
    $
  } = options;

  await log('Error executing command:', cleanErrorMessage(error));
  await log(`Stack trace: ${error.stack}`, { verbose: true });
  await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });

  await handleFailure({
    error,
    errorType: 'execution',
    shouldAttachLogs,
    argv,
    global,
    owner,
    repo,
    log,
    getLogFile,
    attachLogToGitHub,
    cleanErrorMessage,
    sanitizeLogContent,
    $
  });

  process.exit(1);
};