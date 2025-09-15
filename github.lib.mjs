#!/usr/bin/env node
// GitHub-related utility functions

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const fs = (await use('fs')).promises;
const os = (await use('os')).default;
const path = (await use('path')).default;

// Import log and maskToken from general lib
import { log, maskToken } from './lib.mjs';

// Helper function to mask GitHub tokens (alias for backward compatibility)
export const maskGitHubToken = maskToken;

// Helper function to get GitHub tokens from local config files
export const getGitHubTokensFromFiles = async () => {
  const tokens = [];
  
  try {
    // Check ~/.config/gh/hosts.yml
    const hostsFile = path.join(os.homedir(), '.config/gh/hosts.yml');
    if (await fs.access(hostsFile).then(() => true).catch(() => false)) {
      const hostsContent = await fs.readFile(hostsFile, 'utf8');
      
      // Look for oauth_token and api_token patterns
      const oauthMatches = hostsContent.match(/oauth_token:\s*([^\s\n]+)/g);
      if (oauthMatches) {
        for (const match of oauthMatches) {
          const token = match.split(':')[1].trim();
          if (token && !tokens.includes(token)) {
            tokens.push(token);
          }
        }
      }
      
      const apiMatches = hostsContent.match(/api_token:\s*([^\s\n]+)/g);
      if (apiMatches) {
        for (const match of apiMatches) {
          const token = match.split(':')[1].trim();
          if (token && !tokens.includes(token)) {
            tokens.push(token);
          }
        }
      }
    }
  } catch (error) {
    // Silently ignore file access errors
  }
  
  return tokens;
};

// Helper function to get GitHub tokens from gh command output
export const getGitHubTokensFromCommand = async () => {
  const { $ } = await use('command-stream');
  const tokens = [];
  
  try {
    // Run gh auth status to get token info
    const authResult = await $`gh auth status 2>&1`.catch(() => ({ stdout: '', stderr: '' }));
    const authOutput = authResult.stdout?.toString() + authResult.stderr?.toString() || '';
    
    // Look for token patterns in the output
    const tokenPatterns = [
      /(?:token|oauth|api)[:\s]*([a-zA-Z0-9_]{20,})/gi,
      /gh[pou]_[a-zA-Z0-9_]{20,}/gi
    ];
    
    for (const pattern of tokenPatterns) {
      const matches = authOutput.match(pattern);
      if (matches) {
        for (let match of matches) {
          // Clean up the match
          const token = match.replace(/^(?:token|oauth|api)[:\s]*/, '').trim();
          if (token && token.length >= 20 && !tokens.includes(token)) {
            tokens.push(token);
          }
        }
      }
    }
  } catch (error) {
    // Silently ignore command errors
  }
  
  return tokens;
};

// Helper function to sanitize log content by masking GitHub tokens
export const sanitizeLogContent = async (logContent) => {
  let sanitized = logContent;
  
  try {
    // Get tokens from both sources
    const fileTokens = await getGitHubTokensFromFiles();
    const commandTokens = await getGitHubTokensFromCommand();
    const allTokens = [...new Set([...fileTokens, ...commandTokens])];
    
    // Mask each token found
    for (const token of allTokens) {
      if (token && token.length >= 12) {
        const maskedToken = maskToken(token);
        // Use global replace to mask all occurrences
        sanitized = sanitized.split(token).join(maskedToken);
      }
    }
    
    // Also look for and mask common GitHub token patterns directly in the log
    const tokenPatterns = [
      /gh[pou]_[a-zA-Z0-9_]{20,}/g,
      /(?:^|[\s:=])([a-f0-9]{40})(?=[\s\n]|$)/gm, // 40-char hex tokens (like personal access tokens)
      /(?:^|[\s:=])([a-zA-Z0-9_]{20,})(?=[\s\n]|$)/gm // General long tokens
    ];
    
    for (const pattern of tokenPatterns) {
      sanitized = sanitized.replace(pattern, (match, token) => {
        if (token && token.length >= 20) {
          return match.replace(token, maskToken(token));
        }
        return match;
      });
    }
    
    await log(`  🔒 Sanitized ${allTokens.length} detected GitHub tokens in log content`, { verbose: true });
    
  } catch (error) {
    await log(`  ⚠️  Warning: Could not fully sanitize log content: ${error.message}`, { verbose: true });
  }
  
  return sanitized;
};

