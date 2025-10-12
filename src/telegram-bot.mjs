#!/usr/bin/env node

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { lino } = await import('./lino.lib.mjs');
const { buildUserMention } = await import('./buildUserMention.lib.mjs');

const dotenvxModule = await use('@dotenvx/dotenvx');
const dotenvx = dotenvxModule.default || dotenvxModule;

dotenvx.config({ quiet: true });

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

// Import solve and hive yargs configurations for validation
const solveConfigLib = await import('./solve.config.lib.mjs');
const { createYargsConfig: createSolveYargsConfig } = solveConfigLib;

const hiveConfigLib = await import('./hive.config.lib.mjs');
const { createYargsConfig: createHiveYargsConfig } = hiveConfigLib;

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
  .option('dry-run', {
    type: 'boolean',
    description: 'Validate configuration and options without starting the bot',
    default: false
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Enable verbose logging for debugging',
    default: false,
    alias: 'v'
  })
  .help('h')
  .alias('h', 'help')
  .parserConfiguration({
    'boolean-negation': true,
    'strip-dashed': true  // Remove dashed keys from argv to simplify validation
  })
  .strict()  // Enable strict mode to reject unknown options (consistent with solve.mjs and hive.mjs)
  .parse();

const BOT_TOKEN = argv.token || process.env.TELEGRAM_BOT_TOKEN;
const VERBOSE = argv.verbose || argv.v || process.env.TELEGRAM_BOT_VERBOSE === 'true';

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

// Track bot startup time to ignore messages sent before bot started
// Using Unix timestamp (seconds since epoch) to match Telegram's message.date format
const BOT_START_TIME = Math.floor(Date.now() / 1000);

const allowedChatsInput = argv.allowedChats || argv['allowed-chats'] || process.env.TELEGRAM_ALLOWED_CHATS;
const allowedChats = allowedChatsInput
  ? lino.parseNumericIds(allowedChatsInput)
  : null;

// Parse override options
const solveOverridesInput = argv.solveOverrides || argv['solve-overrides'] || process.env.TELEGRAM_SOLVE_OVERRIDES;
const solveOverrides = solveOverridesInput
  ? lino.parse(solveOverridesInput).map(line => line.trim()).filter(line => line)
  : [];

const hiveOverridesInput = argv.hiveOverrides || argv['hive-overrides'] || process.env.TELEGRAM_HIVE_OVERRIDES;
const hiveOverrides = hiveOverridesInput
  ? lino.parse(hiveOverridesInput).map(line => line.trim()).filter(line => line)
  : [];

// Command enable/disable flags
// Note: yargs automatically supports --no-solve and --no-hive for negation
// Check both the camelCase and kebab-case versions
const solveEnabled = argv.solve !== false &&
  (process.env.TELEGRAM_SOLVE === undefined || process.env.TELEGRAM_SOLVE !== 'false');
const hiveEnabled = argv.hive !== false &&
  (process.env.TELEGRAM_HIVE === undefined || process.env.TELEGRAM_HIVE !== 'false');

// Validate solve overrides early using solve's yargs config
// Only validate if solve command is enabled
if (solveEnabled && solveOverrides.length > 0) {
  console.log('Validating solve overrides...');
  try {
    // Add a dummy URL as the first argument (required positional for solve)
    const testArgs = ['https://github.com/test/test/issues/1', ...solveOverrides];

    // Temporarily suppress stderr to avoid yargs error output during validation
    const originalStderrWrite = process.stderr.write;
    const stderrBuffer = [];
    process.stderr.write = (chunk) => {
      stderrBuffer.push(chunk);
      return true;
    };

    try {
      // Use .parse() instead of yargs(args).parseSync() to ensure .strict() mode works
      const testYargs = createSolveYargsConfig(yargs());
      // Suppress yargs error output - we'll handle errors ourselves
      testYargs.showHelpOnFail(false);
      testYargs.fail((msg, err) => {
        if (err) throw err;
        throw new Error(msg);
      });
      await testYargs.parse(testArgs);
      console.log('✅ Solve overrides validated successfully');
    } finally {
      // Restore stderr
      process.stderr.write = originalStderrWrite;
    }
  } catch (error) {
    console.error(`❌ Invalid solve-overrides: ${error.message || String(error)}`);
    console.error(`   Overrides: ${solveOverrides.join(' ')}`);
    process.exit(1);
  }
}

