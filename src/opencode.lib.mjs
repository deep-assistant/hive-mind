#!/usr/bin/env node
// OpenCode-related utility functions

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

// Model mapping to translate aliases to full model IDs for OpenCode
export const mapModelToId = (model) => {
  const modelMap = {
    'gpt4': 'openai/gpt-4',
    'gpt4o': 'openai/gpt-4o',
    'claude': 'anthropic/claude-3-5-sonnet',
    'sonnet': 'anthropic/claude-3-5-sonnet',
    'opus': 'anthropic/claude-3-opus',
    'gemini': 'google/gemini-pro',
    'grok': 'xai/grok-code-fast-1',
    'grok-code': 'xai/grok-code-fast-1',
    'grok-code-fast-1': 'xai/grok-code-fast-1',
  };

  // Return mapped model ID if it's an alias, otherwise return as-is
  return modelMap[model] || model;
};

// Function to validate OpenCode connection
export const validateOpenCodeConnection = async (model = 'gpt4o') => {
  // Map model alias to full ID
  const mappedModel = mapModelToId(model);

  // Retry configuration
  const maxRetries = 3;
  const baseDelay = timeouts.retryBaseDelay;
  let retryCount = 0;

  const attemptValidation = async () => {
    try {
      if (retryCount === 0) {
        await log('🔍 Validating OpenCode connection...');
      } else {
        await log(`🔄 Retry attempt ${retryCount}/${maxRetries} for OpenCode validation...`);
      }

      // Check if OpenCode CLI is installed and get version
      try {
        const versionResult = await $`timeout ${Math.floor(timeouts.opencodeCli / 6000)} opencode --version`;
        if (versionResult.code === 0) {
          const version = versionResult.stdout?.toString().trim();
          if (retryCount === 0) {
            await log(`📦 OpenCode CLI version: ${version}`);
          }
        }
      } catch (versionError) {
        if (retryCount === 0) {
          await log(`⚠️  OpenCode CLI version check failed (${versionError.code}), proceeding with connection test...`);
        }
      }

      // Test basic OpenCode functionality
      // Note: opencode doesn't have --dry-run flag, so we'll just test with a simple prompt
      const testResult = await $`printf "test" | timeout ${Math.floor(timeouts.opencodeCli / 1000)} opencode run --model ${mappedModel}`;

      if (testResult.code !== 0) {
        const stderr = testResult.stderr?.toString() || '';
        const stdout = testResult.stdout?.toString() || '';

        if (stderr.includes('auth') || stderr.includes('login')) {
          await log(`❌ OpenCode authentication failed`, { level: 'error' });
          await log('   💡 Please run: opencode auth', { level: 'error' });
          return false;
        }

        await log(`❌ OpenCode validation failed with exit code ${testResult.code}`, { level: 'error' });
        if (stderr) await log(`   Error: ${stderr.trim()}`, { level: 'error' });
        return false;
      }

      // Success
      await log('✅ OpenCode connection validated successfully');
      return true;
    } catch (error) {
      await log(`❌ Failed to validate OpenCode connection: ${error.message}`, { level: 'error' });
      await log('   💡 Make sure OpenCode CLI is installed and accessible', { level: 'error' });
      return false;
    }
  };

  // Start the validation
  return await attemptValidation();
};

// Function to handle OpenCode runtime switching (if applicable)
export const handleOpenCodeRuntimeSwitch = async (argv) => {
  // OpenCode is typically run as a CLI tool, runtime switching may not be applicable
  // This function can be used for any runtime-specific configurations if needed
  await log('ℹ️  OpenCode runtime handling not required for this operation');
};

// Main function to execute OpenCode with prompts and settings
export const executeOpenCode = async (params) => {
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
    opencodePath = 'opencode',
    $
  } = params;

  // Import prompt building functions from opencode.prompts.lib.mjs
  const { buildUserPrompt, buildSystemPrompt } = await import('./opencode.prompts.lib.mjs');

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

  // Execute the OpenCode command
  return await executeOpenCodeCommand({
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
    opencodePath,
    $
  });
};

