#!/usr/bin/env node
// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');
const path = (await use('path')).default;
const fs = (await use('fs')).promises;

// Import shared library functions
const lib = await import('./lib.mjs');
const { log, setLogFile, formatTimestamp, cleanErrorMessage, formatAligned, displayFormattedError, cleanupTempDirectories } = lib;

// Import Claude-related functions
const claudeLib = await import('./claude.lib.mjs');
const { validateClaudeConnection } = claudeLib;

// Import GitHub-related functions
const githubLib = await import('./github.lib.mjs');
const { checkGitHubPermissions, fetchAllIssuesWithPagination, fetchProjectIssues, isRateLimitError, batchCheckPullRequestsForIssues } = githubLib;

// Import memory check functions
const memCheck = await import('./memory-check.mjs');
const { checkSystem } = memCheck;

// The fetchAllIssuesWithPagination function has been moved to github.lib.mjs

// The cleanupTempDirectories function has been moved to lib.mjs

// Detect if running as global command vs local script
// Simple detection: check if the command name ends with .mjs
// - Global command: 'hive' -> use 'solve'
// - Local script: 'hive.mjs' or './hive.mjs' -> use './solve.mjs'
const commandName = process.argv[1] ? process.argv[1].split('/').pop() : '';
const isLocalScript = commandName.endsWith('.mjs');

// Determine which solve command to use based on execution context
const solveCommand = isLocalScript ? './solve.mjs' : 'solve';

/**
 * Fallback function to fetch issues from organization/user repositories
 * when search API hits rate limits
 * @param {string} owner - Organization or user name
 * @param {string} scope - 'organization' or 'user'
 * @param {string} monitorTag - Label to filter by (optional)
 * @param {boolean} allIssues - Whether to fetch all issues or only labeled ones
 * @returns {Promise<Array>} Array of issues
 */
async function fetchIssuesFromRepositories(owner, scope, monitorTag, fetchAllIssues = false) {
  const { execSync } = await import('child_process');

  try {
    await log(`   🔄 Using repository-by-repository fallback for ${scope}: ${owner}`);

    // First, get list of repositories
    let repoListCmd;
    if (scope === 'organization') {
      repoListCmd = `gh repo list ${owner} --limit 1000 --json name,owner`;
    } else {
      repoListCmd = `gh repo list ${owner} --limit 1000 --json name,owner`;
    }

    await log('   📋 Fetching repository list...', { verbose: true });
    await log(`   🔎 Command: ${repoListCmd}`, { verbose: true });

    // Add delay for rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));

    const repoOutput = execSync(repoListCmd, { encoding: 'utf8' });
    const repositories = JSON.parse(repoOutput || '[]');

    await log(`   📊 Found ${repositories.length} repositories`);

    let collectedIssues = [];
    let processedRepos = 0;

    // Process repositories in batches to avoid overwhelming the API
    for (const repo of repositories) {
      try {
        const repoName = repo.name;
        const ownerName = repo.owner?.login || owner;

        await log(`   🔍 Fetching issues from ${ownerName}/${repoName}...`, { verbose: true });

        // Build the appropriate issue list command
        let issueCmd;
        if (fetchAllIssues) {
          issueCmd = `gh issue list --repo ${ownerName}/${repoName} --state open --json url,title,number`;
        } else {
          issueCmd = `gh issue list --repo ${ownerName}/${repoName} --state open --label "${monitorTag}" --json url,title,number`;
        }

        // Add delay between repository requests
        await new Promise(resolve => setTimeout(resolve, 1000));

        const repoIssues = await fetchAllIssuesWithPagination(issueCmd);

        // Add repository information to each issue
        const issuesWithRepo = repoIssues.map(issue => ({
          ...issue,
          repository: {
            name: repoName,
            owner: { login: ownerName }
          }
        }));

        collectedIssues.push(...issuesWithRepo);
        processedRepos++;

        if (issuesWithRepo.length > 0) {
          await log(`   ✅ Found ${issuesWithRepo.length} issues in ${ownerName}/${repoName}`, { verbose: true });
        }

      } catch (repoError) {
        await log(`   ⚠️  Failed to fetch issues from ${repo.name}: ${cleanErrorMessage(repoError)}`, { verbose: true });
        // Continue with other repositories
      }
    }

    await log(`   ✅ Repository fallback complete: ${collectedIssues.length} issues from ${processedRepos}/${repositories.length} repositories`);
    return collectedIssues;

  } catch (error) {
    await log(`   ❌ Repository fallback failed: ${cleanErrorMessage(error)}`, { level: 'error' });
    return [];
  }
}

