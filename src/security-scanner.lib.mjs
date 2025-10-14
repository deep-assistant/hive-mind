#!/usr/bin/env node

/**
 * Security Scanner Module
 * Detects potentially dangerous commands or actions in issue text
 * This is a text-only analysis without any execution permissions
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Import shared library functions
const lib = await import('./lib.mjs');
const { log } = lib;

/**
 * Security risk patterns to detect in issue text
 * Each pattern includes:
 * - pattern: regex or string to match
 * - description: what the risk is
 * - severity: 'critical', 'high', 'medium', 'low'
 * - category: type of security risk
 */
const SECURITY_PATTERNS = [
  // SSH Key Discovery and Credential Harvesting
  {
    pattern: /\b(find|search|locate|grep)\b.*\b(ssh.*key|id_rsa|id_dsa|id_ecdsa|id_ed25519|\.ssh)\b/i,
    description: 'Potential SSH key discovery attempt',
    severity: 'critical',
    category: 'credential_harvesting'
  },
  {
    pattern: /\b(find|search|locate|grep)\b.*\b(\.aws|\.config|credentials|\.npmrc|\.pypirc)\b/i,
    description: 'Potential credential file search',
    severity: 'critical',
    category: 'credential_harvesting'
  },
  {
    pattern: /\b(find|search|locate|grep)\b.*\b(password|passwd|secret|token|api[-_]?key)\b/i,
    description: 'Potential password/secret discovery attempt',
    severity: 'critical',
    category: 'credential_harvesting'
  },
  {
    pattern: /\b(cat|read|open|view|reading?|extract)\b.*\b(\.env|\.git-credentials|\.netrc|\.pgpass|env\s+file)\b/i,
    description: 'Attempt to read sensitive configuration files',
    severity: 'critical',
    category: 'credential_harvesting'
  },
  {
    pattern: /\b(search|find|locate|all|every)\b.*\b(wallet|bitcoin|ethereum|metamask|crypto)\b/i,
    description: 'Potential cryptocurrency wallet search',
    severity: 'critical',
    category: 'credential_harvesting'
  },
  {
    pattern: /\b(chrome|firefox|browser).*\b(cookies?|sessions?|credentials?)\b/i,
    description: 'Potential browser credential harvesting',
    severity: 'critical',
    category: 'credential_harvesting'
  },

  // Filesystem Manipulation Outside Project Scope
  {
    pattern: /\b(rm|delete|remove)\b\s+(-rf|-r|-f)\s+(\/|~\/|\$HOME)/i,
    description: 'Dangerous recursive deletion outside project directory',
    severity: 'critical',
    category: 'filesystem_manipulation'
  },
  {
    pattern: /\b(find|search)\b.*\/(home|root|etc|var|usr)\b.*\b(delete|remove|rm)\b/i,
    description: 'System-wide file search with deletion intent',
    severity: 'critical',
    category: 'filesystem_manipulation'
  },
  {
    pattern: /\b(chmod|chown)\b.*\b(777|666)\b.*\/(etc|var|usr|home|root)/i,
    description: 'Dangerous permission changes on system directories',
    severity: 'critical',
    category: 'filesystem_manipulation'
  },
  {
    pattern: /\b(mv|cp|rsync)\b.*\/(etc|var|usr|home|root)\b/i,
    description: 'Modifying files in system directories',
    severity: 'high',
    category: 'filesystem_manipulation'
  },

  // Command Execution and System Compromise
  {
    pattern: /\b(curl|wget)\b.*\|\s*(bash|sh|python|perl|ruby)/i,
    description: 'Downloading and executing remote code',
    severity: 'critical',
    category: 'remote_code_execution'
  },
  {
    pattern: /\b(nc|netcat|ncat)\b.*\b(-e|--exec|-c|\/bin\/(ba)?sh)\b/i,
    description: 'Potential reverse shell or backdoor',
    severity: 'critical',
    category: 'remote_code_execution'
  },
  {
    pattern: /\b(eval|exec)\b.*\$\(/i,
    description: 'Dynamic command execution with variable substitution',
    severity: 'high',
    category: 'remote_code_execution'
  },
  {
    pattern: /\b(sudo|su)\b.*\b(rm|dd|mkfs|fdisk)\b/i,
    description: 'Privileged destructive commands',
    severity: 'critical',
    category: 'privilege_escalation'
  },
  {
    pattern: /\b(crontab|at|systemctl|service)\b.*\b(curl|wget|nc|netcat)\b/i,
    description: 'Scheduling network commands for persistence',
    severity: 'critical',
    category: 'persistence'
  },

  // Network and Exfiltration Attempts
  {
    pattern: /\b(scp|rsync|ftp|sftp)\b.*\b(\/home|\/root|\/etc|\.ssh|directory|folder)\b/i,
    description: 'Potential data exfiltration',
    severity: 'critical',
    category: 'data_exfiltration'
  },
  {
    pattern: /\b(curl|wget)\b.*\b(POST|PUT)\b.*\b(password|secret|key|token)\b/i,
    description: 'Potential credential exfiltration via HTTP',
    severity: 'critical',
    category: 'data_exfiltration'
  },
  {
    pattern: /\b(tar|zip|7z)\b.*\b(\/home|\/root|\.ssh|\.aws|\.config)\b.*\|\s*(curl|wget|nc)/i,
    description: 'Archiving and sending sensitive directories',
    severity: 'critical',
    category: 'data_exfiltration'
  },

  // Docker and Container Escapes
  {
    pattern: /docker.*run.*\b(--privileged|--cap-add=ALL)\b/i,
    description: 'Docker container with dangerous privileges',
    severity: 'high',
    category: 'container_escape'
  },
  {
    pattern: /docker.*\b(-v|--volume)\b.*\/(:|\/etc|\/var|\/home)/i,
    description: 'Mounting sensitive host directories in container',
    severity: 'high',
    category: 'container_escape'
  },

  // Process and Memory Manipulation
  {
    pattern: /\b(kill|killall|pkill)\b.*\b(-9|-KILL)\b.*\b(ssh|sshd|systemd|init)/i,
    description: 'Killing critical system processes',
    severity: 'high',
    category: 'system_disruption'
  },
  {
    pattern: /\b(gdb|strace|ltrace)\b.*\b(attach|--pid)/i,
    description: 'Process debugging to extract sensitive data',
    severity: 'high',
    category: 'process_manipulation'
  },

  // Environment Variable Manipulation
  {
    pattern: /\b(export|set|setting?)\b.*\b(LD_PRELOAD|LD_LIBRARY_PATH|PATH)\b.*\b(\/tmp|\/dev\/shm|inject|evil|malicious)/i,
    description: 'Environment variable manipulation for code injection',
    severity: 'high',
    category: 'code_injection'
  },

  // Suspicious Obfuscation Techniques
  {
    pattern: /\b(base64|xxd|uuencode)\b.*\b(-d|--decode|decode)\b.*\|\s*(bash|sh|python)/i,
    description: 'Decoding and executing obfuscated commands',
    severity: 'high',
    category: 'obfuscation'
  },
  {
    pattern: /echo.*\|\s*base64\s+(-d|--decode)\s*\|\s*(bash|sh|python)/i,
    description: 'Piping encoded data to shell execution',
    severity: 'high',
    category: 'obfuscation'
  },
  {
    pattern: /echo\s+[A-Za-z0-9+/=]{50,}\s*\|\s*base64/i,
    description: 'Suspiciously long base64-encoded data',
    severity: 'medium',
    category: 'obfuscation'
  }
];

/**
 * Additional context-based risk indicators
 * These are phrases that, while not immediately dangerous,
 * indicate potential malicious intent when combined with other patterns
 */
const CONTEXT_INDICATORS = [
  {
    pattern: /\b(bypass|circumvent|evade|avoid)\b.*\b(security|restriction|permission|protection)\b/i,
    description: 'Intent to bypass security measures',
    severity: 'medium',
    category: 'suspicious_intent'
  },
  {
    pattern: /\b(hide|conceal|obfuscate)\b.*\b(track|log|audit|evidence)\b/i,
    description: 'Intent to hide actions from logging',
    severity: 'medium',
    category: 'suspicious_intent'
  },
  {
    pattern: /\b(escalate|elevate)\b.*\b(privilege|permission|access|rights)\b/i,
    description: 'Privilege escalation intent',
    severity: 'medium',
    category: 'suspicious_intent'
  },
  {
    pattern: /\b(entire|whole|all)\b.*\b(system|filesystem|disk)\b.*\b(search|scan|find)\b/i,
    description: 'System-wide search beyond project scope',
    severity: 'medium',
    category: 'scope_violation'
  }
];

/**
 * Scan text for security risks
 * @param {string} text - Text to scan (issue body, comments, etc.)
 * @param {Object} options - Scanning options
 * @param {boolean} options.includeContext - Include context indicators in scan
 * @param {boolean} options.verbose - Log detailed findings
 * @returns {Object} Scan results
 */
export const scanForSecurityRisks = (text, options = {}) => {
  const { includeContext = true, verbose = false } = options;

  if (!text || typeof text !== 'string') {
    return {
      safe: true,
      risks: [],
      riskCount: 0,
      maxSeverity: null
    };
  }

  const risks = [];
  const severityLevels = { critical: 4, high: 3, medium: 2, low: 1 };

  // Scan primary security patterns
  for (const pattern of SECURITY_PATTERNS) {
    const matches = text.match(pattern.pattern);
    if (matches) {
      risks.push({
        pattern: pattern.pattern.toString(),
        description: pattern.description,
        severity: pattern.severity,
        category: pattern.category,
        matchedText: matches[0],
        type: 'security_pattern'
      });
    }
  }

  // Scan context indicators if enabled
  if (includeContext) {
    for (const indicator of CONTEXT_INDICATORS) {
      const matches = text.match(indicator.pattern);
      if (matches) {
        risks.push({
          pattern: indicator.pattern.toString(),
          description: indicator.description,
          severity: indicator.severity,
          category: indicator.category,
          matchedText: matches[0],
          type: 'context_indicator'
        });
      }
    }
  }

  // Determine maximum severity
  let maxSeverity = null;
  let maxSeverityLevel = 0;

  for (const risk of risks) {
    const level = severityLevels[risk.severity] || 0;
    if (level > maxSeverityLevel) {
      maxSeverityLevel = level;
      maxSeverity = risk.severity;
    }
  }

  const safe = risks.length === 0;

  return {
    safe,
    risks,
    riskCount: risks.length,
    maxSeverity,
    criticalCount: risks.filter(r => r.severity === 'critical').length,
    highCount: risks.filter(r => r.severity === 'high').length,
    mediumCount: risks.filter(r => r.severity === 'medium').length,
    lowCount: risks.filter(r => r.severity === 'low').length
  };
};

/**
 * Format security scan results for display
 * @param {Object} scanResult - Result from scanForSecurityRisks
 * @returns {string[]} Formatted lines for display
 */
export const formatSecurityScanResults = (scanResult) => {
  const lines = [];

  if (scanResult.safe) {
    lines.push('✅ Security Scan: No risks detected');
    return lines;
  }

  const severityEmoji = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🔵'
  };

  lines.push('');
  lines.push('⚠️  SECURITY SCAN ALERT: Potential risks detected in issue text');
  lines.push('');
  lines.push(`   Total risks found: ${scanResult.riskCount}`);

  if (scanResult.criticalCount > 0) {
    lines.push(`   ${severityEmoji.critical} Critical: ${scanResult.criticalCount}`);
  }
  if (scanResult.highCount > 0) {
    lines.push(`   ${severityEmoji.high} High: ${scanResult.highCount}`);
  }
  if (scanResult.mediumCount > 0) {
    lines.push(`   ${severityEmoji.medium} Medium: ${scanResult.mediumCount}`);
  }
  if (scanResult.lowCount > 0) {
    lines.push(`   ${severityEmoji.low} Low: ${scanResult.lowCount}`);
  }

  lines.push('');
  lines.push('   Detected risks:');
  lines.push('');

  // Group risks by severity
  const risksBySeverity = {
    critical: [],
    high: [],
    medium: [],
    low: []
  };

  for (const risk of scanResult.risks) {
    risksBySeverity[risk.severity].push(risk);
  }

  // Display risks by severity (critical first)
  for (const severity of ['critical', 'high', 'medium', 'low']) {
    const risks = risksBySeverity[severity];
    if (risks.length > 0) {
      for (const risk of risks) {
        lines.push(`   ${severityEmoji[severity]} [${severity.toUpperCase()}] ${risk.description}`);
        lines.push(`      Category: ${risk.category}`);
        lines.push(`      Matched text: "${risk.matchedText.substring(0, 100)}${risk.matchedText.length > 100 ? '...' : ''}"`);
        lines.push('');
      }
    }
  }

  return lines;
};

