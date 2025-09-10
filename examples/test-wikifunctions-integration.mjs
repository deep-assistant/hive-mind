#!/usr/bin/env node

/**
 * Test and demonstration script for Wikifunctions.org integration with Hive Mind
 * This script showcases how to use https://www.wikifunctions.org as AI skills
 * 
 * Usage:
 *   node examples/test-wikifunctions-integration.mjs
 *   node examples/test-wikifunctions-integration.mjs --test-all
 *   node examples/test-wikifunctions-integration.mjs --demo-only
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

const { WikifunctionsSkills } = await import('../wikifunctions-skills.mjs');
const yargs = (await use('yargs@latest')).default;

const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 [options]')
  .option('test-all', {
    type: 'boolean',
    description: 'Run comprehensive tests of all skills',
    default: false
  })
  .option('demo-only', {
    type: 'boolean', 
    description: 'Run only basic demos without comprehensive testing',
    default: false
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Enable verbose output',
    alias: 'v',
    default: false
  })
  .help()
  .argv;

// Initialize Wikifunctions skills
const skills = new WikifunctionsSkills();

console.log('🧠 Wikifunctions.org Integration Test for Hive Mind');
console.log('=' .repeat(60));
console.log(`🌐 Base URL: ${skills.baseUrl}`);
console.log(`⏱️  Request timeout: ${skills.timeout}ms`);
console.log(`🗄️  Cache TTL: ${skills.cacheTTL}ms`);
console.log();

async function runBasicDemo() {
  console.log('📋 Available Skills:');
  const availableSkills = skills.getAvailableSkills();
  availableSkills.forEach((skill, index) => {
    console.log(`${index + 1}. ${skill.name}: ${skill.description}`);
    if (argv.verbose) {
      console.log(`   Example: ${skill.example}`);
    }
  });
  console.log();

  if (argv.demoOnly) return;

  console.log('🔍 Testing Basic Skills:');
  
  try {
    // Test 1: Prime number checking
    console.log('\n1. Prime Number Check:');
    const testNumbers = [2, 3, 17, 25, 97];
    for (const num of testNumbers) {
      try {
        const isPrime = await skills.isPrime(num);
        console.log(`   ${num} is ${isPrime ? 'prime' : 'not prime'} ✓`);
      } catch (error) {
        console.log(`   ${num}: Error - ${error.message} ✗`);
      }
    }

    // Test 2: Caesar Cipher
    console.log('\n2. Caesar Cipher:');
    const testStrings = ['Hello World', 'Hive Mind', 'AI Skills'];
    for (const text of testStrings) {
      try {
        const encoded = await skills.caesarCipher(text, 13);
        console.log(`   "${text}" -> "${encoded}" ✓`);
      } catch (error) {
        console.log(`   "${text}": Error - ${error.message} ✗`);
      }
    }

    // Test 3: Function Search
    console.log('\n3. Function Search:');
    const searchTerms = ['math', 'string', 'prime'];
    for (const term of searchTerms) {
      try {
        const results = await skills.searchFunctions(term, 2);
        console.log(`   "${term}": Found ${results.length} functions ✓`);
        if (argv.verbose && results.length > 0) {
          results.forEach(func => console.log(`     - ${func.title}`));
        }
      } catch (error) {
        console.log(`   "${term}": Error - ${error.message} ✗`);
      }
    }

  } catch (error) {
    console.error('❌ Demo failed:', error.message);
  }
}

async function runComprehensiveTests() {
  console.log('\n🧪 Comprehensive Testing:');

  const testResults = {
    passed: 0,
    failed: 0,
    total: 0
  };

  const test = async (name, testFn) => {
    testResults.total++;
    try {
      await testFn();
      console.log(`✅ ${name}`);
      testResults.passed++;
    } catch (error) {
      console.log(`❌ ${name}: ${error.message}`);
      testResults.failed++;
    }
  };

  // API connectivity tests
  await test('API Connectivity', async () => {
    const result = await skills.fetchFunction('Z801'); // Prime check function
    if (!result || result.error) {
      throw new Error('Failed to fetch basic function');
    }
  });

  // Caching tests
  await test('Cache Functionality', async () => {
    // Clear cache first
    skills.clearCache();
    
    // Make same request twice
    const start1 = Date.now();
    await skills.fetchFunction('Z801');
    const time1 = Date.now() - start1;
    
    const start2 = Date.now();
    await skills.fetchFunction('Z801');
    const time2 = Date.now() - start2;
    
    // Second request should be significantly faster (cached)
    if (time2 >= time1) {
      throw new Error(`Caching not working: ${time1}ms vs ${time2}ms`);
    }
  });

  // Prime number edge cases
  await test('Prime Edge Cases', async () => {
    const edgeCases = [
      { num: 1, expected: false },
      { num: 2, expected: true },
      { num: -5, expected: false }
    ];
    
    for (const { num, expected } of edgeCases) {
      const result = await skills.isPrime(num);
      if (result !== expected) {
        throw new Error(`Prime check failed for ${num}: expected ${expected}, got ${result}`);
      }
    }
  });

  // Error handling tests
  await test('Error Handling', async () => {
    try {
      // Try to run a non-existent function
      await skills.runFunction('Z999999');
      throw new Error('Should have thrown an error for non-existent function');
    } catch (error) {
      // This is expected
      if (!error.message.includes('Failed to run function')) {
        throw error;
      }
    }
  });

  // Popular functions test
  await test('Popular Functions Access', async () => {
    const popular = await skills.getPopularFunctions();
    if (!Array.isArray(popular) || popular.length === 0) {
      throw new Error('No popular functions returned');
    }
  });

  console.log('\n📊 Test Results:');
  console.log(`   Passed: ${testResults.passed}/${testResults.total}`);
  console.log(`   Failed: ${testResults.failed}/${testResults.total}`);
  console.log(`   Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);

  if (testResults.failed > 0) {
    console.log('\n⚠️  Some tests failed. This might indicate network issues or API changes.');
  } else {
    console.log('\n🎉 All tests passed! Wikifunctions integration is working correctly.');
  }
}

async function demonstrateHiveIntegration() {
  console.log('\n🤖 Hive Mind Integration Demo:');
  console.log('The following shows how Wikifunctions skills can be used by AI agents:');
  
  const scenarios = [
    {
      task: 'Mathematical Analysis',
      description: 'AI agent needs to verify if user input is a prime number',
      example: async () => {
        const number = 89;
        const result = await skills.isPrime(number);
        return `Agent determined that ${number} is ${result ? 'prime' : 'composite'}`;
      }
    },
    {
      task: 'Text Processing', 
      description: 'AI agent needs to encode sensitive data for logging',
      example: async () => {
        const sensitive = 'user-secret-key';
        const encoded = await skills.caesarCipher(sensitive, 7);
        return `Agent encoded "${sensitive}" as "${encoded}" for secure logging`;
      }
    },
    {
      task: 'Skill Discovery',
      description: 'AI agent searches for relevant functions to solve a problem',
      example: async () => {
        const functions = await skills.searchFunctions('factorial', 1);
        return `Agent found ${functions.length} factorial-related functions for computation`;
      }
    }
  ];

  for (const scenario of scenarios) {
    try {
      console.log(`\n📝 ${scenario.task}:`);
      console.log(`   Context: ${scenario.description}`);
      const result = await scenario.example();
      console.log(`   Result: ${result} ✓`);
    } catch (error) {
      console.log(`   Error: ${error.message} ✗`);
    }
  }
}

// Main execution
async function main() {
  try {
    await runBasicDemo();
    
    if (argv.testAll && !argv.demoOnly) {
      await runComprehensiveTests();
    }
    
    if (!argv.demoOnly) {
      await demonstrateHiveIntegration();
    }
    
    console.log('\n🏁 Integration test completed successfully!');
    console.log('\n💡 Usage Tips:');
    console.log('   • Use `./hive.mjs --wikifunctions-skills <url>` to list available skills');
    console.log('   • Use `./hive.mjs --wikifunctions-demo <url>` to run a quick demo');
    console.log('   • Import WikifunctionsSkills in your AI agents for enhanced capabilities');
    
  } catch (error) {
    console.error('\n❌ Integration test failed:', error.message);
    process.exit(1);
  }
}

// Run the main function
await main();