// Function to create yargs configuration - avoids duplication
const createYargsConfig = (yargsInstance) => {
  return yargsInstance
    .command('$0 <github-url>', 'Monitor GitHub issues and create PRs', (yargs) => {
      yargs.positional('github-url', {
        type: 'string',
        description: 'GitHub organization, repository, or user URL to monitor',
        demandOption: true
      });
    })
    .usage('Usage: $0 <github-url> [options]')
    .option('monitor-tag', {
      type: 'string',
      description: 'GitHub label to monitor for issues',
      default: 'help wanted',
      alias: 't'
    })
    .option('all-issues', {
      type: 'boolean',
      description: 'Process all open issues regardless of labels',
      default: false,
      alias: 'a'
    })
    .option('skip-issues-with-prs', {
      type: 'boolean',
      description: 'Skip issues that already have open pull requests',
      default: false,
      alias: 's'
    })
    .option('concurrency', {
      type: 'number',
      description: 'Number of concurrent solve instances',
      default: 2,
      alias: 'c'
    })
    .option('pull-requests-per-issue', {
      type: 'number',
      description: 'Number of pull requests to generate per issue',
      default: 1,
      alias: 'p'
    })
    .option('model', {
      type: 'string',
      description: 'Model to use for solve (opus or sonnet)',
      alias: 'm',
      default: 'sonnet',
      choices: ['opus', 'sonnet']
    })
    .option('interval', {
      type: 'number',
      description: 'Polling interval in seconds',
      default: 300, // 5 minutes
      alias: 'i'
    })
    .option('max-issues', {
      type: 'number',
      description: 'Maximum number of issues to process (0 = unlimited)',
      default: 0
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'List issues that would be processed without actually processing them',
      default: false
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Enable verbose logging',
      alias: 'v',
      default: false
    })
    .option('once', {
      type: 'boolean',
      description: 'Run once and exit instead of continuous monitoring',
      default: false
    })
    .option('min-disk-space', {
      type: 'number',
      description: 'Minimum required disk space in MB (default: 500)',
      default: 500
    })
    .option('auto-cleanup', {
      type: 'boolean',
      description: 'Automatically clean temporary directories (/tmp/* /var/tmp/*) when finished successfully',
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
    .option('project-number', {
      type: 'number',
      description: 'GitHub Project number to monitor',
      alias: 'pn'
    })
    .option('project-owner', {
      type: 'string',
      description: 'GitHub Project owner (organization or user)',
      alias: 'po'
    })
    .option('project-status', {
      type: 'string',
      description: 'Project status column to monitor (e.g., "Ready", "To Do")',
      alias: 'ps',
      default: 'Ready'
    })
    .option('project-mode', {
      type: 'boolean',
      description: 'Enable project-based monitoring instead of label-based',
      alias: 'pm',
      default: false
    })
    .option('log-dir', {
      type: 'string',
      description: 'Directory to save log files (defaults to current working directory)',
      alias: 'l'
    })
    .help('h')
    .alias('h', 'help');
};

// Check for help flag before processing other arguments
const rawArgs = hideBin(process.argv);
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  // Show help and exit
  createYargsConfig(yargs(rawArgs)).showHelp();
  process.exit(0);
}

// Configure command line arguments - GitHub URL as positional argument
const argv = createYargsConfig(yargs(rawArgs)).argv;

const githubUrl = argv['github-url'];

// Set global verbose mode
global.verboseMode = argv.verbose;

// Validate GitHub URL format ONCE AND FOR ALL at the beginning
// Parse URL format: https://github.com/owner or https://github.com/owner/repo
let urlMatch = null;

// Only validate if we have a URL
const needsUrlValidation = githubUrl;

if (needsUrlValidation) {
  // Do the regex matching ONCE - this result will be used everywhere
  urlMatch = githubUrl.match(/^https:\/\/github\.com\/([^/]+)(\/([^/]+))?$/);
  if (!urlMatch) {
    console.error('Error: Invalid GitHub URL format');
    console.error('Expected: https://github.com/owner or https://github.com/owner/repo');
    process.exit(1);
  }
}

// Create log file with timestamp
// Use log-dir option if provided, otherwise use current working directory
let targetDir = argv.logDir || process.cwd();

// Verify the directory exists, create if necessary
try {
  await fs.access(targetDir);
} catch (error) {
  // If directory doesn't exist, try to create it
  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch (mkdirError) {
    console.error(`⚠️  Unable to create log directory: ${targetDir}`);
    console.error('   Falling back to current working directory');
    // Fall back to current working directory
    targetDir = process.cwd();
  }
}

const timestamp = formatTimestamp();
const logFile = path.join(targetDir, `hive-${timestamp}.log`);

// Set the log file for the lib.mjs logging system
setLogFile(logFile);

// Create the log file immediately
await fs.writeFile(logFile, `# Hive.mjs Log - ${new Date().toISOString()}\n\n`);
// Always use absolute path for log file display
const absoluteLogPath = path.resolve(logFile);
await log(`📁 Log file: ${absoluteLogPath}`);
await log('   (All output will be logged here)');

// Setup unhandled error handlers to ensure log path is always shown
process.on('uncaughtException', async (error) => {
  await log(`\n❌ Uncaught Exception: ${cleanErrorMessage(error)}`, { level: 'error' });
  await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  await log(`\n❌ Unhandled Rejection: ${cleanErrorMessage(reason)}`, { level: 'error' });
  await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });
  process.exit(1);
});

