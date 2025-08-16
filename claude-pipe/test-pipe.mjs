#!/usr/bin/env node

// Dynamic import of use-m from unpkg
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const claude = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

console.log('=== Claude Pipe to jq Test ===\n');

try {
  // Simple test: pipe claude output to jq
  const result = await $`${claude} -p "hi" --output-format json --model sonnet | jq .`;
  console.log('Result:');
  console.log(result.stdout);
  
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}