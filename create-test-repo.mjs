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
console.log(`📦 Repository: ${repoName}`);
console.log(`💻 Language: ${randomLanguage}`);
console.log('');

try {
  // Get current GitHub user
  const userResult = await $`gh api user --jq .login`;
  const githubUser = userResult.stdout.toString().trim();
  console.log(`👤 User: ${githubUser}`);

  // Create the repository
  process.stdout.write('📝 Creating repository... ');
  
  let createRepoResult;
  try {
    createRepoResult = await $`gh repo create ${repoName} --public --description "Test repository for automated issue solving" --clone=false > /dev/null 2>&1`;
  } catch (error) {
    console.log('❌ Failed!');
    console.error('Error:', error.message);
    
    // Check if repo already exists
    try {
      const checkResult = await $`gh repo view ${githubUser}/${repoName} --json name`;
      console.log('Repository already exists, continuing...');
      const repoUrl = `https://github.com/${githubUser}/${repoName}`;
      createRepoResult = { code: 0, stdout: Buffer.from(repoUrl) };
    } catch (checkError) {
      process.exit(1);
    }
  }
  
  if (createRepoResult && createRepoResult.code !== 0) {
    console.log('❌ Failed!');
    process.exit(1);
  }

  const repoUrl = `https://github.com/${githubUser}/${repoName}`;
  console.log('✅');

  // Initialize repository with a README
  process.stdout.write('📄 Initializing repository... ');
  
  // Create a temporary directory for initial commit
  const tempDir = `/tmp/${repoName}-init`;
  
  try {
    await $`mkdir -p ${tempDir}`;
    
    // Clone the empty repository (suppress warning about empty repo)
    await $`git clone ${repoUrl} ${tempDir} > /dev/null 2>&1`;
    
    // Create README
    const readmeContent = `# ${repoName}

This is a test repository for automated issue solving.

## Purpose
This repository is used to test the \`solve.mjs\` script that automatically solves GitHub issues.

## Test Issue
An issue will be created asking to implement a "Hello World" program in ${randomLanguage}.
`;

    const readmePath = `${tempDir}/README.md`;
    
    // Use fs to write the file instead of echo to avoid shell escaping issues
    const fs = (await import('fs')).promises;
    await fs.writeFile(readmePath, readmeContent);
    
    // Commit and push README
    await $`cd ${tempDir} && git add README.md`;
    await $`cd ${tempDir} && git commit -m "Initial commit with README" > /dev/null 2>&1`;
    
    // Try to push to main first, then master if that fails
    try {
      await $`cd ${tempDir} && git push origin main > /dev/null 2>&1`;
    } catch (pushError) {
      // If main fails, try master
      try {
        await $`cd ${tempDir} && git push origin master > /dev/null 2>&1`;
      } catch (masterError) {
        throw masterError;
      }
    }
    
    console.log('✅');

    // Clean up temp directory
    await $`rm -rf ${tempDir}`;
  } catch (initError) {
    console.log('⚠️  (skipped)');
    // Don't exit, continue to create the issue
  }

  // Create the issue
  process.stdout.write('🎯 Creating issue... ');
  
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
    
    // IMPORTANT: Workaround for command-stream quoting issue
    // Problem: command-stream adds extra single quotes around interpolated strings
    // When we use: await $`gh issue create --title "${issueTitle}"`
    // The title becomes: 'Implement Hello World in X' (with single quotes included!)
    // 
    // This is a known issue with command-stream library (see command-stream-issues/issue-09-auto-quoting.mjs)
    // The library appears to "over-escape" by adding its own single quotes around the interpolated value
    // when it detects double quotes in the template literal.
    //
    // WORKAROUND: Use Node.js native child_process.execSync instead of command-stream
    // This gives us direct control over the command string without unexpected quote additions
    
    // Using execSync to avoid command-stream's automatic quote addition
    const { execSync } = await import('child_process');
    const command = `gh issue create --repo ${repoUrl} --title "${issueTitle}" --body-file ${issueBodyFile}`;
    const output = execSync(command, { encoding: 'utf8', cwd: '/tmp' });
    createIssueResult = { stdout: Buffer.from(output) };
    
    // Note: If GitHub CLI had a --title-file option (like --body-file), we would use that instead
    // to completely avoid shell escaping issues
    
    // Clean up temp file
    await fs.unlink(issueBodyFile);
    
    // Extract issue URL from the output
    const issueOutput = createIssueResult.stdout.toString().trim();
    issueUrl = issueOutput.split('\n').pop(); // Last line contains the URL
    
  } catch (issueError) {
    console.log('❌ Failed!');
    console.error('Error:', issueError.message);
    process.exit(1);
  }
  
  if (!issueUrl || !issueUrl.includes('github.com')) {
    console.log('❌ Failed to extract issue URL');
    process.exit(1);
  }
  
  console.log('✅');
  console.log('');
  
  // Output summary
  console.log('✨ Test environment created successfully!');
  console.log('');
  console.log('📦 Repository:');
  console.log(`   ${repoUrl}`);
  console.log('');
  console.log('🎯 Issue:');
  console.log(`   ${issueUrl}`);
  console.log('');
  console.log('🚀 Test with:');
  console.log(`   ./solve.mjs "${issueUrl}"`);

} catch (error) {
  console.log('');
  console.error('❌ Error:', error.message);
  process.exit(1);
}