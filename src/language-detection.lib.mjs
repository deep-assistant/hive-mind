/**
 * Language detection integration module
 * Handles fetching issue data and detecting language
 */

import { detectLanguageFromIssue } from './i18n.lib.mjs';
import { ghIssueView } from './github.lib.mjs';
import { log } from './lib.mjs';

/**
 * Determine the language to use for prompts based on CLI options and issue content
 *
 * @param {Object} params - Parameters
 * @param {Object} params.argv - Command line arguments
 * @param {string} params.owner - Repository owner
 * @param {string} params.repo - Repository name
 * @param {number} params.issueNumber - Issue number
 * @returns {Promise<string>} - Language code ('ru' or 'en')
 */
export const determineLanguage = async ({ argv, owner, repo, issueNumber }) => {
  // If force-language is specified, use it
  if (argv.forceLanguage) {
    await log(`🌐 Language forced to: ${argv.forceLanguage}`, { verbose: true });
    return argv.forceLanguage;
  }

  // If automatic language detection is disabled, default to English
  if (argv.automaticLanguageDetection === false) {
    await log('🌐 Automatic language detection disabled, using English', { verbose: true });
    return 'en';
  }

  // Fetch issue data to detect language
  try {
    await log('🌐 Detecting language from issue content...', { verbose: true });

    const issueResult = await ghIssueView({
      issueNumber,
      owner,
      repo,
      jsonFields: 'number,title,body'
    });

    if (issueResult.code === 0 && issueResult.data) {
      const { title, body } = issueResult.data;
      const detectedLanguage = detectLanguageFromIssue(title, body);

      await log(`🌐 Detected language: ${detectedLanguage}`, { verbose: true });

      return detectedLanguage;
    } else {
      await log('⚠️  Could not fetch issue data for language detection, defaulting to English', { verbose: true });
      return 'en';
    }
  } catch (error) {
    await log(`⚠️  Error detecting language: ${error.message}, defaulting to English`, { verbose: true });
    return 'en';
  }
};

export default {
  determineLanguage
};
