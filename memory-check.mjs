#!/usr/bin/env node

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

// Temporarily unset CI to avoid command-stream trace logs
const originalCI = process.env.CI;
delete process.env.CI;

const { $ } = await use('command-stream');
// Create a silent version of $ that doesn't mirror output to stdout
// Note: command-stream may still emit trace logs to stderr in some environments
// These are filtered out by consuming code when parsing JSON
const $silent = $({ mirror: false, capture: true });

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');
const fs = (await use('fs')).promises;

// Import log function from lib.mjs
const lib = await import('./lib.mjs');
const { log: libLog, setLogFile } = lib;

// Function to check available disk space
export const checkDiskSpace = async (minSpaceMB = 500, options = {}) => {
  const { log = libLog } = options;
  
  try {
    let availableMB;
    
    if (process.platform === 'darwin') {
      // macOS: use df -m (megabytes) and get the 4th column
      const { stdout } = await $silent`df -m . 2>/dev/null | tail -1 | awk '{print $4}'`;
      availableMB = parseInt(stdout.toString().trim());
    } else {
      // Linux: use df -BM and get the 4th column  
      const { stdout } = await $silent`df -BM . 2>/dev/null | tail -1 | awk '{print $4}'`;
      availableMB = parseInt(stdout.toString().replace('M', ''));
    }
    
    if (isNaN(availableMB)) {
      await log(`❌ Failed to parse disk space information`);
      return { success: false, availableMB: 0, error: 'Failed to parse disk space' };
    }
    
    if (availableMB < minSpaceMB) {
      await log(`❌ Insufficient disk space: ${availableMB}MB available, ${minSpaceMB}MB required`);
      await log('   This may prevent successful operations.');
      await log('   Please free up disk space and try again.');
      return { success: false, availableMB, required: minSpaceMB };
    }
    
    await log(`💾 Disk space check: ${availableMB}MB available (${minSpaceMB}MB required) ✅`);
    return { success: true, availableMB, required: minSpaceMB };
  } catch (error) {
    await log(`❌ Could not check disk space: ${error.message}`);
    return { success: false, availableMB: 0, error: error.message };
  }
};

