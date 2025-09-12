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

// Helper function to mask GitHub tokens in text
const maskGitHubToken = (token) => {
  if (!token || token.length < 12) {
    return token; // Don't mask very short strings
  }
  
  const start = token.substring(0, 5);
  const end = token.substring(token.length - 5);
  const middle = '*'.repeat(Math.max(token.length - 10, 3));
  
  return start + middle + end;
};

// Helper function to get GitHub tokens from local config files
const getGitHubTokensFromFiles = async () => {
  const tokens = [];
  
  try {
    // Check ~/.config/gh/hosts.yml
    const hostsFile = path.join(os.homedir(), '.config/gh/hosts.yml');
    if (await fs.access(hostsFile).then(() => true).catch(() => false)) {
      const hostsContent = await fs.readFile(hostsFile, 'utf8');
      
      // Look for oauth_token and api_token patterns
      const oauthMatches = hostsContent.match(/oauth_token:\s*([^\s\n]+)/g);
      if (oauthMatches) {
        for (const match of oauthMatches) {
          const token = match.split(':')[1].trim();
          if (token && !tokens.includes(token)) {
            tokens.push(token);
          }
        }
      }
      
      const apiMatches = hostsContent.match(/api_token:\s*([^\s\n]+)/g);
      if (apiMatches) {
        for (const match of apiMatches) {
          const token = match.split(':')[1].trim();
          if (token && !tokens.includes(token)) {
            tokens.push(token);
          }
        }
      }
    }
  } catch (error) {
    // Silently ignore file access errors
  }
  
  return tokens;
};

// Helper function to get GitHub tokens from gh command output
const getGitHubTokensFromCommand = async () => {
  const tokens = [];
  
  try {
    // Run gh auth status to get token info
    const authResult = await $`gh auth status 2>&1`.catch(() => ({ stdout: '', stderr: '' }));
    const authOutput = authResult.stdout?.toString() + authResult.stderr?.toString() || '';
    
    // Look for token patterns in the output
    const tokenPatterns = [
      /(?:token|oauth|api)[:\s]*([a-zA-Z0-9_]{20,})/gi,
      /gh[pou]_[a-zA-Z0-9_]{20,}/gi
    ];
    
    for (const pattern of tokenPatterns) {
      const matches = authOutput.match(pattern);
      if (matches) {
        for (let match of matches) {
          // Clean up the match
          const token = match.replace(/^(?:token|oauth|api)[:\s]*/, '').trim();
          if (token && token.length >= 20 && !tokens.includes(token)) {
            tokens.push(token);
          }
        }
      }
    }
  } catch (error) {
    // Silently ignore command errors
  }
  
  return tokens;
};

