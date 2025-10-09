#!/usr/bin/env node

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { lino } = await import('./lino.lib.mjs');

const dotenvxModule = await use('@dotenvx/dotenvx');
const dotenvx = dotenvxModule.default || dotenvxModule;

dotenvx.config({ quiet: true });

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

// Import strict options validation
const yargsStrictLib = await import('./yargs-strict.lib.mjs');
const { validateStrictOptions } = yargsStrictLib;

// Define all valid options for strict validation
const DEFINED_OPTIONS = new Set([
  'help', 'h', 'version',
  'token', 't',
  'allowed-chats', 'allowedChats', 'a',
  'solve-overrides', 'solveOverrides',
  'hive-overrides', 'hiveOverrides',
  'solve', 'no-solve', 'noSolve',
  'hive', 'no-hive', 'noHive',
  '_', '$0'
]);

const argv = yargs(hideBin(process.argv))
  .usage('Usage: hive-telegram-bot [options]')
  .option('token', {
    type: 'string',
    description: 'Telegram bot token from @BotFather',
    alias: 't'
  })
  .option('allowed-chats', {
    type: 'string',
    description: 'Allowed chat IDs in lino notation, e.g., "(\n  123456789\n  987654321\n)"',
    alias: 'a'
  })
  .option('solve-overrides', {
    type: 'string',
    description: 'Override options for /solve command in lino notation, e.g., "(\n  --auto-continue\n  --attach-logs\n)"'
  })
  .option('hive-overrides', {
    type: 'string',
    description: 'Override options for /hive command in lino notation, e.g., "(\n  --verbose\n  --all-issues\n)"'
  })
  .option('solve', {
    type: 'boolean',
    description: 'Enable /solve command (use --no-solve to disable)',
    default: true
  })
  .option('hive', {
    type: 'boolean',
    description: 'Enable /hive command (use --no-hive to disable)',
    default: true
  })
  .help('h')
  .alias('h', 'help')
  .parserConfiguration({
    'boolean-negation': true
  })
  .parse();

// Apply strict options validation to reject unrecognized options
validateStrictOptions(argv, DEFINED_OPTIONS);

const BOT_TOKEN = argv.token || process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN environment variable or --token option is not set');
  console.error('Please set it with: export TELEGRAM_BOT_TOKEN=your_bot_token');
  console.error('Or use: hive-telegram-bot --token your_bot_token');
  process.exit(1);
}

const telegrafModule = await use('telegraf');
const { Telegraf } = telegrafModule;

const bot = new Telegraf(BOT_TOKEN, {
  // Remove the default 90-second timeout for message handlers
  // This is important because command handlers (like /solve) spawn long-running processes
  handlerTimeout: Infinity
});

const allowedChatsInput = argv.allowedChats || argv['allowed-chats'] || process.env.TELEGRAM_ALLOWED_CHATS;
const allowedChats = allowedChatsInput
  ? lino.parseNumericIds(allowedChatsInput)
  : null;

// Parse override options
const solveOverridesInput = argv.solveOverrides || argv['solve-overrides'] || process.env.TELEGRAM_SOLVE_OVERRIDES;
const solveOverrides = solveOverridesInput
  ? lino.parse(solveOverridesInput).filter(line => line.trim())
  : [];

const hiveOverridesInput = argv.hiveOverrides || argv['hive-overrides'] || process.env.TELEGRAM_HIVE_OVERRIDES;
const hiveOverrides = hiveOverridesInput
  ? lino.parse(hiveOverridesInput).filter(line => line.trim())
  : [];

// Command enable/disable flags
// Note: yargs automatically supports --no-solve and --no-hive for negation
// Check both the camelCase and kebab-case versions
const solveEnabled = argv.solve !== false &&
  (process.env.TELEGRAM_SOLVE === undefined || process.env.TELEGRAM_SOLVE !== 'false');
const hiveEnabled = argv.hive !== false &&
  (process.env.TELEGRAM_HIVE === undefined || process.env.TELEGRAM_HIVE !== 'false');

function isChatAuthorized(chatId) {
  if (!allowedChats) {
    return true;
  }
  return allowedChats.includes(chatId);
}

function isGroupChat(ctx) {
  const chatType = ctx.chat?.type;
  return chatType === 'group' || chatType === 'supergroup';
}

