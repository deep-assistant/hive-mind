/**
 * Claude execution module for solve.mjs
 * Handles the actual execution of Claude commands and processing of output
 */

import fs from 'fs';
import path from 'path';

// Import Sentry integration
import { reportError } from './sentry.lib.mjs';

/**
 * Build the user prompt for Claude
 * @param {Object} params - Parameters for building the user prompt
 * @returns {string} The formatted user prompt
 */
export const buildUserPrompt = (params) => {
  const {
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
    argv
  } = params;

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
  if (argv && argv.fork && forkedRepo) {
    promptLines.push(`Your forked repository: ${forkedRepo}`);
    promptLines.push(`Original repository (upstream): ${owner}/${repo}`);

    // Check for GitHub Actions on fork and add link if workflows exist
    if (branchName && params.forkActionsUrl) {
      promptLines.push(`GitHub Actions on your fork: ${params.forkActionsUrl}`);
    }
  }

  // Add blank line
  promptLines.push('');

  // Add feedback info if in continue mode and there are feedback items
  if (isContinueMode && feedbackLines && feedbackLines.length > 0) {
    // Add each feedback line directly
    feedbackLines.forEach(line => promptLines.push(line));
    promptLines.push('');
  }

  // Add "Think ultra hard." if the option is enabled
  if (argv && argv.thinkUltraHard) {
    promptLines.push('Think ultra hard.');
  }

  // Final instruction
  promptLines.push(isContinueMode ? 'Continue.' : 'Proceed.');

  // Build the final prompt
  return promptLines.join('\n');
};

/**
 * Build the system prompt for Claude - simplified to avoid shell escaping issues
 * @param {Object} params - Parameters for building the prompt
 * @returns {string} The formatted system prompt
 */
export const buildSystemPrompt = (params) => {
  const { owner, repo, issueNumber, prNumber, branchName, argv } = params;

  // Check if think-ultra-hard option is enabled
  const thinkUltraHardLine = argv && argv.thinkUltraHard ? '\nYou always think ultra hard on every step.\n' : '';

  // Use backticks for jq commands to avoid quote escaping issues
  return `You are AI issue solver.${thinkUltraHardLine}

General guidelines.
   - When you execute commands, always save their logs to files for easy reading if the output gets large.
   - When running commands, do not set a timeout yourself — let them run as long as needed (default timeout - 2 minutes is more than enough, if you can set 4 minutes), and once they finish, review the logs in the file.
   - When CI is failing, make sure you download the logs locally and carefully investigate them.
   - When a code or log file has more than 2500 lines, read it in chunks of 2500 lines.
   - When facing a complex problem, do as much tracing as possible and turn on all verbose modes.
   - When you create debug, test, or example/experiment scripts for fixing, always keep them in an examples or/and experiments folders so you can reuse them later.
   - When testing your assumptions, use the experiment scripts, and add it to experiments folder.
   - When your experiments can show real world use case of the software, add it to examples folder.
   - When you face something extremely hard, use divide and conquer — it always helps.

Initial research.
   - When you read issue, read all details and comments thoroughly.
   - When you need issue details, use gh issue view https://github.com/${owner}/${repo}/issues/${issueNumber}.
   - When you need related code, use gh search code --owner ${owner} [keywords].
   - When you need repo context, read files in your working directory.
   - When you study related work, study related previous latest pull requests.
   - When issue is not defined enough, write a comment to ask clarifying questions.
   - When accessing GitHub Gists (especially private ones), use gh gist view command instead of direct URL fetching to ensure proper authentication.
   - When you are fixing a bug, please make sure you first find the actual root cause, do as much experiments as needed.
   - When you are fixing a bug and code does not have enough tracing/logs, add them and make sure they stay in the code, but are switched off by default.
   - When you need latest comments on pull request (sorted newest first), use appropriate GitHub API commands.
   - When you need latest comments on issue (sorted newest first), use appropriate GitHub API commands.

Solution development and testing.
   - When issue is solvable, implement code with tests.
   - When you test, start from small functions.
   - When you test, write unit tests with mocks.
   - When you test integrations, use existing framework.
   - When you test solution draft, include automated checks in pr.
   - When issue is unclear, write comment on issue asking questions.
   - When you encounter any problems that you unable to solve yourself (any human feedback or help), write a comment to the pull request asking for help.
   - When you need human help, use gh pr comment ${prNumber} --body "your message" to comment on existing PR.

Preparing pull request.
   - When you finalize the pull request, follow style from merged prs for code, title, and description, and double-check the logic of all conditions and statements.
   - When you code, follow contributing guidelines.
   - When you commit, write clear message.
   - When you need examples of style, use gh pr list --repo ${owner}/${repo} --state merged --search [keywords].
   - When you open pr, describe solution draft and include tests.
   - When there is a package with version and GitHub Actions workflows for automatic release, update the version (or other necessary release trigger) in your pull request to prepare for next release.
   - When you update existing pr ${prNumber}, use gh pr edit to modify title and description.
   - When you finish implementation, use gh pr ready ${prNumber}.

Workflow and collaboration.
   - When you check branch, verify with git branch --show-current.
   - When you push, push only to branch ${branchName}.
   - When you finish, create a pull request from branch ${branchName}. (Note: PR ${prNumber} already exists, update it instead)
   - When you organize workflow, use pull requests instead of direct merges to default branch (main or master).
   - When you manage commits, preserve commit history for later analysis.
   - When you contribute, keep repository history forward-moving with regular commits, pushes, and reverts if needed.
   - When you face conflict, ask for help.
   - When you collaborate, respect branch protections by working only on ${branchName}.
   - When you mention result, include pull request url or comment url.
   - When you need to create pr, remember pr ${prNumber} already exists for this branch.

Self review.
   - When you check your solution draft, run all tests locally.
   - When you compare with repo style, use gh pr diff [number].
   - When you finalize, confirm code, tests, and description are consistent.`;
};

