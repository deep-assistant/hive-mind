#!/usr/bin/env sh
':' //# ; exec "$(command -v node || command -v bun)" "$0" "$@"

/**
 * Issue #5: Paths with spaces
 * 
 * Problem: File paths with spaces need proper quoting in shell commands
 * Solution: Always quote paths, or use fs operations when possible
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');
const fs = (await import('fs')).promises;
const path = (await import('path')).default;

console.log('=== Issue #5: Handling Paths with Spaces ===\n');

const testPaths = [
  '/tmp/test folder with spaces',
  '/tmp/special & characters',
  '/tmp/quotes "in" path',
  "/tmp/single 'quotes' too",
  '/tmp/dollar $sign path',
  '/tmp/unicode 文件夹 path'
];

console.log('Test paths:');
testPaths.forEach(p => console.log(`  - ${p}`));
console.log('');

// Demonstrate the problem
console.log('❌ PROBLEMATIC APPROACH: Unquoted paths');
for (const testPath of testPaths.slice(0, 2)) {
  console.log(`\nTesting: ${testPath}`);
  try {
    // This will fail for paths with spaces
    console.log('  Command: mkdir -p ' + testPath);
    await $`mkdir -p ${testPath}`;
    console.log('  ✓ Created (unexpected success)');
    // Clean up if it somehow worked
    await $`rm -rf ${testPath}`;
  } catch (error) {
    console.log('  ✗ Failed:', error.message.substring(0, 50));
  }
}

console.log('\n' + '='.repeat(60) + '\n');

// Solution 1: Properly quoted paths
console.log('✅ SOLUTION 1: Always quote paths in shell commands');
for (const testPath of testPaths) {
  console.log(`\nTesting: ${testPath}`);
  try {
    // Properly quoted
    console.log('  Command: mkdir -p "${testPath}"');
    await $`mkdir -p "${testPath}"`;
    console.log('  ✓ Directory created');
    
    // Create a test file
    const fileName = 'test file.txt';
    const filePath = path.join(testPath, fileName);
    console.log(`  Command: echo "test" > "${filePath}"`);
    await $`echo "test content" > "${filePath}"`;
    console.log('  ✓ File created');
    
    // List contents
    const result = await $`ls -la "${testPath}"`;
    console.log('  ✓ Listed contents successfully');
    
    // Clean up
    await $`rm -rf "${testPath}"`;
    console.log('  ✓ Cleaned up');
  } catch (error) {
    console.log('  ✗ Error:', error.message.substring(0, 50));
  }
}

console.log('\n' + '='.repeat(60) + '\n');

// Solution 2: Use fs operations
console.log('✅ SOLUTION 2: Use fs operations to avoid shell entirely');
for (const testPath of testPaths.slice(0, 3)) {
  console.log(`\nTesting: ${testPath}`);
  try {
    // Use fs.mkdir
    console.log('  Using fs.mkdir()');
    await fs.mkdir(testPath, { recursive: true });
    console.log('  ✓ Directory created');
    
    // Create a test file
    const filePath = path.join(testPath, 'test file with spaces.txt');
    console.log('  Using fs.writeFile()');
    await fs.writeFile(filePath, 'test content');
    console.log('  ✓ File created');
    
    // Read directory
    console.log('  Using fs.readdir()');
    const files = await fs.readdir(testPath);
    console.log(`  ✓ Found ${files.length} file(s)`);
    
    // Clean up
    console.log('  Using fs.rm()');
    await fs.rm(testPath, { recursive: true, force: true });
    console.log('  ✓ Cleaned up');
  } catch (error) {
    console.log('  ✗ Error:', error.message);
  }
}

console.log('\n' + '='.repeat(60) + '\n');

// Demonstrate escaping edge cases
console.log('EDGE CASES: Special characters in paths\n');

const edgeCases = [
  { path: '/tmp/path with $VAR', desc: 'Dollar sign variable' },
  { path: '/tmp/path with `command`', desc: 'Backtick command substitution' },
  { path: '/tmp/path with $(cmd)', desc: 'Command substitution' },
  { path: "/tmp/path with 'single' and \"double\"", desc: 'Mixed quotes' }
];

for (const { path: testPath, desc } of edgeCases) {
  console.log(`${desc}: ${testPath}`);
  console.log('  Best: Use fs operations');
  console.log('  If shell needed: Quote carefully and escape special chars');
}

console.log('\n=== SUMMARY ===');
console.log('Problem: Paths with spaces break unquoted shell commands');
console.log('Solution 1: Always use double quotes around paths: "${path}"');
console.log('Solution 2: Prefer fs operations over shell commands');
console.log('Benefits of fs operations:');
console.log('  - No escaping issues');
console.log('  - Cross-platform compatibility');
console.log('  - Better error handling');
console.log('  - No shell injection risks');