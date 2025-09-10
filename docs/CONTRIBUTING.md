# Contributing to Hive Mind

## Human-AI Collaboration Guidelines

This project leverages AI-driven development with human oversight. Follow these practices:

### Development Workflow

1. **Issue Creation** - Humans create issues with clear requirements
2. **AI Processing** - Hive Mind analyzes and proposes solutions  
3. **Human Review** - Code review and architectural decisions
4. **Iterative Refinement** - Collaborative improvement cycles

### Code Standards

- **TypeScript/JavaScript**: Strict typing required
- **File Size**: Maximum 1000 lines per file
- **Testing**: 100% test coverage for critical paths
- **Documentation**: Machine-readable, token-efficient

### AI Agent Configuration

```typescript
interface AgentConfig {
  model: 'sonnet' | 'haiku' | 'opus';
  priority: 'low' | 'medium' | 'high' | 'critical';
  specialization?: string[];
}

export const defaultConfig: AgentConfig = {
  model: 'sonnet',
  priority: 'medium',
  specialization: ['code-review', 'issue-solving']
};
```

### Quality Gates

Before merging, ensure:
- [ ] All tests pass
- [ ] File size limits enforced
- [ ] Type checking passes
- [ ] Human review completed
- [ ] AI consensus achieved (if multi-agent)

### Communication Protocols

#### Human → AI
```bash
# Clear, specific instructions
./solve.mjs https://github.com/owner/repo/issues/123 --requirements "Security focus, maintain backward compatibility"
```

#### AI → Human
```bash  
# Status reports with actionable items
echo "🤖 Analysis complete. Requires human decision on breaking changes."
```

## Testing AI Agents

```typescript
import { testAgent } from './tests/agent-testing.ts';

// Test agent behavior
await testAgent({
  scenario: 'complex-issue-solving',
  expectedOutcome: 'pull-request-created',
  timeout: 300000 // 5 minutes
});
```

## Code Review Process

1. **Automated Review** - AI agents perform initial analysis
2. **Cross-Agent Validation** - Multiple agents verify solutions
3. **Human Oversight** - Final architectural and security review
4. **Consensus Building** - Resolve conflicts through discussion

### Review Checklist

- [ ] Algorithm correctness verified
- [ ] Security vulnerabilities assessed  
- [ ] Performance implications considered
- [ ] Documentation completeness
- [ ] Integration test coverage