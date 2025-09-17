#!/usr/bin/env node

console.log('process.argv:', process.argv);
console.log('process.argv[0]:', process.argv[0]);
console.log('process.argv[1]:', process.argv[1]);
console.log('__filename equivalent:', import.meta.url);
console.log('process.cwd():', process.cwd());

// Check if running as a global command vs local script
const isRunningAsCommand = !process.argv[1] || !process.argv[1].endsWith('.mjs');
console.log('Is running as command:', isRunningAsCommand);

// Alternative detection method
const isLocalScript = process.argv[1] && (process.argv[1].startsWith('./') || process.argv[1].includes('/hive.mjs'));
console.log('Is local script:', isLocalScript);