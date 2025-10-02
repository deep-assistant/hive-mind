#!/usr/bin/env node

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');

const { lino } = await import('./lino.lib.mjs');

const dotenvxModule = await use('@dotenvx/dotenvx');
const dotenvx = dotenvxModule.default || dotenvxModule;

dotenvx.config({ quiet: true });

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

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
  .help('h')
  .alias('h', 'help')
  .parse();

const BOT_TOKEN = argv.token || process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN environment variable or --token option is not set');
  console.error('Please set it with: export TELEGRAM_BOT_TOKEN=your_bot_token');
  console.error('Or use: hive-telegram-bot --token your_bot_token');
  process.exit(1);
}

const telegrafModule = await use('telegraf');
const { Telegraf } = telegrafModule;

const bot = new Telegraf(BOT_TOKEN);

const allowedChatsInput = argv.allowedChats || argv['allowed-chats'] || process.env.TELEGRAM_ALLOWED_CHATS;
const allowedChats = allowedChatsInput
  ? lino.parseNumericIds(allowedChatsInput)
  : null;

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

async function executeStartScreen(command, args) {
  try {
    const quotedArgs = args.map(arg => {
      if (arg.includes(' ') || arg.includes('&') || arg.includes('|') ||
          arg.includes(';') || arg.includes('$') || arg.includes('*') ||
          arg.includes('?') || arg.includes('(') || arg.includes(')')) {
        return `'${arg.replace(/'/g, "'\\''")}'`;
      }
      return arg;
    }).join(' ');

    const fullCommand = `start-screen ${command} ${quotedArgs}`;

    console.log(`Executing: ${fullCommand}`);

    const commandResult = await $`${fullCommand}`;

    if (commandResult.code === 0) {
      return {
        success: true,
        output: commandResult.stdout.toString()
      };
    } else {
      return {
        success: false,
        output: commandResult.stdout.toString(),
        error: commandResult.stderr.toString()
      };
    }
  } catch (error) {
    console.error('Error executing start-screen:', error);
    return {
      success: false,
      output: error.stdout ? error.stdout.toString() : '',
      error: error.stderr ? error.stderr.toString() : error.message
    };
  }
}

function parseCommandArgs(text) {
  const argsText = text.replace(/^\/\w+\s*/, '');

  if (!argsText.trim()) {
    return [];
  }

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

bot.command('solve', async (ctx) => {
  if (!isGroupChat(ctx)) {
    await ctx.reply('❌ The /solve command only works in group chats. Please add this bot to a group and make it an admin.', { reply_to_message_id: ctx.message.message_id });
    return;
  }

  const chatId = ctx.chat.id;
  if (!isChatAuthorized(chatId)) {
    await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`, { reply_to_message_id: ctx.message.message_id });
    return;
  }

  const args = parseCommandArgs(ctx.message.text);

  const validation = validateGitHubUrl(args);
  if (!validation.valid) {
    await ctx.reply(`❌ ${validation.error}\n\nExample: \`/solve https://github.com/owner/repo/issues/123 --verbose\``, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
    return;
  }

  await ctx.reply(`🚀 Starting solve command...\nURL: ${args[0]}\nOptions: ${args.slice(1).join(' ') || 'none'}`, { reply_to_message_id: ctx.message.message_id });

  const result = await executeStartScreen('solve', args);

  if (result.success) {
    const sessionNameMatch = result.output.match(/session:\s*(\S+)/i) ||
                            result.output.match(/screen -r\s+(\S+)/);
    const sessionName = sessionNameMatch ? sessionNameMatch[1] : 'unknown';

    let response = `✅ Solve command started successfully!\n\n`;
    response += `📊 *Session:* \`${sessionName}\`\n\n`;
    response += `📝 To attach to the session:\n\`\`\`\nscreen -r ${sessionName}\n\`\`\`\n\n`;
    response += `Output:\n\`\`\`\n${result.output.trim()}\n\`\`\``;

    await ctx.reply(response, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  } else {
    let response = `❌ Error executing solve command:\n\n`;
    response += `\`\`\`\n${result.error || result.output}\n\`\`\``;
    await ctx.reply(response, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  }
});

bot.command('hive', async (ctx) => {
  if (!isGroupChat(ctx)) {
    await ctx.reply('❌ The /hive command only works in group chats. Please add this bot to a group and make it an admin.', { reply_to_message_id: ctx.message.message_id });
    return;
  }

  const chatId = ctx.chat.id;
  if (!isChatAuthorized(chatId)) {
    await ctx.reply(`❌ This chat (ID: ${chatId}) is not authorized to use this bot. Please contact the bot administrator.`, { reply_to_message_id: ctx.message.message_id });
    return;
  }

  const args = parseCommandArgs(ctx.message.text);

  const validation = validateGitHubUrl(args);
  if (!validation.valid) {
    await ctx.reply(`❌ ${validation.error}\n\nExample: \`/hive https://github.com/owner/repo --verbose\``, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
    return;
  }

  await ctx.reply(`🚀 Starting hive command...\nURL: ${args[0]}\nOptions: ${args.slice(1).join(' ') || 'none'}`, { reply_to_message_id: ctx.message.message_id });

  const result = await executeStartScreen('hive', args);

  if (result.success) {
    const sessionNameMatch = result.output.match(/session:\s*(\S+)/i) ||
                            result.output.match(/screen -r\s+(\S+)/);
    const sessionName = sessionNameMatch ? sessionNameMatch[1] : 'unknown';

    let response = `✅ Hive command started successfully!\n\n`;
    response += `📊 *Session:* \`${sessionName}\`\n\n`;
    response += `📝 To attach to the session:\n\`\`\`\nscreen -r ${sessionName}\n\`\`\`\n\n`;
    response += `Output:\n\`\`\`\n${result.output.trim()}\n\`\`\``;

    await ctx.reply(response, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  } else {
    let response = `❌ Error executing hive command:\n\n`;
    response += `\`\`\`\n${result.error || result.output}\n\`\`\``;
    await ctx.reply(response, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  }
});

console.log('🤖 SwarmMindBot is starting...');
console.log('Bot token:', BOT_TOKEN.substring(0, 10) + '...');
if (allowedChats && allowedChats.length > 0) {
  console.log('Allowed chats (lino):', lino.format(allowedChats));
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

process.once('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, stopping bot...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, stopping bot...');
  bot.stop('SIGTERM');
});
