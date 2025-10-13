#!/usr/bin/env node

/**
 * Experiment to test dual memory checks (RAM-only AND total memory)
 *
 * This script tests that both checks are performed independently:
 * - RAM-only check must pass
 * - Total memory (RAM + swap) check must pass
 *
 * If either check fails, the overall check should fail.
 */

import { checkRAM } from '../src/memory-check.mjs';

console.log('🧪 Testing dual memory checks\n');
console.log('This experiment tests the memory check with requirements that:');
console.log('1. Are lower than total memory (should pass both checks)');
console.log('2. Are between RAM-only and total memory (should fail RAM check)');
console.log('3. Are higher than total memory (should fail both checks)\n');

// Test 1: Very low requirement (should pass)
console.log('━'.repeat(60));
console.log('Test 1: Very low memory requirement (1MB)');
console.log('Expected: ✅ Both RAM and total checks should pass');
console.log('━'.repeat(60));
const result1 = await checkRAM(1, { log: async (msg) => console.log(msg) });
console.log(`Result: ${result1.success ? '✅ PASSED' : '❌ FAILED'}`);
console.log(`Details: RAM=${result1.availableMB}MB, Total=${result1.totalAvailable}MB, Required=1MB`);
console.log('');

// Test 2: Impossible requirement (should fail)
console.log('━'.repeat(60));
console.log('Test 2: Impossibly high memory requirement (999999MB)');
console.log('Expected: ❌ Both RAM and total checks should fail');
console.log('━'.repeat(60));
const result2 = await checkRAM(999999, { log: async (msg) => console.log(msg) });
console.log(`Result: ${result2.success ? '✅ PASSED' : '❌ FAILED'}`);
console.log(`Details: RAM=${result2.availableMB}MB, Total=${result2.totalAvailable}MB, Required=999999MB`);
console.log('');

// Test 3: Requirement between RAM and total (edge case)
// This test will likely fail the RAM check but pass the total check
// With the new implementation, this should result in overall failure
console.log('━'.repeat(60));
console.log('Test 3: Edge case - requirement between RAM and total');
console.log('Expected: ❌ Should fail if RAM-only is insufficient (even if total is sufficient)');
console.log('━'.repeat(60));

// Get current memory to calculate a value between RAM and total
const currentMemory = await checkRAM(1, { log: async () => {} });
const ramMB = currentMemory.availableMB;
const totalMB = currentMemory.totalAvailable;
const betweenValue = Math.floor((ramMB + totalMB) / 2);

if (betweenValue > ramMB && betweenValue < totalMB) {
  console.log(`Testing with requirement: ${betweenValue}MB (between RAM: ${ramMB}MB and Total: ${totalMB}MB)`);
  const result3 = await checkRAM(betweenValue, { log: async (msg) => console.log(msg) });
  console.log(`Result: ${result3.success ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Details: RAM=${result3.availableMB}MB, Total=${result3.totalAvailable}MB, Required=${betweenValue}MB`);

  if (!result3.success) {
    console.log('\n✅ CORRECT: Check failed because RAM-only was insufficient');
  } else {
    console.log('\n❌ ERROR: Check passed when it should have failed (RAM-only was insufficient)');
  }
} else {
  console.log(`Cannot test edge case: RAM=${ramMB}MB, Total=${totalMB}MB (not enough difference)`);
  console.log('This is normal on systems with no swap or very low swap.');
}

console.log('\n━'.repeat(60));
console.log('🎯 Summary:');
console.log('━'.repeat(60));
console.log('The new implementation checks BOTH:');
console.log('  1. RAM-only >= required');
console.log('  2. Total memory (RAM + swap) >= required');
console.log('');
console.log('Both conditions must be true for the check to pass.');
console.log('This ensures that the system has sufficient physical RAM,');
console.log('not just swap space that could slow down operations.');
console.log('━'.repeat(60));
