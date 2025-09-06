#!/usr/bin/env sh
':' //# ; exec "$(command -v node || command -v bun)" "$0" "$@"

/**
 * Issue #3: JSON escaping in commands
 * 
 * Problem: Passing JSON strings with quotes to shell commands causes escaping issues
 * Solution: Write JSON to file with fs.writeFile instead of using echo
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');
const fs = (await import('fs')).promises;

console.log('=== Issue #3: JSON Escaping in Commands ===\n');

// Complex JSON with various quote types
const jsonData = {
  name: "Test's Repository",
  description: 'Repository with "quotes" and `backticks`',
  scripts: {
    test: "echo 'Running tests'",
    build: `echo "Building project"`,
    deploy: "bash -c 'echo ${VAR}'"
  },
  regex: "^[a-z]+\\d{2,4}$",
  path: "C:\\Users\\Test\\Documents",
  unicode: "Hello 世界 🌍"
};

const jsonString = JSON.stringify(jsonData, null, 2);

console.log('JSON to write:');
console.log('---');
console.log(jsonString);
console.log('---\n');

// Demonstrate the problem
console.log('❌ PROBLEMATIC APPROACH: Direct echo with JSON');
try {
  console.log('Command: echo \'${jsonString}\' > file.json');
  // This will likely fail or produce incorrect output
  const result = await $`echo '${jsonString}' > /tmp/test-json-problem.json`;
  const readBack = await fs.readFile('/tmp/test-json-problem.json', 'utf8');
  const parsed = JSON.parse(readBack);
  console.log('Success:', JSON.stringify(parsed) === JSON.stringify(jsonData));
} catch (error) {
  console.log('ERROR:', error.message.substring(0, 100));
  console.log('Exit code:', error.code);
}

console.log('\n' + '='.repeat(60) + '\n');

// Solution 1: fs.writeFile
console.log('✅ SOLUTION 1: Using fs.writeFile');
try {
  const tempFile = '/tmp/test-json-solution1.json';
  await fs.writeFile(tempFile, jsonString);
  const readBack = await fs.readFile(tempFile, 'utf8');
  const parsed = JSON.parse(readBack);
  console.log('Success:', JSON.stringify(parsed) === JSON.stringify(jsonData));
  console.log('Data integrity verified:', parsed.name === jsonData.name);
  await fs.unlink(tempFile);
} catch (error) {
  console.log('ERROR:', error.message);
}

console.log('\n' + '='.repeat(60) + '\n');

// Solution 2: Base64 encoding for shell transport
console.log('✅ SOLUTION 2: Base64 encoding for shell transport');
try {
  const base64 = Buffer.from(jsonString).toString('base64');
  // This is safer for shell transport
  const result = await $`echo "${base64}" | base64 -d > /tmp/test-json-solution2.json`;
  const readBack = await fs.readFile('/tmp/test-json-solution2.json', 'utf8');
  const parsed = JSON.parse(readBack);
  console.log('Success:', JSON.stringify(parsed) === JSON.stringify(jsonData));
  await fs.unlink('/tmp/test-json-solution2.json');
} catch (error) {
  console.log('ERROR:', error.message);
  console.log('Exit code:', error.code);
}

console.log('\n' + '='.repeat(60) + '\n');

// Solution 3: Using jq for JSON processing
console.log('✅ SOLUTION 3: Write file then process with jq');
try {
  const tempFile = '/tmp/test-json-temp.json';
  await fs.writeFile(tempFile, jsonString);
  
  // Use jq to validate and pretty-print
  const result = await $`jq '.' ${tempFile} > /tmp/test-json-solution3.json`;
  const readBack = await fs.readFile('/tmp/test-json-solution3.json', 'utf8');
  const parsed = JSON.parse(readBack);
  console.log('Success:', JSON.stringify(parsed) === JSON.stringify(jsonData));
  console.log('JQ validated the JSON successfully');
  
  await fs.unlink(tempFile);
  await fs.unlink('/tmp/test-json-solution3.json');
} catch (error) {
  console.log('ERROR:', error.message);
  console.log('Note: This might fail if jq is not installed');
}

console.log('\n=== SUMMARY ===');
console.log('Problem: JSON strings with quotes break shell interpolation');
console.log('Best Practice: Always use fs.writeFile for JSON data');
console.log('Alternative 1: Base64 encode for shell transport');
console.log('Alternative 2: Write to file first, then use tools like jq');