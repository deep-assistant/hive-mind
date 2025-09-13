#!/usr/bin/env node

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const yargs = (await use('yargs@latest')).default;
const os = (await use('os')).default;
const path = (await use('path')).default;
const fs = (await use('fs')).promises;
const crypto = (await use('crypto')).default;


// Function to check available disk space
const checkDiskSpace = async (minSpaceMB = 500) => {
  try {
    const { stdout } = await $`df -BM . | tail -1 | awk '{print $4}'`;
    const availableMB = parseInt(stdout.toString().replace('M', ''));
    
    if (availableMB < minSpaceMB) {
      await log(`❌ Insufficient disk space: ${availableMB}MB available, ${minSpaceMB}MB required`, { level: 'error' });
      await log('   This may prevent successful pull request creation.', { level: 'error' });
      await log('   Please free up disk space and try again.', { level: 'error' });
      return false;
    }
    
    await log(`💾 Disk space check: ${availableMB}MB available (${minSpaceMB}MB required) ✅`);
    return true;
  } catch (error) {
    await log(`⚠️  Could not check disk space: ${error.message}`, { level: 'warning' });
    await log('   Continuing anyway, but disk space issues may occur.', { level: 'warning' });
    return true; // Continue on check failure to avoid blocking execution
  }
};

// Global log file reference
let logFile = null;

// Helper function to log to both console and file
const log = async (message, options = {}) => {
  const { level = 'info', verbose = false } = options;
  
  // Skip verbose logs unless --verbose is enabled
  if (verbose && !global.verboseMode) {
    return;
  }
  
  // Write to file if log file is set
  if (logFile) {
    const logMessage = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
    await fs.appendFile(logFile, logMessage + '\n').catch(() => {});
  }
  
  // Write to console based on level
  switch (level) {
    case 'error':
      console.error(message);
      break;
    case 'warning':
    case 'warn':
      console.warn(message);
      break;
    case 'info':
    default:
      console.log(message);
      break;
  }
};

// Helper function to clean up error messages for better user experience
const cleanErrorMessage = (error) => {
  let message = error.message || error.toString();
  
  // Remove common noise from error messages
  message = message.split('\n')[0]; // Take only first line
  message = message.replace(/^Command failed: /, ''); // Remove "Command failed: " prefix
  message = message.replace(/^Error: /, ''); // Remove redundant "Error: " prefix
  message = message.replace(/^\/bin\/sh: \d+: /, ''); // Remove shell path info
  
  return message;
};

// Helper function to fetch all issues with pagination and rate limiting
const fetchAllIssuesWithPagination = async (baseCommand) => {
  const { execSync } = await import('child_process');
  
  try {
    // First, try without pagination to see if we get more than the default limit
    await log(`   📊 Fetching issues with improved limits and rate limiting...`, { verbose: true });
    
    // Add a 5-second delay before making the API call to respect rate limits
    await log(`   ⏰ Waiting 5 seconds before API call to respect rate limits...`, { verbose: true });
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const startTime = Date.now();
    
    // Use a much higher limit instead of 100, and remove any existing limit from the command
    const commandWithoutLimit = baseCommand.replace(/--limit\s+\d+/, '');
    const improvedCommand = `${commandWithoutLimit} --limit 1000`;
    
    await log(`   🔎 Executing: ${improvedCommand}`, { verbose: true });
    const output = execSync(improvedCommand, { encoding: 'utf8' });
    const endTime = Date.now();
    
    const issues = JSON.parse(output || '[]');
    
    await log(`   ✅ Fetched ${issues.length} issues in ${Math.round((endTime - startTime) / 1000)}s`);
    
    // If we got exactly 1000 results, there might be more - log a warning
    if (issues.length === 1000) {
      await log(`   ⚠️  Hit the 1000 issue limit - there may be more issues available`, { level: 'warning' });
      await log(`   💡 Consider filtering by labels or date ranges for repositories with >1000 open issues`, { level: 'info' });
    }
    
    // Add a 5-second delay after the call to be extra safe with rate limits
    await log(`   ⏰ Adding 5-second delay after API call to respect rate limits...`, { verbose: true });
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    return issues;
  } catch (error) {
    await log(`   ❌ Enhanced fetch failed: ${cleanErrorMessage(error)}`, { level: 'error' });
    
    // Fallback to original behavior with 100 limit
    try {
      await log(`   🔄 Falling back to default behavior...`, { verbose: true });
      const fallbackCommand = baseCommand.includes('--limit') ? baseCommand : `${baseCommand} --limit 100`;
      await new Promise(resolve => setTimeout(resolve, 2000)); // Shorter delay for fallback
      const output = execSync(fallbackCommand, { encoding: 'utf8' });
      const issues = JSON.parse(output || '[]');
      await log(`   ⚠️  Fallback: fetched ${issues.length} issues (limited to 100)`, { level: 'warning' });
      return issues;
    } catch (fallbackError) {
      await log(`   ❌ Fallback also failed: ${cleanErrorMessage(fallbackError)}`, { level: 'error' });
      return [];
    }
  }
};

