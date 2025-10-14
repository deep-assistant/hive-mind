#!/usr/bin/env node
// clean-screens.mjs - Kill screen sessions by pattern

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Load use-m dynamically from unpkg (same pattern as solve.mjs and start-screen.mjs)
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

const argv = yargs(hideBin(process.argv))
  .usage('Usage: clean-screens <pattern> [options]')
  .command('$0 <pattern>', 'Kill screen sessions matching the pattern', (yargs) => {
    yargs.positional('pattern', {
      describe: 'Pattern to match screen session names (shell glob pattern)',
      type: 'string'
    });
  })
  .option('dry-run', {
    alias: 'n',
    type: 'boolean',
    description: 'Show what would be killed without actually killing',
    default: false
  })
  .option('force', {
    alias: 'f',
    type: 'boolean',
    description: 'Force kill sessions without confirmation',
    default: false
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    description: 'Show detailed output',
    default: false
  })
  .example('$0 "solve-deep-assistant-hive-mind-*"', 'Kill all screen sessions starting with solve-deep-assistant-hive-mind-')
  .example('$0 "solve-*" --dry-run', 'Show which sessions would be killed')
  .example('$0 "hive-*" --force', 'Kill all hive sessions without confirmation')
  .help('h')
  .alias('h', 'help')
  .strict()
  .parse();

/**
 * Get list of screen sessions
 * @returns {Promise<string[]>} Array of session names
 */
async function getScreenSessions() {
  try {
    const { stdout } = await execAsync('screen -ls');
    // Parse screen -ls output to extract session names
    // Format: "12345.session-name	(Attached)" or "12345.session-name	(Detached)"
    const lines = stdout.split('\n');
    const sessions = [];

    for (const line of lines) {
      const match = line.match(/^\s*\d+\.([^\s]+)\s+/);
      if (match) {
        sessions.push(match[1]);
      }
    }

    return sessions;
  } catch (error) {
    // screen -ls returns non-zero exit code when no sessions exist or an error occurs
    if (error.stdout) {
      // Try to parse the output anyway as it might contain session info
      const lines = error.stdout.split('\n');
      const sessions = [];

      for (const line of lines) {
        const match = line.match(/^\s*\d+\.([^\s]+)\s+/);
        if (match) {
          sessions.push(match[1]);
        }
      }

      if (sessions.length > 0) {
        return sessions;
      }
    }

    // No sessions found or genuine error
    if (error.code === 1 && error.stderr && error.stderr.includes('No Sockets found')) {
      return [];
    }

    throw error;
  }
}

/**
 * Check if a session name matches the pattern
 * @param {string} sessionName - The session name to test
 * @param {string} pattern - The glob pattern to match against
 * @returns {boolean} Whether the session name matches the pattern
 */
function matchesPattern(sessionName, pattern) {
  // Convert glob pattern to regex
  // Escape special regex characters except * and ?
  let regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special chars
    .replace(/\*/g, '.*')                   // * becomes .*
    .replace(/\?/g, '.');                   // ? becomes .

  // Anchor the pattern to match the entire string
  regexPattern = `^${regexPattern}$`;

  const regex = new RegExp(regexPattern);
  return regex.test(sessionName);
}

/**
 * Kill a screen session by name
 * @param {string} sessionName - The name of the session to kill
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function killSession(sessionName) {
  try {
    // Use screen -S <name> -X quit to kill the session
    await execAsync(`screen -S ${sessionName} -X quit`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to kill session'
    };
  }
}

/**
 * Main function
 */
async function main() {
  const pattern = argv.pattern;
  const dryRun = argv.dryRun || argv['dry-run'];
  const force = argv.force;
  const verbose = argv.verbose;

  if (!pattern) {
    console.error('Error: Pattern is required');
    console.error('Usage: clean-screens <pattern> [options]');
    console.error('Example: clean-screens "solve-*"');
    process.exit(1);
  }

  // Check if screen is available
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

  if (verbose) {
    console.log(`Looking for screen sessions matching pattern: ${pattern}`);
  }

  // Get all screen sessions
  let allSessions;
  try {
    allSessions = await getScreenSessions();
  } catch (error) {
    console.error('Error getting screen sessions:', error.message);
    process.exit(1);
  }

  if (verbose) {
    console.log(`Found ${allSessions.length} total screen session(s)`);
  }

  // Filter sessions by pattern
  const matchingSessions = allSessions.filter(session => matchesPattern(session, pattern));

  if (matchingSessions.length === 0) {
    console.log(`No screen sessions found matching pattern: ${pattern}`);
    process.exit(0);
  }

  console.log(`Found ${matchingSessions.length} screen session(s) matching pattern: ${pattern}`);

  if (dryRun) {
    console.log('\nDry-run mode: Would kill the following sessions:');
    matchingSessions.forEach(session => {
      console.log(`  - ${session}`);
    });
    console.log('\nRun without --dry-run to actually kill these sessions.');
    process.exit(0);
  }

  // Show sessions to be killed
  console.log('\nSessions to be killed:');
  matchingSessions.forEach(session => {
    console.log(`  - ${session}`);
  });

  // Confirm unless --force is used
  if (!force) {
    console.log('\nThis will terminate these screen sessions and any running processes inside them.');
    console.log('Use --force to skip this confirmation.');
    process.exit(0);
  }

  // Kill sessions
  console.log('\nKilling sessions...');
  let successCount = 0;
  let errorCount = 0;

  for (const session of matchingSessions) {
    if (verbose) {
      console.log(`  Killing session: ${session}...`);
    }

    const result = await killSession(session);

    if (result.success) {
      successCount++;
      console.log(`  ✓ Killed: ${session}`);
    } else {
      errorCount++;
      console.log(`  ✗ Failed to kill: ${session} (${result.error})`);
    }
  }

  // Summary
  console.log(`\nSummary: ${successCount} killed, ${errorCount} failed`);

  if (errorCount > 0) {
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
