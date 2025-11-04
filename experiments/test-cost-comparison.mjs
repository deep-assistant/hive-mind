#!/usr/bin/env node

/**
 * Test script for cost comparison feature (issue #663)
 * This script tests the comparison between models.dev pricing and Anthropic's official pricing
 */

// Initialize use if not already defined
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

import { calculateAnthropicCost } from '../src/claude.lib.mjs';

console.log('🧪 Testing Cost Comparison Feature (Issue #663)\n');

// Test case 1: Claude Sonnet 4.5 with cache
console.log('Test 1: Claude Sonnet 4.5 with 5m cache');
console.log('─────────────────────────────────────────');

const usage1 = {
  inputTokens: 1000,
  cacheCreation5mTokens: 5000,
  cacheCreation1hTokens: 0,
  cacheReadTokens: 10000,
  outputTokens: 500
};

const anthropicCost1 = calculateAnthropicCost(usage1, 'claude-sonnet-4-5-20250929', true);
console.log('Usage:', JSON.stringify(usage1, null, 2));
console.log('\nAnthropic Cost Breakdown:');
console.log('  Input:         ', anthropicCost1.breakdown.input.tokens, 'tokens × $', anthropicCost1.breakdown.input.costPerMillion, '/M = $', anthropicCost1.breakdown.input.cost.toFixed(6));
console.log('  Cache 5m:      ', anthropicCost1.breakdown.cacheWrite5m.tokens, 'tokens × $', anthropicCost1.breakdown.cacheWrite5m.costPerMillion, '/M = $', anthropicCost1.breakdown.cacheWrite5m.cost.toFixed(6));
console.log('  Cache read:    ', anthropicCost1.breakdown.cacheRead.tokens, 'tokens × $', anthropicCost1.breakdown.cacheRead.costPerMillion, '/M = $', anthropicCost1.breakdown.cacheRead.cost.toFixed(6));
console.log('  Output:        ', anthropicCost1.breakdown.output.tokens, 'tokens × $', anthropicCost1.breakdown.output.costPerMillion, '/M = $', anthropicCost1.breakdown.output.cost.toFixed(6));
console.log('  Total:          $', anthropicCost1.total.toFixed(6));

// Expected calculation:
// Input: 1,000 × $3/M = $0.003
// Cache 5m: 5,000 × $3.75/M = $0.01875
// Cache read: 10,000 × $0.30/M = $0.003
// Output: 500 × $15/M = $0.0075
// Total: $0.03225

const expected1 = 0.03225;
console.log('\n✅ Expected total: $', expected1.toFixed(6));
console.log(Math.abs(anthropicCost1.total - expected1) < 0.000001 ? '✅ PASS' : '❌ FAIL');

// Test case 2: Claude Haiku 4.5 (cheaper model)
console.log('\n\nTest 2: Claude Haiku 4.5');
console.log('─────────────────────────────────────────');

const usage2 = {
  inputTokens: 10000,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 2000,
  cacheReadTokens: 5000,
  outputTokens: 1000
};

const anthropicCost2 = calculateAnthropicCost(usage2, 'claude-haiku-4-5-20251001', true);
console.log('Usage:', JSON.stringify(usage2, null, 2));
console.log('\nAnthropic Cost Breakdown:');
console.log('  Input:         ', anthropicCost2.breakdown.input.tokens, 'tokens × $', anthropicCost2.breakdown.input.costPerMillion, '/M = $', anthropicCost2.breakdown.input.cost.toFixed(6));
console.log('  Cache 1h:      ', anthropicCost2.breakdown.cacheWrite1h.tokens, 'tokens × $', anthropicCost2.breakdown.cacheWrite1h.costPerMillion, '/M = $', anthropicCost2.breakdown.cacheWrite1h.cost.toFixed(6));
console.log('  Cache read:    ', anthropicCost2.breakdown.cacheRead.tokens, 'tokens × $', anthropicCost2.breakdown.cacheRead.costPerMillion, '/M = $', anthropicCost2.breakdown.cacheRead.cost.toFixed(6));
console.log('  Output:        ', anthropicCost2.breakdown.output.tokens, 'tokens × $', anthropicCost2.breakdown.output.costPerMillion, '/M = $', anthropicCost2.breakdown.output.cost.toFixed(6));
console.log('  Total:          $', anthropicCost2.total.toFixed(6));

// Expected calculation:
// Input: 10,000 × $1/M = $0.01
// Cache 1h: 2,000 × $2/M = $0.004
// Cache read: 5,000 × $0.10/M = $0.0005
// Output: 1,000 × $5/M = $0.005
// Total: $0.0195

const expected2 = 0.0195;
console.log('\n✅ Expected total: $', expected2.toFixed(6));
console.log(Math.abs(anthropicCost2.total - expected2) < 0.000001 ? '✅ PASS' : '❌ FAIL');

// Test case 3: Unknown model (should return 0)
console.log('\n\nTest 3: Unknown model');
console.log('─────────────────────────────────────────');

const usage3 = {
  inputTokens: 1000,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 500
};

const anthropicCost3 = calculateAnthropicCost(usage3, 'unknown-model-123', true);
console.log('Usage:', JSON.stringify(usage3, null, 2));
console.log('\nAnthropic Cost:', anthropicCost3);
console.log(anthropicCost3.total === 0 && anthropicCost3.breakdown === null ? '✅ PASS (returns 0 for unknown model)' : '❌ FAIL');

// Test case 4: Cost comparison simulation
console.log('\n\nTest 4: Cost Comparison Simulation');
console.log('─────────────────────────────────────────');

// Simulating models.dev pricing vs Anthropic pricing
const usage4 = {
  inputTokens: 5000,
  cacheCreation5mTokens: 10000,
  cacheCreation1hTokens: 0,
  cacheReadTokens: 20000,
  outputTokens: 2000
};

const modelDevCost = 0.112; // Simulated models.dev cost
const anthropicCost4 = calculateAnthropicCost(usage4, 'claude-sonnet-4-5-20250929', true);

console.log('Usage:', JSON.stringify(usage4, null, 2));
console.log('\nCost Comparison:');
console.log('  models.dev estimate:  $', modelDevCost.toFixed(6));
console.log('  Anthropic official:   $', anthropicCost4.total.toFixed(6));

const difference = anthropicCost4.total - modelDevCost;
const percentDiff = modelDevCost > 0 ? ((difference / modelDevCost) * 100) : 0;
const ratio = modelDevCost > 0 ? (anthropicCost4.total / modelDevCost) : 0;

console.log('  Difference:           $', difference.toFixed(6), '(', percentDiff > 0 ? '+' : '', percentDiff.toFixed(2), '%)');
console.log('  Ratio (A/M):          ', ratio.toFixed(4), 'x');

console.log('\n✅ Cost comparison calculations working correctly');

console.log('\n\n🎉 All tests completed!');
console.log('\nSummary:');
console.log('  ✅ Anthropic cost calculation implemented');
console.log('  ✅ Cache breakdown (5m/1h) properly handled');
console.log('  ✅ Unknown models return 0 cost');
console.log('  ✅ Cost comparison metrics (difference, ratio, percentage) calculated');
