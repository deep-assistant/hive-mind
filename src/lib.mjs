#!/usr/bin/env node

// Shared library functions for hive-mind project

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const use = globalThis.use;
}

const fs = (await use('fs')).promises;

// Global reference for log file (can be set by importing module)
export let logFile = null;

// Function to set the log file path
export const setLogFile = (path) => {
  logFile = path;
};

// Function to get the current log file path
export const getLogFile = () => {
  return logFile;
};

// Function to get the absolute log file path
export const getAbsoluteLogPath = async () => {
  if (!logFile) return null;
  const path = (await use('path'));
  return path.resolve(logFile);
};

// Helper function to log to both console and file
export const log = async (message, options = {}) => {
  const { level = 'info', verbose = false } = options;
  
  // Skip verbose logs unless --verbose is enabled
  if (verbose && !global.verboseMode) {
    return;
  }
  
  // Write to file if log file is set
  if (logFile) {
    const logMessage = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
    await fs.appendFile(logFile, logMessage + '\n').catch(() => {});
  }
  
  // Write to console based on level
  switch (level) {
    case 'error':
      console.error(message);
      break;
    case 'warning':
    case 'warn':
      console.warn(message);
      break;
    case 'info':
    default:
      console.log(message);
      break;
  }
};

// Helper function to mask sensitive tokens in text
export const maskToken = (token, options = {}) => {
  const { minLength = 12, startChars = 5, endChars = 5 } = options;
  
  if (!token || token.length < minLength) {
    return token; // Don't mask very short strings
  }
  
  const start = token.substring(0, startChars);
  const end = token.substring(token.length - endChars);
  const middle = '*'.repeat(Math.max(token.length - (startChars + endChars), 3));
  
  return start + middle + end;
};


// Helper function to format timestamps
export const formatTimestamp = (date = new Date()) => {
  return date.toISOString().replace(/[:.]/g, '-');
};

// Helper function to create safe file names
export const sanitizeFileName = (name) => {
  return name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
};

// Helper function to check if running in specific runtime
export const getRuntime = () => {
  if (typeof Bun !== 'undefined') return 'bun';
  if (typeof Deno !== 'undefined') return 'deno';
  return 'node';
};

// Helper function to get platform info
export const getPlatformInfo = () => {
  return {
    platform: process.platform,
    arch: process.arch,
    runtime: getRuntime(),
    nodeVersion: process.versions?.node,
    bunVersion: process.versions?.bun
  };
};

// Helper function to safely parse JSON
export const safeJsonParse = (text, defaultValue = null) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return defaultValue;
  }
};

// Helper function to sleep/delay
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to retry operations
export const retry = async (fn, options = {}) => {
  const { maxAttempts = 3, delay = 1000, backoff = 2 } = options;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      
      const waitTime = delay * Math.pow(backoff, attempt - 1);
      await log(`Attempt ${attempt} failed, retrying in ${waitTime}ms...`, { level: 'warn' });
      await sleep(waitTime);
    }
  }
};

// Helper function to format bytes to human readable
export const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// Helper function to measure execution time
export const measureTime = async (fn, label = 'Operation') => {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    await log(`${label} completed in ${duration}ms`, { verbose: true });
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    await log(`${label} failed after ${duration}ms`, { level: 'error' });
    throw error;
  }
};

// Helper function to clean up error messages for better user experience
export const cleanErrorMessage = (error) => {
  let message = error.message || error.toString();
  
  // Remove common noise from error messages
  message = message.split('\n')[0]; // Take only first line
  message = message.replace(/^Command failed: /, ''); // Remove "Command failed: " prefix
  message = message.replace(/^Error: /, ''); // Remove redundant "Error: " prefix
  message = message.replace(/^\/bin\/sh: \d+: /, ''); // Remove shell path info
  
  return message;
};

// Helper function to format aligned console output
export const formatAligned = (icon, label, value, indent = 0) => {
  const spaces = ' '.repeat(indent);
  const labelWidth = 25 - indent;
  const paddedLabel = label.padEnd(labelWidth, ' ');
  return `${spaces}${icon} ${paddedLabel} ${value || ''}`;
};

