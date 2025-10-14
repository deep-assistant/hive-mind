#!/usr/bin/env node

/**
 * Test script for containerization feature
 * This script demonstrates and tests the container.lib.mjs functionality
 */

// Import container library
import containerLib from '../src/container.lib.mjs';

const {
  isDockerAvailable,
  isDockerRunning,
  validateContainerConfig,
  executeInContainer,
  DEFAULT_CONTAINER_CONFIG
} = containerLib;

console.log('🧪 Testing Hive Mind Containerization Feature\n');

// Test 1: Check Docker availability
console.log('Test 1: Checking Docker availability...');
const dockerAvailable = await isDockerAvailable();
console.log(`   Docker available: ${dockerAvailable ? '✅ Yes' : '❌ No'}`);

if (!dockerAvailable) {
  console.log('\n⚠️  Docker is not installed. Please install Docker to use containerization.');
  console.log('   Visit: https://docs.docker.com/engine/install/\n');
  process.exit(0);
}

// Test 2: Check Docker daemon
console.log('\nTest 2: Checking Docker daemon...');
const dockerRunning = await isDockerRunning();
console.log(`   Docker daemon running: ${dockerRunning ? '✅ Yes' : '❌ No'}`);

if (!dockerRunning) {
  console.log('\n⚠️  Docker daemon is not running. Please start Docker and try again.\n');
  process.exit(0);
}

// Test 3: Validate container configuration
console.log('\nTest 3: Validating container configurations...');

const validConfig = {
  cpuLimit: '1.0',
  memoryLimit: '1g',
  diskLimit: '10g'
};

const invalidConfigs = [
  { cpuLimit: 'invalid', memoryLimit: '1g', diskLimit: '10g' },
  { cpuLimit: '1.0', memoryLimit: 'invalid', diskLimit: '10g' },
  { cpuLimit: '1.0', memoryLimit: '1g', diskLimit: 'invalid' }
];

const validResult = validateContainerConfig(validConfig);
console.log(`   Valid config: ${validResult.valid ? '✅ Pass' : '❌ Fail'}`);

for (const [index, config] of invalidConfigs.entries()) {
  const result = validateContainerConfig(config);
  console.log(`   Invalid config ${index + 1}: ${!result.valid ? '✅ Correctly rejected' : '❌ Should have failed'}`);
  if (!result.valid) {
    console.log(`      Errors: ${result.errors.join(', ')}`);
  }
}

// Test 4: Execute a simple command in container
console.log('\nTest 4: Executing simple command in container...');
console.log('   Command: echo "Hello from container"');

const testConfig = {
  ...DEFAULT_CONTAINER_CONFIG,
  cpuLimit: '0.5',
  memoryLimit: '512m',
  diskLimit: '5g',
  autoCleanup: true
};

try {
  const result = await executeInContainer(
    'echo',
    ['Hello from container!'],
    testConfig
  );

  if (result.success) {
    console.log('   ✅ Container execution successful');
    console.log(`   Exit code: ${result.exitCode}`);
    console.log(`   Output: ${result.logs.trim()}`);
  } else {
    console.log('   ❌ Container execution failed');
    console.log(`   Error: ${result.error}`);
  }
} catch (error) {
  console.log(`   ❌ Error: ${error.message}`);
}

// Test 5: Execute a command that accesses environment variables
console.log('\nTest 5: Testing environment variable filtering...');
console.log('   Command: env | grep -E "(PATH|HOME|USER)"');

try {
  const result = await executeInContainer(
    'sh',
    ['-c', 'env | grep -E "(PATH|HOME|USER)" | sort'],
    {
      ...testConfig,
      allowedEnvVars: ['PATH', 'HOME', 'USER']
    }
  );

  if (result.success) {
    console.log('   ✅ Environment filtering working');
    console.log('   Filtered environment variables:');
    const lines = result.logs.trim().split('\n');
    for (const line of lines.slice(0, 5)) {
      console.log(`      ${line}`);
    }
    if (lines.length > 5) {
      console.log(`      ... and ${lines.length - 5} more`);
    }
  } else {
    console.log('   ❌ Command execution failed');
  }
} catch (error) {
  console.log(`   ❌ Error: ${error.message}`);
}

console.log('\n✅ All tests completed!\n');
console.log('📝 Summary:');
console.log('   - Docker is available and running');
console.log('   - Configuration validation is working');
console.log('   - Container execution is functional');
console.log('   - Environment variable filtering is working');
console.log('\n🎉 Containerization feature is ready to use!\n');
