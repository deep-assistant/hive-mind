#!/usr/bin/env node

// Summary test of validation behavior

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

const yargsStrictLib = await import('../src/yargs-strict.lib.mjs');
const { createStrictOptionsCheck } = yargsStrictLib;

const DEFINED_OPTIONS = new Set([
  'help', 'h', 'version',
  'token', 't',
  'allowed-chats', 'allowedChats', 'a',
  'solve', 'no-solve', 'noSolve',
  '_', '$0'
]);

const strictCheck = createStrictOptionsCheck(DEFINED_OPTIONS, false);

console.log('Summary of validation behavior:\n');

const tests = [
  {
    name: 'Valid option --token with value',
    args: ['--token', 'mytoken'],
    shouldPass: true
  },
  {
    name: 'Valid alias -t with value',
    args: ['-t', 'mytoken'],
    shouldPass: true
  },
  {
    name: 'Token with special chars (digits)',
    args: ['--token', '8490aOEM'],
    shouldPass: true
  },
  {
    name: 'Token with parentheses in value',
    args: ['--allowed-chats', '(123 456)'],
    shouldPass: true
  },
  {
    name: 'Multi-line value with newlines',
    args: ['--allowed-chats', '(\n  123\n  456\n)'],
    shouldPass: true
  },
  {
    name: 'Invalid option --unknown',
    args: ['--unknown', 'value'],
    shouldPass: false
  },
  {
    name: 'Invalid short option -x',
    args: ['-x'],
    shouldPass: false
  }
];

for (const test of tests) {
  try {
    const argv = yargs(test.args)
      .option('token', { type: 'string', alias: 't' })
      .option('allowed-chats', { type: 'string', alias: 'a' })
      .option('solve', { type: 'boolean', default: true })
      .parse();

    strictCheck(argv);

    if (test.shouldPass) {
      console.log(`✅ ${test.name}`);
    } else {
      console.log(`❌ ${test.name} - Expected error but passed`);
    }
  } catch (error) {
    if (!test.shouldPass) {
      console.log(`✅ ${test.name} - Correctly caught: ${error.message.split('\n')[0]}`);
    } else {
      console.log(`❌ ${test.name} - Unexpected error: ${error.message}`);
    }
  }
}

console.log('\nAll tests complete!');