// Helper function to check if a file exists in a GitHub branch
export const checkFileInBranch = async (owner, repo, fileName, branchName) => {
  const { $ } = await use('command-stream');
  
  try {
    // Use GitHub CLI to check if file exists in the branch
    const result = await $`gh api repos/${owner}/${repo}/contents/${fileName}?ref=${branchName}`;
    return result.code === 0;
  } catch (error) {
    // If file doesn't exist or there's an error, file doesn't exist
    return false;
  }
};

// Helper function to check GitHub permissions and warn about missing scopes
export const checkGitHubPermissions = async () => {
  const { $ } = await use('command-stream');
  
  try {
    await log(`\n🔐 Checking GitHub authentication and permissions...`);
    
    // Get auth status including token scopes
    const authStatusResult = await $`gh auth status 2>&1`;
    const authOutput = authStatusResult.stdout.toString() + authStatusResult.stderr.toString();
    
    if (authStatusResult.code !== 0 || authOutput.includes('not logged into any GitHub hosts')) {
      await log(`❌ GitHub authentication error: Not logged in`, { level: 'error' });
      await log(`   To fix this, run: gh auth login`, { level: 'error' });
      return false;
    }
    
    await log(`✅ GitHub authentication: OK`);
    
    // Parse the auth status output to extract token scopes
    const scopeMatch = authOutput.match(/Token scopes:\s*(.+)/);
    if (!scopeMatch) {
      await log(`⚠️  Warning: Could not determine token scopes from auth status`, { level: 'warning' });
      return true; // Continue despite not being able to check scopes
    }
    
    // Extract individual scopes from the format: 'scope1', 'scope2', 'scope3'
    const scopeString = scopeMatch[1];
    const scopes = scopeString.match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
    await log(`📋 Token scopes: ${scopes.join(', ')}`);
    
    // Check for important scopes and warn if missing
    const warnings = [];
    
    if (!scopes.includes('workflow')) {
      warnings.push({
        scope: 'workflow',
        issue: 'Cannot push changes to .github/workflows/ directory',
        solution: 'Run: gh auth refresh -h github.com -s workflow'
      });
    }
    
    if (!scopes.includes('repo')) {
      warnings.push({
        scope: 'repo',
        issue: 'Limited repository access (may not be able to create PRs or push to private repos)',
        solution: 'Run: gh auth refresh -h github.com -s repo'
      });
    }
    
    // Display warnings
    if (warnings.length > 0) {
      await log(`\n⚠️  Permission warnings detected:`, { level: 'warning' });
      
      for (const warning of warnings) {
        await log(`\n   Missing scope: '${warning.scope}'`, { level: 'warning' });
        await log(`   Impact: ${warning.issue}`, { level: 'warning' });
        await log(`   Solution: ${warning.solution}`, { level: 'warning' });
      }
      
      await log(`\n   💡 You can continue, but some operations may fail due to insufficient permissions.`, { level: 'warning' });
      await log(`   💡 To avoid issues, it's recommended to refresh your authentication with the missing scopes.`, { level: 'warning' });
    } else {
      await log(`✅ All required permissions: Available`);
    }
    
    return true;
  } catch (error) {
    await log(`⚠️  Warning: Could not check GitHub permissions: ${maskToken(error.message || error.toString())}`, { level: 'warning' });
    await log(`   Continuing anyway, but some operations may fail if permissions are insufficient`, { level: 'warning' });
    return true; // Continue despite permission check failure
  }
};

/**
 * Attaches a log file to a GitHub PR or issue as a comment
 * @param {Object} options - Configuration options
 * @param {string} options.logFile - Path to the log file
 * @param {string} options.targetType - 'pr' or 'issue'
 * @param {number} options.targetNumber - PR or issue number
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {Function} options.$ - Command execution function
 * @param {Function} options.log - Logging function
 * @param {Function} options.sanitizeLogContent - Function to sanitize log content
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @param {string} [options.errorMessage] - Error message to include in comment (for failure logs)
 * @param {string} [options.customTitle] - Custom title for the comment (defaults to "🤖 Solution Log")
 * @returns {Promise<boolean>} - True if upload succeeded
 */
