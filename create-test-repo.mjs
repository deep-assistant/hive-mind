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
  const createRepoResult = await $`gh repo create ${repoName} --public --description "Test repository for automated issue solving" --clone=false`;
  
  if (createRepoResult.exitCode !== 0) {
    console.error('Failed to create repository:', createRepoResult.stderr.toString());
    process.exit(1);
  }

  const repoUrl = `https://github.com/${githubUser}/${repoName}`;
  console.log(`✅ Repository created: ${repoUrl}`);
  console.log('');

  // Initialize repository with a README
  console.log('Initializing repository with README...');
  
  // Create a temporary directory for initial commit
  const tempDir = `/tmp/${repoName}-init`;
  await $`mkdir -p ${tempDir}`;
  
  // Clone the empty repository
  await $`git clone ${repoUrl} ${tempDir}`;
  
  // Create README
  const readmeContent = `# ${repoName}

This is a test repository for automated issue solving.

## Purpose
This repository is used to test the \`solve.mjs\` script that automatically solves GitHub issues.

## Test Issue
An issue will be created asking to implement a "Hello World" program in ${randomLanguage}.
`;

  await $`echo "${readmeContent}" > ${tempDir}/README.md`;
  
  // Commit and push README
  await $`cd ${tempDir} && git add README.md`;
  await $`cd ${tempDir} && git commit -m "Initial commit with README"`;
  await $`cd ${tempDir} && git push origin main`;
  
  console.log('✅ Repository initialized with README');
  console.log('');

  // Clean up temp directory
  await $`rm -rf ${tempDir}`;

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

## Expected Output
When the program runs, it should output:
\`\`\`
Hello, World!
\`\`\`

## Additional Notes
- The implementation should be simple and straightforward
- Focus on clarity and correctness
- Use the standard library only (no external dependencies unless absolutely necessary for ${randomLanguage})

## Definition of Done
- [ ] Program file created with correct extension
- [ ] Code prints "Hello, World!" exactly
- [ ] Code is properly commented
- [ ] Code follows ${randomLanguage} conventions
- [ ] Instructions for running the program are included (if needed)`;

  const createIssueResult = await $`gh issue create --repo ${repoUrl} --title "${issueTitle}" --body "${issueBody}"`;
  
  if (createIssueResult.exitCode !== 0) {
    console.error('Failed to create issue:', createIssueResult.stderr.toString());
    process.exit(1);
  }

  // Extract issue URL from the output
  const issueOutput = createIssueResult.stdout.toString().trim();
  const issueUrl = issueOutput.split('\n').pop(); // Last line contains the URL
  
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