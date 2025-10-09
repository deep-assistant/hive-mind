// CLI configuration module for solve command
// Extracted from solve.mjs to keep files under 1500 lines

// This module expects 'use' to be passed in from the parent module
// to avoid duplicate use-m initialization issues

// Define all valid options for strict validation
export const DEFINED_OPTIONS = new Set([
  'help', 'h', 'version',
  'issue-url', 'issueUrl',
  'resume', 'r',
  'only-prepare-command', 'onlyPrepareCommand',
  'dry-run', 'dryRun', 'n',
  'skip-tool-check', 'skipToolCheck',
  'tool-check', 'toolCheck',
  'model', 'm',
  'auto-pull-request-creation', 'autoPullRequestCreation',
  'verbose', 'v',
  'fork', 'f',
  'attach-logs', 'attachLogs',
  'auto-close-pull-request-on-fail', 'autoClosePullRequestOnFail',
  'auto-continue', 'autoContinue',
  'auto-continue-limit', 'autoContinueLimit', 'c',
  'auto-resume-on-errors', 'autoResumeOnErrors',
  'auto-continue-only-on-new-comments', 'autoContinueOnlyOnNewComments',
  'auto-commit-uncommitted-changes', 'autoCommitUncommittedChanges',
  'continue-only-on-feedback', 'continueOnlyOnFeedback',
  'watch', 'w',
  'watch-interval', 'watchInterval',
  'min-disk-space', 'minDiskSpace',
  'log-dir', 'logDir', 'l',
  'think',
  'base-branch', 'baseBranch', 'b',
  'no-sentry', 'noSentry',
  'auto-cleanup', 'autoCleanup',
  'auto-merge-default-branch-to-pull-request-branch', 'autoMergeDefaultBranchToPullRequestBranch',
  'allow-fork-force-push', 'allowForkForcePush',
  'tool',
  '_', '$0'
]);

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
    .option('skip-tool-check', {
      type: 'boolean',
      description: 'Skip tool connection check (useful in CI environments)',
      default: false
    })
    .option('tool-check', {
      type: 'boolean',
      description: 'Perform tool connection check (enabled by default, use --no-tool-check to skip)',
      default: true,
      hidden: true
    })
    .option('model', {
      type: 'string',
      description: 'Model to use (for claude: opus, sonnet; for opencode: grok, gpt4o, etc.)',
      alias: 'm',
      default: (currentParsedArgs) => {
        // Dynamic default based on tool selection
        return currentParsedArgs?.tool === 'opencode' ? 'grok-code-fast-1' : 'sonnet';
      }
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
      description: 'Continue with existing PR when issue URL is provided (instead of creating new PR)',
      default: false
    })
    .option('auto-continue-limit', {
      type: 'boolean',
      description: 'Automatically continue when Claude limit resets (waits until reset time)',
      default: false,
      alias: 'c'
    })
    .option('auto-resume-on-errors', {
      type: 'boolean',
      description: 'Automatically resume on network errors (503, etc.) with exponential backoff',
      default: false
    })
    .option('auto-continue-only-on-new-comments', {
      type: 'boolean',
      description: 'Explicitly fail on absence of new comments in auto-continue or continue mode',
      default: false
    })
    .option('auto-commit-uncommitted-changes', {
      type: 'boolean',
      description: 'Automatically commit and push uncommitted changes made by Claude (disabled by default)',
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
    .option('think', {
      type: 'string',
      description: 'Thinking level: low (Think.), medium (Think hard.), high (Think harder.), max (Ultrathink.)',
      choices: ['low', 'medium', 'high', 'max'],
      default: undefined
    })
    .option('base-branch', {
      type: 'string',
      description: 'Target branch for the pull request (defaults to repository default branch)',
      alias: 'b'
    })
    .option('no-sentry', {
      type: 'boolean',
      description: 'Disable Sentry error tracking and monitoring',
      default: false
    })
    .option('auto-cleanup', {
      type: 'boolean',
      description: 'Automatically delete temporary working directory on completion (error, success, or CTRL+C). Default: true for private repos, false for public repos. Use explicit flag to override.',
      default: undefined
    })
    .option('auto-merge-default-branch-to-pull-request-branch', {
      type: 'boolean',
      description: 'Automatically merge the default branch to the pull request branch when continuing work (only in continue mode)',
      default: false
    })
    .option('allow-fork-force-push', {
      type: 'boolean',
      description: 'Allow automatic force-push (--force-with-lease) when fork diverges from upstream (DANGEROUS: can overwrite fork history)',
      default: false
    })
    .option('tool', {
      type: 'string',
      description: 'AI tool to use for solving issues',
      choices: ['claude', 'opencode'],
      default: 'claude'
    })
    .help('h')
    .alias('h', 'help');
};

// Parse command line arguments - now needs yargs and hideBin passed in
export const parseArguments = async (yargs, hideBin) => {
  const rawArgs = hideBin(process.argv);
  const argv = await createYargsConfig(yargs(rawArgs)).argv;

  // Post-processing: Fix model default for opencode tool
  // Yargs doesn't properly handle dynamic defaults based on other arguments,
  // so we need to handle this manually after parsing
  const modelExplicitlyProvided = rawArgs.includes('--model') || rawArgs.includes('-m');

  if (argv.tool === 'opencode' && !modelExplicitlyProvided) {
    // User did not explicitly provide --model, so use the correct default for opencode
    argv.model = 'grok-code-fast-1';
  }

  return argv;
};