// Validate hive overrides early using hive's yargs config
// Only validate if hive command is enabled
if (hiveEnabled && hiveOverrides.length > 0) {
  console.log('Validating hive overrides...');
  try {
    // Add a dummy URL as the first argument (required positional for hive)
    const testArgs = ['https://github.com/test/test', ...hiveOverrides];

    // Temporarily suppress stderr to avoid yargs error output during validation
    const originalStderrWrite = process.stderr.write;
    const stderrBuffer = [];
    process.stderr.write = (chunk) => {
      stderrBuffer.push(chunk);
      return true;
    };

    try {
      // Use .parse() instead of yargs(args).parseSync() to ensure .strict() mode works
      const testYargs = createHiveYargsConfig(yargs());
      // Suppress yargs error output - we'll handle errors ourselves
      testYargs.showHelpOnFail(false);
      testYargs.fail((msg, err) => {
        if (err) throw err;
        throw new Error(msg);
      });
      await testYargs.parse(testArgs);
      console.log('✅ Hive overrides validated successfully');
    } finally {
      // Restore stderr
      process.stderr.write = originalStderrWrite;
    }
  } catch (error) {
    console.error(`❌ Invalid hive-overrides: ${error.message || String(error)}`);
    console.error(`   Overrides: ${hiveOverrides.join(' ')}`);
    process.exit(1);
  }
}

// Handle dry-run mode - exit after validation
if (argv.dryRun || argv['dry-run']) {
  console.log('\n✅ Dry-run mode: All validations passed successfully!');
  console.log('\nConfiguration summary:');
  console.log('  Token:', BOT_TOKEN ? `${BOT_TOKEN.substring(0, 10)}...` : 'not set');
  if (allowedChats && allowedChats.length > 0) {
    console.log('  Allowed chats:', lino.format(allowedChats));
  } else {
    console.log('  Allowed chats: All (no restrictions)');
  }
  console.log('  Commands enabled:', { solve: solveEnabled, hive: hiveEnabled });
  if (solveOverrides.length > 0) {
    console.log('  Solve overrides:', lino.format(solveOverrides));
  }
  if (hiveOverrides.length > 0) {
    console.log('  Hive overrides:', lino.format(hiveOverrides));
  }
  console.log('\n🎉 Bot configuration is valid. Exiting without starting the bot.');
  process.exit(0);
}

function isChatAuthorized(chatId) {
  if (!allowedChats) {
    return true;
  }
  return allowedChats.includes(chatId);
}

function isOldMessage(ctx) {
  // Ignore messages sent before the bot started
  // This prevents processing old/pending messages from before current bot instance startup
  const messageDate = ctx.message?.date;
  if (!messageDate) {
    return false;
  }
  return messageDate < BOT_START_TIME;
}

function isGroupChat(ctx) {
  const chatType = ctx.chat?.type;
  return chatType === 'group' || chatType === 'supergroup';
}

