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

// Configure command line arguments - GitHub issue URL as positional argument
const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 <issue-url> [options]')
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
  .demandCommand(1, 'The GitHub issue URL is required')
  .help('h')
  .alias('h', 'help')
  .argv;

const issueUrl = argv._[0];

// Set global verbose mode for log function
global.verboseMode = argv.verbose;

// Create permanent log file immediately with timestamp
const scriptDir = path.dirname(process.argv[1]);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
logFile = path.join(scriptDir, `solve-${timestamp}.log`);

// Create the log file immediately
await fs.writeFile(logFile, `# Solve.mjs Log - ${new Date().toISOString()}\n\n`);
await log(`📁 Log file: ${logFile}`);
await log(`   (All output will be logged here)`);

// Helper function to format aligned console output
const formatAligned = (icon, label, value, indent = 0) => {
  const spaces = ' '.repeat(indent);
  const labelWidth = 25 - indent;
  const paddedLabel = label.padEnd(labelWidth, ' ');
  return `${spaces}${icon} ${paddedLabel} ${value || ''}`;
};

// Validate GitHub issue URL format
if (!issueUrl.match(/^https:\/\/github\.com\/[^\/]+\/[^\/]+\/issues\/\d+$/)) {
  await log('Error: Please provide a valid GitHub issue URL (e.g., https://github.com/owner/repo/issues/123)', { level: 'error' });
  process.exit(1);
}

const claudePath = process.env.CLAUDE_PATH || 'claude';

// Extract repository and issue number from URL
const urlParts = issueUrl.split('/');
const owner = urlParts[3];
const repo = urlParts[4];
const issueNumber = urlParts[6];

// Create or find temporary directory for cloning the repository
let tempDir;
let isResuming = argv.resume;