// Helper function to clean up temporary directories
const cleanupTempDirectories = async () => {
  if (!argv.autoCleanup) {
    return;
  }
  
  try {
    await log(`\n🧹 Auto-cleanup enabled, removing temporary directories...`);
    await log(`   ⚠️  Executing: sudo rm -rf /tmp/* /var/tmp/*`, { verbose: true });
    
    // Execute cleanup command using command-stream
    const cleanupCommand = $`sudo rm -rf /tmp/* /var/tmp/*`;
    
    let exitCode = 0;
    for await (const chunk of cleanupCommand.stream()) {
      if (chunk.type === 'stderr') {
        const error = chunk.data.toString().trim();
        if (error && !error.includes('cannot remove')) { // Ignore "cannot remove" warnings for files in use
          await log(`   [cleanup WARNING] ${error}`, { level: 'warn', verbose: true });
        }
      } else if (chunk.type === 'exit') {
        exitCode = chunk.code;
      }
    }
    
    if (exitCode === 0) {
      await log(`   ✅ Temporary directories cleaned successfully`);
    } else {
      await log(`   ⚠️  Cleanup completed with warnings (exit code: ${exitCode})`, { level: 'warn' });
    }
  } catch (error) {
    await log(`   ❌ Error during cleanup: ${cleanErrorMessage(error)}`, { level: 'error' });
    // Don't fail the entire process if cleanup fails
  }
};

// Configure command line arguments
const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 <github-url> [options]')
  .positional('github-url', {
    type: 'string',
    description: 'GitHub organization, repository, or user URL to monitor'
  })
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
    description: 'Number of concurrent solve.mjs instances',
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
    description: 'Model to use for solve.mjs (opus or sonnet)',
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
  .option('force-claude-bun-run', {
    type: 'boolean',
    description: 'Experimental: Update Claude Node.js script to run with bun instead of node',
    default: false
  })
  .option('force-claude-nodejs-run', {
    type: 'boolean',
    description: 'Experimental: Restore Claude script to run with Node.js instead of bun',
    default: false
  })
  .help('h')
  .alias('h', 'help')
  .strict()
  .argv;

const githubUrl = argv._[0];

// Set global verbose mode
global.verboseMode = argv.verbose;

// Create log file with timestamp
const scriptDir = path.dirname(process.argv[1]);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
logFile = path.join(scriptDir, `hive-${timestamp}.log`);

// Create the log file immediately
await fs.writeFile(logFile, `# Hive.mjs Log - ${new Date().toISOString()}\n\n`);
await log(`📁 Log file: ${logFile}`);
await log(`   (All output will be logged here)`);

