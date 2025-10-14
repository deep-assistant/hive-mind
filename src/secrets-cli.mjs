#!/usr/bin/env node

/**
 * Hive Mind Secrets Management CLI
 *
 * Command-line interface for managing user keys and secrets
 * for Hive Mind jobs
 */

import {
  createSecretManager,
  createKeyInjector,
  KEY_TYPES,
  AUDIT_EVENTS
} from './secrets.lib.mjs';
import { createContainerSecretInjector } from './container-secrets.lib.mjs';
import { promises as fs } from 'fs';
import os from 'os';

// Get use-m for yargs
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
globalThis.use = use;

const yargs = (await use('yargs')).default;
const { hideBin } = await use('yargs/helpers');

// Initialize secret manager
let secretManager;
let keyInjector;

/**
 * Get current user ID (for single-user systems, this is simple)
 */
function getCurrentUserId() {
  return os.userInfo().username;
}

/**
 * Format key type for display
 */
function formatKeyType(keyType) {
  const typeNames = {
    [KEY_TYPES.SSH_RSA]: 'SSH RSA Key',
    [KEY_TYPES.SSH_ED25519]: 'SSH ED25519 Key',
    [KEY_TYPES.GITHUB_TOKEN]: 'GitHub Token',
    [KEY_TYPES.GITHUB_APP]: 'GitHub App',
    [KEY_TYPES.OAUTH_TOKEN]: 'OAuth Token',
    [KEY_TYPES.GENERIC_SECRET]: 'Generic Secret'
  };

  return typeNames[keyType] || keyType;
}

/**
 * Store command handler
 */
