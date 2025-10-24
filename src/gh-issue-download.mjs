#!/usr/bin/env node

/**
 * gh-issue-download - Download GitHub issue with all comments and embedded images
 *
 * This tool downloads a GitHub issue along with all its comments and embedded images,
 * saving everything in a format that can be easily read by Claude Code CLI without
 * running into image processing errors.
 *
 * Usage:
 *   gh-issue-download <issue-url> [options]
 *   gh-issue-download https://github.com/owner/repo/issues/123
 *   gh-issue-download 123 --owner owner --repo repo
 *
 * Options:
 *   --owner, -o          Repository owner
 *   --repo, -r           Repository name
 *   --output, -out       Output directory (default: current directory)
 *   --download-images    Download embedded images (default: true)
 *   --format             Output format: markdown, json (default: markdown)
 *   --verbose, -v        Enable verbose logging
 *   --help, -h           Show help
 */

import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Parse issue URL to extract owner, repo, and issue number
 */
function parseIssueUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!match) {
    throw new Error(`Invalid issue URL: ${url}`);
  }
  return {
    owner: match[1],
    repo: match[2],
    issueNumber: match[3]
  };
}

/**
 * Fetch issue data using gh CLI
 */
async function fetchIssueData(owner, repo, issueNumber, verbose) {
  if (verbose) {
    console.log(`Fetching issue #${issueNumber} from ${owner}/${repo}...`);
  }

  try {
    const issueJson = execSync(
      `gh api repos/${owner}/${repo}/issues/${issueNumber}`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const issue = JSON.parse(issueJson);

    const commentsJson = execSync(
      `gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const comments = JSON.parse(commentsJson);

    return { issue, comments };
  } catch (error) {
    throw new Error(`Failed to fetch issue data: ${error.message}`);
  }
}

/**
 * Extract image URLs from markdown text
 */
function extractImageUrls(text) {
  if (!text) return [];

  const imageUrls = [];

  // Match markdown image syntax: ![alt](url)
  const markdownImages = text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g);
  for (const match of markdownImages) {
    imageUrls.push({ url: match[2], alt: match[1] });
  }

  // Match HTML img tags: <img src="url" />
  const htmlImages = text.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/g);
  for (const match of htmlImages) {
    imageUrls.push({ url: match[1], alt: '' });
  }

  return imageUrls;
}

/**
 * Download image using curl
 */
async function downloadImage(url, outputPath, verbose) {
  if (verbose) {
    console.log(`  Downloading image: ${url}`);
  }

  try {
    // Create directory if it doesn't exist
    await mkdir(dirname(outputPath), { recursive: true });

    // Download using curl
    execSync(`curl -L -o "${outputPath}" "${url}"`, {
      encoding: 'utf-8',
      stdio: verbose ? 'inherit' : 'pipe'
    });

    return true;
  } catch (error) {
    console.error(`  ⚠️  Failed to download image ${url}: ${error.message}`);
    return false;
  }
}

/**
 * Replace image URLs in markdown with local paths
 */
function replaceImageUrls(text, imageMap) {
  let result = text;

  for (const [originalUrl, localPath] of Object.entries(imageMap)) {
    // Replace markdown images
    result = result.replace(
      new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegex(originalUrl)}\\)`, 'g'),
      `![$1](${localPath})`
    );

    // Replace HTML img tags
    result = result.replace(
      new RegExp(`<img([^>]+)src=["']${escapeRegex(originalUrl)}["']([^>]*)>`, 'g'),
      `<img$1src="${localPath}"$2>`
    );
  }

  return result;
}

/**
 * Escape special regex characters
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate markdown output
 */
