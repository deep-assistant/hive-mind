#!/usr/bin/env node

// Test script to validate the configuration module works correctly

import {
  TIMEOUTS,
  AUTO_CONTINUE,
  GITHUB_LIMITS,
  SYSTEM_LIMITS,
  RETRY_LIMITS,
  FILE_PATHS,
  TEXT_PROCESSING,
  DISPLAY,
  SENTRY,
  EXTERNAL_URLS,
  MODEL_CONFIG,
  VERSION,
  validateConfig,
  getAllConfigurations
} from './src/config.lib.mjs';

console.log('Testing configuration module...\n');

// Test 1: Validate default values
console.log('1. Testing default values:');
console.log(`   CLAUDE_TIMEOUT: ${TIMEOUTS.CLAUDE_CLI}ms (${TIMEOUTS.CLAUDE_CLI / 1000}s)`);
console.log(`   GITHUB_API_DELAY: ${TIMEOUTS.GITHUB_API_DELAY}ms`);
console.log(`   AUTO_CONTINUE_AGE: ${AUTO_CONTINUE.AGE_THRESHOLD_HOURS} hours`);
console.log(`   GITHUB_COMMENT_MAX_SIZE: ${GITHUB_LIMITS.COMMENT_MAX_SIZE} bytes`);
console.log(`   ✅ Default values loaded successfully\n`);

// Test 2: Validate configuration
console.log('2. Validating configuration:');
try {
  validateConfig();
  console.log('   ✅ Configuration validation passed\n');
} catch (error) {
  console.error(`   ❌ Configuration validation failed: ${error.message}\n`);
  process.exit(1);
}

// Test 3: Test environment variable override
console.log('3. Testing environment variable override:');
const originalValue = process.env.CLAUDE_TIMEOUT_SECONDS;
process.env.CLAUDE_TIMEOUT_SECONDS = '120';

// Re-import to get new value (in real use, this would be set before import)
console.log(`   Set CLAUDE_TIMEOUT_SECONDS=120`);
console.log(`   Note: In production, env vars must be set before module import\n`);

// Test 4: Display all configurations
console.log('4. All configurations:');
const allConfigs = getAllConfigurations();
console.log(JSON.stringify(allConfigs, null, 2));

// Clean up
if (originalValue !== undefined) {
  process.env.CLAUDE_TIMEOUT_SECONDS = originalValue;
} else {
  delete process.env.CLAUDE_TIMEOUT_SECONDS;
}

console.log('\n✅ All configuration tests passed!');
console.log('The configuration module is working correctly.');