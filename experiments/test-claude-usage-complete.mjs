#!/usr/bin/env node

/**
 * Complete solution: Capture and parse 'claude /usage' output
 *
 * This script:
 * 1. Spawns 'claude /usage' in a PTY
 * 2. Handles the permission prompt automatically
 * 3. Captures the usage screen output
 * 4. Parses the usage data to extract percentages and reset times
 * 5. Returns structured data for display
 */

import { promisify } from 'util';
const sleep = promisify(setTimeout);

// Dynamic import of node-pty using use-m
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

let pty;
try {
  const ptyModule = await use('node-pty');
  pty = ptyModule.default || ptyModule;
} catch (error) {
  console.error('❌ Failed to load node-pty:', error.message);
  process.exit(1);
}

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

  // Extract usage information using regex
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
 * Format usage data for Telegram display
 */
function formatUsageForTelegram(usageData) {
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
 * Create a simple text progress bar
 */
function createProgressBar(percentage, length = 10) {
  const filled = Math.round((percentage / 100) * length);
  const empty = length - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Capture Claude usage data
 */
async function captureClaudeUsage() {
  return new Promise((resolve, reject) => {
    let output = '';
    let approvalSent = false;
    let usageScreenTimeout;

    const ptyProcess = pty.spawn('claude', ['/usage'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: process.env
    });

    ptyProcess.onData((data) => {
      output += data;

      // Handle permission prompt
      if (!approvalSent && output.includes('Ready to code here?')) {
        setTimeout(() => {
          ptyProcess.write('\r'); // Send Enter to approve
          approvalSent = true;

          // Wait for usage screen to render, then exit
          usageScreenTimeout = setTimeout(() => {
            ptyProcess.write('\x1b'); // Send ESC to exit
            setTimeout(() => ptyProcess.kill(), 500);
          }, 2000);
        }, 500);
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      clearTimeout(usageScreenTimeout);

      const usageData = parseUsageData(output);
      const hasValidData = usageData.currentSession || usageData.currentWeekAllModels;

      resolve({
        success: hasValidData,
        usageData,
        rawOutput: output
      });
    });

    // Overall timeout
    setTimeout(() => {
      ptyProcess.kill();
      reject(new Error('Timeout waiting for claude usage data'));
    }, 15000);
  });
}

// Run the test
async function main() {
  console.log('=== Testing Claude Usage Capture and Parsing ===\n');

  try {
    const result = await captureClaudeUsage();

    if (!result.success) {
      console.error('❌ Failed to capture usage data');
      process.exit(1);
    }

    console.log('✅ Successfully captured usage data!\n');
    console.log('=== Parsed Usage Data ===');
    console.log(JSON.stringify(result.usageData, null, 2));

    console.log('\n=== Formatted for Telegram ===');
    const telegramMessage = formatUsageForTelegram(result.usageData);
    console.log(telegramMessage);

    console.log('\n=== Test Complete ===');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

main();