// Handle Claude runtime switching (experimental feature)
const handleClaudeRuntimeSwitch = async () => {
  if (argv['force-claude-bun-run']) {
    await log(`\n🔧 Switching Claude runtime to bun...`);
    try {
      // Check if bun is available
      try {
        await $`which bun`;
        await log(`   ✅ Bun runtime found`);
      } catch (bunError) {
        await log(`❌ Bun runtime not found. Please install bun first: https://bun.sh/`, { level: 'error' });
        process.exit(1);
      }
      
      // Find Claude executable path
      const claudePathResult = await $`which claude`;
      const claudePath = claudePathResult.stdout.toString().trim();
      
      if (!claudePath) {
        await log(`❌ Claude executable not found`, { level: 'error' });
        process.exit(1);
      }
      
      await log(`   Claude path: ${claudePath}`);
      
      // Check if file is writable
      try {
        await fs.access(claudePath, fs.constants.W_OK);
      } catch (accessError) {
        await log(`❌ Cannot write to Claude executable (permission denied)`, { level: 'error' });
        await log(`   Try running with sudo or changing file permissions`, { level: 'error' });
        process.exit(1);
      }
      
      // Read current shebang
      const firstLine = await $`head -1 "${claudePath}"`;
      const currentShebang = firstLine.stdout.toString().trim();
      await log(`   Current shebang: ${currentShebang}`);
      
      if (currentShebang.includes('bun')) {
        await log(`   ✅ Claude is already configured to use bun`);
        process.exit(0);
      }
      
      // Create backup
      const backupPath = `${claudePath}.nodejs-backup`;
      await $`cp "${claudePath}" "${backupPath}"`;
      await log(`   📦 Backup created: ${backupPath}`);
      
      // Read file content and replace shebang
      const content = await fs.readFile(claudePath, 'utf8');
      const newContent = content.replace(/^#!.*node.*$/m, '#!/usr/bin/env bun');
      
      if (content === newContent) {
        await log(`⚠️  No Node.js shebang found to replace`, { level: 'warning' });
        await log(`   Current shebang: ${currentShebang}`, { level: 'warning' });
        process.exit(0);
      }
      
      await fs.writeFile(claudePath, newContent);
      await log(`   ✅ Claude shebang updated to use bun`);
      await log(`   🔄 Claude will now run with bun runtime`);
      
    } catch (error) {
      await log(`❌ Failed to switch Claude to bun: ${error.message}`, { level: 'error' });
      process.exit(1);
    }
    
    // Exit after switching runtime
    process.exit(0);
  }
  
  if (argv['force-claude-nodejs-run']) {
    await log(`\n🔧 Restoring Claude runtime to Node.js...`);
    try {
      // Check if Node.js is available
      try {
        await $`which node`;
        await log(`   ✅ Node.js runtime found`);
      } catch (nodeError) {
        await log(`❌ Node.js runtime not found. Please install Node.js first`, { level: 'error' });
        process.exit(1);
      }
      
      // Find Claude executable path
      const claudePathResult = await $`which claude`;
      const claudePath = claudePathResult.stdout.toString().trim();
      
      if (!claudePath) {
        await log(`❌ Claude executable not found`, { level: 'error' });
        process.exit(1);
      }
      
      await log(`   Claude path: ${claudePath}`);
      
      // Check if file is writable
      try {
        await fs.access(claudePath, fs.constants.W_OK);
      } catch (accessError) {
        await log(`❌ Cannot write to Claude executable (permission denied)`, { level: 'error' });
        await log(`   Try running with sudo or changing file permissions`, { level: 'error' });
        process.exit(1);
      }
      
      // Read current shebang
      const firstLine = await $`head -1 "${claudePath}"`;
      const currentShebang = firstLine.stdout.toString().trim();
      await log(`   Current shebang: ${currentShebang}`);
      
      if (currentShebang.includes('node') && !currentShebang.includes('bun')) {
        await log(`   ✅ Claude is already configured to use Node.js`);
        process.exit(0);
      }
      
      // Check if backup exists
      const backupPath = `${claudePath}.nodejs-backup`;
      try {
        await fs.access(backupPath);
        // Restore from backup
        await $`cp "${backupPath}" "${claudePath}"`;
        await log(`   ✅ Restored Claude from backup: ${backupPath}`);
      } catch (backupError) {
        // No backup available, manually update shebang
        await log(`   📝 No backup found, manually updating shebang...`);
        const content = await fs.readFile(claudePath, 'utf8');
        const newContent = content.replace(/^#!.*bun.*$/m, '#!/usr/bin/env node');
        
        if (content === newContent) {
          await log(`⚠️  No bun shebang found to replace`, { level: 'warning' });
          await log(`   Current shebang: ${currentShebang}`, { level: 'warning' });
          process.exit(0);
        }
        
        await fs.writeFile(claudePath, newContent);
        await log(`   ✅ Claude shebang updated to use Node.js`);
      }
      
      await log(`   🔄 Claude will now run with Node.js runtime`);
      
    } catch (error) {
      await log(`❌ Failed to restore Claude to Node.js: ${error.message}`, { level: 'error' });
      process.exit(1);
    }
    
    // Exit after restoring runtime
    process.exit(0);
  }
};

// Execute Claude runtime switching if requested
await handleClaudeRuntimeSwitch();

// Validate GitHub URL requirement (unless using runtime switching options)
if (!githubUrl && !argv['force-claude-bun-run'] && !argv['force-claude-nodejs-run']) {
  await log(`❌ GitHub URL is required when not using Claude runtime switching options`, { level: 'error' });
  await log(`   Usage: hive <github-url> [options]`, { level: 'error' });
  await log(`   Or: hive --force-claude-bun-run (to switch Claude to bun)`, { level: 'error' });
  await log(`   Or: hive --force-claude-nodejs-run (to restore Claude to Node.js)`, { level: 'error' });
  process.exit(1);
}

// Helper function to check GitHub permissions and warn about missing scopes
const checkGitHubPermissions = async () => {
  try {
    await log(`\n🔐 Checking GitHub authentication and permissions...`);
    
    // Get auth status including token scopes
    const authStatusResult = await $`gh auth status 2>&1`;
    const authOutput = authStatusResult.stdout.toString() + authStatusResult.stderr.toString();
    
    if (authStatusResult.code !== 0 || authOutput.includes('not logged into any GitHub hosts')) {
      await log(`❌ GitHub authentication error: Not logged in`, { level: 'error' });
      await log(`   To fix this, run: gh auth login`, { level: 'error' });
      return false;
    }
    
    await log(`✅ GitHub authentication: OK`);
    
    // Parse the auth status output to extract token scopes
    const scopeMatch = authOutput.match(/Token scopes:\s*(.+)/);
    if (!scopeMatch) {
      await log(`⚠️  Warning: Could not determine token scopes from auth status`, { level: 'warning' });
      return true; // Continue despite not being able to check scopes
    }
    
    // Extract individual scopes from the format: 'scope1', 'scope2', 'scope3'
    const scopeString = scopeMatch[1];
    const scopes = scopeString.match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
    await log(`📋 Token scopes: ${scopes.join(', ')}`);
    
    // Check for important scopes and warn if missing
    const warnings = [];
    
    if (!scopes.includes('workflow')) {
      warnings.push({
        scope: 'workflow',
        issue: 'Cannot push changes to .github/workflows/ directory',
        solution: 'Run: gh auth refresh -h github.com -s workflow'
      });
    }
    
    if (!scopes.includes('repo')) {
      warnings.push({
        scope: 'repo',
        issue: 'Limited repository access (may not be able to create PRs or push to private repos)',
        solution: 'Run: gh auth refresh -h github.com -s repo'
      });
    }
    
    // Display warnings
    if (warnings.length > 0) {
      await log(`\n⚠️  Permission warnings detected:`, { level: 'warning' });
      
      for (const warning of warnings) {
        await log(`\n   Missing scope: '${warning.scope}'`, { level: 'warning' });
        await log(`   Impact: ${warning.issue}`, { level: 'warning' });
        await log(`   Solution: ${warning.solution}`, { level: 'warning' });
      }
      
      await log(`\n   💡 You can continue, but some operations may fail due to insufficient permissions.`, { level: 'warning' });
      await log(`   💡 To avoid issues, it's recommended to refresh your authentication with the missing scopes.`, { level: 'warning' });
    } else {
      await log(`✅ All required permissions: Available`);
    }
    
    return true;
  } catch (error) {
    await log(`⚠️  Warning: Could not check GitHub permissions: ${error.message}`, { level: 'warning' });
    await log(`   Continuing anyway, but some operations may fail if permissions are insufficient`, { level: 'warning' });
    return true; // Continue despite permission check failure
  }
};

// Check GitHub permissions early in the process
const hasValidAuth = await checkGitHubPermissions();
if (!hasValidAuth) {
  await log(`\n❌ Cannot proceed without valid GitHub authentication`, { level: 'error' });
  process.exit(1);
}

// Parse GitHub URL to determine organization, repository, or user
let scope = 'repository';
let owner = null;
let repo = null;

// Parse URL format: https://github.com/owner or https://github.com/owner/repo
const urlMatch = githubUrl.match(/^https:\/\/github\.com\/([^\/]+)(\/([^\/]+))?$/);
if (!urlMatch) {
  await log('Error: Invalid GitHub URL format', { level: 'error' });
  await log('Expected: https://github.com/owner or https://github.com/owner/repo', { level: 'error' });
  process.exit(1);
}

owner = urlMatch[1];
repo = urlMatch[3] || null;

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

await log(`🎯 Monitoring Configuration:`);
await log(`   📍 Target: ${scope.charAt(0).toUpperCase() + scope.slice(1)} - ${owner}${repo ? `/${repo}` : ''}`);
if (argv.allIssues) {
  await log(`   🏷️  Mode: ALL ISSUES (no label filter)`);
} else {
  await log(`   🏷️  Tag: "${argv.monitorTag}"`);
}
if (argv.skipIssuesWithPrs) {
  await log(`   🚫 Skipping: Issues with open PRs`);
}
await log(`   🔄 Concurrency: ${argv.concurrency} parallel workers`);
await log(`   📊 Pull Requests per Issue: ${argv.pullRequestsPerIssue}`);
await log(`   🤖 Model: ${argv.model}`);
if (argv.fork) {
  await log(`   🍴 Fork: ENABLED (will fork repos if no write access)`);
}
await log(`   ⏱️  Polling Interval: ${argv.interval} seconds`);
await log(`   ${argv.once ? '🚀 Mode: Single run' : '♾️  Mode: Continuous monitoring'}`);
if (argv.maxIssues > 0) {
  await log(`   🔢 Max Issues: ${argv.maxIssues}`);
}
if (argv.dryRun) {
  await log(`   🧪 DRY RUN MODE - No actual processing`);
}
if (argv.autoCleanup) {
  await log(`   🧹 Auto-cleanup: ENABLED (will clean /tmp/* /var/tmp/* on success)`);
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
          await log(`   🧪 [DRY RUN] Would execute: ./solve.mjs "${issueUrl}" --model ${argv.model}${forkFlag}`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate work
        } else {
          // Execute solve.mjs using command-stream
          await log(`   🚀 Executing solve.mjs for ${issueUrl}...`);
          
          const startTime = Date.now();
          const forkFlag = argv.fork ? ' --fork' : '';
          const solveCommand = $`./solve.mjs "${issueUrl}" --model ${argv.model}${forkFlag}`;
          
          // Stream output and capture result
          let exitCode = 0;
          for await (const chunk of solveCommand.stream()) {
            if (chunk.type === 'stdout') {
              const output = chunk.data.toString().trim();
              if (output) {
                await log(`   [solve.mjs] ${output}`, { verbose: true });
              }
            } else if (chunk.type === 'stderr') {
              const error = chunk.data.toString().trim();
              if (error) {
                await log(`   [solve.mjs ERROR] ${error}`, { level: 'error', verbose: true });
              }
            } else if (chunk.type === 'exit') {
              exitCode = chunk.code;
            }
          }
          
          const duration = Math.round((Date.now() - startTime) / 1000);
          
          if (exitCode === 0) {
            await log(`   ✅ Worker ${workerId} completed ${issueUrl} (${duration}s)`);
          } else {
            throw new Error(`solve.mjs exited with code ${exitCode}`);
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
async function hasOpenPullRequests(issueUrl) {
  try {
    const { execSync } = await import('child_process');
    
    // Extract owner, repo, and issue number from URL
    const urlMatch = issueUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/);
    if (!urlMatch) return false;
    
    const [, issueOwner, issueRepo, issueNumber] = urlMatch;
    
    // Check for linked PRs using GitHub API
    const cmd = `gh api repos/${issueOwner}/${issueRepo}/issues/${issueNumber}/timeline --jq '[.[] | select(.event == "cross-referenced" and .source.issue.pull_request != null and .source.issue.state == "open")] | length'`;
    
    const output = execSync(cmd, { encoding: 'utf8' }).trim();
    const openPrCount = parseInt(output) || 0;
    
    if (openPrCount > 0) {
      await log(`      ↳ Skipping (has ${openPrCount} open PR${openPrCount > 1 ? 's' : ''})`, { verbose: true });
      return true;
    }
    
    return false;
  } catch (error) {
    // If we can't check, assume no PRs
    await log(`      ↳ Could not check for PRs: ${cleanErrorMessage(error)}`, { verbose: true });
    return false;
  }
}

// Function to fetch issues from GitHub
async function fetchIssues() {
  if (argv.allIssues) {
    await log(`\n🔍 Fetching ALL open issues...`);
  } else {
    await log(`\n🔍 Fetching issues with label "${argv.monitorTag}"...`);
  }
  
  try {
    let issues = [];
    
    if (argv.allIssues) {
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
      
      await log(`   🔎 Fetching all issues with pagination and rate limiting...`);
      await log(`   🔎 Command: ${searchCmd}`, { verbose: true });
      
      issues = await fetchAllIssuesWithPagination(searchCmd);
      
    } else {
      // Use label filter
      const { execSync } = await import('child_process');
      
      // For repositories, use gh issue list which works better with new repos
      if (scope === 'repository') {
        const listCmd = `gh issue list --repo ${owner}/${repo} --state open --label "${argv.monitorTag}" --json url,title,number`;
        await log(`   🔎 Fetching labeled issues with pagination and rate limiting...`);
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
        
        await log(`   🔎 Fetching labeled issues with pagination and rate limiting...`);
        await log(`   🔎 Search query: ${searchQuery}`, { verbose: true });
        await log(`   🔎 Command: ${searchCmd}`, { verbose: true });
        
        try {
          issues = await fetchAllIssuesWithPagination(searchCmd);
        } catch (searchError) {
          await log(`   ⚠️  Search failed: ${cleanErrorMessage(searchError)}`, { verbose: true });
          issues = [];
        }
      }
    }
    
    if (issues.length === 0) {
      if (argv.allIssues) {
        await log(`   ℹ️  No open issues found`);
      } else {
        await log(`   ℹ️  No issues found with label "${argv.monitorTag}"`);
      }
      return [];
    }
    
    if (argv.allIssues) {
      await log(`   📋 Found ${issues.length} open issue(s)`);
    } else {
      await log(`   📋 Found ${issues.length} issue(s) with label "${argv.monitorTag}"`);
    }
    
    // Filter out issues with open PRs if option is enabled
    let issuesToProcess = issues;
    if (argv.skipIssuesWithPrs) {
      await log(`   🔍 Checking for existing pull requests...`);
      const filteredIssues = [];
      
      for (const issue of issuesToProcess) {
        const hasPr = await hasOpenPullRequests(issue.url);
        if (hasPr) {
          await log(`      ⏭️  Skipping (has PR): ${issue.title || 'Untitled'} (${issue.url})`, { verbose: true });
        } else {
          filteredIssues.push(issue);
        }
      }
      
      const skippedCount = issuesToProcess.length - filteredIssues.length;
      if (skippedCount > 0) {
        await log(`   ⏭️  Skipped ${skippedCount} issue(s) with existing pull requests`);
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
      await log(`\n   📝 Issues that would be processed:`);
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
  await log(`\n🚀 Starting Hive Mind monitoring system...`);
  
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
      await log(`   ℹ️  No new issues to add (all already processed or in queue)`);
    }
    
    // Show current stats
    const stats = issueQueue.getStats();
    await log(`\n📊 Current Status:`);
    await log(`   📋 Queued: ${stats.queued}`);
    await log(`   ⚙️  Processing: ${stats.processing}`);
    await log(`   ✅ Completed: ${stats.completed}`);
    await log(`   ❌ Failed: ${stats.failed}`);
    
    // If running once, wait for queue to empty then exit
    if (argv.once) {
      await log(`\n🏁 Single run mode - waiting for queue to empty...`);
      
      while (stats.queued > 0 || stats.processing > 0) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const currentStats = issueQueue.getStats();
        if (currentStats.queued !== stats.queued || currentStats.processing !== stats.processing) {
          await log(`   ⏳ Waiting... Queue: ${currentStats.queued}, Processing: ${currentStats.processing}`);
        }
        Object.assign(stats, currentStats);
      }
      
      await log(`\n✅ All issues processed!`);
      await log(`   Completed: ${stats.completed}`);
      await log(`   Failed: ${stats.failed}`);
      
      // Perform cleanup if enabled and there were successful completions
      if (stats.completed > 0) {
        await cleanupTempDirectories();
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
  
  await log(`\n👋 Hive Mind monitoring stopped`);
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
      await cleanupTempDirectories();
    }
    
    await log(`   ✅ Shutdown complete`);
    
  } catch (error) {
    await log(`   ⚠️  Error during shutdown: ${cleanErrorMessage(error)}`, { level: 'error' });
  }
  
  process.exit(0);
}

// Function to validate Claude CLI connection
const validateClaudeConnection = async () => {
  try {
    await log(`🔍 Validating Claude CLI connection...`);
    
    // First try a quick validation approach
    try {
      // Check if Claude CLI is installed and get version
      const versionResult = await $`timeout 10 claude --version`;
      if (versionResult.code === 0) {
        const version = versionResult.stdout?.toString().trim();
        await log(`📦 Claude CLI version: ${version}`);
      }
    } catch (versionError) {
      // Version check failed, but we'll continue with the main validation
      await log(`⚠️  Claude CLI version check failed (${versionError.code}), proceeding with connection test...`);
    }
    
    let result;
    try {
      // Primary validation: use printf piping which is faster and more reliable
      result = await $`printf hi | claude -p`;
    } catch (pipeError) {
      // If piping fails, fallback to the timeout approach as last resort
      await log(`⚠️  Pipe validation failed (${pipeError.code}), trying timeout approach...`);
      try {
        result = await $`timeout 60 claude -p hi`;
      } catch (timeoutError) {
        if (timeoutError.code === 124) {
          await log(`❌ Claude CLI timed out after 60 seconds`, { level: 'error' });
          await log(`   💡 This may indicate Claude CLI is taking too long to respond`, { level: 'error' });
          await log(`   💡 Try running 'claude -p hi' manually to verify it works`, { level: 'error' });
          return false;
        }
        // Re-throw if it's not a timeout error
        throw timeoutError;
      }
    }
    
    // Check for common error patterns
    const stdout = result.stdout?.toString() || '';
    const stderr = result.stderr?.toString() || '';
    
    // Check for JSON errors in stdout or stderr
    const checkForJsonError = (text) => {
      try {
        // Look for JSON error patterns
        if (text.includes('"error"') && text.includes('"type"')) {
          const jsonMatch = text.match(/\{.*"error".*\}/);
          if (jsonMatch) {
            const errorObj = JSON.parse(jsonMatch[0]);
            return errorObj.error;
          }
        }
      } catch (e) {
        // Not valid JSON, continue with other checks
      }
      return null;
    };
    
    const jsonError = checkForJsonError(stdout) || checkForJsonError(stderr);
    
    // Use exitCode if code is undefined (Bun shell behavior)
    const exitCode = result.code ?? result.exitCode ?? 0;
    
    if (exitCode !== 0) {
      // Command failed
      if (jsonError) {
        await log(`❌ Claude CLI authentication failed: ${jsonError.type} - ${jsonError.message}`, { level: 'error' });
      } else {
        await log(`❌ Claude CLI failed with exit code ${exitCode}`, { level: 'error' });
        if (stderr) await log(`   Error: ${stderr.trim()}`, { level: 'error' });
      }
      
      if (stderr.includes('Please run /login') || (jsonError && jsonError.type === 'forbidden')) {
        await log('   💡 Please run: claude login', { level: 'error' });
      }
      
      return false;
    }
    
    // Check for error patterns in successful response
    if (jsonError) {
      await log(`❌ Claude CLI returned error: ${jsonError.type} - ${jsonError.message}`, { level: 'error' });
      if (jsonError.type === 'forbidden') {
        await log('   💡 Please run: claude login', { level: 'error' });
      }
      return false;
    }
    
    // Success - Claude responded (LLM responses are probabilistic, so any response is good)
    await log(`✅ Claude CLI connection validated successfully`);
    return true;
    
  } catch (error) {
    await log(`❌ Failed to validate Claude CLI connection: ${cleanErrorMessage(error)}`, { level: 'error' });
    await log('   💡 Make sure Claude CLI is installed and accessible', { level: 'error' });
    return false;
  }
};

// Handle graceful shutdown
process.on('SIGINT', () => gracefulShutdown('interrupt'));
process.on('SIGTERM', () => gracefulShutdown('termination'));

// Check disk space before starting monitoring
const hasEnoughSpace = await checkDiskSpace(argv.minDiskSpace || 500);
if (!hasEnoughSpace) {
  process.exit(1);
}

// Validate Claude CLI connection before starting monitoring
const isClaudeConnected = await validateClaudeConnection();
if (!isClaudeConnected) {
  await log(`❌ Cannot start monitoring without Claude CLI connection`, { level: 'error' });
  process.exit(1);
}

// Start monitoring
try {
  await monitor();
} catch (error) {
  await log(`\n❌ Fatal error: ${cleanErrorMessage(error)}`, { level: 'error' });
  process.exit(1);
}