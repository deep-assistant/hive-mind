#!/usr/bin/env node

// Early exit paths - handle these before loading all modules to speed up testing
const earlyArgs = process.argv.slice(2);

// Handle version early
if (earlyArgs.includes('--version')) {
  // Quick version output without loading modules
  console.log('0.3.1');
  process.exit(0);
}

// Handle help early
if (earlyArgs.includes('--help') || earlyArgs.includes('-h')) {
  // Load minimal modules needed for help
  const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
  globalThis.use = use;
  const config = await import('./solve.config.lib.mjs');
  const { initializeConfig, createYargsConfig } = config;
  const { yargs, hideBin } = await initializeConfig(use);
  const rawArgs = hideBin(process.argv);
  createYargsConfig(yargs(rawArgs)).showHelp();
  process.exit(0);
}

// Handle no arguments early
if (earlyArgs.length === 0) {
  console.error('Usage: solve.mjs <issue-url> [options]');
  console.error('\nError: Missing required github issue or pull request URL');
  console.error('\nRun "solve.mjs --help" for more information');
  process.exit(1);
}

// Handle invalid URL format early (basic check)
const firstArg = earlyArgs[0];
if (!firstArg.startsWith('-') && !firstArg.startsWith('https://github.com/')) {
  console.error(`Error: Invalid GitHub URL format: ${firstArg}`);
  console.error('Expected format: https://github.com/{owner}/{repo}/issues/{number} or https://github.com/{owner}/{repo}/pull/{number}');
  process.exit(1);
}

// Now load all modules for normal operation
// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Set use globally so imported modules can access it
globalThis.use = use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Import CLI configuration module
const config = await import('./solve.config.lib.mjs');
const { initializeConfig, parseArguments, createYargsConfig } = config;

// Initialize yargs and hideBin using the shared 'use' function
const { yargs, hideBin } = await initializeConfig(use);

const os = (await use('os')).default;
const path = (await use('path')).default;
const fs = (await use('fs')).promises;
const crypto = (await use('crypto')).default;

// Import memory check functions (RAM, swap, disk)
const memoryCheck = await import('./memory-check.mjs');

// Import shared library functions
const lib = await import('./lib.mjs');
const { 
  log, 
  setLogFile,
  getLogFile,
  cleanErrorMessage,
  formatAligned
} = lib;

// Import GitHub-related functions
const githubLib = await import('./github.lib.mjs');
const {
  sanitizeLogContent,
  checkFileInBranch,
  checkGitHubPermissions,
  attachLogToGitHub
} = githubLib;

// Import Claude-related functions
const claudeLib = await import('./claude.lib.mjs');
const {
  validateClaudeConnection
} = claudeLib;

// Import validation functions
const validation = await import('./solve.validation.lib.mjs');
const {
  validateGitHubUrl,
  showAttachLogsWarning,
  initializeLogFile,
  validateUrlRequirement,
  validateContinueOnlyOnFeedback,
  performSystemChecks,
  parseUrlComponents,
  parseResetTime,
  calculateWaitTime
} = validation;

// Import auto-continue functions
const autoContinue = await import('./solve.auto-continue.lib.mjs');
const {
  autoContinueWhenLimitResets,
  checkExistingPRsForAutoContinue,
  processPRMode
} = autoContinue;

// Import repository management functions
const repository = await import('./solve.repository.lib.mjs');
const {
  setupTempDirectory,
  setupRepository,
  cloneRepository,
  setupUpstreamAndSync,
  cleanupTempDirectory
} = repository;

// Import results processing functions
const results = await import('./solve.results.lib.mjs');
const {
  cleanupClaudeFile,
  showSessionSummary,
  verifyResults,
  handleExecutionError
} = results;

// Import Claude execution functions
const claudeExecution = await import('./solve.claude-execution.lib.mjs');
const {
  executeClaudeCommand,
  checkForUncommittedChanges
} = claudeExecution;

// Import feedback detection functions
const feedback = await import('./solve.feedback.lib.mjs');
const {
  detectAndCountFeedback
} = feedback;

// solve-helpers.mjs is no longer needed - functions moved to lib.mjs and github.lib.mjs

// Global log file reference (will be passed to lib.mjs)

// Use getResourceSnapshot from memory-check module
const getResourceSnapshot = memoryCheck.getResourceSnapshot;

// Parse command line arguments using the config module
const argv = await parseArguments(yargs, hideBin);

const issueUrl = argv._[0];

// Set global verbose mode for log function
global.verboseMode = argv.verbose;

// Validate GitHub URL using validation module (more thorough check)
const urlValidation = validateGitHubUrl(issueUrl);
if (issueUrl && !urlValidation.isValid) {
  process.exit(1);
}
const { isIssueUrl, isPrUrl } = urlValidation;

// Debug logging for attach-logs option
if (argv.verbose) {
  await log(`Debug: argv.attachLogs = ${argv.attachLogs}`, { verbose: true });
  await log(`Debug: argv["attach-logs"] = ${argv['attach-logs']}`, { verbose: true });
}

// Show security warning and initialize log file using validation module
const shouldAttachLogs = argv.attachLogs || argv['attach-logs'];
await showAttachLogsWarning(shouldAttachLogs);
const logFile = await initializeLogFile(argv.logDir);

// Validate GitHub URL requirement and options using validation module
if (!(await validateUrlRequirement(issueUrl))) {
  process.exit(1);
}

if (!(await validateContinueOnlyOnFeedback(argv, isPrUrl, isIssueUrl))) {
  process.exit(1);
}

// Perform all system checks using validation module
// Skip Claude validation in dry-run mode since we won't actually run Claude
if (!(await performSystemChecks(argv.minDiskSpace || 500, argv.dryRun))) {
  process.exit(1);
}

// URL validation debug logging
if (argv.verbose) {
  await log('📋 URL validation:', { verbose: true });
  await log(`   Input URL: ${issueUrl}`, { verbose: true });
  await log(`   Is Issue URL: ${!!isIssueUrl}`, { verbose: true });
  await log(`   Is PR URL: ${!!isPrUrl}`, { verbose: true });
}

const claudePath = process.env.CLAUDE_PATH || 'claude';

// Parse URL components using validation module
const { owner, repo, urlNumber } = parseUrlComponents(issueUrl);

// Determine mode and get issue details
let issueNumber;
let prNumber;
let prBranch;
let mergeStateStatus;
let isForkPR = false;
let isContinueMode = false;

