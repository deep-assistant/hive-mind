#!/usr/bin/env node
// GitHub-related utility functions

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const fs = (await use('fs')).promises;
const os = (await use('os')).default;
const path = (await use('path')).default;

// Use command-stream for consistent $ behavior
const { $ } = await use('command-stream');

// Import log and maskToken from general lib
import { log, maskToken, cleanErrorMessage } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { githubLimits, timeouts } from './config.lib.mjs';

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
    // File access errors are expected when config doesn't exist
    if (global.verboseMode) {
      reportError(error, {
        context: 'github_token_file_access',
        level: 'debug'
      });
    }
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
    // Command errors are expected when gh is not configured
    if (global.verboseMode) {
      reportError(error, {
        context: 'github_token_gh_auth',
        level: 'debug'
      });
    }
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
    reportError(error, {
      context: 'sanitize_log_content',
      level: 'warning'
    });
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
    // File doesn't exist or access error - this is expected behavior
    if (global.verboseMode) {
      reportError(error, {
        context: 'check_file_in_branch',
        level: 'debug',
        owner,
        repo,
        fileName,
        branchName
      });
    }
    return false;
  }
};

// Helper function to check GitHub permissions and warn about missing scopes
export const checkGitHubPermissions = async () => {
  const { $ } = await use('command-stream');
  
  try {
    await log('\n🔐 Checking GitHub authentication and permissions...');
    
    // Get auth status including token scopes
    const authStatusResult = await $`gh auth status 2>&1`;
    const authOutput = authStatusResult.stdout.toString() + authStatusResult.stderr.toString();
    
    if (authStatusResult.code !== 0 || authOutput.includes('not logged into any GitHub hosts')) {
      await log('❌ GitHub authentication error: Not logged in', { level: 'error' });
      await log('   To fix this, run: gh auth login', { level: 'error' });
      return false;
    }
    
    await log('✅ GitHub authentication: OK');
    
    // Parse the auth status output to extract token scopes
    const scopeMatch = authOutput.match(/Token scopes:\s*(.+)/);
    if (!scopeMatch) {
      await log('⚠️  Warning: Could not determine token scopes from auth status', { level: 'warning' });
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
      await log('\n⚠️  Permission warnings detected:', { level: 'warning' });
      
      for (const warning of warnings) {
        await log(`\n   Missing scope: '${warning.scope}'`, { level: 'warning' });
        await log(`   Impact: ${warning.issue}`, { level: 'warning' });
        await log(`   Solution: ${warning.solution}`, { level: 'warning' });
      }
      
      await log('\n   💡 You can continue, but some operations may fail due to insufficient permissions.', { level: 'warning' });
      await log('   💡 To avoid issues, it\'s recommended to refresh your authentication with the missing scopes.', { level: 'warning' });
    } else {
      await log('✅ All required permissions: Available');
    }
    
    return true;
  } catch (error) {
    await log(`⚠️  Warning: Could not check GitHub permissions: ${maskToken(error.message || error.toString())}`, { level: 'warning' });
    await log('   Continuing anyway, but some operations may fail if permissions are insufficient', { level: 'warning' });
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
 * @param {string} [options.customTitle] - Custom title for the comment (defaults to "🤖 Solution Draft Log")
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
    customTitle = '🤖 Solution Draft Log'
  } = options;

  const targetName = targetType === 'pr' ? 'Pull Request' : 'Issue';
  const ghCommand = targetType === 'pr' ? 'pr' : 'issue';

  try {
    // Check if log file exists and is not empty
    const logStats = await fs.stat(logFile);
    if (logStats.size === 0) {
      await log('  ⚠️  Log file is empty, skipping upload');
      return false;
    } else if (logStats.size > githubLimits.fileMaxSize) {
      await log(`  ⚠️  Log file too large (${Math.round(logStats.size / 1024 / 1024)}MB), GitHub limit is ${Math.round(githubLimits.fileMaxSize / 1024 / 1024)}MB`);
      return false;
    }

    // Read and sanitize log content
    const rawLogContent = await fs.readFile(logFile, 'utf8');
    if (verbose) {
      await log('  🔍 Sanitizing log content to mask GitHub tokens...', { verbose: true });
    }
    const logContent = await sanitizeLogContent(rawLogContent);

    // Create formatted comment
    let logComment;
    if (errorMessage) {
      // Failure log format
      logComment = `## 🚨 Solution Draft Failed

The automated solution draft encountered an error:
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
*Now working session is ended, feel free to review and add any feedback on the solution draft.*`;
    } else {
      // Success log format
      logComment = `## ${customTitle}

This log file contains the complete execution trace of the AI ${targetType === 'pr' ? 'solution draft' : 'analysis'} process.

<details>
<summary>Click to expand solution draft log (${Math.round(logStats.size / 1024)}KB)</summary>

\`\`\`
${logContent}
\`\`\`

</details>

---
*Now working session is ended, feel free to review and add any feedback on the solution draft.*`;
    }

    // Check GitHub comment size limit
    let commentResult;

    if (logComment.length > githubLimits.commentMaxSize) {
      await log(`  ⚠️  Log comment too long (${logComment.length} chars), GitHub limit is ${githubLimits.commentMaxSize} chars`);
      await log('  📎 Uploading log as GitHub Gist instead...');

      try {
        // Check if repository is public or private
        let isPublicRepo = true;
        try {
          const repoVisibilityResult = await $`gh api repos/${owner}/${repo} --jq .visibility`;
          if (repoVisibilityResult.code === 0) {
            const visibility = repoVisibilityResult.stdout.toString().trim();
            isPublicRepo = visibility === 'public';
            if (verbose) {
              await log(`  🔍 Repository visibility: ${visibility}`, { verbose: true });
            }
          }
        } catch (visibilityError) {
          reportError(visibilityError, {
            context: 'check_repo_visibility',
            level: 'warning',
            owner,
            repo
          });
          // Default to public if we can't determine visibility
          await log('  ⚠️  Could not determine repository visibility, defaulting to public gist', { verbose: true });
        }

        // Create gist with appropriate visibility
        const tempLogFile = `/tmp/solution-draft-log-${targetType}-${Date.now()}.txt`;
        await fs.writeFile(tempLogFile, logContent);

        const gistCommand = isPublicRepo
          ? `gh gist create "${tempLogFile}" --public --desc "Solution draft log for https://github.com/${owner}/${repo}/${targetType === 'pr' ? 'pull' : 'issues'}/${targetNumber}" --filename "solution-draft-log.txt"`
          : `gh gist create "${tempLogFile}" --desc "Solution draft log for https://github.com/${owner}/${repo}/${targetType === 'pr' ? 'pull' : 'issues'}/${targetNumber}" --filename "solution-draft-log.txt"`;

        if (verbose) {
          await log(`  🔐 Creating ${isPublicRepo ? 'public' : 'private'} gist...`, { verbose: true });
        }

        const gistResult = await $(gistCommand);

        await fs.unlink(tempLogFile).catch(() => {});

        if (gistResult.code === 0) {
          const gistUrl = gistResult.stdout.toString().trim();

          // Create comment with gist link
          let gistComment;
          if (errorMessage) {
            // Failure log gist format
            gistComment = `## 🚨 Solution Draft Failed

The automated solution draft encountered an error:
\`\`\`
${errorMessage}
\`\`\`

📎 **Failure log uploaded as GitHub Gist** (${Math.round(logStats.size / 1024)}KB)
🔗 [View complete failure log](${gistUrl})

---
*Now working session is ended, feel free to review and add any feedback on the solution draft.*`;
          } else {
            // Success log gist format
            gistComment = `## ${customTitle}

This log file contains the complete execution trace of the AI ${targetType === 'pr' ? 'solution draft' : 'analysis'} process.

📎 **Log file uploaded as GitHub Gist** (${Math.round(logStats.size / 1024)}KB)
🔗 [View complete solution draft log](${gistUrl})

---
*Now working session is ended, feel free to review and add any feedback on the solution draft.*`;
          }

          const tempGistCommentFile = `/tmp/log-gist-comment-${targetType}-${Date.now()}.md`;
          await fs.writeFile(tempGistCommentFile, gistComment);

          commentResult = await $`gh ${ghCommand} comment ${targetNumber} --repo ${owner}/${repo} --body-file "${tempGistCommentFile}"`;

          await fs.unlink(tempGistCommentFile).catch(() => {});

          if (commentResult.code === 0) {
            await log(`  ✅ Solution draft log uploaded to ${targetName} as ${isPublicRepo ? 'public' : 'private'} Gist`);
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
          await log('  🔄 Falling back to truncated comment...');
          return await attachTruncatedLog(options);
        }
      } catch (gistError) {
        reportError(gistError, {
          context: 'create_gist',
          level: 'error'
        });
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
  
  const truncatedComment = `## 🤖 Solution Draft Log (Truncated)

This log file contains the complete execution trace of the AI ${targetType === 'pr' ? 'solution draft' : 'analysis'} process.
⚠️ **Log was truncated** due to GitHub comment size limits.

<details>
<summary>Click to expand solution draft log (${Math.round(logStats.size / 1024)}KB, truncated)</summary>

\`\`\`
${truncatedContent}
\`\`\`

</details>

---
*Now working session is ended, feel free to review and add any feedback on the solution draft.*`;

  const tempFile = `/tmp/log-truncated-comment-${targetType}-${Date.now()}.md`;
  await fs.writeFile(tempFile, truncatedComment);
  
  const result = await $`gh ${ghCommand} comment ${targetNumber} --repo ${owner}/${repo} --body-file "${tempFile}"`;
  
  await fs.unlink(tempFile).catch(() => {});
  
  if (result.code === 0) {
    await log(`  ✅ Truncated solution draft log uploaded to ${targetName}`);
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
    await log(`  ✅ Solution draft log uploaded to ${targetName} as comment`);
    await log(`  📊 Log size: ${Math.round(logStats.size / 1024)}KB`);
    return true;
  } else {
    await log(`  ❌ Failed to upload log to ${targetName}: ${result.stderr ? result.stderr.toString().trim() : 'unknown error'}`);
    return false;
  }
}

/**
 * Detects if an error is due to GitHub API rate limiting
 * @param {Error|string} error - The error to check
 * @returns {boolean} True if the error indicates rate limiting
 */
export function isRateLimitError(error) {
  const errorMessage = (error.message || error.toString()).toLowerCase();

  // Common rate limit error patterns
  const rateLimitPatterns = [
    'rate limit',
    'secondary rate limit',
    'exceeded.*limit',
    'too many requests',
    'abuse detection',
    'wait a few minutes',
    'http 403.*rate',
    'api rate limit exceeded'
  ];

  return rateLimitPatterns.some(pattern => {
    return new RegExp(pattern).test(errorMessage);
  });
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
    await log('   📊 Fetching issues with improved limits and rate limiting...', { verbose: true });
    
    // Add a 5-second delay before making the API call to respect rate limits
    await log('   ⏰ Waiting 5 seconds before API call to respect rate limits...', { verbose: true });
    await new Promise(resolve => setTimeout(resolve, timeouts.githubApiDelay));
    
    const startTime = Date.now();
    
    // Use appropriate page sizes: 100 for search API (more restrictive), 1000 for regular listing
    const commandWithoutLimit = baseCommand.replace(/--limit\s+\d+/, '');
    const isSearchCommand = commandWithoutLimit.includes('gh search');
    const maxPageSize = isSearchCommand ? 100 : 1000;
    const improvedCommand = `${commandWithoutLimit} --limit ${maxPageSize}`;
    
    await log(`   🔎 Executing: ${improvedCommand}`, { verbose: true });
    const output = execSync(improvedCommand, { encoding: 'utf8' });
    const endTime = Date.now();
    
    const issues = JSON.parse(output || '[]');
    
    await log(`   ✅ Fetched ${issues.length} issues in ${Math.round((endTime - startTime) / 1000)}s`);
    
    // If we got exactly the max page size, there might be more - log a warning
    if (issues.length === maxPageSize) {
      await log(`   ⚠️  Hit the ${maxPageSize} issue limit - there may be more issues available`, { level: 'warning' });
      if (maxPageSize >= 1000) {
        await log(`   💡 Consider filtering by labels or date ranges for repositories with >${maxPageSize} open issues`, { level: 'info' });
      }
    }
    
    // Add a 5-second delay after the call to be extra safe with rate limits
    await log('   ⏰ Adding 5-second delay after API call to respect rate limits...', { verbose: true });
    await new Promise(resolve => setTimeout(resolve, timeouts.githubApiDelay));
    
    return issues;
  } catch (error) {
    await log(`   ❌ Enhanced fetch failed: ${cleanErrorMessage(error)}`, { level: 'error' });

    // Check if this is a rate limit error - if so, don't try fallback with the same command
    if (isRateLimitError(error)) {
      await log('   ⚠️  Rate limit detected - not attempting fallback with same command', { verbose: true });
      // Re-throw the error so the caller can handle rate limiting appropriately
      throw error;
    }

    // Only try fallback for non-rate-limit errors
    try {
      await log('   🔄 Falling back to default behavior...', { verbose: true });
      const fallbackCommand = baseCommand.includes('--limit') ? baseCommand : `${baseCommand} --limit 100`;
      await new Promise(resolve => setTimeout(resolve, timeouts.githubRepoDelay)); // Shorter delay for fallback
      const output = execSync(fallbackCommand, { encoding: 'utf8' });
      const issues = JSON.parse(output || '[]');
      await log(`   ⚠️  Fallback: fetched ${issues.length} issues (limited to 100)`, { level: 'warning' });
      return issues;
    } catch (fallbackError) {
      await log(`   ❌ Fallback also failed: ${cleanErrorMessage(fallbackError)}`, { level: 'error' });
      // Re-throw the error so the caller can handle rate limiting appropriately
      throw fallbackError;
    }
  }
}

// Function to fetch issues from GitHub Projects v2
export async function fetchProjectIssues(projectNumber, owner, statusFilter) {
  try {
    await log(`🔍 Fetching issues from GitHub Project #${projectNumber} (owner: ${owner}, status: ${statusFilter})`);

    // Check for project scope in GitHub CLI authentication
    try {
      const authStatus = await $`gh auth status --show-token`.quiet();
      if (!authStatus.stdout.includes('project')) {
        throw new Error('Missing project scope. Run: gh auth refresh -s project');
      }
    } catch (error) {
      reportError(error, {
        context: 'github.lib.mjs - GitHub CLI auth status check',
        level: 'error'
      });
      throw new Error('GitHub CLI authentication failed. Please run: gh auth login');
    }

    // Add delay to respect rate limits
    await log('   ⏰ Waiting 2 seconds before API call to respect rate limits...', { verbose: true });
    await new Promise(resolve => setTimeout(resolve, timeouts.githubRepoDelay));

    const startTime = Date.now();

    // Fetch all project items
    await log(`   🔎 Executing: gh project item-list ${projectNumber} --owner ${owner} --format json --limit 100`, { verbose: true });
    const result = await $`gh project item-list ${projectNumber} --owner ${owner} --format json --limit 100`.quiet();
    const endTime = Date.now();

    const projectData = JSON.parse(result.stdout || '{"items": []}');
    const allItems = projectData.items || [];

    await log(`   📊 Found ${allItems.length} total project items in ${Math.round((endTime - startTime) / 1000)}s`);

    // Filter by status and item type (only Issues)
    const filteredIssues = allItems.filter(item => {
      // Check if it's an Issue (not PR, Discussion, etc.)
      if (item.content?.type !== 'Issue') {
        return false;
      }

      // Check status field - look for Status field in fieldValueByName
      const statusField = item.fieldValueByName?.Status;
      if (!statusField) {
        // If no status field, skip this item
        return false;
      }

      // Match against configured status value
      return statusField.name === statusFilter;
    });

    // Extract issue information
    const issues = filteredIssues.map(item => ({
      url: item.content.url,
      title: item.content.title,
      number: item.content.number,
      repository: item.content.repository,
      labels: item.content.labels || [],
      state: item.content.state || 'open'
    }));

    await log(`   ✅ Found ${issues.length} issues with status "${statusFilter}"`);

    if (issues.length > 0) {
      await log('   📋 Issues found:', { verbose: true });
      for (const issue of issues) {
        await log(`      • #${issue.number}: ${issue.title}`, { verbose: true });
      }
    }

    // Add delay after API call
    await log('   ⏰ Adding 2-second delay after API call to respect rate limits...', { verbose: true });
    await new Promise(resolve => setTimeout(resolve, timeouts.githubRepoDelay));

    return issues;

  } catch (error) {
    await log(`   ❌ Failed to fetch project issues: ${cleanErrorMessage(error)}`, { level: 'error' });

    // Provide helpful error messages for common issues
    if (error.message.includes('project scope')) {
      await log('   💡 To fix this, run: gh auth refresh -s project', { level: 'info' });
    } else if (error.message.includes('authentication')) {
      await log('   💡 To fix this, run: gh auth login', { level: 'info' });
    } else if (error.message.includes('not found') || error.message.includes('404')) {
      await log('   💡 Check that the project number and owner are correct', { level: 'info' });
      await log('   💡 Make sure you have access to the project', { level: 'info' });
    }

    return [];
  }
}

/**
 * Batch fetch pull request information for multiple issues using GraphQL
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Array<number>} issueNumbers - Array of issue numbers to check
 * @returns {Promise<Object>} Object mapping issue numbers to their linked PRs
 */
export async function batchCheckPullRequestsForIssues(owner, repo, issueNumbers) {
  try {
    if (!issueNumbers || issueNumbers.length === 0) {
      return {};
    }

    await log(`   🔍 Batch checking PRs for ${issueNumbers.length} issues using GraphQL...`, { verbose: true });

    // GraphQL has complexity limits, so batch in groups of 50
    const BATCH_SIZE = 50;
    const results = {};

    for (let i = 0; i < issueNumbers.length; i += BATCH_SIZE) {
      const batch = issueNumbers.slice(i, i + BATCH_SIZE);

      // Build GraphQL query for this batch
      const query = `
        query GetPullRequestsForIssues {
          repository(owner: "${owner}", name: "${repo}") {
            ${batch.map(num => `
            issue${num}: issue(number: ${num}) {
              number
              title
              state
              timelineItems(first: 100, itemTypes: [CROSS_REFERENCED_EVENT]) {
                nodes {
                  ... on CrossReferencedEvent {
                    source {
                      ... on PullRequest {
                        number
                        title
                        state
                        isDraft
                        url
                      }
                    }
                  }
                }
              }
            }`).join('\n')}
          }
        }
      `;

      try {
        // Add small delay between batches to respect rate limits
        if (i > 0) {
          await log('   ⏰ Waiting 2 seconds before next batch...', { verbose: true });
          await new Promise(resolve => setTimeout(resolve, timeouts.githubRepoDelay));
        }

        // Execute GraphQL query
        const { execSync } = await import('child_process');
        const result = execSync(`gh api graphql -f query='${query}'`, {
          encoding: 'utf8',
          maxBuffer: githubLimits.bufferMaxSize
        });

        const data = JSON.parse(result);

        // Process results for this batch
        for (const issueNum of batch) {
          const issueData = data.data?.repository?.[`issue${issueNum}`];
          if (issueData) {
            const linkedPRs = [];

            // Extract linked PRs from timeline items
            for (const item of issueData.timelineItems?.nodes || []) {
              if (item?.source && item.source.state === 'OPEN' && !item.source.isDraft) {
                linkedPRs.push({
                  number: item.source.number,
                  title: item.source.title,
                  state: item.source.state,
                  url: item.source.url
                });
              }
            }

            results[issueNum] = {
              title: issueData.title,
              state: issueData.state,
              openPRCount: linkedPRs.length,
              linkedPRs: linkedPRs
            };
          } else {
            // Issue not found or error
            results[issueNum] = {
              openPRCount: 0,
              linkedPRs: [],
              error: 'Issue not found'
            };
          }
        }

        await log(`   ✅ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(issueNumbers.length / BATCH_SIZE)} processed (${batch.length} issues)`, { verbose: true });

      } catch (batchError) {
        await log(`   ⚠️  GraphQL batch query failed: ${cleanErrorMessage(batchError)}`, { level: 'warning' });

        // Fall back to individual REST API calls for this batch
        await log('   🔄 Falling back to REST API for batch...', { verbose: true });

        for (const issueNum of batch) {
          try {
            const { execSync } = await import('child_process');
            const cmd = `gh api repos/${owner}/${repo}/issues/${issueNum}/timeline --jq '[.[] | select(.event == "cross-referenced" and .source.issue.pull_request != null and .source.issue.state == "open")] | length'`;

            const output = execSync(cmd, { encoding: 'utf8' }).trim();
            const openPrCount = parseInt(output) || 0;

            results[issueNum] = {
              openPRCount: openPrCount,
              linkedPRs: [] // REST API doesn't give us PR details easily
            };
          } catch (restError) {
            results[issueNum] = {
              openPRCount: 0,
              linkedPRs: [],
              error: cleanErrorMessage(restError)
            };
          }
        }
      }
    }

    // Log summary
    const totalIssues = issueNumbers.length;
    const issuesWithPRs = Object.values(results).filter(r => r.openPRCount > 0).length;
    await log(`   📊 Batch PR check complete: ${issuesWithPRs}/${totalIssues} issues have open PRs`, { verbose: true });

    return results;

  } catch (error) {
    await log(`   ❌ Batch PR check failed: ${cleanErrorMessage(error)}`, { level: 'error' });
    return {};
  }
}

/**
 * Universal GitHub URL parser that handles various formats
 * @param {string} url - The GitHub URL to parse
 * @returns {Object} Parsed URL information including:
 *   - valid: boolean indicating if the URL is valid
 *   - normalized: the normalized URL (https://github.com/...)
 *   - type: 'user', 'repo', 'issue', 'pull', 'gist', 'actions', etc.
 *   - owner: repository owner/organization
 *   - repo: repository name (if applicable)
 *   - number: issue/PR number (if applicable)
 *   - path: additional path components
 *   - error: error message if invalid
 */
export function parseGitHubUrl(url) {
  if (!url || typeof url !== 'string') {
    return {
      valid: false,
      error: 'Invalid input: URL must be a non-empty string'
    };
  }

  // Trim whitespace and remove trailing slashes
  let normalizedUrl = url.trim().replace(/\/+$/, '');

  // Check if this looks like a valid GitHub-related input
  // Reject clearly invalid inputs (spaces in the URL, special chars at the start, etc.)
  if (/\s/.test(normalizedUrl) || /^[!@#$%^&*()[\]{}|\\:;"'<>,?`~]/.test(normalizedUrl)) {
    return {
      valid: false,
      error: 'Invalid GitHub URL format'
    };
  }

  // Handle protocol normalization
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    // Check if it starts with github.com
    if (normalizedUrl.startsWith('github.com/')) {
      normalizedUrl = 'https://' + normalizedUrl;
    } else if (!normalizedUrl.includes('github.com')) {
      // Assume it's a shorthand format (owner, owner/repo, owner/repo/issues/123, etc.)
      normalizedUrl = 'https://github.com/' + normalizedUrl;
    } else {
      // Has github.com somewhere but not at the start - likely malformed
      return {
        valid: false,
        error: 'Invalid GitHub URL format'
      };
    }
  }

  // Convert http to https
  if (normalizedUrl.startsWith('http://')) {
    normalizedUrl = normalizedUrl.replace(/^http:\/\//, 'https://');
  }

  // Parse the URL
  let urlObj;
  try {
    urlObj = new globalThis.URL(normalizedUrl);
  } catch (e) {
    if (global.verboseMode) {
      reportError(e, {
        context: 'github.lib.mjs - URL parsing',
        level: 'debug',
        url: normalizedUrl
      });
    }
    return {
      valid: false,
      error: 'Invalid URL format'
    };
  }

  // Ensure it's a GitHub URL
  if (urlObj.hostname !== 'github.com' && urlObj.hostname !== 'www.github.com') {
    return {
      valid: false,
      error: 'Not a GitHub URL'
    };
  }

  // Normalize hostname
  if (urlObj.hostname === 'www.github.com') {
    normalizedUrl = normalizedUrl.replace('www.github.com', 'github.com');
    urlObj = new globalThis.URL(normalizedUrl);
  }

  // Parse the pathname
  const pathParts = urlObj.pathname.split('/').filter(p => p);

  // Handle different GitHub URL patterns
  const result = {
    valid: true,
    normalized: normalizedUrl,
    hostname: 'github.com',
    protocol: 'https',
    path: urlObj.pathname
  };

  // No path - just github.com
  if (pathParts.length === 0) {
    result.type = 'home';
    return result;
  }

  // User/Organization page: /owner
  if (pathParts.length === 1) {
    result.type = 'user';
    result.owner = pathParts[0];
    return result;
  }

  // Set owner for all other cases
  result.owner = pathParts[0];

  // Repository page: /owner/repo
  if (pathParts.length === 2) {
    result.type = 'repo';
    result.repo = pathParts[1];
    return result;
  }

  // Set repo for paths with 3+ parts
  result.repo = pathParts[1];

  // Handle specific GitHub paths
  const thirdPart = pathParts[2];

  switch (thirdPart) {
    case 'issues':
      if (pathParts.length === 3) {
        // /owner/repo/issues - issues list
        result.type = 'issues_list';
      } else if (pathParts.length === 4 && /^\d+$/.test(pathParts[3])) {
        // /owner/repo/issues/123 - specific issue
        result.type = 'issue';
        result.number = parseInt(pathParts[3]);
      } else {
        result.type = 'issues_page';
        result.subpath = pathParts.slice(3).join('/');
      }
      break;

    case 'pull':
      if (pathParts.length === 4 && /^\d+$/.test(pathParts[3])) {
        // /owner/repo/pull/456 - specific PR
        result.type = 'pull';
        result.number = parseInt(pathParts[3]);
      } else {
        result.type = 'pull_page';
        result.subpath = pathParts.slice(3).join('/');
      }
      break;

    case 'pulls':
      // /owner/repo/pulls - PR list
      result.type = 'pulls_list';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
      }
      break;

    case 'actions':
      // /owner/repo/actions - GitHub Actions
      result.type = 'actions';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
        if (pathParts[3] === 'runs' && pathParts[4] && /^\d+$/.test(pathParts[4])) {
          result.type = 'action_run';
          result.runId = parseInt(pathParts[4]);
        }
      }
      break;

    case 'releases':
      // /owner/repo/releases
      result.type = 'releases';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
        if (pathParts[3] === 'tag' && pathParts[4]) {
          result.type = 'release';
          result.tag = pathParts[4];
        }
      }
      break;

    case 'tree':
    case 'blob':
      // /owner/repo/tree/branch or /owner/repo/blob/branch/file
      result.type = thirdPart === 'tree' ? 'tree' : 'file';
      if (pathParts.length > 3) {
        result.branch = pathParts[3];
        if (pathParts.length > 4) {
          result.filepath = pathParts.slice(4).join('/');
        }
      }
      break;

    case 'commit':
    case 'commits':
      // /owner/repo/commit/sha or /owner/repo/commits/branch
      result.type = thirdPart === 'commit' ? 'commit' : 'commits';
      if (pathParts.length > 3) {
        result.ref = pathParts[3]; // Could be SHA or branch
      }
      break;

    case 'compare':
      // /owner/repo/compare/base...head
      result.type = 'compare';
      if (pathParts.length > 3) {
        result.comparison = pathParts[3];
      }
      break;

    case 'wiki':
      // /owner/repo/wiki
      result.type = 'wiki';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
      }
      break;

    case 'settings':
      // /owner/repo/settings
      result.type = 'settings';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
      }
      break;

    case 'projects':
      // /owner/repo/projects or /owner/repo/projects/1
      result.type = 'projects';
      if (pathParts.length > 3 && /^\d+$/.test(pathParts[3])) {
        result.type = 'project';
        result.projectNumber = parseInt(pathParts[3]);
      }
      break;

    default:
      // Unknown path structure but still valid GitHub URL
      result.type = 'other';
      result.subpath = pathParts.slice(2).join('/');
  }

  return result;
}

