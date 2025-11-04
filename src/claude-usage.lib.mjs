#!/usr/bin/env node

/**
 * Library for capturing and parsing Claude usage data
 *
 * This module provides functions to fetch real-time usage data from
 * the Claude CLI's /usage command and format it for display.
 */

import { spawn } from 'child_process';

/**
 * Strip ANSI escape codes from text
 */
function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\][0-9;]*\x07/g, '');
}

/**
 * Parse the usage data from claude /usage output
 */
function parseUsageData(output) {
  const cleanOutput = stripAnsi(output);

  const usageData = {
    currentSession: null,
    currentWeekAllModels: null,
    currentWeekOpus: null
  };

  // Parse Current session
  const sessionMatch = cleanOutput.match(/Current session[^]*?(\d+)% used[^]*?Resets ([^\n]+)/);
  if (sessionMatch) {
    usageData.currentSession = {
      percentage: parseInt(sessionMatch[1], 10),
      resetTime: sessionMatch[2].trim()
    };
  }

  // Parse Current week (all models)
  const weekAllMatch = cleanOutput.match(/Current week \(all models\)[^]*?(\d+)% used[^]*?Resets ([^\n]+)/);
  if (weekAllMatch) {
    usageData.currentWeekAllModels = {
      percentage: parseInt(weekAllMatch[1], 10),
      resetTime: weekAllMatch[2].trim()
    };
  }

  // Parse Current week (Opus)
  const weekOpusMatch = cleanOutput.match(/Current week \(Opus\)[^]*?(\d+)% used/);
  if (weekOpusMatch) {
    usageData.currentWeekOpus = {
      percentage: parseInt(weekOpusMatch[1], 10)
    };
  }

  return usageData;
}

/**
 * Create a simple text progress bar
 */
function createProgressBar(percentage, length = 10) {
  const filled = Math.round((percentage / 100) * length);
  const empty = length - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Format usage data for Telegram display
 */
export function formatUsageForTelegram(usageData) {
  if (!usageData.currentSession && !usageData.currentWeekAllModels) {
    return '⚠️ Unable to fetch current Claude usage data';
  }

  let message = '⏱️ *Claude Usage Status:*\n';

  if (usageData.currentSession) {
    const bar = createProgressBar(usageData.currentSession.percentage);
    message += `\n*Current Session:* ${usageData.currentSession.percentage}% used\n`;
    message += `${bar}\n`;
    message += `Resets: ${usageData.currentSession.resetTime}\n`;
  }

  if (usageData.currentWeekAllModels) {
    const bar = createProgressBar(usageData.currentWeekAllModels.percentage);
    message += `\n*Current Week (All Models):* ${usageData.currentWeekAllModels.percentage}% used\n`;
    message += `${bar}\n`;
    message += `Resets: ${usageData.currentWeekAllModels.resetTime}\n`;
  }

  if (usageData.currentWeekOpus) {
    const bar = createProgressBar(usageData.currentWeekOpus.percentage);
    message += `\n*Current Week (Opus):* ${usageData.currentWeekOpus.percentage}% used\n`;
    message += `${bar}`;
  }

  return message;
}

/**
 * Capture Claude usage data using the script command
 * This approach works without requiring node-pty or other native dependencies
 */
export async function getClaudeUsage() {
  return new Promise((resolve, reject) => {
    let output = '';
    let resolved = false;
    let dataReceivedRecently = false;
    let noDataTimer;

    // Use 'script' command to allocate a pseudo-terminal and run claude
    const child = spawn('script', [
      '-q',           // Quiet mode
      '-c',           // Command to run
      'claude /usage',
      '/dev/null'     // Discard the typescript output file
    ], {
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      }
    });

    child.stdout.on('data', (data) => {
      output += data.toString();
      dataReceivedRecently = true;

      // Clear and reset the "no data" timer
      clearTimeout(noDataTimer);

      // If we've received data that includes "Esc to exit" and usage info, wait a bit then exit
      if (output.includes('Esc to exit') && output.includes('Current session')) {
        noDataTimer = setTimeout(() => {
          if (!resolved && dataReceivedRecently) {
            // Send ESC to exit
            child.stdin.write('\x1b');
            setTimeout(() => {
              if (!resolved) {
                child.kill();
              }
            }, 500);
            dataReceivedRecently = false;
          }
        }, 1000);  // Wait 1 second of no more data
      }
    });

    child.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(noDataTimer);
        reject(error);
      }
    });

    child.on('close', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(noDataTimer);

      // Parse the captured output
      const usageData = parseUsageData(output);
      const hasValidData = usageData.currentSession || usageData.currentWeekAllModels;

      if (hasValidData) {
        resolve(usageData);
      } else {
        reject(new Error('Failed to parse usage data from output'));
      }
    });

    // Overall timeout of 15 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(noDataTimer);
        child.kill();
        reject(new Error('Timeout waiting for Claude usage data'));
      }
    }, 15000);
  });
}

/**
 * Get formatted Claude usage message for Telegram
 * Returns a formatted message string or an error message if fetching fails
 */
export async function getClaudeUsageMessage() {
  try {
    const usageData = await getClaudeUsage();
    return formatUsageForTelegram(usageData);
  } catch (error) {
    console.error('Failed to fetch Claude usage:', error);
    return '⚠️ Unable to fetch current Claude usage data';
  }
}
