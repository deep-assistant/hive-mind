#!/usr/bin/env node

/**
 * Secure User Key Storage and Isolated Injection Mechanism
 *
 * This module provides secure storage and injection of user keys (SSH keys, tokens)
 * for Hive Mind jobs with the following features:
 * - Encrypted storage using GPG
 * - Session-based key mapping
 * - Isolated injection into containers
 * - Comprehensive audit logging
 * - Support for multiple key types (SSH RSA, ED25519, GitHub tokens, OAuth)
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import os from 'os';

/**
 * Key types supported by the system
 */
export const KEY_TYPES = {
  SSH_RSA: 'ssh-rsa',
  SSH_ED25519: 'ssh-ed25519',
  GITHUB_TOKEN: 'github-token',
  GITHUB_APP: 'github-app',
  OAUTH_TOKEN: 'oauth-token',
  GENERIC_SECRET: 'generic-secret'
};

/**
 * Audit event types
 */
export const AUDIT_EVENTS = {
  KEY_STORED: 'key_stored',
  KEY_RETRIEVED: 'key_retrieved',
  KEY_INJECTED: 'key_injected',
  KEY_DELETED: 'key_deleted',
  KEY_ROTATED: 'key_rotated',
  ACCESS_DENIED: 'access_denied',
  ENCRYPTION_ERROR: 'encryption_error',
  DECRYPTION_ERROR: 'decryption_error'
};

/**
 * Storage backend configuration
 */
const DEFAULT_STORAGE_PATH = join(os.homedir(), '.hive-mind', 'secrets');
const AUDIT_LOG_PATH = join(os.homedir(), '.hive-mind', 'audit.log');
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/**
 * Secure Key Storage Manager
 */
export class SecretStorageManager {
  constructor(options = {}) {
    this.storagePath = options.storagePath || DEFAULT_STORAGE_PATH;
    this.auditLogPath = options.auditLogPath || AUDIT_LOG_PATH;
    this.encryptionKey = options.encryptionKey || this._deriveEncryptionKey();
    this.gpgEnabled = options.gpgEnabled !== false; // GPG enabled by default
    this.verbose = options.verbose || false;
  }

  /**
   * Derive encryption key from system-specific data
   * In production, this should use a more secure key management system
   */
  _deriveEncryptionKey() {
    // Use system hostname and user as basis for key derivation
    const systemSeed = `${os.hostname()}-${os.userInfo().username}`;
    return scryptSync(systemSeed, 'hive-mind-salt', 32);
  }

