/**
 * GraphQL API utilities for GitHub issue fetching
 * This module provides functions to fetch issues using GitHub's GraphQL API
 */

/**
 * Try to fetch issues using GraphQL API (repos + issues in one query)
 * This is more efficient but has limitations (100 issues per repo max)
 * @param {string} owner - Organization or user name
 * @param {string} scope - 'organization' or 'user'
 * @param {Function} log - Logging function
 * @param {Function} cleanErrorMessage - Error message cleaner
 * @param {number} repoLimit - Maximum number of repos to fetch per query (default 100)
 * @returns {Promise<{success: boolean, issues: Array, repoCount: number}>}
 */
export async function tryFetchIssuesWithGraphQL(owner, scope, log, cleanErrorMessage, repoLimit = 100) {
  const { execSync } = await import('child_process');

  try {
    await log('   🧪 Attempting GraphQL approach (repos + issues in one query)...', { verbose: true });

    const isOrg = scope === 'organization';

    // Build GraphQL query to fetch repos with their open issues
    const graphqlQuery = isOrg ? `
      query($owner: String!, $repoLimit: Int!) {
        organization(login: $owner) {
          repositories(first: $repoLimit, orderBy: {field: UPDATED_AT, direction: DESC}) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              name
              owner {
                login
              }
              issues(states: OPEN, first: 100) {
                totalCount
                nodes {
                  number
                  title
                  url
                  createdAt
                }
              }
            }
          }
        }
      }
    ` : `
      query($owner: String!, $repoLimit: Int!) {
        user(login: $owner) {
          repositories(first: $repoLimit, orderBy: {field: UPDATED_AT, direction: DESC}) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              name
              owner {
                login
              }
              issues(states: OPEN, first: 100) {
                totalCount
                nodes {
                  number
                  title
                  url
                  createdAt
                }
              }
            }
          }
        }
      }
    `;

    // Execute GraphQL query
    // Escape single quotes in the query for shell execution
    const escapedQuery = graphqlQuery.replace(/'/g, '\'\\\'\'');
    const graphqlCmd = `gh api graphql -f query='${escapedQuery}' -f owner='${owner}' -F repoLimit=${repoLimit}`;

    await log(`   🔎 Executing GraphQL query for ${owner}...`, { verbose: true });

    // Add delay for rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));

    const result = execSync(graphqlCmd, { encoding: 'utf8' });
    const data = JSON.parse(result);
    const repos = isOrg ? data.data.organization.repositories : data.data.user.repositories;

    const totalRepos = repos.totalCount;
    const hasMoreRepos = repos.pageInfo.hasNextPage;

    // Extract all issues from all repos
    const allIssues = [];
    for (const repo of repos.nodes) {
      for (const issue of repo.issues.nodes) {
        allIssues.push({
          ...issue,
          repository: {
            name: repo.name,
            owner: repo.owner
          }
        });
      }
    }

    await log(`   ✅ GraphQL query successful: ${repos.nodes.length} repos, ${allIssues.length} issues`, { verbose: true });

    // Check if we might be missing data
    if (hasMoreRepos) {
      await log(`   ⚠️  GraphQL limitation: There are ${totalRepos} total repos, but only fetched ${repos.nodes.length}`, { verbose: true });
      await log('   💡 Falling back to comprehensive gh api --paginate approach...', { verbose: true });
      return { success: false, issues: [], repoCount: totalRepos };
    }

    // Check if any repo has 100+ issues (GraphQL limit per repo)
    let hasLimitedIssues = false;
    for (const repo of repos.nodes) {
      if (repo.issues.totalCount > 100) {
        await log(`   ⚠️  GraphQL limitation: ${repo.owner.login}/${repo.name} has ${repo.issues.totalCount} issues, but only fetched 100`, { verbose: true });
        hasLimitedIssues = true;
      }
    }

    if (hasLimitedIssues) {
      await log('   💡 Falling back to comprehensive gh api --paginate approach...', { verbose: true });
      return { success: false, issues: [], repoCount: totalRepos };
    }

    return { success: true, issues: allIssues, repoCount: repos.nodes.length };

  } catch (error) {
    await log(`   ❌ GraphQL approach failed: ${cleanErrorMessage(error)}`, { verbose: true });
    await log('   💡 Falling back to gh api --paginate approach...', { verbose: true });
    return { success: false, issues: [], repoCount: 0 };
  }
}
