#!/usr/bin/env node

/**
 * gh-pr-download - Download GitHub pull request with all comments and embedded images
 *
 * This tool downloads a GitHub pull request along with all its comments, reviews,
 * and embedded images, saving everything in a format that can be easily read by
 * Claude Code CLI without running into image processing errors.
 *
 * Usage:
 *   gh-pr-download <pr-url> [options]
 *   gh-pr-download https://github.com/owner/repo/pull/123
 *   gh-pr-download 123 --owner owner --repo repo
 *
 * Options:
 *   --owner, -o          Repository owner
 *   --repo, -r           Repository name
 *   --output, -out       Output directory (default: current directory)
 *   --download-images    Download embedded images (default: true)
 *   --include-reviews    Include PR reviews (default: true)
 *   --format             Output format: markdown, json (default: markdown)
 *   --verbose, -v        Enable verbose logging
 *   --help, -h           Show help
 */

import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Parse PR URL to extract owner, repo, and PR number
 */
function parsePrUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) {
    throw new Error(`Invalid PR URL: ${url}`);
  }
  return {
    owner: match[1],
    repo: match[2],
    prNumber: match[3]
  };
}

/**
 * Fetch PR data using gh CLI
 */
async function fetchPrData(owner, repo, prNumber, includeReviews, verbose) {
  if (verbose) {
    console.log(`Fetching PR #${prNumber} from ${owner}/${repo}...`);
  }

  try {
    // Fetch PR details
    const prJson = execSync(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const pr = JSON.parse(prJson);

    // Fetch comments
    const commentsJson = execSync(
      `gh api repos/${owner}/${repo}/issues/${prNumber}/comments`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const comments = JSON.parse(commentsJson);

    // Fetch reviews if requested
    let reviews = [];
    if (includeReviews) {
      try {
        const reviewsJson = execSync(
          `gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
          { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
        );
        reviews = JSON.parse(reviewsJson);
      } catch (error) {
        if (verbose) {
          console.warn(`Warning: Could not fetch reviews: ${error.message}`);
        }
      }
    }

    // Fetch review comments
    let reviewComments = [];
    try {
      const reviewCommentsJson = execSync(
        `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );
      reviewComments = JSON.parse(reviewCommentsJson);
    } catch (error) {
      if (verbose) {
        console.warn(`Warning: Could not fetch review comments: ${error.message}`);
      }
    }

    return { pr, comments, reviews, reviewComments };
  } catch (error) {
    throw new Error(`Failed to fetch PR data: ${error.message}`);
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
async function generateMarkdown(pr, comments, reviews, reviewComments, imageMap, verbose) {
  const lines = [];

  // PR header
  lines.push(`# ${pr.title}`);
  lines.push('');
  lines.push(`**Pull Request #${pr.number}** opened by @${pr.user.login} on ${new Date(pr.created_at).toLocaleString()}`);
  lines.push('');
  lines.push(`**URL:** ${pr.html_url}`);
  lines.push('');
  lines.push(`**State:** ${pr.state}${pr.merged ? ' (merged)' : pr.draft ? ' (draft)' : ''}`);
  lines.push(`**Base:** ${pr.base.ref} ← **Head:** ${pr.head.ref}`);

  if (pr.labels && pr.labels.length > 0) {
    lines.push('');
    lines.push(`**Labels:** ${pr.labels.map(l => l.name).join(', ')}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // PR description
  lines.push('## Pull Request Description');
  lines.push('');
  const prBody = replaceImageUrls(pr.body || '_No description provided_', imageMap);
  lines.push(prBody);
  lines.push('');

  // Reviews
  if (reviews.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## Reviews (${reviews.length})`);
    lines.push('');

    for (const review of reviews) {
      lines.push(`### Review by @${review.user.login}`);
      lines.push(`*Submitted on ${new Date(review.submitted_at).toLocaleString()}*`);
      lines.push('');
      lines.push(`**State:** ${review.state}`);
      lines.push('');
      if (review.body) {
        const reviewBody = replaceImageUrls(review.body, imageMap);
        lines.push(reviewBody);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }
  }

  // Review comments (inline comments)
  if (reviewComments.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## Review Comments (${reviewComments.length})`);
    lines.push('');

    for (const comment of reviewComments) {
      lines.push(`### Comment by @${comment.user.login}`);
      lines.push(`*Posted on ${new Date(comment.created_at).toLocaleString()}*`);
      if (comment.path) {
        lines.push(`*File: \`${comment.path}\`*`);
      }
      lines.push('');
      const commentBody = replaceImageUrls(comment.body || '_No content_', imageMap);
      lines.push(commentBody);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

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
      'include-reviews': { type: 'boolean', default: true },
      format: { type: 'string', default: 'markdown' },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    },
    allowPositionals: true
  });

  // Show help
  if (values.help) {
    console.log(`
gh-pr-download - Download GitHub pull request with all comments and embedded images

Usage:
  gh-pr-download <pr-url> [options]
  gh-pr-download https://github.com/owner/repo/pull/123
  gh-pr-download 123 --owner owner --repo repo

Options:
  --owner, -o          Repository owner
  --repo, -r           Repository name
  --output             Output directory (default: current directory)
  --download-images    Download embedded images (default: true)
  --include-reviews    Include PR reviews (default: true)
  --format             Output format: markdown, json (default: markdown)
  --verbose, -v        Enable verbose logging
  --help, -h           Show help
`);
    process.exit(0);
  }

  // Get PR URL or number
  if (positionals.length === 0) {
    console.error('Error: PR URL or number is required');
    process.exit(1);
  }

  let owner, repo, prNumber;

  const input = positionals[0];
  if (input.includes('github.com')) {
    // Parse URL
    ({ owner, repo, prNumber } = parsePrUrl(input));
  } else {
    // Use PR number with --owner and --repo
    prNumber = input;
    owner = values.owner;
    repo = values.repo;

    if (!owner || !repo) {
      console.error('Error: --owner and --repo are required when using PR number');
      process.exit(1);
    }
  }

  console.log(`📥 Downloading PR #${prNumber} from ${owner}/${repo}...`);

  // Fetch PR data
  const { pr, comments, reviews, reviewComments } = await fetchPrData(
    owner,
    repo,
    prNumber,
    values['include-reviews'],
    values.verbose
  );

  console.log(`✅ Fetched PR with ${comments.length} comment(s), ${reviews.length} review(s), and ${reviewComments.length} review comment(s)`);

  // Extract all image URLs
  const allText = [
    pr.body,
    ...comments.map(c => c.body),
    ...reviews.map(r => r.body),
    ...reviewComments.map(c => c.body)
  ].join('\n');
  const imageUrls = extractImageUrls(allText);

  if (values.verbose && imageUrls.length > 0) {
    console.log(`Found ${imageUrls.length} image(s) in PR and comments`);
  }

  // Download images if enabled
  const imageMap = {};
  if (values['download-images'] && imageUrls.length > 0) {
    console.log(`📦 Downloading ${imageUrls.length} image(s)...`);

    const imagesDir = join(values.output, `pr-${prNumber}-images`);
    await mkdir(imagesDir, { recursive: true });

    for (let i = 0; i < imageUrls.length; i++) {
      const { url } = imageUrls[i];
      const ext = url.split('.').pop().split('?')[0] || 'png';
      const filename = `image-${i + 1}.${ext}`;
      const outputPath = join(imagesDir, filename);

      const success = await downloadImage(url, outputPath, values.verbose);
      if (success) {
        // Store relative path for markdown
        imageMap[url] = join(`pr-${prNumber}-images`, filename);
      }
    }

    console.log(`✅ Downloaded ${Object.keys(imageMap).length}/${imageUrls.length} image(s)`);
  }

  // Generate output
  const outputFile = join(values.output, `pr-${prNumber}.md`);

  // Ensure output directory exists
  await mkdir(values.output, { recursive: true });

  if (values.format === 'markdown') {
    const markdown = await generateMarkdown(pr, comments, reviews, reviewComments, imageMap, values.verbose);
    await writeFile(outputFile, markdown, 'utf-8');
    console.log(`✅ Saved to ${outputFile}`);
  } else if (values.format === 'json') {
    const jsonOutput = {
      pr,
      comments,
      reviews,
      reviewComments,
      imageMap
    };
    await writeFile(outputFile.replace('.md', '.json'), JSON.stringify(jsonOutput, null, 2), 'utf-8');
    console.log(`✅ Saved to ${outputFile.replace('.md', '.json')}`);
  }

  console.log('');
  console.log('🎉 Done!');
  console.log(`   PR: ${pr.html_url}`);
  console.log(`   Output: ${outputFile}`);
  if (Object.keys(imageMap).length > 0) {
    console.log(`   Images: ${join(values.output, `pr-${prNumber}-images`)}`);
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
