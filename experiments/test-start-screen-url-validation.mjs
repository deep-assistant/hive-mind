#!/usr/bin/env node
// Test script to verify start-screen URL validation works with various URL patterns
// This addresses issue #539: ensure start-screen uses the same validation as hive/solve commands

import { parseGitHubUrl } from '../src/github.lib.mjs';

console.log('Testing start-screen URL validation for issue #539');
console.log('=' .repeat(70));

// Test cases from the issue and expected valid cases
const testCases = [
  // Issue #539 case - owner profile URL
  {
    url: 'https://github.com/konard',
    expectedValid: true,
    expectedType: 'user',
    description: 'Owner profile URL (from issue #539)'
  },
  // Other valid cases that hive supports
  {
    url: 'https://github.com/deep-assistant',
    expectedValid: true,
    expectedType: 'user',
    description: 'Another owner profile URL'
  },
  {
    url: 'https://github.com/deep-assistant/hive-mind',
    expectedValid: true,
    expectedType: 'repo',
    description: 'Repository URL'
  },
  {
    url: 'deep-assistant/hive-mind',
    expectedValid: true,
    expectedType: 'repo',
    description: 'Shorthand repo URL'
  },
  {
    url: 'konard',
    expectedValid: true,
    expectedType: 'user',
    description: 'Shorthand owner URL'
  },
  // Solve command URLs
  {
    url: 'https://github.com/deep-assistant/hive-mind/issues/539',
    expectedValid: true,
    expectedType: 'issue',
    description: 'Issue URL'
  },
  {
    url: 'https://github.com/deep-assistant/hive-mind/pull/620',
    expectedValid: true,
    expectedType: 'pull',
    description: 'Pull request URL'
  },
  // Invalid cases
  {
    url: 'https://example.com/repo',
    expectedValid: false,
    description: 'Non-GitHub URL'
  },
  {
    url: '',
    expectedValid: false,
    description: 'Empty string'
  },
  {
    url: 'https://github.com',
    expectedValid: true,
    expectedType: 'home',
    description: 'GitHub homepage'
  }
];

let passedTests = 0;
let failedTests = 0;

for (const testCase of testCases) {
  console.log(`\nTest: ${testCase.description}`);
  console.log(`  URL: "${testCase.url}"`);

  const result = parseGitHubUrl(testCase.url);

  const validMatch = result.valid === testCase.expectedValid;
  const typeMatch = !testCase.expectedType || result.type === testCase.expectedType;

  if (validMatch && typeMatch) {
    console.log(`  ✅ PASS`);
    console.log(`     Valid: ${result.valid}`);
    if (result.valid) {
      console.log(`     Type: ${result.type}`);
      console.log(`     Normalized: ${result.normalized}`);
      if (result.owner) console.log(`     Owner: ${result.owner}`);
      if (result.repo) console.log(`     Repo: ${result.repo}`);
      if (result.number) console.log(`     Number: ${result.number}`);
    } else {
      console.log(`     Error: ${result.error}`);
    }
    passedTests++;
  } else {
    console.log(`  ❌ FAIL`);
    console.log(`     Expected valid: ${testCase.expectedValid}, Got: ${result.valid}`);
    if (testCase.expectedType) {
      console.log(`     Expected type: ${testCase.expectedType}, Got: ${result.type}`);
    }
    if (result.error) {
      console.log(`     Error: ${result.error}`);
    }
    failedTests++;
  }
}

console.log('\n' + '='.repeat(70));
console.log(`Results: ${passedTests} passed, ${failedTests} failed`);

if (failedTests > 0) {
  process.exit(1);
}

console.log('\n✅ All tests passed! start-screen now uses the same URL validation as hive/solve commands.');
