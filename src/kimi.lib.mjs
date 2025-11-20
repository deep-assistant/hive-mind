#!/usr/bin/env node
// Kimi CLI-related utility functions

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;

// Import log from general lib
import { log } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { timeouts } from './config.lib.mjs';

// Model mapping to translate aliases to full model IDs for Kimi CLI
// Based on Kimi CLI documentation, it uses model identifiers
export const mapModelToId = (model) => {
  const modelMap = {
    'moonshot': 'moonshot-v1',
    'moonshot-v1': 'moonshot-v1',
    'kimi': 'moonshot-v1',
  };

  // Return mapped model ID if it's an alias, otherwise return as-is
  return modelMap[model] || model;
};

// Function to validate Kimi CLI connection
export const validateKimiConnection = async (model = 'moonshot-v1') => {
  // Map model alias to full ID
  const mappedModel = mapModelToId(model);

  // Retry configuration
  const maxRetries = 3;
  let retryCount = 0;

  const attemptValidation = async () => {
    try {
      if (retryCount === 0) {
        await log('🔍 Validating Kimi CLI connection...');
      } else {
        await log(`🔄 Retry attempt ${retryCount}/${maxRetries} for Kimi CLI validation...`);
      }

      // Check if Kimi CLI is installed and get version
      try {
        const versionResult = await $`timeout ${Math.floor(timeouts.kimiCli / 1000)} kimi --version`;
        if (versionResult.code === 0) {
          const version = versionResult.stdout?.toString().trim();
          if (retryCount === 0) {
            await log(`📦 Kimi CLI version: ${version}`);
          }
        }
      } catch (versionError) {
        if (retryCount === 0) {
          await log(`⚠️  Kimi CLI version check failed (${versionError.code}), proceeding with connection test...`);
        }
      }

      // Test basic Kimi functionality with a simple "hi" message
      // Kimi CLI requires /setup to be run first, so we check if it's configured
      const testResult = await $`printf "hi" | timeout ${Math.floor(timeouts.kimiCli / 1000)} kimi`;

      if (testResult.code !== 0) {
        const stderr = testResult.stderr?.toString() || '';
        const stdout = testResult.stdout?.toString() || '';

        // Check for authentication or setup errors
        if (stderr.includes('setup') || stdout.includes('setup') ||
            stderr.includes('configuration') || stdout.includes('configuration')) {
          await log('❌ Kimi CLI not configured', { level: 'error' });
          await log('   💡 Please run: kimi', { level: 'error' });
          await log('   💡 Then send: /setup', { level: 'error' });
          return false;
        }

        if (stderr.includes('auth') || stderr.includes('login') ||
            stdout.includes('Not logged in') || stdout.includes('authentication')) {
          await log('❌ Kimi authentication failed', { level: 'error' });
          await log('   💡 Please configure authentication in Kimi CLI', { level: 'error' });
          return false;
        }

        await log(`❌ Kimi validation failed with exit code ${testResult.code}`, { level: 'error' });
        if (stderr) await log(`   Error: ${stderr.trim()}`, { level: 'error' });
        if (stdout && !stderr) await log(`   Output: ${stdout.trim()}`, { level: 'error' });
        return false;
      }

      // Success
      await log('✅ Kimi CLI connection validated successfully');
      return true;
    } catch (error) {
      await log(`❌ Failed to validate Kimi CLI connection: ${error.message}`, { level: 'error' });
      await log('   💡 Make sure Kimi CLI is installed and accessible', { level: 'error' });
      await log('   💡 Install with: uv tool install --python 3.13 kimi-cli', { level: 'error' });
      return false;
    }
  };

  // Start the validation
  return await attemptValidation();
};

// Function to handle Kimi CLI runtime switching (if applicable)
export const handleKimiRuntimeSwitch = async () => {
  // Kimi is typically run as a CLI tool, runtime switching may not be applicable
  // This function can be used for any runtime-specific configurations if needed
  await log('ℹ️  Kimi runtime handling not required for this operation');
};

// Main function to execute Kimi with prompts and settings
export const executeKimi = async (params) => {
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
    formatAligned,
    getResourceSnapshot,
    kimiPath = 'kimi',
    $
  } = params;

  // Import prompt building functions from kimi.prompts.lib.mjs
  const { buildUserPrompt, buildSystemPrompt } = await import('./kimi.prompts.lib.mjs');

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

  // Execute the Kimi command
  return await executeKimiCommand({
    tempDir,
    branchName,
    prompt,
    systemPrompt,
    argv,
    log,
    formatAligned,
    getResourceSnapshot,
    forkedRepo,
    feedbackLines,
    kimiPath,
    $
  });
};

