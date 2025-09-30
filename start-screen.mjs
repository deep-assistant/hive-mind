#!/usr/bin/env node
// start-screen.mjs - Launch solve or hive commands in GNU screen sessions

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');
const path = (await use('path')).default;
const { spawn } = await use('child_process');

// Import GitHub URL parsing utility
import { parseGitHubUrl } from './src/github.lib.mjs';

// Get command line arguments
const args = process.argv.slice(2);

// Check if any arguments provided
if (args.length === 0) {
  console.error('Usage: start-screen <command> <github-url> [options]');
  console.error('\nSupported commands:');
  console.error('  solve - Launch solve command in a screen session');
  console.error('  hive  - Launch hive command in a screen session');
  console.error('\nExamples:');
  console.error('  start-screen solve https://github.com/veb86/zcadvelecAI/issues/2 --dry-run');
  console.error('  start-screen hive https://github.com/veb86/zcadvelecAI --dry-run');
  process.exit(1);
}

// Parse command and arguments
const command = args[0].toLowerCase();
const supportedCommands = ['solve', 'hive'];

if (!supportedCommands.includes(command)) {
  console.error(`Error: Command '${command}' is not supported.`);
  console.error('Supported commands: solve, hive');
  process.exit(1);
}

// Find the GitHub URL in the arguments
let githubUrl = null;
let commandArgs = [];

for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  // Check if argument looks like a GitHub URL
  if (arg.includes('github.com') || (githubUrl === null && !arg.startsWith('--'))) {
    githubUrl = arg;
  } else {
    commandArgs.push(arg);
  }
}

if (!githubUrl) {
  console.error('Error: GitHub URL is required');
  console.error('\nUsage: start-screen <command> <github-url> [options]');
  process.exit(1);
}

// Parse GitHub URL to extract repository information
const parsedUrl = parseGitHubUrl(githubUrl);

if (!parsedUrl.valid) {
  console.error(`Error: Invalid GitHub URL - ${parsedUrl.error || 'Unknown error'}`);
  process.exit(1);
}

// Build screen session name based on command and repository info
let screenName = command;

if (parsedUrl.owner) {
  // Replace special characters in owner name that might cause issues with screen
  const safeOwner = parsedUrl.owner.replace(/[^a-zA-Z0-9-_]/g, '-');
  screenName += `-${safeOwner}`;
}

if (parsedUrl.repo) {
  // Replace special characters in repo name
  const safeRepo = parsedUrl.repo.replace(/[^a-zA-Z0-9-_]/g, '-');
  screenName += `-${safeRepo}`;
}

if (parsedUrl.type === 'issue' && parsedUrl.number) {
  screenName += `-${parsedUrl.number}`;
}

// Truncate screen name if too long (screen has a limit)
if (screenName.length > 100) {
  screenName = screenName.substring(0, 100);
}

console.log(`Screen session name: ${screenName}`);

// Check if screen session already exists
async function screenSessionExists(sessionName) {
  try {
    const result = await $`screen -ls ${sessionName}`;
    return result.stdout.includes(sessionName);
  } catch (error) {
    // screen -ls returns non-zero exit code when no sessions found
    return false;
  }
}

// Build the full command to execute
const fullCommand = [command, githubUrl, ...commandArgs].join(' ');

try {
  const sessionExists = await screenSessionExists(screenName);

  if (sessionExists) {
    console.log(`Attaching to existing screen session: ${screenName}`);
    console.log(`Command: ${fullCommand}`);

    // Attach to existing screen session
    spawn('screen', ['-r', screenName], {
      stdio: 'inherit',
      shell: true
    });
  } else {
    console.log(`Creating new screen session: ${screenName}`);
    console.log(`Command: ${fullCommand}`);

    // Create new screen session and run command
    // Use -d -m to start detached, then we'll attach
    const screenArgs = [
      '-S', screenName,
      '-d', '-m',
      'bash', '-c', fullCommand
    ];

    // Start the screen session
    await $`screen ${screenArgs}`;

    // Small delay to ensure screen session is created
    await new Promise(resolve => setTimeout(resolve, 500));

    // Now attach to the created session
    spawn('screen', ['-r', screenName], {
      stdio: 'inherit',
      shell: true
    });
  }
} catch (error) {
  console.error(`Error managing screen session: ${error.message}`);
  console.error('\nMake sure GNU screen is installed:');
  console.error('  Ubuntu/Debian: sudo apt-get install screen');
  console.error('  macOS: brew install screen');
  console.error('  Other: Check your package manager for "screen"');
  process.exit(1);
}