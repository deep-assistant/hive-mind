#!/usr/bin/env node

/**
 * Generate minimal prompt for auto-restart with session resume
 * This module provides functions to create lightweight prompts for auto-restart
 * that assume the AI has full context from the previous session
 *
 * Part of the cost optimization feature for issue #661
 * @see case-studies/issue-661-session-resume-cost-optimization/
 */

// Note: This module does not import $ directly
// Functions receive $ as a parameter from the calling module
// This ensures consistent command executor usage across the codebase

/**
 * Generate minimal prompt for auto-restart with session resume
 * This prompt assumes the AI has full context from the previous session
 * Target: ~500 tokens (compared to 50k-200k in full context)
 *
 * @param {string} tempDir - Working directory
 * @param {object} $ - Command executor
 * @returns {Promise<string>} Minimal restart prompt
 */
export const generateMinimalRestartPrompt = async (tempDir, $) => {
  // Get uncommitted changes
  const gitStatus = await $({ cwd: tempDir })`git status --porcelain`;
  const uncommittedFiles = gitStatus.stdout.toString().trim();

  // Get brief diff summary (not full diff to keep it minimal)
  const gitDiffStat = await $({ cwd: tempDir })`git diff --stat`;
  const diffSummary = gitDiffStat.stdout.toString().trim();

  // Count changes
  const fileCount = uncommittedFiles.split('\n').filter(line => line.trim()).length;

  return `🔄 Auto-restart: Previous session completed with uncommitted changes.

Uncommitted files (${fileCount}):
${uncommittedFiles}

Changes summary:
${diffSummary}

Please review these changes and commit them with an appropriate commit message.
Follow the repository's commit message conventions from previous commits.`;
};

/**
 * Generate full context prompt (fallback when resume fails or not enabled)
 * This is used when session resume is not available or failed
 *
 * @param {string} issueUrl - Issue URL
 * @param {string} issueBody - Issue description
 * @param {number} prNumber - PR number
 * @param {Array<string>} feedbackLines - Feedback from reviewers
 * @param {string} tempDir - Working directory
 * @param {object} $ - Command executor
 * @returns {Promise<string>} Full restart prompt
 */
export const generateFullRestartPrompt = async (
  issueUrl,
  issueBody,
  prNumber,
  feedbackLines,
  tempDir,
  $
) => {
  // Get uncommitted changes with full diff
  const gitStatus = await $({ cwd: tempDir })`git status --porcelain`;
  const uncommittedFiles = gitStatus.stdout.toString().trim();

  const gitDiff = await $({ cwd: tempDir })`git diff`;
  const fullDiff = gitDiff.stdout.toString();

  let prompt = `
Continuing work on issue: ${issueUrl}

Previous session completed but left uncommitted changes.
  `.trim();

  if (feedbackLines && feedbackLines.length > 0) {
    prompt += `\n\nFeedback from reviewers:\n${feedbackLines.join('\n')}`;
  }

  prompt += `\n\nUncommitted changes:\n${uncommittedFiles}\n\nFull diff:\n${fullDiff}`;

  prompt += '\n\nPlease review these changes and commit them appropriately.';

  return prompt;
};
