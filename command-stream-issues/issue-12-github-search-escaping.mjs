#!/usr/bin/env node

/**
 * Issue: GitHub search queries with labels containing spaces fail due to multiple escaping layers
 * 
 * Minimal reproduction showing that command-stream incorrectly escapes GitHub search queries
 * with labels that contain spaces, resulting in invalid search queries.
 * 
 * Pattern: try { reproduction } catch { workaround }
 */

console.log('🐛 Issue #12: GitHub search query escaping with labels containing spaces\n');

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Direct imports with top-level await
import { execSync } from 'child_process';

/**
 * Custom error for search query escaping issues
 */
class SearchQueryEscapingError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'SearchQueryEscapingError';
    this.details = details;
  }
}

/**
 * Main test - minimal reproduction
 */
async function runTest() {
  console.log('='.repeat(60));
  console.log('REPRODUCING ISSUE\n');
  
  try {
    // TRY: Reproduce the issue - GitHub search with label containing spaces
    const owner = 'microsoft';
    const repo = 'vscode';
    const labelWithSpaces = 'help wanted';
    
    console.log('1️⃣  Using command-stream $ for GitHub search:');
    console.log(`   Repository: ${owner}/${repo}`);
    console.log(`   Label: "${labelWithSpaces}"`);
    
    // Build search query
    const searchQuery = `repo:${owner}/${repo} is:issue is:open label:"${labelWithSpaces}"`;
    console.log(`   Query: ${searchQuery}\n`);
    
    try {
      // Attempt 1: Direct interpolation with quotes
      console.log('   Attempt 1: Direct interpolation');
      const result1 = await $`gh search issues "${searchQuery}" --limit 1 --json url,title 2>&1`;
      
      if (result1.code !== 0 && result1.stderr?.toString().includes('Invalid search query')) {
        const errorOutput = result1.stderr.toString();
        // Extract the actual query that was sent
        const actualQuery = errorOutput.match(/"([^"]+)" type:issue/)?.[1] || 'unknown';
        
        throw new SearchQueryEscapingError(
          'Direct interpolation failed',
          {
            expectedQuery: searchQuery,
            actualQuery: actualQuery,
            error: errorOutput.split('\n')[0]
          }
        );
      }
      
      console.log('   ✅ Direct interpolation worked (issue may be fixed)');
      
    } catch (error1) {
      if (error1 instanceof SearchQueryEscapingError) {
        console.log(`   ❌ ${error1.message}`);
        console.log(`      Expected: ${error1.details.expectedQuery}`);
        console.log(`      Actual: ${error1.details.actualQuery}`);
        console.log(`      Error: ${error1.details.error}\n`);
      }
      
      // Attempt 2: Without outer quotes
      console.log('   Attempt 2: Without outer quotes');
      try {
        const result2 = await $`gh search issues ${searchQuery} --limit 1 --json url,title 2>&1`;
        
        if (result2.code !== 0 && result2.stderr?.toString().includes('Invalid search query')) {
          const errorOutput = result2.stderr.toString();
          const actualQuery = errorOutput.match(/"([^"]+)" type:issue/)?.[1] || 'unknown';
          
          throw new SearchQueryEscapingError(
            'Unquoted interpolation failed',
            {
              expectedQuery: searchQuery,
              actualQuery: actualQuery,
              error: errorOutput.split('\n')[0]
            }
          );
        }
        
        console.log('   ✅ Unquoted interpolation worked');
        
      } catch (error2) {
        if (error2 instanceof SearchQueryEscapingError) {
          console.log(`   ❌ ${error2.message}`);
          console.log(`      Actual query: ${error2.details.actualQuery}\n`);
        }
        
        // Attempt 3: Array of arguments
        console.log('   Attempt 3: Arguments as array');
        try {
          const searchArgs = [`repo:${owner}/${repo}`, 'is:issue', 'is:open', `label:"${labelWithSpaces}"`];
          const result3 = await $`gh search issues ${searchArgs} --limit 1 --json url,title 2>&1`;
          
          if (result3.code !== 0) {
            throw new SearchQueryEscapingError(
              'Array arguments failed',
              {
                args: searchArgs,
                error: result3.stderr?.toString().split('\n')[0]
              }
            );
          }
          
          const issues = JSON.parse(result3.stdout.toString() || '[]');
          console.log(`   ✅ Array arguments worked! Found ${issues.length} issue(s)`);
          
        } catch (error3) {
          if (error3 instanceof SearchQueryEscapingError) {
            console.log(`   ❌ ${error3.message}`);
            console.log(`      Args: ${error3.details.args.join(' ')}`);
            console.log(`      Error: ${error3.details.error}`);
          }
          
          // All command-stream attempts failed
          console.log('\n❌ ISSUE CONFIRMED: All command-stream attempts failed');
          
          console.log('\n' + '='.repeat(60));
          console.log('APPLYING WORKAROUND\n');
          
          // WORKAROUND: Use execSync
          console.log('2️⃣  Using execSync workaround:');
          
          const command = `gh search issues 'repo:${owner}/${repo} is:issue is:open label:"${labelWithSpaces}"' --limit 1 --json url,title`;
          console.log(`   Command: ${command}\n`);
          
          try {
            const output = execSync(command, { encoding: 'utf8' });
            const issues = JSON.parse(output || '[]');
            
            if (issues.length > 0) {
              console.log(`   ✅ WORKAROUND SUCCESSFUL!`);
              console.log(`   Found ${issues.length} issue(s)`);
              console.log(`   Example: ${issues[0].title}`);
            } else {
              console.log(`   ⚠️  No issues found (may be correct)`);
            }
          } catch (execError) {
            console.log(`   ❌ Even execSync failed: ${execError.message}`);
            console.log('   Note: Repository may not have issues with this label');
          }
        }
      }
    }
    
  } catch (unexpectedError) {
    console.error('\n❌ Unexpected error:', unexpectedError.message);
    throw unexpectedError;
  }
  
  // SUMMARY
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY\n');
  console.log('❌ ISSUE: command-stream multiply escapes quotes in GitHub search queries');
  console.log('   • Quotes within labels get escaped multiple times');
  console.log('   • Results in invalid search queries like:');
  console.log('     repo:\\"owner/repo is:issue label:\\\\\\"help wanted\\\\\\" type:issue');
  console.log('\n✅ WORKAROUND OPTIONS:');
  console.log('   1. Use execSync with single quotes around entire query');
  console.log('   2. Pass arguments as array (sometimes works)');
  console.log('   3. Avoid labels with spaces when possible');
  console.log('\nExample workaround code:');
  console.log('  execSync(`gh search issues \'${query}\' --json url`, {encoding: "utf8"})');
}

// Run the test with top-level await
try {
  await runTest();
} catch (error) {
  process.exit(1);
}