#!/usr/bin/env sh
':' //# ; exec "$(command -v bun || command -v node)" "$0" "$@"

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const yargs = (await use('yargs@latest')).default;
const os = (await import('os')).default;
const path = (await import('path')).default;
const fs = (await import('fs')).promises;
const crypto = (await import('crypto')).default;

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
    alias: 'p'
  })
  .demandCommand(1, 'The GitHub issue URL is required')
  .help('h')
  .alias('h', 'help')
  .argv;

const issueUrl = argv._[0];

// Validate GitHub issue URL format
if (!issueUrl.match(/^https:\/\/github\.com\/[^\/]+\/[^\/]+\/issues\/\d+$/)) {
  console.error('Error: Please provide a valid GitHub issue URL (e.g., https://github.com/owner/repo/issues/123)');
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
    console.log(`🔄 Resuming session ${argv.resume} (session log found)`);

    // For resumed sessions, create new temp directory since old one may be cleaned up
    tempDir = path.join(os.tmpdir(), `gh-issue-solver-resume-${argv.resume}-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    console.log(`Creating new temporary directory for resumed session: ${tempDir}`);
  } catch (err) {
    console.warn(`Warning: Session log for ${argv.resume} not found, but continuing with resume attempt`);
    tempDir = path.join(os.tmpdir(), `gh-issue-solver-resume-${argv.resume}-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    console.log(`Creating temporary directory for resumed session: ${tempDir}`);
  }
} else {
  tempDir = path.join(os.tmpdir(), `gh-issue-solver-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  console.log(`Creating temporary directory: ${tempDir}\n`);
}

try {
  // Clone the repository using gh tool with authentication (full clone for proper git history)
  console.log(`Cloning repository ${owner}/${repo} using gh tool...\n`);
  const cloneResult = await $`gh repo clone ${owner}/${repo} ${tempDir}`;
  
  // Verify clone was successful
  if (cloneResult.code !== 0) {
    console.error(`Error: Failed to clone repository`);
    console.error(cloneResult.stderr ? cloneResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }

  console.log(`Repository cloned successfully to ${tempDir}\n`);

  // Set up git authentication using gh
  const authSetupResult = await $`cd ${tempDir} && gh auth setup-git 2>&1`;
  if (authSetupResult.code !== 0) {
    console.log('Note: gh auth setup-git had issues, continuing anyway\n');
  }

  // Verify we're on the default branch and get its name
  const defaultBranchResult = await $`cd ${tempDir} && git branch --show-current`;
  
  if (defaultBranchResult.code !== 0) {
    console.error(`Error: Failed to get current branch`);
    console.error(defaultBranchResult.stderr ? defaultBranchResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }

  console.log(`\n`);

  const defaultBranch = defaultBranchResult.stdout.toString().trim();
  if (!defaultBranch) {
    console.error(`Error: Unable to detect default branch`);
    process.exit(1);
  }
  console.log(`Default branch detected: ${defaultBranch}\n`);

  // Ensure we're on a clean default branch
  const statusResult = await $`cd ${tempDir} && git status --porcelain`;

  console.log(`\n`);

  if (statusResult.code !== 0) {
    console.error(`Error: Failed to check git status`);
    console.error(statusResult.stderr ? statusResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }
  
  // Note: Empty output means clean working directory
  const statusOutput = statusResult.stdout.toString().trim();
  if (statusOutput) {
    console.error(`Error: Repository has uncommitted changes after clone`);
    console.error(`Status output: ${statusOutput}`);
    process.exit(1);
  }

  console.log('\n');

  // Create a branch for the issue
  const randomHex = crypto.randomBytes(4).toString('hex');
  const branchName = `issue-${issueNumber}-${randomHex}`;
  console.log(`Creating branch: ${branchName} from ${defaultBranch}\n`);
  const checkoutResult = await $`cd ${tempDir} && git checkout -b ${branchName}`;

  if (checkoutResult.code !== 0) {
    console.error(`Error: Failed to create branch ${branchName}:`);
    console.error(checkoutResult.stderr ? checkoutResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }
  
  console.log(`✓ Successfully created branch: ${branchName}`);

  // Verify we're on the correct branch
  const currentBranchResult = await $`cd ${tempDir} && git branch --show-current`;
  
  if (currentBranchResult.code !== 0) {
    console.error(`Error: Failed to verify current branch`);
    console.error(currentBranchResult.stderr ? currentBranchResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }
  
  const currentBranch = currentBranchResult.stdout.toString().trim();
  if (currentBranch !== branchName) {
    console.log('\n');
    console.error(`Error: Failed to switch to branch ${branchName}, currently on ${currentBranch}\n`);
    process.exit(1);
  }
  console.log(`✓ Successfully switched to branch: ${branchName}`);

  const prompt = `1. Initial research.  
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
   - When you open pr, describe solution and include tests.  

4. Workflow and collaboration.  
   - When you check branch, verify with git branch --show-current.  
   - When you push, push only to branch ${branchName}.  
   - When you finish, create a pull request from branch ${branchName}.  
   - When you organize workflow, use pull requests instead of direct merges to main or master branches.  
   - When you manage commits, preserve commit history for later analysis.  
   - When you contribute, keep repository history forward-moving with regular commits, pushes, and reverts if needed.  
   - When you face conflict, ask for help.  
   - When you collaborate, respect branch protections by working only on ${branchName}.  
   - When you mention result, include pull request url or comment url.  

5. Self review.  
   - When you check your solution, run all tests locally.  
   - When you compare with repo style, use gh pr diff [number].  
   - When you finalize, confirm code, tests, and description are consistent.  `;

  const systemPrompt = `You are AI issue solver.
When you execute commands, always save their logs to files for easy reading if the output gets large.
When running commands, do not set a timeout yourself — let them run as long as needed (default timeout - 2 minutes is more than enough, if you can set 4 minutes), and once they finish, review the logs in the file.
When CI is failing, make sure you download the logs locally and carefully investigate them.
When a code or log file has more than 2500 lines, read it in chunks of 2500 lines.
When facing a complex problem, do as much tracing as possible and turn on all verbose modes.
When you create debug, test, or example scripts for fixing, always keep them in an examples folder so you can reuse them later.
When testing your assumptions, use the example scripts.
When you face something extremely hard, use divide and conquer — it always helps.`;

  // Properly escape prompts for shell usage - escape quotes and preserve newlines
  const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
  const escapedSystemPrompt = systemPrompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');

  // Get timestamps from GitHub servers before executing the command
  console.log('Getting reference timestamps from GitHub...');

  let referenceTime;
  try {
    // Get the issue's last update time
    const issueResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber} --jq .updated_at`;
    
    if (issueResult.code !== 0) {
      throw new Error(`Failed to get issue details: ${issueResult.stderr ? issueResult.stderr.toString() : 'Unknown error'}`);
    }
    
    const issueUpdatedAt = new Date(issueResult.stdout.toString().trim());
    console.log(`  Issue last updated: ${issueUpdatedAt.toISOString()}`);

    // Get the last comment's timestamp (if any)
    const commentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;
    
    if (commentsResult.code !== 0) {
      console.warn(`Warning: Failed to get comments: ${commentsResult.stderr ? commentsResult.stderr.toString() : 'Unknown error'}`);
      // Continue anyway, comments are optional
    }
    
    const comments = JSON.parse(commentsResult.stdout.toString().trim() || '[]');
    const lastCommentTime = comments.length > 0 ? new Date(comments[comments.length - 1].created_at) : null;
    if (lastCommentTime) {
      console.log(`  Last comment time: ${lastCommentTime.toISOString()}`);
    } else {
      console.log(`  No comments found on issue`);
    }

    // Get the most recent pull request's timestamp
    const prsResult = await $`gh pr list --repo ${owner}/${repo} --limit 1 --json createdAt`;
    
    if (prsResult.code !== 0) {
      console.warn(`Warning: Failed to get PRs: ${prsResult.stderr ? prsResult.stderr.toString() : 'Unknown error'}`);
      // Continue anyway, PRs are optional for timestamp calculation
    }
    
    const prs = JSON.parse(prsResult.stdout.toString().trim() || '[]');
    const lastPrTime = prs.length > 0 ? new Date(prs[0].createdAt) : null;
    if (lastPrTime) {
      console.log(`  Most recent PR in repo: ${lastPrTime.toISOString()}`);
    } else {
      console.log(`  No PRs found in repo`);
    }

    // Use the most recent timestamp as reference
    referenceTime = issueUpdatedAt;
    if (lastCommentTime && lastCommentTime > referenceTime) {
      referenceTime = lastCommentTime;
    }
    if (lastPrTime && lastPrTime > referenceTime) {
      referenceTime = lastPrTime;
    }

    console.log(`✓ Using reference timestamp: ${referenceTime.toISOString()}`);
  } catch (timestampError) {
    console.warn('Warning: Could not get GitHub timestamps, using current time as reference');
    console.warn(`  Error: ${timestampError.message}`);
    referenceTime = new Date();
    console.log(`  Fallback timestamp: ${referenceTime.toISOString()}`);
  }

  // Execute claude command from the cloned repository directory
  console.log(`\nExecuting claude command from repository directory...`);

  // Use command-stream's async iteration for real-time streaming with file logging
  let commandFailed = false;
  let sessionId = null;
  let permanentLogFile = null;
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

  console.log(`📁 Log file: ${permanentLogFile}`);
  console.log(`   (You can tail -f this file to watch progress)\n`);

  // Build claude command with optional resume flag
  let claudeArgs = `--output-format stream-json --verbose --dangerously-skip-permissions --model sonnet`;

  if (argv.resume) {
    console.log(`🔄 Resuming from session: ${argv.resume}`);
    claudeArgs = `--resume ${argv.resume} ${claudeArgs}`;
  }

  claudeArgs += ` -p "${escapedPrompt}" --append-system-prompt "${escapedSystemPrompt}"`;

  // Print the command being executed (with cd for reproducibility)
  const fullCommand = `(cd "${tempDir}" && ${claudePath} ${claudeArgs} | jq -c .)`;
  console.log(`📋 Command prepared:`);
  console.log(`   ${fullCommand}`);
  console.log('');

  // If only preparing command, exit here
  if (argv.onlyPrepareCommand) {
    console.log(`✓ Command preparation complete. Repository cloned to: ${tempDir}`);
    console.log(`✓ Branch created: ${branchName}`);
    console.log(`\nTo execute manually:`);
    console.log(`cd "${tempDir}"`);
    console.log(`${claudePath} ${claudeArgs}`);
    process.exit(0);
  }

  // Change to the temporary directory and execute
  process.chdir(tempDir);

  // Build the actual command for execution
  let execCommand;
  if (argv.resume) {
    execCommand = $`${claudePath} --resume ${argv.resume} --output-format stream-json --verbose --dangerously-skip-permissions --model sonnet -p "${escapedPrompt}" --append-system-prompt "${escapedSystemPrompt}" | jq`;
  } else {
    execCommand = $({ stdin: prompt, mirror: false })`${claudePath} --output-format stream-json --verbose --dangerously-skip-permissions --append-system-prompt "${escapedSystemPrompt}" --model sonnet`;
  }

  for await (const chunk of execCommand.stream()) {
    if (chunk.type === 'stdout') {
      const data = chunk.data.toString();

      let json;
      try {
        json = JSON.parse(data);
      } catch (error) {
        // Not JSON, just append to log
        await fs.appendFile(permanentLogFile, data + '\n');
        continue;
      }

      // Save full JSON to log file
      const jsonString = JSON.stringify(json, null, 2);
      await fs.appendFile(permanentLogFile, jsonString + '\n');

      // Extract session ID on first message
      if (!sessionId && json.session_id) {
        sessionId = json.session_id;
        console.log(`🔧 Session ID: ${sessionId}`);
        
        // Try to rename log file to include session ID
        try {
          const sessionLogFile = path.join(scriptDir, `${sessionId}.log`);
          await fs.rename(permanentLogFile, sessionLogFile);
          permanentLogFile = sessionLogFile;
          console.log(`📁 Log renamed to: ${permanentLogFile}`);
        } catch (renameError) {
          // If rename fails, keep original filename
          console.log(`📁 Keeping log file: ${permanentLogFile}`);
        }
        console.log('');
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
        
        // Show progress indicator
        process.stdout.write(`\r📝 Messages: ${messageCount} | 🔧 Tool uses: ${toolUseCount} | Last: ${lastMessage}...`);
      } else if (json.type === 'tool_use') {
        toolUseCount++;
        const toolName = json.tool_use?.name || 'unknown';
        process.stdout.write(`\r🔧 Using tool: ${toolName} (${toolUseCount} total)...                                   `);
      } else if (json.type === 'system' && json.subtype === 'init') {
        console.log('🚀 Claude session started');
        console.log(`📊 Model: ${json.model || 'unknown'}`);
        console.log('');
      }

    } else if (chunk.type === 'stderr') {
      const data = chunk.data.toString();
      // Only show actual errors, not verbose output
      if (data.includes('Error') || data.includes('error')) {
        console.error(`\n⚠️  ${data}`);
      }
      await fs.appendFile(permanentLogFile, `STDERR: ${data}\n`);
    } else if (chunk.type === 'exit') {
      if (chunk.code !== 0) {
        commandFailed = true;
        console.error(`\n\n❌ Claude command failed with exit code ${chunk.code}`);
      }
    }
  }

  // Clear the progress line
  process.stdout.write('\r' + ' '.repeat(100) + '\r');

  if (commandFailed) {
    console.log('\n❌ Command execution failed. Check the log file for details.');
    console.log(`📁 Log file: ${permanentLogFile}`);
    process.exit(1);
  }

  console.log('\n✅ Claude command completed successfully');
  console.log(`📊 Total messages: ${messageCount}, Tool uses: ${toolUseCount}`);

  // Show summary of session and log file
  console.log('\n=== Session Summary ===');

  if (sessionId) {
    console.log(`✅ Session ID: ${sessionId}`);
    console.log(`✅ Complete log file: ${permanentLogFile}`);

    if (limitReached) {
      console.log(`\n⏰ LIMIT REACHED DETECTED!`);
      console.log(`\n🔄 To resume when limit resets, use:\n`);
      console.log(`./solve.mjs "${issueUrl}" --resume ${sessionId}`);
      console.log(`\n   This will continue from where it left off with full context.\n`);
    } else {
      // Show command to resume session in interactive mode
      console.log(`\n💡 To continue this session in Claude Code interactive mode:\n`);
      console.log(`cd ${tempDir}`);
      console.log(`claude --resume ${sessionId}`);
      console.log(`\n   or from any directory:\n`);
      console.log(`claude --resume ${sessionId} --working-directory ${tempDir}`);
      console.log(``);
    }

    // Don't show log preview, it's too technical
  } else {
    console.log(`❌ No session ID extracted`);
    console.log(`📁 Log file available: ${permanentLogFile}`);
  }

  // Now search for newly created pull requests and comments
  console.log('\n🔍 Searching for created pull requests or comments...');

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
    process.stdout.write('  Checking for pull requests...');

    // First, get all PRs from our branch
    const allBranchPrsResult = await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --json number,url,createdAt,headRefName`;
    
    if (allBranchPrsResult.code !== 0) {
      process.stdout.write(' ⚠️  (failed)\n');
      // Continue with empty list
    }
    
    const allBranchPrs = allBranchPrsResult.stdout.toString().trim() ? JSON.parse(allBranchPrsResult.stdout.toString().trim()) : [];

    // Now filter for new ones
    const newPrs = allBranchPrs.filter(pr => new Date(pr.createdAt) > referenceTime);

    if (newPrs.length > 0) {
      const pr = newPrs[0];
      process.stdout.write(' ✅\n');
      console.log(`\n🎉 SUCCESS: Pull Request created!`);
      console.log(`📍 URL: ${pr.url}`);
      console.log(`\n✨ The issue has been solved and a PR has been created.`);
      process.exit(0);
    } else {
      process.stdout.write(' (none found)\n');
    }

    // If no PR found, search for recent comments on the issue
    process.stdout.write('  Checking for new comments...');

    // Get all comments and filter them
    const allCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;
    
    if (allCommentsResult.code !== 0) {
      process.stdout.write(' ⚠️  (failed)\n');
      // Continue with empty list
    }
    
    const allComments = JSON.parse(allCommentsResult.stdout.toString().trim() || '[]');

    // Filter for new comments by current user
    const newCommentsByUser = allComments.filter(comment =>
      comment.user.login === currentUser && new Date(comment.created_at) > referenceTime
    );

    if (newCommentsByUser.length > 0) {
      const lastComment = newCommentsByUser[newCommentsByUser.length - 1];
      process.stdout.write(' ✅\n');
      console.log(`\n💬 SUCCESS: Comment posted on issue!`);
      console.log(`📍 URL: ${lastComment.html_url}`);
      console.log(`\n✨ A clarifying comment has been added to the issue.`);
      process.exit(0);
    } else {
      process.stdout.write(' (none found)\n');
    }

    // If neither found, it might not have been necessary to create either
    console.log('\n📋 No new pull request or comment was created.');
    console.log('   The issue may have been resolved differently or required no action.');
    console.log(`\n💡 To review what happened, check the log file:`);
    console.log(`   ${permanentLogFile}`);
    process.exit(0);

  } catch (searchError) {
    console.warn('\n⚠️  Could not verify results:', searchError.message);
    console.log(`\n💡 Check the log file for details:`);
    console.log(`   ${permanentLogFile}`);
    process.exit(0);
  }

} catch (error) {
  console.error('Error executing command:', error.message);
  process.exit(1);
} finally {
  // Clean up temporary directory (but not when resuming or when limit reached)
  if (!argv.resume && !limitReached) {
    try {
      process.stdout.write('\n🧹 Cleaning up...');
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(' ✅');
    } catch (cleanupError) {
      console.log(' ⚠️  (failed)');
    }
  } else if (argv.resume) {
    console.log(`\n📁 Keeping directory for resumed session: ${tempDir}`);
  } else if (limitReached) {
    console.log(`\n📁 Keeping directory for future resume: ${tempDir}`);
  }
}