// Function to check available RAM (volatile memory)
export const checkRAM = async (minMemoryMB = 256, options = {}) => {
  const { log = libLog } = options;
  
  // Check platform first
  if (process.platform === 'darwin') {
    // macOS RAM check using vm_stat
    try {
      const { stdout: vmStatOutput } = await $silent`vm_stat 2>/dev/null`;
      
      // Parse page size
      const pageSizeMatch = vmStatOutput.toString().match(/page size of (\d+) bytes/);
      const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1]) : 16384; // Default to 16KB
      
      // Parse free pages (handle dots in numbers like "6009.")
      const freeMatch = vmStatOutput.toString().match(/Pages free:\s+([\d.]+)/);
      const freePages = freeMatch ? parseInt(freeMatch[1].replace(/\./g, '')) : 0;
      
      // Parse inactive pages (can be reclaimed)
      const inactiveMatch = vmStatOutput.toString().match(/Pages inactive:\s+([\d.]+)/);
      const inactivePages = inactiveMatch ? parseInt(inactiveMatch[1].replace(/\./g, '')) : 0;
      
      // Parse purgeable pages (can be freed)
      const purgeableMatch = vmStatOutput.toString().match(/Pages purgeable:\s+([\d.]+)/);
      const purgeablePages = purgeableMatch ? parseInt(purgeableMatch[1].replace(/\./g, '')) : 0;
      
      // Calculate available memory (free + inactive + purgeable)
      const availablePages = freePages + inactivePages + purgeablePages;
      const availableBytes = availablePages * pageSize;
      const availableMB = Math.floor(availableBytes / (1024 * 1024));
      
      // Check swap status
      const { stdout: swapEnabledOutput } = await $silent`sysctl vm.swap_enabled 2>/dev/null`;
      const swapEnabled = swapEnabledOutput.toString().includes('1');
      
      // Get swap usage details
      const { stdout: swapUsageOutput } = await $silent`sysctl vm.swapusage 2>/dev/null`;
      
      // Parse swap info
      const swapMatch = swapUsageOutput.toString().match(/total = ([\d.]+)M\s+used = ([\d.]+)M/);
      const swapTotal = swapMatch ? parseFloat(swapMatch[1]) : 0;
      const swapUsed = swapMatch ? parseFloat(swapMatch[2]) : 0;
      
      let swapInfo;
      if (swapEnabled) {
        if (swapTotal > 0) {
          swapInfo = `${Math.round(swapTotal)}MB (${Math.round(swapUsed)}MB used)`;
        } else {
          swapInfo = 'enabled (dynamic allocation)';
        }
      } else {
        swapInfo = 'disabled';
      }
      
      if (availableMB < minMemoryMB) {
        await log(`❌ Insufficient memory: ${availableMB}MB available, ${minMemoryMB}MB required`);
        
        if (!swapEnabled) {
          await log('   Swap is disabled. Consider enabling swap:');
          await log('   sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.dynamic_pager.plist');
        }
        
        return { success: false, availableMB, required: minMemoryMB, swap: swapInfo };
      }
      
      await log(`🧠 Memory check: ${availableMB}MB available, swap: ${swapInfo}`);
      return { success: true, availableMB, required: minMemoryMB, swap: swapInfo };
      
    } catch (error) {
      await log(`❌ macOS memory check failed: ${error.message}`);
      return { success: false, availableMB: 0, error: error.message };
    }
  } else {
    // Linux memory check using /proc/meminfo
    try {
      const meminfoContent = await fs.readFile('/proc/meminfo', 'utf8');
      const lines = meminfoContent.split('\n');
      
      const getValue = (key) => {
        const line = lines.find(l => l.startsWith(key));
        if (!line) return 0;
        const match = line.match(/(\d+)/);
        return match ? parseInt(match[1]) : 0;
      };
      
      // Get memory values in KB
      const memFree = getValue('MemFree:');
      const buffers = getValue('Buffers:');
      const cached = getValue('Cached:');
      const sReclaimable = getValue('SReclaimable:');
      const swapTotal = getValue('SwapTotal:');
      const swapFree = getValue('SwapFree:');
      
      // Calculate available memory (similar to 'free' command)
      const availableKB = memFree + buffers + cached + sReclaimable;
      const availableMB = Math.floor(availableKB / 1024);
      
      // Calculate swap info
      const swapUsedKB = swapTotal - swapFree;
      const swapMB = Math.floor(swapTotal / 1024);
      const swapUsedMB = Math.floor(swapUsedKB / 1024);
      
      let swapInfo;
      if (swapTotal > 0) {
        swapInfo = `${swapMB}MB (${swapUsedMB}MB used)`;
      } else {
        swapInfo = 'none';
      }
      
      if (availableMB < minMemoryMB) {
        await log(`❌ Insufficient memory: ${availableMB}MB available, ${minMemoryMB}MB required`);
        
        if (swapTotal === 0) {
          await log('   No swap configured. Consider adding swap:');
          await log('   sudo fallocate -l 2G /swapfile');
          await log('   sudo chmod 600 /swapfile');
          await log('   sudo mkswap /swapfile');
          await log('   sudo swapon /swapfile');
          await log('   echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab');
        }
        
        return { success: false, availableMB, required: minMemoryMB, swap: swapInfo };
      }
      
      await log(`🧠 Memory check: ${availableMB}MB available, swap: ${swapInfo}`);
      return { success: true, availableMB, required: minMemoryMB, swap: swapInfo };
      
    } catch (error) {
      await log(`❌ Linux memory check failed: ${error.message}`);
      return { success: false, availableMB: 0, error: error.message };
    }
  }
};

// Keep checkMemory as an alias for checkRAM for backward compatibility
export const checkMemory = checkRAM;

