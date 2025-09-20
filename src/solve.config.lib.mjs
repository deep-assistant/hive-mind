// CLI configuration module for solve command
// Extracted from solve.mjs to keep files under 1500 lines

// This module expects 'use' to be passed in from the parent module
// to avoid duplicate use-m initialization issues

// Export an initialization function that accepts 'use'
export const initializeConfig = async (use) => {
  // Import yargs with specific version for hideBin support
  const yargsModule = await use('yargs@17.7.2');
  const yargs = yargsModule.default || yargsModule;
  const { hideBin } = await use('yargs@17.7.2/helpers');

  return { yargs, hideBin };
};

// Function to create yargs configuration - avoids duplication
export const createYargsConfig = (yargsInstance) => {
  return yargsInstance
    .usage('Usage: solve.mjs <issue-url> [options]')
    .positional('issue-url', {
      type: 'string',
      description: 'The GitHub issue URL to solve'
    })
    .option('resume', {
      type: 'string',
      description: 'Resume from a previous session ID (when limit was reached)',
      alias: 'r'
    })
    .option('only-prepare-command', {
      type: 'boolean',
      description: 'Only prepare and print the claude command without executing it',
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'Prepare everything but do not execute Claude (alias for --only-prepare-command)',
      alias: 'n'
    })
    .option('skip-claude-check', {
      type: 'boolean',
      description: 'Skip Claude connection check (useful in CI environments where Claude is not installed)',
      default: false
    })
    .option('model', {
      type: 'string',
      description: 'Model to use (opus or sonnet)',
      alias: 'm',
      default: 'sonnet',
      choices: ['opus', 'sonnet']
    })
    .option('auto-pull-request-creation', {
      type: 'boolean',
      description: 'Automatically create a draft pull request before running Claude',
      default: true
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Enable verbose logging for debugging',
      alias: 'v',
      default: false
    })
    .option('fork', {
      type: 'boolean',
      description: 'Fork the repository if you don\'t have write access',
      alias: 'f',
      default: false
    })
    .option('attach-logs', {
      type: 'boolean',
      description: 'Upload the solution draft log file to the Pull Request on completion (⚠️ WARNING: May expose sensitive data)',
      default: false
    })
    .option('auto-close-pull-request-on-fail', {
      type: 'boolean',
      description: 'Automatically close the pull request if execution fails',
      default: false
    })
    .option('auto-continue', {
      type: 'boolean',
      description: 'Automatically continue with existing PRs for this issue if they are older than 24 hours',
      default: false
    })
    .option('auto-continue-limit', {
      type: 'boolean',
      description: 'Automatically continue when Claude limit resets (waits until reset time)',
      default: false,
      alias: 'c'
    })
    .option('auto-continue-only-on-new-comments', {
      type: 'boolean',
      description: 'Explicitly fail on absence of new comments in auto-continue or continue mode',
      default: false
    })
    .option('continue-only-on-feedback', {
      type: 'boolean',
      description: 'Only continue if feedback is detected (works only with pull request link or issue link with --auto-continue)',
      default: false
    })
    .option('watch', {
      type: 'boolean',
      description: 'Monitor continuously for feedback and auto-restart when detected (stops when PR is merged)',
      alias: 'w',
      default: false
    })
    .option('watch-interval', {
      type: 'number',
      description: 'Interval in seconds for checking feedback in watch mode (default: 60)',
      default: 60
    })
    .option('min-disk-space', {
      type: 'number',
      description: 'Minimum required disk space in MB (default: 500)',
      default: 500
    })
    .option('log-dir', {
      type: 'string',
      description: 'Directory to save log files (defaults to current working directory)',
      alias: 'l'
    })
    .help('h')
    .alias('h', 'help');
};

// Parse command line arguments - now needs yargs and hideBin passed in
export const parseArguments = async (yargs, hideBin) => {
  const rawArgs = hideBin(process.argv);
  return await createYargsConfig(yargs(rawArgs)).argv;
};