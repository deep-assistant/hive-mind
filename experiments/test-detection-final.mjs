#!/usr/bin/env node

// Test the exact logic from hive.mjs
const isGlobalInstall = process.argv[1] && (
  process.argv[1].includes('/.bun/bin/') ||
  process.argv[1].includes('/.npm/bin/') ||
  process.argv[1].includes('/node_modules/.bin/') ||
  process.argv[1].includes('/node_modules/@deep-assistant/hive-mind/')
);

const solveCommand = isGlobalInstall ? 'solve' : './solve.mjs';

console.log('process.argv[1]:', process.argv[1]);
console.log('isGlobalInstall:', isGlobalInstall);
console.log('solveCommand:', solveCommand);