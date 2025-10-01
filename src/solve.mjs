#!/usr/bin/env node
// Import Sentry instrumentation first (must be before other imports)
import './instrument.mjs';

// Early exit paths - handle these before loading all modules to speed up testing
const earlyArgs = process.argv.slice(2);
if (earlyArgs.includes('--version')) {
  const { getVersion } = await import('./version.lib.mjs');
  try {
    const version = await getVersion();
    console.log(version);
  } catch {
    console.error('Error: Unable to determine version');
    process.exit(1);
  }
  process.exit(0);
}
if (earlyArgs.includes('--help') || earlyArgs.includes('-h')) {
  // Load minimal modules needed for help
  const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
  globalThis.use = use;
  const config = await import('./solve.config.lib.mjs');
  const { initializeConfig, createYargsConfig } = config;
  const { yargs, hideBin } = await initializeConfig(use);
  const rawArgs = hideBin(process.argv);
  // Filter out help flags to avoid duplicate display
  const argsWithoutHelp = rawArgs.filter(arg => arg !== '--help' && arg !== '-h');
  createYargsConfig(yargs(argsWithoutHelp)).showHelp();
  process.exit(0);
}
if (earlyArgs.length === 0) {
  console.error('Usage: solve.mjs <issue-url> [options]');
  console.error('\nError: Missing required github issue or pull request URL');
  console.error('\nRun "solve.mjs --help" for more information');
  process.exit(1);
}
// Now load all modules for normal operation
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
globalThis.use = use;
const { $ } = await use('command-stream');
const config = await import('./solve.config.lib.mjs');
const { initializeConfig, parseArguments } = config;
// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { initializeSentry, addBreadcrumb, reportError } = sentryLib;
const { yargs, hideBin } = await initializeConfig(use);
const path = (await use('path')).default;
const fs = (await use('fs')).promises;
const crypto = (await use('crypto')).default;
const memoryCheck = await import('./memory-check.mjs');
const lib = await import('./lib.mjs');
const { log, setLogFile, getLogFile, getAbsoluteLogPath, cleanErrorMessage, formatAligned, getVersionInfo } = lib;
const githubLib = await import('./github.lib.mjs');
const { sanitizeLogContent, attachLogToGitHub, checkFileInBranch, checkGitHubPermissions } = githubLib;
const validation = await import('./solve.validation.lib.mjs');
const { validateGitHubUrl, showAttachLogsWarning, initializeLogFile, validateUrlRequirement, validateContinueOnlyOnFeedback, performSystemChecks, parseUrlComponents } = validation;
const autoContinue = await import('./solve.auto-continue.lib.mjs');
const { processAutoContinueForIssue } = autoContinue;
const repository = await import('./solve.repository.lib.mjs');
const { setupTempDirectory, setupRepository, cloneRepository, setupUpstreamAndSync, setupPrForkRemote, checkoutPrBranch, cleanupTempDirectory } = repository;
const results = await import('./solve.results.lib.mjs');
const { cleanupClaudeFile, showSessionSummary, verifyResults } = results;
const claudeLib = await import('./claude.lib.mjs');
const { executeClaude, checkForUncommittedChanges } = claudeLib;
const feedback = await import('./solve.feedback.lib.mjs');
const { detectAndCountFeedback } = feedback;
const errorHandlers = await import('./solve.error-handlers.lib.mjs');
const { createUncaughtExceptionHandler, createUnhandledRejectionHandler, handleMainExecutionError } = errorHandlers;
const branchErrors = await import('./solve.branch-errors.lib.mjs');
const { handleBranchCheckoutError, handleBranchCreationError, handleBranchVerificationError } = branchErrors;
const watchLib = await import('./solve.watch.lib.mjs');
const { startWatchMode } = watchLib;
const exitHandler = await import('./exit-handler.lib.mjs');
const { initializeExitHandler, installGlobalExitHandlers, safeExit } = exitHandler;
>>>>>>> origin/main:src/solve.mjs
const getResourceSnapshot = memoryCheck.getResourceSnapshot;
const argv = await parseArguments(yargs, hideBin);
global.verboseMode = argv.verbose;
const shouldAttachLogs = argv.attachLogs || argv['attach-logs'];
await showAttachLogsWarning(shouldAttachLogs);
const logFile = await initializeLogFile(argv.logDir);
const absoluteLogPath = path.resolve(logFile);
// Initialize Sentry integration (unless disabled)
if (!argv.noSentry) {
  await initializeSentry({
    noSentry: argv.noSentry,
    debug: argv.verbose,
    version: process.env.npm_package_version || '0.12.0'
  });

  // Add breadcrumb for solve operation
  addBreadcrumb({
    category: 'solve',
    message: 'Started solving issue',
    level: 'info',
    data: {
      model: argv.model,
      issueUrl: argv._?.[0] || 'not-set-yet'
    }
  });
}
// Create a cleanup wrapper that will be populated with context later
let cleanupContext = { tempDir: null, argv: null, limitReached: false };
const cleanupWrapper = async () => {
  if (cleanupContext.tempDir && cleanupContext.argv) {
    await cleanupTempDirectory(cleanupContext.tempDir, cleanupContext.argv, cleanupContext.limitReached);
  }
};
// Initialize the exit handler with getAbsoluteLogPath function and cleanup wrapper
initializeExitHandler(getAbsoluteLogPath, log, cleanupWrapper);
installGlobalExitHandlers();
// Log version and raw command at the start
const versionInfo = await getVersionInfo();
await log('');
await log(`🚀 solve v${versionInfo}`);
const rawCommand = process.argv.join(' ');
await log('🔧 Raw command executed:');
await log(`   ${rawCommand}`);
await log('');
// Now handle argument validation that was moved from early checks
let issueUrl = argv._[0];
if (!issueUrl) {
  await log('Usage: solve.mjs <issue-url> [options]', { level: 'error' });
  await log('Error: Missing required github issue or pull request URL', { level: 'error' });
  await log('Run "solve.mjs --help" for more information', { level: 'error' });
  await safeExit(1, 'Missing required GitHub URL');
}
// Validate GitHub URL using validation module (more thorough check)
const urlValidation = validateGitHubUrl(issueUrl);
if (!urlValidation.isValid) {
  await safeExit(1, 'Invalid GitHub URL');
}
const { isIssueUrl, isPrUrl, normalizedUrl } = urlValidation;
issueUrl = normalizedUrl || issueUrl;
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
  await safeExit(1, 'URL requirement validation failed');
}
if (!(await validateContinueOnlyOnFeedback(argv, isPrUrl, isIssueUrl))) {
  await safeExit(1, 'Feedback validation failed');
}
// Perform all system checks using validation module
// Skip Claude validation in dry-run mode or when --skip-claude-check is enabled
const skipClaudeCheck = argv.dryRun || argv.skipClaudeCheck;
if (!(await performSystemChecks(argv.minDiskSpace || 500, skipClaudeCheck, argv.model))) {
  await safeExit(1, 'System checks failed');
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
let prState;
let forkOwner = null;
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
  // Check if PR is from a fork and get fork owner, merge status, and PR state
  if (argv.verbose) {
    await log('   Checking if PR is from a fork...', { verbose: true });
  }
  try {
    const prCheckResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json headRepositoryOwner,mergeStateStatus,state`;
    if (prCheckResult.code === 0) {
      const prCheckData = JSON.parse(prCheckResult.stdout.toString());
      // Extract merge status and PR state
      mergeStateStatus = prCheckData.mergeStateStatus;
      prState = prCheckData.state;
      if (argv.verbose) {
        await log(`   PR state: ${prState || 'UNKNOWN'}`, { verbose: true });
        await log(`   Merge status: ${mergeStateStatus || 'UNKNOWN'}`, { verbose: true });
      }
      if (prCheckData.headRepositoryOwner && prCheckData.headRepositoryOwner.login !== owner) {
        forkOwner = prCheckData.headRepositoryOwner.login;
        await log(`🍴 Detected fork PR from ${forkOwner}/${repo}`);
        if (argv.verbose) {
          await log(`   Fork owner: ${forkOwner}`, { verbose: true });
          await log('   Will clone fork repository for continue mode', { verbose: true });
        }
      }
    }
  } catch (forkCheckError) {
    if (argv.verbose) {
      await log(`   Warning: Could not check fork status: ${forkCheckError.message}`, { verbose: true });
    }
  }
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
    const prResult = await githubLib.ghPrView({
      prNumber,
      owner,
      repo,
      jsonFields: 'headRefName,body,number,mergeStateStatus,state,headRepositoryOwner'
    });

    if (prResult.code !== 0 || !prResult.data) {
      await log('Error: Failed to get PR details', { level: 'error' });
      if (prResult.output.includes('Could not resolve to a PullRequest')) {
        await githubLib.handlePRNotFoundError({ prNumber, owner, repo, argv, shouldAttachLogs });
      } else {
        await log(`Error: ${prResult.stderr || 'Unknown error'}`, { level: 'error' });
      }

      await safeExit(1, 'Failed to get PR details');
    }

    const prData = prResult.data;
    prBranch = prData.headRefName;
    mergeStateStatus = prData.mergeStateStatus;
    prState = prData.state;

    // Check if this is a fork PR
    if (prData.headRepositoryOwner && prData.headRepositoryOwner.login !== owner) {
      forkOwner = prData.headRepositoryOwner.login;
      await log(`🍴 Detected fork PR from ${forkOwner}/${repo}`);
      if (argv.verbose) {
        await log(`   Fork owner: ${forkOwner}`, { verbose: true });
        await log('   Will clone fork repository for continue mode', { verbose: true });
      }
    }

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
    reportError(error, {
      context: 'pr_processing',
      prNumber,
      operation: 'process_pull_request'
    });
    await log(`Error: Failed to process PR: ${cleanErrorMessage(error)}`, { level: 'error' });
    await safeExit(1, 'Failed to process PR');
  }
} else {
  // Traditional issue mode
>>>>>>> origin/main:src/solve.mjs
  issueNumber = urlNumber;
  await log(`📝 Issue mode: Working with issue #${issueNumber}`);
}

// Create or find temporary directory for cloning the repository
const { tempDir } = await setupTempDirectory(argv);

// Populate cleanup context for signal handlers
cleanupContext.tempDir = tempDir;
cleanupContext.argv = argv;

// Initialize limitReached variable outside try block for finally clause
let limitReached = false;

let limitReached = false; // Declare here for access in finally block

try {
  // Set up repository and handle forking
  const { repoToClone, forkedRepo, upstreamRemote, prForkOwner } = await setupRepository(argv, owner, repo, forkOwner);

  // Clone repository and set up remotes
  await cloneRepository(repoToClone, tempDir, argv, owner, repo);
  // Set up upstream remote and sync fork if needed
  await setupUpstreamAndSync(tempDir, forkedRepo, upstreamRemote, owner, repo);

  // Set up pr-fork remote if we're continuing someone else's fork PR with --fork flag
  const prForkRemote = await setupPrForkRemote(tempDir, argv, prForkOwner, repo, isContinueMode);

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
    await safeExit(1, 'Failed to get current branch');
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
    await safeExit(1, 'Default branch detection failed');
  }
  await log(`\n${formatAligned('📌', 'Default branch:', defaultBranch)}`);

  // Ensure we're on a clean default branch
  const statusResult = await $({ cwd: tempDir })`git status --porcelain`;

  if (statusResult.code !== 0) {
    await log('Error: Failed to check git status');
    await log(statusResult.stderr ? statusResult.stderr.toString() : 'Unknown error');
    await safeExit(1, 'Failed to check git status');
  }
  
  // Note: Empty output means clean working directory
  const statusOutput = statusResult.stdout.toString().trim();
  if (statusOutput) {
    await log('Error: Repository has uncommitted changes after clone');
    await log(`Status output: ${statusOutput}`);
    await safeExit(1, 'Repository has uncommitted changes after clone');
  }

  // Create a branch for the issue or checkout existing PR branch
  let branchName;
  let checkoutResult;
  
  if (isContinueMode && prBranch) {
    // Continue mode: checkout existing PR branch
    branchName = prBranch;
    checkoutResult = await checkoutPrBranch(tempDir, branchName, prForkRemote, prForkOwner);
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
      await handleBranchCheckoutError({
        branchName,
        prNumber,
        errorOutput,
        issueUrl,
        owner,
        repo,
        tempDir,
        argv,
        formatAligned,
        log,
        $
      });
    } else {
      await handleBranchCreationError({
        branchName,
        errorOutput,
        tempDir,
        owner,
        repo,
        formatAligned,
        log
      });
    }
    
    await log('');
    await log(`  📂 Working directory: ${tempDir}`);
    await safeExit(1, 'Branch operation failed');
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
    await safeExit(1, 'Branch verification failed');
  }
  
  const actualBranch = verifyResult.stdout.toString().trim();
  if (actualBranch !== branchName) {
    // Branch wasn't actually created/checked out or we didn't switch to it
    await handleBranchVerificationError({
      isContinueMode,
      branchName,
      actualBranch,
      prNumber,
      owner,
      repo,
      tempDir,
      formatAligned,
      log,
      $
    });
    await safeExit(1, 'Branch verification mismatch');
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
        await safeExit(1, 'Failed to add CLAUDE.md');
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
        await safeExit(1, 'Failed to create initial commit');
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
            // Check if user already has a fork
            let userHasFork = false;
            let currentUser = null;
            try {
              const userResult = await $`gh api user --jq .login`;
              if (userResult.code === 0) {
                currentUser = userResult.stdout.toString().trim();
                const forkCheckResult = await $`gh repo view ${currentUser}/${repo} --json parent 2>/dev/null`;
                if (forkCheckResult.code === 0) {
                  const forkData = JSON.parse(forkCheckResult.stdout.toString());
                  if (forkData.parent && forkData.parent.owner && forkData.parent.owner.login === owner) {
                    userHasFork = true;
                  }
                }
              }
            } catch (e) {
              reportError(e, {
                context: 'fork_check',
                owner,
                repo,
                operation: 'check_user_fork'
              });
              // Ignore error - fork check is optional
            }

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
            await log('  ┌──────────────────────────────────────────────────────────┐');
            await log('  │  RECOMMENDED: Use the --fork option                     │');
            await log('  └──────────────────────────────────────────────────────────┘');
            await log('');
            await log('  Run the command again with --fork:');
            await log('');
            await log(`    ./solve.mjs "${issueUrl}" --fork`);
            await log('');
            await log('  This will automatically:');
            if (userHasFork) {
              await log(`    ✓ Use your existing fork (${currentUser}/${repo})`);
              await log('    ✓ Sync your fork with the latest changes');
            } else {
              await log('    ✓ Fork the repository to your account');
            }
            await log('    ✓ Push changes to your fork');
            await log('    ✓ Create a PR from your fork to the original repo');
            await log('    ✓ Handle all the remote setup automatically');
            await log('');
            await log('  ─────────────────────────────────────────────────────────');
            await log('');
            await log('  Alternative options:');
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
            if (userHasFork) {
              await log(`   Note: We detected you already have a fork at ${currentUser}/${repo}`);
            }
            await log('');
            await safeExit(1, 'Permission denied - need fork or collaborator access');
          } else {
            // Other push errors
            await log(`${formatAligned('❌', 'Failed to push:', 'See error below')}`, { level: 'error' });
            await log(`   Error: ${errorOutput}`, { level: 'error' });
            await safeExit(1, 'Failed to push branch');
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
              reportError(e, {
                context: 'collaborator_check',
                owner,
                repo,
                currentUser,
                operation: 'check_collaborator_access'
              });
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
          const targetBranch = argv.baseBranch || defaultBranch;
          await log(formatAligned('🔀', 'Creating PR:', 'Draft pull request...'));
          if (argv.baseBranch) {
            await log(formatAligned('🎯', 'Target branch:', `${targetBranch} (custom)`));
          } else {
            await log(formatAligned('🎯', 'Target branch:', `${targetBranch} (default)`));
          }
          
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
            // Note: targetBranch is already defined above
            let command;
            if (argv.fork && forkedRepo) {
              // For forks, specify the full head reference
              const forkUser = forkedRepo.split('/')[0];
              command = `cd "${tempDir}" && gh pr create --draft --title "[WIP] ${issueTitle}" --body-file "${prBodyFile}" --base ${targetBranch} --head ${forkUser}:${branchName} --repo ${owner}/${repo}`;
            } else {
              command = `cd "${tempDir}" && gh pr create --draft --title "[WIP] ${issueTitle}" --body-file "${prBodyFile}" --base ${targetBranch} --head ${branchName}`;
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
            await fs.unlink(prBodyFile).catch((unlinkError) => {
              reportError(unlinkError, {
                context: 'pr_body_file_cleanup',
                prBodyFile,
                operation: 'delete_temp_file'
              });
            });
            
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
                  reportError(linkError, {
                    context: 'pr_issue_link_verification',
                    prUrl,
                    issueNumber,
                    operation: 'verify_issue_link'
                  });
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
            reportError(prCreateError, {
              context: 'pr_creation',
              issueNumber,
              branchName,
              operation: 'create_pull_request'
            });
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
                  reportError(parseErr, {
                    context: 'pr_output_parsing',
                    operation: 'parse_pr_creation_output'
                  });
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
                await safeExit(1, 'PR creation failed');
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
              await safeExit(1, 'PR creation failed - no commits between branches');
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
              await safeExit(1, 'PR creation failed');
            }
          }
        }
      }
    } catch (prError) {
      reportError(prError, {
        context: 'auto_pr_creation',
        issueNumber,
        operation: 'handle_auto_pr'
      });
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

  // Record work start time and convert PR to draft if in continue/watch mode
  const workStartTime = new Date();
  if (isContinueMode && prNumber && (argv.watch || argv.autoContinue)) {
    await log(`\n${formatAligned('🚀', 'Starting work session:', workStartTime.toISOString())}`);

    // Convert PR back to draft if not already
    try {
      const prStatusResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json isDraft --jq .isDraft`;
      if (prStatusResult.code === 0) {
        const isDraft = prStatusResult.stdout.toString().trim() === 'true';
        if (!isDraft) {
          await log(formatAligned('📝', 'Converting PR:', 'Back to draft mode...', 2));
          const convertResult = await $`gh pr ready ${prNumber} --repo ${owner}/${repo} --undo`;
          if (convertResult.code === 0) {
            await log(formatAligned('✅', 'PR converted:', 'Now in draft mode', 2));
          } else {
            await log('Warning: Could not convert PR to draft', { level: 'warning' });
          }
        } else {
          await log(formatAligned('✅', 'PR status:', 'Already in draft mode', 2));
        }
      }
    } catch (error) {
      reportError(error, {
        context: 'convert_pr_to_draft',
        prNumber,
        operation: 'pr_status_change'
      });
      await log('Warning: Could not check/convert PR draft status', { level: 'warning' });
    }

    // Post a comment marking the start of work session
    try {
      const startComment = `🤖 **AI Work Session Started**\n\nStarting automated work session at ${workStartTime.toISOString()}\n\nThe PR has been converted to draft mode while work is in progress.\n\n_This comment marks the beginning of an AI work session. Please wait working session to finish, and provide your feedback._`;
      const commentResult = await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${startComment}`;
      if (commentResult.code === 0) {
        await log(formatAligned('💬', 'Posted:', 'Work session start comment', 2));
      }
    } catch (error) {
      reportError(error, {
        context: 'post_start_comment',
        prNumber,
        operation: 'create_pr_comment'
      });
      await log('Warning: Could not post work start comment', { level: 'warning' });
    }
  }

  // Count new comments and detect feedback
  let { feedbackLines } = await detectAndCountFeedback({
    prNumber,
    branchName,
    owner,
    repo,
    issueNumber,
    isContinueMode,
    argv,
    mergeStateStatus,
    prState,
    workStartTime: isContinueMode && (argv.watch || argv.autoContinue) ? workStartTime : null,
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
    reportError(timestampError, {
      context: 'get_reference_timestamp',
      prNumber,
      issueNumber,
      operation: 'fetch_github_timestamps'
    });
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
      reportError(gitError, {
        context: 'check_uncommitted_changes',
        tempDir,
        operation: 'git_status'
      });
      await log(`⚠️ Warning: Could not check git status: ${gitError.message}`, { level: 'warning' });
    }
  }

  // Check for GitHub Actions on fork repository if applicable
  let forkActionsUrl = null;
  if (argv.fork && forkedRepo) {
    try {
      // Get fork owner from forkedRepo (format: owner/repo)
      const forkOwner = forkedRepo.split('/')[0];
      const forkRepo = forkedRepo.split('/')[1];

      // Check if workflows directory exists in the fork
      const workflowsResult = await $`gh api repos/${forkOwner}/${forkRepo}/contents/.github/workflows --jq '.[].name' 2>/dev/null`;

      if (workflowsResult.code === 0) {
        const workflows = workflowsResult.stdout.toString().trim();
        if (workflows) {
          // Workflows exist, construct the actions URL for the branch
          forkActionsUrl = `https://github.com/${forkOwner}/${forkRepo}/actions?query=branch%3A${encodeURIComponent(branchName)}`;
          await log(`${formatAligned('📦', 'Fork workflows detected:', forkActionsUrl)}`);
        }
      }
    } catch {
      // No workflows or error checking - that's fine, forkActionsUrl stays null
      if (argv.verbose) {
        await log('No GitHub Actions workflows found on fork', { verbose: true });
      }
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
    forkActionsUrl,
    owner,
    repo,
    argv,
    log,
    setLogFile,
    getLogFile,
    formatAligned,
    getResourceSnapshot,
    claudePath,
    $
  });

  const { success, sessionId, messageCount, toolUseCount } = claudeResult;
  limitReached = claudeResult.limitReached;
  cleanupContext.limitReached = limitReached;

  if (!success) {
    await safeExit(1, 'Claude execution failed');
  }

  // Check for uncommitted changes
  const shouldRestart = await checkForUncommittedChanges(tempDir, owner, repo, branchName, $, log, argv['auto-commit-uncommitted-changes']);

  // Remove CLAUDE.md now that Claude command has finished
  await cleanupClaudeFile(tempDir, branchName);

  // Show summary of session and log file
  await showSessionSummary(sessionId, limitReached, argv, issueUrl, tempDir, shouldAttachLogs);

  // Search for newly created pull requests and comments
  await verifyResults(owner, repo, branchName, issueNumber, prNumber, prUrl, referenceTime, argv, shouldAttachLogs);

  // Start watch mode if enabled OR if we need to handle uncommitted changes
  if (argv.verbose) {
    await log('');
    await log('🔍 Watch mode debug:', { verbose: true });
    await log(`   argv.watch: ${argv.watch}`, { verbose: true });
    await log(`   shouldRestart: ${shouldRestart}`, { verbose: true });
    await log(`   prNumber: ${prNumber || 'null'}`, { verbose: true });
    await log(`   prBranch: ${prBranch || 'null'}`, { verbose: true });
    await log(`   branchName: ${branchName}`, { verbose: true });
    await log(`   isContinueMode: ${isContinueMode}`, { verbose: true });
  }

  // If uncommitted changes detected and auto-commit is disabled, enter temporary watch mode
  const temporaryWatchMode = shouldRestart && !argv.watch;
  if (temporaryWatchMode) {
    await log('');
    await log('🔄 Uncommitted changes detected - entering temporary watch mode to handle them...');
    await log('   Watch mode will exit automatically once changes are committed.');
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
    argv: {
      ...argv,
      watch: argv.watch || shouldRestart, // Enable watch if uncommitted changes
      temporaryWatch: temporaryWatchMode  // Flag to indicate temporary watch mode
    }
  });
} catch (error) {
  await handleMainExecutionError(error, shouldAttachLogs, owner, repo);

  // Post end work session comment and convert PR back to ready if in continue mode
  if (isContinueMode && prNumber && (argv.watch || argv.autoContinue)) {
    const workEndTime = new Date();
    await log(`\n${formatAligned('🏁', 'Ending work session:', workEndTime.toISOString())}`);

    // Post a comment marking the end of work session
    try {
      const endComment = `🤖 **AI Work Session Completed**\n\nWork session ended at ${workEndTime.toISOString()}\n\nThe PR will be converted back to ready for review.\n\n_This comment marks the end of an AI work session. New comments after this time will be considered as feedback._`;
      const commentResult = await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${endComment}`;
      if (commentResult.code === 0) {
        await log(formatAligned('💬', 'Posted:', 'Work session end comment', 2));
      }
    } catch (error) {
      reportError(error, {
        context: 'post_end_comment',
        prNumber,
        operation: 'create_pr_comment'
      });
      await log('Warning: Could not post work end comment', { level: 'warning' });
    }

    // Convert PR back to ready for review
    try {
      const prStatusResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json isDraft --jq .isDraft`;
      if (prStatusResult.code === 0) {
        const isDraft = prStatusResult.stdout.toString().trim() === 'true';
        if (isDraft) {
          await log(formatAligned('🔀', 'Converting PR:', 'Back to ready for review...', 2));
          const convertResult = await $`gh pr ready ${prNumber} --repo ${owner}/${repo}`;
          if (convertResult.code === 0) {
            await log(formatAligned('✅', 'PR converted:', 'Ready for review', 2));
          } else {
            await log('Warning: Could not convert PR to ready', { level: 'warning' });
          }
        } else {
          await log(formatAligned('✅', 'PR status:', 'Already ready for review', 2));
        }
      }
    } catch (error) {
      reportError(error, {
        context: 'convert_pr_to_ready',
        prNumber,
        operation: 'pr_status_change'
      });
      await log('Warning: Could not convert PR to ready status', { level: 'warning' });
    }
  }
} catch (error) {
  reportError(error, {
    context: 'solve_main',
    operation: 'main_execution'
  });
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
>>>>>>> origin/main:src/solve.mjs
} finally {
  // Clean up temporary directory using repository module
  await cleanupTempDirectory(tempDir, argv, limitReached);
}