#!/usr/bin/env node

/**
 * Experimental: Pull Request Issue Link Auto-Correction
 *
 * This module provides real-time monitoring and auto-correction of PR descriptions
 * to ensure they always contain proper GitHub issue linking keywords.
 *
 * IMPORTANT: This feature is EXPERIMENTAL and OFF BY DEFAULT.
 * Enable with: --pull-request-issue-link-auto-correction
 *
 * When enabled, this module:
 * 1. Monitors PR description changes via GitHub API polling
 * 2. Immediately detects when linking keywords are removed
 * 3. Auto-corrects by adding proper "Resolves #N" reference
 *
 * This prevents the 53-second linking failure window documented in issue #713
 * by catching AI or manual edits that remove linking keywords.
 */

import { ensurePRIssueLinking } from './pr-issue-linking.lib.mjs';

// Global state for monitoring
let monitoringInterval = null;
let lastKnownBody = null;
let correctionCount = 0;

/**
 * Start monitoring a PR for issue linking
 *
 * @param {Object} params - Configuration object
 * @param {number|string} params.prNumber - Pull request number to monitor
 * @param {string} params.owner - Repository owner
 * @param {string} params.repo - Repository name
 * @param {number|string} params.issueNumber - Issue number that should be linked
 * @param {boolean} params.isFork - Whether PR is from a fork
 * @param {number} [params.checkIntervalMs=5000] - How often to check (milliseconds)
 * @param {Function} params.$ - Command execution function
 * @param {Function} params.log - Logging function
 * @param {Function} params.use - Module loader function
 * @param {boolean} [params.verbose=false] - Enable verbose logging
 * @returns {Promise<void>}
 */
export async function startPRIssueLinkMonitoring({
  prNumber,
  owner,
  repo,
  issueNumber,
  isFork,
  checkIntervalMs = 5000,
  $,
  log,
  use,
  verbose = false
}) {
  // Stop any existing monitoring
  stopPRIssueLinkMonitoring();

  // Reset state
  lastKnownBody = null;
  correctionCount = 0;

  if (verbose) {
    await log('\n🔍 [Experimental] Starting PR issue link monitoring...');
    await log(`   PR: #${prNumber} in ${owner}/${repo}`);
    await log(`   Issue: #${issueNumber}`);
    await log(`   Check interval: ${checkIntervalMs}ms`);
    await log('   This is an experimental feature that monitors PR description changes');
    await log('   and automatically re-adds issue linking keywords if they are removed.');
  }

  // Initial check
  try {
    const result = await ensurePRIssueLinking({
      prNumber,
      owner,
      repo,
      issueNumber,
      isFork,
      $,
      log,
      use,
      verbose
    });

    if (result.wasUpdated) {
      correctionCount++;
      await log(`  🔧 [Auto-correction] Initial correction applied (count: ${correctionCount})`);
    }

    // Store initial body
    const prBodyResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json body --jq .body`;
    if (prBodyResult.code === 0) {
      lastKnownBody = prBodyResult.stdout.toString();
    }
  } catch (error) {
    await log(`  ⚠️  [Auto-correction] Initial check failed: ${error.message}`);
  }

  // Set up periodic monitoring
  monitoringInterval = setInterval(async () => {
    try {
      // Get current PR body
      const prBodyResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json body --jq .body`;
      if (prBodyResult.code !== 0) {
        return; // Skip this check if we can't fetch PR
      }

      const currentBody = prBodyResult.stdout.toString();

      // Check if body changed
      if (currentBody !== lastKnownBody) {
        if (verbose) {
          await log('  📝 [Auto-correction] PR body changed, checking linking...', { verbose: true });
        }

        // Check and repair if needed
        const result = await ensurePRIssueLinking({
          prNumber,
          owner,
          repo,
          issueNumber,
          isFork,
          $,
          log,
          use,
          verbose: false // Don't spam logs during monitoring
        });

        if (result.wasUpdated) {
          correctionCount++;
          await log(`  🔧 [Auto-correction] PR description corrected to re-add issue link (correction #${correctionCount})`);
          await log('     This prevents the linking failure documented in issue #713');
        }

        // Update last known body
        lastKnownBody = currentBody;
      }
    } catch (error) {
      // Silently handle monitoring errors to avoid spam
      if (verbose) {
        await log(`  ⚠️  [Auto-correction] Monitoring check failed: ${error.message}`, { verbose: true });
      }
    }
  }, checkIntervalMs);

  if (verbose) {
    await log(`  ✅ [Auto-correction] Monitoring started (checking every ${checkIntervalMs}ms)`);
  }
}

/**
 * Stop PR issue link monitoring
 *
 * @param {Function} [log] - Optional logging function
 * @returns {Promise<void>}
 */
export async function stopPRIssueLinkMonitoring(log = null) {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;

    if (log && correctionCount > 0) {
      await log('\n✅ [Auto-correction] Monitoring stopped');
      await log(`   Total corrections applied: ${correctionCount}`);
    }
  }

  // Reset state
  lastKnownBody = null;
  correctionCount = 0;
}

/**
 * Get monitoring statistics
 *
 * @returns {Object} Statistics object
 */
export function getMonitoringStats() {
  return {
    isMonitoring: monitoringInterval !== null,
    correctionCount,
    lastKnownBodyLength: lastKnownBody ? lastKnownBody.length : 0
  };
}
