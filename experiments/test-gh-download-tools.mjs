#!/usr/bin/env node

/**
 * Test and demonstrate gh-issue-download and gh-pr-download tools
 *
 * This experiment shows how to use the new gh-issue-download and gh-pr-download
 * tools to fetch GitHub issues and PRs with embedded images, avoiding the
 * "Could not process image" error in Claude Code CLI.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

console.log('🧪 Testing gh-issue-download and gh-pr-download tools\n');

// Test 1: Download issue #597 (the issue about image processing problems)
console.log('Test 1: Downloading issue #597...');
try {
  const outputDir = '/tmp/test-gh-tools-issue';
  execSync(
    `node src/gh-issue-download.mjs https://github.com/deep-assistant/hive-mind/issues/597 --output ${outputDir}`,
    { stdio: 'inherit' }
  );

  const issueFile = join(outputDir, 'issue-597.md');
  if (existsSync(issueFile)) {
    console.log(`✅ Issue #597 downloaded successfully to ${issueFile}\n`);
  } else {
    console.error('❌ Issue file not found\n');
  }
} catch (error) {
  console.error(`❌ Test 1 failed: ${error.message}\n`);
}

// Test 2: Download PR #610 (this PR)
console.log('Test 2: Downloading PR #610...');
try {
  const outputDir = '/tmp/test-gh-tools-pr';
  execSync(
    `node src/gh-pr-download.mjs https://github.com/deep-assistant/hive-mind/pull/610 --output ${outputDir}`,
    { stdio: 'inherit' }
  );

  const prFile = join(outputDir, 'pr-610.md');
  if (existsSync(prFile)) {
    console.log(`✅ PR #610 downloaded successfully to ${prFile}\n`);
  } else {
    console.error('❌ PR file not found\n');
  }
} catch (error) {
  console.error(`❌ Test 2 failed: ${error.message}\n`);
}

// Test 3: Show usage examples
console.log('\n📚 Usage Examples:\n');
console.log('1. Download an issue by URL:');
console.log('   node src/gh-issue-download.mjs https://github.com/owner/repo/issues/123\n');

console.log('2. Download an issue by number:');
console.log('   node src/gh-issue-download.mjs 123 --owner owner --repo repo\n');

console.log('3. Download to specific directory:');
console.log('   node src/gh-issue-download.mjs https://github.com/owner/repo/issues/123 --output /tmp/issues\n');

console.log('4. Download PR with reviews:');
console.log('   node src/gh-pr-download.mjs https://github.com/owner/repo/pull/456\n');

console.log('5. Download PR without images (faster):');
console.log('   node src/gh-pr-download.mjs https://github.com/owner/repo/pull/456 --no-download-images\n');

console.log('\n✅ All tests completed!\n');
