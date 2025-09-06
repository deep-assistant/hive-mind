#!/usr/bin/env sh
':' //# ; exec "$(command -v node || command -v bun)" "$0" "$@"

/**
 * Cleanup script for test repositories created by create-test-repo.mjs
 * This script will find and delete all repositories matching the pattern: test-hello-world-{UUIDv7}
 * 
 * Only repositories with valid UUIDv7 identifiers are matched to ensure we don't accidentally
 * delete repositories that happen to have similar names but weren't created by our script.
 * 
 * UUIDv7 validation includes:
 * - Correct version (7) and variant bits
 * - Valid timestamp range (2020-2030)
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
  // Import child_process once
  const { execSync } = await import('child_process');
  
  // Get current GitHub user
  const githubUser = execSync('gh api user --jq .login', { encoding: 'utf8' }).trim();
  console.log(`👤 User: ${githubUser}`);

  // List all repositories for the user
  process.stdout.write('🔍 Searching for test repositories... ');
  
  // Get all repos (up to 100, adjust if needed) - suppress output
  const reposJson = execSync(`gh repo list ${githubUser} --limit 100 --json name,url,createdAt,isPrivate`, { encoding: 'utf8' });
  const repos = JSON.parse(reposJson);
  
  // Filter for test repositories matching the pattern with valid UUIDv7
  const testRepos = repos.filter(repo => {
    // Check basic pattern first
    const match = repo.name.match(/^test-hello-world-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
    if (!match) return false;
    
    const uuid = match[1];
    
    // Validate UUIDv7 format
    // UUIDv7 has version 7 in the 13th hex position (xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx)
    // and variant bits (8, 9, a, or b) in the 17th position (xxxxxxxx-xxxx-7xxx-[89ab]xxx-xxxxxxxxxxxx)
    const uuidv7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    if (!uuidv7Pattern.test(uuid)) return false;
    
    // Additional UUIDv7 validation: timestamp should be reasonable
    // First 48 bits (12 hex chars) represent Unix timestamp in milliseconds
    const timestampHex = uuid.replace(/-/g, '').substring(0, 12);
    const timestamp = parseInt(timestampHex, 16);
    
    // Check if timestamp is reasonable (between 2020 and 2030)
    const minTimestamp = new Date('2020-01-01').getTime();
    const maxTimestamp = new Date('2030-01-01').getTime();
    
    return timestamp >= minTimestamp && timestamp <= maxTimestamp;
  });
  
  if (testRepos.length === 0) {
    console.log('none found ✅');
    console.log('');
    console.log('Nothing to clean up!');
    process.exit(0);
  }
  
  // Display found repositories
  console.log(`found ${testRepos.length}`);
  console.log('');
  console.log(`📦 Test repositories:\n`);
  
  testRepos.forEach((repo, index) => {
    const createdDate = new Date(repo.createdAt);
    const ageInDays = Math.floor((Date.now() - createdDate) / (1000 * 60 * 60 * 24));
    const ageText = ageInDays === 0 ? 'today' : 
                    ageInDays === 1 ? 'yesterday' : 
                    `${ageInDays} days ago`;
    
    console.log(`  ${(index + 1).toString().padStart(2)}. ${repo.url} (${ageText})`);
  });
  
  console.log('');
  
  if (dryRun) {
    console.log('✅ DRY RUN COMPLETE');
    console.log(`Would delete ${testRepos.length} repositories`);
    console.log('');
    console.log('To actually delete:');
    console.log('  ./cleanup-test-repos.mjs        # With confirmation');
    console.log('  ./cleanup-test-repos.mjs --force # Without confirmation');
    process.exit(0);
  }
  
  // Ask for confirmation if not in force mode
  if (!forceMode) {
    console.log(`⚠️  This will permanently delete ${testRepos.length} repositories!`);
    console.log('');
    console.log('Type "yes" to confirm, or Ctrl+C to cancel:');
    process.stdout.write('> ');
    
    // Use execSync to read input, which handles Ctrl+C properly
    try {
      // Read from stdin using shell command
      const answer = execSync('read answer && echo $answer', { 
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: '/bin/bash'
      }).trim();
      
      if (answer.toLowerCase() !== 'yes') {
        console.log('\n❌ Cancelled');
        process.exit(0);
      }
    } catch (e) {
      // Ctrl+C was pressed (execSync throws on SIGINT)
      console.log('\n\n❌ Cancelled');
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
      // Don't suppress stderr - we need to see errors
      const result = await $`gh repo delete ${githubUser}/${repo.name} --yes`;
      console.log('✅');
      deletedCount++;
    } catch (error) {
      console.log('❌');
      // Show the actual error from gh command
      if (error.stderr) {
        const errorMsg = error.stderr.toString().trim();
        console.log(`    Error: ${errorMsg}`);
      } else if (error.message) {
        console.log(`    Error: ${error.message}`);
      } else {
        console.log(`    Error: Unknown error occurred`);
      }
      failedCount++;
    }
  }
  
  console.log('');
  console.log('✨ Cleanup complete!');
  console.log('');
  console.log(`Deleted: ${deletedCount} repositories`);
  if (failedCount > 0) {
    console.log(`Failed: ${failedCount} repositories`);
  }
  
} catch (error) {
  console.error('\n❌ Error:', error.message);
  if (error.stderr) {
    console.error('Details:', error.stderr.toString());
  }
  process.exit(1);
}