export async function attachLogToGitHub(options) {
  const fs = (await use('fs')).promises;
  const {
    logFile,
    targetType,
    targetNumber,
    owner,
    repo,
    $,
    log,
    sanitizeLogContent,
    verbose = false,
    errorMessage,
    customTitle = '🤖 Solution Log'
  } = options;

  const targetName = targetType === 'pr' ? 'Pull Request' : 'Issue';
  const ghCommand = targetType === 'pr' ? 'pr' : 'issue';

  try {
    // Check if log file exists and is not empty
    const logStats = await fs.stat(logFile);
    if (logStats.size === 0) {
      await log(`  ⚠️  Log file is empty, skipping upload`);
      return false;
    } else if (logStats.size > 25 * 1024 * 1024) { // 25MB GitHub limit
      await log(`  ⚠️  Log file too large (${Math.round(logStats.size / 1024 / 1024)}MB), GitHub limit is 25MB`);
      return false;
    }

    // Read and sanitize log content
    const rawLogContent = await fs.readFile(logFile, 'utf8');
    if (verbose) {
      await log(`  🔍 Sanitizing log content to mask GitHub tokens...`, { verbose: true });
    }
    const logContent = await sanitizeLogContent(rawLogContent);

    // Create formatted comment
    let logComment;
    if (errorMessage) {
      // Failure log format
      logComment = `## 🚨 Solution Failed

The automated solution encountered an error:
\`\`\`
${errorMessage}
\`\`\`

<details>
<summary>Click to expand failure log (${Math.round(logStats.size / 1024)}KB)</summary>

\`\`\`
${logContent}
\`\`\`

</details>

---
*Log automatically attached by solve.mjs with --attach-solution-logs option*`;
    } else {
      // Success log format
      logComment = `## ${customTitle}

This log file contains the complete execution trace of the AI ${targetType === 'pr' ? 'solution' : 'analysis'} process.

<details>
<summary>Click to expand solution log (${Math.round(logStats.size / 1024)}KB)</summary>

\`\`\`
${logContent}
\`\`\`

</details>

---
*Log automatically attached by solve.mjs with --attach-solution-logs option*`;
    }

    // Check GitHub comment size limit
    const GITHUB_COMMENT_LIMIT = 65536;
    let commentResult;

    if (logComment.length > GITHUB_COMMENT_LIMIT) {
      await log(`  ⚠️  Log comment too long (${logComment.length} chars), GitHub limit is ${GITHUB_COMMENT_LIMIT} chars`);
      await log(`  📎 Uploading log as GitHub Gist instead...`);

      try {
        // Create gist
        const tempLogFile = `/tmp/solution-log-${targetType}-${Date.now()}.txt`;
        await fs.writeFile(tempLogFile, logContent);

        const gistResult = await $`gh gist create "${tempLogFile}" --desc "Solution log for https://github.com/${owner}/${repo}/${targetType === 'pr' ? 'pull' : 'issues'}/${targetNumber}" --filename "solution-log.txt"`;

        await fs.unlink(tempLogFile).catch(() => {});

        if (gistResult.code === 0) {
          const gistUrl = gistResult.stdout.toString().trim();

          // Create comment with gist link
          let gistComment;
          if (errorMessage) {
            // Failure log gist format
            gistComment = `## 🚨 Solution Failed

The automated solution encountered an error:
\`\`\`
${errorMessage}
\`\`\`

📎 **Failure log uploaded as GitHub Gist** (${Math.round(logStats.size / 1024)}KB)
🔗 [View complete failure log](${gistUrl})

---
*Log automatically attached by solve.mjs with --attach-solution-logs option*`;
          } else {
            // Success log gist format
            gistComment = `## ${customTitle}

This log file contains the complete execution trace of the AI ${targetType === 'pr' ? 'solution' : 'analysis'} process.

📎 **Log file uploaded as GitHub Gist** (${Math.round(logStats.size / 1024)}KB)
🔗 [View complete solution log](${gistUrl})

---
*Log automatically attached by solve.mjs with --attach-solution-logs option*`;
          }

          const tempGistCommentFile = `/tmp/log-gist-comment-${targetType}-${Date.now()}.md`;
          await fs.writeFile(tempGistCommentFile, gistComment);

          commentResult = await $`gh ${ghCommand} comment ${targetNumber} --repo ${owner}/${repo} --body-file "${tempGistCommentFile}"`;

          await fs.unlink(tempGistCommentFile).catch(() => {});

          if (commentResult.code === 0) {
            await log(`  ✅ Solution log uploaded to ${targetName} as Gist`);
            await log(`  🔗 Gist URL: ${gistUrl}`);
            await log(`  📊 Log size: ${Math.round(logStats.size / 1024)}KB`);
            return true;
          } else {
            await log(`  ❌ Failed to upload comment with gist link: ${commentResult.stderr ? commentResult.stderr.toString().trim() : 'unknown error'}`);
            return false;
          }
        } else {
          await log(`  ❌ Failed to create gist: ${gistResult.stderr ? gistResult.stderr.toString().trim() : 'unknown error'}`);
          
          // Fallback to truncated comment
          await log(`  🔄 Falling back to truncated comment...`);
          return await attachTruncatedLog(options);
        }
      } catch (gistError) {
        await log(`  ❌ Error creating gist: ${gistError.message}`);
        // Try regular comment as last resort
        return await attachRegularComment(options, logComment);
      }
    } else {
      // Comment fits within limit
      return await attachRegularComment(options, logComment);
    }
  } catch (uploadError) {
    await log(`  ❌ Error uploading log file: ${uploadError.message}`);
    return false;
  }
}

