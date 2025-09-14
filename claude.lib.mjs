#!/usr/bin/env node
// Claude CLI-related utility functions

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;

// Import log from general lib
import { log, cleanErrorMessage } from './lib.mjs';

// Function to validate Claude CLI connection
export const validateClaudeConnection = async () => {
  try {
    await log(`🔍 Validating Claude CLI connection...`);
    
    // First try a quick validation approach
    try {
      // Check if Claude CLI is installed and get version
      const versionResult = await $`timeout 10 claude --version`;
      if (versionResult.code === 0) {
        const version = versionResult.stdout?.toString().trim();
        await log(`📦 Claude CLI version: ${version}`);
      }
    } catch (versionError) {
      // Version check failed, but we'll continue with the main validation
      await log(`⚠️  Claude CLI version check failed (${versionError.code}), proceeding with connection test...`);
    }
    
    let result;
    try {
      // Primary validation: use printf piping with sonnet model (cheapest)
      result = await $`printf hi | claude --model sonnet -p`;
    } catch (pipeError) {
      // If piping fails, fallback to the timeout approach as last resort
      await log(`⚠️  Pipe validation failed (${pipeError.code}), trying timeout approach...`);
      try {
        result = await $`timeout 60 claude --model sonnet -p hi`;
      } catch (timeoutError) {
        if (timeoutError.code === 124) {
          await log(`❌ Claude CLI timed out after 60 seconds`, { level: 'error' });
          await log(`   💡 This may indicate Claude CLI is taking too long to respond`, { level: 'error' });
          await log(`   💡 Try running 'claude --model sonnet -p hi' manually to verify it works`, { level: 'error' });
          return false;
        }
        // Re-throw if it's not a timeout error
        throw timeoutError;
      }
    }
    
    // Check for common error patterns
    const stdout = result.stdout?.toString() || '';
    const stderr = result.stderr?.toString() || '';
    
    // Check for JSON errors in stdout or stderr
    const checkForJsonError = (text) => {
      try {
        // Look for JSON error patterns
        if (text.includes('"error"') && text.includes('"type"')) {
          const jsonMatch = text.match(/\{.*"error".*\}/);
          if (jsonMatch) {
            const errorObj = JSON.parse(jsonMatch[0]);
            return errorObj.error;
          }
        }
      } catch (e) {
        // Not valid JSON, continue with other checks
      }
      return null;
    };
    
    const jsonError = checkForJsonError(stdout) || checkForJsonError(stderr);
    
    // Use exitCode if code is undefined (Bun shell behavior)
    const exitCode = result.code ?? result.exitCode ?? 0;
    
    if (exitCode !== 0) {
      // Command failed
      if (jsonError) {
        await log(`❌ Claude CLI authentication failed: ${jsonError.type} - ${jsonError.message}`, { level: 'error' });
      } else {
        await log(`❌ Claude CLI failed with exit code ${exitCode}`, { level: 'error' });
        if (stderr) await log(`   Error: ${stderr.trim()}`, { level: 'error' });
      }
      
      if (stderr.includes('Please run /login') || (jsonError && jsonError.type === 'forbidden')) {
        await log('   💡 Please run: claude login', { level: 'error' });
      }
      
      return false;
    }
    
    // Check for error patterns in successful response
    if (jsonError) {
      await log(`❌ Claude CLI returned error: ${jsonError.type} - ${jsonError.message}`, { level: 'error' });
      if (jsonError.type === 'forbidden') {
        await log('   💡 Please run: claude login', { level: 'error' });
      }
      return false;
    }
    
    // Success - Claude responded (LLM responses are probabilistic, so any response is good)
    await log(`✅ Claude CLI connection validated successfully`);
    return true;
    
  } catch (error) {
    await log(`❌ Failed to validate Claude CLI connection: ${error.message}`, { level: 'error' });
    await log('   💡 Make sure Claude CLI is installed and accessible', { level: 'error' });
    return false;
  }
};

