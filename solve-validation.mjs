#!/usr/bin/env node

// Validation module for solve command
// Extracted from solve.mjs to keep files under 1500 lines

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

const path = (await use('path')).default;
const fs = (await use('fs')).promises;

// Import memory check functions (RAM, swap, disk)
const memoryCheck = await import('./memory-check.mjs');

// Import shared library functions
const lib = await import('./lib.mjs');
const {
  log,
  setLogFile,
  getLogFile
} = lib;

// Import GitHub-related functions
const githubLib = await import('./github.lib.mjs');
const {
  checkGitHubPermissions
} = githubLib;

// Import Claude-related functions
const claudeLib = await import('./claude.lib.mjs');
const {
  validateClaudeConnection
} = claudeLib;

// Wrapper function for disk space check using imported module
const checkDiskSpace = async (minSpaceMB = 500) => {
  const result = await memoryCheck.checkDiskSpace(minSpaceMB, { log });
  return result.success;
};

// Wrapper function for memory check using imported module
const checkMemory = async (minMemoryMB = 256) => {
  const result = await memoryCheck.checkMemory(minMemoryMB, { log });
  return result.success;
};

// Validate GitHub issue or pull request URL format
export const validateGitHubUrl = (issueUrl) => {
  if (!issueUrl) {
    return { isValid: false, isIssueUrl: null, isPrUrl: null };
  }

  // Do the regex matching ONCE - these results will be used everywhere
  const isIssueUrl = issueUrl.match(/^https:\/\/github\.com\/[^\/]+\/[^\/]+\/issues\/\d+$/);
  const isPrUrl = issueUrl.match(/^https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+$/);

  // Fail fast if URL is invalid
  if (!isIssueUrl && !isPrUrl) {
    console.error('Error: Invalid GitHub URL format');
    console.error('  Please provide a valid GitHub issue or pull request URL');
    console.error('  Examples:');
    console.error('    https://github.com/owner/repo/issues/123 (issue)');
    console.error('    https://github.com/owner/repo/pull/456 (pull request)');
    return { isValid: false, isIssueUrl: null, isPrUrl: null };
  }

  return { isValid: true, isIssueUrl, isPrUrl };
};

// Show security warning for attach-logs option
export const showAttachLogsWarning = async (shouldAttachLogs) => {
  if (!shouldAttachLogs) return;

  await log('');
  await log('⚠️  SECURITY WARNING: --attach-logs is ENABLED', { level: 'warning' });
  await log('');
  await log('   This option will upload the complete solution log file to the Pull Request.');
  await log('   The log may contain sensitive information such as:');
  await log('   • API keys, tokens, or secrets');
  await log('   • File paths and directory structures');
  await log('   • Command outputs and error messages');
  await log('   • Internal system information');
  await log('');
  await log('   ⚠️  DO NOT use this option with public repositories or if the log');
  await log('       might contain sensitive data that should not be shared publicly.');
  await log('');
  await log('   Continuing in 5 seconds... (Press Ctrl+C to abort)');
  await log('');

  // Give user time to abort if they realize this might be dangerous
  for (let i = 5; i > 0; i--) {
    process.stdout.write(`\r   Countdown: ${i} seconds remaining...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  process.stdout.write('\r   Proceeding with log attachment enabled.                    \n');
  await log('');
};

// Create and initialize log file
export const initializeLogFile = async () => {
  const scriptDir = path.dirname(process.argv[1]);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(scriptDir, `solve-${timestamp}.log`);
  setLogFile(logFile);

  // Create the log file immediately
  await fs.writeFile(logFile, `# Solve.mjs Log - ${new Date().toISOString()}\n\n`);
  await log(`📁 Log file: ${getLogFile()}`);
  await log(`   (All output will be logged here)`);

  return logFile;
};

// Validate GitHub URL requirement
export const validateUrlRequirement = async (issueUrl) => {
  if (!issueUrl) {
    await log(`❌ GitHub issue URL is required`, { level: 'error' });
    await log(`   Usage: solve <github-issue-url> [options]`, { level: 'error' });
    return false;
  }
  return true;
};

// Validate --continue-only-on-feedback option requirements
export const validateContinueOnlyOnFeedback = async (argv, isPrUrl, isIssueUrl) => {
  if (argv.continueOnlyOnFeedback) {
    if (!isPrUrl && !(isIssueUrl && argv.autoContinue)) {
      await log(`❌ --continue-only-on-feedback option requirements not met`, { level: 'error' });
      await log(`   This option works only with:`, { level: 'error' });
      await log(`   • Pull request URL, OR`, { level: 'error' });
      await log(`   • Issue URL with --auto-continue option`, { level: 'error' });
      await log(`   Current: ${isPrUrl ? 'PR URL' : 'Issue URL'} ${argv.autoContinue ? 'with --auto-continue' : 'without --auto-continue'}`, { level: 'error' });
      return false;
    }
  }
  return true;
};

// Perform all system checks (disk space, memory, Claude connection, GitHub permissions)
export const performSystemChecks = async (minDiskSpace = 500) => {
  // Check disk space before proceeding
  const hasEnoughSpace = await checkDiskSpace(minDiskSpace);
  if (!hasEnoughSpace) {
    return false;
  }

  // Check memory before proceeding (early check to prevent Claude kills)
  const hasEnoughMemory = await checkMemory(256);
  if (!hasEnoughMemory) {
    return false;
  }

  // Validate Claude CLI connection before proceeding
  const isClaudeConnected = await validateClaudeConnection();
  if (!isClaudeConnected) {
    await log(`❌ Cannot proceed without Claude CLI connection`, { level: 'error' });
    return false;
  }

  // Check GitHub permissions
  const hasValidAuth = await checkGitHubPermissions();
  if (!hasValidAuth) {
    return false;
  }

  return true;
};

// Parse URL components
export const parseUrlComponents = (issueUrl) => {
  const urlParts = issueUrl.split('/');
  return {
    owner: urlParts[3],
    repo: urlParts[4],
    urlNumber: urlParts[6] // Could be issue or PR number
  };
};

// Helper function to parse time string and calculate wait time
export const parseResetTime = (timeStr) => {
  // Parse time format like "5:30am" or "11:45pm"
  const match = timeStr.match(/(\d{1,2}):(\d{2})([ap]m)/i);
  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}`);
  }

  const [, hourStr, minuteStr, ampm] = match;
  let hour = parseInt(hourStr);
  const minute = parseInt(minuteStr);

  // Convert to 24-hour format
  if (ampm.toLowerCase() === 'pm' && hour !== 12) {
    hour += 12;
  } else if (ampm.toLowerCase() === 'am' && hour === 12) {
    hour = 0;
  }

  return { hour, minute };
};

// Calculate milliseconds until the next occurrence of the specified time
export const calculateWaitTime = (resetTime) => {
  const { hour, minute } = parseResetTime(resetTime);

  const now = new Date();
  const today = new Date(now);
  today.setHours(hour, minute, 0, 0);

  // If the time has already passed today, schedule for tomorrow
  if (today <= now) {
    today.setDate(today.getDate() + 1);
  }

  return today.getTime() - now.getTime();
};