// Helper function to display formatted error messages with sections
export const displayFormattedError = async (options) => {
  const {
    title,
    what,
    details,
    causes,
    fixes,
    workDir,
    log: logFn = log,
    level = 'error'
  } = options;

  await logFn('');
  await logFn(`❌ ${title}`, { level });
  await logFn('');

  if (what) {
    await logFn('  🔍 What happened:');
    await logFn(`     ${what}`);
    await logFn('');
  }

  if (details) {
    await logFn('  📦 Error details:');
    const detailLines = Array.isArray(details) ? details : details.split('\n');
    for (const line of detailLines) {
      if (line.trim()) await logFn(`     ${line.trim()}`);
    }
    await logFn('');
  }

  if (causes && causes.length > 0) {
    await logFn('  💡 Possible causes:');
    for (const cause of causes) {
      await logFn(`     • ${cause}`);
    }
    await logFn('');
  }

  if (fixes && fixes.length > 0) {
    await logFn('  🔧 How to fix:');
    for (let i = 0; i < fixes.length; i++) {
      await logFn(`     ${i + 1}. ${fixes[i]}`);
    }
    await logFn('');
  }

  if (workDir) {
    await logFn(`  📂 Working directory: ${workDir}`);
    await logFn('');
  }

  // Always show the log file path if it exists - using absolute path
  if (logFile) {
    const path = (await use('path'));
    const absoluteLogPath = path.resolve(logFile);
    await logFn(`  📁 Full log file: ${absoluteLogPath}`);
    await logFn('');
  }
};

// Helper function to clean up temporary directories
export const cleanupTempDirectories = async (argv) => {
  if (!argv || !argv.autoCleanup) {
    return;
  }
  
  // Dynamic import for command-stream
  const { $ } = await use('command-stream');
  
  try {
    await log('\n🧹 Auto-cleanup enabled, removing temporary directories...');
    await log('   ⚠️  Executing: sudo rm -rf /tmp/* /var/tmp/*', { verbose: true });
    
    // Execute cleanup command using command-stream
    const cleanupCommand = $`sudo rm -rf /tmp/* /var/tmp/*`;
    
    let exitCode = 0;
    for await (const chunk of cleanupCommand.stream()) {
      if (chunk.type === 'stderr') {
        const error = chunk.data.toString().trim();
        if (error && !error.includes('cannot remove')) { // Ignore "cannot remove" warnings for files in use
          await log(`   [cleanup WARNING] ${error}`, { level: 'warn', verbose: true });
        }
      } else if (chunk.type === 'exit') {
        exitCode = chunk.code;
      }
    }
    
    if (exitCode === 0) {
      await log('   ✅ Temporary directories cleaned successfully');
    } else {
      await log(`   ⚠️  Cleanup completed with warnings (exit code: ${exitCode})`, { level: 'warn' });
    }
  } catch (error) {
    await log(`   ❌ Error during cleanup: ${cleanErrorMessage(error)}`, { level: 'error' });
    // Don't fail the entire process if cleanup fails
  }
};

// Export all functions as default object too
export default {
  log,
  setLogFile,
  getLogFile,
  getAbsoluteLogPath,
  maskToken,
  formatTimestamp,
  sanitizeFileName,
  getRuntime,
  getPlatformInfo,
  safeJsonParse,
  sleep,
  retry,
  formatBytes,
  measureTime,
  cleanErrorMessage,
  formatAligned,
  displayFormattedError,
  cleanupTempDirectories
};

// Get version information for logging
export const getVersionInfo = async () => {
  const path = (await use('path'));
  const $ = (await use('zx')).$;
  const { getGitVersionAsync } = await import('./git.lib.mjs');

  try {
    const packagePath = path.join(path.dirname(path.dirname(new globalThis.URL(import.meta.url).pathname)), 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    const currentVersion = packageJson.version;

    // Use git.lib.mjs to get version with proper git error handling
    return await getGitVersionAsync($, currentVersion);
  } catch {
    // Fallback to hardcoded version if all else fails
    return '0.10.4';
  }
};