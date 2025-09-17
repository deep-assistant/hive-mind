#!/usr/bin/env node

console.log('process.argv:', process.argv);
console.log('process.argv[1]:', process.argv[1]);
console.log('import.meta.url:', import.meta.url);

// Check if running from a .bun/bin location (global install)
const isGlobalInstall = process.argv[1] && process.argv[1].includes('/.bun/bin/') || process.argv[1] && process.argv[1].includes('/.npm/bin/') || process.argv[1] && process.argv[1].includes('/node_modules/.bin/');

// Check if running from local directory
const isLocalScript = process.argv[1] && (process.argv[1].startsWith('./') || process.argv[1].endsWith('.mjs') && !isGlobalInstall);

console.log('Is global install:', isGlobalInstall);
console.log('Is local script:', isLocalScript);

// The strategy should be:
// - If running as global command, use 'solve' command
// - If running as local script, use './solve.mjs'

const solveCommand = isGlobalInstall ? 'solve' : './solve.mjs';
console.log('Should use solve command:', solveCommand);