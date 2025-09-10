#!/usr/bin/env node

// Test various possible limit message patterns that Claude might output

const limitPatterns = [
  // Primary pattern from the issue description
  '⎿  5-hour limit reached ∙ resets 5:30am',
  
  // Variations of the same pattern
  '5-hour limit reached ∙ resets 5:30am',
  '24-hour limit reached • resets 11:45pm',
  '5-hour limit reached - resets 2:15pm',
  '5-hour limit reached, resets 8:00am',
  'Your 5-hour limit reached and resets at 6:30pm',
  'Rate limit reached (5-hour limit) - resets 9:15am',
  
  // Edge cases that should NOT match
  'limit reached',
  'general limit reached without time',
  'some other message about limits',
  '5 hour limit reached', // missing hyphen
  'limit reached resets soon',
];

// Current regex pattern from solve.mjs
const resetPattern = /(\d+)-hour limit reached.*?resets (\d{1,2}:\d{2}[ap]m)/i;

console.log('🔍 Testing limit detection patterns');
console.log('Current regex:', resetPattern.toString());
console.log('');

for (const message of limitPatterns) {
  const match = message.match(resetPattern);
  if (match) {
    const [, hours, resetTime] = match;
    console.log(`✅ Match: "${message}"`);
    console.log(`   → ${hours} hours, resets ${resetTime}`);
  } else {
    console.log(`❌ No match: "${message}"`);
  }
  console.log('');
}

// Test an improved pattern that might catch more variations
const improvedPattern = /(\d+)[-\s]hour\s+limit\s+reached.*?resets?\s*(?:at\s+)?(\d{1,2}:\d{2}[ap]m)/i;

console.log('🔧 Testing improved pattern');
console.log('Improved regex:', improvedPattern.toString());
console.log('');

for (const message of limitPatterns) {
  const match = message.match(improvedPattern);
  if (match) {
    const [, hours, resetTime] = match;
    console.log(`✅ Match: "${message}"`);
    console.log(`   → ${hours} hours, resets ${resetTime}`);
  } else {
    console.log(`❌ No match: "${message}"`);
  }
  console.log('');
}