async function handleStore(argv) {
  const userId = argv.user || getCurrentUserId();
  const keyType = argv.type;
  const keyName = argv.name;
  const keyFile = argv.file;
  const keyValue = argv.value;

  if (!keyFile && !keyValue) {
    console.error('❌ Error: Either --file or --value must be provided');
    process.exit(1);
  }

  try {
    // Read key data
    let keyData;
    if (keyFile) {
      keyData = await fs.readFile(keyFile, 'utf8');
      console.log(`📖 Read key from file: ${keyFile}`);
    } else {
      keyData = keyValue;
    }

    // Store the secret
    const secretId = await secretManager.storeSecret(
      userId,
      keyType,
      keyName,
      keyData,
      {
        description: argv.description || '',
        source: keyFile ? 'file' : 'command-line'
      }
    );

    console.log('');
    console.log('✅ Secret stored successfully!');
    console.log('');
    console.log(`   User:      ${userId}`);
    console.log(`   Type:      ${formatKeyType(keyType)}`);
    console.log(`   Name:      ${keyName}`);
    console.log(`   Secret ID: ${secretId}`);
    console.log('');
    console.log('💡 Use this secret ID when running Hive Mind jobs');
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to store secret: ${error.message}`);
    process.exit(1);
  }
}

/**
 * List command handler
 */
async function handleList(argv) {
  const userId = argv.user || getCurrentUserId();
  const keyType = argv.type || null;

  try {
    const secrets = await secretManager.listSecrets(userId, keyType);

    if (secrets.length === 0) {
      console.log('');
      console.log('📭 No secrets found');
      console.log('');
      console.log('💡 Use "hive-secrets store" to add secrets');
      console.log('');
      return;
    }

    console.log('');
    console.log(`🔐 Secrets for user: ${userId}`);
    console.log('');

    for (const secret of secrets) {
      console.log(`   ${formatKeyType(secret.keyType)}: ${secret.keyName}`);
      console.log(`     Secret ID:    ${secret.secretId}`);
      console.log(`     Created:      ${secret.metadata.createdAt}`);
      console.log(`     Last accessed: ${secret.metadata.lastAccessed || 'Never'}`);
      console.log(`     Access count:  ${secret.metadata.accessCount || 0}`);
      console.log('');
    }

    console.log(`📊 Total secrets: ${secrets.length}`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to list secrets: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Delete command handler
 */
async function handleDelete(argv) {
  const userId = argv.user || getCurrentUserId();
  const secretId = argv.id;

  try {
    await secretManager.deleteSecret(secretId, userId);

    console.log('');
    console.log('✅ Secret deleted successfully!');
    console.log('');
    console.log(`   Secret ID: ${secretId}`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to delete secret: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Audit command handler
 */
async function handleAudit(argv) {
  const userId = argv.user || null;
  const event = argv.event || null;
  const since = argv.since || null;
  const limit = argv.limit || 50;

  try {
    const logs = await secretManager.getAuditLogs({
      userId,
      event,
      since,
      limit
    });

    if (logs.length === 0) {
      console.log('');
      console.log('📭 No audit logs found');
      console.log('');
      return;
    }

    console.log('');
    console.log('📜 Audit Logs');
    console.log('');

    for (const log of logs) {
      const timestamp = new Date(log.timestamp).toLocaleString();
      console.log(`[${timestamp}] ${log.event}`);

      if (log.details.userId) {
        console.log(`  User:      ${log.details.userId}`);
      }

      if (log.details.secretId) {
        console.log(`  Secret ID: ${log.details.secretId}`);
      }

      if (log.details.keyType) {
        console.log(`  Type:      ${formatKeyType(log.details.keyType)}`);
      }

      if (log.details.keyName) {
        console.log(`  Name:      ${log.details.keyName}`);
      }

      if (log.details.error) {
        console.log(`  Error:     ${log.details.error}`);
      }

      console.log('');
    }

    console.log(`📊 Total logs: ${logs.length}`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to read audit logs: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Info command handler
 */
async function handleInfo(argv) {
  const userId = getCurrentUserId();

  try {
    const secrets = await secretManager.listSecrets(userId);
    const activeSessions = keyInjector.getActiveSessions(userId);

    console.log('');
    console.log('ℹ️  Hive Mind Secrets Information');
    console.log('');
    console.log(`   Current User:     ${userId}`);
    console.log(`   Storage Path:     ${secretManager.storagePath}`);
    console.log(`   Audit Log:        ${secretManager.auditLogPath}`);
    console.log(`   Encryption:       ${secretManager.gpgEnabled ? 'GPG' : 'AES-256-GCM'}`);
    console.log('');
    console.log('📊 Statistics:');
    console.log(`   Total Secrets:    ${secrets.length}`);
    console.log(`   Active Sessions:  ${activeSessions.length}`);
    console.log('');

    // Show secret breakdown by type
    const byType = {};
    for (const secret of secrets) {
      byType[secret.keyType] = (byType[secret.keyType] || 0) + 1;
    }

    if (Object.keys(byType).length > 0) {
      console.log('📦 Secrets by type:');
      for (const [type, count] of Object.entries(byType)) {
        console.log(`   ${formatKeyType(type)}: ${count}`);
      }
      console.log('');
    }
  } catch (error) {
    console.error(`❌ Failed to get info: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Export command handler
 */
async function handleExport(argv) {
  const userId = argv.user || getCurrentUserId();
  const outputFile = argv.output;

  try {
    const secrets = await secretManager.listSecrets(userId);

    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      userId,
      secrets: secrets.map(s => ({
        secretId: s.secretId,
        keyType: s.keyType,
        keyName: s.keyName,
        metadata: s.metadata
      }))
    };

    await fs.writeFile(outputFile, JSON.stringify(exportData, null, 2), { mode: 0o600 });

    console.log('');
    console.log('✅ Secrets metadata exported successfully!');
    console.log('');
    console.log(`   Output file: ${outputFile}`);
    console.log(`   Secrets:     ${secrets.length}`);
    console.log('');
    console.log('⚠️  Note: Only metadata was exported, not the actual secret values');
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to export: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Main CLI
 */
async function main() {
  // Initialize managers
  secretManager = await createSecretManager({ verbose: false });
  keyInjector = await createKeyInjector(secretManager);

  await yargs(hideBin(process.argv))
    .scriptName('hive-secrets')
    .usage('$0 <command> [options]')
    .command(
      'store',
      'Store a new secret',
      (yargs) => {
        return yargs
          .option('type', {
            alias: 't',
            type: 'string',
            choices: Object.values(KEY_TYPES),
            demandOption: true,
            description: 'Type of secret'
          })
          .option('name', {
            alias: 'n',
            type: 'string',
            demandOption: true,
            description: 'Name/identifier for the secret'
          })
          .option('file', {
            alias: 'f',
            type: 'string',
            description: 'Path to file containing the secret'
          })
          .option('value', {
            alias: 'v',
            type: 'string',
            description: 'Secret value (alternative to --file)'
          })
          .option('description', {
            alias: 'd',
            type: 'string',
            description: 'Description of the secret'
          })
          .option('user', {
            alias: 'u',
            type: 'string',
            description: 'User ID (defaults to current user)'
          })
          .check((argv) => {
            if (!argv.file && !argv.value) {
              throw new Error('Either --file or --value must be provided');
            }
            if (argv.file && argv.value) {
              throw new Error('Cannot use both --file and --value');
            }
            return true;
          });
      },
      handleStore
    )
    .command(
      'list',
      'List all secrets',
      (yargs) => {
        return yargs
          .option('type', {
            alias: 't',
            type: 'string',
            choices: Object.values(KEY_TYPES),
            description: 'Filter by secret type'
          })
          .option('user', {
            alias: 'u',
            type: 'string',
            description: 'User ID (defaults to current user)'
          });
      },
      handleList
    )
    .command(
      'delete <id>',
      'Delete a secret',
      (yargs) => {
        return yargs
          .positional('id', {
            type: 'string',
            description: 'Secret ID to delete'
          })
          .option('user', {
            alias: 'u',
            type: 'string',
            description: 'User ID (defaults to current user)'
          });
      },
      handleDelete
    )
    .command(
      'audit',
      'View audit logs',
      (yargs) => {
        return yargs
          .option('user', {
            alias: 'u',
            type: 'string',
            description: 'Filter by user ID'
          })
          .option('event', {
            alias: 'e',
            type: 'string',
            choices: Object.values(AUDIT_EVENTS),
            description: 'Filter by event type'
          })
          .option('since', {
            alias: 's',
            type: 'string',
            description: 'Show logs since date (ISO 8601 format)'
          })
          .option('limit', {
            alias: 'l',
            type: 'number',
            default: 50,
            description: 'Maximum number of logs to show'
          });
      },
      handleAudit
    )
    .command(
      'info',
      'Show system information',
      () => {},
      handleInfo
    )
    .command(
      'export',
      'Export secrets metadata',
      (yargs) => {
        return yargs
          .option('output', {
            alias: 'o',
            type: 'string',
            demandOption: true,
            description: 'Output file path'
          })
          .option('user', {
            alias: 'u',
            type: 'string',
            description: 'User ID (defaults to current user)'
          });
      },
      handleExport
    )
    .demandCommand(1, 'You need to specify a command')
    .help()
    .alias('help', 'h')
    .version('1.0.0')
    .alias('version', 'V')
    .epilogue('For more information, see: https://github.com/deep-assistant/hive-mind')
    .parse();
}

// Run CLI
main().catch((error) => {
  console.error(`❌ Fatal error: ${error.message}`);
  process.exit(1);
});