// Validate GitHub URL requirement
if (!githubUrl) {
  await log('❌ GitHub URL is required', { level: 'error' });
  await log('   Usage: hive <github-url> [options]', { level: 'error' });
  await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });
  process.exit(1);
}

// Validate project mode arguments
if (argv.projectMode) {
  if (!argv.projectNumber) {
    await log('❌ Project mode requires --project-number', { level: 'error' });
    await log('   Usage: hive <github-url> --project-mode --project-number NUMBER --project-owner OWNER', { level: 'error' });
    process.exit(1);
  }

  if (!argv.projectOwner) {
    await log('❌ Project mode requires --project-owner', { level: 'error' });
    await log('   Usage: hive <github-url> --project-mode --project-number NUMBER --project-owner OWNER', { level: 'error' });
    process.exit(1);
  }

  if (typeof argv.projectNumber !== 'number' || argv.projectNumber <= 0) {
    await log('❌ Project number must be a positive integer', { level: 'error' });
    process.exit(1);
  }
}

// Helper function to check GitHub permissions - moved to github.lib.mjs

// Check GitHub permissions early in the process
const hasValidAuth = await checkGitHubPermissions();
if (!hasValidAuth) {
  await log('\n❌ Cannot proceed without valid GitHub authentication', { level: 'error' });
  process.exit(1);
}

// Parse GitHub URL to determine organization, repository, or user
let scope = 'repository';
let owner = null;
let repo = null;

// NO DUPLICATE VALIDATION! URL was already validated at the beginning.
// If we have a URL but no validation results, that's a logic error.
if (githubUrl && urlMatch === null) {
  // This should never happen - it means our early validation was skipped incorrectly
  await log('Internal error: URL validation was not performed correctly', { level: 'error' });
  await log('This is a bug in the script logic', { level: 'error' });
  process.exit(1);
}

if (urlMatch) {
  owner = urlMatch[1];
  repo = urlMatch[3] || null;
}

// Determine scope
if (!repo) {
  // Check if it's an organization or user
  try {
    const typeResult = await $`gh api users/${owner} --jq .type`;
    const accountType = typeResult.stdout.toString().trim();
    scope = accountType === 'Organization' ? 'organization' : 'user';
  } catch (e) {
    // Default to user if API call fails
    scope = 'user';
  }
} else {
  scope = 'repository';
}