// Helper function to sanitize log content by masking GitHub tokens
const sanitizeLogContent = async (logContent) => {
  let sanitized = logContent;
  
  try {
    // Get tokens from both sources
    const fileTokens = await getGitHubTokensFromFiles();
    const commandTokens = await getGitHubTokensFromCommand();
    const allTokens = [...new Set([...fileTokens, ...commandTokens])];
    
    // Mask each token found
    for (const token of allTokens) {
      if (token && token.length >= 12) {
        const maskedToken = maskGitHubToken(token);
        // Use global replace to mask all occurrences
        sanitized = sanitized.split(token).join(maskedToken);
      }
    }
    
    // Also look for and mask common GitHub token patterns directly in the log
    const tokenPatterns = [
      /gh[pou]_[a-zA-Z0-9_]{20,}/g,
      /(?:^|[\s:=])([a-f0-9]{40})(?=[\s\n]|$)/gm, // 40-char hex tokens (like personal access tokens)
      /(?:^|[\s:=])([a-zA-Z0-9_]{20,})(?=[\s\n]|$)/gm // General long tokens
    ];
    
    for (const pattern of tokenPatterns) {
      sanitized = sanitized.replace(pattern, (match, token) => {
        if (token && token.length >= 20) {
          return match.replace(token, maskGitHubToken(token));
        }
        return match;
      });
    }
    
    await log(`  🔒 Sanitized ${allTokens.length} detected GitHub tokens in log content`, { verbose: true });
    
  } catch (error) {
    await log(`  ⚠️  Warning: Could not fully sanitize log content: ${error.message}`, { verbose: true });
  }
  
  return sanitized;
};

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
  .option('attach-solution-logs', {
    type: 'boolean',
    description: 'Upload the solution log file to the Pull Request on completion (⚠️ WARNING: May expose sensitive data)',
    default: false,
    alias: 'attach-logs'
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
  .option('min-disk-space', {
    type: 'number',
    description: 'Minimum required disk space in MB (default: 500)',
    default: 500
  })
  .demandCommand(1, 'The GitHub issue URL is required')
  .help('h')
  .alias('h', 'help')
  .argv;

const issueUrl = argv._[0];

// Set global verbose mode for log function
global.verboseMode = argv.verbose;

// Show security warning for attach-solution-logs option
if (argv.attachSolutionLogs) {
  await log('');
  await log('⚠️  SECURITY WARNING: --attach-solution-logs is ENABLED', { level: 'warning' });
  await log('');
  await log('   This option will upload the complete solution log file to the Pull Request.');
  await log('   The log may contain sensitive information such as:');
  await log('   • API keys, tokens, or secrets');
  await log('   • File paths and directory structures');
  await log('   • Command outputs and error messages');
  await log('   • Internal system information');
  await log('');
  await log('   ⚠️  DO NOT use this option with public repositories or if the log');
  await log('       might contain sensitive data that should not be shared publicly.');
  await log('');
  await log('   Continuing in 5 seconds... (Press Ctrl+C to abort)');
  await log('');
  
  // Give user time to abort if they realize this might be dangerous
  for (let i = 5; i > 0; i--) {
    process.stdout.write(`\r   Countdown: ${i} seconds remaining...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  process.stdout.write('\r   Proceeding with log attachment enabled.                    \n');
  await log('');
}

// Create permanent log file immediately with timestamp
const scriptDir = path.dirname(process.argv[1]);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
logFile = path.join(scriptDir, `solve-${timestamp}.log`);

// Create the log file immediately
await fs.writeFile(logFile, `# Solve.mjs Log - ${new Date().toISOString()}\n\n`);
await log(`📁 Log file: ${logFile}`);
await log(`   (All output will be logged here)`);

// Check disk space before proceeding
const hasEnoughSpace = await checkDiskSpace(argv.minDiskSpace || 500);
if (!hasEnoughSpace) {
  process.exit(1);
}

// Validate Claude CLI connection before proceeding
const isClaudeConnected = await validateClaudeConnection();
if (!isClaudeConnected) {
  await log(`❌ Cannot proceed without Claude CLI connection`, { level: 'error' });
  process.exit(1);
}

// Helper function to format aligned console output
const formatAligned = (icon, label, value, indent = 0) => {
  const spaces = ' '.repeat(indent);
  const labelWidth = 25 - indent;
  const paddedLabel = label.padEnd(labelWidth, ' ');
  return `${spaces}${icon} ${paddedLabel} ${value || ''}`;
};

// Helper function to parse time string and calculate wait time
const parseResetTime = (timeStr) => {
  // Parse time format like "5:30am" or "11:45pm"
  const match = timeStr.match(/(\d{1,2}):(\d{2})([ap]m)/i);
  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}`);
  }
  
  const [, hourStr, minuteStr, ampm] = match;
  let hour = parseInt(hourStr);
  const minute = parseInt(minuteStr);
  
  // Convert to 24-hour format
  if (ampm.toLowerCase() === 'pm' && hour !== 12) {
    hour += 12;
  } else if (ampm.toLowerCase() === 'am' && hour === 12) {
    hour = 0;
  }
  
  return { hour, minute };
};

// Calculate milliseconds until the next occurrence of the specified time
const calculateWaitTime = (resetTime) => {
  const { hour, minute } = parseResetTime(resetTime);
  
  const now = new Date();
  const today = new Date(now);
  today.setHours(hour, minute, 0, 0);
  
  // If the time has already passed today, schedule for tomorrow
  if (today <= now) {
    today.setDate(today.getDate() + 1);
  }
  
  return today.getTime() - now.getTime();
};

// Auto-continue function that waits until limit resets
const autoContinueWhenLimitResets = async (issueUrl, sessionId, tempDir) => {
  try {
    const resetTime = global.limitResetTime;
    const waitMs = calculateWaitTime(resetTime);
    
    await log(`\n⏰ Waiting until ${resetTime} for limit to reset...`);
    await log(`   Wait time: ${Math.round(waitMs / (1000 * 60))} minutes`);
    await log(`   Current time: ${new Date().toLocaleTimeString()}`);
    
    // Show countdown every 30 minutes for long waits, every minute for short waits
    const countdownInterval = waitMs > 30 * 60 * 1000 ? 30 * 60 * 1000 : 60 * 1000;
    let remainingMs = waitMs;
    
    const countdownTimer = setInterval(async () => {
      remainingMs -= countdownInterval;
      if (remainingMs > 0) {
        const remainingMinutes = Math.round(remainingMs / (1000 * 60));
        await log(`⏳ ${remainingMinutes} minutes remaining until ${resetTime}`);
      }
    }, countdownInterval);
    
    // Wait until reset time
    await new Promise(resolve => setTimeout(resolve, waitMs));
    clearInterval(countdownTimer);
    
    await log(`\n✅ Limit reset time reached! Resuming session...`);
    await log(`   Current time: ${new Date().toLocaleTimeString()}`);
    
    // Recursively call the solve script with --resume
    // We need to reconstruct the command with appropriate flags
    const childProcess = await import('child_process');
    
    // Build the resume command
    const resumeArgs = [
      process.argv[1], // solve.mjs path
      issueUrl,
      '--resume', sessionId,
      '--auto-continue-limit' // Keep auto-continue-limit enabled
    ];
    
    // Preserve other flags from original invocation
    if (argv.model !== 'sonnet') resumeArgs.push('--model', argv.model);
    if (argv.verbose) resumeArgs.push('--verbose');
    if (argv.fork) resumeArgs.push('--fork');
    if (argv.attachSolutionLogs) resumeArgs.push('--attach-solution-logs');
    
    await log(`\n🔄 Executing: ${resumeArgs.join(' ')}`);
    
    // Execute the resume command
    const child = childProcess.spawn('node', resumeArgs, {
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    child.on('close', (code) => {
      process.exit(code);
    });
    
  } catch (error) {
    await log(`\n❌ Auto-continue failed: ${error.message}`, { level: 'error' });
    await log(`\n🔄 Manual resume command:`);
    await log(`./solve.mjs "${issueUrl}" --resume ${sessionId}`);
    process.exit(1);
  }
};

// Helper function to check if CLAUDE.md exists in a PR branch
const checkClaudeMdInBranch = async (owner, repo, branchName) => {
  try {
    // Use GitHub CLI to check if CLAUDE.md exists in the branch
    const result = await $`gh api repos/${owner}/${repo}/contents/CLAUDE.md?ref=${branchName}`;
    return result.code === 0;
  } catch (error) {
    // If file doesn't exist or there's an error, CLAUDE.md doesn't exist
    return false;
  }
};

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
// Validate GitHub issue or pull request URL format
const isIssueUrl = issueUrl.match(/^https:\/\/github\.com\/[^\/]+\/[^\/]+\/issues\/\d+$/);
const isPrUrl = issueUrl.match(/^https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+$/);

if (!isIssueUrl && !isPrUrl) {
  await log('Error: Please provide a valid GitHub issue or pull request URL', { level: 'error' });
  await log('  Examples:', { level: 'error' });
  await log('    https://github.com/owner/repo/issues/123 (issue)', { level: 'error' });
  await log('    https://github.com/owner/repo/pull/456 (pull request)', { level: 'error' });
  process.exit(1);
}

const claudePath = process.env.CLAUDE_PATH || 'claude';

// Extract repository and number from URL
const urlParts = issueUrl.split('/');
const owner = urlParts[3];
const repo = urlParts[4];
const urlNumber = urlParts[6]; // Could be issue or PR number

// Determine mode and get issue details
let issueNumber;
let prNumber;
let prBranch;
let mergeStateStatus;
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
            const claudeMdExists = await checkClaudeMdInBranch(owner, repo, pr.headRefName);
            
            if (!claudeMdExists) {
              await log(`✅ Auto-continue: Using PR #${pr.number} (CLAUDE.md missing - work completed, branch: ${pr.headRefName})`);
              
              // Switch to continue mode immediately (don't wait 24 hours if CLAUDE.md is missing)
              isContinueMode = true;
              prNumber = pr.number;
              prBranch = pr.headRefName;
              break;
            } else if (createdAt < twentyFourHoursAgo) {
              await log(`✅ Auto-continue: Using PR #${pr.number} (created ${ageHours}h ago, branch: ${pr.headRefName})`);
              
              // Switch to continue mode
              isContinueMode = true;
              prNumber = pr.number;
              prBranch = pr.headRefName;
              break;
            } else {
              await log(`  PR #${pr.number}: CLAUDE.md exists, age ${ageHours}h < 24h - skipping`);
            }
          }
        }
        
        if (!isContinueMode) {
          await log(`⏭️  No suitable PRs found (missing CLAUDE.md or older than 24h) - creating new PR as usual`);
        }
      } else {
        await log(`📝 No existing PRs found for issue #${issueNumber} - creating new PR`);
      }
    }
  } catch (prSearchError) {
    await log(`⚠️  Warning: Could not search for existing PRs: ${prSearchError.message}`, { level: 'warning' });
    await log(`   Continuing with normal flow...`);
  }
}