async function findStartScreenCommand() {
  try {
    const { stdout } = await exec('which start-screen');
    return stdout.trim();
  } catch (error) {
    return null;
  }
}

async function executeStartScreen(command, args) {
  try {
    // Check if start-screen is available BEFORE first execution
    const whichPath = await findStartScreenCommand();

    if (!whichPath) {
      const warningMsg = '⚠️  WARNING: start-screen command not found in PATH\n' +
                        'Please ensure @deep-assistant/hive-mind is properly installed\n' +
                        'You may need to run: npm install -g @deep-assistant/hive-mind';
      console.warn(warningMsg);

      // Still try to execute with 'start-screen' in case it's available in PATH but 'which' failed
      return {
        success: false,
        warning: warningMsg,
        error: 'start-screen command not found in PATH'
      };
    }

    // Use the resolved path from which
    if (process.env.TELEGRAM_BOT_VERBOSE) {
      console.log(`[VERBOSE] Found start-screen at: ${whichPath}`);
    }

    return await executeWithCommand(whichPath, command, args);
  } catch (error) {
    console.error('Error executing start-screen:', error);
    return {
      success: false,
      output: '',
      error: error.message
    };
  }
}

function executeWithCommand(startScreenCmd, command, args) {
  return new Promise((resolve) => {
    const allArgs = [command, ...args];

    if (process.env.TELEGRAM_BOT_VERBOSE) {
      console.log(`[VERBOSE] Executing: ${startScreenCmd} ${allArgs.join(' ')}`);
    } else {
      console.log(`Executing: ${startScreenCmd} ${allArgs.join(' ')}`);
    }

    const child = spawn(startScreenCmd, allArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        output: stdout,
        error: error.message
      });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          output: stdout
        });
      } else {
        resolve({
          success: false,
          output: stdout,
          error: stderr || `Command exited with code ${code}`
        });
      }
    });
  });
}

function parseCommandArgs(text) {
  // Use only first line and trim it
  const firstLine = text.split('\n')[0].trim();
  const argsText = firstLine.replace(/^\/\w+\s*/, '');

  if (!argsText.trim()) {
    return [];
  }

  // Replace em-dash (—) with double-dash (--) to fix Telegram auto-replacement
  const normalizedArgsText = argsText.replace(/—/g, '--');

  const args = [];
  let currentArg = '';
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < normalizedArgsText.length; i++) {
    const char = normalizedArgsText[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = null;
    } else if (char === ' ' && !inQuotes) {
      if (currentArg) {
        args.push(currentArg);
        currentArg = '';
      }
    } else {
      currentArg += char;
    }
  }

  if (currentArg) {
    args.push(currentArg);
  }

  return args;
}

function mergeArgsWithOverrides(userArgs, overrides) {
  if (!overrides || overrides.length === 0) {
    return userArgs;
  }

  // Parse overrides to identify flags and their values
  const overrideFlags = new Map(); // Map of flag -> value (or null for boolean flags)

  for (let i = 0; i < overrides.length; i++) {
    const arg = overrides[i];
    if (arg.startsWith('--')) {
      // Check if next item is a value (doesn't start with --)
      if (i + 1 < overrides.length && !overrides[i + 1].startsWith('--')) {
        overrideFlags.set(arg, overrides[i + 1]);
        i++; // Skip the value in next iteration
      } else {
        overrideFlags.set(arg, null); // Boolean flag
      }
    }
  }

  // Filter user args to remove any that conflict with overrides
  const filteredArgs = [];
  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i];
    if (arg.startsWith('--')) {
      // If this flag exists in overrides, skip it and its value
      if (overrideFlags.has(arg)) {
        // Skip the flag
        // Also skip next arg if it's a value (doesn't start with --)
        if (i + 1 < userArgs.length && !userArgs[i + 1].startsWith('--')) {
          i++; // Skip the value too
        }
        continue;
      }
    }
    filteredArgs.push(arg);
  }

  // Merge: filtered user args + overrides
  return [...filteredArgs, ...overrides];
}

function validateGitHubUrl(args) {
  if (args.length === 0) {
    return {
      valid: false,
      error: 'Missing GitHub URL. Usage: /solve <github-url> [options]'
    };
  }

  const url = args[0];
  if (!url.includes('github.com')) {
    return {
      valid: false,
      error: 'First argument must be a GitHub URL'
    };
  }

  return { valid: true };
}