function isForwardedOrReply(ctx) {
  const message = ctx.message;
  if (!message) {
    if (VERBOSE) {
      console.log('[VERBOSE] isForwardedOrReply: No message object');
    }
    return false;
  }

  if (VERBOSE) {
    console.log('[VERBOSE] isForwardedOrReply: Checking message fields...');
    console.log('[VERBOSE]   message.forward_origin:', JSON.stringify(message.forward_origin));
    console.log('[VERBOSE]   message.forward_origin?.type:', message.forward_origin?.type);
    console.log('[VERBOSE]   message.forward_from:', JSON.stringify(message.forward_from));
    console.log('[VERBOSE]   message.forward_from_chat:', JSON.stringify(message.forward_from_chat));
    console.log('[VERBOSE]   message.forward_from_message_id:', message.forward_from_message_id);
    console.log('[VERBOSE]   message.forward_signature:', message.forward_signature);
    console.log('[VERBOSE]   message.forward_sender_name:', message.forward_sender_name);
    console.log('[VERBOSE]   message.forward_date:', message.forward_date);
    console.log('[VERBOSE]   message.reply_to_message:', JSON.stringify(message.reply_to_message));
    console.log('[VERBOSE]   message.reply_to_message?.message_id:', message.reply_to_message?.message_id);
  }

  // Check if message is forwarded (has forward_origin field with actual content)
  // Note: We check for .type because Telegram might send empty objects {}
  // which are truthy in JavaScript but don't indicate a forwarded message
  if (message.forward_origin && message.forward_origin.type) {
    if (VERBOSE) {
      console.log('[VERBOSE] isForwardedOrReply: TRUE - forward_origin.type exists:', message.forward_origin.type);
    }
    return true;
  }
  // Also check old forwarding API fields for backward compatibility
  if (message.forward_from || message.forward_from_chat ||
      message.forward_from_message_id || message.forward_signature ||
      message.forward_sender_name || message.forward_date) {
    if (VERBOSE) {
      console.log('[VERBOSE] isForwardedOrReply: TRUE - old forwarding API field detected');
      if (message.forward_from) console.log('[VERBOSE]     Triggered by: forward_from');
      if (message.forward_from_chat) console.log('[VERBOSE]     Triggered by: forward_from_chat');
      if (message.forward_from_message_id) console.log('[VERBOSE]     Triggered by: forward_from_message_id');
      if (message.forward_signature) console.log('[VERBOSE]     Triggered by: forward_signature');
      if (message.forward_sender_name) console.log('[VERBOSE]     Triggered by: forward_sender_name');
      if (message.forward_date) console.log('[VERBOSE]     Triggered by: forward_date');
    }
    return true;
  }
  // Check if message is a reply (has reply_to_message field with actual content)
  // Note: We check for .message_id because Telegram might send empty objects {}
  // IMPORTANT: In forum groups, messages in topics have reply_to_message pointing to the topic's
  // first message (with forum_topic_created). These are NOT user replies, just part of the thread.
  // We must exclude these to allow commands in forum topics.
  if (message.reply_to_message && message.reply_to_message.message_id) {
    // If the reply_to_message is a forum topic creation message, this is NOT a user reply
    if (message.reply_to_message.forum_topic_created) {
      if (VERBOSE) {
        console.log('[VERBOSE] isForwardedOrReply: FALSE - reply is to forum topic creation, not user reply');
        console.log('[VERBOSE]   Forum topic:', message.reply_to_message.forum_topic_created);
      }
      // This is just a message in a forum topic, not a reply to another user
      // Allow the message to proceed
    } else {
      // This is an actual reply to another user's message
      if (VERBOSE) {
        console.log('[VERBOSE] isForwardedOrReply: TRUE - reply_to_message.message_id exists:', message.reply_to_message.message_id);
      }
      return true;
    }
  }

  if (VERBOSE) {
    console.log('[VERBOSE] isForwardedOrReply: FALSE - no forwarding or reply detected');
  }
  return false;
}

