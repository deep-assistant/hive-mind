#!/usr/bin/env node

// Dynamic import of use-m from unpkg
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

try {
  await $`ping 8.8.8.8`;
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}