/**
 * Execute Claude with all prompts and settings
 * This is the main entry point that handles all prompt building and execution
 * @param {Object} params - Parameters for Claude execution
 * @returns {Object} Result of the execution including success status and session info
 */
export const executeClaude = async (params) => {
  const {
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
  } = params;

  // Build the user prompt
  const prompt = buildUserPrompt({
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
    argv
  });

  // Build the system prompt
  const systemPrompt = buildSystemPrompt({
    owner,
    repo,
    issueNumber,
    issueUrl,
    prNumber,
    prUrl,
    branchName,
    tempDir,
    isContinueMode,
    forkedRepo,
    argv
  });

  // Log prompt details in verbose mode
  if (argv.verbose) {
    await log('\n📝 Final prompt structure:', { verbose: true });
    await log(`   Characters: ${prompt.length}`, { verbose: true });
    await log(`   System prompt characters: ${systemPrompt.length}`, { verbose: true });
    if (feedbackLines && feedbackLines.length > 0) {
      await log('   Feedback info: Included', { verbose: true });
    }

    // In dry-run mode, output the actual prompts for debugging
    if (argv.dryRun) {
      await log('\n📋 User prompt content:', { verbose: true });
      await log('---BEGIN USER PROMPT---', { verbose: true });
      await log(prompt, { verbose: true });
      await log('---END USER PROMPT---', { verbose: true });
      await log('\n📋 System prompt content:', { verbose: true });
      await log('---BEGIN SYSTEM PROMPT---', { verbose: true });
      await log(systemPrompt, { verbose: true });
      await log('---END SYSTEM PROMPT---', { verbose: true });
    }
  }

  // Escape prompts for shell usage
  const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
  const escapedSystemPrompt = systemPrompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');

  // Execute the Claude command
  return await executeClaudeCommand({
    tempDir,
    branchName,
    prompt,
    systemPrompt,
    escapedPrompt,
    escapedSystemPrompt,
    argv,
    log,
    setLogFile,
    getLogFile,
    formatAligned,
    getResourceSnapshot,
    forkedRepo,
    feedbackLines,
    claudePath,
    $
  });
};