// Function to get system resource snapshot
export const getResourceSnapshot = async () => {
  try {
    if (process.platform === 'darwin') {
      // macOS resource snapshot
      const vmStat = await $silent`vm_stat 2>/dev/null | head -10`;
      const uptime = await $silent`uptime 2>/dev/null`;
      const swap = await $silent`sysctl vm.swapusage 2>/dev/null`;
      
      return {
        timestamp: new Date().toISOString(),
        memory: vmStat.stdout.toString().trim(),
        swap: swap.stdout.toString().trim(),
        uptime: uptime.stdout.toString().trim()
      };
    } else {
      // Linux resource snapshot
      const memInfo = await $silent`cat /proc/meminfo 2>/dev/null | grep -E "MemTotal|MemAvailable|MemFree|SwapTotal|SwapFree"`;
      const loadAvg = await $silent`cat /proc/loadavg 2>/dev/null`;
      const uptime = await $silent`uptime 2>/dev/null`;
      
      return {
        timestamp: new Date().toISOString(),
        memory: memInfo.stdout.toString().trim(),
        load: loadAvg.stdout.toString().trim(),
        uptime: uptime.stdout.toString().trim()
      };
    }
  } catch (error) {
    return {
      timestamp: new Date().toISOString(),
      error: `Failed to get resource snapshot: ${error.message}`
    };
  }
};

// Combined system check function
export const checkSystem = async (requirements = {}, options = {}) => {
  const {
    minMemoryMB = 256,
    minDiskSpaceMB = 500,
    exitOnFailure = false
  } = requirements;
  
  const { log = libLog } = options;
  
  const results = {
    ram: null,
    disk: null,
    success: true
  };
  
  // Check disk space (persistent memory)
  results.disk = await checkDiskSpace(minDiskSpaceMB, options);
  if (!results.disk.success) {
    results.success = false;
    if (exitOnFailure) {
      process.exit(1);
    }
  }
  
  // Check RAM (volatile memory)
  results.ram = await checkRAM(minMemoryMB, options);
  if (!results.ram.success) {
    results.success = false;
    if (exitOnFailure) {
      process.exit(1);
    }
  }
  
  return results;
};

// CLI interface when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  
  // Create yargs instance with all options
  const yargsInstance = yargs(hideBin(process.argv))
    .scriptName('memory-check.mjs')
    .usage('Usage: $0 [options]')
    .option('min-memory', {
      alias: 'm',
      type: 'number',
      description: 'Minimum required memory in MB',
      default: 256
    })
    .option('min-disk-space', {
      alias: 'd',
      type: 'number',
      description: 'Minimum required disk space in MB',
      default: 500
    })
    .option('exit-on-failure', {
      alias: 'e',
      type: 'boolean',
      description: 'Exit with code 1 if any check fails',
      default: false
    })
    .option('json', {
      alias: 'j',
      type: 'boolean',
      description: 'Output results as JSON',
      default: false
    })
    .option('quiet', {
      alias: 'q',
      type: 'boolean',
      description: 'Suppress detailed output (only show final status)',
      default: false
    })
    .option('log-file', {
      alias: 'l',
      type: 'string',
      description: 'Path to log file for output'
    })
    .help('h')
    .alias('h', 'help');
  
  // Check for help before parsing
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    yargsInstance.showHelp();
    process.exit(0);
  }
  
  const argv = await yargsInstance.parseAsync();
  
  // If we get here, help wasn't requested or yargs didn't handle it
  // Set up logging based on options
  if (argv.logFile) {
    setLogFile(argv.logFile);
  }
  
  // Create appropriate log function based on quiet mode
  const log = argv.quiet ? async () => {} : libLog;
  
  const results = await checkSystem(
    {
      minMemoryMB: argv.minMemory,
      minDiskSpaceMB: argv.minDiskSpace,
      exitOnFailure: argv.exitOnFailure
    },
    { log }
  );
  
  if (argv.json) {
    console.log(JSON.stringify(results, null, 2));
  } else if (!argv.quiet) {
    console.log('\n📊 System Check Summary:');
    console.log('─'.repeat(40));
    console.log(`RAM:    ${results.ram.success ? '✅' : '❌'} ${results.ram.availableMB}MB available (${results.ram.required}MB required)`);
    console.log(`Disk:   ${results.disk.success ? '✅' : '❌'} ${results.disk.availableMB}MB available (${results.disk.required}MB required)`);
    console.log(`Overall: ${results.success ? '✅ All checks passed' : '❌ Some checks failed'}`);
  }
  
  if (!results.success && argv.exitOnFailure) {
    process.exit(1);
  }
}

// Restore CI if it was set (at the very end, after yargs has processed everything)
if (originalCI !== undefined) {
  process.env.CI = originalCI;
}