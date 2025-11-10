# CC Switch Integration Guide

## Overview

[CC Switch](https://github.com/farion1231/cc-switch) is a cross-platform desktop application designed to simplify the management of multiple API provider configurations for Claude Code and Codex. This integration guide explains how to use CC Switch alongside Hive Mind for enhanced workflow management.

## What is CC Switch?

CC Switch is a desktop application that provides:

- **Provider Management**: Instantly switch between different API configurations without manually editing files
- **MCP Server Integration**: Centralized management of Model Context Protocol servers (stdio and HTTP protocols)
- **Performance Testing**: Built-in speed testing to measure API endpoint latency
- **Configuration Backup**: Automatic backup system maintaining up to 10 backup copies
- **Multi-Language Support**: Complete localization in Chinese and English
- **Cloud Sync Ready**: Custom configuration directories compatible with cloud storage services

## Why Use CC Switch with Hive Mind?

When running Hive Mind, you may need to:

- Switch between different Claude API providers for cost optimization
- Test different provider configurations for performance
- Manage multiple API keys and rate limits
- Quickly swap configurations across different environments

CC Switch makes these tasks simple with one-click provider switching and visual configuration management.

## Architecture

CC Switch uses a clean architectural separation:

- **Frontend**: React-based UI for intuitive configuration management
- **Backend**: Rust backend via Tauri for secure file operations
- **Configuration Storage**: Single source of truth at `~/.cc-switch/config.json`
- **Atomic Writes**: Prevents configuration corruption during updates

## Installation

### Prerequisites

- macOS, Windows, or Linux desktop environment
- Claude Code CLI installed (required for Hive Mind)
- Active Claude API key or multiple provider API keys

### Installation Steps

1. **Download CC Switch**
   - Visit the [CC Switch releases page](https://github.com/farion1231/cc-switch/releases)
   - Download the appropriate installer for your platform:
     - macOS: `.dmg` file
     - Windows: `.exe` installer
     - Linux: `.AppImage` or `.deb` package

2. **Install the Application**
   - Run the downloaded installer
   - Follow platform-specific installation instructions

3. **Launch CC Switch**
   - Open the CC Switch application from your applications folder or start menu

## Configuration

### Setting Up Providers

1. **Launch CC Switch**
   - Open the CC Switch desktop application

2. **Add Provider Configuration**
   - Click "Add Provider" or the "+" button
   - Enter provider details:
     - **Name**: Descriptive name (e.g., "Claude Official", "Azure Claude")
     - **API Endpoint**: Provider API URL
     - **API Key**: Your authentication key
     - **Model Settings**: Default model preferences

3. **Configure MCP Servers**
   - Navigate to the MCP section
   - Add your Model Context Protocol servers:
     - **Name**: Server identifier
     - **Protocol**: Choose stdio or HTTP
     - **Command/URL**: Server start command or HTTP endpoint
     - **Arguments**: Additional configuration parameters

4. **Test Configuration**
   - Use the built-in speed test feature
   - Verify API connectivity
   - Check latency metrics

### Integration with Hive Mind

CC Switch manages Claude Code configurations that Hive Mind uses automatically. When you switch providers in CC Switch, Hive Mind will use the active configuration on its next run.

#### Workflow Example

```bash
# 1. Use CC Switch GUI to activate "Claude Official" provider
# 2. Run Hive Mind with default configuration
hive https://github.com/owner/repo --all-issues --concurrency 2

# 3. Switch to "Azure Claude" provider in CC Switch GUI for different rate limits
# 4. Run Hive Mind again - it will use the new provider
hive https://github.com/microsoft/repo --all-issues --max-issues 5
```

### Backup and Restore

CC Switch automatically maintains configuration backups:

1. **Automatic Backups**
   - Up to 10 backup copies maintained automatically
   - Backups created before configuration changes

2. **Manual Backup**
   - Use "Export Configuration" in CC Switch
   - Save configuration file to secure location

3. **Restore Configuration**
   - Use "Import Configuration" in CC Switch
   - Select previously exported configuration file

### Cloud Synchronization

To sync configurations across multiple machines:

1. **Configure Custom Directory**
   - In CC Switch settings, set custom configuration directory
   - Point to a cloud-synced folder (Dropbox, OneDrive, etc.)
   - Example: `~/Dropbox/cc-switch-config`

2. **Install CC Switch on Other Machines**
   - Point each installation to the same cloud-synced directory
   - Configurations will sync automatically via your cloud provider

## Usage Patterns

### Pattern 1: Multi-Provider Development

When working with multiple API providers:

```bash
# Morning: Use Provider A (higher rate limits)
# - Switch to Provider A in CC Switch
hive https://github.com/org/repo --all-issues --concurrency 4

# Afternoon: Provider A rate limited, switch to Provider B
# - Switch to Provider B in CC Switch
hive https://github.com/org/repo --all-issues --concurrency 2 --auto-continue
```

### Pattern 2: Cost Optimization

Switch between providers based on pricing:

```bash
# For simple issues: Use cheaper provider
# - Activate "Budget Provider" in CC Switch
solve https://github.com/owner/repo/issues/123 --model sonnet

# For complex issues: Use premium provider
# - Activate "Premium Provider" in CC Switch
solve https://github.com/owner/repo/issues/456 --model opus
```

### Pattern 3: Geographic Optimization

Switch providers based on geographic location for latency optimization:

```bash
# Use CC Switch speed test feature to measure latency
# Switch to provider with lowest latency
# Run Hive Mind workloads
```

### Pattern 4: Development vs Production

Separate configurations for different environments:

```bash
# Development: Use test provider with logging
# - Activate "Dev Provider" in CC Switch
solve https://github.com/owner/test-repo/issues/1 --verbose

# Production: Use production provider
# - Activate "Prod Provider" in CC Switch
hive https://github.com/owner/prod-repo --monitor-tag "bug"
```

## Performance Testing

CC Switch includes built-in performance testing:

1. **Speed Test Feature**
   - Test API endpoint latency
   - Compare multiple providers
   - Identify optimal provider for your location

2. **Metrics Tracked**
   - Response time
   - Connection latency
   - API availability

3. **Using Results**
   - Switch to fastest provider for time-critical work
   - Identify performance issues early
   - Optimize Hive Mind concurrency based on provider performance

## Troubleshooting

### CC Switch Not Detecting Claude Code

**Issue**: CC Switch doesn't find Claude Code configuration

**Solution**:
```bash
# Ensure Claude Code is installed
claude --version

# Verify Claude Code config exists
ls -la ~/.config/claude-code

# If missing, authenticate Claude Code
claude
```

### Provider Switch Not Taking Effect

**Issue**: Hive Mind still uses old provider after switching in CC Switch

**Solution**:
```bash
# 1. Verify active configuration in CC Switch
# 2. Restart any running Hive Mind processes
# 3. Check Claude Code picks up new config
claude --version

# 4. Run Hive Mind with verbose flag to verify provider
solve https://github.com/owner/repo/issues/123 --verbose
```

### Configuration Sync Issues

**Issue**: Configurations not syncing across machines

**Solution**:
1. Verify cloud storage service is running
2. Check custom directory path is correct on all machines
3. Ensure file permissions allow read/write access
4. Manually copy `~/.cc-switch/config.json` as fallback

### MCP Server Connection Issues

**Issue**: MCP servers not connecting after configuration change

**Solution**:
```bash
# 1. Verify MCP server settings in CC Switch
# 2. Test MCP server independently
# 3. Check server logs for errors
# 4. Ensure proper permissions for stdio servers
```

## Best Practices

### Configuration Management

1. **Naming Convention**: Use descriptive provider names
   - Good: "Claude-Official-US-East", "Azure-Claude-Europe"
   - Bad: "Provider1", "Test", "API"

2. **API Key Security**:
   - Never share configuration exports containing API keys
   - Rotate API keys regularly
   - Use separate keys for development and production

3. **Regular Backups**:
   - Export configurations before major changes
   - Store backups securely outside cloud-synced folders
   - Test restore process periodically

### Hive Mind Integration

1. **Provider Selection**:
   - Use faster providers for high-concurrency work
   - Switch to backup providers when rate limited
   - Match provider to workload complexity

2. **Monitoring**:
   - Watch for rate limit warnings in Hive Mind logs
   - Track API usage across providers
   - Monitor costs if using paid tiers

3. **Automation**:
   - Document provider switching workflows
   - Create scripts for common switching patterns
   - Set up alerts for provider issues

## Security Considerations

### API Key Protection

- CC Switch stores API keys in `~/.cc-switch/config.json`
- File permissions should be restricted to user only:
  ```bash
  chmod 600 ~/.cc-switch/config.json
  ```
- Never commit configuration files to version control
- Use environment-specific API keys

### Network Security

- Verify provider endpoints use HTTPS
- Review provider security policies
- Monitor for unauthorized API usage
- Rotate keys if compromise suspected

### Cloud Sync Security

- Use encrypted cloud storage services
- Enable two-factor authentication on cloud accounts
- Review cloud service access logs regularly
- Consider using encrypted configuration exports

## Advanced Features

### Custom Configuration Directory

Set a custom directory for configurations:

1. Open CC Switch settings
2. Navigate to "Advanced" section
3. Set custom configuration path
4. Restart CC Switch to apply changes

### Batch Provider Operations

Manage multiple providers efficiently:

1. Export all configurations
2. Edit configurations in bulk (JSON format)
3. Import updated configurations
4. Verify changes with speed test

### API Usage Tracking

Monitor API usage patterns:

1. Review provider usage in CC Switch
2. Correlate with Hive Mind logs
3. Optimize provider selection based on patterns
4. Plan API key rotations

## Resources

### Documentation
- [CC Switch GitHub Repository](https://github.com/farion1231/cc-switch)
- [CC Switch Issues](https://github.com/farion1231/cc-switch/issues)
- [Hive Mind Documentation](https://github.com/deep-assistant/hive-mind)

### Community
- Report CC Switch issues on GitHub
- Share configuration patterns and best practices
- Contribute to CC Switch development

### Related Tools
- [Claude Code CLI](https://github.com/anthropics/claude-code) - Official Claude CLI tool
- [Hive Mind](https://github.com/deep-assistant/hive-mind) - AI orchestration system
- MCP Server implementations - Various Model Context Protocol servers

## FAQ

**Q: Can I use CC Switch without Hive Mind?**
A: Yes, CC Switch works with Claude Code independently and supports any workflow using Claude Code CLI.

**Q: Does CC Switch support other AI providers besides Claude?**
A: CC Switch is designed for Claude Code but can manage any provider that uses compatible configuration formats.

**Q: Is CC Switch free?**
A: Check the CC Switch repository for current licensing and pricing information.

**Q: Can I run multiple CC Switch instances?**
A: Not recommended. Use cloud sync to share configurations across machines instead.

**Q: How do I contribute to CC Switch?**
A: Visit the [CC Switch repository](https://github.com/farion1231/cc-switch) and review their contribution guidelines.

**Q: Does Hive Mind require CC Switch?**
A: No, CC Switch is optional. Hive Mind works with standard Claude Code configurations. CC Switch provides convenience for managing multiple provider configurations.

## Version Compatibility

- **CC Switch**: Compatible with all versions (check releases for latest)
- **Claude Code**: All versions supported by Claude Code CLI
- **Hive Mind**: All versions (this integration is configuration-based)
- **Operating Systems**: macOS, Windows, Linux

## Conclusion

CC Switch provides powerful configuration management capabilities that complement Hive Mind's AI orchestration features. By combining both tools, you can:

- Efficiently manage multiple API providers
- Optimize costs and performance
- Streamline provider switching workflows
- Maintain robust configuration backups

For questions or issues specific to CC Switch, please visit the [CC Switch GitHub repository](https://github.com/farion1231/cc-switch).

For questions about Hive Mind integration, please create an issue in the [Hive Mind repository](https://github.com/deep-assistant/hive-mind/issues).
