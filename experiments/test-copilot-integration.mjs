#!/usr/bin/env node

/**
 * Test script for copilot tool integration
 * Tests basic copilot CLI functionality and integration
 */

// Import use-m for module loading
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
globalThis.use = use;

const { $ } = await use('command-stream');

// Import copilot library functions
const copilotLib = await import('../src/copilot.lib.mjs');
const { validateCopilotConnection, mapModelToId } = copilotLib;

console.log('🧪 Testing Copilot Integration\n');

// Test 1: Model mapping
console.log('Test 1: Model mapping');
console.log('  Testing model aliases...');
const tests = [
  { input: 'sonnet', expected: 'claude-sonnet-4.5' },
  { input: 'sonnet-4.5', expected: 'claude-sonnet-4.5' },
  { input: 'gpt-5', expected: 'gpt-5' },
  { input: 'unknown-model', expected: 'unknown-model' }
];

for (const test of tests) {
  const result = mapModelToId(test.input);
  const passed = result === test.expected;
  console.log(`    ${passed ? '✅' : '❌'} ${test.input} -> ${result} (expected: ${test.expected})`);
}

// Test 2: Check if copilot CLI is available
console.log('\nTest 2: Copilot CLI availability');
try {
  const versionResult = await $`copilot --version`;
  if (versionResult.code === 0) {
    const version = versionResult.stdout?.toString().trim();
    console.log(`  ✅ Copilot CLI found: ${version}`);
  } else {
    console.log('  ❌ Copilot CLI not found or failed to return version');
  }
} catch (error) {
  console.log(`  ❌ Error checking copilot: ${error.message}`);
}

// Test 3: Validate copilot connection
console.log('\nTest 3: Copilot connection validation');
try {
  const isValid = await validateCopilotConnection('claude-sonnet-4.5');
  console.log(`  ${isValid ? '✅' : '❌'} Connection validation result: ${isValid}`);
} catch (error) {
  console.log(`  ❌ Error validating connection: ${error.message}`);
}

console.log('\n✅ Copilot integration test completed!');
