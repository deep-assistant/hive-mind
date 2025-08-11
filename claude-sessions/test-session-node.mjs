#!/usr/bin/env node

// Use use-m for dynamic imports
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('execa');

const claude = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

console.log('=== Claude Session ID Test (Node.js) ===\n');

// Test 1: Get session ID from non-interactive mode
console.log('Test 1: Getting session ID from non-interactive mode...');
console.log('Running: claude -p "hi" --output-format stream-json --verbose --model sonnet\n');

const result1 = await $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet`;

// Extract session ID from the first JSON line
const firstLine = result1.stdout.split('\n')[0];
const initData = JSON.parse(firstLine);
const sessionId = initData.session_id;

console.log(`✓ Found session_id: ${sessionId}\n`);

// Test 2: Resume session with --resume flag
console.log('Test 2: Resuming session with --resume flag...');
console.log(`Running: claude --resume ${sessionId} -p "hello again" --output-format stream-json --verbose --model sonnet\n`);

try {
  const result2 = await $`${claude} --resume ${sessionId} -p "hello again" --output-format stream-json --verbose --model sonnet`;
  
  // Check if the same session ID appears in the resumed session
  const resumeFirstLine = result2.stdout.split('\n')[0];
  const resumeData = JSON.parse(resumeFirstLine);
  
  if (resumeData.session_id === sessionId) {
    console.log(`✓ Successfully resumed session ${sessionId}`);
  } else {
    console.log(`⚠ New session created: ${resumeData.session_id} (different from original)`);
  }
  
  // Show the response to verify context
  const responseLines = result2.stdout.split('\n').filter(line => line.includes('"type":"assistant"'));
  if (responseLines.length > 0) {
    const response = JSON.parse(responseLines[0]);
    console.log(`Response: ${response.message.content[0].text.substring(0, 100)}...`);
  }
} catch (e) {
  console.log(`✗ Failed to resume session: ${e.message}`);
}

console.log('\n=== Test Complete ===');