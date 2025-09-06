#!/usr/bin/env sh
':' //# ; exec "$(command -v node || command -v bun)" "$0" "$@"

/**
 * Cleanup script for test repositories created by create-test-repo.mjs
 * This script will find and delete all repositories matching the pattern: test-hello-world-*
 * 
 * Usage:
 *   ./cleanup-test-repos.mjs           # Interactive mode - asks for confirmation
 *   ./cleanup-test-repos.mjs --force   # Force mode - deletes without confirmation
 *   ./cleanup-test-repos.mjs --dry-run # Dry run - shows what would be deleted
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Parse command line arguments
const args = process.argv.slice(2);
const forceMode = args.includes('--force') || args.includes('-f');
const dryRun = args.includes('--dry-run') || args.includes('-n');

console.log('🧹 Test Repository Cleanup Tool');
console.log('================================\n');

if (dryRun) {
  console.log('📝 DRY RUN MODE - No repositories will be deleted\n');
} else if (forceMode) {
  console.log('⚠️  FORCE MODE - Repositories will be deleted without confirmation\n');
}

try {
  // Get current GitHub user
  const userResult = await $`gh api user --jq .login`;
  const githubUser = userResult.stdout.toString().trim();
  console.log(`👤 GitHub User: ${githubUser}`);
  console.log('');

  // List all repositories for the user
  console.log('🔍 Searching for test repositories...');
  
  // Get all repos (up to 100, adjust if needed)
  const reposResult = await $`gh repo list ${githubUser} --limit 100 --json name,url,createdAt,isPrivate`;
  const repos = JSON.parse(reposResult.stdout.toString());
  
  // Filter for test repositories matching the pattern
  const testRepos = repos.filter(repo => 
    repo.name.match(/^test-hello-world-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  );
  
  if (testRepos.length === 0) {
    console.log('✅ No test repositories found matching pattern: test-hello-world-*');
    console.log('');
    console.log('Nothing to clean up!');
    process.exit(0);
  }
  
  // Display found repositories
  console.log(`\n📦 Found ${testRepos.length} test repositories:\n`);
  
  testRepos.forEach((repo, index) => {
    const createdDate = new Date(repo.createdAt);
    const ageInDays = Math.floor((Date.now() - createdDate) / (1000 * 60 * 60 * 24));
    const ageText = ageInDays === 0 ? 'today' : 
                    ageInDays === 1 ? 'yesterday' : 
                    `${ageInDays} days ago`;
    
    console.log(`  ${index + 1}. ${repo.name}`);
    console.log(`     Created: ${createdDate.toISOString().split('T')[0]} (${ageText})`);
    console.log(`     URL: ${repo.url}`);
    console.log(`     Type: ${repo.isPrivate ? 'Private' : 'Public'}`);
    console.log('');
  });
  
  if (dryRun) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`🔍 DRY RUN COMPLETE - Would delete ${testRepos.length} repositories`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('To actually delete these repositories, run without --dry-run:');
    console.log('  ./cleanup-test-repos.mjs        # Interactive mode');
    console.log('  ./cleanup-test-repos.mjs --force # Delete without confirmation');
    process.exit(0);
  }
  
  // Ask for confirmation if not in force mode
  if (!forceMode) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`⚠️  WARNING: This will permanently delete ${testRepos.length} repositories!`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('Type "yes" to confirm deletion, or press Ctrl+C to cancel:');
    
    // Read user input
    const readline = (await import('readline')).default;
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      rl.question('> ', answer => {
        rl.close();
        resolve(answer);
      });
    });
    
    if (answer.toLowerCase() !== 'yes') {
      console.log('\n❌ Deletion cancelled');
      process.exit(0);
    }
  }
  
  // Delete repositories
  console.log('\n🗑️  Deleting repositories...\n');
  
  let deletedCount = 0;
  let failedCount = 0;
  
  for (const repo of testRepos) {
    process.stdout.write(`  Deleting ${repo.name}... `);
    
    try {
      // Use gh repo delete with --yes flag to skip confirmation
      await $`gh repo delete ${githubUser}/${repo.name} --yes > /dev/null 2>&1`;
      console.log('✅');
      deletedCount++;
    } catch (error) {
      console.log('❌');
      console.log(`    Error: ${error.message}`);
      failedCount++;
    }
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('✨ Cleanup Complete!');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`📊 Results:`);
  console.log(`   Deleted: ${deletedCount} repositories`);
  if (failedCount > 0) {
    console.log(`   Failed: ${failedCount} repositories`);
  }
  
} catch (error) {
  console.error('\n❌ Error:', error.message);
  if (error.stderr) {
    console.error('Details:', error.stderr.toString());
  }
  process.exit(1);
}