export const executeKimiCommand = async (params) => {
  const {
    tempDir,
    branchName,
    prompt,
    systemPrompt,
    argv,
    log,
    formatAligned,
    getResourceSnapshot,
    forkedRepo,
    feedbackLines,
    kimiPath,
    $
  } = params;

  // Retry configuration
  const maxRetries = 3;
  let retryCount = 0;

  const executeWithRetry = async () => {
    // Execute kimi command from the cloned repository directory
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing Kimi CLI:', argv.model.toUpperCase())}`);
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

    // Map model alias to full ID
    const mappedModel = mapModelToId(argv.model);

    // Kimi CLI works interactively, so we'll pass prompts via stdin
    // Create a task file that Kimi can read
    const taskFile = path.join(tempDir, 'CLAUDE.md');

    // Combine system and user prompts into the task file
    const taskContent = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
    await fs.writeFile(taskFile, taskContent);

    // Build the command to launch Kimi in the working directory
    // Kimi will automatically detect the working directory
    const fullCommand = `(cd "${tempDir}" && echo "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" | ${kimiPath})`;

    await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
    await log(`${fullCommand}`);
    await log('');

    try {
      // Write prompt to a file for piping
      const promptFile = path.join(tempDir, 'kimi_prompt.txt');
      await fs.writeFile(promptFile, prompt);

      // Launch Kimi CLI with the prompt piped in
      const execCommand = $({
        cwd: tempDir,
        mirror: false
      })`cat ${promptFile} | ${kimiPath}`;

      await log(`${formatAligned('📋', 'Command details:', '')}`);
      await log(formatAligned('📂', 'Working directory:', tempDir, 2));
      await log(formatAligned('🌿', 'Branch:', branchName, 2));
      await log(formatAligned('🤖', 'Model:', `Kimi ${argv.model.toUpperCase()}`, 2));
      if (argv.fork && forkedRepo) {
        await log(formatAligned('🍴', 'Fork:', forkedRepo, 2));
      }

      await log(`\n${formatAligned('▶️', 'Streaming output:', '')}\n`);

      let exitCode = 0;
      let sessionId = null;
      let limitReached = false;
      let lastMessage = '';

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
          await log(`\n\n❌ Kimi CLI command failed with exit code ${exitCode}`, { level: 'error' });
        }

        const resourcesAfter = await getResourceSnapshot();
        await log('\n📈 System resources after execution:', { verbose: true });
        await log(`   Memory: ${resourcesAfter.memory.split('\n')[1]}`, { verbose: true });
        await log(`   Load: ${resourcesAfter.load}`, { verbose: true });

        return {
          success: false,
          sessionId,
          limitReached
        };
      }

      await log('\n\n✅ Kimi CLI command completed');

      return {
        success: true,
        sessionId,
        limitReached
      };
    } catch (error) {
      reportError(error, {
        context: 'execute_kimi',
        command: params.command,
        kimiPath: params.kimiPath,
        operation: 'run_kimi_command'
      });

      await log(`\n\n❌ Error executing Kimi CLI command: ${error.message}`, { level: 'error' });
      return {
        success: false,
        sessionId: null,
        limitReached: false
      };
    }
  };

  // Start the execution with retry logic
  return await executeWithRetry();
};

export const checkForUncommittedChanges = async (tempDir, owner, repo, branchName, $, log, autoCommit = false, autoRestartEnabled = true) => {
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
            const commitMessage = 'Auto-commit: Changes made by Kimi CLI during problem-solving session';
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
        } else if (autoRestartEnabled) {
          await log('');
          await log('⚠️  IMPORTANT: Uncommitted changes detected!');
          await log('   Kimi CLI made changes that were not committed.');
          await log('');
          await log('🔄 AUTO-RESTART: Restarting Kimi CLI to handle uncommitted changes...');
          await log('   Kimi will review the changes and decide what to commit.');
          await log('');
          return true;
        } else {
          await log('');
          await log('⚠️  Uncommitted changes detected but auto-restart is disabled.');
          await log('   Use --auto-restart-on-uncommitted-changes to enable or commit manually.');
          await log('');
          return false;
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
      context: 'check_uncommitted_changes_kimi',
      tempDir,
      operation: 'git_status_check'
    });
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
    return false;
  }
};

// Export all functions as default object too
export default {
  validateKimiConnection,
  handleKimiRuntimeSwitch,
  executeKimi,
  executeKimiCommand,
  checkForUncommittedChanges,
  mapModelToId
};
