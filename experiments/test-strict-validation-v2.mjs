#!/usr/bin/env node

/**
 * Test strict validation for issue #453
 */

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsStrictLib = await import('../src/yargs-strict.lib.mjs');
const { createStrictOptionsCheck } = yargsStrictLib;

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Testing strict validation for issue #453\n');

// Test 1: Valid --no-tool-check option
console.log('Test 1: --no-tool-check should be accepted');
try {
  const definedOptions = new Set([
    'tool-check', 'toolCheck',
    'no-tool-check', 'noToolCheck',
    '_', '$0'
  ]);

  const argv = yargs(['--no-tool-check'])
    .option('tool-check', {
      type: 'boolean',
      default: true
    })
    .parserConfiguration({
      'boolean-negation': true
    })
    .check(createStrictOptionsCheck(definedOptions))
    .fail(false) // Disable yargs default error handling
    .parseSync();

  console.log('✅ PASS: --no-tool-check accepted');
  console.log('   argv.toolCheck:', argv.toolCheck);
  console.log('   argv["tool-check"]:', argv["tool-check"]);
  console.log('');
} catch (error) {
  console.log('❌ FAIL:', error.message, '\n');
}

// Test 2: Invalid em-dash option should fail
console.log('Test 2: —fork (em-dash) should fail');
try {
  const definedOptions = new Set([
    'fork', 'f',
    '_', '$0'
  ]);

  const argv = yargs(['—fork']) // em-dash
    .option('fork', {
      type: 'boolean',
      default: false
    })
    .check(createStrictOptionsCheck(definedOptions))
    .fail(false) // Disable yargs default error handling
    .parseSync();

  console.log('❌ FAIL: em-dash option should have been rejected\n');
} catch (error) {
  console.log('✅ PASS: em-dash correctly rejected');
  console.log('   Error:', error.message);
  // Check for duplicate error messages
  const errorLines = error.message.split('\n').filter(line => line.trim());
  console.log('   Error lines:', errorLines.length);
  if (errorLines.length > 1) {
    console.log('❌ WARNING: Multiple error lines detected:');
    errorLines.forEach((line, i) => console.log(`     ${i + 1}. ${line}`));
  } else {
    console.log('✅ PASS: Only one error message (no duplicates)');
  }
  console.log('');
}

// Test 3: Unrecognized option should fail
console.log('Test 3: --unknown-option should fail');
try {
  const definedOptions = new Set([
    'fork', 'f',
    '_', '$0'
  ]);

  const argv = yargs(['--unknown-option'])
    .option('fork', {
      type: 'boolean',
      default: false
    })
    .check(createStrictOptionsCheck(definedOptions))
    .fail(false) // Disable yargs default error handling
    .parseSync();

  console.log('❌ FAIL: unknown option should have been rejected\n');
} catch (error) {
  console.log('✅ PASS: unknown option correctly rejected');
  console.log('   Error:', error.message, '\n');
}

console.log('All tests completed!');