/**
 * Helper to attach a truncated log when full log is too large
 */
async function attachTruncatedLog(options) {
  const fs = (await use('fs')).promises;
  const { logFile, targetType, targetNumber, owner, repo, $, log, sanitizeLogContent } = options;
  
  const targetName = targetType === 'pr' ? 'Pull Request' : 'Issue';
  const ghCommand = targetType === 'pr' ? 'pr' : 'issue';
  
  const rawLogContent = await fs.readFile(logFile, 'utf8');
  const logContent = await sanitizeLogContent(rawLogContent);
  const logStats = await fs.stat(logFile);
  
  const GITHUB_COMMENT_LIMIT = 65536;
  const maxContentLength = GITHUB_COMMENT_LIMIT - 500;
  const truncatedContent = logContent.substring(0, maxContentLength) + '\n\n[... Log truncated due to length ...]';
  
  const truncatedComment = `## 🤖 Solution Log (Truncated)

This log file contains the complete execution trace of the AI ${targetType === 'pr' ? 'solution' : 'analysis'} process.
⚠️ **Log was truncated** due to GitHub comment size limits.

<details>
<summary>Click to expand solution log (${Math.round(logStats.size / 1024)}KB, truncated)</summary>

\`\`\`
${truncatedContent}
\`\`\`

</details>

---
*Log automatically attached by solve.mjs with --attach-solution-logs option*`;

  const tempFile = `/tmp/log-truncated-comment-${targetType}-${Date.now()}.md`;
  await fs.writeFile(tempFile, truncatedComment);
  
  const result = await $`gh ${ghCommand} comment ${targetNumber} --repo ${owner}/${repo} --body-file "${tempFile}"`;
  
  await fs.unlink(tempFile).catch(() => {});
  
  if (result.code === 0) {
    await log(`  ✅ Truncated solution log uploaded to ${targetName}`);
    await log(`  📊 Log size: ${Math.round(logStats.size / 1024)}KB (truncated)`);
    return true;
  } else {
    await log(`  ❌ Failed to upload truncated log: ${result.stderr ? result.stderr.toString().trim() : 'unknown error'}`);
    return false;
  }
}

/**
 * Helper to attach a regular comment when it fits within limits
 */