bot.command('help', async (ctx) => {
  const chatId = ctx.chat.id;
  const chatType = ctx.chat.type;
  const chatTitle = ctx.chat.title || 'Private Chat';

  let message = `🤖 *SwarmMindBot Help*\n\n`;
  message += `📋 *Diagnostic Information:*\n`;
  message += `• Chat ID: \`${chatId}\`\n`;
  message += `• Chat Type: ${chatType}\n`;
  message += `• Chat Title: ${chatTitle}\n\n`;
  message += `📝 *Available Commands:*\n\n`;

  if (solveEnabled) {
    message += `*/solve* - Solve a GitHub issue\n`;
    message += `Usage: \`/solve <github-url> [options]\`\n`;
    message += `Example: \`/solve https://github.com/owner/repo/issues/123 --verbose\`\n`;
    if (solveOverrides.length > 0) {
      message += `🔒 Locked options: \`${solveOverrides.join(' ')}\`\n`;
    }
    message += `\n`;
  } else {
    message += `*/solve* - ❌ Disabled\n\n`;
  }

  if (hiveEnabled) {
    message += `*/hive* - Run hive command\n`;
    message += `Usage: \`/hive <github-url> [options]\`\n`;
    message += `Example: \`/hive https://github.com/owner/repo --model sonnet\`\n`;
    if (hiveOverrides.length > 0) {
      message += `🔒 Locked options: \`${hiveOverrides.join(' ')}\`\n`;
    }
    message += `\n`;
  } else {
    message += `*/hive* - ❌ Disabled\n\n`;
  }

  message += `*/help* - Show this help message\n\n`;
  message += `⚠️ *Note:* /solve and /hive commands only work in group chats.\n\n`;
  message += `🔧 *Available Options:*\n`;
  message += `• \`--fork\` - Fork the repository\n`;
  message += `• \`--auto-continue\` - Continue working on existing pull request to the issue, if exists\n`;
  message += `• \`--attach-logs\` - Attach logs to PR\n`;
  message += `• \`--verbose\` - Verbose output\n`;
  message += `• \`--model <model>\` - Specify AI model (sonnet/opus/haiku)\n`;
  message += `• \`--think <level>\` - Thinking level (low/medium/high/max)\n`;

  if (allowedChats) {
    message += `\n🔒 *Restricted Mode:* This bot only accepts commands from authorized chats.\n`;
    message += `Authorized: ${isChatAuthorized(chatId) ? '✅ Yes' : '❌ No'}`;
  }

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command('solve', async (ctx) => {
  if (!solveEnabled) {
    await ctx.reply('❌ The /solve command is disabled on this bot instance.');
    return;
  }

  if (!isGroupChat(ctx)) {
    await ctx.reply('❌ The /solve command only works in group chats. Please add this bot to a group and make it an admin.');
    return;
  }

  const chatId = ctx.chat.id;
  if (!isChatAuthorized(chatId)) {
    await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`);
    return;
  }

  const userArgs = parseCommandArgs(ctx.message.text);

  const validation = validateGitHubUrl(userArgs);
  if (!validation.valid) {
    await ctx.reply(`❌ ${validation.error}\n\nExample: \`/solve https://github.com/owner/repo/issues/123 --verbose\``, { parse_mode: 'Markdown' });
    return;
  }

  // Merge user args with overrides
  const args = mergeArgsWithOverrides(userArgs, solveOverrides);

  let statusMsg = `🚀 Starting solve command...\nURL: ${args[0]}\nOptions: ${args.slice(1).join(' ') || 'none'}`;
  if (solveOverrides.length > 0) {
    statusMsg += `\n🔒 Locked options: ${solveOverrides.join(' ')}`;
  }
  await ctx.reply(statusMsg);

  const result = await executeStartScreen('solve', args);

  if (result.warning) {
    await ctx.reply(`⚠️  ${result.warning}`, { parse_mode: 'Markdown' });
    return;
  }

  if (result.success) {
    const sessionNameMatch = result.output.match(/session:\s*(\S+)/i) ||
                            result.output.match(/screen -r\s+(\S+)/);
    const sessionName = sessionNameMatch ? sessionNameMatch[1] : 'unknown';

    let response = `✅ Solve command started successfully!\n\n`;
    response += `📊 *Session:* \`${sessionName}\`\n\n`;
    response += `📝 To attach to the session:\n\`\`\`\nscreen -r ${sessionName}\n\`\`\`\n\n`;
    response += `Output:\n\`\`\`\n${result.output.trim()}\n\`\`\``;

    await ctx.reply(response, { parse_mode: 'Markdown' });
  } else {
    let response = `❌ Error executing solve command:\n\n`;
    response += `\`\`\`\n${result.error || result.output}\n\`\`\``;
    await ctx.reply(response, { parse_mode: 'Markdown' });
  }
});

bot.command('hive', async (ctx) => {
  if (!hiveEnabled) {
    await ctx.reply('❌ The /hive command is disabled on this bot instance.');
    return;
  }

  if (!isGroupChat(ctx)) {
    await ctx.reply('❌ The /hive command only works in group chats. Please add this bot to a group and make it an admin.');
    return;
  }

  const chatId = ctx.chat.id;
  if (!isChatAuthorized(chatId)) {
    await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`);
    return;
  }

  const userArgs = parseCommandArgs(ctx.message.text);

  const validation = validateGitHubUrl(userArgs);
  if (!validation.valid) {
    await ctx.reply(`❌ ${validation.error}\n\nExample: \`/hive https://github.com/owner/repo --verbose\``, { parse_mode: 'Markdown' });
    return;
  }

  // Merge user args with overrides
  const args = mergeArgsWithOverrides(userArgs, hiveOverrides);

  let statusMsg = `🚀 Starting hive command...\nURL: ${args[0]}\nOptions: ${args.slice(1).join(' ') || 'none'}`;
  if (hiveOverrides.length > 0) {
    statusMsg += `\n🔒 Locked options: ${hiveOverrides.join(' ')}`;
  }
  await ctx.reply(statusMsg);

  const result = await executeStartScreen('hive', args);

  if (result.warning) {
    await ctx.reply(`⚠️  ${result.warning}`, { parse_mode: 'Markdown' });
    return;
  }

  if (result.success) {
    const sessionNameMatch = result.output.match(/session:\s*(\S+)/i) ||
                            result.output.match(/screen -r\s+(\S+)/);
    const sessionName = sessionNameMatch ? sessionNameMatch[1] : 'unknown';

    let response = `✅ Hive command started successfully!\n\n`;
    response += `📊 *Session:* \`${sessionName}\`\n\n`;
    response += `📝 To attach to the session:\n\`\`\`\nscreen -r ${sessionName}\n\`\`\`\n\n`;
    response += `Output:\n\`\`\`\n${result.output.trim()}\n\`\`\``;

    await ctx.reply(response, { parse_mode: 'Markdown' });
  } else {
    let response = `❌ Error executing hive command:\n\n`;
    response += `\`\`\`\n${result.error || result.output}\n\`\`\``;
    await ctx.reply(response, { parse_mode: 'Markdown' });
  }
});

