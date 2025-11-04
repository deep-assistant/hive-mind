#!/usr/bin/env node

/**
 * Test the claude-usage.lib.mjs library
 */

import { getClaudeUsage, getClaudeUsageMessage } from '../src/claude-usage.lib.mjs';

console.log('=== Testing Claude Usage Library ===\n');

try {
  console.log('Fetching Claude usage data...\n');
  const usageData = await getClaudeUsage();

  console.log('✅ Successfully fetched usage data!\n');
  console.log('=== Parsed Usage Data ===');
  console.log(JSON.stringify(usageData, null, 2));

  console.log('\n=== Formatted for Telegram ===');
  const message = await getClaudeUsageMessage();
  console.log(message);

  console.log('\n✅ Test Complete!');
  process.exit(0);
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}