export const executeOpenCodeCommand = async (params) => {
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
    opencodePath,
    $
  } = params;

  // Retry configuration
  const maxRetries = 3;
  const baseDelay = timeouts.retryBaseDelay;
  let retryCount = 0;

  const executeWithRetry = async () => {
    // Execute opencode command from the cloned repository directory
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing OpenCode:', argv.model.toUpperCase())}`);
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

    // Build OpenCode command
    let execCommand;

    // Map model alias to full ID
    const mappedModel = mapModelToId(argv.model);

    // Build opencode command arguments
    let opencodeArgs = `run --model ${mappedModel}`;

    if (argv.resume) {
      await log(`🔄 Resuming from session: ${argv.resume}`);
      opencodeArgs = `run --resume ${argv.resume} --model ${mappedModel}`;
    }

    // For OpenCode, we pass the prompt via stdin
    // The system prompt is typically not supported separately in opencode
    // We'll combine system and user prompts into a single message
    const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

    // Write the combined prompt to a file for piping
    const promptFile = path.join(tempDir, 'opencode_prompt.txt');
    await fs.writeFile(promptFile, combinedPrompt);

    // Build the full command - pipe the prompt file to opencode
    const fullCommand = `(cd "${tempDir}" && cat "${promptFile}" | ${opencodePath} ${opencodeArgs})`;

    await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
    await log(`${fullCommand}`);
    await log('');

    try {
      // Pipe the prompt file to opencode via stdin
      if (argv.resume) {
        execCommand = $({
          cwd: tempDir,
          mirror: false
        })`cat ${promptFile} | ${opencodePath} run --resume ${argv.resume} --model ${mappedModel}`;
      } else {
        execCommand = $({
          cwd: tempDir,
          mirror: false
        })`cat ${promptFile} | ${opencodePath} run --model ${mappedModel}`;
      }

      await log(`${formatAligned('📋', 'Command details:', '')}`);
      await log(formatAligned('📂', 'Working directory:', tempDir, 2));
      await log(formatAligned('🌿', 'Branch:', branchName, 2));
      await log(formatAligned('🤖', 'Model:', `OpenCode ${argv.model.toUpperCase()}`, 2));
      if (argv.fork && forkedRepo) {
        await log(formatAligned('🍴', 'Fork:', forkedRepo, 2));
      }

      await log(`\n${formatAligned('▶️', 'Streaming output:', '')}\n`);

      let exitCode = 0;
      let sessionId = null;
      let limitReached = false;
      let messageCount = 0;
      let toolUseCount = 0;
      let lastMessage = '';
      let stderrErrors = [];

      for await (const chunk of execCommand.stream()) {
        if (chunk.type === 'stdout') {
          const output = chunk.data.toString();
          await log(output);
          lastMessage = output;
        }

        if (chunk.type === 'stderr') {
          const errorOutput = chunk.data.toString();
          if (errorOutput) {
            await log(errorOutput, { stream: 'stderr' });
            const trimmed = errorOutput.trim();
            if (trimmed && (trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed'))) {
              stderrErrors.push(trimmed);
            }
          }
        } else if (chunk.type === 'exit') {
          exitCode = chunk.code;
        }
      }

      if (exitCode !== 0) {
        if (lastMessage.includes('rate_limit') || lastMessage.includes('limit')) {
          limitReached = true;
          await log('\n\n⏳ Rate limit reached.', { level: 'warning' });
        } else {
          await log(`\n\n❌ OpenCode command failed with exit code ${exitCode}`, { level: 'error' });
        }
      }

      // Check for additional failure detection
      if (!exitCode && stderrErrors.length > 0 && messageCount === 0 && toolUseCount === 0) {
        await log('\n\n❌ Command failed: No output processed and errors detected in stderr', { level: 'error' });
        for (const err of stderrErrors.slice(0, 5)) {
          await log(`   ${err.substring(0, 200)}`, { level: 'error' });
        }
        exitCode = 1;
      }

      if (exitCode !== 0) {
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

      await log('\n\n✅ OpenCode command completed');

      return {
        success: true,
        sessionId,
        limitReached,
        messageCount,
        toolUseCount
      };
    } catch (error) {
      reportError(error, {
        context: 'execute_opencode',
        command: params.command,
        opencodePath: params.opencodePath,
        operation: 'run_opencode_command'
      });

      await log(`\n\n❌ Error executing OpenCode command: ${error.message}`, { level: 'error' });
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
  // Similar to Claude version, check for uncommitted changes
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
            const commitMessage = 'Auto-commit: Changes made by OpenCode during problem-solving session';
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
          await log('   OpenCode made changes that were not committed.');
          await log('');
          await log('🔄 AUTO-RESTART: Restarting OpenCode to handle uncommitted changes...');
          await log('   OpenCode will review the changes and decide what to commit.');
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
      context: 'check_uncommitted_changes_opencode',
      tempDir,
      operation: 'git_status_check'
    });
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
    return false;
  }
};

// Export all functions as default object too
export default {
  validateOpenCodeConnection,
  handleOpenCodeRuntimeSwitch,
  executeOpenCode,
  executeOpenCodeCommand,
  checkForUncommittedChanges
};