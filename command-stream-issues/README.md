# Command-Stream Library Issues

This directory contains reproducible test cases for issues encountered with the command-stream library when using the `$` template literal syntax.

## Issues Documented

1. **issue-01-multiline-strings.mjs** - Multi-line strings with special characters cause shell escaping problems
2. **issue-02-error-handling.mjs** - The library uses `error.code` instead of `error.exitCode`
3. **issue-03-json-escaping.mjs** - JSON strings with quotes cause escaping issues
4. **issue-04-github-cli-body.mjs** - GitHub CLI with complex markdown body fails
5. **issue-05-paths-with-spaces.mjs** - File paths with spaces need proper quoting
6. **issue-06-bun-shell-path.mjs** - Bun runtime has issues with /bin/sh path
7. **issue-07-stream-output.mjs** - Stream output handling requires careful chunk type management
8. **issue-08-getcwd-error.mjs** - getcwd() failed error when working in deleted directories
9. **issue-09-auto-quoting.mjs** - String interpolation with quotes can add extra quotes to output

## Running the Tests

Each issue can be tested independently:

```bash
# With Node.js (recommended)
node ./issue-01-multiline-strings.mjs

# With Bun (may have shell path issues)
bun ./issue-01-multiline-strings.mjs

# Run all tests
for script in issue-*.mjs; do echo "=== $script ==="; node "$script"; done
```

## Summary of Best Practices

1. **For file operations with complex content:**
   - Use `fs.writeFile()` instead of echo with interpolation
   - Use heredocs for shell scripts that need multi-line content

2. **For GitHub CLI with complex markdown:**
   - Use `--body-file` parameter instead of `--body` with interpolation
   - Write content to temp file first, then reference it

3. **For error handling:**
   - Use `error.code`, not `error.exitCode`
   - Check for `error.stdout` and `error.stderr` for debugging

4. **For JSON data:**
   - Write to file with `fs.writeFile` instead of echo
   - Avoid shell interpolation of complex JSON strings

5. **For paths with spaces:**
   - Always quote paths in shell commands
   - Consider using fs operations when possible

6. **For Bun compatibility:**
   - Be aware of shell path issues
   - Consider using Node.js for scripts that heavily rely on shell commands

## General Principle

When dealing with user-generated or complex content, prefer Node.js fs operations over shell commands to avoid escaping issues entirely.

## UX Evaluation of command-stream Library

### Strengths
1. **Clean syntax** - The `$` template literal provides an elegant, bash-like syntax
2. **Cross-runtime support** - Works with both Node.js and Bun (with caveats)
3. **Streaming support** - Ability to handle real-time output via `.stream()`
4. **Promise-based** - Modern async/await support

### Pain Points
1. **Shell escaping complexity** - Interpolation of complex strings fails silently or unexpectedly
2. **Automatic quote addition** - `"${variable}"` syntax adds unwanted single quotes to output
3. **Inconsistent error API** - Uses `error.code` instead of standard `error.exitCode`
4. **Bun compatibility issues** - Shell path problems make it unreliable with Bun runtime
5. **Poor error messages** - Escaping failures often produce cryptic or misleading errors
6. **Documentation gaps** - Many edge cases and best practices are undocumented

### Developer Experience Issues

#### 1. Escaping Surprises
- **Expected**: String interpolation "just works"
- **Reality**: Complex strings with quotes, backticks, or newlines break commands
- **Impact**: Developers waste time debugging shell escaping issues

#### 2. Automatic Quote Addition (Critical Issue #9)
- **Expected**: `"${variable}"` passes the variable value cleanly
- **Reality**: command-stream adds single quotes, resulting in `'value'` instead of `value`
- **Impact**: GitHub issues/PRs get titles with quotes, data corruption in production
- **Workaround**: Must use `child_process.execSync()` instead for precise string handling

#### 3. Error Handling Confusion
- **Expected**: Standard Node.js error properties (`exitCode`)
- **Reality**: Custom property names (`code`)
- **Impact**: Copy-pasted error handling code fails

#### 4. Runtime Inconsistency
- **Expected**: Same behavior across Node.js and Bun
- **Reality**: Bun fails with ENOENT errors for basic commands
- **Impact**: Scripts work in development but fail in production

#### 5. Silent Failures
- **Expected**: Clear errors when commands fail
- **Reality**: Some escaping issues cause silent data corruption
- **Impact**: Bugs reach production undetected

## Recommendations for command-stream Library

### For Library Maintainers

1. **Improve shell escaping**
   - Automatically escape special characters in interpolated strings
   - Provide a `.raw()` method for when escaping is not desired
   - Add warnings for potentially problematic characters

2. **Standardize error interface**
   - Use `exitCode` instead of `code` for consistency
   - Provide better error messages for common issues
   - Include the actual command that failed in error output

3. **Fix Bun compatibility**
   - Handle symlinked shells properly
   - Provide fallback shell detection
   - Document runtime-specific limitations

4. **Enhance documentation**
   - Add a troubleshooting guide for common issues
   - Provide more examples with complex real-world scenarios
   - Document all edge cases and workarounds

5. **Add safety features**
   - Option to validate/sanitize inputs
   - Dry-run mode to preview commands
   - Built-in protection against injection attacks

### For Developers Using command-stream

1. **Critical: Avoid quote interpolation bug**
   ```javascript
   // DON'T: This adds unwanted single quotes to the output!
   await $`gh issue create --title "${title}"`;
   // Results in: issue title becomes 'My Title' instead of: My Title
   
   // WORKAROUND: Use child_process for precise string handling
   const { execSync } = await import('child_process');
   const command = `gh issue create --title "${title}"`;
   execSync(command, { encoding: 'utf8' });
   ```

2. **Defensive coding practices**
   ```javascript
   // DON'T: Direct interpolation of user content
   await $`echo "${userContent}" > file.txt`;
   
   // DO: Use fs operations for complex content
   await fs.writeFile('file.txt', userContent);
   ```

3. **Error handling pattern**
   ```javascript
   try {
     const result = await $`command`;
   } catch (error) {
     // Use error.code, not error.exitCode
     if (error.code !== 0) {
       console.error('Command failed:', error.stderr?.toString());
     }
   }
   ```

4. **Runtime detection**
   ```javascript
   const runtime = process.versions.bun ? 'bun' : 'node';
   if (runtime === 'bun') {
     // Use fs operations or handle differently
   }
   ```

5. **Safe patterns for common tasks**
   - File operations: Use `fs` module
   - JSON handling: Write to temp file first
   - Complex strings: Use heredocs or base64 encoding
   - Path handling: Always quote paths with spaces

## Alternative Approaches

If command-stream issues become blockers, consider:

1. **execa** - More mature, better escaping, extensive documentation
2. **zx** by Google - Similar syntax, better error handling
3. **Node.js child_process** - Direct control, no abstraction layer
4. **Pure fs operations** - Avoid shell entirely for file operations

## Conclusion

While command-stream offers an elegant syntax for shell operations, it currently has significant UX issues that can lead to frustration and bugs. The library would benefit from:
- Better automatic escaping
- Standardized error handling
- Improved Bun compatibility
- Comprehensive documentation

Until these issues are addressed, developers should:
- Prefer fs operations over shell commands
- Always test with actual production data
- Have fallback strategies for shell operations
- Consider alternative libraries for critical applications