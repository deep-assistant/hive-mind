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
  let currentLogFile = null;
  let permanentLogFile = null;
  let hasOutput = false;
  let limitReached = false;

  // Create permanent log file immediately with timestamp
  const scriptDir = path.dirname(process.argv[1]);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  permanentLogFile = path.join(scriptDir, `solve-${timestamp}.log`);

  console.log(`📁 Streaming to log file: ${permanentLogFile}`);
  console.log(`   (You can open this file in VS Code to watch real-time progress)\n`);

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
      let jsonString;

      try {
        json = JSON.parse(data);
        jsonString = JSON.stringify(json, null, 2);
      } catch (error) {
        console.error('Error parsing JSON:', error);
      }

      hasOutput = true;
      process.stdout.write(jsonString);

      // Try to extract session ID if not found yet
      if (!sessionId) {
        if (json.session_id) {
          sessionId = json.session_id;

          // Rename permanent log file to use session ID
          const sessionLogFile = path.join(scriptDir, `${sessionId}.log`);
          await fs.rename(permanentLogFile, sessionLogFile);
          permanentLogFile = sessionLogFile;

          console.log(`\n   ✅ Session ID extracted: ${sessionId}`);
          console.log(`   📁 Log file renamed to: ${permanentLogFile}\n`);

          // Also create temp log file for compatibility
          currentLogFile = path.join(tempDir, `${sessionId}.log`);
          await fs.writeFile(currentLogFile, line + '\n');
        }
      }

      // Check for limit reached message
      if (json.message && json.message.content && json.message.content.length > 0) {
        for (const item of json.message.content) {
          if (item.type === 'text') {
            if (item.text && item.text.includes('limit reached')) {
              limitReached = true;
            }
          }
        }
      }

      await fs.appendFile(permanentLogFile, jsonString + '\n');
      if (currentLogFile) {
        await fs.appendFile(currentLogFile, jsonString + '\n');
      }

    } else if (chunk.type === 'stderr') {
      const data = chunk.data.toString();
      process.stderr.write(data);
      await fs.appendFile(permanentLogFile, data + '\n');
      if (currentLogFile) {
        await fs.appendFile(currentLogFile, data + '\n');
      }
    } else if (chunk.type === 'exit') {
      if (chunk.code !== 0) {
        commandFailed = true;
        console.error(`\nClaude command failed with exit code ${chunk.code}`);
      }
    }
  }

  if (commandFailed) {
    process.exit(1);
  }

  console.log('\nClaude command completed successfully');

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

    // Show log file contents preview
    try {
      const logContents = await $`head -n 5 ${permanentLogFile}`;
      
      if (logContents.code === 0) {
        console.log('\n📄 Log file contents (first 5 lines):');
        console.log('---');
        console.log(logContents.stdout);
        console.log('---');
      } else {
        console.log('Could not preview log file contents');
      }
    } catch (e) {
      console.log('Could not preview log file contents');
    }
  } else {
    console.log(`❌ No session ID extracted`);
    console.log(`📁 Log file available: ${permanentLogFile}`);
  }

  // Now search for newly created pull requests and comments
  console.log('\n=== Searching for results ===');
  console.log(`Branch name: ${branchName}`);
  console.log(`Reference time: ${referenceTime.toISOString()}`);

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
    console.log(`Current GitHub user: ${currentUser}`);

    // Search for pull requests created from our branch after the reference time
    console.log(`\nSearching for PRs from branch '${branchName}' created after ${referenceTime.toISOString()}...`);

    // First, get all PRs from our branch to debug
    const allBranchPrsResult = await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --json number,url,createdAt,headRefName`;
    
    if (allBranchPrsResult.code !== 0) {
      console.warn(`Warning: Failed to list PRs: ${allBranchPrsResult.stderr ? allBranchPrsResult.stderr.toString() : 'Unknown error'}`);
      // Continue with empty list
    }
    
    const allBranchPrs = allBranchPrsResult.stdout.toString().trim() ? JSON.parse(allBranchPrsResult.stdout.toString().trim()) : [];
    console.log(`  Found ${allBranchPrs.length} PR(s) from branch ${branchName}:`);
    allBranchPrs.forEach(pr => {
      console.log(`    - PR #${pr.number}: created at ${pr.createdAt} (${new Date(pr.createdAt) > referenceTime ? 'NEW' : 'old'})`);
    });

    // Now filter for new ones
    const newPrs = allBranchPrs.filter(pr => new Date(pr.createdAt) > referenceTime);

    if (newPrs.length > 0) {
      const pr = newPrs[0];
      console.log(`\n✓ Found new PR #${pr.number} created at ${pr.createdAt}`);
      console.log(`\nSUCCESS: Pull Request created at ${pr.url}`);
      process.exit(0);
    } else {
      console.log(`  No new PRs found from branch ${branchName} after ${referenceTime.toISOString()}`);
    }

    // If no PR found, search for recent comments on the issue
    console.log(`\nSearching for comments by ${currentUser} on issue #${issueNumber} after ${referenceTime.toISOString()}...`);

    // Get all comments and filter them
    const allCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;
    
    if (allCommentsResult.code !== 0) {
      console.warn(`Warning: Failed to get comments: ${allCommentsResult.stderr ? allCommentsResult.stderr.toString() : 'Unknown error'}`);
      // Continue with empty list
    }
    
    const allComments = JSON.parse(allCommentsResult.stdout.toString().trim() || '[]');

    if (allComments.length > 0) {
      console.log(`  Recent comments on issue:`);
      const recentComments = allComments.slice(-5); // Last 5 comments
      recentComments.forEach(comment => {
        const isNew = new Date(comment.created_at) > referenceTime;
        const isCurrentUser = comment.user.login === currentUser;
        console.log(`    - Comment ${comment.id} by ${comment.user.login} at ${comment.created_at} (${isNew ? 'NEW' : 'old'}, ${isCurrentUser ? 'CURRENT USER' : 'other user'})`);
      });
    } else {
      console.log(`  No comments found on issue`);
    }

    // Filter for new comments by current user
    const newCommentsByUser = allComments.filter(comment =>
      comment.user.login === currentUser && new Date(comment.created_at) > referenceTime
    );

    if (newCommentsByUser.length > 0) {
      const lastComment = newCommentsByUser[newCommentsByUser.length - 1];
      console.log(`\n✓ Found ${newCommentsByUser.length} new comment(s) by ${currentUser}`);
      console.log(`\nSUCCESS: Comment posted at ${lastComment.html_url}`);
      process.exit(0);
    } else {
      console.log(`  No new comments found by ${currentUser} after ${referenceTime.toISOString()}`);
    }

    // If neither found, it might not have been necessary to create either
    console.log('\n=== No new PR or comment detected ===');
    console.log('The issue may have been resolved differently or required no action.');
    process.exit(0);

  } catch (searchError) {
    console.warn('\n=== Error during search ===');
    console.warn('Warning: Could not search for created pull request or comment:', searchError.message);
    console.warn('Stack:', searchError.stack);
    console.log('The command completed but we could not verify the result.');
    process.exit(0);
  }

} catch (error) {
  console.error('Error executing command:', error.message);
  process.exit(1);
} finally {
  // Clean up temporary directory (but not when resuming or when limit reached)
  if (!argv.resume && !limitReached) {
    try {
      console.log(`Cleaning up temporary directory: ${tempDir}`);
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log('Temporary directory cleaned up successfully');
    } catch (cleanupError) {
      console.warn(`Warning: Failed to clean up temporary directory: ${cleanupError.message}`);
    }
  } else if (argv.resume) {
    console.log(`Keeping temporary directory for resumed session: ${tempDir}`);
  } else if (limitReached) {
    console.log(`Keeping temporary directory for future resume: ${tempDir}`);
  }
}