/**
 * Log security scan results
 * @param {Object} scanResult - Result from scanForSecurityRisks
 * @param {Object} options - Logging options
 */
export const logSecurityScanResults = async (scanResult, options = {}) => {
  const lines = formatSecurityScanResults(scanResult);

  for (const line of lines) {
    if (line.includes('SECURITY SCAN ALERT')) {
      await log(line, { level: 'warning' });
    } else if (line.includes('CRITICAL') || line.includes('🔴')) {
      await log(line, { level: 'error' });
    } else if (line.includes('HIGH') || line.includes('🟠')) {
      await log(line, { level: 'warning' });
    } else {
      await log(line);
    }
  }
};

/**
 * Scan GitHub issue for security risks
 * @param {string} issueText - Issue body and title text
 * @param {string[]} comments - Array of issue comment texts
 * @param {Object} options - Scanning options
 * @returns {Object} Combined scan results
 */
export const scanGitHubIssue = (issueText, comments = [], options = {}) => {
  // Scan issue body
  const issueResult = scanForSecurityRisks(issueText, options);

  // Scan comments
  const commentResults = comments.map(comment =>
    scanForSecurityRisks(comment, options)
  );

  // Combine all risks
  const allRisks = [
    ...issueResult.risks.map(r => ({ ...r, source: 'issue_body' })),
    ...commentResults.flatMap((result, index) =>
      result.risks.map(r => ({ ...r, source: `comment_${index + 1}` }))
    )
  ];

  // Calculate combined statistics
  const safe = allRisks.length === 0;
  const severityLevels = { critical: 4, high: 3, medium: 2, low: 1 };
  let maxSeverity = null;
  let maxSeverityLevel = 0;

  for (const risk of allRisks) {
    const level = severityLevels[risk.severity] || 0;
    if (level > maxSeverityLevel) {
      maxSeverityLevel = level;
      maxSeverity = risk.severity;
    }
  }

  return {
    safe,
    risks: allRisks,
    riskCount: allRisks.length,
    maxSeverity,
    criticalCount: allRisks.filter(r => r.severity === 'critical').length,
    highCount: allRisks.filter(r => r.severity === 'high').length,
    mediumCount: allRisks.filter(r => r.severity === 'medium').length,
    lowCount: allRisks.filter(r => r.severity === 'low').length,
    issueResult,
    commentResults
  };
};