// Add global error handler for uncaught errors in middleware
bot.catch((error, ctx) => {
  console.error('Unhandled error while processing update', ctx.update.update_id);
  console.error('Error:', error);

  // Try to notify the user about the error
  if (ctx?.reply) {
    ctx.reply('❌ An error occurred while processing your request. Please try again or contact support.')
      .catch(replyError => {
        console.error('Failed to send error message to user:', replyError);
      });
  }
});

console.log('🤖 SwarmMindBot is starting...');
console.log('Bot token:', BOT_TOKEN.substring(0, 10) + '...');
if (allowedChats && allowedChats.length > 0) {
  console.log('Allowed chats (lino):', lino.format(allowedChats));
} else {
  console.log('Allowed chats: All (no restrictions)');
}
console.log('Commands enabled:', {
  solve: solveEnabled,
  hive: hiveEnabled
});
if (solveOverrides.length > 0) {
  console.log('Solve overrides (lino):', lino.format(solveOverrides));
}
if (hiveOverrides.length > 0) {
  console.log('Hive overrides (lino):', lino.format(hiveOverrides));
}

bot.launch()
  .then(() => {
    console.log('✅ SwarmMindBot is now running!');
    console.log('Press Ctrl+C to stop');
  })
  .catch((error) => {
    console.error('❌ Failed to start bot:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack?.split('\n').slice(0, 5).join('\n')
    });
    process.exit(1);
  });

process.once('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, stopping bot...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, stopping bot...');
  bot.stop('SIGTERM');
});
