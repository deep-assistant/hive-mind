#!/usr/bin/env node

// Test script for disk space checking functionality

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Function to check available disk space (same as in hive.mjs and solve.mjs)
const checkDiskSpace = async (minSpaceMB = 500) => {
  try {
    // Get disk space for current directory
    const result = await $`df -m .`;
    const output = result.stdout.toString();
    
    // Parse df output - format: Filesystem 1M-blocks Used Available Use% Mounted on
    const lines = output.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('Unable to parse df output');
    }
    
    // Get the data line (skip header)
    const dataLine = lines[1].trim().split(/\s+/);
    const availableMB = parseInt(dataLine[3], 10);
    
    if (isNaN(availableMB)) {
      throw new Error('Unable to parse available disk space');
    }
    
    return {
      availableMB,
      hasEnoughSpace: availableMB >= minSpaceMB,
      requiredMB: minSpaceMB
    };
  } catch (error) {
    // Fallback: if df fails, try with alternative approach
    try {
      const result = await $`df -BM . | tail -1 | awk '{print $4}' | sed 's/M//'`;
      const availableMB = parseInt(result.stdout.toString().trim(), 10);
      
      if (isNaN(availableMB)) {
        throw new Error('Unable to determine disk space');
      }
      
      return {
        availableMB,
        hasEnoughSpace: availableMB >= minSpaceMB,
        requiredMB: minSpaceMB
      };
    } catch (fallbackError) {
      console.log(`Warning: Unable to check disk space: ${error.message}`);
      // Assume enough space if we can't check
      return {
        availableMB: -1,
        hasEnoughSpace: true,
        requiredMB: minSpaceMB
      };
    }
  }
};

async function runTests() {
  console.log('🧪 Testing disk space checking functionality...\n');

  // Test 1: Check default threshold (500 MB)
  console.log('Test 1: Default threshold (500 MB)');
  try {
    const result1 = await checkDiskSpace();
    console.log(`  ✅ Success: Available=${result1.availableMB} MB, Required=${result1.requiredMB} MB, HasEnough=${result1.hasEnoughSpace}`);
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
  }

  // Test 2: Very low threshold (1 MB) - should always pass
  console.log('\nTest 2: Very low threshold (1 MB)');
  try {
    const result2 = await checkDiskSpace(1);
    console.log(`  ✅ Success: Available=${result2.availableMB} MB, Required=${result2.requiredMB} MB, HasEnough=${result2.hasEnoughSpace}`);
    if (!result2.hasEnoughSpace) {
      console.log(`  ⚠️  Unexpected: Even 1 MB threshold failed!`);
    }
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
  }

  // Test 3: Very high threshold (1TB = 1000000 MB) - should fail
  console.log('\nTest 3: Very high threshold (1TB = 1000000 MB)');
  try {
    const result3 = await checkDiskSpace(1000000);
    console.log(`  ✅ Success: Available=${result3.availableMB} MB, Required=${result3.requiredMB} MB, HasEnough=${result3.hasEnoughSpace}`);
    if (result3.hasEnoughSpace && result3.availableMB >= 0) {
      console.log(`  😮 Wow: You have more than 1TB free space!`);
    }
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
  }

  // Test 4: Custom threshold matching current available space
  console.log('\nTest 4: Custom threshold based on current available space');
  try {
    const currentSpace = await checkDiskSpace(0);
    if (currentSpace.availableMB > 0) {
      const customThreshold = Math.max(1, currentSpace.availableMB - 100); // Leave 100MB buffer
      const result4 = await checkDiskSpace(customThreshold);
      console.log(`  ✅ Success: Available=${result4.availableMB} MB, Required=${result4.requiredMB} MB, HasEnough=${result4.hasEnoughSpace}`);
    } else {
      console.log(`  ⚠️  Skipped: Could not determine current available space`);
    }
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
  }

  console.log('\n🎯 Test completed!');
  
  // Show actual df command output for reference
  console.log('\n📊 Raw disk space information:');
  try {
    const dfResult = await $`df -h .`;
    console.log(dfResult.stdout.toString());
  } catch (error) {
    console.log(`Could not get df output: ${error.message}`);
  }
}

runTests().catch(console.error);