// Auto-continue logic: check for existing PRs if --auto-continue is enabled
if (argv.autoContinue && isIssueUrl) {
  issueNumber = urlNumber;
  await log(`🔍 Auto-continue enabled: Checking for existing PRs for issue #${issueNumber}...`);
  
  try {
    // Get all PRs linked to this issue
    const prListResult = await $`gh pr list --repo ${owner}/${repo} --search "linked:issue-${issueNumber}" --json number,createdAt,headRefName,isDraft,state --limit 10`;
    
    if (prListResult.code === 0) {
      const prs = JSON.parse(prListResult.stdout.toString().trim() || '[]');
      
      if (prs.length > 0) {
        await log(`📋 Found ${prs.length} existing PR(s) linked to issue #${issueNumber}`);
        
        // Find PRs that are older than 24 hours
        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        
        for (const pr of prs) {
          const createdAt = new Date(pr.createdAt);
          const ageHours = Math.floor((now - createdAt) / (1000 * 60 * 60));
          
          await log(`  PR #${pr.number}: created ${ageHours}h ago (${pr.state}, ${pr.isDraft ? 'draft' : 'ready'})`);
          
          // Check if PR is open (not closed)
          if (pr.state === 'OPEN') {
            // Check if CLAUDE.md exists in this PR branch
            const claudeMdExists = await checkFileInBranch(owner, repo, 'CLAUDE.md', pr.headRefName);
            
            if (!claudeMdExists) {
              await log(`✅ Auto-continue: Using PR #${pr.number} (CLAUDE.md missing - work completed, branch: ${pr.headRefName})`);
              
              // Switch to continue mode immediately (don't wait 24 hours if CLAUDE.md is missing)
              isContinueMode = true;
              prNumber = pr.number;
              prBranch = pr.headRefName;
              if (argv.verbose) {
                await log('   Continue mode activated: Auto-continue (CLAUDE.md missing)', { verbose: true });
                await log(`   PR Number: ${prNumber}`, { verbose: true });
                await log(`   PR Branch: ${prBranch}`, { verbose: true });
              }
              break;
            } else if (createdAt < twentyFourHoursAgo) {
              await log(`✅ Auto-continue: Using PR #${pr.number} (created ${ageHours}h ago, branch: ${pr.headRefName})`);
              
              // Switch to continue mode
              isContinueMode = true;
              prNumber = pr.number;
              prBranch = pr.headRefName;
              if (argv.verbose) {
                await log('   Continue mode activated: Auto-continue (24h+ old PR)', { verbose: true });
                await log(`   PR Number: ${prNumber}`, { verbose: true });
                await log(`   PR Branch: ${prBranch}`, { verbose: true });
                await log(`   PR Age: ${ageHours} hours`, { verbose: true });
              }
              break;
            } else {
              await log(`  PR #${pr.number}: CLAUDE.md exists, age ${ageHours}h < 24h - skipping`);
            }
          }
        }
        
        if (!isContinueMode) {
          await log('⏭️  No suitable PRs found (missing CLAUDE.md or older than 24h) - creating new PR as usual');
        }
      } else {
        await log(`📝 No existing PRs found for issue #${issueNumber} - creating new PR`);
      }
    }
  } catch (prSearchError) {
    await log(`⚠️  Warning: Could not search for existing PRs: ${prSearchError.message}`, { level: 'warning' });
    await log('   Continuing with normal flow...');
  }
}

if (isPrUrl) {
  isContinueMode = true;
  prNumber = urlNumber;
  
  await log(`🔄 Continue mode: Working with PR #${prNumber}`);
  if (argv.verbose) {
    await log('   Continue mode activated: PR URL provided directly', { verbose: true });
    await log(`   PR Number set to: ${prNumber}`, { verbose: true });
    await log('   Will fetch PR details and linked issue', { verbose: true });
  }
  
  // Get PR details to find the linked issue and branch
  try {
    const prResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json headRefName,body,number,mergeStateStatus,headRepositoryOwner`;
    
    if (prResult.code !== 0) {
      await log('Error: Failed to get PR details', { level: 'error' });
      await log(`Error: ${prResult.stderr ? prResult.stderr.toString() : 'Unknown error'}`, { level: 'error' });
      process.exit(1);
    }
    
    const prData = JSON.parse(prResult.stdout.toString());
    prBranch = prData.headRefName;
    mergeStateStatus = prData.mergeStateStatus;

    // Check if this is a fork PR
    isForkPR = prData.headRepositoryOwner && prData.headRepositoryOwner.login !== owner;

    await log(`📝 PR branch: ${prBranch}`);
    
    // Extract issue number from PR body (look for "fixes #123", "closes #123", etc.)
    const prBody = prData.body || '';
    const issueMatch = prBody.match(/(?:fixes|closes|resolves)\s+(?:.*?[/#])?(\d+)/i);
    
    if (issueMatch) {
      issueNumber = issueMatch[1];
      await log(`🔗 Found linked issue #${issueNumber}`);
    } else {
      // If no linked issue found, we can still continue but warn
      await log('⚠️  Warning: No linked issue found in PR body', { level: 'warning' });
      await log('   The PR should contain "Fixes #123" or similar to link an issue', { level: 'warning' });
      // Set issueNumber to PR number as fallback
      issueNumber = prNumber;
    }
  } catch (error) {
    await log(`Error: Failed to process PR: ${cleanErrorMessage(error)}`, { level: 'error' });
    process.exit(1);
  }
} else {
  // Traditional issue mode
  issueNumber = urlNumber;
  await log(`📝 Issue mode: Working with issue #${issueNumber}`);
}

// Create or find temporary directory for cloning the repository
const { tempDir, isResuming } = await setupTempDirectory(argv);

// Initialize limitReached variable outside try block for finally clause
let limitReached = false;

