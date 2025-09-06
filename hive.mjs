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

// Configure command line arguments
const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 <github-url> [options]')
  .positional('github-url', {
    type: 'string',
    description: 'GitHub organization or repository URL to monitor'
  })
  .option('monitor-tag', {
    type: 'string',
    description: 'GitHub label to monitor for issues',
    default: 'help wanted',
    alias: 't'
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
  .demandCommand(1, 'GitHub URL is required')
  .help('h')
  .alias('h', 'help')
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
await log(`   (All output will be logged here)\n`);

// Parse GitHub URL to determine organization or repository
let isOrg = false;
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
isOrg = !repo;

await log(`🎯 Monitoring Configuration:`);
await log(`   📍 Target: ${isOrg ? 'Organization' : 'Repository'} - ${owner}${repo ? `/${repo}` : ''}`);
await log(`   🏷️  Tag: "${argv.monitorTag}"`);
await log(`   🔄 Concurrency: ${argv.concurrency} parallel workers`);
await log(`   📊 Pull Requests per Issue: ${argv.pullRequestsPerIssue}`);
await log(`   🤖 Model: ${argv.model}`);
await log(`   ⏱️  Polling Interval: ${argv.interval} seconds`);
await log(`   ${argv.once ? '🚀 Mode: Single run' : '♾️  Mode: Continuous monitoring'}`);
if (argv.maxIssues > 0) {
  await log(`   🔢 Max Issues: ${argv.maxIssues}`);
}
if (argv.dryRun) {
  await log(`   🧪 DRY RUN MODE - No actual processing`);
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
    
    // Process the issue multiple times if needed
    for (let prNum = 1; prNum <= argv.pullRequestsPerIssue; prNum++) {
      if (argv.pullRequestsPerIssue > 1) {
        await log(`   📝 Creating PR ${prNum}/${argv.pullRequestsPerIssue} for issue`);
      }
      
      try {
        if (argv.dryRun) {
          await log(`   🧪 [DRY RUN] Would execute: ./solve.mjs "${issueUrl}" --model ${argv.model}`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate work
        } else {
          // Execute solve.mjs using command-stream
          await log(`   🚀 Executing solve.mjs for ${issueUrl}...`);
          
          const startTime = Date.now();
          const solveCommand = $`./solve.mjs "${issueUrl}" --model ${argv.model}`;
          
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
        await log(`   ❌ Worker ${workerId} failed on ${issueUrl}: ${error.message}`, { level: 'error' });
        issueQueue.markFailed(issueUrl);
        break; // Stop trying more PRs for this issue
      }
    }
    
    issueQueue.markCompleted(issueUrl);
    
    // Show queue stats
    const stats = issueQueue.getStats();
    await log(`   📊 Queue: ${stats.queued} waiting, ${stats.processing} processing, ${stats.completed} completed, ${stats.failed} failed`);
  }
  
  await log(`🔧 Worker ${workerId} stopped`, { verbose: true });
}

// Function to fetch issues from GitHub
async function fetchIssues() {
  await log(`\n🔍 Fetching issues with label "${argv.monitorTag}"...`);
  
  try {
    // Build search query components
    let searchArgs = [];
    if (isOrg) {
      searchArgs.push(`org:${owner}`);
    } else {
      searchArgs.push(`repo:${owner}/${repo}`);
    }
    searchArgs.push('is:issue', 'is:open', `label:"${argv.monitorTag}"`);
    
    const searchQuery = searchArgs.join(' ');
    await log(`   🔎 Search query: ${searchQuery}`, { verbose: true });
    
    // Use command-stream with array arguments to avoid shell escaping issues
    const searchResult = await $`gh search issues ${searchArgs} --limit 100 --json url,title,number,repository`;
    
    if (searchResult.code !== 0) {
      throw new Error(`Failed to search issues: ${searchResult.stderr}`);
    }
    
    const searchOutput = searchResult.stdout.toString();
    
    const issues = JSON.parse(searchOutput || '[]');
    
    if (issues.length === 0) {
      await log(`   ℹ️  No issues found with label "${argv.monitorTag}"`);
      return [];
    }
    
    await log(`   📋 Found ${issues.length} issue(s) with label "${argv.monitorTag}"`);
    
    // Apply max issues limit if set
    let issuesToProcess = issues;
    if (argv.maxIssues > 0 && issues.length > argv.maxIssues) {
      issuesToProcess = issues.slice(0, argv.maxIssues);
      await log(`   🔢 Limiting to first ${argv.maxIssues} issues`);
    }
    
    return issuesToProcess.map(issue => issue.url);
    
  } catch (error) {
    await log(`   ❌ Error fetching issues: ${error.message}`, { level: 'error' });
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
      break;
    }
    
    // Wait for next iteration
    await log(`\n⏰ Next check in ${argv.interval} seconds...`);
    await new Promise(resolve => setTimeout(resolve, argv.interval * 1000));
  }
  
  // Stop workers
  issueQueue.stop();
  await Promise.all(issueQueue.workers);
  
  await log(`\n👋 Hive Mind monitoring stopped`);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await log('\n\n🛑 Received interrupt signal, shutting down gracefully...');
  issueQueue.stop();
  await Promise.all(issueQueue.workers);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await log('\n\n🛑 Received termination signal, shutting down gracefully...');
  issueQueue.stop();
  await Promise.all(issueQueue.workers);
  process.exit(0);
});

// Start monitoring
try {
  await monitor();
} catch (error) {
  await log(`\n❌ Fatal error: ${error.message}`, { level: 'error' });
  process.exit(1);
}