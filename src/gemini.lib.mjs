#!/usr/bin/env node
// Gemini CLI-related utility functions

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;

// Import log from general lib
import { log, cleanErrorMessage } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { timeouts, retryLimits } from './config.lib.mjs';

// Model mapping to translate aliases to full model IDs for Gemini
export const mapModelToId = (model) => {
  const modelMap = {
    'flash': 'gemini-2.0-flash-exp',
    'pro': 'gemini-2.0-pro-exp',
    'thinking': 'gemini-2.0-flash-thinking-exp',
  };

  // Return mapped model ID if it's an alias, otherwise return as-is
  return modelMap[model] || model;
};

// Function to validate Gemini CLI connection
export const validateGeminiConnection = async (model = 'flash') => {
  // Map model alias to full ID
  const mappedModel = mapModelToId(model);

  // Retry configuration
  const maxRetries = 3;
  const baseDelay = timeouts.retryBaseDelay;
  let retryCount = 0;

  const attemptValidation = async () => {
    try {
      if (retryCount === 0) {
        await log('🔍 Validating Gemini CLI connection...');
      } else {
        await log(`🔄 Retry attempt ${retryCount}/${maxRetries} for Gemini CLI validation...`);
      }

      // Check if Gemini CLI is installed and get version
      try {
        const versionResult = await $`timeout ${Math.floor(timeouts.geminiCli / 1000)} gemini --version`;
        if (versionResult.code === 0) {
          const version = versionResult.stdout?.toString().trim();
          if (retryCount === 0) {
            await log(`📦 Gemini CLI version: ${version}`);
          }
        }
      } catch (versionError) {
        if (retryCount === 0) {
          await log(`⚠️  Gemini CLI version check failed (${versionError.code}), proceeding with connection test...`);
        }
      }

      // Test basic Gemini functionality with a simple "hi" message using JSON output
      // Use JSON format to detect errors properly
      let testResult;
      try {
        testResult = await $`printf "hi" | timeout ${Math.floor(timeouts.geminiCli / 1000)} gemini -p "say hi" --output-format json --model ${mappedModel}`;
      } catch (error) {
        // Handle timeout or execution errors
        if (error.code === 124) {
          await log(`❌ Gemini CLI timed out after ${Math.floor(timeouts.geminiCli / 1000)} seconds`, { level: 'error' });
          return false;
        }
        throw error;
      }

      const stdout = testResult.stdout?.toString() || '';
      const stderr = testResult.stderr?.toString() || '';

      // Check for JSON error in stdout
      let jsonError = null;
      if (stdout.includes('"error"')) {
        try {
          const jsonMatch = stdout.match(/\{.*"error".*\}/s);
          if (jsonMatch) {
            const errorObj = JSON.parse(jsonMatch[0]);
            jsonError = errorObj.error;
          }
        } catch (e) {
          // Not valid JSON, continue with other checks
          if (global.verboseMode) {
            reportError(e, {
              context: 'gemini_json_error_parse',
              level: 'debug'
            });
          }
        }
      }

      if (testResult.code !== 0 || jsonError) {
        if (jsonError) {
          await log(`❌ Gemini CLI authentication or configuration failed: ${jsonError.type} - ${jsonError.message}`, { level: 'error' });

          if (jsonError.type === 'ProjectIdRequiredError') {
            await log('   💡 Please set GOOGLE_CLOUD_PROJECT environment variable', { level: 'error' });
            await log('   💡 See: https://goo.gle/gemini-cli-auth-docs#workspace-gca', { level: 'error' });
          } else if (stderr.includes('auth') || stderr.includes('login') || jsonError.type === 'forbidden') {
            await log('   💡 Please authenticate with: gemini auth', { level: 'error' });
          }
        } else {
          await log(`❌ Gemini CLI validation failed with exit code ${testResult.code}`, { level: 'error' });
          if (stderr) await log(`   Error: ${stderr.trim()}`, { level: 'error' });

          if (stderr.includes('auth') || stderr.includes('login')) {
            await log('   💡 Please authenticate with: gemini auth', { level: 'error' });
          }
        }
        return false;
      }

      // Success
      await log('✅ Gemini CLI connection validated successfully');
      return true;
    } catch (error) {
      await log(`❌ Failed to validate Gemini CLI connection: ${error.message}`, { level: 'error' });
      await log('   💡 Make sure Gemini CLI is installed and accessible', { level: 'error' });
      return false;
    }
  };

  // Start the validation
  return await attemptValidation();
};

