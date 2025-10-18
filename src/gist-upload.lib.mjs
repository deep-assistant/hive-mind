#!/usr/bin/env node

/**
 * Enhanced gist upload utilities for large files
 * Addresses issue #587: Alternative methods for uploading large log files to GitHub Gist
 *
 * This module provides git-based gist uploads which support larger files (up to 100MB)
 * compared to the gh gist create API (limited to ~25MB)
 */

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const fs = (await use('fs')).promises;
const path = (await use('path')).default;
const { $ } = await use('command-stream');

import { log } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';

/**
 * Create a gist using git push instead of gh CLI
 * This allows uploading files up to 100MB (vs 25MB limit with gh gist create)
 *
 * @param {Object} options - Upload options
 * @param {string} options.filePath - Path to the file to upload
 * @param {string} options.filename - Desired filename in the gist
 * @param {string} options.description - Gist description
 * @param {boolean} options.isPublic - Whether the gist should be public
 * @param {boolean} options.verbose - Enable verbose logging
 * @returns {Promise<{success: boolean, gistUrl?: string, error?: string}>}
 */
export async function createGistViaGit(options) {
  const {
    filePath,
    filename,
    description = 'Log file upload',
    isPublic = false,
    verbose = false
  } = options;

  let tempDir = null;

  try {
    // Create a temporary directory for the gist repo
    const timestamp = Date.now();
    tempDir = `/tmp/gist-upload-${timestamp}`;
    await fs.mkdir(tempDir, { recursive: true });

    if (verbose) {
      await log(`  📁 Created temporary directory: ${tempDir}`, { verbose: true });
    }

    // Step 1: Create an empty gist using gh CLI to get the gist URL
    if (verbose) {
      await log('  🔧 Creating empty gist...', { verbose: true });
    }

    const visibility = isPublic ? '--public' : '';
    const createResult = await $`echo "Initializing..." | gh gist create ${visibility} --desc "${description}" --filename ".placeholder" -`.quiet();

    if (createResult.code !== 0) {
      throw new Error(`Failed to create initial gist: ${createResult.stderr || 'unknown error'}`);
    }

    const gistUrl = createResult.stdout.toString().trim();

    if (verbose) {
      await log(`  ✅ Created gist: ${gistUrl}`, { verbose: true });
    }

    // Extract gist ID from URL (e.g., https://gist.github.com/username/abc123)
    const gistIdMatch = gistUrl.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/);
    if (!gistIdMatch) {
      throw new Error(`Could not extract gist ID from URL: ${gistUrl}`);
    }
    const gistId = gistIdMatch[1];

    // Step 2: Clone the gist repository
    if (verbose) {
      await log(`  📥 Cloning gist repository ${gistId}...`, { verbose: true });
    }

    const cloneResult = await $`git clone https://gist.github.com/${gistId}.git ${tempDir}`.quiet();

    if (cloneResult.code !== 0) {
      throw new Error(`Failed to clone gist: ${cloneResult.stderr || 'unknown error'}`);
    }

    // Step 3: Copy the file to the gist repo
    const targetPath = path.join(tempDir, filename);
    await fs.copyFile(filePath, targetPath);

    if (verbose) {
      const stats = await fs.stat(targetPath);
      await log(`  📄 Copied file: ${filename} (${Math.round(stats.size / 1024)} KB)`, { verbose: true });
    }

    // Step 4: Remove the placeholder file if it exists
    try {
      const placeholderPath = path.join(tempDir, '.placeholder');
      await fs.unlink(placeholderPath);
    } catch {
      // Placeholder might not exist, ignore
    }

    // Step 5: Git add, commit, and push
    if (verbose) {
      await log('  💾 Committing and pushing to gist...', { verbose: true });
    }

    // Change to the temp directory for git operations
    const gitAdd = await $`git -C ${tempDir} add ${filename}`.quiet();
    if (gitAdd.code !== 0) {
      throw new Error(`Failed to git add: ${gitAdd.stderr || 'unknown error'}`);
    }

    const gitCommit = await $`git -C ${tempDir} commit -m "Upload ${filename}"`.quiet();
    if (gitCommit.code !== 0) {
      throw new Error(`Failed to git commit: ${gitCommit.stderr || 'unknown error'}`);
    }

    const gitPush = await $`git -C ${tempDir} push origin main`.quiet();
    if (gitPush.code !== 0) {
      // Try 'master' branch as fallback
      const gitPushMaster = await $`git -C ${tempDir} push origin master`.quiet();
      if (gitPushMaster.code !== 0) {
        throw new Error(`Failed to git push: ${gitPush.stderr || gitPushMaster.stderr || 'unknown error'}`);
      }
    }

    if (verbose) {
      await log(`  ✅ Successfully uploaded to gist via git`, { verbose: true });
    }

    return {
      success: true,
      gistUrl,
      gistId
    };

  } catch (error) {
    reportError(error, {
      context: 'create_gist_via_git',
      filePath,
      filename,
      operation: 'git_based_gist_upload'
    });

    return {
      success: false,
      error: error.message
    };

  } finally {
    // Cleanup: Remove temporary directory
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        if (verbose) {
          await log(`  🧹 Cleaned up temporary directory`, { verbose: true });
        }
      } catch (cleanupError) {
        // Log but don't fail on cleanup errors
        if (verbose) {
          await log(`  ⚠️  Warning: Could not clean up ${tempDir}: ${cleanupError.message}`, { verbose: true });
        }
      }
    }
  }
}