// Function to handle Claude runtime switching between Node.js and Bun
export const handleClaudeRuntimeSwitch = async (argv) => {
  if (argv['force-claude-bun-run']) {
    await log(`\n🔧 Switching Claude runtime to bun...`);
    try {
      // Check if bun is available
      try {
        await $`which bun`;
        await log(`   ✅ Bun runtime found`);
      } catch (bunError) {
        await log(`❌ Bun runtime not found. Please install bun first: https://bun.sh/`, { level: 'error' });
        process.exit(1);
      }
      
      // Find Claude executable path
      const claudePathResult = await $`which claude`;
      const claudePath = claudePathResult.stdout.toString().trim();
      
      if (!claudePath) {
        await log(`❌ Claude executable not found`, { level: 'error' });
        process.exit(1);
      }
      
      await log(`   Claude path: ${claudePath}`);
      
      // Check if file is writable
      try {
        await fs.access(claudePath, fs.constants.W_OK);
      } catch (accessError) {
        await log(`❌ Cannot write to Claude executable (permission denied)`, { level: 'error' });
        await log(`   Try running with sudo or changing file permissions`, { level: 'error' });
        process.exit(1);
      }
      
      // Read current shebang
      const firstLine = await $`head -1 "${claudePath}"`;
      const currentShebang = firstLine.stdout.toString().trim();
      await log(`   Current shebang: ${currentShebang}`);
      
      if (currentShebang.includes('bun')) {
        await log(`   ✅ Claude is already configured to use bun`);
        process.exit(0);
      }
      
      // Create backup
      const backupPath = `${claudePath}.nodejs-backup`;
      await $`cp "${claudePath}" "${backupPath}"`;
      await log(`   📦 Backup created: ${backupPath}`);
      
      // Read file content and replace shebang
      const content = await fs.readFile(claudePath, 'utf8');
      const newContent = content.replace(/^#!.*node.*$/m, '#!/usr/bin/env bun');
      
      if (content === newContent) {
        await log(`⚠️  No Node.js shebang found to replace`, { level: 'warning' });
        await log(`   Current shebang: ${currentShebang}`, { level: 'warning' });
        process.exit(0);
      }
      
      await fs.writeFile(claudePath, newContent);
      await log(`   ✅ Claude shebang updated to use bun`);
      await log(`   🔄 Claude will now run with bun runtime`);
      
    } catch (error) {
      await log(`❌ Failed to switch Claude to bun: ${cleanErrorMessage(error)}`, { level: 'error' });
      process.exit(1);
    }
    
    // Exit after switching runtime
    process.exit(0);
  }
  
  if (argv['force-claude-nodejs-run']) {
    await log(`\n🔧 Restoring Claude runtime to Node.js...`);
    try {
      // Check if Node.js is available
      try {
        await $`which node`;
        await log(`   ✅ Node.js runtime found`);
      } catch (nodeError) {
        await log(`❌ Node.js runtime not found. Please install Node.js first`, { level: 'error' });
        process.exit(1);
      }
      
      // Find Claude executable path
      const claudePathResult = await $`which claude`;
      const claudePath = claudePathResult.stdout.toString().trim();
      
      if (!claudePath) {
        await log(`❌ Claude executable not found`, { level: 'error' });
        process.exit(1);
      }
      
      await log(`   Claude path: ${claudePath}`);
      
      // Check if file is writable
      try {
        await fs.access(claudePath, fs.constants.W_OK);
      } catch (accessError) {
        await log(`❌ Cannot write to Claude executable (permission denied)`, { level: 'error' });
        await log(`   Try running with sudo or changing file permissions`, { level: 'error' });
        process.exit(1);
      }
      
      // Read current shebang
      const firstLine = await $`head -1 "${claudePath}"`;
      const currentShebang = firstLine.stdout.toString().trim();
      await log(`   Current shebang: ${currentShebang}`);
      
      if (currentShebang.includes('node') && !currentShebang.includes('bun')) {
        await log(`   ✅ Claude is already configured to use Node.js`);
        process.exit(0);
      }
      
      // Check if backup exists
      const backupPath = `${claudePath}.nodejs-backup`;
      try {
        await fs.access(backupPath);
        // Restore from backup
        await $`cp "${backupPath}" "${claudePath}"`;
        await log(`   ✅ Restored Claude from backup: ${backupPath}`);
      } catch (backupError) {
        // No backup available, manually update shebang
        await log(`   📝 No backup found, manually updating shebang...`);
        const content = await fs.readFile(claudePath, 'utf8');
        const newContent = content.replace(/^#!.*bun.*$/m, '#!/usr/bin/env node');
        
        if (content === newContent) {
          await log(`⚠️  No bun shebang found to replace`, { level: 'warning' });
          await log(`   Current shebang: ${currentShebang}`, { level: 'warning' });
          process.exit(0);
        }
        
        await fs.writeFile(claudePath, newContent);
        await log(`   ✅ Claude shebang updated to use Node.js`);
      }
      
      await log(`   🔄 Claude will now run with Node.js runtime`);
      
    } catch (error) {
      await log(`❌ Failed to restore Claude to Node.js: ${cleanErrorMessage(error)}`, { level: 'error' });
      process.exit(1);
    }
    
    // Exit after restoring runtime
    process.exit(0);
  }
};

// Export all functions as default object too
export default {
  validateClaudeConnection,
  handleClaudeRuntimeSwitch
};