await log('🎯 Monitoring Configuration:');
await log(`   📍 Target: ${scope.charAt(0).toUpperCase() + scope.slice(1)} - ${owner}${repo ? `/${repo}` : ''}`);
if (argv.projectMode) {
  await log(`   📋 Mode: PROJECT #${argv.projectNumber} (owner: ${argv.projectOwner})`);
  await log(`   📌 Status: "${argv.projectStatus}"`);
} else if (argv.allIssues) {
  await log('   🏷️  Mode: ALL ISSUES (no label filter)');
} else {
  await log(`   🏷️  Tag: "${argv.monitorTag}"`);
}
if (argv.skipIssuesWithPrs) {
  await log('   🚫 Skipping: Issues with open PRs');
}
await log(`   🔄 Concurrency: ${argv.concurrency} parallel workers`);
await log(`   📊 Pull Requests per Issue: ${argv.pullRequestsPerIssue}`);
await log(`   🤖 Model: ${argv.model}`);
if (argv.fork) {
  await log('   🍴 Fork: ENABLED (will fork repos if no write access)');
}
if (!argv.once) {
  await log(`   ⏱️  Polling Interval: ${argv.interval} seconds`);
}
await log(`   ${argv.once ? '🚀 Mode: Single run' : '♾️  Mode: Continuous monitoring'}`);
if (argv.maxIssues > 0) {
  await log(`   🔢 Max Issues: ${argv.maxIssues}`);
}
if (argv.dryRun) {
  await log('   🧪 DRY RUN MODE - No actual processing');
}
if (argv.autoCleanup) {
  await log('   🧹 Auto-cleanup: ENABLED (will clean /tmp/* /var/tmp/* on success)');
}
await log('');

// Producer/Consumer Queue implementation
class IssueQueue {
  constructor() {
    this.queue = [];
    this.processing = new Set();
    this.completed = new Set();
    this.failed = new Set();
    this.workers = [];
    this.isRunning = true;
  }

  // Add issue to queue if not already processed or in queue
  enqueue(issueUrl) {
    if (this.completed.has(issueUrl) || 
        this.processing.has(issueUrl) || 
        this.queue.includes(issueUrl)) {
      return false;
    }
    this.queue.push(issueUrl);
    return true;
  }

  // Get next issue from queue
  dequeue() {
    if (this.queue.length === 0) {
      return null;
    }
    const issue = this.queue.shift();
    this.processing.add(issue);
    return issue;
  }

  // Mark issue as completed
  markCompleted(issueUrl) {
    this.processing.delete(issueUrl);
    this.completed.add(issueUrl);
  }

  // Mark issue as failed
  markFailed(issueUrl) {
    this.processing.delete(issueUrl);
    this.failed.add(issueUrl);
  }

  // Get queue statistics
  getStats() {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      completed: this.completed.size,
      failed: this.failed.size
    };
  }

  // Stop all workers
  stop() {
    this.isRunning = false;
  }
}

// Create global queue instance
const issueQueue = new IssueQueue();

// Global shutdown state to prevent duplicate shutdown messages
let isShuttingDown = false;

