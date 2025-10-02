/**
 * Claude prompts module
 * Handles building prompts for Claude commands with i18n support
 */

import { getTranslations } from './i18n.lib.mjs';

/**
 * Build the user prompt for Claude
 * @param {Object} params - Parameters for building the user prompt
 * @returns {string} The formatted user prompt
 */
export const buildUserPrompt = (params) => {
  const {
    issueUrl,
    issueNumber,
    prNumber,
    prUrl,
    branchName,
    tempDir,
    isContinueMode,
    mergeStateStatus,
    forkedRepo,
    feedbackLines,
    owner,
    repo,
    argv
  } = params;

  const lang = argv?.language || 'en';
  const t = getTranslations(lang);
  const promptLines = [];

  // Issue or PR reference
  if (isContinueMode) {
    promptLines.push(`${t.userPrompt.issueToSolve}: ${issueNumber ? `https://github.com/${owner}/${repo}/issues/${issueNumber}` : t.userPrompt.issueLinkedToPR(prNumber)}`);
  } else {
    promptLines.push(`${t.userPrompt.issueToSolve}: ${issueUrl}`);
  }

  // Basic info
  promptLines.push(`${t.userPrompt.preparedBranch}: ${branchName}`);
  promptLines.push(`${t.userPrompt.preparedWorkingDir}: ${tempDir}`);

  // PR info if available
  if (prUrl) {
    promptLines.push(`${t.userPrompt.preparedPR}: ${prUrl}`);
  }

  // Fork info if applicable
  if (argv && argv.fork && forkedRepo) {
    promptLines.push(`${t.userPrompt.forkedRepository}: ${forkedRepo}`);
    promptLines.push(`${t.userPrompt.originalRepository}: ${owner}/${repo}`);

    // Check for GitHub Actions on fork and add link if workflows exist
    if (branchName && params.forkActionsUrl) {
      promptLines.push(`${t.userPrompt.githubActionsOnFork}: ${params.forkActionsUrl}`);
    }
  }

  // Add blank line
  promptLines.push('');

  // Add feedback info if in continue mode and there are feedback items
  if (isContinueMode && feedbackLines && feedbackLines.length > 0) {
    // Add each feedback line directly
    feedbackLines.forEach(line => promptLines.push(line));
    promptLines.push('');
  }

  // Add thinking instruction based on --think level
  if (argv && argv.think) {
    const thinkMessages = {
      low: t.userPrompt.think,
      medium: t.userPrompt.thinkHard,
      high: t.userPrompt.thinkHarder,
      max: t.userPrompt.ultrathink
    };
    promptLines.push(thinkMessages[argv.think]);
  }

  // Final instruction
  promptLines.push(isContinueMode ? t.userPrompt.continue : t.userPrompt.proceed);

  // Build the final prompt
  return promptLines.join('\n');
};

/**
 * Build the system prompt for Claude - simplified to avoid shell escaping issues
 * @param {Object} params - Parameters for building the prompt
 * @returns {string} The formatted system prompt
 */
export const buildSystemPrompt = (params) => {
  const { owner, repo, issueNumber, prNumber, branchName, argv } = params;
  const lang = argv?.language || 'en';
  const t = getTranslations(lang);
  const sp = t.systemPrompt;

  // Build thinking instruction based on --think level
  let thinkLine = '';
  if (argv && argv.think) {
    const thinkMessages = {
      low: sp.thinkLow,
      medium: sp.thinkMedium,
      high: sp.thinkHigh,
      max: sp.thinkMax
    };
    thinkLine = `\n${thinkMessages[argv.think]}\n`;
  }

  // Use backticks for jq commands to avoid quote escaping issues
  return `${sp.youAre}${thinkLine}

${sp.generalGuidelines}
   - ${sp.executeCommandsSaveLogs}
   - ${sp.runCommandsNoTimeout}
   - ${sp.runSudoBackground}
   - ${sp.ciFailingDownloadLogs}
   - ${sp.largeFileReadChunks}
   - ${sp.complexProblemTracing}
   - ${sp.createDebugScripts}
   - ${sp.testAssumptions}
   - ${sp.experimentsRealWorld}
   - ${sp.hardDivideConquer}

${sp.initialResearch}
   - ${sp.readIssueDetails}
   - ${sp.screenshotsImages}
   - ${sp.needIssueDetails(owner, repo, issueNumber)}
   - ${sp.needRelatedCode(owner)}
   - ${sp.needRepoContext}
   - ${sp.studyRelatedWork}
   - ${sp.issueNotDefined}
   - ${sp.gistsAuthentication}
   - ${sp.fixingBugRootCause}
   - ${sp.bugTracingLogs}
   - ${sp.latestCommentsPR}
   - ${sp.latestCommentsIssue}

${sp.solutionDevelopment}
   - ${sp.issueSolvable}
   - ${sp.testStartSmall}
   - ${sp.testUnitTests}
   - ${sp.testIntegrations}
   - ${sp.testSolutionDraft}
   - ${sp.issueUnclear}
   - ${sp.problemsNeedHelp}
   - ${sp.needHumanHelp(prNumber)}

${sp.preparingPullRequest}
   - ${sp.finalizePR}
   - ${sp.followContributing}
   - ${sp.commitClearMessage}
   - ${sp.examplesStyle(owner, repo)}
   - ${sp.openPRDescribe}
   - ${sp.packageVersion}
   - ${sp.updateExistingPR(prNumber)}
   - ${sp.finishImplementation(prNumber)}

${sp.workflowAndCollaboration}
   - ${sp.checkBranch}
   - ${sp.pushToBranch(branchName)}
   - ${sp.createPR(branchName, prNumber)}
   - ${sp.usePullRequests}
   - ${sp.preserveHistory}
   - ${sp.forwardMoving}
   - ${sp.faceConflict}
   - ${sp.respectBranch(branchName)}
   - ${sp.mentionResult}
   - ${sp.prAlreadyExists(prNumber)}

${sp.selfReview}
   - ${sp.checkSolution}
   - ${sp.compareStyle}
   - ${sp.finalizeConfirm}`;
};

// Export all functions as default object too
export default {
  buildUserPrompt,
  buildSystemPrompt
};
