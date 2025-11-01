# Hive Mind - AI Agent Instructions

This file provides project-specific guidance for AI coding assistants working on the Hive Mind project.

## Project Overview

Hive Mind is a master orchestrator AI that controls a hive of AI agents. It automates GitHub issue resolution by managing multiple AI agents that can fork repositories, create branches, implement solutions, and submit pull requests. The system supports human-AI collaboration through GitHub comments and pull request reviews.

## Development Environment

### Prerequisites
- Node.js 18+ or Bun
- GitHub CLI (`gh`) authenticated
- Claude Code authentication configured
- Ubuntu 24.04 recommended for production use

### Installation
```bash
# Global installation
npm install -g @deep-assistant/hive-mind
# or
bun install -g @deep-assistant/hive-mind

# Development setup
git clone https://github.com/deep-assistant/hive-mind.git
cd hive-mind
npm install
```

### Running Tests
```bash
npm test
```

## Code Style Guidelines

### Language & Typing
- **JavaScript/TypeScript**: Use modern ES6+ JavaScript with JSDoc for type annotations
- **File Extension**: Use `.mjs` for ES modules
- **Type Safety**: Add JSDoc type comments for function parameters and return types

### File Organization
- **Maximum File Size**: 1000 lines per file (strictly enforced)
- **Module Structure**: One primary export per file, organized by functionality
- **Naming Convention**:
  - Files: `kebab-case.mjs` or `feature-name.lib.mjs` for libraries
  - Functions: `camelCase`
  - Constants: `UPPER_SNAKE_CASE`

### Code Standards
```javascript
// Good: Clear function with JSDoc
/**
 * Solves a GitHub issue by creating a PR
 * @param {string} issueUrl - GitHub issue URL
 * @param {object} options - Configuration options
 * @returns {Promise<string>} PR URL
 */
export async function solveIssue(issueUrl, options) {
  // Implementation
}
```

## Architecture

### Core Components
1. **solve.mjs** - Main issue solver (stable)
2. **hive.mjs** - Multi-agent orchestrator (stable)
3. **review.mjs** - Code review automation (alpha)
4. **telegram-bot.mjs** - Telegram interface (stable)

### Key Modules
- `src/solve.*.lib.mjs` - Solve functionality libraries
- `src/hive.*.lib.mjs` - Hive orchestration libraries
- `src/config.lib.mjs` - Configuration management
- `src/github.lib.mjs` - GitHub API interactions

## Testing Instructions

### Test Script Organization
- **experiments/** - Debug and investigation scripts for active issues
- **examples/** - Working examples demonstrating features
- **tests/** - Formal test suites

### Creating Test Scripts
```bash
# Experiment scripts for debugging
node experiments/test-feature.mjs

# Example scripts for documentation
node examples/demo-feature.mjs
```

### Testing Checklist
- [ ] All existing tests pass
- [ ] New features have test coverage
- [ ] Edge cases are handled
- [ ] Error messages are clear and actionable

## Security Considerations

### Token Safety
- **Never commit tokens** - Check `.gitignore` includes `.env`
- **Avoid logging sensitive data** - Sanitize URLs and tokens in logs
- **Use environment variables** - For all credentials and API keys

### Code Safety
- **Command injection** - Always sanitize user input before shell execution
- **Path traversal** - Validate and normalize file paths
- **Privilege escalation** - Run with minimal necessary permissions

## Pull Request Guidelines

### Before Submitting
1. **Local CI checks**: Run linting and tests
   ```bash
   npm run lint  # If available
   npm test      # If available
   ```

2. **Commit messages**: Follow conventional commits
   ```
   feat: Add feature description
   fix: Fix bug description
   chore: Maintenance task description
   docs: Documentation update
   ```

3. **PR Description**: Include:
   - 🎯 Summary of changes
   - 📋 Issue reference (Fixes #123)
   - 🧪 Testing performed
   - 📝 Implementation details

### Code Review Process
1. AI agents perform initial analysis
2. Automated tests run via GitHub Actions
3. Human review for architectural decisions
4. Iterative refinement based on feedback

## Common Tasks

### Adding New Command Option
1. Update argument parser in relevant `.mjs` file
2. Add option to help text
3. Update README.md with new option
4. Add validation for option values
5. Create test case demonstrating usage

### Adding New GitHub API Integration
1. Check existing `src/github.lib.mjs` patterns
2. Use `gh` CLI when possible (already authenticated)
3. Add error handling for rate limits
4. Log API calls in verbose mode

### Debugging Issues
1. Enable verbose logging: `--verbose` flag
2. Check log files in specified `--log-dir`
3. Use experiment scripts in `experiments/` folder
4. Add temporary debug logging, keep it in code but disable by default

## Dependencies

### Core Dependencies
- `zx` - Shell scripting
- `yargs` - CLI argument parsing
- `octokit` - GitHub API client
- `node-telegram-bot-api` - Telegram bot

### Update Strategy
- Review dependency updates carefully
- Test thoroughly before updating major versions
- Document breaking changes

## Documentation

### README.md vs AGENTS.md
- **README.md**: User-facing documentation for humans
- **AGENTS.md**: Technical instructions for AI agents
- Keep both updated but avoid duplication

### Code Comments
- Focus on **why**, not **what**
- Explain non-obvious decisions
- Document workarounds with issue references

## Known Issues

### Space Leakage
- System may accumulate temporary directories
- Use `--auto-cleanup` flag when appropriate
- Monitor disk space with `--min-disk-space`

### Token Limits
- Claude sessions have token limits
- Use `--resume` to continue sessions
- Check logs for resume commands

## Best Practices

1. **Atomic Commits**: Each commit should be a logical, working unit
2. **Error Messages**: Provide clear, actionable error messages with troubleshooting steps
3. **Logging**: Use aligned formatting for consistency (see `formatAligned`)
4. **Branch Protection**: Only work on feature branches, never push directly to main
5. **Git History**: Preserve commit history, use revert instead of force push

## Human-AI Collaboration

### Feedback Channels
- GitHub issue comments - Request clarification or additional requirements
- Pull request comments - Respond to review feedback
- Pull request reviews - Address requested changes

### When to Ask for Help
- Unclear requirements or conflicting information
- Architectural decisions beyond scope
- Security-sensitive changes
- Breaking changes to public API

## Workflow

1. **Issue Analysis**: Read issue description and all comments thoroughly
2. **Research**: Check related PRs and existing implementations
3. **Planning**: Create clear implementation plan
4. **Implementation**: Write code following style guidelines
5. **Testing**: Test locally with experiment scripts
6. **Commit**: Create atomic commits with clear messages
7. **Push**: Push to feature branch
8. **PR**: Create or update pull request with detailed description
9. **Review**: Respond to feedback and iterate

## Additional Resources

- [Contributing Guidelines](./docs/CONTRIBUTING.md)
- [Data Flow Documentation](./docs/flow.md)
- [Configuration Guide](./docs/CONFIG.md)
- [Docker Setup](./docs/DOCKER.md)