// Worker function to process issues from queue
async function worker(workerId) {
  await log(`🔧 Worker ${workerId} started`, { verbose: true });
  
  while (issueQueue.isRunning) {
    const issueUrl = issueQueue.dequeue();
    
    if (!issueUrl) {
      // No work available, wait a bit
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }

    await log(`\n👷 Worker ${workerId} processing: ${issueUrl}`);
    
    // Track if this issue failed
    let issueFailed = false;
    
    // Process the issue multiple times if needed
    for (let prNum = 1; prNum <= argv.pullRequestsPerIssue; prNum++) {
      if (argv.pullRequestsPerIssue > 1) {
        await log(`   📝 Creating PR ${prNum}/${argv.pullRequestsPerIssue} for issue`);
      }
      
      try {
        if (argv.dryRun) {
          const forkFlag = argv.fork ? ' --fork' : '';
          const verboseFlag = argv.verbose ? ' --verbose' : '';
          const attachLogsFlag = argv.attachLogs ? ' --attach-logs' : '';
          const logDirFlag = argv.logDir ? ` --log-dir "${argv.logDir}"` : '';
          await log(`   🧪 [DRY RUN] Would execute: ${solveCommand} "${issueUrl}" --model ${argv.model}${forkFlag}${verboseFlag}${attachLogsFlag}${logDirFlag}`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate work
        } else {
          // Execute solve command using spawn to enable real-time streaming while avoiding command-stream quoting issues
          await log(`   🚀 Executing ${solveCommand} for ${issueUrl}...`);
          
          const startTime = Date.now();
          const forkFlag = argv.fork ? ' --fork' : '';
          const verboseFlag = argv.verbose ? ' --verbose' : '';
          const attachLogsFlag = argv.attachLogs ? ' --attach-logs' : '';
          const logDirFlag = argv.logDir ? ` --log-dir "${argv.logDir}"` : '';

          // Use spawn to get real-time streaming output while avoiding command-stream's automatic quote addition
          const { spawn } = await import('child_process');

          // Build arguments array to avoid shell parsing issues
          const args = [issueUrl, '--model', argv.model];
          if (argv.fork) {
            args.push('--fork');
          }
          if (argv.verbose) {
            args.push('--verbose');
          }
          if (argv.attachLogs) {
            args.push('--attach-logs');
          }
          if (argv.logDir) {
            args.push('--log-dir', argv.logDir);
          }

          // Log the actual command being executed so users can investigate/reproduce
          const command = `${solveCommand} "${issueUrl}" --model ${argv.model}${forkFlag}${verboseFlag}${attachLogsFlag}${logDirFlag}`;
          await log(`   📋 Command: ${command}`);

          let exitCode = 0;

          // Create promise to handle async spawn process
          await new Promise((resolve, reject) => {
            const child = spawn(solveCommand, args, {
              stdio: ['pipe', 'pipe', 'pipe']
            });
            
            // Handle stdout data - stream output in real-time
            child.stdout.on('data', (data) => {
              const lines = data.toString().split('\n');
              for (const line of lines) {
                if (line.trim()) {
                  log(`   [${solveCommand} worker-${workerId}] ${line}`).catch(() => {});
                }
              }
            });

            // Handle stderr data - stream errors in real-time
            child.stderr.on('data', (data) => {
              const lines = data.toString().split('\n');
              for (const line of lines) {
                if (line.trim()) {
                  log(`   [${solveCommand} worker-${workerId} ERROR] ${line}`, { level: 'error' }).catch(() => {});
                }
              }
            });
            
            // Handle process completion
            child.on('close', (code) => {
              exitCode = code || 0;
              resolve();
            });
            
            // Handle process errors
            child.on('error', (error) => {
              exitCode = 1;
              log(`   [${solveCommand} worker-${workerId} ERROR] Process error: ${error.message}`, { level: 'error' }).catch(() => {});
              resolve();
            });
          });
          
          const duration = Math.round((Date.now() - startTime) / 1000);
          
          if (exitCode === 0) {
            await log(`   ✅ Worker ${workerId} completed ${issueUrl} (${duration}s)`);
          } else {
            throw new Error(`${solveCommand} exited with code ${exitCode}`);
          }
        }
        
        // Small delay between multiple PRs for same issue
        if (prNum < argv.pullRequestsPerIssue) {
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      } catch (error) {
        await log(`   ❌ Worker ${workerId} failed on ${issueUrl}: ${cleanErrorMessage(error)}`, { level: 'error' });
        issueQueue.markFailed(issueUrl);
        issueFailed = true;
        break; // Stop trying more PRs for this issue
      }
    }
    
    // Only mark as completed if it didn't fail
    if (!issueFailed) {
      issueQueue.markCompleted(issueUrl);
    }
    
    // Show queue stats
    const stats = issueQueue.getStats();
    await log(`   📊 Queue: ${stats.queued} waiting, ${stats.processing} processing, ${stats.completed} completed, ${stats.failed} failed`);
  }
  
  await log(`🔧 Worker ${workerId} stopped`, { verbose: true });
}

// Function to check if an issue has open pull requests
// Note: hasOpenPullRequests function has been replaced by batchCheckPullRequestsForIssues
// in github.lib.mjs for better performance and reduced API calls

// Function to fetch issues from GitHub
async function fetchIssues() {
  if (argv.projectMode) {
    await log(`\n🔍 Fetching issues from GitHub Project #${argv.projectNumber} (status: "${argv.projectStatus}")...`);
  } else if (argv.allIssues) {
    await log('\n🔍 Fetching ALL open issues...');
  } else {
    await log(`\n🔍 Fetching issues with label "${argv.monitorTag}"...`);
  }

  try {
    let issues = [];

    if (argv.projectMode) {
      // Use GitHub Projects v2 mode
      if (!argv.projectNumber || !argv.projectOwner) {
        throw new Error('Project mode requires --project-number and --project-owner');
      }

      issues = await fetchProjectIssues(argv.projectNumber, argv.projectOwner, argv.projectStatus);

    } else if (argv.allIssues) {
      // Fetch all open issues without label filter using pagination
      let searchCmd;
      if (scope === 'repository') {
        searchCmd = `gh issue list --repo ${owner}/${repo} --state open --json url,title,number`;
      } else if (scope === 'organization') {
        searchCmd = `gh search issues org:${owner} is:open --json url,title,number,repository`;
      } else {
        // User scope
        searchCmd = `gh search issues user:${owner} is:open --json url,title,number,repository`;
      }
      
      await log('   🔎 Fetching all issues with pagination and rate limiting...');
      await log(`   🔎 Command: ${searchCmd}`, { verbose: true });

      try {
        issues = await fetchAllIssuesWithPagination(searchCmd);
      } catch (searchError) {
        await log(`   ⚠️  Search failed: ${cleanErrorMessage(searchError)}`, { verbose: true });

        // Check if the error is due to rate limiting and we're not in repository scope
        if (isRateLimitError(searchError) && scope !== 'repository') {
          await log('   🔍 Rate limit detected - attempting repository fallback...');
          try {
            issues = await fetchIssuesFromRepositories(owner, scope, null, true);
          } catch (fallbackError) {
            await log(`   ❌ Repository fallback failed: ${cleanErrorMessage(fallbackError)}`, { verbose: true });
            issues = [];
          }
        } else {
          issues = [];
        }
      }
      
    } else {
      // Use label filter
      // execSync is used within fetchAllIssuesWithPagination
      
      // For repositories, use gh issue list which works better with new repos
      if (scope === 'repository') {
        const listCmd = `gh issue list --repo ${owner}/${repo} --state open --label "${argv.monitorTag}" --json url,title,number`;
        await log('   🔎 Fetching labeled issues with pagination and rate limiting...');
        await log(`   🔎 Command: ${listCmd}`, { verbose: true });
        
        try {
          issues = await fetchAllIssuesWithPagination(listCmd);
        } catch (listError) {
          await log(`   ⚠️  List failed: ${cleanErrorMessage(listError)}`, { verbose: true });
          issues = [];
        }
      } else {
        // For organizations and users, use search (may not work with new repos)
        let baseQuery;
        if (scope === 'organization') {
          baseQuery = `org:${owner} is:issue is:open`;
        } else {
          baseQuery = `user:${owner} is:issue is:open`;
        }
        
        // Handle label with potential spaces
        let searchQuery;
        let searchCmd;
        
        if (argv.monitorTag.includes(' ')) {
          searchQuery = `${baseQuery} label:"${argv.monitorTag}"`;
          searchCmd = `gh search issues '${searchQuery}' --json url,title,number,repository`;
        } else {
          searchQuery = `${baseQuery} label:${argv.monitorTag}`;
          searchCmd = `gh search issues '${searchQuery}' --json url,title,number,repository`;
        }
        
        await log('   🔎 Fetching labeled issues with pagination and rate limiting...');
        await log(`   🔎 Search query: ${searchQuery}`, { verbose: true });
        await log(`   🔎 Command: ${searchCmd}`, { verbose: true });
        
        try {
          issues = await fetchAllIssuesWithPagination(searchCmd);
        } catch (searchError) {
          await log(`   ⚠️  Search failed: ${cleanErrorMessage(searchError)}`, { verbose: true });

          // Check if the error is due to rate limiting
          if (isRateLimitError(searchError)) {
            await log('   🔍 Rate limit detected - attempting repository fallback...');
            try {
              issues = await fetchIssuesFromRepositories(owner, scope, argv.monitorTag, false);
            } catch (fallbackError) {
              await log(`   ❌ Repository fallback failed: ${cleanErrorMessage(fallbackError)}`, { verbose: true });
              issues = [];
            }
          } else {
            issues = [];
          }
        }
      }
    }
    
    if (issues.length === 0) {
      if (argv.projectMode) {
        await log(`   ℹ️  No issues found in project with status "${argv.projectStatus}"`);
      } else if (argv.allIssues) {
        await log('   ℹ️  No open issues found');
      } else {
        await log(`   ℹ️  No issues found with label "${argv.monitorTag}"`);
      }
      return [];
    }

    if (argv.projectMode) {
      await log(`   📋 Found ${issues.length} issue(s) with status "${argv.projectStatus}"`);
    } else if (argv.allIssues) {
      await log(`   📋 Found ${issues.length} open issue(s)`);
    } else {
      await log(`   📋 Found ${issues.length} issue(s) with label "${argv.monitorTag}"`);
    }
    
    // Filter out issues with open PRs if option is enabled
    let issuesToProcess = issues;
    if (argv.skipIssuesWithPrs) {
      await log('   🔍 Checking for existing pull requests using batch GraphQL query...');

      // Extract issue numbers and repository info from URLs
      const issuesByRepo = {};
      for (const issue of issuesToProcess) {
        const urlMatch = issue.url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
        if (urlMatch) {
          const [, issueOwner, issueRepo, issueNumber] = urlMatch;
          const repoKey = `${issueOwner}/${issueRepo}`;

          if (!issuesByRepo[repoKey]) {
            issuesByRepo[repoKey] = {
              owner: issueOwner,
              repo: issueRepo,
              issues: []
            };
          }

          issuesByRepo[repoKey].issues.push({
            number: parseInt(issueNumber),
            issue: issue
          });
        }
      }

      // Batch check PRs for each repository
      const filteredIssues = [];
      let totalSkipped = 0;

      for (const [repoKey, repoData] of Object.entries(issuesByRepo)) {
        const issueNumbers = repoData.issues.map(i => i.number);
        const prResults = await batchCheckPullRequestsForIssues(repoData.owner, repoData.repo, issueNumbers);

        // Process results
        for (const issueData of repoData.issues) {
          const prInfo = prResults[issueData.number];
          if (prInfo && prInfo.openPRCount > 0) {
            await log(`      ⏭️  Skipping (has ${prInfo.openPRCount} PR${prInfo.openPRCount > 1 ? 's' : ''}): ${issueData.issue.title || 'Untitled'} (${issueData.issue.url})`, { verbose: true });
            totalSkipped++;
          } else {
            filteredIssues.push(issueData.issue);
          }
        }
      }

      if (totalSkipped > 0) {
        await log(`   ⏭️  Skipped ${totalSkipped} issue(s) with existing pull requests`);
      }
      issuesToProcess = filteredIssues;
    }
    
    // Apply max issues limit if set (after filtering to exclude skipped issues from count)
    if (argv.maxIssues > 0 && issuesToProcess.length > argv.maxIssues) {
      issuesToProcess = issuesToProcess.slice(0, argv.maxIssues);
      await log(`   🔢 Limiting to first ${argv.maxIssues} issues (after filtering)`);
    }
    
    // In dry-run mode, show the issues that would be processed
    if (argv.dryRun && issuesToProcess.length > 0) {
      await log('\n   📝 Issues that would be processed:');
      for (const issue of issuesToProcess) {
        await log(`      - ${issue.title || 'Untitled'} (${issue.url})`);
      }
    }
    
    return issuesToProcess.map(issue => issue.url);
    
  } catch (error) {
    await log(`   ❌ Error fetching issues: ${cleanErrorMessage(error)}`, { level: 'error' });
    return [];
  }
}

// Main monitoring loop
async function monitor() {
  await log('\n🚀 Starting Hive Mind monitoring system...');
  
  // Start workers
  await log(`\n👷 Starting ${argv.concurrency} workers...`);
  for (let i = 1; i <= argv.concurrency; i++) {
    issueQueue.workers.push(worker(i));
  }
  
  // Main monitoring loop
  let iteration = 0;
  while (true) {
    iteration++;
    await log(`\n🔄 Monitoring iteration ${iteration} at ${new Date().toISOString()}`);
    
    // Fetch issues
    const issueUrls = await fetchIssues();
    
    // Add new issues to queue
    let newIssues = 0;
    for (const url of issueUrls) {
      if (issueQueue.enqueue(url)) {
        newIssues++;
        await log(`   ➕ Added to queue: ${url}`);
      }
    }
    
    if (newIssues > 0) {
      await log(`   📥 Added ${newIssues} new issue(s) to queue`);
    } else {
      await log('   ℹ️  No new issues to add (all already processed or in queue)');
    }
    
    // Show current stats
    const stats = issueQueue.getStats();
    await log('\n📊 Current Status:');
    await log(`   📋 Queued: ${stats.queued}`);
    await log(`   ⚙️  Processing: ${stats.processing}`);
    await log(`   ✅ Completed: ${stats.completed}`);
    await log(`   ❌ Failed: ${stats.failed}`);
    
    // If running once, wait for queue to empty then exit
    if (argv.once) {
      await log('\n🏁 Single run mode - waiting for queue to empty...');
      
      while (stats.queued > 0 || stats.processing > 0) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const currentStats = issueQueue.getStats();
        if (currentStats.queued !== stats.queued || currentStats.processing !== stats.processing) {
          await log(`   ⏳ Waiting... Queue: ${currentStats.queued}, Processing: ${currentStats.processing}`);
        }
        Object.assign(stats, currentStats);
      }
      
      await log('\n✅ All issues processed!');
      await log(`   Completed: ${stats.completed}`);
      await log(`   Failed: ${stats.failed}`);
      
      // Perform cleanup if enabled and there were successful completions
      if (stats.completed > 0) {
        await cleanupTempDirectories(argv);
      }
      break;
    }
    
    // Wait for next iteration
    await log(`\n⏰ Next check in ${argv.interval} seconds...`);
    await new Promise(resolve => setTimeout(resolve, argv.interval * 1000));
  }
  
  // Stop workers
  issueQueue.stop();
  await Promise.all(issueQueue.workers);
  
  // Perform cleanup if enabled and there were successful completions
  const finalStats = issueQueue.getStats();
  if (finalStats.completed > 0) {
    await cleanupTempDirectories();
  }
  
  await log('\n👋 Hive Mind monitoring stopped');
}

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return; // Prevent duplicate shutdown messages
  }
  isShuttingDown = true;
  
  try {
    await log(`\n\n🛑 Received ${signal} signal, shutting down gracefully...`);
    
    // Stop the queue and wait for workers to finish
    issueQueue.stop();
    
    // Give workers a moment to finish their current tasks
    const stats = issueQueue.getStats();
    if (stats.processing > 0) {
      await log(`   ⏳ Waiting for ${stats.processing} worker(s) to finish current tasks...`);
      
      // Wait up to 10 seconds for workers to finish
      const maxWaitTime = 10000;
      const startTime = Date.now();
      while (issueQueue.getStats().processing > 0 && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    await Promise.all(issueQueue.workers);
    
    // Perform cleanup if enabled and there were successful completions
    const finalStats = issueQueue.getStats();
    if (finalStats.completed > 0) {
      await cleanupTempDirectories(argv);
    }
    
    await log('   ✅ Shutdown complete');
    
  } catch (error) {
    await log(`   ⚠️  Error during shutdown: ${cleanErrorMessage(error)}`, { level: 'error' });
  }
  
  process.exit(0);
}

// Function to validate Claude CLI connection
// validateClaudeConnection is now imported from lib.mjs

// Handle graceful shutdown
process.on('SIGINT', () => gracefulShutdown('interrupt'));
process.on('SIGTERM', () => gracefulShutdown('termination'));

// Check system resources (disk space and RAM) before starting monitoring
const systemCheck = await checkSystem(
  { 
    minDiskSpaceMB: argv.minDiskSpace || 500,
    minMemoryMB: 256,
    exitOnFailure: true
  },
  { log }
);

if (!systemCheck.success) {
  process.exit(1);
}

// Validate Claude CLI connection before starting monitoring
const isClaudeConnected = await validateClaudeConnection();
if (!isClaudeConnected) {
  await log('❌ Cannot start monitoring without Claude CLI connection', { level: 'error' });
  process.exit(1);
}

// Start monitoring
try {
  await monitor();
} catch (error) {
  await log(`\n❌ Fatal error: ${cleanErrorMessage(error)}`, { level: 'error' });
  await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });
  process.exit(1);
}