try {
  // Set up repository and handle forking
  const { repoToClone, forkedRepo, upstreamRemote } = await setupRepository(argv, owner, repo);

  // Clone repository and set up remotes
  await cloneRepository(repoToClone, tempDir, argv, owner, repo);
  // Set up upstream remote and sync fork if needed
  await setupUpstreamAndSync(tempDir, forkedRepo, upstreamRemote, owner, repo);

  // Set up git authentication using gh
  const authSetupResult = await $({ cwd: tempDir })`gh auth setup-git 2>&1`;
  if (authSetupResult.code !== 0) {
    await log('Note: gh auth setup-git had issues, continuing anyway\n');
  }

  // Verify we're on the default branch and get its name
  const defaultBranchResult = await $({ cwd: tempDir })`git branch --show-current`;
  
  if (defaultBranchResult.code !== 0) {
    await log('Error: Failed to get current branch');
    await log(defaultBranchResult.stderr ? defaultBranchResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }

  const defaultBranch = defaultBranchResult.stdout.toString().trim();
  if (!defaultBranch) {
    await log('');
    await log(`${formatAligned('❌', 'DEFAULT BRANCH DETECTION FAILED', '')}`, { level: 'error' });
    await log('');
    await log('  🔍 What happened:');
    await log('     Unable to determine the repository\'s default branch.');
    await log('');
    await log('  💡 This might mean:');
    await log('     • Repository is empty (no commits)');
    await log('     • Unusual repository configuration');
    await log('     • Git command issues');
    await log('');
    await log('  🔧 How to fix:');
    await log(`     1. Check repository: gh repo view ${owner}/${repo}`);
    await log(`     2. Verify locally: cd ${tempDir} && git branch`);
    await log(`     3. Check remote: cd ${tempDir} && git branch -r`);
    await log('');
    process.exit(1);
  }
  await log(`\n${formatAligned('📌', 'Default branch:', defaultBranch)}`);

  // Ensure we're on a clean default branch
  const statusResult = await $({ cwd: tempDir })`git status --porcelain`;

  if (statusResult.code !== 0) {
    await log('Error: Failed to check git status');
    await log(statusResult.stderr ? statusResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }
  
  // Note: Empty output means clean working directory
  const statusOutput = statusResult.stdout.toString().trim();
  if (statusOutput) {
    await log('Error: Repository has uncommitted changes after clone');
    await log(`Status output: ${statusOutput}`);
    process.exit(1);
  }

  // Create a branch for the issue or checkout existing PR branch
  let branchName;
  let checkoutResult;
  
  if (isContinueMode && prBranch) {
    // Continue mode: checkout existing PR branch
    branchName = prBranch;
    await log(`\n${formatAligned('🔄', 'Checking out PR branch:', branchName)}`);
    
    // First fetch all branches from remote
    await log(`${formatAligned('📥', 'Fetching branches:', 'From remote...')}`);
    const fetchResult = await $({ cwd: tempDir })`git fetch origin`;
    
    if (fetchResult.code !== 0) {
      await log('Warning: Failed to fetch branches from remote', { level: 'warning' });
    }
    
    // Checkout the PR branch (it might exist locally or remotely)
    const localBranchResult = await $({ cwd: tempDir })`git show-ref --verify --quiet refs/heads/${branchName}`;
    
    if (localBranchResult.code === 0) {
      // Branch exists locally
      checkoutResult = await $({ cwd: tempDir })`git checkout ${branchName}`;
    } else {
      // Branch doesn't exist locally, try to checkout from remote
      checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName} origin/${branchName}`;
    }
  } else {
    // Traditional mode: create new branch for issue
    const randomHex = crypto.randomBytes(4).toString('hex');
    branchName = `issue-${issueNumber}-${randomHex}`;
    await log(`\n${formatAligned('🌿', 'Creating branch:', `${branchName} from ${defaultBranch}`)}`);
    
    // IMPORTANT: Don't use 2>&1 here as it can interfere with exit codes
    // Git checkout -b outputs to stderr but that's normal
    checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName}`;
  }

  if (checkoutResult.code !== 0) {
    const errorOutput = (checkoutResult.stderr || checkoutResult.stdout || 'Unknown error').toString().trim();
    await log('');
    
    if (isContinueMode) {
      await log(`${formatAligned('❌', 'BRANCH CHECKOUT FAILED', '')}`, { level: 'error' });
      await log('');
      await log('  🔍 What happened:');
      await log(`     Unable to checkout PR branch '${branchName}'.`);
      await log('');
      await log('  📦 Git output:');
      for (const line of errorOutput.split('\n')) {
        await log(`     ${line}`);
      }
      await log('');
      await log('  💡 Possible causes:');
      await log('     • PR branch doesn\'t exist on remote');
      await log('     • Network connectivity issues');
      await log('     • Permission denied to fetch branches');
      if (isForkPR) {
        await log('     • This is a forked PR - branch is in the fork, not the main repo');
      }
      await log('');
      await log('  🔧 How to fix:');
      if (isForkPR) {
        await log('     1. Use --fork option (RECOMMENDED for forked PRs):');
        await log(`        ./solve.mjs "${issueUrl}" --fork`);
        await log('        This will create a fork and work from there.');
        await log('');
        await log('     2. Alternative diagnostic steps:');
        await log(`        • Verify PR branch exists: gh pr view ${prNumber} --repo ${owner}/${repo}`);
        await log(`        • Check remote branches: cd ${tempDir} && git branch -r`);
        await log(`        • Try fetching manually: cd ${tempDir} && git fetch origin`);
      } else {
        await log(`     1. Verify PR branch exists: gh pr view ${prNumber} --repo ${owner}/${repo}`);
        await log(`     2. Check remote branches: cd ${tempDir} && git branch -r`);
        await log(`     3. Try fetching manually: cd ${tempDir} && git fetch origin`);
      }
    } else {
      await log(`${formatAligned('❌', 'BRANCH CREATION FAILED', '')}`, { level: 'error' });
      await log('');
      await log('  🔍 What happened:');
      await log(`     Unable to create branch '${branchName}'.`);
      await log('');
      await log('  📦 Git output:');
      for (const line of errorOutput.split('\n')) {
        await log(`     ${line}`);
      }
      await log('');
      await log('  💡 Possible causes:');
      await log('     • Branch name already exists');
      await log('     • Uncommitted changes in repository');
      await log('     • Git configuration issues');
      await log('');
      await log('  🔧 How to fix:');
      await log('     1. Try running the command again (uses random names)');
      await log(`     2. Check git status: cd ${tempDir} && git status`);
      await log(`     3. View existing branches: cd ${tempDir} && git branch -a`);
    }
    
    await log('');
    await log(`  📂 Working directory: ${tempDir}`);
    process.exit(1);
  }
  
  // CRITICAL: Verify the branch was checked out and we switched to it
  await log(`${formatAligned('🔍', 'Verifying:', isContinueMode ? 'Branch checkout...' : 'Branch creation...')}`);
  const verifyResult = await $({ cwd: tempDir })`git branch --show-current`;
  
  if (verifyResult.code !== 0 || !verifyResult.stdout) {
    await log('');
    await log(`${formatAligned('❌', 'BRANCH VERIFICATION FAILED', '')}`, { level: 'error' });
    await log('');
    await log('  🔍 What happened:');
    await log(`     Unable to verify branch after ${isContinueMode ? 'checkout' : 'creation'} attempt.`);
    await log('');
    await log('  🔧 Debug commands to try:');
    await log(`     cd ${tempDir} && git branch -a`);
    await log(`     cd ${tempDir} && git status`);
    await log('');
    process.exit(1);
  }
  
  const actualBranch = verifyResult.stdout.toString().trim();
  if (actualBranch !== branchName) {
    // Branch wasn't actually created/checked out or we didn't switch to it
    await log('');
    await log(`${formatAligned('❌', isContinueMode ? 'BRANCH CHECKOUT FAILED' : 'BRANCH CREATION FAILED', '')}`, { level: 'error' });
    await log('');
    await log('  🔍 What happened:');
    if (isContinueMode) {
      await log('     Git checkout command didn\'t switch to the PR branch.');
    } else {
      await log('     Git checkout -b command didn\'t create or switch to the branch.');
    }
    await log('');
    await log('  📊 Branch status:');
    await log(`     Expected branch: ${branchName}`);
    await log(`     Currently on: ${actualBranch || '(unknown)'}`);
    await log('');
    
    // Show all branches to help debug
    const allBranchesResult = await $({ cwd: tempDir })`git branch -a 2>&1`;
    if (allBranchesResult.code === 0) {
      await log('  🌿 Available branches:');
      for (const line of allBranchesResult.stdout.toString().split('\n')) {
        if (line.trim()) await log(`     ${line}`);
      }
      await log('');
    }
    
    if (isContinueMode) {
      await log('  💡 This might mean:');
      await log('     • PR branch doesn\'t exist on remote');
      await log('     • Branch name mismatch');
      await log('     • Network/permission issues');
      await log('');
      await log('  🔧 How to fix:');
      await log(`     1. Check PR details: gh pr view ${prNumber} --repo ${owner}/${repo}`);
      await log(`     2. List remote branches: cd ${tempDir} && git branch -r`);
      await log(`     3. Try manual checkout: cd ${tempDir} && git checkout ${branchName}`);
    } else {
      await log('  💡 This is unusual. Possible causes:');
      await log('     • Git version incompatibility');
      await log('     • File system permissions issue');
      await log('     • Repository corruption');
      await log('');
      await log('  🔧 How to fix:');
      await log('     1. Try creating the branch manually:');
      await log(`        cd ${tempDir}`);
      await log(`        git checkout -b ${branchName}`);
      await log('     ');
      await log('     2. If that fails, try two-step approach:');
      await log(`        cd ${tempDir}`);
      await log(`        git branch ${branchName}`);
      await log(`        git checkout ${branchName}`);
      await log('     ');
      await log('     3. Check your git version:');
      await log('        git --version');
    }
    await log('');
    await log(`  📂 Working directory: ${tempDir}`);
    await log('');
    process.exit(1);
  }
  
  if (isContinueMode) {
    await log(`${formatAligned('✅', 'Branch checked out:', branchName)}`);
    await log(`${formatAligned('✅', 'Current branch:', actualBranch)}`);
    if (argv.verbose) {
      await log('   Branch operation: Checkout existing PR branch', { verbose: true });
      await log(`   Branch verification: ${actualBranch === branchName ? 'Matches expected' : 'MISMATCH!'}`, { verbose: true });
    }
  } else {
    await log(`${formatAligned('✅', 'Branch created:', branchName)}`);
    await log(`${formatAligned('✅', 'Current branch:', actualBranch)}`);
    if (argv.verbose) {
      await log('   Branch operation: Create new branch', { verbose: true });
      await log(`   Branch verification: ${actualBranch === branchName ? 'Matches expected' : 'MISMATCH!'}`, { verbose: true });
    }
  }

  // Initialize PR variables early
  let prUrl = null;
  
  // In continue mode, we already have the PR details
  if (isContinueMode) {
    prUrl = issueUrl; // The input URL is the PR URL
    // prNumber is already set from earlier when we parsed the PR
  }
  
  // Don't build the prompt yet - we'll build it after we have all the information
  // This includes PR URL (if created) and comment info (if in continue mode)
  
  if (argv.autoPullRequestCreation && !isContinueMode) {
    await log(`\n${formatAligned('🚀', 'Auto PR creation:', 'ENABLED')}`);
    await log('     Creating:               Initial commit and draft PR...');
    await log('');
    
    try {
      // Create CLAUDE.md file with the task details
      await log(formatAligned('📝', 'Creating:', 'CLAUDE.md with task details'));
      
      // Write initial task info to CLAUDE.md
      const initialTaskInfo = `Issue to solve: ${issueUrl}
Your prepared branch: ${branchName}
Your prepared working directory: ${tempDir}${argv.fork && forkedRepo ? `
Your forked repository: ${forkedRepo}
Original repository (upstream): ${owner}/${repo}` : ''}

Proceed.`;
      await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), initialTaskInfo);
      await log(formatAligned('✅', 'File created:', 'CLAUDE.md'));
      
      // Add and commit the file
      await log(formatAligned('📦', 'Adding file:', 'To git staging'));
      
      // Use explicit cwd option for better reliability
      const addResult = await $({ cwd: tempDir })`git add CLAUDE.md`;
      
      if (addResult.code !== 0) {
        await log('❌ Failed to add CLAUDE.md', { level: 'error' });
        await log(`   Error: ${addResult.stderr ? addResult.stderr.toString() : 'Unknown error'}`, { level: 'error' });
        process.exit(1);
      }
      
      // Verify the file was actually staged
      if (argv.verbose) {
        const statusResult = await $({ cwd: tempDir })`git status --short`;
        await log(`   Git status after add: ${statusResult.stdout ? statusResult.stdout.toString().trim() : 'empty'}`);
      }
      
      await log(formatAligned('📝', 'Creating commit:', 'With CLAUDE.md file'));
      const commitMessage = `Initial commit with task details for issue #${issueNumber}

Adding CLAUDE.md with task information for AI processing.
This file will be removed when the task is complete.

Issue: ${issueUrl}`;
      
      // Use explicit cwd option for better reliability
      const commitResult = await $({ cwd: tempDir })`git commit -m ${commitMessage}`;
      
      if (commitResult.code !== 0) {
        await log('❌ Failed to create initial commit', { level: 'error' });
        await log(`   Error: ${commitResult.stderr ? commitResult.stderr.toString() : 'Unknown error'}`, { level: 'error' });
        await log(`   stdout: ${commitResult.stdout ? commitResult.stdout.toString() : 'none'}`, { verbose: true });
        process.exit(1);
      } else {
        await log(formatAligned('✅', 'Commit created:', 'Successfully with CLAUDE.md'));
        if (argv.verbose) {
          await log(`   Commit output: ${commitResult.stdout.toString().trim()}`, { verbose: true });
        }
        
        // Verify commit was created before pushing
        const verifyCommitResult = await $({ cwd: tempDir })`git log --format="%h %s" -1 2>&1`;
        if (verifyCommitResult.code === 0) {
          const latestCommit = verifyCommitResult.stdout ? verifyCommitResult.stdout.toString().trim() : '';
          if (argv.verbose) {
            await log(`   Latest commit: ${latestCommit || '(empty - this is a problem!)'}`);
            
            // Show git status
            const statusResult = await $({ cwd: tempDir })`git status --short 2>&1`;
            await log(`   Git status: ${statusResult.stdout ? statusResult.stdout.toString().trim() || 'clean' : 'clean'}`);
            
            // Show remote info
            const remoteResult = await $({ cwd: tempDir })`git remote -v 2>&1`;
            const remoteOutput = remoteResult.stdout ? remoteResult.stdout.toString().trim() : 'none';
            await log(`   Remotes: ${remoteOutput ? remoteOutput.split('\n')[0] : 'none configured'}`);
            
            // Show branch info
            const branchResult = await $({ cwd: tempDir })`git branch -vv 2>&1`;
            await log(`   Branch info: ${branchResult.stdout ? branchResult.stdout.toString().trim() : 'none'}`);
          }
        }
        
        // Push the branch
        await log(formatAligned('📤', 'Pushing branch:', 'To remote repository...'));
        
        if (argv.verbose) {
          await log(`   Command: git push -u origin ${branchName}`, { verbose: true });
        }
        
        // Push the branch with the CLAUDE.md commit
        if (argv.verbose) {
          await log(`   Push command: git push -f -u origin ${branchName}`);
        }
        
        // Always use force push to ensure our commit gets to GitHub
        // (The branch is new with random name, so force is safe)
        const pushResult = await $({ cwd: tempDir })`git push -f -u origin ${branchName} 2>&1`;
        
        if (argv.verbose) {
          await log(`   Push exit code: ${pushResult.code}`);
          if (pushResult.stdout) {
            await log(`   Push output: ${pushResult.stdout.toString().trim()}`);
          }
          if (pushResult.stderr) {
            await log(`   Push stderr: ${pushResult.stderr.toString().trim()}`);
          }
        }
        
        if (pushResult.code !== 0) {
          const errorOutput = pushResult.stderr ? pushResult.stderr.toString() : pushResult.stdout ? pushResult.stdout.toString() : 'Unknown error';
          
          // Check for permission denied error
          if (errorOutput.includes('Permission to') && errorOutput.includes('denied')) {
            await log(`\n${formatAligned('❌', 'PERMISSION DENIED:', 'Cannot push to repository')}`, { level: 'error' });
            await log('');
            await log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            await log('');
            await log(`  🔒 You don't have write access to ${owner}/${repo}`);
            await log('');
            await log('  This typically happens when:');
            await log('    • You\'re not a collaborator on the repository');
            await log('    • The repository belongs to another user/organization');
            await log('');
            await log('  📋 HOW TO FIX THIS:');
            await log('');
            await log('  Option 1: Use the --fork flag (RECOMMENDED)');
            await log(`  ${'-'.repeat(40)}`);
            await log('  Run the command again with --fork:');
            await log('');
            await log(`    ./solve.mjs "${issueUrl}" --fork`);
            await log('');
            await log('  This will:');
            await log('    ✓ Fork the repository to your account');
            await log('    ✓ Push changes to your fork');
            await log('    ✓ Create a PR from your fork to the original repo');
            await log('');
            await log('  Option 2: Request collaborator access');
            await log(`  ${'-'.repeat(40)}`);
            await log('  Ask the repository owner to add you as a collaborator:');
            await log(`    → Go to: https://github.com/${owner}/${repo}/settings/access`);
            await log('');
            await log('  Option 3: Manual fork and clone');
            await log(`  ${'-'.repeat(40)}`);
            await log(`  1. Fork the repo: https://github.com/${owner}/${repo}/fork`);
            await log('  2. Clone your fork and work there');
            await log('  3. Create a PR from your fork');
            await log('');
            await log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            await log('');
            await log('💡 Tip: The --fork option automates the entire fork workflow!');
            await log('');
            process.exit(1);
          } else {
            // Other push errors
            await log(`${formatAligned('❌', 'Failed to push:', 'See error below')}`, { level: 'error' });
            await log(`   Error: ${errorOutput}`, { level: 'error' });
            process.exit(1);
          }
        } else {
          await log(`${formatAligned('✅', 'Branch pushed:', 'Successfully to remote')}`);
          if (argv.verbose) {
            await log(`   Push output: ${pushResult.stdout.toString().trim()}`, { verbose: true });
          }
          
          // CRITICAL: Wait for GitHub to process the push before creating PR
          // This prevents "No commits between branches" error
          await log('   Waiting for GitHub to sync...');
          await new Promise(resolve => setTimeout(resolve, 8000)); // Longer wait for GitHub to process
          
          // Verify the push actually worked by checking GitHub API
          const branchCheckResult = await $({ silent: true })`gh api repos/${owner}/${repo}/branches/${branchName} --jq .name 2>&1`;
          if (branchCheckResult.code === 0 && branchCheckResult.stdout.toString().trim() === branchName) {
            await log(`   Branch verified on GitHub: ${branchName}`);
            
            // Get the commit SHA from GitHub
            const shaCheckResult = await $({ silent: true })`gh api repos/${owner}/${repo}/branches/${branchName} --jq .commit.sha 2>&1`;
            if (shaCheckResult.code === 0) {
              const remoteSha = shaCheckResult.stdout.toString().trim();
              await log(`   Remote commit SHA: ${remoteSha.substring(0, 7)}...`);
            }
          } else {
            await log('   Warning: Branch not found on GitHub!');
            await log('   This will cause PR creation to fail.');
            
            if (argv.verbose) {
              await log(`   Branch check result: ${branchCheckResult.stdout || branchCheckResult.stderr || 'empty'}`);
              
              // Show all branches on GitHub
              const allBranchesResult = await $({ silent: true })`gh api repos/${owner}/${repo}/branches --jq '.[].name' 2>&1`;
              if (allBranchesResult.code === 0) {
                await log(`   All GitHub branches: ${allBranchesResult.stdout.toString().split('\n').slice(0, 5).join(', ')}...`);
              }
            }
            
            // Try one more force push with explicit ref
            await log('   Attempting explicit push...');
            const explicitPushCmd = `git push origin HEAD:refs/heads/${branchName} -f`;
            if (argv.verbose) {
              await log(`   Command: ${explicitPushCmd}`);
            }
            const explicitPushResult = await $`cd ${tempDir} && ${explicitPushCmd} 2>&1`;
            if (explicitPushResult.code === 0) {
              await log('   Explicit push completed');
              if (argv.verbose && explicitPushResult.stdout) {
                await log(`   Output: ${explicitPushResult.stdout.toString().trim()}`);
              }
              // Wait a bit more for GitHub to process
              await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
              await log('   ERROR: Cannot push to GitHub!');
              await log(`   Error: ${explicitPushResult.stderr || explicitPushResult.stdout || 'Unknown'}`);
            }
          }
          
          // Get issue title for PR title
          await log(formatAligned('📋', 'Getting issue:', 'Title from GitHub...'), { verbose: true });
          const issueTitleResult = await $({ silent: true })`gh api repos/${owner}/${repo}/issues/${issueNumber} --jq .title 2>&1`;
          let issueTitle = `Fix issue #${issueNumber}`;
          if (issueTitleResult.code === 0) {
            issueTitle = issueTitleResult.stdout.toString().trim();
            await log(`   Issue title: "${issueTitle}"`, { verbose: true });
          } else {
            await log('   Warning: Could not get issue title, using default', { verbose: true });
          }
          
          // Get current GitHub user to set as assignee (but validate it's a collaborator)
          await log(formatAligned('👤', 'Getting user:', 'Current GitHub account...'), { verbose: true });
          const currentUserResult = await $({ silent: true })`gh api user --jq .login 2>&1`;
          let currentUser = null;
          let canAssign = false;
          
          if (currentUserResult.code === 0) {
            currentUser = currentUserResult.stdout.toString().trim();
            await log(`   Current user: ${currentUser}`, { verbose: true });
            
            // Check if user has push access (is a collaborator or owner)
            // IMPORTANT: We need to completely suppress the JSON error output
            // Using execSync to have full control over stderr
            try {
              const { execSync } = await import('child_process');
              // This will throw if user doesn't have access, but won't print anything
              execSync(`gh api repos/${owner}/${repo}/collaborators/${currentUser} 2>/dev/null`, 
                       { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
              canAssign = true;
              await log('   User has collaborator access', { verbose: true });
            } catch (e) {
              // User doesn't have access, which is fine - we just won't assign
              canAssign = false;
              await log('   User is not a collaborator (will skip assignment)', { verbose: true });
            }
            
            // Set permCheckResult for backward compatibility
            const permCheckResult = { code: canAssign ? 0 : 1 };
            if (permCheckResult.code === 0) {
              canAssign = true;
              await log('   User has collaborator access', { verbose: true });
            } else {
              // User doesn't have permission, but that's okay - we just won't assign
              await log('   User is not a collaborator (will skip assignment)', { verbose: true });
            }
          } else {
            await log('   Warning: Could not get current user', { verbose: true });
          }
          
          // Create draft pull request
          await log(formatAligned('🔀', 'Creating PR:', 'Draft pull request...'));
          
          // Use full repository reference for cross-repo PRs (forks)
          const issueRef = argv.fork ? `${owner}/${repo}#${issueNumber}` : `#${issueNumber}`;
          
          const prBody = `## 🤖 AI-Powered Solution

This pull request is being automatically generated to solve issue ${issueRef}.

### 📋 Issue Reference
Fixes ${issueRef}

### 🚧 Status
**Work in Progress** - The AI assistant is currently analyzing and implementing the solution.

### 📝 Implementation Details
_Details will be added as the solution is developed..._

---
*This PR was created automatically by the AI issue solver*`;
          
          if (argv.verbose) {
            await log(`   PR Title: [WIP] ${issueTitle}`, { verbose: true });
            await log(`   Base branch: ${defaultBranch}`, { verbose: true });
            await log(`   Head branch: ${branchName}`, { verbose: true });
            if (currentUser) {
              await log(`   Assignee: ${currentUser}`, { verbose: true });
            }
            await log(`   PR Body:
${prBody}`, { verbose: true });
          }
          
          // Use execSync for gh pr create to avoid command-stream output issues
          // Similar to how create-test-repo.mjs handles it
          try {
            const { execSync } = await import('child_process');
            
            // Write PR body to temp file to avoid shell escaping issues
            const prBodyFile = `/tmp/pr-body-${Date.now()}.md`;
            await fs.writeFile(prBodyFile, prBody);
            
            // Build command with optional assignee and handle forks
            let command;
            if (argv.fork && forkedRepo) {
              // For forks, specify the full head reference
              const forkUser = forkedRepo.split('/')[0];
              command = `cd "${tempDir}" && gh pr create --draft --title "[WIP] ${issueTitle}" --body-file "${prBodyFile}" --base ${defaultBranch} --head ${forkUser}:${branchName} --repo ${owner}/${repo}`;
            } else {
              command = `cd "${tempDir}" && gh pr create --draft --title "[WIP] ${issueTitle}" --body-file "${prBodyFile}" --base ${defaultBranch} --head ${branchName}`;
            }
            // Only add assignee if user has permissions
            if (currentUser && canAssign) {
              command += ` --assignee ${currentUser}`;
            }
            
            if (argv.verbose) {
              await log(`   Command: ${command}`, { verbose: true });
            }
            
            const output = execSync(command, { encoding: 'utf8', cwd: tempDir });
            
            // Clean up temp file
            await fs.unlink(prBodyFile).catch(() => {});
            
            // Extract PR URL from output - gh pr create outputs the URL to stdout
            prUrl = output.trim();
            
            if (!prUrl) {
              await log('⚠️ Warning: PR created but no URL returned', { level: 'warning' });
              await log(`   Output: ${output}`, { verbose: true });
              
              // Try to get the PR URL using gh pr list
              await log('   Attempting to find PR using gh pr list...', { verbose: true });
              const prListResult = await $`cd ${tempDir} && gh pr list --head ${branchName} --json url --jq '.[0].url'`;
              if (prListResult.code === 0 && prListResult.stdout.toString().trim()) {
                prUrl = prListResult.stdout.toString().trim();
                await log(`   Found PR URL: ${prUrl}`, { verbose: true });
              }
            }
            
            // Extract PR number from URL
            if (prUrl) {
              const prMatch = prUrl.match(/\/pull\/(\d+)/);
              if (prMatch) {
                prNumber = prMatch[1];
                await log(formatAligned('✅', 'PR created:', `#${prNumber}`));
                await log(formatAligned('📍', 'PR URL:', prUrl));
                if (currentUser && canAssign) {
                  await log(formatAligned('👤', 'Assigned to:', currentUser));
                } else if (currentUser && !canAssign) {
                  await log(formatAligned('ℹ️', 'Note:', 'Could not assign (no permission)'));
                }
                
                // CLAUDE.md will be removed after Claude command completes
                
                // Link the issue to the PR in GitHub's Development section using GraphQL API
                await log(formatAligned('🔗', 'Linking:', `Issue #${issueNumber} to PR #${prNumber}...`));
                try {
                  // First, get the node IDs for both the issue and the PR
                  const issueNodeResult = await $`gh api graphql -f query='query { repository(owner: "${owner}", name: "${repo}") { issue(number: ${issueNumber}) { id } } }' --jq .data.repository.issue.id`;
                  
                  if (issueNodeResult.code !== 0) {
                    throw new Error(`Failed to get issue node ID: ${issueNodeResult.stderr}`);
                  }
                  
                  const issueNodeId = issueNodeResult.stdout.toString().trim();
                  await log(`   Issue node ID: ${issueNodeId}`, { verbose: true });
                  
                  const prNodeResult = await $`gh api graphql -f query='query { repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${prNumber}) { id } } }' --jq .data.repository.pullRequest.id`;
                  
                  if (prNodeResult.code !== 0) {
                    throw new Error(`Failed to get PR node ID: ${prNodeResult.stderr}`);
                  }
                  
                  const prNodeId = prNodeResult.stdout.toString().trim();
                  await log(`   PR node ID: ${prNodeId}`, { verbose: true });
                  
                  // Now link them using the GraphQL mutation
                  // GitHub automatically creates the link when we use "Fixes #" or "Fixes owner/repo#"
                  // The Development section link is created automatically by GitHub when:
                  // 1. The PR body contains "Fixes #N", "Closes #N", or "Resolves #N"
                  // 2. For cross-repo (fork) PRs, we need "Fixes owner/repo#N"
                  
                  // Let's verify the link was created
                  const linkCheckResult = await $`gh api graphql -f query='query { repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${prNumber}) { closingIssuesReferences(first: 10) { nodes { number } } } } }' --jq '.data.repository.pullRequest.closingIssuesReferences.nodes[].number'`;
                  
                  if (linkCheckResult.code === 0) {
                    const linkedIssues = linkCheckResult.stdout.toString().trim().split('\n').filter(n => n);
                    if (linkedIssues.includes(issueNumber)) {
                      await log(formatAligned('✅', 'Link verified:', `Issue #${issueNumber} → PR #${prNumber}`));
                    } else {
                      // This is a problem - the link wasn't created
                      await log('');
                      await log(formatAligned('⚠️', 'ISSUE LINK MISSING:', 'PR not linked to issue'), { level: 'warning' });
                      await log('');
                      
                      if (argv.fork) {
                        await log('   The PR was created from a fork but wasn\'t linked to the issue.', { level: 'warning' });
                        await log(`   Expected: "Fixes ${owner}/${repo}#${issueNumber}" in PR body`, { level: 'warning' });
                        await log('');
                        await log('   To fix manually:', { level: 'warning' });
                        await log(`   1. Edit the PR description at: ${prUrl}`, { level: 'warning' });
                        await log(`   2. Add this line: Fixes ${owner}/${repo}#${issueNumber}`, { level: 'warning' });
                      } else {
                        await log(`   The PR wasn't linked to issue #${issueNumber}`, { level: 'warning' });
                        await log(`   Expected: "Fixes #${issueNumber}" in PR body`, { level: 'warning' });
                        await log('');
                        await log('   To fix manually:', { level: 'warning' });
                        await log(`   1. Edit the PR description at: ${prUrl}`, { level: 'warning' });
                        await log(`   2. Ensure it contains: Fixes #${issueNumber}`, { level: 'warning' });
                      }
                      await log('');
                    }
                  } else {
                    // Could not verify but show what should have been used
                    const expectedRef = argv.fork ? `${owner}/${repo}#${issueNumber}` : `#${issueNumber}`;
                    await log('⚠️ Could not verify issue link (API error)', { level: 'warning' });
                    await log(`   PR body should contain: "Fixes ${expectedRef}"`, { level: 'warning' });
                    await log(`   Please verify manually at: ${prUrl}`, { level: 'warning' });
                  }
                } catch (linkError) {
                  const expectedRef = argv.fork ? `${owner}/${repo}#${issueNumber}` : `#${issueNumber}`;
                  await log(`⚠️ Could not verify issue linking: ${linkError.message}`, { level: 'warning' });
                  await log(`   PR body should contain: "Fixes ${expectedRef}"`, { level: 'warning' });
                  await log(`   Please check manually at: ${prUrl}`, { level: 'warning' });
                }
              } else {
                await log(formatAligned('✅', 'PR created:', 'Successfully'));
                await log(formatAligned('📍', 'PR URL:', prUrl));
              }
              
              // CLAUDE.md will be removed after Claude command completes
            } else {
              await log('⚠️ Draft pull request created but URL could not be determined', { level: 'warning' });
            }
          } catch (prCreateError) {
            const errorMsg = prCreateError.message || '';
            
            // Clean up the error message - extract the meaningful part
            let cleanError = errorMsg;
            if (errorMsg.includes('pull request create failed:')) {
              cleanError = errorMsg.split('pull request create failed:')[1].trim();
            } else if (errorMsg.includes('Command failed:')) {
              // Extract just the error part, not the full command
              const lines = errorMsg.split('\n');
              cleanError = lines[lines.length - 1] || errorMsg;
            }
            
            // Check for specific error types
            if (errorMsg.includes('could not assign user') || errorMsg.includes('not found')) {
              // Assignment failed but PR might have been created
              await log(formatAligned('⚠️', 'Warning:', 'Could not assign user'), { level: 'warning' });
              
              // Try to get the PR that was just created (use silent mode)
              const prListResult = await $({ silent: true })`cd ${tempDir} && gh pr list --head ${branchName} --json url,number --jq '.[0]' 2>&1`;
              if (prListResult.code === 0 && prListResult.stdout.toString().trim()) {
                try {
                  const prData = JSON.parse(prListResult.stdout.toString().trim());
                  prUrl = prData.url;
                  prNumber = prData.number;
                  await log(formatAligned('✅', 'PR created:', `#${prNumber} (without assignee)`));
                  await log(formatAligned('📍', 'PR URL:', prUrl));
                } catch (parseErr) {
                  // If we can't parse, continue without PR info
                  await log(formatAligned('⚠️', 'PR status:', 'Unknown (check GitHub)'));
                }
              } else {
                // PR creation actually failed
                await log('');
                await log(formatAligned('❌', 'PR CREATION FAILED', ''), { level: 'error' });
                await log('');
                await log('  🔍 What happened:');
                await log('     Failed to create pull request after pushing branch.');
                await log('');
                await log('  📦 Error details:');
                for (const line of cleanError.split('\n')) {
                  if (line.trim()) await log(`     ${line.trim()}`);
                }
                await log('');
                await log('  🔧 How to fix:');
                await log('     1. Check GitHub to see if PR was partially created');
                await log('     2. Try creating PR manually: gh pr create');
                await log(`     3. Verify branch was pushed: git push -u origin ${branchName}`);
                await log('');
                process.exit(1);
              }
            } else if (errorMsg.includes('No commits between') || errorMsg.includes('Head sha can\'t be blank')) {
              // Empty PR error
              await log('');
              await log(formatAligned('❌', 'PR CREATION FAILED', ''), { level: 'error' });
              await log('');
              await log('  🔍 What happened:');
              await log('     Cannot create PR - no commits between branches.');
              await log('');
              await log('  📦 Error details:');
              for (const line of cleanError.split('\n')) {
                if (line.trim()) await log(`     ${line.trim()}`);
              }
              await log('');
              await log('  💡 Possible causes:');
              await log('     • The branch wasn\'t pushed properly');
              await log('     • The commit wasn\'t created');
              await log('     • GitHub sync issue');
              await log('');
              await log('  🔧 How to fix:');
              await log('     1. Verify commit exists:');
              await log(`        cd ${tempDir} && git log --format="%h %s" -5`);
              await log('     2. Push again with tracking:');
              await log(`        cd ${tempDir} && git push -u origin ${branchName}`);
              await log('     3. Create PR manually:');
              await log(`        cd ${tempDir} && gh pr create --draft`);
              await log('');
              await log(`  📂 Working directory: ${tempDir}`);
              await log(`  🌿 Current branch: ${branchName}`);
              await log('');
              process.exit(1);
            } else {
              // Generic PR creation error
              await log('');
              await log(formatAligned('❌', 'PR CREATION FAILED', ''), { level: 'error' });
              await log('');
              await log('  🔍 What happened:');
              await log('     Failed to create pull request.');
              await log('');
              await log('  📦 Error details:');
              for (const line of cleanError.split('\n')) {
                if (line.trim()) await log(`     ${line.trim()}`);
              }
              await log('');
              await log('  🔧 How to fix:');
              await log('     1. Try creating PR manually:');
              await log(`        cd ${tempDir} && gh pr create --draft`);
              await log('     2. Check branch status:');
              await log(`        cd ${tempDir} && git status`);
              await log('     3. Verify GitHub authentication:');
              await log('        gh auth status');
              await log('');
              process.exit(1);
            }
          }
        }
      }
    } catch (prError) {
      await log(`Warning: Error during auto PR creation: ${prError.message}`, { level: 'warning' });
      await log('   Continuing without PR...');
    }
  } else if (isContinueMode) {
    await log(`\n${formatAligned('🔄', 'Continue mode:', 'ACTIVE')}`);
    await log(formatAligned('', 'Using existing PR:', `#${prNumber}`, 2));
    await log(formatAligned('', 'PR URL:', prUrl, 2));
  } else {
    await log(`\n${formatAligned('⏭️', 'Auto PR creation:', 'DISABLED')}`);
    await log(formatAligned('', 'Workflow:', 'AI will create the PR', 2));
  }

  // Now we have the PR URL if one was created

  // Count new comments and detect feedback
  const { newPrComments, newIssueComments, commentInfo, feedbackLines } = await detectAndCountFeedback({
    prNumber,
    branchName,
    owner,
    repo,
    issueNumber,
    isContinueMode,
    argv,
    mergeStateStatus,
    log,
    formatAligned,
    cleanErrorMessage,
    $
  });

  // Now build the final prompt with all collected information
  const promptLines = [];
  
  // Issue or PR reference
  if (isContinueMode) {
    promptLines.push(`Issue to solve: ${issueNumber ? `https://github.com/${owner}/${repo}/issues/${issueNumber}` : `Issue linked to PR #${prNumber}`}`);
  } else {
    promptLines.push(`Issue to solve: ${issueUrl}`);
  }
  
  // Basic info
  promptLines.push(`Your prepared branch: ${branchName}`);
  promptLines.push(`Your prepared working directory: ${tempDir}`);
  
  // PR info if available
  if (prUrl) {
    promptLines.push(`Your prepared Pull Request: ${prUrl}`);
  }
  
  // Merge state for continue mode
  if (isContinueMode && mergeStateStatus) {
    promptLines.push(`Existing pull request's merge state status: ${mergeStateStatus}`);
  }
  
  // Fork info if applicable
  if (argv.fork && forkedRepo) {
    promptLines.push(`Your forked repository: ${forkedRepo}`);
    promptLines.push(`Original repository (upstream): ${owner}/${repo}`);
  }
  
  // Add blank line
  promptLines.push('');
  
  // Add feedback info if in continue mode and there are feedback items
  if (isContinueMode && feedbackLines && feedbackLines.length > 0) {
    // Add each feedback line directly
    feedbackLines.forEach(line => promptLines.push(line));
    promptLines.push('');
  }
  
  // Final instruction
  promptLines.push(isContinueMode ? 'Continue.' : 'Proceed.');
  
  // Build the final prompt as a const
  const prompt = promptLines.join('\n');
  
  if (argv.verbose) {
    await log('\n📝 Final prompt structure:', { verbose: true });
    await log(`   Lines: ${promptLines.length}`, { verbose: true });
    await log(`   Characters: ${prompt.length}`, { verbose: true });
    if (feedbackLines && feedbackLines.length > 0) {
      await log('   Feedback info: Included', { verbose: true });
    }

    // In dry-run mode, output the actual prompt for debugging
    if (argv.dryRun) {
      await log('\n📋 User prompt content:', { verbose: true });
      await log('---BEGIN USER PROMPT---', { verbose: true });
      await log(prompt, { verbose: true });
      await log('---END USER PROMPT---', { verbose: true });
    }
  }

  const systemPrompt = `You are AI issue solver.

General guidelines.
   - When you execute commands, always save their logs to files for easy reading if the output gets large.
   - When running commands, do not set a timeout yourself — let them run as long as needed (default timeout - 2 minutes is more than enough, if you can set 4 minutes), and once they finish, review the logs in the file.
   - When CI is failing, make sure you download the logs locally and carefully investigate them.
   - When a code or log file has more than 2500 lines, read it in chunks of 2500 lines.
   - When facing a complex problem, do as much tracing as possible and turn on all verbose modes.
   - When you create debug, test, or example/experiment scripts for fixing, always keep them in an examples or/and experiments folders so you can reuse them later.
   - When testing your assumptions, use the experiment scripts, and add it to experiments folder.
   - When your experiments can show real world use case of the software, add it to examples folder.
   - When you face something extremely hard, use divide and conquer — it always helps.${isContinueMode ? `

Continue mode.
   - When you are working on existing pull request #${prNumber}:
     * Review the pull request title and description to understand the current approach, and continue building upon existing work.
     * Make sure you use gh pr diff to see actual changes.
     * Make sure you use gh pr view with mergeStateStatus to check if pull requests has any merge conflicts.
     * Look at the issue context of that pull request and any linked discussions.
     * When pull request is out of sync with default branch, make sure you resolve any conflicts to apply original changes.
     * Look at the issue context and any linked discussions.
     * Explore codebase for best coding style and practices on similar changes.
     * Check all changes from the last commit to understand current progress.
     * Check for new comments on the pull request for additional feedback or requirements.
     * Look for any explicit feedback from users in PR comments or issue updates.
     * Consider what has already been implemented vs what still needs to be done.
     * Consider any mismatch in requirements with original issue or the pull request description.
     * When you need human feedback, do it by creating comment using gh tool in Pull Request or Issue to continue conversation.` : ''}

Initial research.  
   - When you read issue, read all details and comments thoroughly.  
   - When you need issue details, use gh issue view ${isContinueMode && issueNumber ? `https://github.com/${owner}/${repo}/issues/${issueNumber}` : issueUrl}.  
   - When you need related code, use gh search code --owner ${owner} [keywords].  
   - When you need repo context, read files in ${tempDir}.  
   - When you study related work, study related previous latest pull requests.  
   - When issue is not defined enough, write a comment to ask clarifying questions.
   - When you are fixing a bug, please make sure you first find the actual root cause, do as much experiments as needed.
   - When you are fixing a bug and code does not have enough tracing/logs, add them and make sure they stay in the code, but are switched off by default.
   - When you need latest comments on pull request (sorted newest first), use:
     * For PR conversation comments: gh api repos/${owner}/${repo}/issues/{pr_number}/comments --jq 'sort_by(.created_at) | reverse'
     * For PR code review comments: gh api repos/${owner}/${repo}/pulls/{pr_number}/comments --jq 'sort_by(.created_at) | reverse'
   - When you need latest comments on issue (sorted newest first), use: gh api repos/${owner}/${repo}/issues/{issue_number}/comments --jq 'sort_by(.created_at) | reverse'  

Solution development and testing.  
   - When issue is solvable, implement code with tests.  
   - When you test, start from small functions.  
   - When you test, write unit tests with mocks.  
   - When you test integrations, use existing framework.  
   - When you test solution, include automated checks in pr.  
   - When issue is unclear, write comment on issue asking questions.  
   - When you encounter any problems that you unable to solve yourself (any human feedback or help), write a comment to the pull request asking for help.${prUrl ? `  
   - When you need human help, use gh pr comment ${prNumber || prUrl} --body "your message" to comment on existing PR.` : ''}

Preparing pull request.  
   - When you finalize the pull request, follow style from merged prs for code, title, and description, and double-check the logic of all conditions and statements.  
   - When you code, follow contributing guidelines.  
   - When you commit, write clear message.
   - When you need examples of style, use gh pr list --repo ${owner}/${repo} --state merged --search [keywords].
   - When you open pr, describe solution and include tests.
   - When there is a package with version and GitHub Actions workflows for automatic release, update the version (or other necessary release trigger) in your pull request to prepare for next release.${prUrl ? `
   - When you update existing pr ${prNumber || prUrl}, use gh pr edit to modify title and description.
   - When you finish implementation, use gh pr ready ${prNumber || prUrl}.` : ''}  

Workflow and collaboration.  
   - When you check branch, verify with git branch --show-current.  
   - When you push, push only to branch ${branchName}.${argv.fork && forkedRepo ? `
   - When you push, remember you're pushing to fork ${forkedRepo}, not ${owner}/${repo}.` : ''}  
   - When you finish, create a pull request from branch ${branchName}.${prUrl ? ` (Note: PR ${prNumber || prUrl} already exists, update it instead)` : ''}${argv.fork && forkedRepo ? `
   - When you create pr, use --repo ${owner}/${repo} to create PR against original repo.` : ''}  
   - When you organize workflow, use pull requests instead of direct merges to default branch (main or master).  
   - When you manage commits, preserve commit history for later analysis.  
   - When you contribute, keep repository history forward-moving with regular commits, pushes, and reverts if needed.  
   - When you face conflict, ask for help.  
   - When you collaborate, respect branch protections by working only on ${branchName}.  
   - When you mention result, include pull request url or comment url.${prUrl ? `
   - When you need to create pr, remember pr ${prNumber || prUrl} already exists for this branch.` : ''}  

Self review.
   - When you check your solution, run all tests locally.  
   - When you compare with repo style, use gh pr diff [number].  
   - When you finalize, confirm code, tests, and description are consistent.`;

  // Properly escape prompts for shell usage - escape quotes and preserve newlines
  const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
  const escapedSystemPrompt = systemPrompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');

  // Get timestamps from GitHub servers before executing the command
  await log(`${formatAligned('📅', 'Getting timestamps:', 'From GitHub servers...')}`);

  let referenceTime;
  try {
    // Get the issue's last update time
    const issueResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber} --jq .updated_at`;
    
    if (issueResult.code !== 0) {
      throw new Error(`Failed to get issue details: ${issueResult.stderr ? issueResult.stderr.toString() : 'Unknown error'}`);
    }
    
    const issueUpdatedAt = new Date(issueResult.stdout.toString().trim());
    await log(formatAligned('📝', 'Issue updated:', issueUpdatedAt.toISOString(), 2));

    // Get the last comment's timestamp (if any)
    const commentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;
    
    if (commentsResult.code !== 0) {
      await log(`Warning: Failed to get comments: ${commentsResult.stderr ? commentsResult.stderr.toString() : 'Unknown error'}`, { level: 'warning' });
      // Continue anyway, comments are optional
    }
    
    const comments = JSON.parse(commentsResult.stdout.toString().trim() || '[]');
    const lastCommentTime = comments.length > 0 ? new Date(comments[comments.length - 1].created_at) : null;
    if (lastCommentTime) {
      await log(formatAligned('💬', 'Last comment:', lastCommentTime.toISOString(), 2));
    } else {
      await log(formatAligned('💬', 'Comments:', 'None found', 2));
    }

    // Get the most recent pull request's timestamp
    const prsResult = await $`gh pr list --repo ${owner}/${repo} --limit 1 --json createdAt`;
    
    if (prsResult.code !== 0) {
      await log(`Warning: Failed to get PRs: ${prsResult.stderr ? prsResult.stderr.toString() : 'Unknown error'}`, { level: 'warning' });
      // Continue anyway, PRs are optional for timestamp calculation
    }
    
    const prs = JSON.parse(prsResult.stdout.toString().trim() || '[]');
    const lastPrTime = prs.length > 0 ? new Date(prs[0].createdAt) : null;
    if (lastPrTime) {
      await log(formatAligned('🔀', 'Recent PR:', lastPrTime.toISOString(), 2));
    } else {
      await log(formatAligned('🔀', 'Pull requests:', 'None found', 2));
    }

    // Use the most recent timestamp as reference
    referenceTime = issueUpdatedAt;
    if (lastCommentTime && lastCommentTime > referenceTime) {
      referenceTime = lastCommentTime;
    }
    if (lastPrTime && lastPrTime > referenceTime) {
      referenceTime = lastPrTime;
    }

    await log(`\n${formatAligned('✅', 'Reference time:', referenceTime.toISOString())}`);
  } catch (timestampError) {
    await log('Warning: Could not get GitHub timestamps, using current time as reference', { level: 'warning' });
    await log(`  Error: ${timestampError.message}`);
    referenceTime = new Date();
    await log(`  Fallback timestamp: ${referenceTime.toISOString()}`);
  }

  // Execute Claude command
  const claudeResult = await executeClaudeCommand({
    tempDir,
    branchName,
    prompt,
    systemPrompt,
    escapedPrompt,
    escapedSystemPrompt,
    argv,
    log,
    formatAligned,
    getResourceSnapshot,
    forkedRepo,
    feedbackLines,
    claudePath,
    $
  });

  const { success, sessionId, messageCount, toolUseCount } = claudeResult;
  limitReached = claudeResult.limitReached;

  if (!success) {
    process.exit(1);
  }

  // Check for uncommitted changes
  await checkForUncommittedChanges(tempDir, owner, repo, branchName, $, log);
  // Remove CLAUDE.md now that Claude command has finished
  await cleanupClaudeFile(tempDir, branchName);

  // Show summary of session and log file
  await showSessionSummary(sessionId, limitReached, argv, issueUrl, tempDir, shouldAttachLogs);

  // Search for newly created pull requests and comments
  await verifyResults(owner, repo, branchName, issueNumber, prNumber, prUrl, referenceTime, argv, shouldAttachLogs);
} catch (error) {
  await log('Error executing command:', cleanErrorMessage(error));
  await log(`Stack trace: ${error.stack}`, { verbose: true });

  // If --attach-logs is enabled, try to attach failure logs
  if (shouldAttachLogs && getLogFile()) {
    await log('\n📄 Attempting to attach failure logs...');

    // Try to attach to existing PR first
    if (global.createdPR && global.createdPR.number) {
      try {
        const logUploadSuccess = await attachLogToGitHub({
          logFile: getLogFile(),
          targetType: 'pr',
          targetNumber: global.createdPR.number,
          owner,
          repo,
          $,
          log,
          sanitizeLogContent,
          verbose: argv.verbose,
          errorMessage: cleanErrorMessage(error)
        });

        if (logUploadSuccess) {
          await log('📎 Failure log attached to Pull Request');
        }
      } catch (attachError) {
        await log(`⚠️  Could not attach failure log: ${attachError.message}`, { level: 'warning' });
      }
    }
  }

  process.exit(1);
} finally {
  // Clean up temporary directory using repository module
  await cleanupTempDirectory(tempDir, argv, limitReached);
}