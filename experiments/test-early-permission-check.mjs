#!/usr/bin/env node

/**
 * Test script to verify early permission check functionality
 * This test verifies that the tool fails early when:
 * 1. User doesn't have write access to a repository
 * 2. --fork option is not used
 *
 * Test cases:
 * 1. Repository with no write access, no --fork flag → should fail early with helpful message
 * 2. Repository with no write access, with --fork flag → should pass permission check (will use fork)
 * 3. Repository with write access → should pass permission check
 */

// Dynamically import the permission check function
const githubLib = await import('../src/github.lib.mjs');
const { checkRepositoryWritePermission } = githubLib;

// Mock log function to capture output
const logs = [];
const mockLog = async (message, options = {}) => {
  logs.push({ message, level: options.level || 'info' });
  console.log(message);
};

// Temporarily replace log in the module
global.log = mockLog;

console.log('🧪 Testing early permission check functionality\n');

// Test 1: Repository without write access, no fork
console.log('📋 Test 1: Repository without write access, no --fork flag');
console.log('   Expected: Should fail with helpful error message\n');

logs.length = 0;
const test1Result = await checkRepositoryWritePermission(
  'veb86',
  'zcadvelecAI',
  {
    useFork: false,
    issueUrl: 'https://github.com/veb86/zcadvelecAI/issues/63'
  }
);

console.log(`\n   Result: ${test1Result ? 'PASSED ✅' : 'FAILED ❌ (expected)'}`);
if (!test1Result) {
  const errorLogs = logs.filter(l => l.level === 'error');
  const hasForkSuggestion = errorLogs.some(l => l.message.includes('--fork'));
  console.log(`   Fork suggestion present: ${hasForkSuggestion ? 'YES ✅' : 'NO ❌'}`);
  console.log(`   Error messages: ${errorLogs.length} ✅`);
} else {
  console.log('   ⚠️  Expected failure but got success - might have access now');
}

// Test 2: Repository without write access, with fork flag
console.log('\n📋 Test 2: Repository without write access, WITH --fork flag');
console.log('   Expected: Should skip check and pass\n');

logs.length = 0;
const test2Result = await checkRepositoryWritePermission(
  'veb86',
  'zcadvelecAI',
  {
    useFork: true,
    issueUrl: 'https://github.com/veb86/zcadvelecAI/issues/63'
  }
);

console.log(`\n   Result: ${test2Result ? 'PASSED ✅ (expected)' : 'FAILED ❌'}`);
const skippedMessage = logs.find(l => l.message.includes('Skipped') && l.message.includes('fork mode'));
console.log(`   Permission check skipped: ${skippedMessage ? 'YES ✅' : 'NO ❌'}`);

// Test 3: Repository with write access (this repo)
console.log('\n📋 Test 3: Repository with write access (hive-mind)');
console.log('   Expected: Should pass with confirmation message\n');

logs.length = 0;
const test3Result = await checkRepositoryWritePermission(
  'deep-assistant',
  'hive-mind',
  {
    useFork: false,
    issueUrl: 'https://github.com/deep-assistant/hive-mind/issues/439'
  }
);

console.log(`\n   Result: ${test3Result ? 'PASSED ✅ (expected)' : 'FAILED ❌'}`);
const confirmMessage = logs.find(l => l.message.includes('write access') && l.message.includes('Confirmed'));
console.log(`   Write access confirmed: ${confirmMessage ? 'YES ✅' : 'NO ❌'}`);

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 TEST SUMMARY');
console.log('='.repeat(60));
console.log(`Test 1 (No access, no fork): ${!test1Result ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 2 (No access, with fork): ${test2Result ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 3 (Has access): ${test3Result ? 'PASS ✅' : 'FAIL ❌'}`);
console.log('='.repeat(60));

const allPassed = !test1Result && test2Result && test3Result;
console.log(`\n${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

process.exit(allPassed ? 0 : 1);
