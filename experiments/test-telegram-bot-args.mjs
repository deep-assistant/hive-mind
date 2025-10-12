#!/usr/bin/env node

// Test script to reproduce issue #482
// This simulates the command line arguments that fail in the issue

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

// Import strict options validation
const yargsStrictLib = await import('../src/yargs-strict.lib.mjs');
const { validateStrictOptions } = yargsStrictLib;

// Define all valid options for strict validation
const DEFINED_OPTIONS = new Set([
  'help', 'h', 'version',
  'token', 't',
  'allowed-chats', 'allowedChats', 'a',
  'solve-overrides', 'solveOverrides',
  'hive-overrides', 'hiveOverrides',
  'solve', 'no-solve', 'noSolve',
  'hive', 'no-hive', 'noHive',
  '_', '$0'
]);

console.log('Testing various command line arguments...\n');

// Test case 1: The exact command from issue #482
console.log('Test 1: Original failing command from issue #482');
const testArgs1 = [
  '--token', '8490testtoken',
  '--allowed-chats', '(-1002975819706 -1002861722681)',
  '--no-hive',
  '--solve-overrides', '(\n  --auto-continue\n  --attach-logs\n  --verbose\n  --no-tool-check\n)'
];

try {
  const argv1 = yargs(testArgs1)
    .option('token', {
      type: 'string',
      description: 'Telegram bot token from @BotFather',
      alias: 't'
    })
    .option('allowed-chats', {
      type: 'string',
      description: 'Allowed chat IDs in lino notation',
      alias: 'a'
    })
    .option('solve-overrides', {
      type: 'string',
      description: 'Override options for /solve command in lino notation'
    })
    .option('hive-overrides', {
      type: 'string',
      description: 'Override options for /hive command in lino notation'
    })
    .option('solve', {
      type: 'boolean',
      description: 'Enable /solve command (use --no-solve to disable)',
      default: true
    })
    .option('hive', {
      type: 'boolean',
      description: 'Enable /hive command (use --no-hive to disable)',
      default: true
    })
    .parserConfiguration({
      'boolean-negation': true
    })
    .parse();

  console.log('Parsed argv1:', JSON.stringify(argv1, null, 2));
  console.log('Positional args (_):', argv1._);
  console.log('All keys:', Object.keys(argv1));

  validateStrictOptions(argv1, DEFINED_OPTIONS);
  console.log('✅ Test 1 PASSED\n');
} catch (error) {
  console.log('❌ Test 1 FAILED:', error.message);
  console.log('');
}

// Test case 2: Simple token
console.log('Test 2: Simple token argument');
const testArgs2 = ['--token', 'simple-token-value'];

try {
  const argv2 = yargs(testArgs2)
    .option('token', { type: 'string', alias: 't' })
    .parse();

  validateStrictOptions(argv2, DEFINED_OPTIONS);
  console.log('✅ Test 2 PASSED\n');
} catch (error) {
  console.log('❌ Test 2 FAILED:', error.message);
  console.log('');
}

// Test case 3: Lino notation with parentheses
console.log('Test 3: Lino notation with parentheses');
const testArgs3 = ['--allowed-chats', '(123 456 789)'];

try {
  const argv3 = yargs(testArgs3)
    .option('allowed-chats', { type: 'string', alias: 'a' })
    .parse();

  console.log('Parsed argv3:', JSON.stringify(argv3, null, 2));

  validateStrictOptions(argv3, DEFINED_OPTIONS);
  console.log('✅ Test 3 PASSED\n');
} catch (error) {
  console.log('❌ Test 3 FAILED:', error.message);
  console.log('');
}

// Test case 4: Multi-line lino notation with dashes
console.log('Test 4: Multi-line lino notation with dashes');
const testArgs4 = ['--solve-overrides', '(\n  --auto-continue\n  --attach-logs\n)'];

try {
  const argv4 = yargs(testArgs4)
    .option('solve-overrides', { type: 'string' })
    .parse();

  console.log('Parsed argv4:', JSON.stringify(argv4, null, 2));

  validateStrictOptions(argv4, DEFINED_OPTIONS);
  console.log('✅ Test 4 PASSED\n');
} catch (error) {
  console.log('❌ Test 4 FAILED:', error.message);
  console.log('');
}

console.log('Testing complete!');
