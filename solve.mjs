#!/usr/bin/env node

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const yargs = (await use('yargs@latest')).default;
const os = (await import('os')).default;
const path = (await import('path')).default;
const fs = (await import('fs')).promises;
const crypto = (await import('crypto')).default;

// Global log file reference
let permanentLogFile = null;

// Helper function to log to both console and file
const log = async (message, options = {}) => {
  const { level = 'info' } = options;
  
  // Write to file if log file is set
  if (permanentLogFile) {
    const logMessage = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
    await fs.appendFile(permanentLogFile, logMessage + '\n').catch(() => {});
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
  .demandCommand(1, 'The GitHub issue URL is required')
  .help('h')
  .alias('h', 'help')
  .argv;

const issueUrl = argv._[0];

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
      const commitResult = await $`cd ${tempDir} && git commit --allow-empty -m "Initial commit for issue #${issueNumber}

Preparing to work on: ${issueUrl}"`;
      
      if (commitResult.code !== 0) {
        await log(`Warning: Failed to create initial commit: ${commitResult.stderr ? commitResult.stderr.toString() : 'Unknown error'}`, { level: 'warning' });
        await log(`   Continuing without auto PR creation...`);
      } else {
        await log(`✅ Initial commit created`);
        
        // Push the branch
        await log(`📤 Pushing branch to remote...`);
        const pushResult = await $`cd ${tempDir} && git push -u origin ${branchName}`;
        
        if (pushResult.code !== 0) {
          await log(`Warning: Failed to push branch: ${pushResult.stderr ? pushResult.stderr.toString() : 'Unknown error'}`, { level: 'warning' });
          await log(`   Continuing without auto PR creation...`);
        } else {
          await log(`✅ Branch pushed to remote`);
          
          // Get issue title for PR title
          const issueTitleResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber} --jq .title`;
          let issueTitle = `Fix issue #${issueNumber}`;
          if (issueTitleResult.code === 0) {
            issueTitle = issueTitleResult.stdout.toString().trim();
          }
          
          // Create draft pull request
          await log(`🔀 Creating draft pull request...`);
          const prCreateResult = await $`cd ${tempDir} && gh pr create --draft --title "[WIP] ${issueTitle}" --body "## 🤖 AI-Powered Solution\n\nThis pull request is being automatically generated to solve issue #${issueNumber}.\n\n### 📋 Issue Reference\nFixes #${issueNumber}\n\n### 🚧 Status\n**Work in Progress** - The AI assistant is currently analyzing and implementing the solution.\n\n### 📝 Implementation Details\n_Details will be added as the solution is developed..._\n\n---\n*This PR was created automatically by the AI issue solver*" --base ${defaultBranch} --head ${branchName}`;
          
          if (prCreateResult.code !== 0) {
            await log(`Warning: Failed to create pull request: ${prCreateResult.stderr ? prCreateResult.stderr.toString() : 'Unknown error'}`, { level: 'warning' });
            await log(`   Continuing without PR...`);
          } else {
            // Extract PR URL from output
            prUrl = prCreateResult.stdout.toString().trim();
            
            // Extract PR number from URL
            const prMatch = prUrl.match(/\/pull\/(\d+)/);
            if (prMatch) {
              prNumber = prMatch[1];
              await log(`✅ Draft pull request created: #${prNumber}`);
              await log(`📍 URL: ${prUrl}`);
            } else {
              await log(`✅ Draft pull request created`);
              await log(`📍 URL: ${prUrl}`);
            }
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

  // Create permanent log file immediately with timestamp
  const scriptDir = path.dirname(process.argv[1]);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  permanentLogFile = path.join(scriptDir, `solve-${timestamp}.log`);

  // Create the log file immediately
  await fs.writeFile(permanentLogFile, `# Solve.mjs Log - ${new Date().toISOString()}\n\n`);


  await log(`📁 Log file: ${permanentLogFile}`);
  await log(`   (Real-time output will be logged here)\n`);

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

  // If only preparing command, exit here
  if (argv.onlyPrepareCommand) {
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
          await fs.rename(permanentLogFile, sessionLogFile);
          permanentLogFile = sessionLogFile;
          await log(`📁 Log renamed to: ${permanentLogFile}`);
        } catch (renameError) {
          // If rename fails, keep original filename
          await log(`📁 Keeping log file: ${permanentLogFile}`);
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
    await log(`📁 Log file: ${permanentLogFile}`);
    process.exit(1);
  }

  await log('\n\n✅ Claude command completed');
  await log(`📊 Total messages: ${messageCount}, Tool uses: ${toolUseCount}`);

  // Show summary of session and log file
  await log('\n=== Session Summary ===');

  if (sessionId) {
    await log(`✅ Session ID: ${sessionId}`);
    await log(`✅ Complete log file: ${permanentLogFile}`);

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
    await log(`📁 Log file available: ${permanentLogFile}`);
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

    // Search for pull requests created from our branch after the reference time
    await log('\n🔍 Checking for pull requests from branch ' + branchName + '...');

    // First, get all PRs from our branch
    const allBranchPrsResult = await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --json number,url,createdAt,headRefName,title,state`;
    
    if (allBranchPrsResult.code !== 0) {
      await log('  ⚠️  Failed to check pull requests');
      // Continue with empty list
    }
    
    const allBranchPrs = allBranchPrsResult.stdout.toString().trim() ? JSON.parse(allBranchPrsResult.stdout.toString().trim()) : [];

    // Now filter for new ones
    const newPrs = allBranchPrs.filter(pr => new Date(pr.createdAt) > referenceTime);

    if (newPrs.length > 0) {
      const pr = newPrs[0];
      await log(`  ✅ Found pull request #${pr.number}: "${pr.title}"`);
      await log(`\n🎉 SUCCESS: A solution draft has been created as a pull request`);
      await log(`📍 URL: ${pr.url}`);
      await log(`\n✨ Please review the pull request for the proposed solution.`);
      process.exit(0);
    } else if (allBranchPrs.length > 0) {
      await log(`  ℹ️  Found existing pull request(s) from before this session`);
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
    await log(`   ${permanentLogFile}`);
    process.exit(0);

  } catch (searchError) {
    await log('\n⚠️  Could not verify results:', searchError.message);
    await log(`\n💡 Check the log file for details:`);
    await log(`   ${permanentLogFile}`);
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