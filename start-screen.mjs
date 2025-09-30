#!/usr/bin/env node
// start-screen.mjs - Launch solve or hive commands in GNU screen sessions

import { exec } from 'child_process';
import { promisify } from 'util';
import { use } from 'use-m';

const execAsync = promisify(exec);

// Dynamically load parse-github-url using use-m
const parseGitHubUrlModule = await use('parse-github-url@1.0.3');
const parseGitHubUrlLib = parseGitHubUrlModule.default || parseGitHubUrlModule;

// Wrapper function to match our expected interface using parse-github-url from npm via use-m
function parseGitHubUrl(url) {
  if (!url || typeof url !== 'string') {
    return {
      valid: false,
      error: 'Invalid input: URL must be a non-empty string'
    };
  }

  try {
    // Use parse-github-url library loaded via use-m
    const parsed = parseGitHubUrlLib(url);

    if (!parsed || !parsed.owner || !parsed.name) {
      return {
        valid: false,
        error: 'Invalid GitHub URL: missing owner/repo'
      };
    }

    const result = {
      valid: true,
      normalized: parsed.href || url,
      hostname: parsed.host || 'github.com',
      owner: parsed.owner,
      repo: parsed.name,
      type: 'unknown',
      path: parsed.filepath || '',
      number: null
    };

    // Determine the type based on path structure
    if (parsed.filepath) {
      const pathParts = parsed.filepath.split('/');

      if (pathParts[0] === 'issues' && /^\d+$/.test(pathParts[1])) {
        result.type = 'issue';
        result.number = parseInt(pathParts[1], 10);
      } else if (pathParts[0] === 'pull' && /^\d+$/.test(pathParts[1])) {
        result.type = 'pr';
        result.number = parseInt(pathParts[1], 10);
      }
    } else if (parsed.owner && parsed.name) {
      result.type = 'repo';
    } else if (parsed.owner) {
      result.type = 'owner';
    }

    return result;
  } catch (error) {
    return {
      valid: false,
      error: 'Invalid GitHub URL format: ' + error.message
    };
  }
}

/**
 * Generate a screen session name based on the command and GitHub URL
 * @param {string} command - Either 'solve' or 'hive'
 * @param {string} githubUrl - GitHub repository or issue URL
 * @returns {string} The generated screen session name
 */
function generateScreenName(command, githubUrl) {
  const parsed = parseGitHubUrl(githubUrl);

  if (!parsed.valid) {
    // Fallback to simple naming if parsing fails
    const sanitized = githubUrl.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 30);
    return `${command}-${sanitized}`;
  }

  // Build name parts
  const parts = [command];

  if (parsed.owner) {
    parts.push(parsed.owner);
  }

  if (parsed.repo) {
    parts.push(parsed.repo);
  }

  if (parsed.number) {
    parts.push(parsed.number);
  }

  return parts.join('-');
}

/**
 * Check if a screen session exists
 * @param {string} sessionName - The name of the screen session
 * @returns {Promise<boolean>} Whether the session exists
 */
async function screenSessionExists(sessionName) {
  try {
    const { stdout } = await execAsync('screen -ls');
    return stdout.includes(sessionName);
  } catch (error) {
    // screen -ls returns non-zero exit code when no sessions exist
    return false;
  }
}

/**
 * Create or enter a screen session with the given command
 * @param {string} sessionName - The name of the screen session
 * @param {string} command - The command to run ('solve' or 'hive')
 * @param {string[]} args - Arguments to pass to the command
 */
async function createOrEnterScreen(sessionName, command, args) {
  const sessionExists = await screenSessionExists(sessionName);

  if (sessionExists) {
    console.log(`Screen session '${sessionName}' already exists.`);
    console.log('Creating new detached session with the command...');
  } else {
    console.log(`Creating screen session: ${sessionName}`);
  }

  // Always create a detached session with the command
  // Quote arguments properly to preserve spaces and special characters
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

  const screenCommand = `screen -dmS ${sessionName} ${command} ${quotedArgs}`;

  try {
    await execAsync(screenCommand);
    console.log(`Started ${command} in detached screen session: ${sessionName}`);
    console.log(`To attach to this session, run: screen -r ${sessionName}`);
  } catch (error) {
    console.error('Failed to create screen session:', error.message);
    process.exit(1);
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: start-screen <solve|hive> <github-url> [additional-args...]');
    console.error('Examples:');
    console.error('  start-screen solve https://github.com/user/repo/issues/123 --dry-run');
    console.error('  start-screen hive https://github.com/user/repo --flag value');
    process.exit(1);
  }

  const command = args[0];
  const githubUrl = args[1];
  const additionalArgs = args.slice(2);

  // Validate command
  if (command !== 'solve' && command !== 'hive') {
    console.error(`Error: Invalid command '${command}'. Must be 'solve' or 'hive'.`);
    process.exit(1);
  }

  // Validate GitHub URL
  const parsed = parseGitHubUrl(githubUrl);
  if (!parsed.valid) {
    console.error(`Error: Invalid GitHub URL. ${parsed.error}`);
    console.error('Please provide a valid GitHub repository or issue URL.');
    process.exit(1);
  }

  // Generate screen session name
  const sessionName = generateScreenName(command, githubUrl);

  // Check for screen availability
  try {
    await execAsync('which screen');
  } catch (error) {
    console.error('Error: GNU Screen is not installed or not in PATH.');
    console.error('Please install it using your package manager:');
    console.error('  Ubuntu/Debian: sudo apt-get install screen');
    console.error('  macOS: brew install screen');
    console.error('  RHEL/CentOS: sudo yum install screen');
    process.exit(1);
  }

  // Prepare full argument list for the command
  const fullArgs = [githubUrl, ...additionalArgs];

  // Create or enter the screen session
  await createOrEnterScreen(sessionName, command, fullArgs);
}

// Run the main function
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});