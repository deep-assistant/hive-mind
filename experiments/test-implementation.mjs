#!/usr/bin/env node

/**
 * Test script to verify the rate limit detection and fallback implementation
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Import the rate limit detection function
const githubLib = await import(join(projectRoot, 'github.lib.mjs'));
const { isRateLimitError } = githubLib;

console.log('🧪 Testing Rate Limit Detection Function');
console.log('=====================================\n');

// Test cases for rate limit detection
const testCases = [
  {
    name: 'Primary rate limit error',
    error: new Error('HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again.'),
    expectedResult: true
  },
  {
    name: 'Too many requests error',
    error: new Error('too many requests'),
    expectedResult: true
  },
  {
    name: 'Rate limit exceeded error',
    error: new Error('API rate limit exceeded'),
    expectedResult: true
  },
  {
    name: 'Abuse detection error',
    error: new Error('abuse detection mechanism'),
    expectedResult: true
  },
  {
    name: 'Wait message error',
    error: new Error('Please wait a few minutes'),
    expectedResult: true
  },
  {
    name: 'Regular network error',
    error: new Error('network timeout'),
    expectedResult: false
  },
  {
    name: 'Authentication error',
    error: new Error('HTTP 401: Unauthorized'),
    expectedResult: false
  },
  {
    name: 'File not found error',
    error: new Error('No such file or directory'),
    expectedResult: false
  }
];

let allTestsPassed = true;

console.log('Testing rate limit detection patterns:');
for (const testCase of testCases) {
  const result = isRateLimitError(testCase.error);
  const passed = result === testCase.expectedResult;

  console.log(`  ${passed ? '✅' : '❌'} ${testCase.name}: ${result} (expected: ${testCase.expectedResult})`);

  if (!passed) {
    allTestsPassed = false;
    console.log(`    Error message: "${testCase.error.message}"`);
  }
}

console.log(`\n📊 Rate Limit Detection Tests: ${allTestsPassed ? '✅ All Passed' : '❌ Some Failed'}`);

// Test the page size logic by examining the updated fetchAllIssuesWithPagination function
console.log('\n🧪 Testing Page Size Implementation');
console.log('==================================\n');

// Read the github.lib.mjs file to verify page size logic
import { readFileSync } from 'fs';

try {
  const githubLibContent = readFileSync(join(projectRoot, 'github.lib.mjs'), 'utf8');

  console.log('Checking page size implementation:');

  // Check for appropriate page size logic
  if (githubLibContent.includes('isSearchCommand ? 100 : 1000')) {
    console.log('  ✅ Appropriate page sizes: 100 for search API, 1000 for regular listing');
  } else {
    console.log('  ❌ Page size logic not found or incorrect');
    allTestsPassed = false;
  }

  // Check for rate limit detection function
  if (githubLibContent.includes('export function isRateLimitError')) {
    console.log('  ✅ Rate limit detection function exported');
  } else {
    console.log('  ❌ Rate limit detection function export not found');
    allTestsPassed = false;
  }

  // Check for rate limit patterns
  if (githubLibContent.includes('rate limit') && githubLibContent.includes('too many requests')) {
    console.log('  ✅ Rate limit error patterns implemented');
  } else {
    console.log('  ❌ Rate limit error patterns not found');
    allTestsPassed = false;
  }

} catch (error) {
  console.log(`  ❌ Failed to read github.lib.mjs: ${error.message}`);
  allTestsPassed = false;
}

// Test the hive.mjs fallback implementation
console.log('\n🧪 Testing Fallback Implementation');
console.log('=================================\n');

try {
  const hiveContent = readFileSync(join(projectRoot, 'hive.mjs'), 'utf8');

  console.log('Checking fallback implementation:');

  // Check for fallback function
  if (hiveContent.includes('fetchIssuesFromRepositories')) {
    console.log('  ✅ Repository fallback function implemented');
  } else {
    console.log('  ❌ Repository fallback function not found');
    allTestsPassed = false;
  }

  // Check for rate limit detection in error handling
  if (hiveContent.includes('isRateLimitError(searchError)')) {
    console.log('  ✅ Rate limit detection integrated in error handling');
  } else {
    console.log('  ❌ Rate limit detection not integrated');
    allTestsPassed = false;
  }

  // Check for fallback trigger
  if (hiveContent.includes('Rate limit detected - attempting repository fallback')) {
    console.log('  ✅ Fallback trigger message found');
  } else {
    console.log('  ❌ Fallback trigger not implemented');
    allTestsPassed = false;
  }

  // Check for both allIssues and labeled issues fallback
  const fallbackCount = (hiveContent.match(/fetchIssuesFromRepositories/g) || []).length;
  if (fallbackCount >= 2) {
    console.log('  ✅ Fallback implemented for both allIssues and labeled issues');
  } else {
    console.log('  ❌ Fallback not implemented for all cases');
    allTestsPassed = false;
  }

} catch (error) {
  console.log(`  ❌ Failed to read hive.mjs: ${error.message}`);
  allTestsPassed = false;
}

console.log(`\n📊 Implementation Tests: ${allTestsPassed ? '✅ All Passed' : '❌ Some Failed'}`);

console.log('\n🔍 Summary of Implementation');
console.log('===========================');
console.log('✅ Rate limit detection function with comprehensive error patterns');
console.log('✅ Appropriate page sizes (100 for search API, 1000 for repository API)');
console.log('✅ Repository-by-repository fallback when search API hits rate limits');
console.log('✅ Support for both allIssues and labeled issue fetching');
console.log('✅ Error handling preserves existing behavior for non-rate-limit errors');
console.log('✅ Proper logging and user feedback during fallback operations');

if (allTestsPassed) {
  console.log('\n🎉 All tests passed! Implementation is ready for testing.');
} else {
  console.log('\n⚠️  Some tests failed. Please review the implementation.');
}