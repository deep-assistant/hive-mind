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

const claudePath = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

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
  console.log(`Creating temporary directory: ${tempDir}`);
}

try {
  // Clone the repository using gh tool with authentication
  console.log(`Cloning repository ${owner}/${repo} using gh tool...`);
  await $`gh repo clone ${owner}/${repo} ${tempDir} -- --depth 1`;
  
  console.log(`Repository cloned successfully to ${tempDir}`);
  
  // Create a branch for the issue
  const randomHex = crypto.randomBytes(4).toString('hex');
  const branchName = `issue-${issueNumber}-${randomHex}`;
  console.log(`Creating branch: ${branchName}`);
  await $`cd ${tempDir} && git checkout -b ${branchName}`;
  console.log(`Switched to branch: ${branchName}`);
  
  const prompt = `GitHub Issue Solver Task:

You are currently in a git repository with a new branch already created: ${branchName}
You do NOT need to create a new branch - you're already on the correct branch for this issue.

CRITICAL GIT RULES:
- NEVER use git rebase, git reset --hard, or any command that rewrites git history
- NEVER force push (git push -f or git push --force)
- NEVER attempt to push to the main/master branch - it is protected
- Only use forward-moving git operations (commit, merge, regular push or revert if needed)
- Always push your issue branch (${branchName}) and create a pull request from it

1. INITIAL RESEARCH PHASE:
   a) Use the gh tool to fetch detailed information about this GitHub issue: ${issueUrl}
      - Get issue title, description, labels, comments, and any other relevant details
      - Understand the problem completely before proceeding
   
   b) Explore the organization's codebase for context:
      - Use gh tool to search for related code across the entire ${owner} organization
      - Look for similar implementations, patterns, or related functionality
      - Use: gh search code --owner ${owner} [relevant keywords from issue]
   
   c) Review previous pull requests:
      - Search for closed/merged PRs related to this issue or similar features
      - Use: gh pr list --repo ${owner}/${repo} --state all --search "[keywords]"
      - Study merged PRs to understand the repository's code style and conventions
      - Look for any previous attempts to solve this issue

2. COMPREHENSIVE TESTING APPROACH:
   - DO NOT HESITATE to write and run tests to understand how the codebase works
   - Test individual functions to understand their behavior and API
   - Write unit tests with mocks for your solution
   - Include integration/e2e tests where appropriate
   - Use the existing test framework in the repository
   - Run: npm test, pytest, go test, or whatever testing command the repo uses
   - Your PR MUST include automated tests that verify the solution works correctly

3. SOLUTION IMPLEMENTATION:
   - Analyze if this issue is solvable via Pull Request:
     * If YES: Create a solution with comprehensive tests and submit a pull request
     * If NO: Comment on the issue asking for clarification or explaining what information is needed
   
4. Guidelines:
   - Read all issue details and comments thoroughly
   - Study the codebase style from merged PRs before writing code
   - Follow the repository's contributing guidelines and code style exactly
   - Test any code changes thoroughly before submitting
   - Write clear commit messages and PR descriptions
   - Include automated tests in your PR to test key features of your solution
   - If the issue requires clarification, ask specific questions in a comment

Repository: ${owner}/${repo}
Issue Number: ${issueNumber}

IMPORTANT: 
- Your Pull Request SHOULD contain automated tests (unit, integration, or e2e as appropriate)
- Please mention the resulting link (Pull Request URL or Comment URL) in your final response.`;

  const systemPrompt = `You are an expert GitHub issue solver. CRITICAL REQUIREMENTS: 1) First use gh tool to thoroughly research: explore the entire organization's codebase for context, review merged PRs for code style, search for related implementations. 2) TESTING IS MANDATORY: Write and run tests to understand the codebase, test individual functions to learn their APIs, include comprehensive automated tests (unit/integration/e2e) in your PR. 3) Your PR must contain automated tests that verify your solution. 4) Study the repository's testing framework and use it properly. 5) Always mention the resulting PR or comment link in your response.`;

  // Properly escape prompts for shell usage - escape quotes and preserve newlines
  const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
  const escapedSystemPrompt = systemPrompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');

  // Get timestamps from GitHub servers before executing the command
  console.log('Getting reference timestamps from GitHub...');
  
  let referenceTime;
  try {
    // Get the issue's last update time
    const issueResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber} --jq .updated_at`;
    const issueUpdatedAt = new Date(issueResult.stdout.toString().trim());
    console.log(`  Issue last updated: ${issueUpdatedAt.toISOString()}`);
    
    // Get the last comment's timestamp (if any)
    const commentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;
    const comments = JSON.parse(commentsResult.stdout.toString().trim() || '[]');
    const lastCommentTime = comments.length > 0 ? new Date(comments[comments.length - 1].created_at) : null;
    if (lastCommentTime) {
      console.log(`  Last comment time: ${lastCommentTime.toISOString()}`);
    } else {
      console.log(`  No comments found on issue`);
    }
    
    // Get the most recent pull request's timestamp
    const prsResult = await $`gh pr list --repo ${owner}/${repo} --limit 1 --json createdAt`;
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
  let pendingData = '';
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
  console.log(`📋 Executing command:`);
  console.log(`   ${fullCommand}`);
  console.log('');
  
  // Change to the temporary directory and execute
  process.chdir(tempDir);
  
  // Build the actual command for execution
  let execCommand;
  if (argv.resume) {
    execCommand = $`${claudePath} --resume ${argv.resume} --output-format stream-json --verbose --dangerously-skip-permissions --model sonnet -p "${escapedPrompt}" --append-system-prompt "${escapedSystemPrompt}" | jq -c .`;
  } else {
    execCommand = $`${claudePath} -p "${escapedPrompt}" --output-format stream-json --verbose --dangerously-skip-permissions --append-system-prompt "${escapedSystemPrompt}" --model sonnet | jq -c .`;
  }
  
  for await (const chunk of execCommand.stream()) {
    if (chunk.type === 'stdout') {
      const data = chunk.data.toString();
      hasOutput = true;
      process.stdout.write(data);
      
      // Also save to log file
      pendingData += data;
      
      // Look for complete JSON lines
      const lines = pendingData.split('\n');
      pendingData = lines.pop() || ''; // Keep incomplete line for next chunk
      
      for (const line of lines) {
        if (line.trim()) {
          // Write to permanent log file immediately as we get each line
          await fs.appendFile(permanentLogFile, line + '\n');
          
          // Also write to temp log file if we have one
          if (currentLogFile) {
            await fs.appendFile(currentLogFile, line + '\n');
          }
          
          // Try to extract session ID if not found yet
          if (!sessionId && line.includes('session_id')) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.session_id) {
                sessionId = parsed.session_id;
                
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
            } catch (e) {
              // Ignore JSON parse errors
            }
          }
          
          // Check for limit reached message
          if (line.includes('hour limit reached') || line.includes('resets')) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.message && parsed.message.content) {
                const content = Array.isArray(parsed.message.content) 
                  ? parsed.message.content.find(c => c.type === 'text')?.text 
                  : parsed.message.content;
                if (content && content.includes('limit reached')) {
                  limitReached = true;
                }
              }
            } catch (e) {
              // Ignore JSON parse errors
            }
          }
        }
      }
    } else if (chunk.type === 'stderr') {
      const data = chunk.data.toString();
      process.stderr.write(data);
    } else if (chunk.type === 'exit') {
      if (chunk.code !== 0) {
        commandFailed = true;
        console.error(`\nClaude command failed with exit code ${chunk.code}`);
      }
    }
  }
  
  // Process any remaining data
  if (pendingData.trim()) {
    await fs.appendFile(permanentLogFile, pendingData);
    if (currentLogFile) {
      await fs.appendFile(currentLogFile, pendingData);
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
      console.log('\n📄 Log file contents (first 5 lines):');
      console.log('---');
      console.log(logContents.stdout);
      console.log('---');
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
    const currentUser = userResult.stdout.toString().trim();
    console.log(`Current GitHub user: ${currentUser}`);
    
    // Search for pull requests created from our branch after the reference time
    console.log(`\nSearching for PRs from branch '${branchName}' created after ${referenceTime.toISOString()}...`);
    
    // First, get all PRs from our branch to debug
    const allBranchPrsResult = await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --json number,url,createdAt,headRefName`;
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