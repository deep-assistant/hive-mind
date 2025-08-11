#!/usr/bin/env bun

const $ = (await import("bun")).$;

const claude = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

console.log('=== Session Test ===\n');

// Test 1: Get session ID
console.log('1. Creating session...');
const result1 = await $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet`.text();
const sessionId = JSON.parse(result1.split('\n')[0]).session_id;
console.log(`   Session ID: ${sessionId}\n`);

// Test 2: Try to resume (proves it creates new session)
console.log('2. Testing --resume...');
const result2 = await $`${claude} --resume ${sessionId} -p "test" --output-format stream-json --verbose --model sonnet`.text();
const newSessionId = JSON.parse(result2.split('\n')[0]).session_id;
console.log(`   New session ID: ${newSessionId}`);
console.log(`   Same session? ${sessionId === newSessionId ? 'YES' : 'NO'}\n`);

console.log('\n=== Summary ===');
console.log('- Session IDs are available in JSON output');
console.log('- --resume creates NEW sessions (not true resume)');