#!/usr/bin/env sh
':' //# ; exec "$(command -v bun || command -v node)" "$0" "$@"

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const crypto = (await import('crypto')).default;

// Generate UUIDv7
function generateUUIDv7() {
  // UUIDv7 has timestamp in the first 48 bits
  const timestamp = Date.now();
  const timestampHex = timestamp.toString(16).padStart(12, '0');
  
  // Random data for the rest
  const randomBytes = crypto.randomBytes(10);
  
  // Format as UUID with version 7 (0111) and variant bits (10)
  const uuid = [
    timestampHex.slice(0, 8),
    timestampHex.slice(8, 12),
    '7' + randomBytes.toString('hex').slice(0, 3),
    ((randomBytes[2] & 0x3f) | 0x80).toString(16).padStart(2, '0') + randomBytes.toString('hex').slice(5, 7),
    randomBytes.toString('hex').slice(7, 19)
  ].join('-');
  
  return uuid;
}

// List of programming languages for random selection
const languages = [
  'Python', 'JavaScript', 'TypeScript', 'Go', 'Rust', 'Ruby', 'Java', 'C++', 'C#', 'Swift',
  'Kotlin', 'Scala', 'Haskell', 'Elixir', 'Clojure', 'F#', 'OCaml', 'Erlang', 'Julia', 'R',
  'PHP', 'Perl', 'Lua', 'Dart', 'Zig', 'Nim', 'Crystal', 'V', 'D', 'Pascal',
  'COBOL', 'Fortran', 'Ada', 'Prolog', 'Scheme', 'Racket', 'Common Lisp', 'Elm', 'PureScript', 'ReasonML'
];

// Select random language
const randomLanguage = languages[Math.floor(Math.random() * languages.length)];

// Generate repository name with UUIDv7
const uuid = generateUUIDv7();
const repoName = `test-hello-world-${uuid}`;

console.log('🚀 Creating test repository for solve.mjs testing');
console.log(`📦 Repository name: ${repoName}`);
console.log(`💻 Programming language: ${randomLanguage}`);
console.log('');

