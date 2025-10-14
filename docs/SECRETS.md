# Secure User Key Storage and Injection

This document describes the secure user key storage and isolated injection mechanism for Hive Mind jobs.

## Overview

The Hive Mind secrets management system provides:

- **Encrypted Storage**: Secure storage of user keys using GPG or AES-256-GCM encryption
- **Session Isolation**: Keys are isolated per job session and never persist on the host
- **Container Integration**: Seamless injection into Docker containers
- **Audit Logging**: Comprehensive logging of all secret access and usage
- **Multiple Key Types**: Support for SSH keys, GitHub tokens, OAuth tokens, and more

## Architecture

### Components

1. **SecretStorageManager** (`src/secrets.lib.mjs`)
   - Handles encrypted storage and retrieval of secrets
   - Supports GPG and AES-256-GCM encryption
   - Manages secret lifecycle and access control

2. **SessionKeyInjector** (`src/secrets.lib.mjs`)
   - Creates isolated sessions for each job
   - Manages key-to-session mapping
   - Generates injection scripts for containers

3. **ContainerSecretInjector** (`src/container-secrets.lib.mjs`)
   - Integrates with Docker containerization
   - Handles volume mounts for secrets
   - Manages secret cleanup after job completion

4. **CLI Tool** (`src/secrets-cli.mjs`)
   - Command-line interface for managing secrets
   - User-friendly commands for storing, listing, and deleting secrets

### Security Features

- **Encryption at Rest**: All secrets are encrypted before being written to disk
- **Per-User Isolation**: Secrets are isolated by user ID
- **Session-Based Access**: Keys are only accessible within specific job sessions
- **Automatic Cleanup**: Secrets are removed from containers after use
- **Audit Trail**: All operations are logged for security auditing
- **No Host Persistence**: Keys never persist on the host filesystem outside encrypted storage

## Key Types

The system supports the following key types:

| Key Type | Description | Use Case |
|----------|-------------|----------|
| `ssh-rsa` | SSH RSA private key | Git operations over SSH |
| `ssh-ed25519` | SSH ED25519 private key | Git operations over SSH (recommended) |
| `github-token` | GitHub Personal Access Token | GitHub API operations |
| `github-app` | GitHub App credentials | GitHub App authentication |
| `oauth-token` | OAuth 2.0 token | Third-party integrations |
| `generic-secret` | Generic secret/password | Other credentials |

## Installation

The secrets management system is included with Hive Mind. No additional installation is required.

## Quick Start

### 1. Store a Secret

Store an SSH key:

```bash
hive-secrets store \
  --type ssh-ed25519 \
  --name my-deploy-key \
  --file ~/.ssh/id_ed25519 \
  --description "Deployment key for prod"
```

Store a GitHub token:

```bash
hive-secrets store \
  --type github-token \
  --name my-github-token \
  --value ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --description "GitHub PAT for CI/CD"
```

### 2. List Secrets

List all secrets:

```bash
hive-secrets list
```

List only SSH keys:

```bash
hive-secrets list --type ssh-ed25519
```

### 3. View Audit Logs

View recent access logs:

```bash
hive-secrets audit --limit 20
```

View logs for specific user:

```bash
hive-secrets audit --user alice --limit 50
```

### 4. Delete a Secret

```bash
hive-secrets delete <secret-id>
```

## Usage with Hive Mind Jobs

### Integration with solve.mjs