/**
 * Check if scan results should block execution
 * @param {Object} scanResult - Result from scanForSecurityRisks or scanGitHubIssue
 * @param {Object} options - Blocking policy options
 * @returns {boolean} True if should block, false otherwise
 */
export const shouldBlockExecution = (scanResult, options = {}) => {
  const {
    blockOnCritical = true,
    blockOnHigh = false,
    blockOnMedium = false,
    minRiskCount = 1
  } = options;

  if (scanResult.safe) {
    return false;
  }

  // Block if critical risks found and policy says to block on critical
  if (blockOnCritical && scanResult.criticalCount > 0) {
    return true;
  }

  // Block if high risks found and policy says to block on high
  if (blockOnHigh && scanResult.highCount > 0) {
    return true;
  }

  // Block if medium risks found and policy says to block on medium
  if (blockOnMedium && scanResult.mediumCount > 0) {
    return true;
  }

  // Block if total risk count exceeds threshold
  if (scanResult.riskCount >= minRiskCount && (blockOnCritical || blockOnHigh || blockOnMedium)) {
    return true;
  }

  return false;
};

// Export all functions
export default {
  scanForSecurityRisks,
  formatSecurityScanResults,
  logSecurityScanResults,
  scanGitHubIssue,
  shouldBlockExecution,
  SECURITY_PATTERNS,
  CONTEXT_INDICATORS
};
