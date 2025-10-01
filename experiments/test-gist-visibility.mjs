#!/usr/bin/env node
// Test script to verify gist visibility detection and creation

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
globalThis.use = use;

const { $ } = await use('command-stream');

async function testGistVisibility() {
  console.log('🧪 Testing Gist Visibility Detection\n');

  // Test with public repository (deep-assistant/hive-mind)
  console.log('1. Testing with PUBLIC repository (deep-assistant/hive-mind):');
  try {
    const visibilityResult = await $`gh api repos/deep-assistant/hive-mind --jq .visibility`;
    const visibility = visibilityResult.stdout.toString().trim();
    console.log(`   ✅ Repository visibility: ${visibility}`);

    if (visibility === 'public') {
      console.log('   → Gist should be created with --public flag\n');
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}\n`);
  }

  // Test with a private repository (if accessible)
  console.log('2. Testing with PRIVATE repository (example):');
  console.log('   Note: This will only work if you have access to a private repo');

  // Get current user to find their repos
  try {
    const userResult = await $`gh api user --jq .login`;
    const username = userResult.stdout.toString().trim();
    console.log(`   Current user: ${username}`);

    // List user's private repos
    const reposResult = await $`gh repo list ${username} --json name,visibility --jq '.[] | select(.visibility == "private") | .name' --limit 1`;
    const privateRepo = reposResult.stdout.toString().trim();

    if (privateRepo) {
      const fullRepoName = `${username}/${privateRepo}`;
      console.log(`   Found private repo: ${fullRepoName}`);

      const visibilityResult = await $`gh api repos/${fullRepoName} --jq .visibility`;
      const visibility = visibilityResult.stdout.toString().trim();
      console.log(`   ✅ Repository visibility: ${visibility}`);

      if (visibility === 'private') {
        console.log('   → Gist should be created WITHOUT --public flag (private/secret)\n');
      }
    } else {
      console.log('   ℹ️  No private repositories found for testing\n');
    }
  } catch (error) {
    console.log(`   ⚠️  Could not test private repo: ${error.message}\n`);
  }

  // Test gist creation command generation
  console.log('3. Testing gist command generation logic:');

  function generateGistCommand(isPublicRepo, fileName, description) {
    const baseCommand = `gh gist create "${fileName}" --desc "${description}" --filename "test.txt"`;
    return isPublicRepo ? `${baseCommand.slice(0, -40)} --public${baseCommand.slice(-40)}` : baseCommand;
  }

  const publicCommand = generateGistCommand(true, '/tmp/test.txt', 'Test gist');
  const privateCommand = generateGistCommand(false, '/tmp/test.txt', 'Test gist');

  console.log('   Public repo → Command with --public:');
  console.log(`   ${publicCommand.includes('--public') ? '✅' : '❌'} ${publicCommand}`);

  console.log('\n   Private repo → Command without --public:');
  console.log(`   ${!privateCommand.includes('--public') ? '✅' : '❌'} ${privateCommand}`);

  console.log('\n✨ Test complete!');
}

// Run the test
testGistVisibility().catch(console.error);