export const executeClaudeCommand = async (params) => {
  const {
    tempDir,
    branchName,
    prompt,
    systemPrompt,
    escapedPrompt,
    escapedSystemPrompt,
    argv,
    log,
    setLogFile,
    getLogFile,
    formatAligned,
    getResourceSnapshot,
    forkedRepo,
    feedbackLines,
    claudePath,
    $  // Add command-stream $ to params
  } = params;

  // Retry configuration for API overload errors
  const maxRetries = 3;
  const baseDelay = 5000; // Start with 5 seconds
  let retryCount = 0;

  // Function to execute with retry logic
  const executeWithRetry = async () => {
    // Execute claude command from the cloned repository directory
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing Claude:', argv.model.toUpperCase())}`);
    } else {
      await log(`\n${formatAligned('🔄', 'Retry attempt:', `${retryCount}/${maxRetries}`)}`);
    }

    if (argv.verbose) {
    // Output the actual model being used
    const modelName = argv.model === 'opus' ? 'opus' : 'sonnet';
    await log(`   Model: ${modelName}`, { verbose: true });
    await log(`   Working directory: ${tempDir}`, { verbose: true });
    await log(`   Branch: ${branchName}`, { verbose: true });
    await log(`   Prompt length: ${prompt.length} chars`, { verbose: true });
    await log(`   System prompt length: ${systemPrompt.length} chars`, { verbose: true });
    if (feedbackLines && feedbackLines.length > 0) {
      await log(`   Feedback info included: Yes (${feedbackLines.length} lines)`, { verbose: true });
    } else {
      await log('   Feedback info included: No', { verbose: true });
    }
  }

  // Take resource snapshot before execution
  const resourcesBefore = await getResourceSnapshot();
  await log('📈 System resources before execution:', { verbose: true });
  await log(`   Memory: ${resourcesBefore.memory.split('\n')[1]}`, { verbose: true });
  await log(`   Load: ${resourcesBefore.load}`, { verbose: true });

    // Use command-stream's async iteration for real-time streaming with file logging
    let commandFailed = false;
    let sessionId = null;
    let limitReached = false;
    let messageCount = 0;
    let toolUseCount = 0;
    let lastMessage = '';
    let isOverloadError = false;

  // Build claude command with optional resume flag
  let execCommand;

  // Build claude command arguments
  let claudeArgs = `--output-format stream-json --verbose --dangerously-skip-permissions --model ${argv.model}`;

  if (argv.resume) {
    await log(`🔄 Resuming from session: ${argv.resume}`);
    claudeArgs = `--resume ${argv.resume} ${claudeArgs}`;
  }

  claudeArgs += ` -p "${escapedPrompt}" --append-system-prompt "${escapedSystemPrompt}"`;

  // Build the full command for display (with jq for formatting as in v0.3.2)
  const fullCommand = `(cd "${tempDir}" && ${claudePath} ${claudeArgs} | jq -c .)`;

  // Print the actual raw command being executed
  await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
  await log(`${fullCommand}`);
  await log('');

  // Output prompts in verbose mode for debugging
  if (argv.verbose) {
    await log('📋 User prompt:', { verbose: true });
    await log('---BEGIN USER PROMPT---', { verbose: true });
    await log(prompt, { verbose: true });
    await log('---END USER PROMPT---', { verbose: true });
    await log('', { verbose: true });
    await log('📋 System prompt:', { verbose: true });
    await log('---BEGIN SYSTEM PROMPT---', { verbose: true });
    await log(systemPrompt, { verbose: true });
    await log('---END SYSTEM PROMPT---', { verbose: true });
    await log('', { verbose: true });
  }

  try {
    if (argv.resume) {
      // When resuming, pass prompt directly with -p flag
      // Use simpler escaping - just escape double quotes
      const simpleEscapedPrompt = prompt.replace(/"/g, '\\"');
      const simpleEscapedSystem = systemPrompt.replace(/"/g, '\\"');

      execCommand = $({
        cwd: tempDir,
        mirror: false
      })`${claudePath} --resume ${argv.resume} --output-format stream-json --verbose --dangerously-skip-permissions --model ${argv.model} -p "${simpleEscapedPrompt}" --append-system-prompt "${simpleEscapedSystem}"`;
    } else {
      // When not resuming, pass prompt via stdin
      // For system prompt, escape it properly for shell - just escape double quotes
      const simpleEscapedSystem = systemPrompt.replace(/"/g, '\\"');

      execCommand = $({
        cwd: tempDir,
        stdin: prompt,
        mirror: false
      })`${claudePath} --output-format stream-json --verbose --dangerously-skip-permissions --model ${argv.model} --append-system-prompt "${simpleEscapedSystem}"`;
    }

    await log(`${formatAligned('📋', 'Command details:', '')}`);
    await log(formatAligned('📂', 'Working directory:', tempDir, 2));
    await log(formatAligned('🌿', 'Branch:', branchName, 2));
    await log(formatAligned('🤖', 'Model:', `Claude ${argv.model.toUpperCase()}`, 2));
    if (argv.fork && forkedRepo) {
      await log(formatAligned('🍴', 'Fork:', forkedRepo, 2));
    }

    await log(`\n${formatAligned('▶️', 'Streaming output:', '')}\n`);

    // Use command-stream's async iteration for real-time streaming
    let exitCode = 0;

    for await (const chunk of execCommand.stream()) {
      if (chunk.type === 'stdout') {
        const output = chunk.data.toString();

        // Process complete lines from stdout
        const lines = output.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);

            // Output formatted JSON as in v0.3.2
            await log(JSON.stringify(data, null, 2));

            // Capture session ID from the first message
            if (!sessionId && data.session_id) {
              sessionId = data.session_id;
              await log(`📌 Session ID: ${sessionId}`);

              // Try to rename log file to include session ID
              let sessionLogFile;
              try {
                const currentLogFile = getLogFile();
                const logDir = path.dirname(currentLogFile);
                sessionLogFile = path.join(logDir, `${sessionId}.log`);

                // Use fs.promises to rename the file
                await fs.promises.rename(currentLogFile, sessionLogFile);

                // Update the global log file reference
                setLogFile(sessionLogFile);

                await log(`📁 Log renamed to: ${sessionLogFile}`);
              } catch (renameError) {
                reportError(renameError, {
                  context: 'rename_session_log',
                  sessionId,
                  sessionLogFile,
                  operation: 'rename_log_file'
                });
                // If rename fails, keep original filename
                await log(`⚠️ Could not rename log file: ${renameError.message}`, { verbose: true });
              }
            }

            // Track message and tool use counts
            if (data.type === 'message') {
              messageCount++;
            } else if (data.type === 'tool_use') {
              toolUseCount++;
            }

            // Store last message for error detection
            if (data.type === 'text' && data.text) {
              lastMessage = data.text;
            } else if (data.type === 'error') {
              lastMessage = data.error || JSON.stringify(data);
            }

            // Check for API overload error
            if (data.type === 'assistant' && data.message && data.message.content) {
              const content = Array.isArray(data.message.content) ? data.message.content : [data.message.content];
              for (const item of content) {
                if (item.type === 'text' && item.text) {
                  // Check for the specific error pattern from the issue
                  if (item.text.includes('API Error: 500') &&
                      item.text.includes('api_error') &&
                      item.text.includes('Overloaded')) {
                    isOverloadError = true;
                    lastMessage = item.text;
                    await log('⚠️ Detected API overload error', { verbose: true });
                  }
                }
              }
            }

          } catch (parseError) {
            reportError(parseError, {
              context: 'parse_claude_output',
              line,
              operation: 'parse_json_output'
            });
            // Not JSON or parsing failed, output as-is if it's not empty
            if (line.trim() && !line.includes('node:internal')) {
              await log(line, { stream: 'raw' });
              lastMessage = line;
            }
          }
        }
      }

      if (chunk.type === 'stderr') {
        const errorOutput = chunk.data.toString();
        // Log stderr immediately
        if (errorOutput) {
          await log(errorOutput, { stream: 'stderr' });
        }
      } else if (chunk.type === 'exit') {
        exitCode = chunk.code;
        if (chunk.code !== 0) {
          commandFailed = true;
        }
        // Don't break here - let the loop finish naturally to process all output
      }
    }

    // Check if this is an overload error that should be retried
    if ((commandFailed || isOverloadError) &&
        (isOverloadError ||
         (lastMessage.includes('API Error: 500') && lastMessage.includes('Overloaded')) ||
         (lastMessage.includes('api_error') && lastMessage.includes('Overloaded')))) {

      if (retryCount < maxRetries) {
        // Calculate exponential backoff delay
        const delay = baseDelay * Math.pow(2, retryCount);
        await log(`\n⚠️ API overload error detected. Retrying in ${delay / 1000} seconds...`, { level: 'warning' });
        await log(`   Error: ${lastMessage.substring(0, 200)}`, { verbose: true });

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));

        // Increment retry count and retry
        retryCount++;
        return await executeWithRetry();
      } else {
        await log(`\n\n❌ API overload error persisted after ${maxRetries} retries`, { level: 'error' });
        await log('   The API appears to be heavily loaded. Please try again later.', { level: 'error' });
        return {
          success: false,
          sessionId,
          limitReached: false,
          messageCount,
          toolUseCount
        };
      }
    }

    if (commandFailed) {
      // Check if we hit a rate limit
      if (lastMessage.includes('rate_limit_exceeded') ||
          lastMessage.includes('You have exceeded your rate limit') ||
          lastMessage.includes('rate limit')) {
        limitReached = true;
        await log('\n\n⏳ Rate limit reached. The session can be resumed later.', { level: 'warning' });

        if (sessionId) {
          await log(`📌 Session ID for resuming: ${sessionId}`);
          await log('\nTo continue when the rate limit resets, run:');
          await log(`   ${process.argv[0]} ${process.argv[1]} --auto-continue ${argv.url}`);
        }
      } else if (lastMessage.includes('context_length_exceeded')) {
        await log('\n\n❌ Context length exceeded. Try with a smaller issue or split the work.', { level: 'error' });
      } else {
        await log(`\n\n❌ Claude command failed with exit code ${exitCode}`, { level: 'error' });
        if (sessionId && !argv.resume) {
          await log(`📌 Session ID for resuming: ${sessionId}`);
          await log('\nTo resume this session, run:');
          await log(`   ${process.argv[0]} ${process.argv[1]} ${argv.url} --resume ${sessionId}`);
        }
      }
    }

    // Check if command failed
    if (commandFailed) {
      // Take resource snapshot after failure
      const resourcesAfter = await getResourceSnapshot();
      await log('\n📈 System resources after execution:', { verbose: true });
      await log(`   Memory: ${resourcesAfter.memory.split('\n')[1]}`, { verbose: true });
      await log(`   Load: ${resourcesAfter.load}`, { verbose: true });

      // If --attach-logs is enabled, ensure we attach failure logs
      if (argv.attachLogs && sessionId) {
        await log('\n📄 Attempting to attach failure logs to PR/Issue...');
        // The attach logs logic will handle this in the catch block below
      }

      return {
        success: false,
        sessionId,
        limitReached,
        messageCount,
        toolUseCount
      };
    }

    await log('\n\n✅ Claude command completed');
    await log(`📊 Total messages: ${messageCount}, Tool uses: ${toolUseCount}`);

    return {
      success: true,
      sessionId,
      limitReached,
      messageCount,
      toolUseCount
    };
  } catch (error) {
    reportError(error, {
      context: 'execute_claude',
      command: params.command,
      claudePath: params.claudePath,
      operation: 'run_claude_command'
    });
    // Check if this is an overload error in the exception
    const errorStr = error.message || error.toString();
    if ((errorStr.includes('API Error: 500') && errorStr.includes('Overloaded')) ||
        (errorStr.includes('api_error') && errorStr.includes('Overloaded'))) {

      if (retryCount < maxRetries) {
        // Calculate exponential backoff delay
        const delay = baseDelay * Math.pow(2, retryCount);
        await log(`\n⚠️ API overload error in exception. Retrying in ${delay / 1000} seconds...`, { level: 'warning' });

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));

        // Increment retry count and retry
        retryCount++;
        return await executeWithRetry();
      }
    }

    await log(`\n\n❌ Error executing Claude command: ${error.message}`, { level: 'error' });
    return {
      success: false,
      sessionId,
      limitReached,
      messageCount,
      toolUseCount
    };
  }
  }; // End of executeWithRetry function

  // Start the execution with retry logic
  return await executeWithRetry();
};


