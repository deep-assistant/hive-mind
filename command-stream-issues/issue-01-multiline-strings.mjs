#!/usr/bin/env sh
':' //# ; exec "$(command -v node || command -v bun)" "$0" "$@"

/**
 * Issue #1: Multi-line strings with special characters
 * 
 * Problem: Echo command fails with multi-line content containing backticks and quotes
 * Solution: Use fs.writeFile or heredocs instead of echo with interpolation
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');
const fs = (await import('fs')).promises;

console.log('=== Issue #1: Multi-line Strings with Special Characters ===\n');

const complexContent = `# Test Repository

This is a test repository with \`backticks\` and "quotes".

## Code Example
\`\`\`javascript
const message = "Hello, World!";
console.log(\`Message: \${message}\`);
\`\`\`

## Special Characters
- Single quotes: 'test'
- Double quotes: "test"
- Backticks: \`test\`
- Dollar signs: $100
- Backslashes: C:\\Windows\\System32`;

console.log('Content to write (', complexContent.length, 'chars):');
console.log('---');
console.log(complexContent.substring(0, 200) + '...');
console.log('---\n');

// Demonstrate the problem
console.log('❌ PROBLEMATIC APPROACH: Using echo with interpolation');
try {
  console.log('Command: echo "${content}" > file.txt');
  const result = await $`echo "${complexContent}" > /tmp/test-problem.txt`;
  const readBack = await fs.readFile('/tmp/test-problem.txt', 'utf8');
  console.log('Success:', readBack === complexContent);
  console.log('Content matches:', readBack.length === complexContent.length);
} catch (error) {
  console.log('ERROR:', error.message);
  console.log('Exit code:', error.code);
  if (error.stderr) console.log('Stderr:', error.stderr.toString());
}

console.log('\n' + '='.repeat(60) + '\n');

// Solution 1: fs.writeFile
console.log('✅ SOLUTION 1: Using fs.writeFile');
try {
  await fs.writeFile('/tmp/test-solution1.txt', complexContent);
  const readBack = await fs.readFile('/tmp/test-solution1.txt', 'utf8');
  console.log('Success:', readBack === complexContent);
  console.log('Content matches:', readBack.length === complexContent.length);
  await fs.unlink('/tmp/test-solution1.txt');
} catch (error) {
  console.log('ERROR:', error.message);
}

console.log('\n' + '='.repeat(60) + '\n');

// Solution 2: Heredoc
console.log('✅ SOLUTION 2: Using heredoc');
try {
  const result = await $`cat << 'EOF' > /tmp/test-solution2.txt
${complexContent}
EOF`;
  const readBack = await fs.readFile('/tmp/test-solution2.txt', 'utf8');
  console.log('Success:', readBack === complexContent);
  console.log('Content matches:', readBack.length === complexContent.length);
  await fs.unlink('/tmp/test-solution2.txt');
} catch (error) {
  console.log('ERROR:', error.message);
  console.log('Exit code:', error.code);
}

console.log('\n' + '='.repeat(60) + '\n');

// Solution 3: Write to temp file first
console.log('✅ SOLUTION 3: Write to temp file, then use cat');
try {
  const tempFile = `/tmp/temp-${Date.now()}.txt`;
  await fs.writeFile(tempFile, complexContent);
  const result = await $`cat ${tempFile} > /tmp/test-solution3.txt`;
  const readBack = await fs.readFile('/tmp/test-solution3.txt', 'utf8');
  console.log('Success:', readBack === complexContent);
  console.log('Content matches:', readBack.length === complexContent.length);
  await fs.unlink(tempFile);
  await fs.unlink('/tmp/test-solution3.txt');
} catch (error) {
  console.log('ERROR:', error.message);
}

console.log('\n=== SUMMARY ===');
console.log('Problem: Shell interpolation of complex multi-line strings fails');
console.log('Best Practice: Use fs.writeFile() for complex content');
console.log('Alternative: Use heredocs with quoted delimiter (EOF)');