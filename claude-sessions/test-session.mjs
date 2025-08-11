#!/usr/bin/env sh
':' //# ; exec "$(command -v bun || command -v node)" "$0" "$@"

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

let $;
if (typeof Bun !== 'undefined') {
  // Bun has built-in $ support
  const bunModule = await import("bun");
  $ = bunModule.$;
} else {
  // Node.js: use execa for $ template literals
  const { $: $$ } = await use('execa');
  $ = $$;
}

const claude = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

console.log('=== Session Test (Cross-Runtime) ===\n');
console.log(`Runtime: ${typeof Bun !== 'undefined' ? 'Bun' : 'Node.js'}\n`);

try {
  // Test 1: Get session ID
  console.log('1. Creating session...');
  let output1;
  if (typeof Bun !== 'undefined') {
    output1 = await $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet`.text();
  } else {
    const result1 = await $`${claude} -p "hi" --output-format stream-json --verbose --model sonnet`;
    output1 = result1.stdout;
  }
  const lines1 = output1.split('\n').filter(line => line.trim());
  const sessionId = JSON.parse(lines1[0]).session_id;
  console.log(`   Session ID: ${sessionId}\n`);

  // Test 2: Try to resume
  console.log('2. Testing --resume...');
  let output2;
  if (typeof Bun !== 'undefined') {
    output2 = await $`${claude} --resume ${sessionId} -p "test" --output-format stream-json --verbose --model sonnet`.text();
  } else {
    const result2 = await $`${claude} --resume ${sessionId} -p "test" --output-format stream-json --verbose --model sonnet`;
    output2 = result2.stdout;
  }
  const lines2 = output2.split('\n').filter(line => line.trim());
  const newSessionId = JSON.parse(lines2[0]).session_id;
  console.log(`   New session ID: ${newSessionId}`);
  console.log(`   Same session? ${sessionId === newSessionId ? 'YES' : 'NO'}\n`);

  console.log('\n=== Summary ===');
  console.log('- Session IDs are extractable from JSON output');
  console.log('- --resume creates NEW sessions (not true resume)');
  
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}