/**
 * Normalize a GitHub URL to standard https://github.com format
 * This is a convenience function that uses parseGitHubUrl
 * @param {string} url - The URL to normalize
 * @returns {string|null} The normalized URL or null if invalid
 */
export function normalizeGitHubUrl(url) {
  const parsed = parseGitHubUrl(url);
  return parsed.valid ? parsed.normalized : null;
}

/**
 * Check if a URL is a valid GitHub URL of a specific type
 * @param {string} url - The URL to check
 * @param {string|Array} types - The type(s) to check for ('issue', 'pull', 'repo', etc.)
 * @returns {boolean} True if the URL matches the specified type(s)
 */
export function isGitHubUrlType(url, types) {
  const parsed = parseGitHubUrl(url);
  if (!parsed.valid) return false;

  const typeArray = Array.isArray(types) ? types : [types];
  return typeArray.includes(parsed.type);
}

/**
 * Universal function to view a pull request using gh pr view
 * @param {Object} options - Configuration options
 * @param {number|string} options.prNumber - PR number to view
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {string} [options.jsonFields='headRefName,body,number,mergeStateStatus,state,headRepositoryOwner'] - JSON fields to return
 * @returns {Promise<{code: number, stdout: string, stderr: string, data: Object|null}>}
 */
export async function ghPrView({ prNumber, owner, repo, jsonFields = 'headRefName,body,number,mergeStateStatus,state,headRepositoryOwner' }) {
  try {
    const prResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json ${jsonFields}`;
    const stdout = prResult.stdout.toString();
    const stderr = prResult.stderr ? prResult.stderr.toString() : '';
    const code = prResult.code || 0;

    let data = null;
    if (code === 0 && stdout && !stdout.includes('Could not resolve')) {
      try {
        data = JSON.parse(stdout);
      } catch {
        // If JSON parsing fails, data remains null
      }
    }

    return {
      code,
      stdout,
      stderr,
      data,
      output: stdout + stderr
    };
  } catch (error) {
    return {
      code: error.code || 1,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message || '',
      data: null,
      output: (error.stdout?.toString() || '') + (error.stderr?.toString() || error.message || '')
    };
  }
}

/**
 * Universal function to view an issue using gh issue view
 * @param {Object} options - Configuration options
 * @param {number|string} options.issueNumber - Issue number to view
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {string} [options.jsonFields='number,title'] - JSON fields to return
 * @returns {Promise<{code: number, stdout: string, stderr: string, data: Object|null}>}
 */
export async function ghIssueView({ issueNumber, owner, repo, jsonFields = 'number,title' }) {
  try {
    const issueResult = await $`gh issue view ${issueNumber} --repo ${owner}/${repo} --json ${jsonFields}`;
    const stdout = issueResult.stdout.toString();
    const stderr = issueResult.stderr ? issueResult.stderr.toString() : '';
    const code = issueResult.code || 0;

    let data = null;
    if (code === 0 && stdout && !stdout.includes('Could not resolve')) {
      try {
        data = JSON.parse(stdout);
      } catch {
        // If JSON parsing fails, data remains null
      }
    }

    return {
      code,
      stdout,
      stderr,
      data,
      output: stdout + stderr
    };
  } catch (error) {
    return {
      code: error.code || 1,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message || '',
      data: null,
      output: (error.stdout?.toString() || '') + (error.stderr?.toString() || error.message || '')
    };
  }
}

/**
 * Handle PR not found error and check if an issue exists with the same number
 * Provides user-friendly error messages and command suggestions
 * @param {Object} options - Configuration options
 * @param {number} options.prNumber - PR number that doesn't exist
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {Object} options.argv - Command line arguments object (for reconstructing command)
 * @param {boolean} [options.shouldAttachLogs] - Whether --attach-logs was used
 * @returns {Promise<void>}
 */
export async function handlePRNotFoundError({ prNumber, owner, repo, argv, shouldAttachLogs }) {
  await log(`Error: PR #${prNumber} does not exist in ${owner}/${repo}`, { level: 'error' });
  await log('', { level: 'error' });

  try {
    const issueCheckResult = await ghIssueView({ issueNumber: prNumber, owner, repo, jsonFields: 'number,title' });

    if (issueCheckResult.code === 0 && issueCheckResult.data) {
      await log(`💡 However, Issue #${prNumber} exists with the same number:`, { level: 'error' });
      await log(`   Title: "${issueCheckResult.data.title}"`, { level: 'error' });
      await log('', { level: 'error' });
      await log('🔧 Did you mean to work on the issue instead?', { level: 'error' });
      await log('   Try this corrected command:', { level: 'error' });
      await log('', { level: 'error' });

      const commandParts = [`solve https://github.com/${owner}/${repo}/issues/${prNumber}`];
      if (argv.autoContinue) commandParts.push('--auto-continue');
      if (shouldAttachLogs || argv.attachLogs || argv['attach-logs']) commandParts.push('--attach-logs');
      if (argv.verbose) commandParts.push('--verbose');
      if (argv.model && argv.model !== 'sonnet') commandParts.push('--model', argv.model);
      if (argv.think) commandParts.push('--think', argv.think);

      await log(`   ${commandParts.join(' ')}`, { level: 'error' });
      await log('', { level: 'error' });
    }
  } catch {
    // Silently ignore if issue check fails
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
  fetchAllIssuesWithPagination,
  fetchProjectIssues,
  isRateLimitError,
  batchCheckPullRequestsForIssues,
  parseGitHubUrl,
  normalizeGitHubUrl,
  isGitHubUrlType,
  ghPrView,
  ghIssueView,
  handlePRNotFoundError
};