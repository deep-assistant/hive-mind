/**
 * Branch creation and checkout functionality for solve.mjs
 * Handles creating new branches or checking out existing PR branches
 */

export async function createOrCheckoutBranch({
  isContinueMode,
  prBranch,
  issueNumber,
  tempDir,
  defaultBranch,
  argv,
  log,
  formatAligned,
  $,
  crypto
}) {
  // Create a branch for the issue or checkout existing PR branch
  let branchName;
  let checkoutResult;

  if (isContinueMode && prBranch) {
    // Continue mode: checkout existing PR branch
    branchName = prBranch;
    const repository = await import('./solve.repository.lib.mjs');
    const { checkoutPrBranch } = repository;
    checkoutResult = await checkoutPrBranch(tempDir, branchName, null, null); // prForkRemote and prForkOwner not needed here
  } else {
    // Traditional mode: create new branch for issue
    const randomHex = crypto.randomBytes(4).toString('hex');
    branchName = `issue-${issueNumber}-${randomHex}`;
    await log(`\n${formatAligned('🌿', 'Creating branch:', `${branchName} from ${defaultBranch}`)}`);

    // IMPORTANT: Don't use 2>&1 here as it can interfere with exit codes
    // Git checkout -b outputs to stderr but that's normal
    checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName}`;
  }

  if (checkoutResult.code !== 0) {
    const errorOutput = (checkoutResult.stderr || checkoutResult.stdout || 'Unknown error').toString().trim();
    await log('');

    if (isContinueMode) {
      const branchErrors = await import('./solve.branch-errors.lib.mjs');
      const { handleBranchCheckoutError } = branchErrors;
      await handleBranchCheckoutError({
        branchName,
        prNumber: null, // Will be set later
        errorOutput,
        issueUrl: argv._[0],
        owner: null, // Will be set later
        repo: null,  // Will be set later
        tempDir,
        argv,
        formatAligned,
        log,
        $
      });
    } else {
      const branchErrors = await import('./solve.branch-errors.lib.mjs');
      const { handleBranchCreationError } = branchErrors;
      await handleBranchCreationError({
        branchName,
        errorOutput,
        tempDir,
        owner: null, // Will be set later
        repo: null,  // Will be set later
        formatAligned,
        log
      });
    }

    await log('');
    await log(`  📂 Working directory: ${tempDir}`);
    throw new Error('Branch operation failed');
  }

  // CRITICAL: Verify the branch was checked out and we switched to it
  await log(`${formatAligned('🔍', 'Verifying:', isContinueMode ? 'Branch checkout...' : 'Branch creation...')}`);
  const verifyResult = await $({ cwd: tempDir })`git branch --show-current`;

  if (verifyResult.code !== 0 || !verifyResult.stdout) {
    await log('');
    await log(`${formatAligned('❌', 'BRANCH VERIFICATION FAILED', '')}`, { level: 'error' });
    await log('');
    await log('  🔍 What happened:');
    await log(`     Unable to verify branch after ${isContinueMode ? 'checkout' : 'creation'} attempt.`);
    await log('');
    await log('  🔧 Debug commands to try:');
    await log(`     cd ${tempDir} && git branch -a`);
    await log(`     cd ${tempDir} && git status`);
    await log('');
    throw new Error('Branch verification failed');
  }

  const actualBranch = verifyResult.stdout.toString().trim();
  if (actualBranch !== branchName) {
    // Branch wasn't actually created/checked out or we didn't switch to it
    const branchErrors = await import('./solve.branch-errors.lib.mjs');
    const { handleBranchVerificationError } = branchErrors;
    await handleBranchVerificationError({
      isContinueMode,
      branchName,
      actualBranch,
      prNumber: null, // Will be set later
      owner: null, // Will be set later
      repo: null,  // Will be set later
      tempDir,
      formatAligned,
      log,
      $
    });
    throw new Error('Branch verification mismatch');
  }

  if (isContinueMode) {
    await log(`${formatAligned('✅', 'Branch checked out:', branchName)}`);
    await log(`${formatAligned('✅', 'Current branch:', actualBranch)}`);
    if (argv.verbose) {
      await log('   Branch operation: Checkout existing PR branch', { verbose: true });
      await log(`   Branch verification: ${actualBranch === branchName ? 'Matches expected' : 'MISMATCH!'}`, { verbose: true });
    }
  } else {
    await log(`${formatAligned('✅', 'Branch created:', branchName)}`);
    await log(`${formatAligned('✅', 'Current branch:', actualBranch)}`);
    if (argv.verbose) {
      await log('   Branch operation: Create new branch', { verbose: true });
      await log(`   Branch verification: ${actualBranch === branchName ? 'Matches expected' : 'MISMATCH!'}`, { verbose: true });
    }
  }

  return branchName;
}