/**
 * Upload a file to GitHub Gist with automatic fallback
 * Tries gh CLI first (faster), then falls back to git-based upload for large files
 *
 * @param {Object} options - Upload options
 * @param {string} options.filePath - Path to the file to upload
 * @param {string} options.filename - Desired filename in the gist
 * @param {string} options.description - Gist description
 * @param {boolean} options.isPublic - Whether the gist should be public
 * @param {boolean} options.verbose - Enable verbose logging
 * @returns {Promise<{success: boolean, gistUrl?: string, method?: string, error?: string}>}
 */
export async function uploadToGist(options) {
  const {
    filePath,
    filename,
    description = 'Log file upload',
    isPublic = false,
    verbose = false
  } = options;

  try {
    // Check file size
    const stats = await fs.stat(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);

    if (verbose) {
      await log(`  📊 File size: ${fileSizeMB.toFixed(2)} MB`, { verbose: true });
    }

    // For files < 25MB, try gh CLI first (faster and simpler)
    if (fileSizeMB < 25) {
      if (verbose) {
        await log('  🚀 Trying gh CLI upload (< 25MB)...', { verbose: true });
      }

      try {
        const visibility = isPublic ? '--public' : '';
        const ghResult = await $`gh gist create "${filePath}" ${visibility} --desc "${description}" --filename "${filename}"`.quiet();

        if (ghResult.code === 0) {
          const gistUrl = ghResult.stdout.toString().trim();
          if (verbose) {
            await log(`  ✅ Uploaded via gh CLI: ${gistUrl}`, { verbose: true });
          }
          return {
            success: true,
            gistUrl,
            method: 'gh-cli'
          };
        }
      } catch (ghError) {
        if (verbose) {
          await log(`  ⚠️  gh CLI upload failed, trying git method...`, { verbose: true });
        }
        // Continue to git-based method
      }
    }

    // For large files or if gh CLI failed, use git-based upload
    if (fileSizeMB >= 100) {
      return {
        success: false,
        error: `File too large for gist upload: ${fileSizeMB.toFixed(2)} MB (max 100MB). Consider compression or chunking.`
      };
    }

    if (verbose) {
      await log('  🔧 Using git-based upload for large file...', { verbose: true });
    }

    const gitResult = await createGistViaGit({
      filePath,
      filename,
      description,
      isPublic,
      verbose
    });

    if (gitResult.success) {
      return {
        ...gitResult,
        method: 'git-push'
      };
    }

    return gitResult;

  } catch (error) {
    reportError(error, {
      context: 'upload_to_gist',
      filePath,
      filename,
      operation: 'gist_upload_with_fallback'
    });

    return {
      success: false,
      error: error.message
    };
  }
}

export default {
  createGistViaGit,
  uploadToGist
};
