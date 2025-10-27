#!/usr/bin/env node
// Test script to verify start-screen URL validation fix
// This script tests that start-screen accepts the same URL formats as hive

import { parseGitHubUrl } from '../src/github.lib.mjs';

console.log('Testing GitHub URL validation for start-screen fix\n');
console.log('='.repeat(60));

// Test cases from the issue
const testCases = [
  // The problematic case from the issue
  { url: 'https://github.com/konard', expected: 'user' },

  // Additional test cases for comprehensive coverage
  { url: 'konard', expected: 'user' },
  { url: 'konard/repo', expected: 'repo' },
  { url: 'https://github.com/konard/repo', expected: 'repo' },
  { url: 'https://github.com/konard/repo/issues/123', expected: 'issue' },
  { url: 'github.com/konard', expected: 'user' },
  { url: 'http://github.com/konard/repo', expected: 'repo' },
];

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = parseGitHubUrl(testCase.url);

  console.log(`\nTest: "${testCase.url}"`);
  console.log(`  Expected type: ${testCase.expected}`);
  console.log(`  Valid: ${result.valid}`);
  console.log(`  Type: ${result.type}`);

  if (result.valid && result.type === testCase.expected) {
    console.log('  Status: ✅ PASS');
    passed++;
  } else {
    console.log('  Status: ❌ FAIL');
    if (!result.valid) {
      console.log(`  Error: ${result.error}`);
    }
    failed++;
  }

  if (result.valid) {
    console.log(`  Normalized: ${result.normalized}`);
    console.log(`  Owner: ${result.owner || 'N/A'}`);
    console.log(`  Repo: ${result.repo || 'N/A'}`);
    if (result.number) {
      console.log(`  Number: ${result.number}`);
    }
  }
}

console.log('\n' + '='.repeat(60));
console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('✅ All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed!');
  process.exit(1);
}