if (isPrUrl) {
  isContinueMode = true;
  prNumber = urlNumber;
  
  await log(`🔄 Continue mode: Working with PR #${prNumber}`);
  
  // Get PR details to find the linked issue and branch
  try {
    const prResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json headRefName,body,number,mergeStateStatus`;
    
    if (prResult.code !== 0) {
      await log('Error: Failed to get PR details', { level: 'error' });
      await log(`Error: ${prResult.stderr ? prResult.stderr.toString() : 'Unknown error'}`, { level: 'error' });
      process.exit(1);
    }
    
    const prData = JSON.parse(prResult.stdout.toString());
    prBranch = prData.headRefName;
    mergeStateStatus = prData.mergeStateStatus;
    
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
    await log(`Error: Failed to process PR: ${error.message}`, { level: 'error' });
    process.exit(1);
  }
} else {
  // Traditional issue mode
  issueNumber = urlNumber;
  await log(`📝 Issue mode: Working with issue #${issueNumber}`);
}

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
    await log(``);
    
    if (isContinueMode) {
      await log(`${formatAligned('❌', 'BRANCH CHECKOUT FAILED', '')}`, { level: 'error' });
      await log(``);
      await log(`  🔍 What happened:`);
      await log(`     Unable to checkout PR branch '${branchName}'.`);
      await log(``);
      await log(`  📦 Git output:`);
      for (const line of errorOutput.split('\n')) {
        await log(`     ${line}`);
      }
      await log(``);
      await log(`  💡 Possible causes:`);
      await log(`     • PR branch doesn't exist on remote`);
      await log(`     • Network connectivity issues`);
      await log(`     • Permission denied to fetch branches`);
      await log(``);
      await log(`  🔧 How to fix:`);
      await log(`     1. Verify PR branch exists: gh pr view ${prNumber} --repo ${owner}/${repo}`);
      await log(`     2. Check remote branches: cd ${tempDir} && git branch -r`);
      await log(`     3. Try fetching manually: cd ${tempDir} && git fetch origin`);
    } else {
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
    }
    
    await log(``);
    await log(`  📂 Working directory: ${tempDir}`);
    process.exit(1);
  }
  
  // CRITICAL: Verify the branch was checked out and we switched to it
  await log(`${formatAligned('🔍', 'Verifying:', isContinueMode ? 'Branch checkout...' : 'Branch creation...')}`);
  const verifyResult = await $({ cwd: tempDir })`git branch --show-current`;
  
  if (verifyResult.code !== 0 || !verifyResult.stdout) {
    await log(``);
    await log(`${formatAligned('❌', 'BRANCH VERIFICATION FAILED', '')}`, { level: 'error' });
    await log(``);
    await log(`  🔍 What happened:`);
    await log(`     Unable to verify branch after ${isContinueMode ? 'checkout' : 'creation'} attempt.`);
    await log(``);
    await log(`  🔧 Debug commands to try:`);
    await log(`     cd ${tempDir} && git branch -a`);
    await log(`     cd ${tempDir} && git status`);
    await log(``);
    process.exit(1);
  }
  
  const actualBranch = verifyResult.stdout.toString().trim();
  if (actualBranch !== branchName) {
    // Branch wasn't actually created/checked out or we didn't switch to it
    await log(``);
    await log(`${formatAligned('❌', isContinueMode ? 'BRANCH CHECKOUT FAILED' : 'BRANCH CREATION FAILED', '')}`, { level: 'error' });
    await log(``);
    await log(`  🔍 What happened:`);
    if (isContinueMode) {
      await log(`     Git checkout command didn't switch to the PR branch.`);
    } else {
      await log(`     Git checkout -b command didn't create or switch to the branch.`);
    }
    await log(``);
    await log(`  📊 Branch status:`);
    await log(`     Expected branch: ${branchName}`);
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
    
    if (isContinueMode) {
      await log(`  💡 This might mean:`);
      await log(`     • PR branch doesn't exist on remote`);
      await log(`     • Branch name mismatch`);
      await log(`     • Network/permission issues`);
      await log(``);
      await log(`  🔧 How to fix:`);
      await log(`     1. Check PR details: gh pr view ${prNumber} --repo ${owner}/${repo}`);
      await log(`     2. List remote branches: cd ${tempDir} && git branch -r`);
      await log(`     3. Try manual checkout: cd ${tempDir} && git checkout ${branchName}`);
    } else {
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
    }
    await log(``);
    await log(`  📂 Working directory: ${tempDir}`);
    await log(``);
    process.exit(1);
  }
  
  if (isContinueMode) {
    await log(`${formatAligned('✅', 'Branch checked out:', branchName)}`);
    await log(`${formatAligned('✅', 'Current branch:', actualBranch)}`);
  } else {
    await log(`${formatAligned('✅', 'Branch created:', branchName)}`);
    await log(`${formatAligned('✅', 'Current branch:', actualBranch)}`);
  }

  // Initialize PR variables and prompt early
  let prUrl = null;
  let prNumberForNewPR = null;
  
  // In continue mode, we already have the PR details
  if (isContinueMode) {
    prUrl = issueUrl; // The input URL is the PR URL
    // prNumber is already set from earlier when we parsed the PR
  }
  
  // Build the prompt (different for continue vs regular mode)
  let prompt;
  if (isContinueMode) {
    prompt = `Issue to solve: ${issueNumber ? `https://github.com/${owner}/${repo}/issues/${issueNumber}` : `Issue linked to PR #${prNumber}`}
Your prepared branch: ${branchName}
Your prepared working directory: ${tempDir}
Your prepared Pull Request: ${prUrl}
Existing pull request's merge state status: ${mergeStateStatus}${argv.fork && forkedRepo ? `
Your forked repository: ${forkedRepo}
Original repository (upstream): ${owner}/${repo}` : ''}

Continue.`;
  } else {
    prompt = `Issue to solve: ${issueUrl}
Your prepared branch: ${branchName}
Your prepared working directory: ${tempDir}${argv.fork && forkedRepo ? `
Your forked repository: ${forkedRepo}
Original repository (upstream): ${owner}/${repo}` : ''}

Proceed.`;
  }
  
  if (argv.autoPullRequestCreation && !isContinueMode) {
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
                      await log(``);
                      await log(formatAligned('⚠️', 'ISSUE LINK MISSING:', 'PR not linked to issue'), { level: 'warning' });
                      await log(``);
                      
                      if (argv.fork) {
                        await log(`   The PR was created from a fork but wasn't linked to the issue.`, { level: 'warning' });
                        await log(`   Expected: "Fixes ${owner}/${repo}#${issueNumber}" in PR body`, { level: 'warning' });
                        await log(``);
                        await log(`   To fix manually:`, { level: 'warning' });
                        await log(`   1. Edit the PR description at: ${prUrl}`, { level: 'warning' });
                        await log(`   2. Add this line: Fixes ${owner}/${repo}#${issueNumber}`, { level: 'warning' });
                      } else {
                        await log(`   The PR wasn't linked to issue #${issueNumber}`, { level: 'warning' });
                        await log(`   Expected: "Fixes #${issueNumber}" in PR body`, { level: 'warning' });
                        await log(``);
                        await log(`   To fix manually:`, { level: 'warning' });
                        await log(`   1. Edit the PR description at: ${prUrl}`, { level: 'warning' });
                        await log(`   2. Ensure it contains: Fixes #${issueNumber}`, { level: 'warning' });
                      }
                      await log(``);
                    }
                  } else {
                    // Could not verify but show what should have been used
                    const expectedRef = argv.fork ? `${owner}/${repo}#${issueNumber}` : `#${issueNumber}`;
                    await log(`⚠️ Could not verify issue link (API error)`, { level: 'warning' });
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
  } else if (isContinueMode) {
    await log(`\n${formatAligned('🔄', 'Continue mode:', 'ACTIVE')}`);
    await log(formatAligned('', 'Using existing PR:', `#${prNumber}`, 2));
    await log(formatAligned('', 'PR URL:', prUrl, 2));
  } else {
    await log(`\n${formatAligned('⏭️', 'Auto PR creation:', 'DISABLED')}`);
    await log(formatAligned('', 'Workflow:', 'AI will create the PR', 2));
  }

  // Update prompt with PR URL if it was created (but not for continue mode since we already set it)
  if (prUrl && !isContinueMode) {
    prompt = `Issue to solve: ${issueUrl}
Your prepared branch: ${branchName}
Your prepared working directory: ${tempDir}
Your prepared Pull Request: ${prUrl}${argv.fork && forkedRepo ? `
Your forked repository: ${forkedRepo}
Original repository (upstream): ${owner}/${repo}` : ''}

Proceed.`;
  }

  // Count new comments on PR and issue after last commit
  let newPrComments = 0;
  let newIssueComments = 0;
  let commentInfo = '';

  if (prNumber && branchName) {
    try {
      await log(`${formatAligned('💬', 'Counting comments:', 'Checking for new comments since last commit...')}`);
      
      // Get the last commit timestamp from the PR branch
      let lastCommitResult = await $`git log -1 --format="%aI" origin/${branchName}`;
      if (lastCommitResult.code !== 0) {
        // Fallback to local branch if remote doesn't exist
        lastCommitResult = await $`git log -1 --format="%aI" ${branchName}`;
      }
      if (lastCommitResult.code === 0) {
        const lastCommitTime = new Date(lastCommitResult.stdout.toString().trim());
        await log(formatAligned('📅', 'Last commit time:', lastCommitTime.toISOString(), 2));

        // Count new PR comments after last commit (both code review comments and conversation comments)
        let prReviewComments = [];
        let prConversationComments = [];
        
        // Get PR code review comments
        const prReviewCommentsResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments`;
        if (prReviewCommentsResult.code === 0) {
          prReviewComments = JSON.parse(prReviewCommentsResult.stdout.toString());
        }
        
        // Get PR conversation comments (PR is also an issue)
        const prConversationCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments`;
        if (prConversationCommentsResult.code === 0) {
          prConversationComments = JSON.parse(prConversationCommentsResult.stdout.toString());
        }
        
        // Combine and count all PR comments after last commit
        const allPrComments = [...prReviewComments, ...prConversationComments];
        newPrComments = allPrComments.filter(comment => 
          new Date(comment.created_at) > lastCommitTime
        ).length;

        // Count new issue comments after last commit
        const issueCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;
        if (issueCommentsResult.code === 0) {
          const issueComments = JSON.parse(issueCommentsResult.stdout.toString());
          newIssueComments = issueComments.filter(comment => 
            new Date(comment.created_at) > lastCommitTime
          ).length;
        }

        await log(formatAligned('💬', 'New PR comments:', newPrComments.toString(), 2));
        await log(formatAligned('💬', 'New issue comments:', newIssueComments.toString(), 2));

        // Build comment info for system prompt
        const commentLines = [];
        if (newPrComments > 0) {
          commentLines.push(`New comments on the pull request: ${newPrComments}`);
        }
        if (newIssueComments > 0) {
          commentLines.push(`New comments on the issue: ${newIssueComments}`);
        }
        
        if (commentLines.length > 0) {
          commentInfo = '\n\n' + commentLines.join('\n') + '\n';
        }
      }
    } catch (error) {
      await log(`Warning: Could not count new comments: ${error.message}`, { level: 'warning' });
    }
  }

  const systemPrompt = `You are AI issue solver.${commentInfo}

General guidelines.
   - When you execute commands, always save their logs to files for easy reading if the output gets large.
   - When running commands, do not set a timeout yourself — let them run as long as needed (default timeout - 2 minutes is more than enough, if you can set 4 minutes), and once they finish, review the logs in the file.
   - When CI is failing, make sure you download the logs locally and carefully investigate them.
   - When a code or log file has more than 2500 lines, read it in chunks of 2500 lines.
   - When facing a complex problem, do as much tracing as possible and turn on all verbose modes.
   - When you create debug, test, or example scripts for fixing, always keep them in an examples folder so you can reuse them later.
   - When testing your assumptions, use the example scripts.
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
   - When you need examples of style, use gh pr list --repo ${owner}/${repo} --state merged --search [keywords].  
   - When issue is not defined enough, write a comment to ask clarifying questions.
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
              
              // Enhanced limit detection with auto-continue support
              const text = item.text;
              if (text.includes('limit reached')) {
                limitReached = true;
                
                // Look for the specific pattern with reset time (improved to catch more variations)
                const resetPattern = /(\d+)[-\s]hour\s+limit\s+reached.*?resets?\s*(?:at\s+)?(\d{1,2}:\d{2}[ap]m)/i;
                const match = text.match(resetPattern);
                
                if (match) {
                  const [, hours, resetTime] = match;
                  // Store the reset time for auto-continue functionality
                  global.limitResetTime = resetTime;
                  global.limitHours = hours;
                  await log(`\n🔍 Detected ${hours}-hour limit reached, resets at ${resetTime}`, { verbose: true });
                } else {
                  // Fallback for generic limit messages
                  await log(`\n🔍 Generic limit reached detected`, { verbose: true });
                }
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
      
      // Check for critical errors that should cause failure
      const criticalErrorPatterns = [
        'ENOSPC: no space left on device',
        'npm error code ENOSPC',
        'Command failed:',
        'Error:',
        'error code',
        'errno -28'
      ];
      
      const isCriticalError = criticalErrorPatterns.some(pattern => 
        data.toLowerCase().includes(pattern.toLowerCase())
      );
      
      if (isCriticalError) {
        commandFailed = true;
        await log(`\n❌ Critical error detected in stderr: ${data}`, { level: 'error' });
      }
      
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
  
  // Check for and commit any uncommitted changes made by Claude
  await log('\n🔍 Checking for uncommitted changes...');
  try {
    // Check git status to see if there are any uncommitted changes
    const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
    
    if (gitStatusResult.code === 0) {
      const statusOutput = gitStatusResult.stdout.toString().trim();
      
      if (statusOutput) {
        // There are uncommitted changes - log them and commit automatically
        await log(formatAligned('📝', 'Found changes:', 'Uncommitted files detected'));
        
        // Show what files have changes
        const changedFiles = statusOutput.split('\n').map(line => line.trim()).filter(line => line);
        for (const file of changedFiles) {
          await log(formatAligned('', '', `  ${file}`, 2));
        }
        
        // Stage all changes
        const gitAddResult = await $({ cwd: tempDir })`git add . 2>&1`;
        if (gitAddResult.code === 0) {
          await log(formatAligned('📦', 'Staged:', 'All changes added to git'));
          
          // Commit with a descriptive message
          const commitMessage = `Auto-commit changes made by Claude

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>`;
          
          const gitCommitResult = await $({ cwd: tempDir })`git commit -m "${commitMessage}" 2>&1`;
          if (gitCommitResult.code === 0) {
            await log(formatAligned('✅', 'Committed:', 'Changes automatically committed'));
            
            // Push the changes to remote
            const gitPushResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
            if (gitPushResult.code === 0) {
              await log(formatAligned('📤', 'Pushed:', 'Changes synced to GitHub'));
            } else {
              await log(`⚠️ Warning: Could not push auto-committed changes: ${gitPushResult.stderr.toString().trim()}`, { level: 'warning' });
            }
          } else {
            await log(`⚠️ Warning: Could not commit changes: ${gitCommitResult.stderr.toString().trim()}`, { level: 'warning' });
          }
        } else {
          await log(`⚠️ Warning: Could not stage changes: ${gitAddResult.stderr.toString().trim()}`, { level: 'warning' });
        }
      } else {
        await log(formatAligned('✅', 'No changes:', 'Repository is clean'));
      }
    } else {
      await log(`⚠️ Warning: Could not check git status: ${gitStatusResult.stderr.toString().trim()}`, { level: 'warning' });
    }
  } catch (gitError) {
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
  }
  
  // Remove CLAUDE.md now that Claude command has finished
  // We need to commit and push the deletion so it's reflected in the PR
  try {
    await fs.unlink(path.join(tempDir, 'CLAUDE.md'));
    await log(formatAligned('🗑️', 'Cleanup:', 'Removing CLAUDE.md'));
    
    // Commit the deletion
    const deleteCommitResult = await $({ cwd: tempDir })`git add CLAUDE.md && git commit -m "Remove CLAUDE.md - Claude command completed" 2>&1`;
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

  // Show summary of session and log file
  await log('\n=== Session Summary ===');

  if (sessionId) {
    await log(`✅ Session ID: ${sessionId}`);
    await log(`✅ Complete log file: ${logFile}`);

    if (limitReached) {
      await log(`\n⏰ LIMIT REACHED DETECTED!`);
      
      if (argv.autoContinueLimit && global.limitResetTime) {
        await log(`\n🔄 AUTO-CONTINUE ENABLED - Will resume at ${global.limitResetTime}`);
        await autoContinueWhenLimitResets(issueUrl, sessionId, tempDir);
      } else {
        await log(`\n🔄 To resume when limit resets, use:\n`);
        await log(`./solve.mjs "${issueUrl}" --resume ${sessionId}`);
        
        if (global.limitResetTime) {
          await log(`\n💡 Or enable auto-continue-limit to wait until ${global.limitResetTime}:\n`);
          await log(`./solve.mjs "${issueUrl}" --resume ${sessionId} --auto-continue-limit`);
        }
        
        await log(`\n   This will continue from where it left off with full context.\n`);
      }
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
    const allBranchPrsResult = await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --json number,url,createdAt,headRefName,title,state,updatedAt,isDraft`;
    
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
        
        // Check if PR body has proper issue linking keywords
        const prBodyResult = await $`gh pr view ${pr.number} --repo ${owner}/${repo} --json body --jq .body`;
        if (prBodyResult.code === 0) {
          const prBody = prBodyResult.stdout.toString();
          const issueRef = argv.fork ? `${owner}/${repo}#${issueNumber}` : `#${issueNumber}`;
          
          // Check if any linking keywords exist (case-insensitive)
          const linkingKeywords = ['fixes', 'closes', 'resolves', 'fix', 'close', 'resolve'];
          const hasLinkingKeyword = linkingKeywords.some(keyword => {
            const regex = new RegExp(`\\b${keyword}\\s+${issueRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            return regex.test(prBody);
          });
          
          if (!hasLinkingKeyword) {
            // No linking keyword found, update PR to add it
            await log(`  ⚠️  PR doesn't have issue linking keyword, adding it...`);
            
            // Append "Resolves #issueNumber" with separator
            const updatedBody = `${prBody}\n\n---\n\nResolves ${issueRef}`;
            
            // Write updated body to temp file
            const tempBodyFile = `/tmp/pr-body-fix-${Date.now()}.md`;
            await fs.writeFile(tempBodyFile, updatedBody);
            
            // Update the PR
            const updateResult = await $`gh pr edit ${pr.number} --repo ${owner}/${repo} --body-file "${tempBodyFile}"`;
            
            // Clean up temp file
            await fs.unlink(tempBodyFile).catch(() => {});
            
            if (updateResult.code === 0) {
              await log(`  ✅ Added issue linking to PR`);
            } else {
              await log(`  ⚠️  Could not update PR body to add issue link`);
            }
          } else {
            await log(`  ✅ PR already has proper issue linking`, { verbose: true });
          }
        }
        
        // Check if PR is in draft state and convert to ready if needed
        if (pr.isDraft) {
          await log(`  ⚠️  PR is in draft state, converting to ready for review...`);
          
          const readyResult = await $`gh pr ready ${pr.number} --repo ${owner}/${repo}`;
          
          if (readyResult.code === 0) {
            await log(`  ✅ PR converted to ready for review`);
          } else {
            await log(`  ⚠️  Could not convert PR to ready (${readyResult.stderr ? readyResult.stderr.toString().trim() : 'unknown error'})`);
          }
        } else {
          await log(`  ✅ PR is already ready for review`, { verbose: true });
        }
        
        // Upload log file to PR if requested
        if (argv.attachSolutionLogs) {
          await log(`\n📎 Uploading solution log to Pull Request...`);
          
          try {
            // Check if log file exists and is not empty
            const logStats = await fs.stat(logFile);
            if (logStats.size === 0) {
              await log(`  ⚠️  Log file is empty, skipping upload`);
            } else if (logStats.size > 25 * 1024 * 1024) { // 25MB GitHub limit
              await log(`  ⚠️  Log file too large (${Math.round(logStats.size / 1024 / 1024)}MB), GitHub limit is 25MB`);
            } else {
              // Read log file content
              const rawLogContent = await fs.readFile(logFile, 'utf8');
              
              // Sanitize log content to mask GitHub tokens
              await log(`  🔍 Sanitizing log content to mask GitHub tokens...`, { verbose: true });
              const logContent = await sanitizeLogContent(rawLogContent);
              
              // Create a formatted comment with the log file content
              const logComment = `## 🤖 Solution Log

This log file contains the complete execution trace of the AI solution process.

<details>
<summary>Click to expand solution log (${Math.round(logStats.size / 1024)}KB)</summary>

\`\`\`
${logContent}
\`\`\`

</details>

---
*Log automatically attached by solve.mjs with --attach-solution-logs option*`;

              // Write comment to temp file
              const tempLogCommentFile = `/tmp/log-comment-${Date.now()}.md`;
              await fs.writeFile(tempLogCommentFile, logComment);
              
              // Add comment to the PR
              const commentResult = await $`gh pr comment ${pr.number} --repo ${owner}/${repo} --body-file "${tempLogCommentFile}"`;
              
              // Clean up temp file
              await fs.unlink(tempLogCommentFile).catch(() => {});
              
              if (commentResult.code === 0) {
                await log(`  ✅ Solution log uploaded to PR as comment`);
                await log(`  📊 Log size: ${Math.round(logStats.size / 1024)}KB`);
              } else {
                await log(`  ❌ Failed to upload log to PR: ${commentResult.stderr ? commentResult.stderr.toString().trim() : 'unknown error'}`);
              }
            }
          } catch (uploadError) {
            await log(`  ❌ Error uploading log file: ${uploadError.message}`);
          }
        }
        
        await log(`\n🎉 SUCCESS: A solution has been prepared as a pull request`);
        await log(`📍 URL: ${pr.url}`);
        if (argv.attachSolutionLogs) {
          await log(`📎 Solution log has been attached to the Pull Request`);
        }
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
      
      // Upload log file to issue if requested
      if (argv.attachSolutionLogs) {
        await log(`\n📎 Uploading solution log to issue...`);
        
        try {
          // Check if log file exists and is not empty
          const logStats = await fs.stat(logFile);
          if (logStats.size === 0) {
            await log(`  ⚠️  Log file is empty, skipping upload`);
          } else if (logStats.size > 25 * 1024 * 1024) { // 25MB GitHub limit
            await log(`  ⚠️  Log file too large (${Math.round(logStats.size / 1024 / 1024)}MB), GitHub limit is 25MB`);
          } else {
            // Read log file content
            const rawLogContent = await fs.readFile(logFile, 'utf8');
            
            // Sanitize log content to mask GitHub tokens
            await log(`  🔍 Sanitizing log content to mask GitHub tokens...`, { verbose: true });
            const logContent = await sanitizeLogContent(rawLogContent);
            
            // Create a formatted comment with the log file content
            const logComment = `## 🤖 Solution Log

This log file contains the complete execution trace of the AI analysis process.

<details>
<summary>Click to expand solution log (${Math.round(logStats.size / 1024)}KB)</summary>

\`\`\`
${logContent}
\`\`\`

</details>

---
*Log automatically attached by solve.mjs with --attach-solution-logs option*`;

            // Write comment to temp file
            const tempLogCommentFile = `/tmp/log-comment-issue-${Date.now()}.md`;
            await fs.writeFile(tempLogCommentFile, logComment);
            
            // Add comment to the issue
            const commentResult = await $`gh issue comment ${issueNumber} --repo ${owner}/${repo} --body-file "${tempLogCommentFile}"`;
            
            // Clean up temp file
            await fs.unlink(tempLogCommentFile).catch(() => {});
            
            if (commentResult.code === 0) {
              await log(`  ✅ Solution log uploaded to issue as comment`);
              await log(`  📊 Log size: ${Math.round(logStats.size / 1024)}KB`);
            } else {
              await log(`  ❌ Failed to upload log to issue: ${commentResult.stderr ? commentResult.stderr.toString().trim() : 'unknown error'}`);
            }
          }
        } catch (uploadError) {
          await log(`  ❌ Error uploading log file: ${uploadError.message}`);
        }
      }
      
      await log(`\n💬 SUCCESS: Comment posted on issue`);
      await log(`📍 URL: ${lastComment.html_url}`);
      if (argv.attachSolutionLogs) {
        await log(`📎 Solution log has been attached to the issue`);
      }
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
  // Clean up temporary directory (but not when resuming, when limit reached, or when auto-continue is active)
  if (!argv.resume && !limitReached && !(argv.autoContinueLimit && global.limitResetTime)) {
    try {
      process.stdout.write('\n🧹 Cleaning up...');
      await fs.rm(tempDir, { recursive: true, force: true });
      await log(' ✅');
    } catch (cleanupError) {
      await log(' ⚠️  (failed)');
    }
  } else if (argv.resume) {
    await log(`\n📁 Keeping directory for resumed session: ${tempDir}`);
  } else if (limitReached && argv.autoContinueLimit) {
    await log(`\n📁 Keeping directory for auto-continue: ${tempDir}`);
  } else if (limitReached) {
    await log(`\n📁 Keeping directory for future resume: ${tempDir}`);
  }
}