if (isResuming) {
  // When resuming, try to find existing directory or create a new one
  const scriptDir = path.dirname(process.argv[1]);
  const sessionLogPattern = path.join(scriptDir, `${argv.resume}.log`);

  try {
    // Check if session log exists to verify session is valid
    await fs.access(sessionLogPattern);
    await log(`🔄 Resuming session ${argv.resume} (session log found)`);

    // For resumed sessions, create new temp directory since old one may be cleaned up
    tempDir = path.join(os.tmpdir(), `gh-issue-solver-resume-${argv.resume}-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    await log(`Creating new temporary directory for resumed session: ${tempDir}`);
  } catch (err) {
    await log(`Warning: Session log for ${argv.resume} not found, but continuing with resume attempt`);
    tempDir = path.join(os.tmpdir(), `gh-issue-solver-resume-${argv.resume}-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    await log(`Creating temporary directory for resumed session: ${tempDir}`);
  }
} else {
  tempDir = path.join(os.tmpdir(), `gh-issue-solver-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  await log(`\nCreating temporary directory: ${tempDir}`);
}

try {
  // Determine if we need to fork the repository
  let repoToClone = `${owner}/${repo}`;
  let forkedRepo = null;
  let upstreamRemote = null;
  
  if (argv.fork) {
    await log(`\n${formatAligned('🍴', 'Fork mode:', 'ENABLED')}`);
    await log(`${formatAligned('', 'Checking fork status...', '')}\n`);
    
    // Get current user
    const userResult = await $`gh api user --jq .login`;
    if (userResult.code !== 0) {
      await log(`${formatAligned('❌', 'Error:', 'Failed to get current user')}`);
      process.exit(1);
    }
    const currentUser = userResult.stdout.toString().trim();
    
    // Check if fork already exists
    const forkCheckResult = await $`gh repo view ${currentUser}/${repo} --json name 2>/dev/null`;
    
    if (forkCheckResult.code === 0) {
      // Fork exists
      await log(`${formatAligned('✅', 'Fork exists:', `${currentUser}/${repo}`)}`);
      repoToClone = `${currentUser}/${repo}`;
      forkedRepo = `${currentUser}/${repo}`;
      upstreamRemote = `${owner}/${repo}`;
    } else {
      // Need to create fork
      await log(`${formatAligned('🔄', 'Creating fork...', '')}`);
      const forkResult = await $`gh repo fork ${owner}/${repo} --clone=false`;
      
      if (forkResult.code !== 0) {
        await log(`${formatAligned('❌', 'Error:', 'Failed to create fork')}`);
        await log(forkResult.stderr ? forkResult.stderr.toString() : 'Unknown error');
        process.exit(1);
      }
      
      await log(`${formatAligned('✅', 'Fork created:', `${currentUser}/${repo}`)}`);
      repoToClone = `${currentUser}/${repo}`;
      forkedRepo = `${currentUser}/${repo}`;
      upstreamRemote = `${owner}/${repo}`;
      
      // Wait a moment for fork to be ready
      await log(`${formatAligned('⏳', 'Waiting:', 'For fork to be ready...')}`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // Clone the repository (or fork) using gh tool with authentication
  await log(`\n${formatAligned('📥', 'Cloning repository:', repoToClone)}`);
  
  // Use 2>&1 to capture all output and filter "Cloning into" message
  const cloneResult = await $`gh repo clone ${repoToClone} ${tempDir} 2>&1`;
  
  // Verify clone was successful
  if (cloneResult.code !== 0) {
    const errorOutput = (cloneResult.stderr || cloneResult.stdout || 'Unknown error').toString().trim();
    await log(``);
    await log(`${formatAligned('❌', 'CLONE FAILED', '')}`, { level: 'error' });
    await log(``);
    await log(`  🔍 What happened:`);
    await log(`     Failed to clone repository ${repoToClone}`);
    await log(``);
    await log(`  📦 Error details:`);
    for (const line of errorOutput.split('\n')) {
      if (line.trim()) await log(`     ${line}`);
    }
    await log(``);
    await log(`  💡 Common causes:`);
    await log(`     • Repository doesn't exist or is private`);
    await log(`     • No GitHub authentication`);
    await log(`     • Network connectivity issues`);
    if (argv.fork) {
      await log(`     • Fork not ready yet (try again in a moment)`);
    }
    await log(``);
    await log(`  🔧 How to fix:`);
    await log(`     1. Check authentication: gh auth status`);
    await log(`     2. Login if needed: gh auth login`);
    await log(`     3. Verify access: gh repo view ${owner}/${repo}`);
    if (argv.fork) {
      await log(`     4. Check fork: gh repo view ${repoToClone}`);
    }
    await log(``);
    process.exit(1);
  }

  await log(`${formatAligned('✅', 'Cloned to:', tempDir)}`);
  
  // Verify and fix remote configuration
  const remoteCheckResult = await $({ cwd: tempDir })`git remote -v 2>&1`;
  if (!remoteCheckResult.stdout || !remoteCheckResult.stdout.toString().includes('origin')) {
    await log(`   Setting up git remote...`, { verbose: true });
    // Add origin remote manually
    await $({ cwd: tempDir })`git remote add origin https://github.com/${repoToClone}.git 2>&1`;
  }
  
  // If using fork, set up upstream remote
  if (forkedRepo && upstreamRemote) {
    await log(`${formatAligned('🔗', 'Setting upstream:', upstreamRemote)}`);
    const upstreamResult = await $({ cwd: tempDir })`git remote add upstream https://github.com/${upstreamRemote}.git`;
    
    if (upstreamResult.code !== 0) {
      await log(`${formatAligned('⚠️', 'Warning:', 'Failed to add upstream remote')}`);
    } else {
      await log(`${formatAligned('✅', 'Upstream set:', upstreamRemote)}`);
      
      // Fetch upstream
      await log(`${formatAligned('🔄', 'Fetching upstream...', '')}`);
      const fetchResult = await $({ cwd: tempDir })`git fetch upstream`;
      if (fetchResult.code === 0) {
        await log(`${formatAligned('✅', 'Upstream fetched:', 'Successfully')}`);
      }
    }
  }

  // Set up git authentication using gh
  const authSetupResult = await $({ cwd: tempDir })`gh auth setup-git 2>&1`;
  if (authSetupResult.code !== 0) {
    await log('Note: gh auth setup-git had issues, continuing anyway\n');
  }

  // Verify we're on the default branch and get its name
  const defaultBranchResult = await $({ cwd: tempDir })`git branch --show-current`;
  
  if (defaultBranchResult.code !== 0) {
    await log(`Error: Failed to get current branch`);
    await log(defaultBranchResult.stderr ? defaultBranchResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }

  const defaultBranch = defaultBranchResult.stdout.toString().trim();
  if (!defaultBranch) {
    await log(``);
    await log(`${formatAligned('❌', 'DEFAULT BRANCH DETECTION FAILED', '')}`, { level: 'error' });
    await log(``);
    await log(`  🔍 What happened:`);
    await log(`     Unable to determine the repository's default branch.`);
    await log(``);
    await log(`  💡 This might mean:`);
    await log(`     • Repository is empty (no commits)`);
    await log(`     • Unusual repository configuration`);
    await log(`     • Git command issues`);
    await log(``);
    await log(`  🔧 How to fix:`);
    await log(`     1. Check repository: gh repo view ${owner}/${repo}`);
    await log(`     2. Verify locally: cd ${tempDir} && git branch`);
    await log(`     3. Check remote: cd ${tempDir} && git branch -r`);
    await log(``);
    process.exit(1);
  }
  await log(`\n${formatAligned('📌', 'Default branch:', defaultBranch)}`);

  // Ensure we're on a clean default branch
  const statusResult = await $({ cwd: tempDir })`git status --porcelain`;

  if (statusResult.code !== 0) {
    await log(`Error: Failed to check git status`);
    await log(statusResult.stderr ? statusResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }
  
  // Note: Empty output means clean working directory
  const statusOutput = statusResult.stdout.toString().trim();
  if (statusOutput) {
    await log(`Error: Repository has uncommitted changes after clone`);
    await log(`Status output: ${statusOutput}`);
    process.exit(1);
  }

  // Create a branch for the issue
  const randomHex = crypto.randomBytes(4).toString('hex');
  const branchName = `issue-${issueNumber}-${randomHex}`;
  await log(`\n${formatAligned('🌿', 'Creating branch:', `${branchName} from ${defaultBranch}`)}`);
  
  // IMPORTANT: Don't use 2>&1 here as it can interfere with exit codes
  // Git checkout -b outputs to stderr but that's normal
  const checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName}`;

  if (checkoutResult.code !== 0) {
    const errorOutput = (checkoutResult.stderr || checkoutResult.stdout || 'Unknown error').toString().trim();
    await log(``);
    await log(`${formatAligned('❌', 'BRANCH CREATION FAILED', '')}`, { level: 'error' });
    await log(``);
    await log(`  🔍 What happened:`);
    await log(`     Unable to create branch '${branchName}'.`);
    await log(``);
    await log(`  📦 Git output:`);
    for (const line of errorOutput.split('\n')) {
      await log(`     ${line}`);
    }
    await log(``);
    await log(`  💡 Possible causes:`);
    await log(`     • Branch name already exists`);
    await log(`     • Uncommitted changes in repository`);
    await log(`     • Git configuration issues`);
    await log(``);
    await log(`  🔧 How to fix:`);
    await log(`     1. Try running the command again (uses random names)`);
    await log(`     2. Check git status: cd ${tempDir} && git status`);
    await log(`     3. View existing branches: cd ${tempDir} && git branch -a`);
    await log(``);
    await log(`  📂 Working directory: ${tempDir}`);
    process.exit(1);
  }
  
  // CRITICAL: Verify the branch was actually created and we switched to it
  // This is necessary because git checkout -b can sometimes fail silently
  await log(`${formatAligned('🔍', 'Verifying:', 'Branch creation...')}`);
  const verifyResult = await $({ cwd: tempDir })`git branch --show-current`;
  
  if (verifyResult.code !== 0 || !verifyResult.stdout) {
    await log(``);
    await log(`${formatAligned('❌', 'BRANCH VERIFICATION FAILED', '')}`, { level: 'error' });
    await log(``);
    await log(`  🔍 What happened:`);
    await log(`     Unable to verify branch after creation attempt.`);
    await log(``);
    await log(`  🔧 Debug commands to try:`);
    await log(`     cd ${tempDir} && git branch -a`);
    await log(`     cd ${tempDir} && git status`);
    await log(``);
    process.exit(1);
  }
  
  const actualBranch = verifyResult.stdout.toString().trim();
  if (actualBranch !== branchName) {
    // Branch wasn't actually created or we didn't switch to it
    await log(``);
    await log(`${formatAligned('❌', 'BRANCH CREATION FAILED', '')}`, { level: 'error' });
    await log(``);
    await log(`  🔍 What happened:`);
    await log(`     Git checkout -b command didn't create or switch to the branch.`);
    await log(``);
    await log(`  📊 Branch status:`);
    await log(`     Attempted to create: ${branchName}`);
    await log(`     Currently on: ${actualBranch || '(unknown)'}`);
    await log(``);
    
    // Show all branches to help debug
    const allBranchesResult = await $({ cwd: tempDir })`git branch -a 2>&1`;
    if (allBranchesResult.code === 0) {
      await log(`  🌿 Available branches:`);
      for (const line of allBranchesResult.stdout.toString().split('\n')) {
        if (line.trim()) await log(`     ${line}`);
      }
      await log(``);
    }
    
    await log(`  💡 This is unusual. Possible causes:`);
    await log(`     • Git version incompatibility`);
    await log(`     • File system permissions issue`);
    await log(`     • Repository corruption`);
    await log(``);
    await log(`  🔧 How to fix:`);
    await log(`     1. Try creating the branch manually:`);
    await log(`        cd ${tempDir}`);
    await log(`        git checkout -b ${branchName}`);
    await log(`     `);
    await log(`     2. If that fails, try two-step approach:`);
    await log(`        cd ${tempDir}`);
    await log(`        git branch ${branchName}`);
    await log(`        git checkout ${branchName}`);
    await log(`     `);
    await log(`     3. Check your git version:`);
    await log(`        git --version`);
    await log(``);
    await log(`  📂 Working directory: ${tempDir}`);
    await log(``);
    process.exit(1);
  }
  
  await log(`${formatAligned('✅', 'Branch created:', branchName)}`);
  await log(`${formatAligned('✅', 'Current branch:', actualBranch)}`);

  // Initialize PR variables and prompt early
  let prUrl = null;
  let prNumber = null;
  
  // Build the prompt (will be updated with PR URL later if created)
  let prompt = `Issue to solve: ${issueUrl}
Your prepared branch: ${branchName}
Your prepared working directory: ${tempDir}${argv.fork && forkedRepo ? `
Your forked repository: ${forkedRepo}
Original repository (upstream): ${owner}/${repo}` : ''}

Proceed.`;
  
  if (argv.autoPullRequestCreation) {
    await log(`\n${formatAligned('🚀', 'Auto PR creation:', 'ENABLED')}`);
    await log(`     Creating:               Initial commit and draft PR...`);
    await log('');
    
    try {
      // Create CLAUDE.md file with the task details
      await log(formatAligned('📝', 'Creating:', 'CLAUDE.md with task details'));
      
      // Write the prompt to CLAUDE.md (using the same prompt we'll send to Claude)
      await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), prompt);
      await log(formatAligned('✅', 'File created:', 'CLAUDE.md'));
      
      // Add and commit the file
      await log(formatAligned('📦', 'Adding file:', 'To git staging'));
      
      // Use explicit cwd option for better reliability
      const addResult = await $({ cwd: tempDir })`git add CLAUDE.md`;
      
      if (addResult.code !== 0) {
        await log(`❌ Failed to add CLAUDE.md`, { level: 'error' });
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
        await log(`❌ Failed to create initial commit`, { level: 'error' });
        await log(`   Error: ${commitResult.stderr ? commitResult.stderr.toString() : 'Unknown error'}`, { level: 'error' });
        await log(`   stdout: ${commitResult.stdout ? commitResult.stdout.toString() : 'none'}`, { verbose: true });
        process.exit(1);
      } else {
        await log(formatAligned('✅', 'Commit created:', 'Successfully with CLAUDE.md'));
        if (argv.verbose) {
          await log(`   Commit output: ${commitResult.stdout.toString().trim()}`, { verbose: true });
        }
        
        // Verify commit was created before pushing
        const verifyCommitResult = await $({ cwd: tempDir })`git log --oneline -1 2>&1`;
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
            await log(``);
            await log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            await log(``);
            await log(`  🔒 You don't have write access to ${owner}/${repo}`);
            await log(``);
            await log(`  This typically happens when:`);
            await log(`    • You're not a collaborator on the repository`);
            await log(`    • The repository belongs to another user/organization`);
            await log(``);
            await log(`  📋 HOW TO FIX THIS:`);
            await log(``);
            await log(`  Option 1: Use the --fork flag (RECOMMENDED)`);
            await log(`  ${'-'.repeat(40)}`);
            await log(`  Run the command again with --fork:`);
            await log(``);
            await log(`    ./solve.mjs "${issueUrl}" --fork`);
            await log(``);
            await log(`  This will:`);
            await log(`    ✓ Fork the repository to your account`);
            await log(`    ✓ Push changes to your fork`);
            await log(`    ✓ Create a PR from your fork to the original repo`);
            await log(``);
            await log(`  Option 2: Request collaborator access`);
            await log(`  ${'-'.repeat(40)}`);
            await log(`  Ask the repository owner to add you as a collaborator:`);
            await log(`    → Go to: https://github.com/${owner}/${repo}/settings/access`);
            await log(``);
            await log(`  Option 3: Manual fork and clone`);
            await log(`  ${'-'.repeat(40)}`);
            await log(`  1. Fork the repo: https://github.com/${owner}/${repo}/fork`);
            await log(`  2. Clone your fork and work there`);
            await log(`  3. Create a PR from your fork`);
            await log(``);
            await log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            await log(``);
            await log(`💡 Tip: The --fork option automates the entire fork workflow!`);
            await log(``);
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
          await log(`   Waiting for GitHub to sync...`);
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
            await log(`   Warning: Branch not found on GitHub!`);
            await log(`   This will cause PR creation to fail.`);
            
            if (argv.verbose) {
              await log(`   Branch check result: ${branchCheckResult.stdout || branchCheckResult.stderr || 'empty'}`);
              
              // Show all branches on GitHub
              const allBranchesResult = await $({ silent: true })`gh api repos/${owner}/${repo}/branches --jq '.[].name' 2>&1`;
              if (allBranchesResult.code === 0) {
                await log(`   All GitHub branches: ${allBranchesResult.stdout.toString().split('\n').slice(0, 5).join(', ')}...`);
              }
            }
            
            // Try one more force push with explicit refspec
            await log(`   Attempting explicit push...`);
            const explicitPushCmd = `git push origin HEAD:refs/heads/${branchName} -f`;
            if (argv.verbose) {
              await log(`   Command: ${explicitPushCmd}`);
            }
            const explicitPushResult = await $`cd ${tempDir} && ${explicitPushCmd} 2>&1`;
            if (explicitPushResult.code === 0) {
              await log(`   Explicit push completed`);
              if (argv.verbose && explicitPushResult.stdout) {
                await log(`   Output: ${explicitPushResult.stdout.toString().trim()}`);
              }
              // Wait a bit more for GitHub to process
              await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
              await log(`   ERROR: Cannot push to GitHub!`);
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
            await log(`   Warning: Could not get issue title, using default`, { verbose: true });
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
              await log(`   User has collaborator access`, { verbose: true });
            } catch (e) {
              // User doesn't have access, which is fine - we just won't assign
              canAssign = false;
              await log(`   User is not a collaborator (will skip assignment)`, { verbose: true });
            }
            
            // Set permCheckResult for backward compatibility
            const permCheckResult = { code: canAssign ? 0 : 1 };
            if (permCheckResult.code === 0) {
              canAssign = true;
              await log(`   User has collaborator access`, { verbose: true });
            } else {
              // User doesn't have permission, but that's okay - we just won't assign
              await log(`   User is not a collaborator (will skip assignment)`, { verbose: true });
            }
          } else {
            await log(`   Warning: Could not get current user`, { verbose: true });
          }
          
          // Create draft pull request
          await log(formatAligned('🔀', 'Creating PR:', 'Draft pull request...'));
          
          const prBody = `## 🤖 AI-Powered Solution

This pull request is being automatically generated to solve issue #${issueNumber}.

### 📋 Issue Reference
Fixes #${issueNumber}

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
              await log(`⚠️ Warning: PR created but no URL returned`, { level: 'warning' });
              await log(`   Output: ${output}`, { verbose: true });
              
              // Try to get the PR URL using gh pr list
              await log(`   Attempting to find PR using gh pr list...`, { verbose: true });
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
                
                // Remove CLAUDE.md now that PR is successfully created
                // We need to commit and push the deletion so it's reflected in the PR
                try {
                  await fs.unlink(path.join(tempDir, 'CLAUDE.md'));
                  await log(formatAligned('🗑️', 'Cleanup:', 'Removing CLAUDE.md'));
                  
                  // Commit the deletion
                  const deleteCommitResult = await $({ cwd: tempDir })`git add CLAUDE.md && git commit -m "Remove CLAUDE.md - PR created successfully" 2>&1`;
                  if (deleteCommitResult.code === 0) {
                    await log(formatAligned('📦', 'Committed:', 'CLAUDE.md deletion'));
                    
                    // Push the deletion
                    const pushDeleteResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
                    if (pushDeleteResult.code === 0) {
                      await log(formatAligned('📤', 'Pushed:', 'CLAUDE.md removal to GitHub'));
                    } else {
                      await log(`   Warning: Could not push CLAUDE.md deletion`, { verbose: true });
                    }
                  } else {
                    await log(`   Warning: Could not commit CLAUDE.md deletion`, { verbose: true });
                  }
                } catch (e) {
                  // File might not exist or already removed, that's fine
                  await log(`   CLAUDE.md already removed or not found`, { verbose: true });
                }
                
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
                  // GitHub automatically creates the link when we use "Fixes #" but we can ensure it's properly linked
                  // by updating the PR body with the closing keyword if not already present
                  
                  // The Development section link is actually created automatically by GitHub when:
                  // 1. The PR body contains "Fixes #N", "Closes #N", or "Resolves #N"
                  // 2. The PR is in the same repository as the issue
                  // Since we already have "Fixes #${issueNumber}" in the body, it should auto-link
                  
                  // Let's verify the link was created
                  const linkCheckResult = await $`gh api graphql -f query='query { repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${prNumber}) { closingIssuesReferences(first: 10) { nodes { number } } } } }' --jq '.data.repository.pullRequest.closingIssuesReferences.nodes[].number'`;
                  
                  if (linkCheckResult.code === 0) {
                    const linkedIssues = linkCheckResult.stdout.toString().trim().split('\n').filter(n => n);
                    if (linkedIssues.includes(issueNumber)) {
                      await log(formatAligned('✅', 'Link verified:', `Issue #${issueNumber} → PR #${prNumber}`));
                    } else {
                      await log(`⚠️ Issue not found in closing references, GitHub should auto-link via "Fixes #${issueNumber}" in body`, { level: 'warning' });
                    }
                  } else {
                    await log(`⚠️ Could not verify issue link, but GitHub should auto-link via "Fixes #${issueNumber}" in body`, { level: 'warning' });
                  }
                } catch (linkError) {
                  await log(`⚠️ Could not verify issue linking: ${linkError.message}`, { level: 'warning' });
                  await log(`   GitHub should auto-link via "Fixes #${issueNumber}" in the PR body`, { level: 'warning' });
                }
              } else {
                await log(formatAligned('✅', 'PR created:', 'Successfully'));
                await log(formatAligned('📍', 'PR URL:', prUrl));
              }
              
              // Remove CLAUDE.md after successful PR creation
              // We need to commit and push the deletion so it's reflected in the PR
              try {
                await fs.unlink(path.join(tempDir, 'CLAUDE.md'));
                await log(formatAligned('🗑️', 'Cleanup:', 'Removing CLAUDE.md'));
                
                // Commit the deletion
                const deleteCommitResult = await $`cd ${tempDir} && git add CLAUDE.md && git commit -m "Remove CLAUDE.md - PR created successfully" 2>&1`;
                if (deleteCommitResult.code === 0) {
                  await log(formatAligned('📦', 'Committed:', 'CLAUDE.md deletion'));
                  
                  // Push the deletion
                  const pushDeleteResult = await $`cd ${tempDir} && git push origin ${branchName} 2>&1`;
                  if (pushDeleteResult.code === 0) {
                    await log(formatAligned('📤', 'Pushed:', 'CLAUDE.md removal to GitHub'));
                  } else {
                    await log(`   Warning: Could not push CLAUDE.md deletion`, { verbose: true });
                  }
                } else {
                  await log(`   Warning: Could not commit CLAUDE.md deletion`, { verbose: true });
                }
              } catch (e) {
                // File might not exist, that's fine
                await log(`   CLAUDE.md already removed or not found`, { verbose: true });
              }
            } else {
              await log(`⚠️ Draft pull request created but URL could not be determined`, { level: 'warning' });
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
                await log(``);
                await log(formatAligned('❌', 'PR CREATION FAILED', ''), { level: 'error' });
                await log(``);
                await log(`  🔍 What happened:`);
                await log(`     Failed to create pull request after pushing branch.`);
                await log(``);
                await log(`  📦 Error details:`);
                for (const line of cleanError.split('\n')) {
                  if (line.trim()) await log(`     ${line.trim()}`);
                }
                await log(``);
                await log(`  🔧 How to fix:`);
                await log(`     1. Check GitHub to see if PR was partially created`);
                await log(`     2. Try creating PR manually: gh pr create`);
                await log(`     3. Verify branch was pushed: git push -u origin ${branchName}`);
                await log(``);
                process.exit(1);
              }
            } else if (errorMsg.includes('No commits between') || errorMsg.includes('Head sha can\'t be blank')) {
              // Empty PR error
              await log(``);
              await log(formatAligned('❌', 'PR CREATION FAILED', ''), { level: 'error' });
              await log(``);
              await log(`  🔍 What happened:`);
              await log(`     Cannot create PR - no commits between branches.`);
              await log(``);
              await log(`  📦 Error details:`);
              for (const line of cleanError.split('\n')) {
                if (line.trim()) await log(`     ${line.trim()}`);
              }
              await log(``);
              await log(`  💡 Possible causes:`);
              await log(`     • The branch wasn't pushed properly`);
              await log(`     • The commit wasn't created`);
              await log(`     • GitHub sync issue`);
              await log(``);
              await log(`  🔧 How to fix:`);
              await log(`     1. Verify commit exists:`);
              await log(`        cd ${tempDir} && git log --oneline -5`);
              await log(`     2. Push again with tracking:`);
              await log(`        cd ${tempDir} && git push -u origin ${branchName}`);
              await log(`     3. Create PR manually:`);
              await log(`        cd ${tempDir} && gh pr create --draft`);
              await log(``);
              await log(`  📂 Working directory: ${tempDir}`);
              await log(`  🌿 Current branch: ${branchName}`);
              await log(``);
              process.exit(1);
            } else {
              // Generic PR creation error
              await log(``);
              await log(formatAligned('❌', 'PR CREATION FAILED', ''), { level: 'error' });
              await log(``);
              await log(`  🔍 What happened:`);
              await log(`     Failed to create pull request.`);
              await log(``);
              await log(`  📦 Error details:`);
              for (const line of cleanError.split('\n')) {
                if (line.trim()) await log(`     ${line.trim()}`);
              }
              await log(``);
              await log(`  🔧 How to fix:`);
              await log(`     1. Try creating PR manually:`);
              await log(`        cd ${tempDir} && gh pr create --draft`);
              await log(`     2. Check branch status:`);
              await log(`        cd ${tempDir} && git status`);
              await log(`     3. Verify GitHub authentication:`);
              await log(`        gh auth status`);
              await log(``);
              process.exit(1);
            }
          }
        }
      }
    } catch (prError) {
      await log(`Warning: Error during auto PR creation: ${prError.message}`, { level: 'warning' });
      await log(`   Continuing without PR...`);
    }
  } else {
    await log(`\n${formatAligned('⏭️', 'Auto PR creation:', 'DISABLED')}`);
    await log(formatAligned('', 'Workflow:', 'AI will create the PR', 2));
  }

  // Update prompt with PR URL if it was created
  if (prUrl) {
    prompt = `Issue to solve: ${issueUrl}
Your prepared branch: ${branchName}
Your prepared working directory: ${tempDir}
Your prepared Pull Request: ${prUrl}${argv.fork && forkedRepo ? `
Your forked repository: ${forkedRepo}
Original repository (upstream): ${owner}/${repo}` : ''}

Proceed.`;
  }

  const systemPrompt = `You are AI issue solver.

General guidelines.
   - When you execute commands, always save their logs to files for easy reading if the output gets large.
   - When running commands, do not set a timeout yourself — let them run as long as needed (default timeout - 2 minutes is more than enough, if you can set 4 minutes), and once they finish, review the logs in the file.
   - When CI is failing, make sure you download the logs locally and carefully investigate them.
   - When a code or log file has more than 2500 lines, read it in chunks of 2500 lines.
   - When facing a complex problem, do as much tracing as possible and turn on all verbose modes.
   - When you create debug, test, or example scripts for fixing, always keep them in an examples folder so you can reuse them later.
   - When testing your assumptions, use the example scripts.
   - When you face something extremely hard, use divide and conquer — it always helps.

Initial research.  
   - When you read issue, read all details and comments thoroughly.  
   - When you need issue details, use gh issue view ${issueUrl}.  
   - When you need related code, use gh search code --owner ${owner} [keywords].  
   - When you need repo context, read files in ${tempDir}.  
   - When you study related work, study related previous latest pull requests.  
   - When you need examples of style, use gh pr list --repo ${owner}/${repo} --state merged --search [keywords].  
   - When issue is not defined enough, write a comment to ask clarifying questions.  

Solution development and testing.  
   - When issue is solvable, implement code with tests.  
   - When you test, start from small functions.  
   - When you test, write unit tests with mocks.  
   - When you test integrations, use existing framework.  
   - When you test solution, include automated checks in pr.  
   - When issue is unclear, write comment on issue asking questions.  

Preparing pull request.  
   - When you finalize the pull request, follow style from merged prs for code, title, and description, and double-check the logic of all conditions and statements.  
   - When you code, follow contributing guidelines.  
   - When you commit, write clear message.  
   - When you open pr, describe solution and include tests.${prUrl ? `
   - When you update existing pr ${prNumber || prUrl}, use gh pr edit to modify title and description.
   - When you finish implementation, use gh pr ready ${prNumber || prUrl}.` : ''}  

Workflow and collaboration.  
   - When you check branch, verify with git branch --show-current.  
   - When you push, push only to branch ${branchName}.${argv.fork && forkedRepo ? `
   - When you push, remember you're pushing to fork ${forkedRepo}, not ${owner}/${repo}.` : ''}  
   - When you finish, create a pull request from branch ${branchName}.${prUrl ? ` (Note: PR ${prNumber || prUrl} already exists, update it instead)` : ''}${argv.fork && forkedRepo ? `
   - When you create pr, use --repo ${owner}/${repo} to create PR against original repo.` : ''}  
   - When you organize workflow, use pull requests instead of direct merges to main or master branches.  
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

  // Execute claude command from the cloned repository directory
  await log(`\n${formatAligned('🤖', 'Executing Claude:', argv.model.toUpperCase())}`);

  // Use command-stream's async iteration for real-time streaming with file logging
  let commandFailed = false;
  let sessionId = null;
  let limitReached = false;
  let messageCount = 0;
  let toolUseCount = 0;
  let lastMessage = '';

  // Build claude command with optional resume flag
  let claudeArgs = `--output-format stream-json --verbose --dangerously-skip-permissions --model ${argv.model}`;

  if (argv.resume) {
    await log(`🔄 Resuming from session: ${argv.resume}`);
    claudeArgs = `--resume ${argv.resume} ${claudeArgs}`;
  }

  claudeArgs += ` -p "${escapedPrompt}" --append-system-prompt "${escapedSystemPrompt}"`;

  // Print the command being executed (with cd for reproducibility)
  const fullCommand = `(cd "${tempDir}" && ${claudePath} ${claudeArgs} | jq -c .)`;
  await log(`\n${formatAligned('📋', 'Command details:', '')}`);
  await log(formatAligned('📂', 'Working directory:', tempDir, 2));
  await log(formatAligned('🌿', 'Branch:', branchName, 2));
  await log(formatAligned('🤖', 'Model:', `Claude ${argv.model.toUpperCase()}`, 2));
  if (argv.fork && forkedRepo) {
    await log(formatAligned('🍴', 'Fork:', forkedRepo, 2));
    await log(formatAligned('🔗', 'Upstream:', `${owner}/${repo}`, 2));
  }
  await log(`\n${formatAligned('📋', 'Full command:', '')}`);
  await log(`   ${fullCommand}`);
  await log('');

  // If only preparing command or dry-run, exit here
  if (argv.onlyPrepareCommand || argv.dryRun) {
    await log(formatAligned('✅', 'Preparation:', 'Complete'));
    await log(formatAligned('📂', 'Repository at:', tempDir));
    await log(formatAligned('🌿', 'Branch ready:', branchName));
    if (argv.fork && forkedRepo) {
      await log(formatAligned('🍴', 'Using fork:', forkedRepo));
    }
    await log(`\n${formatAligned('💡', 'To execute:', '')}`);
    await log(`   (cd "${tempDir}" && ${claudePath} ${claudeArgs})`);
    process.exit(0);
  }

  // Change to the temporary directory and execute
  process.chdir(tempDir);

  // Build the actual command for execution
  let execCommand;
  if (argv.resume) {
    execCommand = $({ mirror: false })`${claudePath} --resume ${argv.resume} --output-format stream-json --verbose --dangerously-skip-permissions --model ${argv.model} -p "${escapedPrompt}" --append-system-prompt "${escapedSystemPrompt}"`;
  } else {
    execCommand = $({ stdin: prompt, mirror: false })`${claudePath} --output-format stream-json --verbose --dangerously-skip-permissions --append-system-prompt "${escapedSystemPrompt}" --model ${argv.model}`;
  }

  for await (const chunk of execCommand.stream()) {
    if (chunk.type === 'stdout') {
      const data = chunk.data.toString();
      let json;
      try {
        json = JSON.parse(data);
        await log(JSON.stringify(json, null, 2));
      } catch (error) {
        await log(data);
        continue;
      }

      // Extract session ID from any level of the JSON structure
      if (!sessionId) {
        // Debug: Log what we're checking
        if (argv.verbose && json.session_id) {
          await log(`   Found session_id in JSON: ${json.session_id}`, { verbose: true });
        }
        
        // Check multiple possible locations for session_id
        const possibleSessionId = json.session_id || 
                                 json.uuid || 
                                 (json.message && json.message.session_id) ||
                                 (json.metadata && json.metadata.session_id);
        
        if (possibleSessionId) {
          sessionId = possibleSessionId;
          await log(`🔧 Session ID: ${sessionId}`);
          
          // Try to rename log file to include session ID
          try {
            const sessionLogFile = path.join(scriptDir, `${sessionId}.log`);
            
            // Check if target file already exists
            try {
              await fs.access(sessionLogFile);
              await log(`📁 Session log already exists: ${sessionLogFile}`);
              // Don't rename if target exists
            } catch {
              // Target doesn't exist, safe to rename
              try {
                await fs.rename(logFile, sessionLogFile);
                logFile = sessionLogFile;
                await log(`📁 Log renamed to: ${logFile}`);
              } catch (renameErr) {
                // If rename fails (e.g., cross-device link), try copying
                if (argv.verbose) {
                  await log(`   Rename failed: ${renameErr.message}, trying copy...`, { verbose: true });
                }
                
                try {
                  // Read current log content
                  const oldLogFile = logFile;
                  const currentContent = await fs.readFile(oldLogFile, 'utf8');
                  // Write to new file
                  await fs.writeFile(sessionLogFile, currentContent);
                  // Update log file reference
                  logFile = sessionLogFile;
                  await log(`📁 Log copied to: ${logFile}`);
                  
                  // Try to delete old file (non-critical if it fails)
                  try {
                    await fs.unlink(oldLogFile);
                  } catch {
                    // Ignore deletion errors
                  }
                } catch (copyErr) {
                  await log(`⚠️  Could not copy log file: ${copyErr.message}`, { level: 'warning' });
                  await log(`📁 Keeping log file: ${logFile}`);
                }
              }
            }
          } catch (renameError) {
            // If rename fails, keep original filename
            await log(`⚠️  Could not rename log file: ${renameError.message}`, { level: 'warning' });
            await log(`📁 Keeping log file: ${logFile}`);
          }
          await log('');
        }
      }

      // Display user-friendly progress
      if (json.type === 'message' && json.message) {
        messageCount++;
        
        // Extract text content from message
        if (json.message.content && Array.isArray(json.message.content)) {
          for (const item of json.message.content) {
            if (item.type === 'text' && item.text) {
              lastMessage = item.text.substring(0, 100); // First 100 chars
              if (item.text.includes('limit reached')) {
                limitReached = true;
              }
            }
          }
        }
        
        // Show progress indicator (console only, not logged)
        process.stdout.write(`\r📝 Messages: ${messageCount} | 🔧 Tool uses: ${toolUseCount} | Last: ${lastMessage}...`);
      } else if (json.type === 'tool_use') {
        toolUseCount++;
        const toolName = json.tool_use?.name || 'unknown';
        // Log tool use
        await log(`[TOOL USE] ${toolName}`);
        // Show progress in console (without logging)
        process.stdout.write(`\r🔧 Using tool: ${toolName} (${toolUseCount} total)...                                   `);
      } else if (json.type === 'system' && json.subtype === 'init') {
        await log('🚀 Claude session started');
        await log(`📊 Model: Claude ${argv.model.toUpperCase()}`);
        await log('\n🔄 Processing...\n');
      }

    } else if (chunk.type === 'stderr') {
      const data = chunk.data.toString();
      // Only show actual errors, not verbose output
      if (data.includes('Error') || data.includes('error')) {
        await log(`\n⚠️  ${data}`, { level: 'error' });
      }
      // Log stderr
      await log(`STDERR: ${data}`);
    } else if (chunk.type === 'exit') {
      if (chunk.code !== 0) {
        commandFailed = true;
        await log(`\n\n❌ Claude command failed with exit code ${chunk.code}`, { level: 'error' });
      }
    }
  }

  // Clear the progress line
  process.stdout.write('\r' + ' '.repeat(100) + '\r');

  if (commandFailed) {
    await log('\n❌ Command execution failed. Check the log file for details.');
    await log(`📁 Log file: ${logFile}`);
    process.exit(1);
  }

  await log('\n\n✅ Claude command completed');
  await log(`📊 Total messages: ${messageCount}, Tool uses: ${toolUseCount}`);

  // Show summary of session and log file
  await log('\n=== Session Summary ===');

  if (sessionId) {
    await log(`✅ Session ID: ${sessionId}`);
    await log(`✅ Complete log file: ${logFile}`);

    if (limitReached) {
      await log(`\n⏰ LIMIT REACHED DETECTED!`);
      await log(`\n🔄 To resume when limit resets, use:\n`);
      await log(`./solve.mjs "${issueUrl}" --resume ${sessionId}`);
      await log(`\n   This will continue from where it left off with full context.\n`);
    } else {
      // Show command to resume session in interactive mode
      await log(`\n💡 To continue this session in Claude Code interactive mode:\n`);
      await log(`   (cd ${tempDir} && claude --resume ${sessionId})`);
      await log(``);
    }

    // Don't show log preview, it's too technical
  } else {
    await log(`❌ No session ID extracted`);
    await log(`📁 Log file available: ${logFile}`);
  }

  // Now search for newly created pull requests and comments
  await log('\n🔍 Searching for created pull requests or comments...');

  try {
    // Get the current user's GitHub username
    const userResult = await $`gh api user --jq .login`;
    
    if (userResult.code !== 0) {
      throw new Error(`Failed to get current user: ${userResult.stderr ? userResult.stderr.toString() : 'Unknown error'}`);
    }
    
    const currentUser = userResult.stdout.toString().trim();
    if (!currentUser) {
      throw new Error('Unable to determine current GitHub user');
    }

    // Search for pull requests created from our branch
    await log('\n🔍 Checking for pull requests from branch ' + branchName + '...');

    // First, get all PRs from our branch
    const allBranchPrsResult = await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --json number,url,createdAt,headRefName,title,state,updatedAt`;
    
    if (allBranchPrsResult.code !== 0) {
      await log('  ⚠️  Failed to check pull requests');
      // Continue with empty list
    }
    
    const allBranchPrs = allBranchPrsResult.stdout.toString().trim() ? JSON.parse(allBranchPrsResult.stdout.toString().trim()) : [];

    // Check if we have any PRs from our branch
    // If auto-PR was created, it should be the one we're working on
    if (allBranchPrs.length > 0) {
      const pr = allBranchPrs[0]; // Get the most recent PR from our branch
      
      // If we created a PR earlier in this session, it would be prNumber
      // Or if the PR was updated during the session (updatedAt > referenceTime)
      const isPrFromSession = (prNumber && pr.number.toString() === prNumber) || 
                              (prUrl && pr.url === prUrl) ||
                              new Date(pr.updatedAt) > referenceTime ||
                              new Date(pr.createdAt) > referenceTime;
      
      if (isPrFromSession) {
        await log(`  ✅ Found pull request #${pr.number}: "${pr.title}"`);
        await log(`\n🎉 SUCCESS: A solution has been prepared as a pull request`);
        await log(`📍 URL: ${pr.url}`);
        await log(`\n✨ Please review the pull request for the proposed solution.`);
        process.exit(0);
      } else {
        await log(`  ℹ️  Found pull request #${pr.number} but it appears to be from a different session`);
      }
    } else {
      await log(`  ℹ️  No pull requests found from branch ${branchName}`);
    }

    // If no PR found, search for recent comments on the issue
    await log('\n🔍 Checking for new comments on issue #' + issueNumber + '...');

    // Get all comments and filter them
    const allCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;
    
    if (allCommentsResult.code !== 0) {
      await log('  ⚠️  Failed to check comments');
      // Continue with empty list
    }
    
    const allComments = JSON.parse(allCommentsResult.stdout.toString().trim() || '[]');

    // Filter for new comments by current user
    const newCommentsByUser = allComments.filter(comment =>
      comment.user.login === currentUser && new Date(comment.created_at) > referenceTime
    );

    if (newCommentsByUser.length > 0) {
      const lastComment = newCommentsByUser[newCommentsByUser.length - 1];
      await log(`  ✅ Found new comment by ${currentUser}`);
      await log(`\n💬 SUCCESS: Comment posted on issue`);
      await log(`📍 URL: ${lastComment.html_url}`);
      await log(`\n✨ A clarifying comment has been added to the issue.`);
      process.exit(0);
    } else if (allComments.length > 0) {
      await log(`  ℹ️  Issue has ${allComments.length} existing comment(s)`);
    } else {
      await log(`  ℹ️  No comments found on issue`);
    }

    // If neither found, it might not have been necessary to create either
    await log('\n📋 No new pull request or comment was created.');
    await log('   The issue may have been resolved differently or required no action.');
    await log(`\n💡 Review the session log for details:`);
    await log(`   ${logFile}`);
    process.exit(0);

  } catch (searchError) {
    await log('\n⚠️  Could not verify results:', searchError.message);
    await log(`\n💡 Check the log file for details:`);
    await log(`   ${logFile}`);
    process.exit(0);
  }

} catch (error) {
  await log('Error executing command:', error.message);
  process.exit(1);
} finally {
  // Clean up temporary directory (but not when resuming or when limit reached)
  if (!argv.resume && !limitReached) {
    try {
      process.stdout.write('\n🧹 Cleaning up...');
      await fs.rm(tempDir, { recursive: true, force: true });
      await log(' ✅');
    } catch (cleanupError) {
      await log(' ⚠️  (failed)');
    }
  } else if (argv.resume) {
    await log(`\n📁 Keeping directory for resumed session: ${tempDir}`);
  } else if (limitReached) {
    await log(`\n📁 Keeping directory for future resume: ${tempDir}`);
  }
}