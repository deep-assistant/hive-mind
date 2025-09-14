#!/usr/bin/env sh
':' //# ; exec "$(command -v bun || command -v node)" "$0" "$@"

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

// Export all functions as default object too
export default {
  maskGitHubToken,
  getGitHubTokensFromFiles,
  getGitHubTokensFromCommand,
  sanitizeLogContent,
  checkFileInBranch,
  checkGitHubPermissions
};