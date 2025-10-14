#!/usr/bin/env node
// start-screen.mjs - Launch solve or hive commands in GNU screen sessions

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Load use-m dynamically from unpkg (same pattern as solve.mjs and github.lib.mjs)
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

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

    // Determine the type based on branch and filepath
    // Note: parse-github-url treats "issues" as a branch, not part of filepath
    if (parsed.branch === 'issues' && parsed.filepath && /^\d+$/.test(parsed.filepath)) {
      result.type = 'issue';
      result.number = parseInt(parsed.filepath, 10);
    } else if (parsed.branch === 'pull' && parsed.filepath && /^\d+$/.test(parsed.filepath)) {
      result.type = 'pr';
      result.number = parseInt(parsed.filepath, 10);
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
 * Wait for a screen session to be ready to accept commands
 * A session is considered ready when it can execute a test command
 * @param {string} sessionName - The name of the screen session
 * @param {number} maxWaitSeconds - Maximum time to wait in seconds (default: 5)
 * @returns {Promise<boolean>} Whether the session became ready
 */
async function waitForSessionReady(sessionName, maxWaitSeconds = 5) {
  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;

  // Use a unique marker file for this check to avoid conflicts
  const markerFile = `/tmp/screen-ready-${sessionName}-${Date.now()}.marker`;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Send a test command that creates a marker file
      // This command will only execute when the session is actually ready at a prompt
      await execAsync(`screen -S ${sessionName} -X stuff "touch ${markerFile} 2>/dev/null\n"`);

      // Wait for the marker file to appear
      const checkStartTime = Date.now();
      const checkTimeout = 1000; // 1 second to check if marker appears

      while (Date.now() - checkStartTime < checkTimeout) {
        try {
          const { code } = await execAsync(`test -f ${markerFile}`);
          if (code === 0) {
            // Marker file exists, session is ready!
            // Clean up the marker file
            await execAsync(`rm -f ${markerFile}`).catch(() => { });
            return true;
          }
        } catch (error) {
          // Marker file doesn't exist yet
        }

        // Wait before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Marker file didn't appear, session is still busy
      // Clean up any leftover marker file from the queued command
      await execAsync(`rm -f ${markerFile}`).catch(() => { });
    } catch (error) {
      // Error sending test command or checking marker
    }

    // Wait before trying again
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Timeout reached, session is not ready
  return false;
}

/**
 * Create a new system user for isolation
 * @param {string} username - The username to create
 * @returns {Promise<boolean>} Whether the user was created successfully
 */
async function createIsolatedUser(username) {
  try {
    // Check if user already exists
    try {
      await execAsync(`id ${username}`);
      console.log(`User '${username}' already exists.`);
      return true;
    } catch (error) {
      // User doesn't exist, create it
    }

    // Create user without home directory and without login shell
    // This is a system user for isolation purposes only
    console.log(`Creating isolated user: ${username}...`);
    await execAsync(`sudo useradd -r -M -s /usr/sbin/nologin ${username}`);
    console.log(`✅ User '${username}' created successfully.`);
    return true;
  } catch (error) {
    console.error(`Failed to create user '${username}':`, error.message);
    return false;
  }
}

/**
 * Create or enter a screen session with the given command
 * @param {string} sessionName - The name of the screen session
 * @param {string} command - The command to run ('solve' or 'hive')
 * @param {string[]} args - Arguments to pass to the command
 * @param {boolean} autoTerminate - If true, session terminates after command completes
 * @param {string} isolationLevel - The isolation level ('same-user-screen' or 'separate-user-screen')
 */
async function createOrEnterScreen(sessionName, command, args, autoTerminate = false, isolationLevel = 'same-user-screen') {
  const sessionExists = await screenSessionExists(sessionName);

  if (sessionExists) {
    console.log(`Screen session '${sessionName}' already exists.`);
    console.log(`Checking if session is ready to accept commands...`);

    // Wait for the session to be ready (at a prompt)
    const isReady = await waitForSessionReady(sessionName);

    if (isReady) {
      console.log(`Session is ready.`);
    } else {
      console.log(`Session might still be running a command. Will attempt to send command anyway.`);
      console.log(`Note: The command will execute once the current operation completes.`);
    }

    console.log(`Sending command to existing session...`);

    // Build the full command to send to the existing session
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

    const fullCommand = `${command} ${quotedArgs}`;

    // Escape the command for screen's stuff command
    // We need to escape special characters for the shell
    const escapedCommand = fullCommand.replace(/'/g, "'\\''");

    try {
      // Send the command to the existing screen session
      // The \n at the end simulates pressing Enter
      await execAsync(`screen -S ${sessionName} -X stuff '${escapedCommand}\n'`);
      console.log(`Command sent to session '${sessionName}' successfully.`);
      console.log(`To attach and view the session, run: screen -r ${sessionName}`);
    } catch (error) {
      console.error('Failed to send command to existing screen session:', error.message);
      console.error('You may need to terminate the old session and try again.');
      process.exit(1);
    }
    return;
  }

  console.log(`Creating screen session: ${sessionName}`);

  // Handle separate-user-screen isolation level
  let isolatedUser = null;
  if (isolationLevel === 'separate-user-screen') {
    // Generate a unique username based on the session name
    // Use a prefix to identify these as isolation users
    isolatedUser = `iso-${sessionName}`.substring(0, 32); // Linux username max length is 32

    console.log(`Isolation level: separate-user-screen`);
    console.log(`Creating isolated user: ${isolatedUser}...`);

    const userCreated = await createIsolatedUser(isolatedUser);
    if (!userCreated) {
      console.error('Failed to create isolated user. Cannot proceed with separate-user-screen mode.');
      console.error('Note: This mode requires sudo access to create users.');
      process.exit(1);
    }
  }

  // Create a detached session with the command
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

  let screenCommand;
  if (autoTerminate) {
    // Old behavior: session terminates after command completes
    const fullCommand = `${command} ${quotedArgs}`;
    if (isolatedUser) {
      screenCommand = `sudo -u ${isolatedUser} screen -dmS ${sessionName} ${fullCommand}`;
    } else {
      screenCommand = `screen -dmS ${sessionName} ${fullCommand}`;
    }
  } else {
    // New behavior: wrap the command in a bash shell that will stay alive after the command finishes
    // This allows the user to reattach to the screen session after the command completes
    const fullCommand = `${command} ${quotedArgs}`;
    const escapedCommand = fullCommand.replace(/'/g, "'\\''");
    if (isolatedUser) {
      screenCommand = `sudo -u ${isolatedUser} screen -dmS ${sessionName} bash -c '${escapedCommand}; exec bash'`;
    } else {
      screenCommand = `screen -dmS ${sessionName} bash -c '${escapedCommand}; exec bash'`;
    }
  }

  try {
    await execAsync(screenCommand);
    console.log(`Started ${command} in detached screen session: ${sessionName}`);
    if (isolatedUser) {
      console.log(`Isolation: Running as user '${isolatedUser}' (separate-user-screen mode)`);
    }
    if (autoTerminate) {
      console.log(`Note: Session will terminate after command completes (--auto-terminate mode)`);
    } else {
      console.log(`Session will remain active after command completes`);
    }
    if (isolatedUser) {
      console.log(`To attach to this session, run: sudo -u ${isolatedUser} screen -r ${sessionName}`);
    } else {
      console.log(`To attach to this session, run: screen -r ${sessionName}`);
    }
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
    console.error('Usage: start-screen [--auto-terminate] [--isolation-level <level>] <solve|hive> <github-url> [additional-args...]');
    console.error('');
    console.error('Options:');
    console.error('  --auto-terminate           Session terminates after command completes (old behavior)');
    console.error('                             By default, session stays alive for review and reattachment');
    console.error('  --isolation-level <level>  Isolation level for the screen session:');
    console.error('                             - same-user-screen: Run in current user context (default)');
    console.error('                             - separate-user-screen: Create separate user for each issue');
    console.error('');
    console.error('Examples:');
    console.error('  start-screen solve https://github.com/user/repo/issues/123 --dry-run');
    console.error('  start-screen --auto-terminate solve https://github.com/user/repo/issues/456');
    console.error('  start-screen --isolation-level separate-user-screen solve https://github.com/user/repo/issues/789');
    console.error('  start-screen hive https://github.com/user/repo --flag value');
    process.exit(1);
  }

  // Parse options at the beginning
  let autoTerminate = false;
  let isolationLevel = 'same-user-screen'; // default
  let argsOffset = 0;

  // Parse options
  while (argsOffset < args.length && args[argsOffset].startsWith('-')) {
    const currentArg = args[argsOffset];

    // Check for various dash characters (em-dash \u2014, en-dash \u2013, etc.)
    if (/^[\u2010\u2011\u2012\u2013\u2014]/.test(currentArg)) {
      console.error(`Unknown option: ${currentArg}`);
      console.error('Usage: start-screen [--auto-terminate] [--isolation-level <level>] <solve|hive> <github-url> [additional-args...]');
      console.error('Note: Use regular hyphens (--) not em-dashes or en-dashes.');
      process.exit(1);
    }

    if (currentArg === '--auto-terminate') {
      autoTerminate = true;
      argsOffset += 1;
    } else if (currentArg === '--isolation-level') {
      if (argsOffset + 1 >= args.length) {
        console.error('Error: --isolation-level requires a value');
        console.error('Valid values: same-user-screen, separate-user-screen');
        process.exit(1);
      }
      isolationLevel = args[argsOffset + 1];
      if (isolationLevel !== 'same-user-screen' && isolationLevel !== 'separate-user-screen') {
        console.error(`Error: Invalid isolation level '${isolationLevel}'`);
        console.error('Valid values: same-user-screen, separate-user-screen');
        process.exit(1);
      }
      argsOffset += 2;
    } else if (currentArg === '--help' || currentArg === '-h') {
      console.error('Usage: start-screen [--auto-terminate] [--isolation-level <level>] <solve|hive> <github-url> [additional-args...]');
      console.error('');
      console.error('Options:');
      console.error('  --auto-terminate           Session terminates after command completes (old behavior)');
      console.error('                             By default, session stays alive for review and reattachment');
      console.error('  --isolation-level <level>  Isolation level for the screen session:');
      console.error('                             - same-user-screen: Run in current user context (default)');
      console.error('                             - separate-user-screen: Create separate user for each issue');
      console.error('');
      console.error('Examples:');
      console.error('  start-screen solve https://github.com/user/repo/issues/123 --dry-run');
      console.error('  start-screen --auto-terminate solve https://github.com/user/repo/issues/456');
      console.error('  start-screen --isolation-level separate-user-screen solve https://github.com/user/repo/issues/789');
      console.error('  start-screen hive https://github.com/user/repo --flag value');
      process.exit(0);
    } else {
      console.error(`Unknown option: ${currentArg}`);
      console.error('Usage: start-screen [--auto-terminate] [--isolation-level <level>] <solve|hive> <github-url> [additional-args...]');
      process.exit(1);
    }
  }

  // Verify we have enough arguments left for command and URL
  if (argsOffset + 2 > args.length) {
    console.error('Error: Missing required command and GitHub URL');
    console.error('Usage: start-screen [--auto-terminate] [--isolation-level <level>] <solve|hive> <github-url> [additional-args...]');
    process.exit(1);
  }

  const command = args[argsOffset];
  const githubUrl = args[argsOffset + 1];
  const commandArgs = args.slice(argsOffset + 2);

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
  const fullArgs = [githubUrl, ...commandArgs];

  // Create or enter the screen session
  await createOrEnterScreen(sessionName, command, fullArgs, autoTerminate, isolationLevel);
}

// Run the main function
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});