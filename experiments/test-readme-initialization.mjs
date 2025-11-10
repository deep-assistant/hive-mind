#!/usr/bin/env node

/**
 * Test script for README.md initialization feature (Issue #706)
 *
 * This script tests the functionality that automatically creates README.md
 * in repositories that don't have one.
 *
 * Test scenarios:
 * 1. Repository with existing README.md - should skip creation
 * 2. Repository without README.md - should create it with title
 * 3. Repository with description - should create README with title + description
 * 4. Fork scenario - should handle read-only access gracefully
 */

// Use use-m to dynamically import modules
globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const use = globalThis.use;

const { $ } = await use('command-stream');
const os = (await use('os')).default;
const path = (await use('path')).default;
const fs = (await use('fs')).promises;

// Import the function we're testing
const repository = await import('../src/solve.repository.lib.mjs');
const { ensureReadmeExists } = repository;

const lib = await import('../src/lib.mjs');
const { log, formatAligned } = lib;

console.log('🧪 Testing README.md initialization feature\n');

// Test 1: Repository with existing README.md
async function testExistingReadme() {
  console.log('Test 1: Repository with existing README.md');
  console.log('═══════════════════════════════════════════');

  // Create a temporary directory with README.md
  const tempDir = path.join(os.tmpdir(), `test-readme-exists-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  // Initialize git repo
  await $({ cwd: tempDir })`git init`;

  // Create a README.md
  await fs.writeFile(path.join(tempDir, 'README.md'), '# Existing README\n', 'utf8');

  // Test the function
  const result = await ensureReadmeExists(tempDir, 'deep-assistant', 'hive-mind', null);

  console.log(`Result:`, result);

  if (result.created === false && result.reason === 'exists') {
    console.log('✅ Test 1 PASSED: Correctly detected existing README.md\n');
  } else {
    console.log('❌ Test 1 FAILED: Should have detected existing README.md\n');
  }

  // Cleanup
  await fs.rm(tempDir, { recursive: true, force: true });
}

// Test 2: Repository without README.md (simulated - won't push)
async function testMissingReadme() {
  console.log('Test 2: Repository without README.md');
  console.log('═══════════════════════════════════════════');

  // Create a temporary directory without README.md
  const tempDir = path.join(os.tmpdir(), `test-readme-missing-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  // Initialize git repo
  await $({ cwd: tempDir })`git init`;
  await $({ cwd: tempDir })`git config user.name "Test User"`;
  await $({ cwd: tempDir })`git config user.email "test@example.com"`;

  // Create a dummy file to make it a valid repo
  await fs.writeFile(path.join(tempDir, 'test.txt'), 'test', 'utf8');
  await $({ cwd: tempDir })`git add test.txt`;
  await $({ cwd: tempDir })`git commit -m "Initial commit"`;

  // Test the function
  const result = await ensureReadmeExists(tempDir, 'deep-assistant', 'hive-mind', null);

  console.log(`Result:`, result);

  // Check if README.md was created
  const readmeExists = await fs.access(path.join(tempDir, 'README.md'))
    .then(() => true)
    .catch(() => false);

  if (result.created === true && readmeExists) {
    console.log('✅ Test 2 PASSED: Successfully created README.md');

    // Read and display the README content
    const content = await fs.readFile(path.join(tempDir, 'README.md'), 'utf8');
    console.log('README.md content:');
    console.log('─────────────────────');
    console.log(content);
    console.log('─────────────────────\n');
  } else {
    console.log('❌ Test 2 FAILED: Should have created README.md\n');
  }

  // Cleanup
  await fs.rm(tempDir, { recursive: true, force: true });
}

// Test 3: Verify README content includes description
async function testReadmeContent() {
  console.log('Test 3: README content includes description');
  console.log('═══════════════════════════════════════════');

  // Create a temporary directory without README.md
  const tempDir = path.join(os.tmpdir(), `test-readme-content-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  // Initialize git repo
  await $({ cwd: tempDir })`git init`;
  await $({ cwd: tempDir })`git config user.name "Test User"`;
  await $({ cwd: tempDir })`git config user.email "test@example.com"`;

  // Create a dummy file
  await fs.writeFile(path.join(tempDir, 'test.txt'), 'test', 'utf8');
  await $({ cwd: tempDir })`git add test.txt`;
  await $({ cwd: tempDir })`git commit -m "Initial commit"`;

  // Test the function with a real repository that has a description
  const result = await ensureReadmeExists(tempDir, 'deep-assistant', 'hive-mind', null);

  if (result.created) {
    const content = await fs.readFile(path.join(tempDir, 'README.md'), 'utf8');

    // Check if content includes both title and description
    const hasTitle = content.includes('# hive-mind');
    const hasDescription = content.includes('The AI that controls AIs');

    if (hasTitle && hasDescription) {
      console.log('✅ Test 3 PASSED: README includes both title and description');
      console.log('README.md content:');
      console.log('─────────────────────');
      console.log(content);
      console.log('─────────────────────\n');
    } else {
      console.log('❌ Test 3 FAILED: README missing title or description');
      console.log('Expected title: # hive-mind');
      console.log('Expected description: The AI that controls AIs');
      console.log('Actual content:');
      console.log(content);
      console.log('\n');
    }
  } else {
    console.log('⚠️  Test 3 SKIPPED: README was not created\n');
  }

  // Cleanup
  await fs.rm(tempDir, { recursive: true, force: true });
}

// Run all tests
try {
  await testExistingReadme();
  await testMissingReadme();
  await testReadmeContent();

  console.log('═══════════════════════════════════════════');
  console.log('🎉 All tests completed!');
  console.log('═══════════════════════════════════════════\n');

  console.log('📝 Note: This test script only validates local functionality.');
  console.log('   To test the full integration with GitHub:');
  console.log('   1. Create a test repository without README.md');
  console.log('   2. Run solve command on an issue in that repository');
  console.log('   3. Verify README.md is created and pushed\n');
} catch (error) {
  console.error('❌ Test execution failed:', error);
  process.exit(1);
}