// Function to handle Gemini runtime switching (if applicable)
export const handleGeminiRuntimeSwitch = async (argv) => {
  // Gemini is typically run as a CLI tool, runtime switching may not be applicable
  // This function can be used for any runtime-specific configurations if needed
  await log('ℹ️  Gemini runtime handling not required for this operation');
};

// Main function to execute Gemini with prompts and settings
export const executeGemini = async (params) => {
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
    geminiPath = 'gemini',
    $
  } = params;

  // Import prompt building functions from gemini.prompts.lib.mjs
  const { buildUserPrompt, buildSystemPrompt } = await import('./gemini.prompts.lib.mjs');

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
    prNumber,
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

  // Execute the Gemini command
  return await executeGeminiCommand({
    tempDir,
    branchName,
    prompt,
    systemPrompt,
    argv,
    log,
    setLogFile,
    getLogFile,
    formatAligned,
    getResourceSnapshot,
    forkedRepo,
    feedbackLines,
    geminiPath,
    $
  });
};

export const executeGeminiCommand = async (params) => {
  const {
    tempDir,
    branchName,
    prompt,
    systemPrompt,
    argv,
    log,
    setLogFile,
    getLogFile,
    formatAligned,
    getResourceSnapshot,
    forkedRepo,
    feedbackLines,
    geminiPath,
    $
  } = params;

  // Retry configuration
  const maxRetries = 3;
  const baseDelay = timeouts.retryBaseDelay;
  let retryCount = 0;

  const executeWithRetry = async () => {
    // Execute gemini command from the cloned repository directory
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing Gemini:', argv.model.toUpperCase())}`);
    } else {
      await log(`\n${formatAligned('🔄', 'Retry attempt:', `${retryCount}/${maxRetries}`)}`);
    }

    if (argv.verbose) {
      await log(`   Model: ${argv.model}`, { verbose: true });
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

    // Build Gemini command
    let execCommand;

    // Map model alias to full ID
    const mappedModel = mapModelToId(argv.model);

    // Build gemini command arguments
    let geminiArgs = `--output-format json --model ${mappedModel}`;

    // Note: Gemini CLI doesn't have built-in resume functionality like Claude
    // We'll note this in verbose mode
    if (argv.resume) {
      await log('⚠️  Gemini CLI does not support session resume functionality', { level: 'warning' });
      await log('   Ignoring --resume flag', { level: 'warning' });
    }

    // For Gemini, we combine system and user prompts into a single message
    // System prompt is typically passed as part of the conversation context
    const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

    // Write the combined prompt to a file for piping
    const promptFile = path.join(tempDir, 'gemini_prompt.txt');
    await fs.writeFile(promptFile, combinedPrompt);

    // Build the full command - pipe the prompt file to gemini
    const fullCommand = `(cd "${tempDir}" && cat "${promptFile}" | ${geminiPath} ${geminiArgs})`;

    await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
    await log(`${fullCommand}`);
    await log('');

    try {
      // Pipe the prompt file to gemini via stdin
      execCommand = $({
        cwd: tempDir,
        mirror: false
      })`cat ${promptFile} | ${geminiPath} --output-format json --model ${mappedModel}`;

      await log(`${formatAligned('📋', 'Command details:', '')}`);
      await log(formatAligned('📂', 'Working directory:', tempDir, 2));
      await log(formatAligned('🌿', 'Branch:', branchName, 2));
      await log(formatAligned('🤖', 'Model:', `Gemini ${argv.model.toUpperCase()}`, 2));
      if (argv.fork && forkedRepo) {
        await log(formatAligned('🍴', 'Fork:', forkedRepo, 2));
      }

      await log(`\n${formatAligned('▶️', 'Streaming output:', '')}\n`);

      let exitCode = 0;
      let sessionId = null;
      let limitReached = false;
      let lastMessage = '';
      let commandFailed = false;
      let messageCount = 0;
      let toolUseCount = 0;

      for await (const chunk of execCommand.stream()) {
        if (chunk.type === 'stdout') {
          const output = chunk.data.toString();

          // Try to parse JSON output
          const lines = output.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const data = JSON.parse(line);

              // Log formatted JSON
              await log(JSON.stringify(data, null, 2));

              // Track messages and tool usage if available
              if (data.type === 'message') {
                messageCount++;
              } else if (data.type === 'tool_use') {
                toolUseCount++;
              }

              // Check for errors
              if (data.error) {
                lastMessage = JSON.stringify(data.error);
                commandFailed = true;
              }

              // Store last message
              if (data.content || data.text) {
                lastMessage = data.content || data.text;
              }
            } catch (parseError) {
              // Not JSON or parsing failed, output as-is
              if (line.trim()) {
                await log(line);
                lastMessage = line;
              }
            }
          }
        }

        if (chunk.type === 'stderr') {
          const errorOutput = chunk.data.toString();
          if (errorOutput) {
            await log(errorOutput, { stream: 'stderr' });
          }
        } else if (chunk.type === 'exit') {
          exitCode = chunk.code;
          if (chunk.code !== 0) {
            commandFailed = true;
          }
        }
      }

      if (commandFailed || exitCode !== 0) {
        if (lastMessage.includes('rate_limit') || lastMessage.includes('limit')) {
          limitReached = true;
          await log('\n\n⏳ Rate limit reached.', { level: 'warning' });
        } else {
          await log(`\n\n❌ Gemini command failed with exit code ${exitCode}`, { level: 'error' });
        }

        const resourcesAfter = await getResourceSnapshot();
        await log('\n📈 System resources after execution:', { verbose: true });
        await log(`   Memory: ${resourcesAfter.memory.split('\n')[1]}`, { verbose: true });
        await log(`   Load: ${resourcesAfter.load}`, { verbose: true });

        return {
          success: false,
          sessionId,
          limitReached,
          messageCount,
          toolUseCount
        };
      }

      await log('\n\n✅ Gemini command completed');
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
        context: 'execute_gemini',
        command: params.command,
        geminiPath: params.geminiPath,
        operation: 'run_gemini_command'
      });

      await log(`\n\n❌ Error executing Gemini command: ${error.message}`, { level: 'error' });
      return {
        success: false,
        sessionId: null,
        limitReached: false,
        messageCount: 0,
        toolUseCount: 0
      };
    }
  };

  // Start the execution with retry logic
  return await executeWithRetry();
};

