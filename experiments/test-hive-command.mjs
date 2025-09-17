#!/usr/bin/env node

// This script mimics what we need to detect in hive.mjs
console.log('process.argv[1]:', process.argv[1]);

// Check if running from a global bin location
const isGlobalInstall = process.argv[1] && (process.argv[1].includes('/.bun/bin/') || process.argv[1].includes('/.npm/bin/') || process.argv[1].includes('/node_modules/.bin/'));

console.log('Is global install:', isGlobalInstall);
console.log('Should use:', isGlobalInstall ? 'solve' : './solve.mjs');