async function generateMarkdown(issue, comments, imageMap, verbose) {
  const lines = [];

  // Issue header
  lines.push(`# ${issue.title}`);
  lines.push('');
  lines.push(`**Issue #${issue.number}** opened by @${issue.user.login} on ${new Date(issue.created_at).toLocaleString()}`);
  lines.push('');
  lines.push(`**URL:** ${issue.html_url}`);
  lines.push('');
  lines.push(`**State:** ${issue.state}`);

  if (issue.labels && issue.labels.length > 0) {
    lines.push('');
    lines.push(`**Labels:** ${issue.labels.map(l => l.name).join(', ')}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // Issue body
  lines.push('## Issue Description');
  lines.push('');
  const issueBody = replaceImageUrls(issue.body || '_No description provided_', imageMap);
  lines.push(issueBody);
  lines.push('');

  // Comments
  if (comments.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## Comments (${comments.length})`);
    lines.push('');

    for (const comment of comments) {
      lines.push(`### Comment by @${comment.user.login}`);
      lines.push(`*Posted on ${new Date(comment.created_at).toLocaleString()}*`);
      lines.push('');
      const commentBody = replaceImageUrls(comment.body || '_No content_', imageMap);
      lines.push(commentBody);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Main function
 */
async function main() {
  // Parse command line arguments
  const { values, positionals } = parseArgs({
    options: {
      owner: { type: 'string', short: 'o' },
      repo: { type: 'string', short: 'r' },
      output: { type: 'string', default: '.' },
      'download-images': { type: 'boolean', default: true },
      format: { type: 'string', default: 'markdown' },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    },
    allowPositionals: true
  });

  // Show help
  if (values.help) {
    console.log(`
gh-issue-download - Download GitHub issue with all comments and embedded images

Usage:
  gh-issue-download <issue-url> [options]
  gh-issue-download https://github.com/owner/repo/issues/123
  gh-issue-download 123 --owner owner --repo repo

Options:
  --owner, -o          Repository owner
  --repo, -r           Repository name
  --output             Output directory (default: current directory)
  --download-images    Download embedded images (default: true)
  --format             Output format: markdown, json (default: markdown)
  --verbose, -v        Enable verbose logging
  --help, -h           Show help
`);
    process.exit(0);
  }

  // Get issue URL or number
  if (positionals.length === 0) {
    console.error('Error: Issue URL or number is required');
    process.exit(1);
  }

  let owner, repo, issueNumber;

  const input = positionals[0];
  if (input.includes('github.com')) {
    // Parse URL
    ({ owner, repo, issueNumber } = parseIssueUrl(input));
  } else {
    // Use issue number with --owner and --repo
    issueNumber = input;
    owner = values.owner;
    repo = values.repo;

    if (!owner || !repo) {
      console.error('Error: --owner and --repo are required when using issue number');
      process.exit(1);
    }
  }

  console.log(`📥 Downloading issue #${issueNumber} from ${owner}/${repo}...`);

  // Fetch issue data
  const { issue, comments } = await fetchIssueData(owner, repo, issueNumber, values.verbose);

  console.log(`✅ Fetched issue and ${comments.length} comment(s)`);

  // Extract all image URLs
  const allText = [issue.body, ...comments.map(c => c.body)].join('\n');
  const imageUrls = extractImageUrls(allText);

  if (values.verbose && imageUrls.length > 0) {
    console.log(`Found ${imageUrls.length} image(s) in issue and comments`);
  }

  // Download images if enabled
  const imageMap = {};
  if (values['download-images'] && imageUrls.length > 0) {
    console.log(`📦 Downloading ${imageUrls.length} image(s)...`);

    const imagesDir = join(values.output, `issue-${issueNumber}-images`);
    await mkdir(imagesDir, { recursive: true });

    for (let i = 0; i < imageUrls.length; i++) {
      const { url } = imageUrls[i];
      const ext = url.split('.').pop().split('?')[0] || 'png';
      const filename = `image-${i + 1}.${ext}`;
      const outputPath = join(imagesDir, filename);

      const success = await downloadImage(url, outputPath, values.verbose);
      if (success) {
        // Store relative path for markdown
        imageMap[url] = join(`issue-${issueNumber}-images`, filename);
      }
    }

    console.log(`✅ Downloaded ${Object.keys(imageMap).length}/${imageUrls.length} image(s)`);
  }

  // Generate output
  const outputFile = join(values.output, `issue-${issueNumber}.md`);

  // Ensure output directory exists
  await mkdir(values.output, { recursive: true });

  if (values.format === 'markdown') {
    const markdown = await generateMarkdown(issue, comments, imageMap, values.verbose);
    await writeFile(outputFile, markdown, 'utf-8');
    console.log(`✅ Saved to ${outputFile}`);
  } else if (values.format === 'json') {
    const jsonOutput = {
      issue,
      comments,
      imageMap
    };
    await writeFile(outputFile.replace('.md', '.json'), JSON.stringify(jsonOutput, null, 2), 'utf-8');
    console.log(`✅ Saved to ${outputFile.replace('.md', '.json')}`);
  }

  console.log('');
  console.log('🎉 Done!');
  console.log(`   Issue: ${issue.html_url}`);
  console.log(`   Output: ${outputFile}`);
  if (Object.keys(imageMap).length > 0) {
    console.log(`   Images: ${join(values.output, `issue-${issueNumber}-images`)}`);
  }
}

// Run main function
main().catch(error => {
  console.error(`❌ Error: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
