#!/usr/bin/env node

// Simple test script to verify Claude connection validation logic
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

// Simple logging function for testing
const log = async (message, options = {}) => {
  const { level = 'info' } = options;
  switch (level) {
    case 'error':
      console.error(message);
      break;
    case 'warning':
      console.warn(message);
      break;
    default:
      console.log(message);
  }
};

// Clean error message function
const cleanErrorMessage = (error) => {
  let message = error.message || error.toString();
  message = message.split('\n')[0];
  message = message.replace(/^Command failed: /, '');
  message = message.replace(/^Error: /, '');
  message = message.replace(/^\/bin\/sh: \d+: /, '');
  return message;
};

// Test version of validateClaudeConnection function
const validateClaudeConnection = async () => {
  try {
    await log(`🔍 Validating Claude CLI connection...`);
    
    const result = await $`claude -p hi`;
    
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
    
    if (result.code !== 0) {
      // Command failed
      if (jsonError) {
        await log(`❌ Claude CLI authentication failed: ${jsonError.type} - ${jsonError.message}`, { level: 'error' });
      } else {
        await log(`❌ Claude CLI failed with exit code ${result.code}`, { level: 'error' });
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
    await log(`❌ Failed to validate Claude CLI connection: ${cleanErrorMessage(error)}`, { level: 'error' });
    await log('   💡 Make sure Claude CLI is installed and accessible', { level: 'error' });
    return false;
  }
};

// Test the function
console.log('Testing Claude CLI validation...\n');
const result = await validateClaudeConnection();
console.log(`\nValidation result: ${result ? 'SUCCESS' : 'FAILED'}`);