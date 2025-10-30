#!/usr/bin/env node

/**
 * Unit tests for Telegram bot URL validation
 * Tests the validateGitHubUrl function to ensure it only accepts issue/PR URLs
 */

// Import the parseGitHubUrl function
const { parseGitHubUrl } = await import('../src/github.lib.mjs');

/**
 * Validate GitHub URL for /solve command
 * Ensures URL is a valid GitHub issue or pull request
 *
 * @param {string[]} args - Command arguments (first arg should be URL)
 * @returns {{ valid: boolean, error?: string }}
 */
function validateGitHubUrl(args) {
  if (args.length === 0) {
    return {
      valid: false,
      error: 'Missing GitHub URL. Usage: /solve <github-url> [options]'
    };
  }

  const url = args[0];
  if (!url.includes('github.com')) {
    return {
      valid: false,
      error: 'First argument must be a GitHub URL'
    };
  }

  // Parse the URL to ensure it's an issue or pull request
  const parsed = parseGitHubUrl(url);
  if (!parsed.valid) {
    return {
      valid: false,
      error: parsed.error || 'Invalid GitHub URL'
    };
  }

  // Only accept issue or pull request URLs
  if (parsed.type !== 'issue' && parsed.type !== 'pull') {
    return {
      valid: false,
      error: 'URL must be a GitHub issue or pull request (not just a repository URL)'
    };
  }

  return { valid: true };
}

console.log('===========================================');
console.log('Unit Tests: Telegram URL Validation');
console.log('===========================================\n');

// Test cases for valid URLs (should pass validation)
const validUrlTests = [
  {
    desc: 'Valid issue URL',
    args: ['https://github.com/deep-assistant/hive-mind/issues/630'],
    shouldPass: true
  },
  {
    desc: 'Valid PR URL',
    args: ['https://github.com/owner/repo/pull/123'],
    shouldPass: true
  },
  {
    desc: 'Valid issue URL with options',
    args: ['https://github.com/owner/repo/issues/456', '--auto-continue'],
    shouldPass: true
  },
  {
    desc: 'Valid PR URL with query params',
    args: ['https://github.com/owner/repo/pull/789?foo=bar'],
    shouldPass: true
  }
];

// Test cases for invalid URLs (should fail validation)
const invalidUrlTests = [
  {
    desc: 'Repository URL only (no issue/PR)',
    args: ['https://github.com/deep-assistant/master-plan'],
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue or pull request (not just a repository URL)'
  },
  {
    desc: 'Repository URL with trailing slash',
    args: ['https://github.com/owner/repo/'],
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue or pull request (not just a repository URL)'
  },
  {
    desc: 'User profile URL',
    args: ['https://github.com/owner'],
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue or pull request (not just a repository URL)'
  },
  {
    desc: 'Issues list URL (no specific issue)',
    args: ['https://github.com/owner/repo/issues'],
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue or pull request (not just a repository URL)'
  },
  {
    desc: 'Pull requests list URL (no specific PR)',
    args: ['https://github.com/owner/repo/pulls'],
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue or pull request (not just a repository URL)'
  },
  {
    desc: 'Missing URL',
    args: [],
    shouldPass: false,
    expectedError: 'Missing GitHub URL. Usage: /solve <github-url> [options]'
  },
  {
    desc: 'Non-GitHub URL',
    args: ['https://example.com/issues/123'],
    shouldPass: false,
    expectedError: 'First argument must be a GitHub URL'
  },
  {
    desc: 'GitHub Actions URL',
    args: ['https://github.com/owner/repo/actions/runs/123'],
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue or pull request (not just a repository URL)'
  },
  {
    desc: 'GitHub file URL',
    args: ['https://github.com/owner/repo/blob/main/README.md'],
    shouldPass: false,
    expectedError: 'URL must be a GitHub issue or pull request (not just a repository URL)'
  }
];

let passed = 0;
let failed = 0;

function runTest(testCase) {
  const result = validateGitHubUrl(testCase.args);
  const isValid = result.valid === testCase.shouldPass;
  const errorMatches = !testCase.expectedError || result.error === testCase.expectedError;
  const success = isValid && errorMatches;

  if (success) {
    passed++;
    console.log(`✅ PASS: ${testCase.desc}`);
  } else {
    failed++;
    console.log(`❌ FAIL: ${testCase.desc}`);
    console.log(`   Input:           ${JSON.stringify(testCase.args)}`);
    if (!isValid) {
      console.log(`   Expected valid:  ${testCase.shouldPass}`);
      console.log(`   Got valid:       ${result.valid}`);
    }
    if (!errorMatches) {
      console.log(`   Expected Error:  ${testCase.expectedError}`);
      console.log(`   Got Error:       ${result.error}`);
    }
  }
}

console.log('Test Suite 1: Valid URLs (Should Pass)\n');
for (const testCase of validUrlTests) {
  runTest(testCase);
}

console.log('\nTest Suite 2: Invalid URLs (Should Fail)\n');
for (const testCase of invalidUrlTests) {
  runTest(testCase);
}

console.log('\n===========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('===========================================\n');

if (failed > 0) {
  console.log('❌ Some tests failed!');
  process.exit(1);
}

console.log('✅ All tests passed!');
