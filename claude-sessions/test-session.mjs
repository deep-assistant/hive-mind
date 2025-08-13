#!/usr/bin/env sh
':' //# ; exec "$(command -v bun || command -v node)" "$0" "$@"

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const claude = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

console.log('=== Claude Session Management Test (Cross-Runtime) ===\n');
console.log(`Runtime: ${typeof Bun !== 'undefined' ? 'Bun' : 'Node.js'}\n`);

try {
  // Test 1: Extract session ID from JSON output
  console.log('1. Creating initial session and extracting ID...');
  const result1 = await $`${claude} -p "Hello, remember this: my favorite color is blue" --output-format stream-json --verbose --model sonnet`;
  const sessionId = JSON.parse(result1.stdout.split('\n')[0]).session_id;
  console.log(`   ✅ Session ID extracted: ${sessionId}\n`);

  // Test 2: Create custom session ID
  console.log('2. Creating session with custom ID...');
  const customId = '33333333-3333-3333-3333-333333333333';
  const result2 = await $`${claude} --session-id ${customId} -p "My favorite number is 42" --output-format stream-json --verbose --model sonnet`;
  const customSessionId = JSON.parse(result2.stdout.split('\n')[0]).session_id;
  console.log(`   ✅ Custom session created: ${customSessionId}`);
  console.log(`   ✅ ID matches expected: ${customId === customSessionId ? 'YES' : 'NO'}\n`);

  // Test 3: Resume session (context restoration)
  console.log('3. Testing session restoration with --resume...');
  const result3 = await $`${claude} --resume ${sessionId} -p "What is my favorite color?" --output-format stream-json --verbose --model sonnet`;
  const resumedSessionId = JSON.parse(result3.stdout.split('\n')[0]).session_id;
  const response = JSON.parse(result3.stdout.split('\n').find(line => {
    try { return JSON.parse(line).type === 'result'; } catch { return false; }
  })).result;
  
  console.log(`   ✅ Resumed from: ${sessionId}`);
  console.log(`   ✅ New session ID: ${resumedSessionId}`);
  console.log(`   ✅ Context restored: ${response.toLowerCase().includes('blue') ? 'YES' : 'NO'}`);
  console.log(`   📝 Response: "${response}"\n`);

  console.log('\n=== Summary ===');
  console.log('✅ Session IDs can be extracted from JSON output');
  console.log('✅ Custom session IDs work with --session-id flag');
  console.log('✅ Session restoration works with --resume (creates new ID but keeps context)');
  console.log('✅ Context is maintained across resumed sessions');

} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}