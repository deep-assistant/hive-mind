/**
 * Claude execution module for solve.mjs
 * Handles the actual execution of Claude commands and processing of output
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Build the system prompt for Claude - simplified to avoid shell escaping issues
 * @param {Object} params - Parameters for building the prompt
 * @returns {string} The formatted system prompt
 */
export const buildSystemPrompt = (params) => {
  const { owner, repo, issueNumber, prNumber, branchName } = params;

  // Use backticks for jq commands to avoid quote escaping issues
  return `You are AI issue solver.

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
    formatAligned,
    getResourceSnapshot,
    forkedRepo,
    feedbackLines,
    claudePath,
    $  // Add command-stream $ to params
  } = params;

  // Execute claude command from the cloned repository directory
  await log(`\n${formatAligned('🤖', 'Executing Claude:', argv.model.toUpperCase())}`);

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

  // Build claude command with optional resume flag
  let execCommand;

  try {
    if (argv.resume) {
      await log(`🔄 Resuming from session: ${argv.resume}`);
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

    // Print the command being executed (with cd for reproducibility)
    await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
    if (argv.resume) {
      await log(`(cd "${tempDir}" && ${claudePath} --resume ${argv.resume} --output-format stream-json --verbose --dangerously-skip-permissions --model ${argv.model} -p '...' --append-system-prompt '...')\n`);
    } else {
      await log(`(cd "${tempDir}" && echo '...' | ${claudePath} --output-format stream-json --verbose --dangerously-skip-permissions --model ${argv.model} --append-system-prompt '...')\n`);
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

            // Capture session ID from the first message
            if (!sessionId && data.session_id) {
              sessionId = data.session_id;
              await log(`📌 Session ID: ${sessionId}`, { verbose: true });
            }

            // Track message and tool use counts
            if (data.type === 'message') {
              messageCount++;
            } else if (data.type === 'tool_use') {
              toolUseCount++;
            }

            // Format the output nicely
            if (data.type === 'text') {
              // Text from assistant
              if (data.text) {
                await log(data.text, { stream: 'claude' });
                lastMessage = data.text;
              }
            } else if (data.type === 'tool_use' && data.name) {
              // Tool use - show a concise summary
              await log(`🔧 Using tool: ${data.name}`, { stream: 'tool', verbose: true });

              // For key tools, show their input in verbose mode
              if (argv.verbose && data.input) {
                if (data.name === 'bash' && data.input.command) {
                  await log(`   $ ${data.input.command}`, { stream: 'tool-detail', verbose: true });
                } else if (data.name === 'write' && data.input.path) {
                  await log(`   Writing to: ${data.input.path}`, { stream: 'tool-detail', verbose: true });
                } else if (data.name === 'read' && data.input.path) {
                  await log(`   Reading: ${data.input.path}`, { stream: 'tool-detail', verbose: true });
                }
              }
            } else if (data.type === 'tool_result' && argv.verbose) {
              // Tool result in verbose mode - show if it's an error
              if (data.error) {
                await log(`   ⚠️  Tool error: ${data.error}`, { stream: 'tool-error', verbose: true });
              } else if (data.output && data.output.length < 200) {
                // Only show short outputs in verbose mode
                const output = data.output.replace(/\n/g, '\n   ');
                await log(`   Result: ${output}`, { stream: 'tool-result', verbose: true });
              }
            } else if (data.type === 'error') {
              // Error from Claude
              await log(`❌ Error: ${data.error || JSON.stringify(data)}`, { stream: 'error', level: 'error' });
              lastMessage = data.error || JSON.stringify(data);
            } else if (data.type === 'message' && data.role === 'assistant' && argv.verbose) {
              // Message metadata
              await log(`📨 Message ${messageCount} from assistant`, { stream: 'meta', verbose: true });
            }

          } catch {
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
    await log(`\n\n❌ Error executing Claude command: ${error.message}`, { level: 'error' });
    return {
      success: false,
      sessionId,
      limitReached,
      messageCount,
      toolUseCount
    };
  }
};


export const checkForUncommittedChanges = async (tempDir, owner, repo, branchName, $, log) => {
  // Check for and commit any uncommitted changes made by Claude
  await log('\n🔍 Checking for uncommitted changes...');
  try {
    // Check git status to see if there are any uncommitted changes
    const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;

    if (gitStatusResult.code === 0) {
      const statusOutput = gitStatusResult.stdout.toString().trim();

      if (statusOutput) {
        await log('📝 Found uncommitted changes');
        await log('Changes:', { verbose: true });
        for (const line of statusOutput.split('\n')) {
          await log(`   ${line}`, { verbose: true });
        }

        // Auto-commit the changes
        await log('💾 Committing changes automatically...');

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
      } else {
        await log('✅ No uncommitted changes found');
      }
    } else {
      await log(`⚠️ Warning: Could not check git status: ${gitStatusResult.stderr?.toString().trim()}`, { level: 'warning' });
    }
  } catch (gitError) {
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
  }
};