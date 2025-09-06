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
await log(`   (All output will be logged here)\n`);

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
  await log(`Creating temporary directory: ${tempDir}\n`);
}

try {
  // Clone the repository using gh tool with authentication (full clone for proper git history)
  await log(`Cloning repository ${owner}/${repo} using gh tool...\n`);
  const cloneResult = await $`gh repo clone ${owner}/${repo} ${tempDir}`;
  
  // Verify clone was successful
  if (cloneResult.code !== 0) {
    await log(`Error: Failed to clone repository`);
    await log(cloneResult.stderr ? cloneResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }

  await log(`✅ Repository cloned successfully to ${tempDir}\n`);

  // Set up git authentication using gh
  const authSetupResult = await $`cd ${tempDir} && gh auth setup-git 2>&1`;
  if (authSetupResult.code !== 0) {
    await log('Note: gh auth setup-git had issues, continuing anyway\n');
  }

  // Verify we're on the default branch and get its name
  const defaultBranchResult = await $`cd ${tempDir} && git branch --show-current`;
  
  if (defaultBranchResult.code !== 0) {
    await log(`Error: Failed to get current branch`);
    await log(defaultBranchResult.stderr ? defaultBranchResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }

  const defaultBranch = defaultBranchResult.stdout.toString().trim();
  if (!defaultBranch) {
    await log(`Error: Unable to detect default branch`);
    process.exit(1);
  }
  await log(`📌 Default branch detected: ${defaultBranch}\n`);

  // Ensure we're on a clean default branch
  const statusResult = await $`cd ${tempDir} && git status --porcelain`;

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
  await log(`🌿 Creating branch: ${branchName} from ${defaultBranch}`);
  const checkoutResult = await $`cd ${tempDir} && git checkout -b ${branchName}`;

  if (checkoutResult.code !== 0) {
    await log(`Error: Failed to create branch ${branchName}:`);
    await log(checkoutResult.stderr ? checkoutResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }
  
  await log(`✅ Successfully created branch: ${branchName}`);

  // Verify we're on the correct branch
  const currentBranchResult = await $`cd ${tempDir} && git branch --show-current`;
  
  if (currentBranchResult.code !== 0) {
    await log(`Error: Failed to verify current branch`);
    await log(currentBranchResult.stderr ? currentBranchResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }
  
  const currentBranch = currentBranchResult.stdout.toString().trim();
  if (currentBranch !== branchName) {
    await log('\n');
    await log(`Error: Failed to switch to branch ${branchName}, currently on ${currentBranch}\n`);
    process.exit(1);
  }
  await log(`✅ Successfully switched to branch: ${branchName}\n`);

  // Create initial commit and push branch if auto PR creation is enabled
  let prUrl = null;
  let prNumber = null;
  
  if (argv.autoPullRequestCreation) {
    await log(`\n🚀 Auto pull request creation enabled`);
    await log(`   Creating initial commit and draft pull request...\n`);
    
    try {
      // Create an initial empty commit
      await log(`📝 Creating initial commit...`);
      
      if (argv.verbose) {
        await log(`   Command: git commit --allow-empty -m "Initial commit for issue #${issueNumber}..."`, { verbose: true });
      }
      
      const commitResult = await $`cd ${tempDir} && git commit --allow-empty -m "Initial commit for issue #${issueNumber}

Preparing to work on: ${issueUrl}"`;
      
      if (commitResult.code !== 0) {
        await log(`❌ Failed to create initial commit`, { level: 'error' });
        await log(`   Error: ${commitResult.stderr ? commitResult.stderr.toString() : 'Unknown error'}`, { level: 'error' });
        await log(`   stdout: ${commitResult.stdout ? commitResult.stdout.toString() : 'none'}`, { verbose: true });
        process.exit(1);
      } else {
        await log(`✅ Initial commit created`);
        if (argv.verbose) {
          await log(`   Commit output: ${commitResult.stdout.toString().trim()}`, { verbose: true });
        }
        
        // Push the branch
        await log(`📤 Pushing branch to remote...`);
        
        if (argv.verbose) {
          await log(`   Command: git push -u origin ${branchName}`, { verbose: true });
        }
        
        const pushResult = await $`cd ${tempDir} && git push -u origin ${branchName}`;
        
        if (pushResult.code !== 0) {
          await log(`❌ Failed to push branch`, { level: 'error' });
          await log(`   Error: ${pushResult.stderr ? pushResult.stderr.toString() : 'Unknown error'}`, { level: 'error' });
          await log(`   stdout: ${pushResult.stdout ? pushResult.stdout.toString() : 'none'}`, { verbose: true });
          process.exit(1);
        } else {
          await log(`✅ Branch pushed to remote`);
          if (argv.verbose) {
            await log(`   Push output: ${pushResult.stdout.toString().trim()}`, { verbose: true });
          }
          
          // Get issue title for PR title
          await log(`📋 Getting issue title...`, { verbose: true });
          const issueTitleResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber} --jq .title`;
          let issueTitle = `Fix issue #${issueNumber}`;
          if (issueTitleResult.code === 0) {
            issueTitle = issueTitleResult.stdout.toString().trim();
            await log(`   Issue title: "${issueTitle}"`, { verbose: true });
          } else {
            await log(`   Warning: Could not get issue title, using default`, { verbose: true });
          }
          
          // Get current GitHub user to set as assignee
          await log(`👤 Getting current GitHub user...`, { verbose: true });
          const currentUserResult = await $`gh api user --jq .login`;
          let currentUser = null;
          if (currentUserResult.code === 0) {
            currentUser = currentUserResult.stdout.toString().trim();
            await log(`   Current user: ${currentUser}`, { verbose: true });
          } else {
            await log(`   Warning: Could not get current user for assignee`, { verbose: true });
          }
          
          // Create draft pull request
          await log(`🔀 Creating draft pull request...`);
          
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
            
            // Build command with optional assignee
            let command = `cd "${tempDir}" && gh pr create --draft --title "[WIP] ${issueTitle}" --body-file "${prBodyFile}" --base ${defaultBranch} --head ${branchName}`;
            if (currentUser) {
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
                await log(`✅ Draft pull request created: #${prNumber}`);
                await log(`📍 URL: ${prUrl}`);
                if (currentUser) {
                  await log(`👤 Assigned to: ${currentUser}`);
                }
                
                // Link the issue to the PR in GitHub's Development section using GraphQL API
                await log(`🔗 Linking issue #${issueNumber} to PR #${prNumber} in Development section...`);
                try {
                  // First, get the node IDs for both the issue and the PR
                  const issueNodeResult = await $`gh api graphql -f query='query { repository(owner: "${owner}", name: "${repo}") { issue(number: ${issueNumber}) { id } } }' --jq .data.repository.issue.id`;
                  
                  if (issueNodeResult.code !== 0) {
                    throw new Error(`Failed to get issue node ID: ${issueNodeResult.stderr}`);
                  }
                  
                  const issueNodeId = issueNodeResult.stdout.toString().trim();
                  
                  const prNodeResult = await $`gh api graphql -f query='query { repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${prNumber}) { id } } }' --jq .data.repository.pullRequest.id`;
                  
                  if (prNodeResult.code !== 0) {
                    throw new Error(`Failed to get PR node ID: ${prNodeResult.stderr}`);
                  }
                  
                  const prNodeId = prNodeResult.stdout.toString().trim();
                  
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
                      await log(`✅ Issue #${issueNumber} successfully linked to PR #${prNumber} in Development section`);
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
                await log(`✅ Draft pull request created`);
                await log(`📍 URL: ${prUrl}`);
              }
            } else {
              await log(`⚠️ Draft pull request created but URL could not be determined`, { level: 'warning' });
            }
          } catch (prCreateError) {
            await log(`❌ Failed to create pull request`, { level: 'error' });
            await log(`   Error: ${prCreateError.message}`, { level: 'error' });
            await log(`   Working directory: ${tempDir}`, { verbose: true });
            await log(`   Current branch: ${branchName}`, { verbose: true });
            process.exit(1);
          }
        }
      }
    } catch (prError) {
      await log(`Warning: Error during auto PR creation: ${prError.message}`, { level: 'warning' });
      await log(`   Continuing without PR...`);
    }
    
    await log(``);
  } else {
    await log(`\n⏭️  Auto pull request creation disabled`);
    await log(`   Using original workflow where AI creates the PR\n`);
  }

  const prompt = `Issue to solve: ${issueUrl}
Your prepared branch: ${branchName}
Your prepared working directory: ${tempDir}${prUrl ? `
Your prepared Pull Request: ${prUrl}` : ''}

Proceed.`;

  const systemPrompt = `You are AI issue solver.

0. General guidelines.
   - When you execute commands, always save their logs to files for easy reading if the output gets large.
   - When running commands, do not set a timeout yourself — let them run as long as needed (default timeout - 2 minutes is more than enough, if you can set 4 minutes), and once they finish, review the logs in the file.
   - When CI is failing, make sure you download the logs locally and carefully investigate them.
   - When a code or log file has more than 2500 lines, read it in chunks of 2500 lines.
   - When facing a complex problem, do as much tracing as possible and turn on all verbose modes.
   - When you create debug, test, or example scripts for fixing, always keep them in an examples folder so you can reuse them later.
   - When testing your assumptions, use the example scripts.
   - When you face something extremely hard, use divide and conquer — it always helps.

1. Initial research.  
   - When you read issue, read all details and comments thoroughly.  
   - When you need issue details, use gh issue view ${issueUrl}.  
   - When you need related code, use gh search code --owner ${owner} [keywords].  
   - When you need repo context, read files in ${tempDir}.  
   - When you study related work, study related previous latest pull requests.  
   - When you need examples of style, use gh pr list --repo ${owner}/${repo} --state merged --search [keywords].  
   - When issue is not defined enough, write a comment to ask clarifying questions.  

2. Solution development and testing.  
   - When issue is solvable, implement code with tests.  
   - When you test, start from small functions.  
   - When you test, write unit tests with mocks.  
   - When you test integrations, use existing framework.  
   - When you test solution, include automated checks in pr.  
   - When issue is unclear, write comment on issue asking questions.  

3. Preparing pull request.  
   - When you finalize the pull request, follow style from merged prs for code, title, and description, and double-check the logic of all conditions and statements.  
   - When you code, follow contributing guidelines.  
   - When you commit, write clear message.  
   - When you open pr, describe solution and include tests.${prUrl ? `
   - When you update existing pr ${prNumber || prUrl}, use gh pr edit to modify title and description.
   - When you finish implementation, use gh pr ready ${prNumber || prUrl}.` : ''}  

4. Workflow and collaboration.  
   - When you check branch, verify with git branch --show-current.  
   - When you push, push only to branch ${branchName}.  
   - When you finish, create a pull request from branch ${branchName}.${prUrl ? ` (Note: PR ${prNumber || prUrl} already exists, update it instead)` : ''}  
   - When you organize workflow, use pull requests instead of direct merges to main or master branches.  
   - When you manage commits, preserve commit history for later analysis.  
   - When you contribute, keep repository history forward-moving with regular commits, pushes, and reverts if needed.  
   - When you face conflict, ask for help.  
   - When you collaborate, respect branch protections by working only on ${branchName}.  
   - When you mention result, include pull request url or comment url.${prUrl ? `
   - When you need to create pr, remember pr ${prNumber || prUrl} already exists for this branch.` : ''}  

5. Self review.
   - When you check your solution, run all tests locally.  
   - When you compare with repo style, use gh pr diff [number].  
   - When you finalize, confirm code, tests, and description are consistent.`;

  // Properly escape prompts for shell usage - escape quotes and preserve newlines
  const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
  const escapedSystemPrompt = systemPrompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');

  // Get timestamps from GitHub servers before executing the command
  await log('📅 Getting reference timestamps from GitHub...');

  let referenceTime;
  try {
    // Get the issue's last update time
    const issueResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber} --jq .updated_at`;
    
    if (issueResult.code !== 0) {
      throw new Error(`Failed to get issue details: ${issueResult.stderr ? issueResult.stderr.toString() : 'Unknown error'}`);
    }
    
    const issueUpdatedAt = new Date(issueResult.stdout.toString().trim());
    await log(`  📝 Issue last updated: ${issueUpdatedAt.toISOString()}`);

    // Get the last comment's timestamp (if any)
    const commentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;
    
    if (commentsResult.code !== 0) {
      await log(`Warning: Failed to get comments: ${commentsResult.stderr ? commentsResult.stderr.toString() : 'Unknown error'}`, { level: 'warning' });
      // Continue anyway, comments are optional
    }
    
    const comments = JSON.parse(commentsResult.stdout.toString().trim() || '[]');
    const lastCommentTime = comments.length > 0 ? new Date(comments[comments.length - 1].created_at) : null;
    if (lastCommentTime) {
      await log(`  💬 Last comment time: ${lastCommentTime.toISOString()}`);
    } else {
      await log(`  💬 No comments found on issue`);
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
      await log(`  🔀 Most recent pull request in repo: ${lastPrTime.toISOString()}`);
    } else {
      await log(`  🔀 No pull requests found in repo`);
    }

    // Use the most recent timestamp as reference
    referenceTime = issueUpdatedAt;
    if (lastCommentTime && lastCommentTime > referenceTime) {
      referenceTime = lastCommentTime;
    }
    if (lastPrTime && lastPrTime > referenceTime) {
      referenceTime = lastPrTime;
    }

    await log(`✅ Using reference timestamp: ${referenceTime.toISOString()}`);
  } catch (timestampError) {
    await log('Warning: Could not get GitHub timestamps, using current time as reference', { level: 'warning' });
    await log(`  Error: ${timestampError.message}`);
    referenceTime = new Date();
    await log(`  Fallback timestamp: ${referenceTime.toISOString()}`);
  }

  // Execute claude command from the cloned repository directory
  await log(`\n🤖 Executing Claude (${argv.model.toUpperCase()}) from repository directory...`);

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
  await log(`📋 Command details:`);
  await log(`   📂 Working directory: ${tempDir}`);
  await log(`   🌿 Branch: ${branchName}`);
  await log(`   🤖 Model: Claude ${argv.model.toUpperCase()}`);
  await log(`\n📋 Full command:`);
  await log(`   ${fullCommand}`);
  await log('');

  // If only preparing command or dry-run, exit here
  if (argv.onlyPrepareCommand || argv.dryRun) {
    await log(`✅ Command preparation complete`);
    await log(`📂 Repository cloned to: ${tempDir}`);
    await log(`🌿 Branch created: ${branchName}`);
    await log(`\n💡 To execute manually:`);
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

      // Extract session ID on first message
      if (!sessionId && json.session_id) {
        sessionId = json.session_id;
        await log(`🔧 Session ID: ${sessionId}`);
        
        // Try to rename log file to include session ID
        try {
          const sessionLogFile = path.join(scriptDir, `${sessionId}.log`);
          await fs.rename(logFile, sessionLogFile);
          logFile = sessionLogFile;
          await log(`📁 Log renamed to: ${logFile}`);
        } catch (renameError) {
          // If rename fails, keep original filename
          await log(`📁 Keeping log file: ${logFile}`);
        }
        await log('');
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