try {
  // Get current GitHub user
  const userResult = await $`gh api user --jq .login`;
  const githubUser = userResult.stdout.toString().trim();
  console.log(`👤 GitHub user: ${githubUser}`);
  console.log('');

  // Create the repository
  console.log('Creating repository...');
  console.log(`Command: gh repo create ${repoName} --public --description "Test repository for automated issue solving" --clone=false`);
  
  let createRepoResult;
  try {
    createRepoResult = await $`gh repo create ${repoName} --public --description "Test repository for automated issue solving" --clone=false`;
  } catch (error) {
    console.error('Failed to create repository!');
    console.error('Exit code:', error.code);
    console.error('Stdout:', error.stdout ? error.stdout.toString() : '(empty)');
    console.error('Stderr:', error.stderr ? error.stderr.toString() : '(empty)');
    console.error('Full error:', error);
    
    // Check if repo already exists
    console.log('\nChecking if repository already exists...');
    try {
      const checkResult = await $`gh repo view ${githubUser}/${repoName} --json name`;
      console.log('Repository already exists! Continuing with existing repository...');
      const repoUrl = `https://github.com/${githubUser}/${repoName}`;
      // Set this so we can continue
      createRepoResult = { code: 0, stdout: Buffer.from(repoUrl) };
    } catch (checkError) {
      console.error('Repository does not exist. Original error stands.');
      process.exit(1);
    }
  }
  
  if (createRepoResult && createRepoResult.code !== 0) {
    console.error('Failed to create repository!');
    console.error('Exit code:', createRepoResult.code);
    console.error('Stdout:', createRepoResult.stdout ? createRepoResult.stdout.toString() : '(empty)');
    console.error('Stderr:', createRepoResult.stderr ? createRepoResult.stderr.toString() : '(empty)');
    process.exit(1);
  }

  const repoUrl = `https://github.com/${githubUser}/${repoName}`;
  console.log(`✅ Repository created: ${repoUrl}`);
  console.log('');

  // Initialize repository with a README
  console.log('Initializing repository with README...');
  
  // Create a temporary directory for initial commit
  const tempDir = `/tmp/${repoName}-init`;
  console.log(`Using temp directory: ${tempDir}`);
  
  try {
    await $`mkdir -p ${tempDir}`;
    
    // Clone the empty repository
    console.log('Cloning repository...');
    const cloneResult = await $`git clone ${repoUrl} ${tempDir} 2>&1`;
    console.log('Clone output:', cloneResult.stdout.toString());
    
    // Create README
    const readmeContent = `# ${repoName}

This is a test repository for automated issue solving.

## Purpose
This repository is used to test the \`solve.mjs\` script that automatically solves GitHub issues.

## Test Issue
An issue will be created asking to implement a "Hello World" program in ${randomLanguage}.
`;

    const readmePath = `${tempDir}/README.md`;
    console.log('Creating README.md...');
    
    // Use fs to write the file instead of echo to avoid shell escaping issues
    const fs = (await import('fs')).promises;
    await fs.writeFile(readmePath, readmeContent);
    
    // Check if file was created
    const fileCheck = await $`ls -la ${readmePath}`;
    console.log('README created:', fileCheck.stdout.toString().trim());
    
    // Commit and push README
    console.log('Adding README to git...');
    await $`cd ${tempDir} && git add README.md`;
    
    console.log('Committing...');
    await $`cd ${tempDir} && git commit -m "Initial commit with README"`;
    
    console.log('Pushing to origin...');
    // First try main, if that fails try master (but properly handle the error)
    try {
      const pushResult = await $`cd ${tempDir} && git push origin main`;
      console.log('Push result:', pushResult.stdout.toString());
    } catch (pushError) {
      // If main fails, it's likely because the default branch is master
      console.log('Push to main failed, trying master...');
      try {
        const pushResult = await $`cd ${tempDir} && git push origin master`;
        console.log('Push result:', pushResult.stdout.toString());
      } catch (masterError) {
        console.log('Push to master also failed');
        throw masterError;
      }
    }
    
    console.log('✅ Repository initialized with README');
    console.log('');

    // Clean up temp directory
    await $`rm -rf ${tempDir}`;
  } catch (initError) {
    console.error('Failed to initialize repository!');
    console.error('Error:', initError.message);
    if (initError.stdout) console.error('Stdout:', initError.stdout.toString());
    if (initError.stderr) console.error('Stderr:', initError.stderr.toString());
    
    // Try to clean up
    try {
      await $`rm -rf ${tempDir}`;
    } catch (cleanupError) {
      console.warn('Could not clean up temp directory:', cleanupError.message);
    }
    
    console.log('\n⚠️  Repository created but not initialized with README.');
    console.log('Continuing to create issue anyway...\n');
    // Don't exit, continue to create the issue
  }

  // Create the issue
  console.log('Creating issue...');
  
  const issueTitle = `Implement Hello World in ${randomLanguage}`;
  const issueBody = `## Task
Please implement a "Hello World" program in ${randomLanguage}.

## Requirements
1. Create a file with the appropriate extension for ${randomLanguage}
2. The program should print exactly: \`Hello, World!\`
3. Add clear comments explaining the code
4. Ensure the code follows ${randomLanguage} best practices and idioms
5. If applicable, include build/run instructions in a comment at the top of the file
6. **Create a GitHub Actions workflow that automatically runs and tests the program on every push and pull request**

## Expected Output
When the program runs, it should output:
\`\`\`
Hello, World!
\`\`\`

## GitHub Actions Requirements
The CI/CD workflow should:
- Trigger on push to main branch and on pull requests
- Set up the appropriate ${randomLanguage} runtime/compiler
- Run the Hello World program
- Verify the output is exactly "Hello, World!"
- Show a green check mark when tests pass

Example workflow structure:
- Checkout code
- Setup ${randomLanguage} environment
- Run the program
- Assert output matches expected string

## Additional Notes
- The implementation should be simple and straightforward
- Focus on clarity and correctness
- Use the standard library only (no external dependencies unless absolutely necessary for ${randomLanguage})
- The GitHub Actions workflow should be in \`.github/workflows/\` directory
- The workflow should have a meaningful name like \`test-hello-world.yml\`

## Definition of Done
- [ ] Program file created with correct extension
- [ ] Code prints "Hello, World!" exactly
- [ ] Code is properly commented
- [ ] Code follows ${randomLanguage} conventions
- [ ] Instructions for running the program are included (if needed)
- [ ] GitHub Actions workflow created and passing
- [ ] CI badge showing build status (optional but recommended)`;

  let createIssueResult;
  let issueUrl;
  
  try {
    // Write issue body to a temp file to avoid shell escaping issues
    const fs = (await import('fs')).promises;
    const issueBodyFile = `/tmp/issue-body-${Date.now()}.md`;
    await fs.writeFile(issueBodyFile, issueBody);
    
    console.log(`Command: gh issue create --repo ${repoUrl} --title "${issueTitle}" --body-file ${issueBodyFile}`);
    createIssueResult = await $`gh issue create --repo ${repoUrl} --title "${issueTitle}" --body-file ${issueBodyFile}`;
    
    // Clean up temp file
    await fs.unlink(issueBodyFile);
    
    // Extract issue URL from the output
    const issueOutput = createIssueResult.stdout.toString().trim();
    issueUrl = issueOutput.split('\n').pop(); // Last line contains the URL
    
  } catch (issueError) {
    console.error('Failed to create issue!');
    console.error('Exit code:', issueError.code);
    console.error('Stdout:', issueError.stdout ? issueError.stdout.toString() : '(empty)');
    console.error('Stderr:', issueError.stderr ? issueError.stderr.toString() : '(empty)');
    console.error('Full error:', issueError);
    process.exit(1);
  }
  
  if (!issueUrl || !issueUrl.includes('github.com')) {
    console.error('Failed to extract issue URL from output');
    console.error('Output was:', createIssueResult.stdout.toString());
    process.exit(1);
  }
  
  console.log(`✅ Issue created: ${issueUrl}`);
  console.log('');
  
  // Output summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('✨ Test environment created successfully!');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('📦 Repository URL:');
  console.log(`   ${repoUrl}`);
  console.log('');
  console.log('🎯 Issue URL:');
  console.log(`   ${issueUrl}`);
  console.log('');
  console.log(`💻 Language: ${randomLanguage}`);
  console.log('');
  console.log('🔧 To test solve.mjs with this issue, run:');
  console.log(`   ./solve.mjs "${issueUrl}"`);
  console.log('');
  console.log('📝 To view the issue in browser:');
  console.log(`   gh issue view ${issueUrl} --web`);
  console.log('');

  // Return results as JSON for potential programmatic use
  const results = {
    repository: repoUrl,
    issue: issueUrl,
    language: randomLanguage,
    repoName: repoName,
    uuid: uuid
  };
  
  // Write results to a file for easy access
  const resultsFile = `test-repo-${uuid}.json`;
  await $`echo '${JSON.stringify(results, null, 2)}' > ${resultsFile}`;
  console.log(`💾 Results saved to: ${resultsFile}`);

} catch (error) {
  console.error('❌ Error:', error.message);
  if (error.stderr) {
    console.error('Stderr:', error.stderr.toString());
  }
  process.exit(1);
}