async function findStartScreenCommand() {
  try {
    const { stdout } = await exec('which start-screen');
    return stdout.trim();
  } catch {
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
    if (VERBOSE) {
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

    if (VERBOSE) {
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
  if (VERBOSE) {
    console.log('[VERBOSE] /help command received');
  }

  // Ignore messages sent before bot started
  if (isOldMessage(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /help ignored: old message');
    }
    return;
  }

  // Ignore forwarded or reply messages
  if (isForwardedOrReply(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /help ignored: forwarded or reply');
    }
    return;
  }

  const chatId = ctx.chat.id;
  const chatType = ctx.chat.type;
  const chatTitle = ctx.chat.title || 'Private Chat';

  let message = '🤖 *SwarmMindBot Help*\n\n';
  message += '📋 *Diagnostic Information:*\n';
  message += `• Chat ID: \`${chatId}\`\n`;
  message += `• Chat Type: ${chatType}\n`;
  message += `• Chat Title: ${chatTitle}\n\n`;
  message += '📝 *Available Commands:*\n\n';

  if (solveEnabled) {
    message += '*/solve* - Solve a GitHub issue\n';
    message += 'Usage: `/solve <github-url> [options]`\n';
    message += 'Example: `/solve https://github.com/owner/repo/issues/123 --verbose`\n';
    if (solveOverrides.length > 0) {
      message += `🔒 Locked options: \`${solveOverrides.join(' ')}\`\n`;
    }
    message += '\n';
  } else {
    message += '*/solve* - ❌ Disabled\n\n';
  }

  if (hiveEnabled) {
    message += '*/hive* - Run hive command\n';
    message += 'Usage: `/hive <github-url> [options]`\n';
    message += 'Example: `/hive https://github.com/owner/repo --model sonnet`\n';
    if (hiveOverrides.length > 0) {
      message += `🔒 Locked options: \`${hiveOverrides.join(' ')}\`\n`;
    }
    message += '\n';
  } else {
    message += '*/hive* - ❌ Disabled\n\n';
  }

  message += '*/help* - Show this help message\n\n';
  message += '⚠️ *Note:* /solve and /hive commands only work in group chats.\n\n';
  message += '🔧 *Available Options:*\n';
  message += '• `--fork` - Fork the repository\n';
  message += '• `--auto-continue` - Continue working on existing pull request to the issue, if exists\n';
  message += '• `--attach-logs` - Attach logs to PR\n';
  message += '• `--verbose` - Verbose output\n';
  message += '• `--model <model>` - Specify AI model (sonnet/opus/haiku)\n';
  message += '• `--think <level>` - Thinking level (low/medium/high/max)\n';

  if (allowedChats) {
    message += '\n🔒 *Restricted Mode:* This bot only accepts commands from authorized chats.\n';
    message += `Authorized: ${isChatAuthorized(chatId) ? '✅ Yes' : '❌ No'}`;
  }

  message += '\n\n🔧 *Troubleshooting:*\n';
  message += 'If bot is not receiving messages:\n';
  message += '1. Check privacy mode in @BotFather\n';
  message += '   • Send `/setprivacy` to @BotFather\n';
  message += '   • Choose "Disable" for your bot\n';
  message += '   • Remove bot from group and re-add\n';
  message += '2. Or make bot an admin in the group\n';
  message += '3. Restart bot with `--verbose` flag for diagnostics';

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command('solve', async (ctx) => {
  if (VERBOSE) {
    console.log('[VERBOSE] /solve command received');
  }

  if (!solveEnabled) {
    if (VERBOSE) {
      console.log('[VERBOSE] /solve ignored: command disabled');
    }
    await ctx.reply('❌ The /solve command is disabled on this bot instance.');
    return;
  }

  // Ignore messages sent before bot started
  if (isOldMessage(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /solve ignored: old message');
    }
    return;
  }

  // Ignore forwarded or reply messages
  if (isForwardedOrReply(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /solve ignored: forwarded or reply');
    }
    return;
  }

  if (!isGroupChat(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /solve ignored: not a group chat');
    }
    await ctx.reply('❌ The /solve command only works in group chats. Please add this bot to a group and make it an admin.');
    return;
  }

  const chatId = ctx.chat.id;
  if (!isChatAuthorized(chatId)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /solve ignored: chat not authorized');
    }
    await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`);
    return;
  }

  if (VERBOSE) {
    console.log('[VERBOSE] /solve passed all checks, executing...');
  }

  const userArgs = parseCommandArgs(ctx.message.text);

  const validation = validateGitHubUrl(userArgs);
  if (!validation.valid) {
    await ctx.reply(`❌ ${validation.error}\n\nExample: \`/solve https://github.com/owner/repo/issues/123 --verbose\``, { parse_mode: 'Markdown' });
    return;
  }

  // Merge user args with overrides
  const args = mergeArgsWithOverrides(userArgs, solveOverrides);

  // Validate merged arguments using solve's yargs config
  try {
    // Use .parse() instead of yargs(args).parseSync() to ensure .strict() mode works
    const testYargs = createSolveYargsConfig(yargs());
    testYargs.parse(args);
  } catch (error) {
    await ctx.reply(`❌ Invalid options: ${error.message || String(error)}\n\nUse /help to see available options`, { parse_mode: 'Markdown' });
    return;
  }

  const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });
  let statusMsg = `🚀 Starting solve command...\nRequested by: ${requester}\nURL: ${args[0]}\nOptions: ${args.slice(1).join(' ') || 'none'}`;
  if (solveOverrides.length > 0) {
    statusMsg += `\n🔒 Locked options: ${solveOverrides.join(' ')}`;
  }
  await ctx.reply(statusMsg, { parse_mode: 'Markdown' });

  const result = await executeStartScreen('solve', args);

  if (result.warning) {
    await ctx.reply(`⚠️  ${result.warning}`, { parse_mode: 'Markdown' });
    return;
  }

  if (result.success) {
    const sessionNameMatch = result.output.match(/session:\s*(\S+)/i) ||
                            result.output.match(/screen -r\s+(\S+)/);
    const sessionName = sessionNameMatch ? sessionNameMatch[1] : 'unknown';

    let response = '✅ Solve command started successfully!\n\n';
    response += `📊 *Session:* \`${sessionName}\`\n`;

    await ctx.reply(response, { parse_mode: 'Markdown' });
  } else {
    let response = '❌ Error executing solve command:\n\n';
    response += `\`\`\`\n${result.error || result.output}\n\`\`\``;
    await ctx.reply(response, { parse_mode: 'Markdown' });
  }
});

