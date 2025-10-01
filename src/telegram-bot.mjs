#!/usr/bin/env node
// telegram-bot.mjs - Telegram bot for SwarmMindBot

import { Telegraf } from 'telegraf';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Get bot token from environment variable
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN environment variable is not set');
  console.error('Please set it with: export TELEGRAM_BOT_TOKEN=your_bot_token');
  process.exit(1);
}

// Create bot instance
const bot = new Telegraf(BOT_TOKEN);

// Allowed chat IDs (optional restriction)
// If TELEGRAM_ALLOWED_CHATS is set, only accept commands from these chat IDs
const allowedChatsEnv = process.env.TELEGRAM_ALLOWED_CHATS;
const allowedChats = allowedChatsEnv
  ? allowedChatsEnv.split(',').map(id => parseInt(id.trim(), 10))
  : null;

/**
 * Check if the chat is authorized
 * @param {number} chatId - The chat ID to check
 * @returns {boolean} Whether the chat is authorized
 */
function isChatAuthorized(chatId) {
  // If no allowed chats are configured, all chats are allowed
  if (!allowedChats) {
    return true;
  }
  return allowedChats.includes(chatId);
}

/**
 * Check if the message is from a group chat
 * @param {object} ctx - Telegraf context
 * @returns {boolean} Whether the message is from a group chat
 */
function isGroupChat(ctx) {
  const chatType = ctx.chat?.type;
  return chatType === 'group' || chatType === 'supergroup';
}

/**
 * Execute a command using start-screen
 * @param {string} command - Either 'solve' or 'hive'
 * @param {string[]} args - Command arguments
 * @returns {Promise<{success: boolean, output: string, error?: string}>}
 */
async function executeStartScreen(command, args) {
  try {
    // Build the full command
    // Quote arguments to preserve spaces and special characters
    const quotedArgs = args.map(arg => {
      // If arg contains spaces or special chars, wrap in single quotes
      if (arg.includes(' ') || arg.includes('&') || arg.includes('|') ||
          arg.includes(';') || arg.includes('$') || arg.includes('*') ||
          arg.includes('?') || arg.includes('(') || arg.includes(')')) {
        // Escape single quotes within the argument
        return `'${arg.replace(/'/g, "'\\''")}'`;
      }
      return arg;
    }).join(' ');

    const fullCommand = `start-screen ${command} ${quotedArgs}`;

    console.log(`Executing: ${fullCommand}`);

    const { stdout, stderr } = await execAsync(fullCommand);

    return {
      success: true,
      output: stdout + (stderr ? `\n${stderr}` : '')
    };
  } catch (error) {
    console.error('Error executing start-screen:', error);
    return {
      success: false,
      output: error.stdout || '',
      error: error.stderr || error.message
    };
  }
}

/**
 * Parse command arguments from message text
 * @param {string} text - Message text
 * @returns {string[]} Array of arguments
 */
function parseCommandArgs(text) {
  // Remove the command part (e.g., "/solve ")
  const argsText = text.replace(/^\/\w+\s*/, '');

  if (!argsText.trim()) {
    return [];
  }

  // Simple argument parsing - split by spaces but preserve quoted strings
  const args = [];
  let currentArg = '';
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < argsText.length; i++) {
    const char = argsText[i];

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

/**
 * Validate that the first argument is a GitHub URL
 * @param {string[]} args - Command arguments
 * @returns {{valid: boolean, error?: string}}
 */
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

// /help command - works in both private and group chats
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
  message += `*/solve* - Solve a GitHub issue\n`;
  message += `Usage: \`/solve <github-url> [options]\`\n`;
  message += `Example: \`/solve https://github.com/owner/repo/issues/123 --verbose\`\n\n`;
  message += `*/hive* - Run hive command\n`;
  message += `Usage: \`/hive <github-url> [options]\`\n`;
  message += `Example: \`/hive https://github.com/owner/repo --model sonnet\`\n\n`;
  message += `*/help* - Show this help message\n\n`;
  message += `⚠️ *Note:* /solve and /hive commands only work in group chats.\n\n`;
  message += `🔧 *Available Options:*\n`;
  message += `• \`--fork\` - Fork the repository\n`;
  message += `• \`--auto-continue\` - Auto-continue on feedback\n`;
  message += `• \`--attach-logs\` - Attach logs to PR\n`;
  message += `• \`--verbose\` - Verbose output\n`;
  message += `• \`--model <model>\` - Specify AI model (sonnet/opus/haiku)\n`;
  message += `• \`--think <level>\` - Thinking level (max/medium/min)\n`;

  if (allowedChats) {
    message += `\n🔒 *Restricted Mode:* This bot only accepts commands from authorized chats.\n`;
    message += `Authorized: ${isChatAuthorized(chatId) ? '✅ Yes' : '❌ No'}`;
  }

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

// /solve command - only works in group chats
bot.command('solve', async (ctx) => {
  // Check if in group chat
  if (!isGroupChat(ctx)) {
    await ctx.reply('❌ The /solve command only works in group chats. Please add this bot to a group and make it an admin.');
    return;
  }

  // Check if chat is authorized
  const chatId = ctx.chat.id;
  if (!isChatAuthorized(chatId)) {
    await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`);
    return;
  }

  // Parse arguments
  const args = parseCommandArgs(ctx.message.text);

  // Validate GitHub URL
  const validation = validateGitHubUrl(args);
  if (!validation.valid) {
    await ctx.reply(`❌ ${validation.error}\n\nExample: \`/solve https://github.com/owner/repo/issues/123 --verbose\``, { parse_mode: 'Markdown' });
    return;
  }

  // Send initial message
  await ctx.reply(`🚀 Starting solve command...\nURL: ${args[0]}\nOptions: ${args.slice(1).join(' ') || 'none'}`);

  // Execute the command
  const result = await executeStartScreen('solve', args);

  if (result.success) {
    // Parse the output to extract session name
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

// /hive command - only works in group chats
bot.command('hive', async (ctx) => {
  // Check if in group chat
  if (!isGroupChat(ctx)) {
    await ctx.reply('❌ The /hive command only works in group chats. Please add this bot to a group and make it an admin.');
    return;
  }

  // Check if chat is authorized
  const chatId = ctx.chat.id;
  if (!isChatAuthorized(chatId)) {
    await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`);
    return;
  }

  // Parse arguments
  const args = parseCommandArgs(ctx.message.text);

  // Validate GitHub URL
  const validation = validateGitHubUrl(args);
  if (!validation.valid) {
    await ctx.reply(`❌ ${validation.error}\n\nExample: \`/hive https://github.com/owner/repo --verbose\``, { parse_mode: 'Markdown' });
    return;
  }

  // Send initial message
  await ctx.reply(`🚀 Starting hive command...\nURL: ${args[0]}\nOptions: ${args.slice(1).join(' ') || 'none'}`);

  // Execute the command
  const result = await executeStartScreen('hive', args);

  if (result.success) {
    // Parse the output to extract session name
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

// Start the bot
console.log('🤖 SwarmMindBot is starting...');
console.log('Bot token:', BOT_TOKEN.substring(0, 10) + '...');
if (allowedChats) {
  console.log('Allowed chats:', allowedChats.join(', '));
} else {
  console.log('Allowed chats: All (no restrictions)');
}

bot.launch()
  .then(() => {
    console.log('✅ SwarmMindBot is now running!');
    console.log('Press Ctrl+C to stop');
  })
  .catch((error) => {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  });

// Enable graceful stop
process.once('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, stopping bot...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, stopping bot...');
  bot.stop('SIGTERM');
});