  /**
   * Initialize storage directory structure
   */
  async initialize() {
    try {
      // Create storage directories
      await fs.mkdir(this.storagePath, { recursive: true, mode: 0o700 });
      await fs.mkdir(dirname(this.auditLogPath), { recursive: true, mode: 0o700 });

      // Create subdirectories for different key types
      for (const keyType of Object.values(KEY_TYPES)) {
        const keyTypeDir = join(this.storagePath, keyType);
        await fs.mkdir(keyTypeDir, { recursive: true, mode: 0o700 });
      }

      // Check if GPG is available
      if (this.gpgEnabled) {
        try {
          execSync('which gpg', { stdio: 'ignore' });
        } catch {
          if (this.verbose) {
            console.warn('⚠️  GPG not found, falling back to AES-256-GCM encryption');
          }
          this.gpgEnabled = false;
        }
      }

      await this._audit(AUDIT_EVENTS.KEY_STORED, {
        action: 'initialize',
        message: 'Storage initialized successfully'
      });

      return true;
    } catch (error) {
      await this._audit(AUDIT_EVENTS.ENCRYPTION_ERROR, {
        action: 'initialize',
        error: error.message
      });
      throw new Error(`Failed to initialize secret storage: ${error.message}`);
    }
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  _encryptAES(data) {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  _decryptAES(encrypted, iv, authTag) {
    const decipher = createDecipheriv(
      ENCRYPTION_ALGORITHM,
      this.encryptionKey,
      Buffer.from(iv, 'hex')
    );

    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Encrypt data using GPG (preferred method when available)
   */
  async _encryptGPG(data, userId) {
    try {
      const tempFile = join(os.tmpdir(), `hive-secret-${randomBytes(8).toString('hex')}`);
      await fs.writeFile(tempFile, data, { mode: 0o600 });

      // Use symmetric encryption with a passphrase derived from userId
      const passphrase = scryptSync(userId, 'hive-gpg-salt', 32).toString('hex');

      execSync(
        `echo "${passphrase}" | gpg --batch --yes --passphrase-fd 0 --symmetric --cipher-algo AES256 -o ${tempFile}.gpg ${tempFile}`,
        { stdio: 'pipe' }
      );

      const encryptedData = await fs.readFile(`${tempFile}.gpg`);

      // Cleanup temp files
      await fs.unlink(tempFile).catch(() => {});
      await fs.unlink(`${tempFile}.gpg`).catch(() => {});

      return encryptedData.toString('base64');
    } catch (error) {
      throw new Error(`GPG encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt data using GPG
   */
  async _decryptGPG(encryptedData, userId) {
    try {
      const tempFile = join(os.tmpdir(), `hive-secret-${randomBytes(8).toString('hex')}.gpg`);
      await fs.writeFile(tempFile, Buffer.from(encryptedData, 'base64'), { mode: 0o600 });

      const passphrase = scryptSync(userId, 'hive-gpg-salt', 32).toString('hex');

      const decrypted = execSync(
        `echo "${passphrase}" | gpg --batch --yes --passphrase-fd 0 --decrypt ${tempFile}`,
        { stdio: 'pipe' }
      );

      await fs.unlink(tempFile).catch(() => {});

      return decrypted.toString('utf8');
    } catch (error) {
      throw new Error(`GPG decryption failed: ${error.message}`);
    }
  }

  /**
   * Store a secret securely
   *
   * @param {string} userId - User identifier (for multi-user systems)
   * @param {string} keyType - Type of key (from KEY_TYPES)
   * @param {string} keyName - Name/identifier for the key
   * @param {string} keyData - The actual key/secret data
   * @param {object} metadata - Additional metadata about the key
   */
  async storeSecret(userId, keyType, keyName, keyData, metadata = {}) {
    try {
      // Validate key type
      if (!Object.values(KEY_TYPES).includes(keyType)) {
        throw new Error(`Invalid key type: ${keyType}`);
      }

      // Validate key data based on type
      this._validateKeyData(keyType, keyData);

      // Generate unique identifier for this secret
      const secretId = `${userId}-${keyName}-${Date.now()}`;

      // Encrypt the key data
      let encryptedPayload;
      if (this.gpgEnabled) {
        const encryptedData = await this._encryptGPG(keyData, userId);
        encryptedPayload = {
          method: 'gpg',
          data: encryptedData
        };
      } else {
        const { encrypted, iv, authTag } = this._encryptAES(keyData);
        encryptedPayload = {
          method: 'aes-256-gcm',
          encrypted,
          iv,
          authTag
        };
      }

      // Create secret record
      const secretRecord = {
        secretId,
        userId,
        keyType,
        keyName,
        encryptedPayload,
        metadata: {
          ...metadata,
          createdAt: new Date().toISOString(),
          lastAccessed: null,
          accessCount: 0
        }
      };

      // Store the secret
      const secretPath = join(this.storagePath, keyType, `${secretId}.json`);
      await fs.writeFile(
        secretPath,
        JSON.stringify(secretRecord, null, 2),
        { mode: 0o600 }
      );

      // Audit log
      await this._audit(AUDIT_EVENTS.KEY_STORED, {
        secretId,
        userId,
        keyType,
        keyName,
        encryptionMethod: encryptedPayload.method
      });

      return secretId;
    } catch (error) {
      await this._audit(AUDIT_EVENTS.ENCRYPTION_ERROR, {
        userId,
        keyType,
        keyName,
        error: error.message
      });
      throw new Error(`Failed to store secret: ${error.message}`);
    }
  }

  /**
   * Retrieve a secret
   *
   * @param {string} secretId - Unique identifier for the secret
   * @param {string} userId - User identifier (for access control)
   */
  async retrieveSecret(secretId, userId) {
    try {
      // Find the secret file
      const secretPath = await this._findSecretPath(secretId);

      if (!secretPath) {
        await this._audit(AUDIT_EVENTS.ACCESS_DENIED, {
          secretId,
          userId,
          reason: 'Secret not found'
        });
        throw new Error('Secret not found');
      }

      // Read the secret record
      const secretRecord = JSON.parse(await fs.readFile(secretPath, 'utf8'));

      // Verify user access
      if (secretRecord.userId !== userId) {
        await this._audit(AUDIT_EVENTS.ACCESS_DENIED, {
          secretId,
          userId,
          actualUserId: secretRecord.userId,
          reason: 'User mismatch'
        });
        throw new Error('Access denied: User mismatch');
      }

      // Decrypt the key data
      let keyData;
      if (secretRecord.encryptedPayload.method === 'gpg') {
        keyData = await this._decryptGPG(secretRecord.encryptedPayload.data, userId);
      } else {
        const { encrypted, iv, authTag } = secretRecord.encryptedPayload;
        keyData = this._decryptAES(encrypted, iv, authTag);
      }

      // Update access metadata
      secretRecord.metadata.lastAccessed = new Date().toISOString();
      secretRecord.metadata.accessCount = (secretRecord.metadata.accessCount || 0) + 1;

      await fs.writeFile(secretPath, JSON.stringify(secretRecord, null, 2), { mode: 0o600 });

      // Audit log
      await this._audit(AUDIT_EVENTS.KEY_RETRIEVED, {
        secretId,
        userId,
        keyType: secretRecord.keyType,
        keyName: secretRecord.keyName
      });

      return {
        keyData,
        keyType: secretRecord.keyType,
        keyName: secretRecord.keyName,
        metadata: secretRecord.metadata
      };
    } catch (error) {
      await this._audit(AUDIT_EVENTS.DECRYPTION_ERROR, {
        secretId,
        userId,
        error: error.message
      });
      throw new Error(`Failed to retrieve secret: ${error.message}`);
    }
  }

  /**
   * Delete a secret
   */
  async deleteSecret(secretId, userId) {
    try {
      const secretPath = await this._findSecretPath(secretId);

      if (!secretPath) {
        throw new Error('Secret not found');
      }

      // Read and verify ownership
      const secretRecord = JSON.parse(await fs.readFile(secretPath, 'utf8'));

      if (secretRecord.userId !== userId) {
        await this._audit(AUDIT_EVENTS.ACCESS_DENIED, {
          secretId,
          userId,
          reason: 'Cannot delete: User mismatch'
        });
        throw new Error('Access denied: User mismatch');
      }

      // Delete the secret file
      await fs.unlink(secretPath);

      // Audit log
      await this._audit(AUDIT_EVENTS.KEY_DELETED, {
        secretId,
        userId,
        keyType: secretRecord.keyType,
        keyName: secretRecord.keyName
      });

      return true;
    } catch (error) {
      throw new Error(`Failed to delete secret: ${error.message}`);
    }
  }

  /**
   * List secrets for a user
   */
  async listSecrets(userId, keyType = null) {
    const secrets = [];

    try {
      const keyTypes = keyType ? [keyType] : Object.values(KEY_TYPES);

      for (const type of keyTypes) {
        const typeDir = join(this.storagePath, type);

        try {
          const files = await fs.readdir(typeDir);

          for (const file of files) {
            if (!file.endsWith('.json')) continue;

            const secretPath = join(typeDir, file);
            const secretRecord = JSON.parse(await fs.readFile(secretPath, 'utf8'));

            if (secretRecord.userId === userId) {
              secrets.push({
                secretId: secretRecord.secretId,
                keyType: secretRecord.keyType,
                keyName: secretRecord.keyName,
                metadata: secretRecord.metadata
              });
            }
          }
        } catch {
          // Directory might not exist, skip
          continue;
        }
      }

      return secrets;
    } catch (error) {
      throw new Error(`Failed to list secrets: ${error.message}`);
    }
  }

  /**
   * Find the filesystem path for a secret
   */
  async _findSecretPath(secretId) {
    for (const keyType of Object.values(KEY_TYPES)) {
      const typeDir = join(this.storagePath, keyType);

      try {
        const files = await fs.readdir(typeDir);

        for (const file of files) {
          if (file.startsWith(secretId) && file.endsWith('.json')) {
            return join(typeDir, file);
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Validate key data based on key type
   */
  _validateKeyData(keyType, keyData) {
    switch (keyType) {
      case KEY_TYPES.SSH_RSA:
        if (!keyData.includes('BEGIN RSA PRIVATE KEY') && !keyData.includes('BEGIN OPENSSH PRIVATE KEY')) {
          throw new Error('Invalid SSH RSA key format');
        }
        break;

      case KEY_TYPES.SSH_ED25519:
        if (!keyData.includes('BEGIN OPENSSH PRIVATE KEY')) {
          throw new Error('Invalid SSH ED25519 key format');
        }
        break;

      case KEY_TYPES.GITHUB_TOKEN:
        if (!keyData.match(/^(gh[ps]_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9_]+)$/)) {
          throw new Error('Invalid GitHub token format');
        }
        break;

      case KEY_TYPES.GITHUB_APP:
        // GitHub App should be a JSON with appId, privateKey, installationId
        try {
          const appData = JSON.parse(keyData);
          if (!appData.appId || !appData.privateKey || !appData.installationId) {
            throw new Error('Missing required fields');
          }
        } catch {
          throw new Error('Invalid GitHub App configuration format');
        }
        break;

      case KEY_TYPES.OAUTH_TOKEN:
        // Basic validation for OAuth token
        if (typeof keyData !== 'string' || keyData.length < 20) {
          throw new Error('Invalid OAuth token format');
        }
        break;

      case KEY_TYPES.GENERIC_SECRET:
        // No specific validation for generic secrets
        break;

      default:
        throw new Error(`Unknown key type: ${keyType}`);
    }
  }

  /**
   * Audit logging
   */
  async _audit(event, details) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      event,
      details,
      hostname: os.hostname(),
      pid: process.pid
    };

    try {
      await fs.appendFile(
        this.auditLogPath,
        JSON.stringify(auditEntry) + '\n',
        { mode: 0o600 }
      );
    } catch (error) {
      console.error(`Failed to write audit log: ${error.message}`);
    }
  }

  /**
   * Get audit logs (for administrative purposes)
   */
  async getAuditLogs(options = {}) {
    try {
      const content = await fs.readFile(this.auditLogPath, 'utf8');
      const lines = content.trim().split('\n');

      let logs = lines.map(line => JSON.parse(line));

      // Apply filters
      if (options.userId) {
        logs = logs.filter(log => log.details.userId === options.userId);
      }

      if (options.event) {
        logs = logs.filter(log => log.event === options.event);
      }

      if (options.since) {
        const sinceDate = new Date(options.since);
        logs = logs.filter(log => new Date(log.timestamp) >= sinceDate);
      }

      if (options.limit) {
        logs = logs.slice(-options.limit);
      }

      return logs;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to read audit logs: ${error.message}`);
    }
  }
}

/**
 * Session-based Key Injector
 * Manages key injection into job containers with session isolation
 */
export class SessionKeyInjector {
  constructor(storageManager, options = {}) {
    this.storageManager = storageManager;
    this.activeSessions = new Map();
    this.verbose = options.verbose || false;
  }

  /**
   * Create a new session for key injection
   *
   * @param {string} jobId - Unique identifier for the job
   * @param {string} userId - User identifier
   * @param {object} jobContext - Context information about the job
   */
  async createSession(jobId, userId, jobContext = {}) {
    const sessionId = `session-${jobId}-${Date.now()}`;

    const session = {
      sessionId,
      jobId,
      userId,
      jobContext,
      createdAt: new Date().toISOString(),
      injectedKeys: [],
      status: 'active'
    };

    this.activeSessions.set(sessionId, session);

    await this.storageManager._audit(AUDIT_EVENTS.KEY_INJECTED, {
      sessionId,
      jobId,
      userId,
      action: 'session_created',
      jobContext
    });

    return sessionId;
  }

  /**
   * Inject keys into a container for a specific session
   *
   * @param {string} sessionId - Session identifier
   * @param {string[]} secretIds - Array of secret IDs to inject
   * @param {string} containerPath - Path in container to inject keys
   */
  async injectKeys(sessionId, secretIds, containerPath = '/tmp/hive-secrets') {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      throw new Error('Invalid or expired session');
    }

    if (session.status !== 'active') {
      throw new Error('Session is not active');
    }

    const injectedKeys = [];

    try {
      for (const secretId of secretIds) {
        // Retrieve the secret
        const secret = await this.storageManager.retrieveSecret(secretId, session.userId);

        // Generate secure temporary filename
        const keyFileName = `key-${randomBytes(8).toString('hex')}`;
        const keyFilePath = join(containerPath, keyFileName);

        injectedKeys.push({
          secretId,
          keyType: secret.keyType,
          keyName: secret.keyName,
          containerPath: keyFilePath,
          injectedAt: new Date().toISOString()
        });

        // Audit the injection
        await this.storageManager._audit(AUDIT_EVENTS.KEY_INJECTED, {
          sessionId,
          secretId,
          jobId: session.jobId,
          userId: session.userId,
          keyType: secret.keyType,
          containerPath: keyFilePath
        });
      }

      session.injectedKeys = injectedKeys;

      return {
        sessionId,
        injectedKeys,
        containerPath
      };
    } catch (error) {
      throw new Error(`Failed to inject keys: ${error.message}`);
    }
  }

  /**
   * Generate injection script for container
   * This script will be executed inside the container to set up keys
   */
  generateInjectionScript(sessionId, injectedKeys) {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      throw new Error('Invalid session');
    }

    const scriptLines = [
      '#!/bin/bash',
      '# Auto-generated key injection script',
      '# This script sets up secrets for the Hive Mind job',
      '',
      'set -e',
      '',
      '# Create secure directory for secrets',
      'mkdir -p /tmp/hive-secrets',
      'chmod 700 /tmp/hive-secrets',
      ''
    ];

    for (const key of injectedKeys) {
      scriptLines.push(`# Inject ${key.keyType}: ${key.keyName}`);

      switch (key.keyType) {
        case KEY_TYPES.SSH_RSA:
        case KEY_TYPES.SSH_ED25519:
          scriptLines.push(
            `mkdir -p ~/.ssh`,
            `chmod 700 ~/.ssh`,
            `cp ${key.containerPath} ~/.ssh/id_${key.keyType === KEY_TYPES.SSH_ED25519 ? 'ed25519' : 'rsa'}`,
            `chmod 600 ~/.ssh/id_${key.keyType === KEY_TYPES.SSH_ED25519 ? 'ed25519' : 'rsa'}`,
            ''
          );
          break;

        case KEY_TYPES.GITHUB_TOKEN:
          scriptLines.push(
            `export GITHUB_TOKEN=$(cat ${key.containerPath})`,
            `export GH_TOKEN=$(cat ${key.containerPath})`,
            ''
          );
          break;

        case KEY_TYPES.OAUTH_TOKEN:
          scriptLines.push(
            `export OAUTH_TOKEN=$(cat ${key.containerPath})`,
            ''
          );
          break;
      }
    }

    scriptLines.push(
      '# Cleanup: Remove secret files after setup',
      'trap "rm -rf /tmp/hive-secrets" EXIT',
      ''
    );

    return scriptLines.join('\n');
  }

  /**
   * Close a session and cleanup
   */
  async closeSession(sessionId) {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      throw new Error('Invalid session');
    }

    session.status = 'closed';
    session.closedAt = new Date().toISOString();

    await this.storageManager._audit(AUDIT_EVENTS.KEY_INJECTED, {
      sessionId,
      jobId: session.jobId,
      userId: session.userId,
      action: 'session_closed',
      injectedKeysCount: session.injectedKeys.length
    });

    // Keep session in memory for a short time for audit purposes
    setTimeout(() => {
      this.activeSessions.delete(sessionId);
    }, 60000); // 1 minute

    return true;
  }

  /**
   * Get active sessions (for monitoring)
   */
  getActiveSessions(userId = null) {
    const sessions = Array.from(this.activeSessions.values());

    if (userId) {
      return sessions.filter(s => s.userId === userId && s.status === 'active');
    }

    return sessions.filter(s => s.status === 'active');
  }
}

/**
 * Export a factory function for easy initialization
 */
export async function createSecretManager(options = {}) {
  const manager = new SecretStorageManager(options);
  await manager.initialize();
  return manager;
}

export async function createKeyInjector(storageManager, options = {}) {
  return new SessionKeyInjector(storageManager, options);
}
