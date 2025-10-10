#!/usr/bin/env node

/**
 * Test script for contributing guidelines detection
 */

import { detectContributingGuidelines, extractCIRequirements, buildContributingSection } from '../src/contributing-guidelines.lib.mjs';

console.log('🧪 Testing Contributing Guidelines Detection\n');

async function testDishkaRepo() {
  console.log('Testing reagento/dishka repository...');

  const guidelines = await detectContributingGuidelines('reagento', 'dishka');

  console.log('\nResults:');
  console.log('  Found:', guidelines.found);
  console.log('  Path:', guidelines.path);
  console.log('  URL:', guidelines.url);
  console.log('  Docs URL:', guidelines.docsUrl);

  if (guidelines.content) {
    console.log('  Content length:', guidelines.content.length);

    const requirements = extractCIRequirements(guidelines.content);
    console.log('\nExtracted CI Requirements:');
    console.log('  Linters:', requirements.linters.map(l => l.name).join(', '));
    console.log('  Test commands:', requirements.testCommands.map(t => t.name).join(', '));
    console.log('  Style guide:', requirements.styleGuide.join(', '));
  }

  console.log('\n--- Contributing Section for Prompt ---');
  const section = await buildContributingSection('reagento', 'dishka');
  console.log(section);
}

async function testHiveMindRepo() {
  console.log('\n\n=================================\n');
  console.log('Testing deep-assistant/hive-mind repository...');

  const guidelines = await detectContributingGuidelines('deep-assistant', 'hive-mind');

  console.log('\nResults:');
  console.log('  Found:', guidelines.found);
  console.log('  Path:', guidelines.path);
  console.log('  URL:', guidelines.url);
  console.log('  Docs URL:', guidelines.docsUrl);

  if (guidelines.content) {
    console.log('  Content length:', guidelines.content.length);

    const requirements = extractCIRequirements(guidelines.content);
    console.log('\nExtracted CI Requirements:');
    console.log('  Linters:', requirements.linters.map(l => l.name).join(', '));
    console.log('  Test commands:', requirements.testCommands.map(t => t.name).join(', '));
    console.log('  Style guide:', requirements.styleGuide.join(', '));
  }

  console.log('\n--- Contributing Section for Prompt ---');
  const section = await buildContributingSection('deep-assistant', 'hive-mind');
  console.log(section);
}

// Run tests
try {
  await testDishkaRepo();
  await testHiveMindRepo();
  console.log('\n\n✅ Tests completed successfully!');
} catch (err) {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
}
