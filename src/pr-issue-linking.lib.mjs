#!/usr/bin/env node

/**
 * PR-Issue Linking Library
 *
 * Shared utilities for ensuring pull requests are properly linked to issues
 * using GitHub's reserved keywords (fixes, closes, resolves).
 *
 * This library is used by:
 * - solve.results.lib.mjs: Post-completion PR verification and repair
 * - pr-issue-link-auto-correction.lib.mjs: Real-time PR monitoring (experimental)
 */

// Import GitHub linking detection
import { hasGitHubLinkingKeyword } from './github-linking.lib.mjs';

/**
 * Check if PR body has proper issue linking and repair if necessary
 *
 * @param {Object} params - Parameters object
 * @param {number|string} params.prNumber - Pull request number
 * @param {string} params.owner - Repository owner
 * @param {string} params.repo - Repository name
 * @param {number|string} params.issueNumber - Issue number to link
 * @param {boolean} params.isFork - Whether PR is from a fork
 * @param {Function} params.$ - Command execution function (from command-stream)
 * @param {Function} params.log - Logging function
 * @param {Function} params.use - Module loader function
 * @param {boolean} [params.verbose=false] - Enable verbose logging
 * @returns {Promise<{wasUpdated: boolean, hadLinking: boolean}>} Result of the check/repair
 */
export async function ensurePRIssueLinking({
  prNumber,
  owner,
  repo,
  issueNumber,
  isFork,
  $,
  log,
  use,
  verbose = false
}) {
  // Get PR body
  const prBodyResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json body --jq .body`;

  if (prBodyResult.code !== 0) {
    if (verbose) {
      await log(`  ⚠️  Could not fetch PR body: ${prBodyResult.stderr?.toString() || 'unknown error'}`, { verbose: true });
    }
    return { wasUpdated: false, hadLinking: false };
  }

  const prBody = prBodyResult.stdout.toString();
  const issueRef = isFork ? `${owner}/${repo}#${issueNumber}` : `#${issueNumber}`;

  // Check if PR body has GitHub linking keywords
  const hasLinkingKeyword = hasGitHubLinkingKeyword(
    prBody,
    issueNumber,
    isFork ? owner : null,
    isFork ? repo : null
  );

  if (hasLinkingKeyword) {
    if (verbose) {
      await log('  ✅ PR body already contains valid issue linking keyword', { verbose: true });
    }
    return { wasUpdated: false, hadLinking: true };
  }

  // PR body doesn't have proper linking - add it
  if (verbose) {
    await log(`  📝 Updating PR body to link issue ${issueRef}...`, { verbose: true });
  }

  // Add proper issue reference with separator
  const linkingText = `\n\n---\n\nResolves ${issueRef}`;
  const updatedBody = prBody + linkingText;

  // Use --body-file to avoid command-line length limits and escaping issues
  const fs = (await use('fs')).promises;
  const tempBodyFile = `/tmp/pr-body-update-${prNumber}-${Date.now()}.md`;
  await fs.writeFile(tempBodyFile, updatedBody);

  try {
    const updateResult = await $`gh pr edit ${prNumber} --repo ${owner}/${repo} --body-file "${tempBodyFile}"`;

    // Clean up temp file
    await fs.unlink(tempBodyFile).catch(() => {});

    if (updateResult.code === 0) {
      if (verbose) {
        await log(`  ✅ Updated PR body to include "Resolves ${issueRef}"`, { verbose: true });
      }
      return { wasUpdated: true, hadLinking: false };
    } else {
      if (verbose) {
        await log(`  ⚠️  Could not update PR body: ${updateResult.stderr?.toString()?.trim() || 'Unknown error'}`, { verbose: true });
      }
      return { wasUpdated: false, hadLinking: false };
    }
  } catch (updateError) {
    // Clean up temp file on error
    await fs.unlink(tempBodyFile).catch(() => {});
    throw updateError;
  }
}

/**
 * Format a PR issue reference based on fork status
 *
 * @param {number|string} issueNumber - Issue number
 * @param {boolean} isFork - Whether PR is from a fork
 * @param {string} [owner] - Repository owner (required for forks)
 * @param {string} [repo] - Repository name (required for forks)
 * @returns {string} Formatted issue reference (e.g., "#123" or "owner/repo#123")
 */
export function formatIssueReference(issueNumber, isFork, owner = null, repo = null) {
  if (isFork && owner && repo) {
    return `${owner}/${repo}#${issueNumber}`;
  }
  return `#${issueNumber}`;
}
