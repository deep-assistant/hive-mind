#!/usr/bin/env node
// Early exit paths - handle these before loading all modules to speed up testing
const earlyArgs = process.argv.slice(2);
// Handle version early
if (earlyArgs.includes('--version')) {
  // Quick version output without loading modules
  // Get version from package.json or use dev version format
  const { execSync } = await import('child_process');
  const { readFileSync } = await import('fs');
  const { dirname, join } = await import('path');
  const { fileURLToPath } = await import('url');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packagePath = join(__dirname, '..', 'package.json');

  try {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    const currentVersion = packageJson.version;

    // Check if this is a release version (has a git tag)
    try {
      const gitTag = execSync('git describe --exact-match --tags HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
      // It's a tagged release, use the version from package.json
      console.log(currentVersion);
    } catch {
      // Not a tagged release, get the latest tag and commit SHA
      try {
        const latestTag = execSync('git describe --tags --abbrev=0 2>/dev/null', { encoding: 'utf8' }).trim().replace(/^v/, '');
        const commitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
        console.log(`${latestTag}.${commitSha}`);
      } catch {
        // Fallback to package.json version if git commands fail
        console.log(currentVersion);
      }
    }
  } catch {
    // Fallback to hardcoded version if all else fails
    console.log('0.8.7');
  }
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
// Handle no arguments early (must exit before loading modules)
if (earlyArgs.length === 0) {
  console.error('Usage: solve.mjs <issue-url> [options]');
  console.error('\nError: Missing required github issue or pull request URL');
  console.error('\nRun "solve.mjs --help" for more information');
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
  processPRMode,
  processAutoContinueForIssue
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
  executeClaude,
  executeClaudeCommand,
  buildSystemPrompt,
  buildUserPrompt,
  checkForUncommittedChanges
} = claudeExecution;

// Import feedback detection functions
const feedback = await import('./solve.feedback.lib.mjs');
const {
  detectAndCountFeedback
} = feedback;

// Import error handling functions
const errorHandlers = await import('./solve.error-handlers.lib.mjs');
const {
  createUncaughtExceptionHandler,
  createUnhandledRejectionHandler,
  handleMainExecutionError
} = errorHandlers;

// Import watch mode functions
const watchLib = await import('./solve.watch.lib.mjs');
const {
  startWatchMode
} = watchLib;

// solve-helpers.mjs is no longer needed - functions moved to lib.mjs and github.lib.mjs

// Global log file reference (will be passed to lib.mjs)

// Use getResourceSnapshot from memory-check module
const getResourceSnapshot = memoryCheck.getResourceSnapshot;

// Parse command line arguments using the config module
const argv = await parseArguments(yargs, hideBin);

// Set global verbose mode for log function
global.verboseMode = argv.verbose;

// URL validation will be done after version logging

// Debug logging for attach-logs option
if (argv.verbose) {
  await log(`Debug: argv.attachLogs = ${argv.attachLogs}`, { verbose: true });
  await log(`Debug: argv["attach-logs"] = ${argv['attach-logs']}`, { verbose: true });
}

// Show security warning and initialize log file using validation module
const shouldAttachLogs = argv.attachLogs || argv['attach-logs'];
await showAttachLogsWarning(shouldAttachLogs);
const logFile = await initializeLogFile(argv.logDir);
const absoluteLogPath = path.resolve(logFile);

// Get version information for logging
const getVersionInfo = async () => {
  try {
    const packagePath = path.join(path.dirname(path.dirname(new globalThis.URL(import.meta.url).pathname)), 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    const currentVersion = packageJson.version;

    // Check if this is a release version (has a git tag)
    try {
      const gitTagResult = await $({ silent: true })`git describe --exact-match --tags HEAD 2>/dev/null`;
      if (gitTagResult.code === 0) {
        // It's a tagged release, use the version from package.json
        return currentVersion;
      }
    } catch {
      // Ignore error - will try next method
    }

    // Not a tagged release, get the latest tag and commit SHA
    try {
      const latestTagResult = await $({ silent: true })`git describe --tags --abbrev=0 2>/dev/null`;
      const commitShaResult = await $({ silent: true })`git rev-parse --short HEAD`;

      if (latestTagResult.code === 0 && commitShaResult.code === 0) {
        const latestTag = latestTagResult.stdout.toString().trim().replace(/^v/, '');
        const commitSha = commitShaResult.stdout.toString().trim();
        return `${latestTag}.${commitSha}`;
      }
    } catch {
      // Ignore error - will use fallback
    }

    // Fallback to package.json version if git commands fail
    return currentVersion;
  } catch {
    // Fallback to hardcoded version if all else fails
    return '0.8.7';
  }
};

// Log version and raw command at the start
const versionInfo = await getVersionInfo();
await log('');
await log(`🚀 solve v${versionInfo}`);
await log('');

// Log the raw command that was executed (for better bug reporting)
const rawCommand = process.argv.join(' ');
await log('🔧 Raw command executed:');
await log(`   ${rawCommand}`);
await log('');

// Now handle argument validation that was moved from early checks
const issueUrl = argv._[0];

if (!issueUrl) {
  await log('Usage: solve.mjs <issue-url> [options]', { level: 'error' });
  await log('');
  await log('Error: Missing required github issue or pull request URL', { level: 'error' });
  await log('');
  await log('Run "solve.mjs --help" for more information', { level: 'error' });
  process.exit(1);
}

// Validate GitHub URL using validation module (more thorough check)
const urlValidation = validateGitHubUrl(issueUrl);
if (!urlValidation.isValid) {
  process.exit(1);
}
const { isIssueUrl, isPrUrl } = urlValidation;

// Setup unhandled error handlers to ensure log path is always shown
const errorHandlerOptions = {
  log,
  cleanErrorMessage,
  absoluteLogPath,
  shouldAttachLogs,
  argv,
  global,
  owner: null, // Will be set later when parsed
  repo: null,  // Will be set later when parsed
  getLogFile,
  attachLogToGitHub,
  sanitizeLogContent,
  $
};

process.on('uncaughtException', createUncaughtExceptionHandler(errorHandlerOptions));
process.on('unhandledRejection', createUnhandledRejectionHandler(errorHandlerOptions));

// Validate GitHub URL requirement and options using validation module
if (!(await validateUrlRequirement(issueUrl))) {
  process.exit(1);
}

if (!(await validateContinueOnlyOnFeedback(argv, isPrUrl, isIssueUrl))) {
  process.exit(1);
}

// Perform all system checks using validation module
// Skip Claude validation in dry-run mode or when --skip-claude-check is enabled
const skipClaudeCheck = argv.dryRun || argv.skipClaudeCheck;
if (!(await performSystemChecks(argv.minDiskSpace || 500, skipClaudeCheck))) {
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

// Store owner and repo globally for error handlers
global.owner = owner;
global.repo = repo;

// Determine mode and get issue details
let issueNumber;
let prNumber;
let prBranch;
let mergeStateStatus;
let isForkPR = false;
let isContinueMode = false;

// Auto-continue logic: check for existing PRs if --auto-continue is enabled
const autoContinueResult = await processAutoContinueForIssue(argv, isIssueUrl, urlNumber, owner, repo);
if (autoContinueResult.isContinueMode) {
  isContinueMode = true;
  prNumber = autoContinueResult.prNumber;
  prBranch = autoContinueResult.prBranch;
  issueNumber = autoContinueResult.issueNumber;
  // Store PR info globally for error handlers
  global.createdPR = { number: prNumber };
} else if (isIssueUrl) {
  issueNumber = autoContinueResult.issueNumber || urlNumber;
}

if (isPrUrl) {
  isContinueMode = true;
  prNumber = urlNumber;
  // Store PR info globally for error handlers
  global.createdPR = { number: prNumber, url: issueUrl };

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
          
          const prBody = `## 🤖 AI-Powered Solution Draft

This pull request is being automatically generated to solve issue ${issueRef}.

### 📋 Issue Reference
Fixes ${issueRef}

### 🚧 Status
**Work in Progress** - The AI assistant is currently analyzing and implementing the solution draft.

### 📝 Implementation Details
_Details will be added as the solution draft is developed..._

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
                // Store PR info globally for error handlers
                global.createdPR = { number: prNumber, url: prUrl };
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
                  // Store PR info globally for error handlers
                  global.createdPR = { number: prNumber, url: prUrl };
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
  let { newPrComments, newIssueComments, commentInfo, feedbackLines } = await detectAndCountFeedback({
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

  // Check for uncommitted changes before running Claude
  // Only add to feedback if auto-commit is disabled
  if (!argv['auto-commit-uncommitted-changes']) {
    await log('\n🔍 Checking for uncommitted changes to include as feedback...');
    try {
      const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
      if (gitStatusResult.code === 0) {
        const statusOutput = gitStatusResult.stdout.toString().trim();
        if (statusOutput) {
          await log('📝 Found uncommitted changes - adding to feedback');

          // Add uncommitted changes info to feedbackLines
          if (!feedbackLines) {
            feedbackLines = [];
          }

          feedbackLines.push('');
          feedbackLines.push('⚠️ UNCOMMITTED CHANGES DETECTED:');
          feedbackLines.push('The following uncommitted changes were found in the repository:');
          feedbackLines.push('');

          for (const line of statusOutput.split('\n')) {
            feedbackLines.push(`  ${line}`);
          }

          feedbackLines.push('');
          feedbackLines.push('Please review and handle these changes appropriately.');
          feedbackLines.push('Consider committing important changes or cleaning up unnecessary files.');
        } else {
          await log('✅ No uncommitted changes found');
        }
      }
    } catch (gitError) {
      await log(`⚠️ Warning: Could not check git status: ${gitError.message}`, { level: 'warning' });
    }
  }

  // Execute Claude command with all prompts and settings
  const claudeResult = await executeClaude({
    issueUrl,
    issueNumber,
    prNumber,
    prUrl,
    branchName,
    tempDir,
    isContinueMode,
    mergeStateStatus,
    forkedRepo,
    feedbackLines,
    owner,
    repo,
    argv,
    log,
    formatAligned,
    getResourceSnapshot,
    claudePath,
    $
  });

  const { success, sessionId, messageCount, toolUseCount } = claudeResult;
  limitReached = claudeResult.limitReached;

  if (!success) {
    process.exit(1);
  }

  // Check for uncommitted changes
  const shouldRestart = await checkForUncommittedChanges(tempDir, owner, repo, branchName, $, log, argv['auto-commit-uncommitted-changes']);

  // If uncommitted changes detected and auto-commit is disabled, restart Claude once
  if (shouldRestart) {
    await log('🔄 Triggering auto-restart to handle uncommitted changes...');

    // Spawn a new solve process with continue mode
    const { spawn } = await import('child_process');
    const restartArgs = [
      process.argv[1], // solve.mjs path
      prUrl || issueUrl, // Use PR URL if available, otherwise issue URL
      '--continue' // Use continue mode for the restart
    ];

    // Pass through relevant options
    if (argv.fork) restartArgs.push('--fork');
    if (argv.attachLogs) restartArgs.push('--attach-logs');
    if (argv['auto-commit-uncommitted-changes']) restartArgs.push('--auto-commit-uncommitted-changes');
    if (argv.verbose) restartArgs.push('--verbose');
    if (argv.model !== 'sonnet') restartArgs.push('--model', argv.model);

    await log(formatAligned('', 'Command:', restartArgs.slice(1).join(' '), 2));
    await log('');

    const child = spawn(process.argv[0], restartArgs, {
      stdio: 'inherit',
      env: process.env
    });

    await new Promise((resolve) => {
      child.on('exit', (code) => {
        process.exit(code || 0);
      });
    });
  } else {
    // Remove CLAUDE.md now that Claude command has finished
    await cleanupClaudeFile(tempDir, branchName);

    // Show summary of session and log file
    await showSessionSummary(sessionId, limitReached, argv, issueUrl, tempDir, shouldAttachLogs);

    // Search for newly created pull requests and comments
    await verifyResults(owner, repo, branchName, issueNumber, prNumber, prUrl, referenceTime, argv, shouldAttachLogs);

    // Start watch mode if enabled
    if (argv.verbose) {
      await log('');
      await log('🔍 Watch mode debug:', { verbose: true });
      await log(`   argv.watch: ${argv.watch}`, { verbose: true });
      await log(`   prNumber: ${prNumber || 'null'}`, { verbose: true });
      await log(`   prBranch: ${prBranch || 'null'}`, { verbose: true });
      await log(`   branchName: ${branchName}`, { verbose: true });
      await log(`   isContinueMode: ${isContinueMode}`, { verbose: true });
    }

    await startWatchMode({
      issueUrl,
      owner,
      repo,
      issueNumber,
      prNumber,
      prBranch,
      branchName,
      tempDir,
      argv
    });
  }
} catch (error) {
  await handleMainExecutionError({
    error,
    log,
    cleanErrorMessage,
    absoluteLogPath,
    shouldAttachLogs,
    argv,
    global,
    owner,
    repo,
    getLogFile,
    attachLogToGitHub,
    sanitizeLogContent,
    $
  });
} finally {
  // Clean up temporary directory using repository module
  await cleanupTempDirectory(tempDir, argv, limitReached);
}