export const checkForUncommittedChanges = async (tempDir, owner, repo, branchName, $, log, autoCommit = false) => {
  // Similar to Claude and OpenCode version, check for uncommitted changes
  await log('\n🔍 Checking for uncommitted changes...');
  try {
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
          await log('💾 Auto-committing changes (--auto-commit-uncommitted-changes is enabled)...');

          const addResult = await $({ cwd: tempDir })`git add -A`;
          if (addResult.code === 0) {
            const commitMessage = 'Auto-commit: Changes made by Gemini during problem-solving session';
            const commitResult = await $({ cwd: tempDir })`git commit -m ${commitMessage}`;

            if (commitResult.code === 0) {
              await log('✅ Changes committed successfully');

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
          return false;
        } else {
          await log('');
          await log('⚠️  IMPORTANT: Uncommitted changes detected!');
          await log('   Gemini made changes that were not committed.');
          await log('');
          await log('🔄 AUTO-RESTART: Restarting Gemini to handle uncommitted changes...');
          await log('   Gemini will review the changes and decide what to commit.');
          await log('');
          return true;
        }
      } else {
        await log('✅ No uncommitted changes found');
        return false;
      }
    } else {
      await log(`⚠️ Warning: Could not check git status: ${gitStatusResult.stderr?.toString().trim()}`, { level: 'warning' });
      return false;
    }
  } catch (gitError) {
    reportError(gitError, {
      context: 'check_uncommitted_changes_gemini',
      tempDir,
      operation: 'git_status_check'
    });
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
    return false;
  }
};

// Export all functions as default object too
export default {
  validateGeminiConnection,
  handleGeminiRuntimeSwitch,
  executeGemini,
  executeGeminiCommand,
  checkForUncommittedChanges
};
