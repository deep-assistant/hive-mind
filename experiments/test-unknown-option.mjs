#!/usr/bin/env node

// Debug why "value" is being caught as unknown option

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

const yargsStrictLib = await import('../src/yargs-strict.lib.mjs');
const { validateStrictOptions, looksLikeOption } = yargsStrictLib;

const DEFINED_OPTIONS = new Set(['help', 'h', 'token', 't', '_', '$0']);

console.log('Testing --unknown value...\n');

const argv = yargs(['--unknown', 'value'])
  .option('token', { type: 'string' })
  .parse();

console.log('Parsed argv:', JSON.stringify(argv, null, 2));
console.log('\nAll keys:', Object.keys(argv));
console.log('\nPositional args (_):', argv._);

// Check each key
for (const key of Object.keys(argv)) {
  if (key === '_' || key === '$0') continue;

  const isInDefined = DEFINED_OPTIONS.has(key);
  const startsWithDash = key.startsWith('-');
  const hasParens = /[()]/.test(key);
  const startsWithDigit = /^\d/.test(key);
  const hasNewlineOrMultiSpace = /[\n\r]|  /.test(key);

  console.log(`\nKey: "${key}"`);
  console.log(`  In defined options: ${isInDefined}`);
  console.log(`  Starts with dash: ${startsWithDash}`);
  console.log(`  Has parentheses: ${hasParens}`);
  console.log(`  Starts with digit: ${startsWithDigit}`);
  console.log(`  Has newline/multi-space: ${hasNewlineOrMultiSpace}`);
  console.log(`  Should skip: ${hasParens || startsWithDigit || hasNewlineOrMultiSpace}`);
}

// Check positional args
console.log('\n\nChecking positional args:');
if (argv._ && Array.isArray(argv._)) {
  for (const arg of argv._) {
    console.log(`Arg: "${arg}", looksLikeOption: ${looksLikeOption(arg)}`);
  }
}