When containerization is enabled (issue #449), secrets will be automatically injected:

```bash
# Future usage (when containerization is complete)
solve https://github.com/owner/repo/issues/123 \
  --with-secrets <secret-id-1>,<secret-id-2> \
  --containerized
```

### Integration with hive.mjs

```bash
# Future usage
hive https://github.com/owner/repo \
  --with-secrets <secret-id> \
  --containerized
```

### Integration with review.mjs

```bash
# Future usage
review --repo owner/repo --pr 456 \
  --with-secrets <secret-id> \
  --containerized
```

## CLI Reference

### `hive-secrets store`

Store a new secret.

**Options:**
- `--type, -t`: Secret type (required)
  - Choices: `ssh-rsa`, `ssh-ed25519`, `github-token`, `github-app`, `oauth-token`, `generic-secret`
- `--name, -n`: Name/identifier for the secret (required)
- `--file, -f`: Path to file containing the secret
- `--value, -v`: Secret value (alternative to --file)
- `--description, -d`: Description of the secret
- `--user, -u`: User ID (defaults to current user)

**Examples:**

```bash
# Store SSH key from file
hive-secrets store -t ssh-ed25519 -n deploy-key -f ~/.ssh/id_ed25519

# Store GitHub token directly
hive-secrets store -t github-token -n ci-token -v ghp_xxx...

# Store with description
hive-secrets store -t ssh-rsa -n backup-key -f ~/keys/backup.pem -d "Backup SSH key"
```

### `hive-secrets list`

List stored secrets.

**Options:**
- `--type, -t`: Filter by secret type
- `--user, -u`: User ID (defaults to current user)

**Examples:**

```bash
# List all secrets
hive-secrets list

# List only SSH keys
hive-secrets list --type ssh-ed25519

# List secrets for specific user
hive-secrets list --user alice
```

### `hive-secrets delete`

Delete a secret.

**Syntax:**
```bash
hive-secrets delete <secret-id> [--user <user-id>]
```

**Examples:**

```bash
# Delete a secret
hive-secrets delete alice-deploy-key-1697123456789
```

### `hive-secrets audit`

View audit logs.

**Options:**
- `--user, -u`: Filter by user ID
- `--event, -e`: Filter by event type
- `--since, -s`: Show logs since date (ISO 8601 format)
- `--limit, -l`: Maximum number of logs (default: 50)

**Examples:**

```bash
# View recent logs
hive-secrets audit

# View logs for specific user
hive-secrets audit --user alice

# View only access events
hive-secrets audit --event key_retrieved

# View logs since specific date
hive-secrets audit --since 2025-10-01T00:00:00Z

# Combine filters
hive-secrets audit --user alice --event key_stored --limit 10
```

### `hive-secrets info`

Show system information and statistics.

**Example:**

```bash
hive-secrets info
```

Output:

```
ℹ️  Hive Mind Secrets Information

   Current User:     alice
   Storage Path:     /home/alice/.hive-mind/secrets
   Audit Log:        /home/alice/.hive-mind/audit.log
   Encryption:       GPG

📊 Statistics:
   Total Secrets:    5
   Active Sessions:  2

📦 Secrets by type:
   SSH ED25519 Key: 2
   GitHub Token: 2
   OAuth Token: 1
```

### `hive-secrets export`

Export secrets metadata (not the actual values).

**Options:**
- `--output, -o`: Output file path (required)
- `--user, -u`: User ID (defaults to current user)

**Example:**

```bash
hive-secrets export --output secrets-backup.json
```

## Container Integration

### How It Works

1. **Secret Preparation**: When a containerized job starts, secrets are retrieved and decrypted
2. **Temporary Storage**: Secrets are written to temporary files with restricted permissions (0600)
3. **Volume Mounting**: Secret files are mounted read-only into the container
4. **Injection Script**: An auto-generated script sets up the secrets inside the container
5. **Automatic Cleanup**: After job completion, all temporary files are securely deleted

### Security Measures

- Secrets are mounted read-only into containers
- Temporary files use random filenames
- Container runs with `--security-opt no-new-privileges`
- Container runs with dropped capabilities (`--cap-drop ALL`)
- Resource limits prevent abuse (`--memory 2g --cpus 2`)
- Secrets are removed from container filesystem after setup

### Example Container Flow

```bash
# 1. User stores a secret
hive-secrets store -t github-token -n ci-token -v ghp_xxx...

# 2. Job starts with containerization enabled
solve https://github.com/owner/repo/issues/123 \
  --with-secrets alice-ci-token-1697123456789 \
  --containerized

# 3. System automatically:
#    - Creates isolated session
#    - Retrieves and decrypts the secret
#    - Writes to temporary file
#    - Mounts into container as read-only
#    - Executes injection script inside container
#    - Runs solve.mjs with secrets available
#    - Cleans up all temporary files
```

## Encryption Methods

### GPG Encryption (Recommended)

When GPG is available, secrets are encrypted using symmetric encryption with AES256:

- Uses GPG's symmetric encryption with strong passphrase derivation
- Passphrase is derived from user ID using scrypt
- Provides additional security layer beyond application encryption

### AES-256-GCM Encryption (Fallback)

When GPG is not available, secrets use AES-256-GCM:

- 256-bit key derived from system-specific data
- Galois/Counter Mode for authenticated encryption
- Unique IV per encryption operation
- Authentication tags prevent tampering

### Key Derivation

Encryption keys are derived using scrypt:

- System hostname and username as base
- High work factor for key derivation
- Makes brute-force attacks impractical

## Audit Logging

All secret operations are logged to `~/.hive-mind/audit.log`.

### Audit Events

| Event | Description |
|-------|-------------|
| `key_stored` | Secret was stored |
| `key_retrieved` | Secret was retrieved |
| `key_injected` | Secret was injected into container |
| `key_deleted` | Secret was deleted |
| `key_rotated` | Secret was rotated |
| `access_denied` | Access to secret was denied |
| `encryption_error` | Encryption operation failed |
| `decryption_error` | Decryption operation failed |

### Audit Log Format

Each log entry is a JSON object:

```json
{
  "timestamp": "2025-10-14T12:34:56.789Z",
  "event": "key_retrieved",
  "details": {
    "secretId": "alice-deploy-key-1697123456789",
    "userId": "alice",
    "keyType": "ssh-ed25519",
    "keyName": "deploy-key"
  },
  "hostname": "hive-prod-01",
  "pid": 12345
}
```

## Best Practices

### Secret Storage

1. **Use Descriptive Names**: Give secrets meaningful names
2. **Add Descriptions**: Include context about each secret's purpose
3. **Regular Rotation**: Rotate secrets regularly
4. **Least Privilege**: Only store secrets that are actually needed
5. **Audit Regularly**: Review audit logs for unusual activity

### Secret Usage

1. **Session Isolation**: Each job should have its own session
2. **Cleanup**: Always ensure secrets are cleaned up after use
3. **Monitoring**: Monitor active sessions for anomalies
4. **Access Control**: Never share secret IDs between users

### Security

1. **Enable GPG**: Use GPG encryption when possible
2. **Secure Host**: Ensure host system is properly secured
3. **Limited Access**: Restrict access to `~/.hive-mind` directory
4. **Regular Backups**: Export and backup secret metadata regularly
5. **Review Logs**: Regularly review audit logs

## Troubleshooting

### GPG Not Available

If GPG is not installed, the system will fall back to AES-256-GCM encryption:

```bash
# Install GPG on Ubuntu/Debian
sudo apt-get install gnupg

# Install GPG on macOS
brew install gnupg
```

### Permission Denied

If you get permission errors:

```bash
# Fix storage directory permissions
chmod 700 ~/.hive-mind
chmod 700 ~/.hive-mind/secrets
```

### Secret Not Found

If a secret cannot be found:

1. List all secrets: `hive-secrets list`
2. Verify the secret ID is correct
3. Check you're using the correct user ID
4. Review audit logs: `hive-secrets audit`

### Container Integration Issues

If secrets aren't being injected into containers:

1. Verify containerization is enabled (depends on issue #449)
2. Check Docker daemon is running: `docker info`
3. Verify secret IDs are correct
4. Review container logs for errors

## API Reference

For programmatic usage, see:

- `src/secrets.lib.mjs` - Core secret storage functionality
- `src/container-secrets.lib.mjs` - Container integration
- `tests/test-secrets.mjs` - Usage examples

### Example: Using the API

```javascript
import { createSecretManager, createKeyInjector, KEY_TYPES } from './src/secrets.lib.mjs';

// Initialize
const manager = await createSecretManager();
const injector = await createKeyInjector(manager);

// Store a secret
const secretId = await manager.storeSecret(
  'alice',
  KEY_TYPES.GITHUB_TOKEN,
  'my-token',
  'ghp_xxx...'
);

// Create a session
const sessionId = await injector.createSession(
  'job-123',
  'alice',
  { type: 'solve', issueUrl: '...' }
);

// Retrieve and inject
const secret = await manager.retrieveSecret(secretId, 'alice');

// Close session
await injector.closeSession(sessionId);
```

## Future Enhancements

The following features are planned for future releases:

1. **Vault Integration**: Support for HashiCorp Vault backend
2. **Cloud KMS**: Integration with AWS KMS, Azure Key Vault, GCP KMS
3. **Secret Rotation**: Automated secret rotation policies
4. **RBAC**: Role-based access control for multi-user environments
5. **Secret Sharing**: Secure secret sharing between trusted users
6. **Web UI**: Web-based interface for secret management
7. **Import/Export**: Import secrets from other password managers

## Related Documentation

- [Docker Support](DOCKER.md) - Docker containerization
- [Contributing](CONTRIBUTING.md) - Development guidelines
- [Security](../README.md#critical-token-and-sensitive-data-security) - Security considerations

## Support

For issues or questions:

- GitHub Issues: https://github.com/deep-assistant/hive-mind/issues
- Documentation: https://github.com/deep-assistant/hive-mind

## License

This feature is part of the Hive Mind project and follows the same Unlicense license.