bot.command('hive', async (ctx) => {
  if (VERBOSE) {
    console.log('[VERBOSE] /hive command received');
  }

  if (!hiveEnabled) {
    if (VERBOSE) {
      console.log('[VERBOSE] /hive ignored: command disabled');
    }
    await ctx.reply('❌ The /hive command is disabled on this bot instance.');
    return;
  }

  // Ignore messages sent before bot started
  if (isOldMessage(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /hive ignored: old message');
    }
    return;
  }

  // Ignore forwarded or reply messages
  if (isForwardedOrReply(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /hive ignored: forwarded or reply');
    }
    return;
  }

  if (!isGroupChat(ctx)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /hive ignored: not a group chat');
    }
    await ctx.reply('❌ The /hive command only works in group chats. Please add this bot to a group and make it an admin.');
    return;
  }

  const chatId = ctx.chat.id;
  if (!isChatAuthorized(chatId)) {
    if (VERBOSE) {
      console.log('[VERBOSE] /hive ignored: chat not authorized');
    }
    await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`);
    return;
  }

  if (VERBOSE) {
    console.log('[VERBOSE] /hive passed all checks, executing...');
  }

  const userArgs = parseCommandArgs(ctx.message.text);

  const validation = validateGitHubUrl(userArgs);
  if (!validation.valid) {
    await ctx.reply(`❌ ${validation.error}\n\nExample: \`/hive https://github.com/owner/repo --verbose\``, { parse_mode: 'Markdown' });
    return;
  }

  // Merge user args with overrides
  const args = mergeArgsWithOverrides(userArgs, hiveOverrides);

  // Validate merged arguments using hive's yargs config
  try {
    // Use .parse() instead of yargs(args).parseSync() to ensure .strict() mode works
    const testYargs = createHiveYargsConfig(yargs());
    testYargs.parse(args);
  } catch (error) {
    await ctx.reply(`❌ Invalid options: ${error.message || String(error)}\n\nUse /help to see available options`, { parse_mode: 'Markdown' });
    return;
  }

  const requester = buildUserMention({ user: ctx.from, parseMode: 'Markdown' });
  let statusMsg = `🚀 Starting hive command...\nRequested by: ${requester}\nURL: ${args[0]}\nOptions: ${args.slice(1).join(' ') || 'none'}`;
  if (hiveOverrides.length > 0) {
    statusMsg += `\n🔒 Locked options: ${hiveOverrides.join(' ')}`;
  }
  await ctx.reply(statusMsg, { parse_mode: 'Markdown' });

  const result = await executeStartScreen('hive', args);

  if (result.warning) {
    await ctx.reply(`⚠️  ${result.warning}`, { parse_mode: 'Markdown' });
    return;
  }

  if (result.success) {
    const sessionNameMatch = result.output.match(/session:\s*(\S+)/i) ||
                            result.output.match(/screen -r\s+(\S+)/);
    const sessionName = sessionNameMatch ? sessionNameMatch[1] : 'unknown';

    let response = '✅ Hive command started successfully!\n\n';
    response += `📊 *Session:* \`${sessionName}\`\n`;

    await ctx.reply(response, { parse_mode: 'Markdown' });
  } else {
    let response = '❌ Error executing hive command:\n\n';
    response += `\`\`\`\n${result.error || result.output}\n\`\`\``;
    await ctx.reply(response, { parse_mode: 'Markdown' });
  }
});

