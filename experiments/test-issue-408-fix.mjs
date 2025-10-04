#!/usr/bin/env node
/**
 * Test script for issue #408 fix
 * Verifies that handleAutoPrCreation is only called once
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read solve.mjs
const solveContent = readFileSync(join(__dirname, '../src/solve.mjs'), 'utf8');

// Check for duplicate auto-PR creation code patterns
const checks = [
  {
    name: 'handleAutoPrCreation usage',
    pattern: /handleAutoPrCreation/g,
    expected: 2, // One import, one call
    description: 'Should have exactly one call to handleAutoPrCreation (plus one in import)'
  },
  {
    name: 'Duplicate CLAUDE.md creation in solve.mjs',
    pattern: /await fs\.writeFile\(path\.join\(tempDir, 'CLAUDE\.md'\)/g,
    expected: 0,
    description: 'solve.mjs should NOT create CLAUDE.md directly (should use handleAutoPrCreation)'
  },
  {
    name: 'Auto PR creation if block',
    pattern: /if \(argv\.autoPullRequestCreation && !isContinueMode\) \{[\s\S]*?await log.*'Auto PR creation:', 'ENABLED'/g,
    expected: 0,
    description: 'solve.mjs should NOT have inline auto-PR creation logic'
  }
];

let allPassed = true;

console.log('🧪 Testing issue #408 fix...\n');

for (const check of checks) {
  const matches = solveContent.match(check.pattern);
  const count = matches ? matches.length : 0;
  const passed = count === check.expected;

  if (passed) {
    console.log(`✅ ${check.name}: ${count} occurrences (expected ${check.expected})`);
  } else {
    console.log(`❌ ${check.name}: ${count} occurrences (expected ${check.expected})`);
    console.log(`   ${check.description}`);
    allPassed = false;
  }
}

console.log();

if (allPassed) {
  console.log('✅ All checks passed! The duplicate code has been successfully removed.');
  process.exit(0);
} else {
  console.log('❌ Some checks failed. There may still be duplicate code.');
  process.exit(1);
}
