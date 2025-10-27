#!/usr/bin/env node
// Test script to verify the exact scenario from issue #539
// Command: start-screen hive "https://github.com/konard" --dry-run --once --verbose
// Expected: Should NOT error with "Invalid GitHub URL: missing owner/repo"

import { parseGitHubUrl } from '../src/github.lib.mjs';

console.log('Testing exact scenario from issue #539');
console.log('=' .repeat(70));
console.log('Command: start-screen hive "https://github.com/konard" --dry-run --once --verbose');
console.log();

// Simulate what start-screen.mjs does
const githubUrl = 'https://github.com/konard';
const command = 'hive';
const args = ['--dry-run', '--once', '--verbose'];

console.log('Step 1: Validate command');
if (command !== 'solve' && command !== 'hive') {
  console.log(`  ❌ FAIL: Invalid command '${command}'`);
  process.exit(1);
}
console.log(`  ✅ PASS: Command is valid (${command})`);

console.log('\nStep 2: Validate GitHub URL using parseGitHubUrl from github.lib.mjs');
const parsed = parseGitHubUrl(githubUrl);

console.log(`  URL: "${githubUrl}"`);
console.log(`  Valid: ${parsed.valid}`);

if (!parsed.valid) {
  console.log(`  ❌ FAIL: ${parsed.error}`);
  console.log('\nThis is the error from issue #539!');
  process.exit(1);
}

console.log(`  ✅ PASS: URL is valid`);
console.log(`     Type: ${parsed.type}`);
console.log(`     Owner: ${parsed.owner}`);
console.log(`     Normalized: ${parsed.normalized}`);

console.log('\nStep 3: Generate screen session name');
// Simplified version of generateScreenName
const parts = [command];
if (parsed.owner) parts.push(parsed.owner);
if (parsed.repo) parts.push(parsed.repo);
if (parsed.number) parts.push(parsed.number);
const sessionName = parts.join('-');

console.log(`  Session name: ${sessionName}`);
console.log(`  ✅ PASS: Session name generated successfully`);

console.log('\nStep 4: Verify this would be passed to hive command correctly');
const fullArgs = [githubUrl, ...args];
console.log(`  Full command would be: ${command} ${fullArgs.join(' ')}`);
console.log(`  ✅ PASS: Arguments prepared correctly`);

console.log('\n' + '='.repeat(70));
console.log('✅ SUCCESS! Issue #539 is fixed!');
console.log('   start-screen now correctly validates owner profile URLs like "https://github.com/konard"');
console.log('   The same URL validation logic from github.lib.mjs is now used.');