export const checkForUncommittedChanges = async (tempDir, owner, repo, branchName, $, log, autoCommit = false) => {
  // Check for uncommitted changes made by Claude
  await log('\n🔍 Checking for uncommitted changes...');
  try {
    // Check git status to see if there are any uncommitted changes
    const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;

    if (gitStatusResult.code === 0) {
      const statusOutput = gitStatusResult.stdout.toString().trim();

      if (statusOutput) {
        await log('📝 Found uncommitted changes');
        await log('Changes:');
        for (const line of statusOutput.split('\n')) {
          await log(`   ${line}`);
        }

        if (autoCommit) {
          // Auto-commit the changes if option is enabled
          await log('💾 Auto-committing changes (--auto-commit-uncommitted-changes is enabled)...');

          const addResult = await $({ cwd: tempDir })`git add -A`;
          if (addResult.code === 0) {
            const commitMessage = 'Auto-commit: Changes made by Claude during problem-solving session';
            const commitResult = await $({ cwd: tempDir })`git commit -m ${commitMessage}`;

            if (commitResult.code === 0) {
              await log('✅ Changes committed successfully');

              // Push the changes
              await log('📤 Pushing changes to remote...');
              const pushResult = await $({ cwd: tempDir })`git push origin ${branchName}`;

              if (pushResult.code === 0) {
                await log('✅ Changes pushed successfully');
              } else {
                await log(`⚠️ Warning: Could not push changes: ${pushResult.stderr?.toString().trim()}`, { level: 'warning' });
              }
            } else {
              await log(`⚠️ Warning: Could not commit changes: ${commitResult.stderr?.toString().trim()}`, { level: 'warning' });
            }
          } else {
            await log(`⚠️ Warning: Could not stage changes: ${addResult.stderr?.toString().trim()}`, { level: 'warning' });
          }
          return false; // No restart needed when auto-commit is enabled
        } else {
          // When auto-commit is disabled, trigger auto-restart
          await log('');
          await log('⚠️  IMPORTANT: Uncommitted changes detected!');
          await log('   Claude made changes that were not committed.');
          await log('');
          await log('🔄 AUTO-RESTART: Restarting Claude to handle uncommitted changes...');
          await log('   Claude will review the changes and decide what to commit.');
          await log('');
          return true; // Return true to indicate restart is needed
        }
      } else {
        await log('✅ No uncommitted changes found');
        return false; // No restart needed
      }
    } else {
      await log(`⚠️ Warning: Could not check git status: ${gitStatusResult.stderr?.toString().trim()}`, { level: 'warning' });
      return false; // No restart needed on error
    }
  } catch (gitError) {
    reportError(gitError, {
      context: 'check_uncommitted_changes',
      tempDir,
      operation: 'git_status_check'
    });
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
    return false; // No restart needed on error
  }
};