// Add message listener for verbose debugging
// This helps diagnose if bot is receiving messages at all
if (VERBOSE) {
  bot.on('message', (ctx, next) => {
    console.log('[VERBOSE] Message received:');
    console.log('[VERBOSE]   Chat ID:', ctx.chat?.id);
    console.log('[VERBOSE]   Chat type:', ctx.chat?.type);
    console.log('[VERBOSE]   Is forum:', ctx.chat?.is_forum);
    console.log('[VERBOSE]   Is topic message:', ctx.message?.is_topic_message);
    console.log('[VERBOSE]   Message thread ID:', ctx.message?.message_thread_id);
    console.log('[VERBOSE]   Message date:', ctx.message?.date);
    console.log('[VERBOSE]   Message text:', ctx.message?.text?.substring(0, 100));
    console.log('[VERBOSE]   From user:', ctx.from?.username || ctx.from?.id);
    console.log('[VERBOSE]   Bot start time:', BOT_START_TIME);
    console.log('[VERBOSE]   Is old message:', isOldMessage(ctx));

    // Detailed forwarding/reply detection debug info
    const msg = ctx.message;
    const isForwarded = isForwardedOrReply(ctx);
    console.log('[VERBOSE]   Is forwarded/reply:', isForwarded);
    if (msg) {
      // Log ALL message fields to diagnose what Telegram is actually sending
      console.log('[VERBOSE]   Full message object keys:', Object.keys(msg));
      console.log('[VERBOSE]     - forward_origin:', JSON.stringify(msg.forward_origin));
      console.log('[VERBOSE]     - forward_origin type:', typeof msg.forward_origin);
      console.log('[VERBOSE]     - forward_origin truthy?:', !!msg.forward_origin);
      console.log('[VERBOSE]     - forward_origin.type:', msg.forward_origin?.type);
      console.log('[VERBOSE]     - forward_from:', JSON.stringify(msg.forward_from));
      console.log('[VERBOSE]     - forward_from_chat:', JSON.stringify(msg.forward_from_chat));
      console.log('[VERBOSE]     - forward_date:', msg.forward_date);
      console.log('[VERBOSE]     - reply_to_message:', JSON.stringify(msg.reply_to_message));
      console.log('[VERBOSE]     - reply_to_message type:', typeof msg.reply_to_message);
      console.log('[VERBOSE]     - reply_to_message truthy?:', !!msg.reply_to_message);
      console.log('[VERBOSE]     - reply_to_message.message_id:', msg.reply_to_message?.message_id);
      console.log('[VERBOSE]     - reply_to_message.forum_topic_created:', JSON.stringify(msg.reply_to_message?.forum_topic_created));
    }

    console.log('[VERBOSE]   Is authorized:', isChatAuthorized(ctx.chat?.id));
    // Continue to next handler
    return next();
  });
}

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

// Track shutdown state to prevent startup messages after shutdown
let isShuttingDown = false;

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
if (VERBOSE) {
  console.log('[VERBOSE] Verbose logging enabled');
  console.log('[VERBOSE] Bot start time (Unix):', BOT_START_TIME);
  console.log('[VERBOSE] Bot start time (ISO):', new Date(BOT_START_TIME * 1000).toISOString());
}

