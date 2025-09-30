#!/usr/bin/env node
// start-screen.mjs - Launch solve or hive commands in GNU screen sessions

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Inline parseGitHubUrl function to avoid use-m dependency issues
function parseGitHubUrl(url) {
  if (!url || typeof url !== 'string') {
    return {
      valid: false,
      error: 'Invalid input: URL must be a non-empty string'
    };
  }

  // Trim whitespace and remove trailing slashes
  let normalizedUrl = url.trim().replace(/\/+$/, '');

  // Check if this looks like a valid GitHub-related input
  if (/\s/.test(normalizedUrl) || /^[!@#$%^&*()[\]{}|\\:;"'<>,?`~]/.test(normalizedUrl)) {
    return {
      valid: false,
      error: 'Invalid GitHub URL format'
    };
  }

  // Handle protocol normalization
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    if (normalizedUrl.startsWith('github.com/')) {
      normalizedUrl = 'https://' + normalizedUrl;
    } else if (!normalizedUrl.includes('github.com')) {
      normalizedUrl = 'https://github.com/' + normalizedUrl;
    } else {
      return {
        valid: false,
        error: 'Invalid GitHub URL format'
      };
    }
  }

  // Convert http to https
  if (normalizedUrl.startsWith('http://')) {
    normalizedUrl = normalizedUrl.replace(/^http:\/\//, 'https://');
  }

  // Parse the URL
  let urlObj;
  try {
    urlObj = new URL(normalizedUrl);
  } catch (e) {
    return {
      valid: false,
      error: 'Invalid URL format: ' + e.message
    };
  }

  // Must be github.com
  if (urlObj.hostname !== 'github.com' && urlObj.hostname !== 'www.github.com') {
    return {
      valid: false,
      error: 'Not a GitHub URL'
    };
  }

  // Parse the path
  const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);

  if (pathParts.length === 0) {
    return {
      valid: false,
      error: 'Invalid GitHub URL: missing owner/repo'
    };
  }

  const result = {
    valid: true,
    normalized: normalizedUrl,
    hostname: urlObj.hostname,
    owner: pathParts[0] || null,
    repo: pathParts[1] || null,
    type: 'unknown',
    path: pathParts.slice(2).join('/'),
    number: null
  };

  // Determine the type based on path structure
  if (pathParts.length === 1) {
    result.type = 'owner';
  } else if (pathParts.length === 2) {
    result.type = 'repo';
  } else if (pathParts.length >= 4) {
    const thirdPart = pathParts[2];
    const fourthPart = pathParts[3];

    if (thirdPart === 'issues' && /^\d+$/.test(fourthPart)) {
      result.type = 'issue';
      result.number = parseInt(fourthPart, 10);
    } else if (thirdPart === 'pull' && /^\d+$/.test(fourthPart)) {
      result.type = 'pull';
      result.number = parseInt(fourthPart, 10);
    }
  }

  return result;
}

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

// Find the GitHub URL in the arguments (but keep all arguments)
let githubUrl = null;
const commandArgs = args.slice(1); // Keep all arguments after the command

// Search for GitHub URL in all arguments
for (const arg of commandArgs) {
  // Check if argument looks like a GitHub URL
  if (arg.includes('github.com')) {
    githubUrl = arg;
    break; // Use the first GitHub URL found
  }
}

if (!githubUrl) {
  console.error('Error: GitHub URL is required');
  console.error('\nUsage: start-screen <command> <github-url> [options]');
  console.error('Note: The GitHub URL can appear anywhere in the arguments');
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
    const { stdout } = await execAsync(`screen -ls ${sessionName}`);
    return stdout.includes(sessionName);
  } catch (error) {
    // screen -ls returns non-zero exit code when no sessions found
    return false;
  }
}

// Build the full command to execute (pass all arguments as-is)
const fullCommand = [command, ...commandArgs].join(' ');

try {
  const sessionExists = await screenSessionExists(screenName);

  if (sessionExists) {
    console.log(`Screen session already exists: ${screenName}`);
    console.log(`Sending command to existing session: ${fullCommand}`);

    // Send command to existing screen session without attaching
    // Using screen -X to send commands to a named session
    await execAsync(`screen -S ${screenName} -X stuff "${fullCommand}\n"`);

    console.log(`Command sent to screen session: ${screenName}`);
    console.log(`To attach to this session, run: screen -r ${screenName}`);
  } else {
    console.log(`Creating new detached screen session: ${screenName}`);
    console.log(`Command: ${fullCommand}`);

    // Create new screen session and run command in detached mode
    // Using exec instead of spawn to ensure we don't inherit stdio
    await execAsync(`screen -S ${screenName} -d -m bash -c '${fullCommand}'`);

    console.log(`Screen session created and running in background: ${screenName}`);
    console.log(`To attach to this session, run: screen -r ${screenName}`);
  }

  // Exit successfully
  process.exit(0);
} catch (error) {
  console.error(`Error managing screen session: ${error.message}`);
  console.error('\nMake sure GNU screen is installed:');
  console.error('  Ubuntu/Debian: sudo apt-get install screen');
  console.error('  macOS: brew install screen');
  console.error('  Other: Check your package manager for "screen"');
  process.exit(1);
}