async function attachRegularComment(options, logComment) {
  const fs = (await use('fs')).promises;
  const { targetType, targetNumber, owner, repo, $, log, logFile } = options;
  
  const targetName = targetType === 'pr' ? 'Pull Request' : 'Issue';
  const ghCommand = targetType === 'pr' ? 'pr' : 'issue';
  const logStats = await fs.stat(logFile);
  
  const tempFile = `/tmp/log-comment-${targetType}-${Date.now()}.md`;
  await fs.writeFile(tempFile, logComment);
  
  const result = await $`gh ${ghCommand} comment ${targetNumber} --repo ${owner}/${repo} --body-file "${tempFile}"`;
  
  await fs.unlink(tempFile).catch(() => {});
  
  if (result.code === 0) {
    await log(`  ✅ Solution log uploaded to ${targetName} as comment`);
    await log(`  📊 Log size: ${Math.round(logStats.size / 1024)}KB`);
    return true;
  } else {
    await log(`  ❌ Failed to upload log to ${targetName}: ${result.stderr ? result.stderr.toString().trim() : 'unknown error'}`);
    return false;
  }
}

/**
 * Helper function to fetch all issues with pagination and rate limiting
 * @param {string} baseCommand - The base gh command to execute
 * @returns {Promise<Array>} Array of issues
 */
export async function fetchAllIssuesWithPagination(baseCommand) {
  const { execSync } = await import('child_process');
  
  // Import log and cleanErrorMessage from lib.mjs
  const { log, cleanErrorMessage } = await import('./lib.mjs');
  
  try {
    // First, try without pagination to see if we get more than the default limit
    await log(`   📊 Fetching issues with improved limits and rate limiting...`, { verbose: true });
    
    // Add a 5-second delay before making the API call to respect rate limits
    await log(`   ⏰ Waiting 5 seconds before API call to respect rate limits...`, { verbose: true });
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const startTime = Date.now();
    
    // Use a much higher limit instead of 100, and remove any existing limit from the command
    const commandWithoutLimit = baseCommand.replace(/--limit\s+\d+/, '');
    const improvedCommand = `${commandWithoutLimit} --limit 1000`;
    
    await log(`   🔎 Executing: ${improvedCommand}`, { verbose: true });
    const output = execSync(improvedCommand, { encoding: 'utf8' });
    const endTime = Date.now();
    
    const issues = JSON.parse(output || '[]');
    
    await log(`   ✅ Fetched ${issues.length} issues in ${Math.round((endTime - startTime) / 1000)}s`);
    
    // If we got exactly 1000 results, there might be more - log a warning
    if (issues.length === 1000) {
      await log(`   ⚠️  Hit the 1000 issue limit - there may be more issues available`, { level: 'warning' });
      await log(`   💡 Consider filtering by labels or date ranges for repositories with >1000 open issues`, { level: 'info' });
    }
    
    // Add a 5-second delay after the call to be extra safe with rate limits
    await log(`   ⏰ Adding 5-second delay after API call to respect rate limits...`, { verbose: true });
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    return issues;
  } catch (error) {
    await log(`   ❌ Enhanced fetch failed: ${cleanErrorMessage(error)}`, { level: 'error' });
    
    // Fallback to original behavior with 100 limit
    try {
      await log(`   🔄 Falling back to default behavior...`, { verbose: true });
      const fallbackCommand = baseCommand.includes('--limit') ? baseCommand : `${baseCommand} --limit 100`;
      await new Promise(resolve => setTimeout(resolve, 2000)); // Shorter delay for fallback
      const output = execSync(fallbackCommand, { encoding: 'utf8' });
      const issues = JSON.parse(output || '[]');
      await log(`   ⚠️  Fallback: fetched ${issues.length} issues (limited to 100)`, { level: 'warning' });
      return issues;
    } catch (fallbackError) {
      await log(`   ❌ Fallback also failed: ${cleanErrorMessage(fallbackError)}`, { level: 'error' });
      return [];
    }
  }
}

// Export all functions as default object too
export default {
  maskGitHubToken,
  getGitHubTokensFromFiles,
  getGitHubTokensFromCommand,
  sanitizeLogContent,
  checkFileInBranch,
  checkGitHubPermissions,
  attachLogToGitHub,
  fetchAllIssuesWithPagination
};