// Delete any existing webhook before starting polling
// This is critical because a webhook prevents polling from working
// If the bot was previously configured with a webhook (or if one exists),
// we must delete it to allow polling mode to receive messages
if (VERBOSE) {
  console.log('[VERBOSE] Deleting webhook...');
}
bot.telegram.deleteWebhook({ drop_pending_updates: true })
  .then((result) => {
    if (VERBOSE) {
      console.log('[VERBOSE] Webhook deletion result:', result);
    }
    console.log('🔄 Webhook deleted (if existed), starting polling mode...');
    if (VERBOSE) {
      console.log('[VERBOSE] Launching bot with config:', {
        allowedUpdates: ['message'],
        dropPendingUpdates: true
      });
    }
    return bot.launch({
      // Only receive message updates (commands, text messages)
      // This ensures the bot receives all message types including commands
      allowedUpdates: ['message'],
      // Drop any pending updates that were sent before the bot started
      // This ensures we only process new messages sent after this bot instance started
      dropPendingUpdates: true
    });
  })
  .then(async () => {
    // Check if shutdown was initiated before printing success messages
    if (isShuttingDown) {
      return; // Skip success messages if shutting down
    }

    console.log('✅ SwarmMindBot is now running!');
    console.log('Press Ctrl+C to stop');
    if (VERBOSE) {
      console.log('[VERBOSE] Bot launched successfully');
      console.log('[VERBOSE] Polling is active, waiting for messages...');

      // Get bot info and webhook status for diagnostics
      try {
        const botInfo = await bot.telegram.getMe();
        const webhookInfo = await bot.telegram.getWebhookInfo();

        console.log('[VERBOSE] Bot info:');
        console.log('[VERBOSE]   Username: @' + botInfo.username);
        console.log('[VERBOSE]   Bot ID:', botInfo.id);
        console.log('[VERBOSE] Webhook info:');
        console.log('[VERBOSE]   URL:', webhookInfo.url || 'none (polling mode)');
        console.log('[VERBOSE]   Pending updates:', webhookInfo.pending_update_count);
        if (webhookInfo.last_error_date) {
          console.log('[VERBOSE]   Last error:', new Date(webhookInfo.last_error_date * 1000).toISOString());
          console.log('[VERBOSE]   Error message:', webhookInfo.last_error_message);
        }

        console.log('[VERBOSE]');
        console.log('[VERBOSE] ⚠️  IMPORTANT: If bot is not receiving messages in group chats:');
        console.log('[VERBOSE]   1. Privacy Mode: Check if bot has privacy mode enabled in @BotFather');
        console.log('[VERBOSE]      - Send /setprivacy to @BotFather');
        console.log('[VERBOSE]      - Select @' + botInfo.username);
        console.log('[VERBOSE]      - Choose "Disable" to receive all group messages');
        console.log('[VERBOSE]      - IMPORTANT: Remove bot from group and re-add after changing!');
        console.log('[VERBOSE]   2. Admin Status: Make bot an admin in the group (admins see all messages)');
        console.log('[VERBOSE]   3. Run diagnostic: node experiments/test-telegram-bot-privacy-mode.mjs');
        console.log('[VERBOSE]');
      } catch (err) {
        console.log('[VERBOSE] Could not fetch bot info:', err.message);
      }

      console.log('[VERBOSE] Send a message to the bot to test message reception');
    }
  })
  .catch((error) => {
    console.error('❌ Failed to start bot:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack?.split('\n').slice(0, 5).join('\n')
    });
    if (VERBOSE) {
      console.error('[VERBOSE] Full error:', error);
    }
    process.exit(1);
  });

process.once('SIGINT', () => {
  isShuttingDown = true;
  console.log('\n🛑 Received SIGINT (Ctrl+C), stopping bot...');
  if (VERBOSE) {
    console.log('[VERBOSE] Signal: SIGINT');
    console.log('[VERBOSE] Process ID:', process.pid);
    console.log('[VERBOSE] Parent Process ID:', process.ppid);
  }
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  isShuttingDown = true;
  console.log('\n🛑 Received SIGTERM, stopping bot...');
  if (VERBOSE) {
    console.log('[VERBOSE] Signal: SIGTERM');
    console.log('[VERBOSE] Process ID:', process.pid);
    console.log('[VERBOSE] Parent Process ID:', process.ppid);
    console.log('[VERBOSE] Possible causes:');
    console.log('[VERBOSE]   - System shutdown/restart');
    console.log('[VERBOSE]   - Process manager (systemd, pm2, etc.) stopping the service');
    console.log('[VERBOSE]   - Manual kill command: kill <pid>');
    console.log('[VERBOSE]   - Container orchestration (Docker, Kubernetes) stopping container');
    console.log('[VERBOSE]   - Out of memory (OOM) killer');
  }
  console.log('ℹ️  SIGTERM is typically sent by:');
  console.log('   - System shutdown/restart');
  console.log('   - Process manager stopping the service');
  console.log('   - Manual termination (kill command)');
  console.log('   - Container/orchestration platform');
  console.log('💡 Check system logs for more details: journalctl -u <service> or dmesg');
  bot.stop('SIGTERM');
});
