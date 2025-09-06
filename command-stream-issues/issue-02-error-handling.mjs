#!/usr/bin/env sh
':' //# ; exec "$(command -v node || command -v bun)" "$0" "$@"

/**
 * Issue #2: Error handling - code vs exitCode
 * 
 * Problem: Command-stream uses error.code instead of error.exitCode
 * Solution: Always check error.code for exit status
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

console.log('=== Issue #2: Error Handling - code vs exitCode ===\n');

// Test 1: Command that exits with non-zero code
console.log('Test 1: Command with non-zero exit code');
console.log('Command: ls /nonexistent/directory');
try {
  await $`ls /nonexistent/directory`;
  console.log('Command succeeded (unexpected)');
} catch (error) {
  console.log('\nError object analysis:');
  console.log('  typeof error.code:', typeof error.code, '- Value:', error.code);
  console.log('  typeof error.exitCode:', typeof error.exitCode, '- Value:', error.exitCode);
  console.log('  error.message:', error.message);
  console.log('  Has stdout:', !!error.stdout);
  console.log('  Has stderr:', !!error.stderr);
  
  if (error.stderr) {
    console.log('  Stderr content:', error.stderr.toString().trim());
  }
}

console.log('\n' + '='.repeat(60) + '\n');

// Test 2: Command that fails to spawn
console.log('Test 2: Command that fails to spawn');
console.log('Command: /nonexistent/command');
try {
  await $`/nonexistent/command`;
  console.log('Command succeeded (unexpected)');
} catch (error) {
  console.log('\nError object analysis:');
  console.log('  error.code:', error.code);
  console.log('  error.exitCode:', error.exitCode);
  console.log('  error.message:', error.message);
  console.log('  Error type:', error.constructor.name);
}

console.log('\n' + '='.repeat(60) + '\n');

// Test 3: Successful command
console.log('Test 3: Successful command');
console.log('Command: echo "Hello, World!"');
try {
  const result = await $`echo "Hello, World!"`;
  console.log('\nResult object analysis:');
  console.log('  result.code:', result.code);
  console.log('  result.exitCode:', result.exitCode);
  console.log('  stdout:', result.stdout.toString().trim());
  console.log('  stderr:', result.stderr ? result.stderr.toString() : '(empty)');
} catch (error) {
  console.log('Command failed (unexpected):', error.message);
}

console.log('\n' + '='.repeat(60) + '\n');

// Demonstration of proper error handling
console.log('✅ PROPER ERROR HANDLING PATTERN:\n');
console.log(`try {
  const result = await $\`some-command\`;
  // Process successful result
  console.log(result.stdout.toString());
} catch (error) {
  if (error.code !== undefined) {
    console.log('Command exited with code:', error.code);
  } else {
    console.log('Command failed to spawn:', error.message);
  }
  
  // Additional debugging info
  if (error.stderr) {
    console.log('Error output:', error.stderr.toString());
  }
}`);

console.log('\n=== SUMMARY ===');
console.log('Key Point: Use error.code, NOT error.exitCode');
console.log('Note: error.code contains the process exit code');
console.log('Note: error.exitCode is undefined in command-stream');
console.log('Best Practice: Always check error.code for exit status');