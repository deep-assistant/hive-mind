#!/usr/bin/env node

// Test using .check() to manually reject unknown options

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

const testArg = process.argv[2] || '--invalid-option';
console.log(`Testing .check() for unknown options: ${testArg}\n`);

try {
  const argv = yargs([testArg])
    .option('fork', {
      type: 'boolean',
      description: 'Fork the repository',
      alias: 'f',
      default: false
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Enable verbose logging',
      alias: 'v',
      default: false
    })
    .check((argv) => {
      // Get all known options (including all possible representations)
      const knownOptions = new Set([
        'fork', 'f', '--fork', '-f',
        'verbose', 'v', '--verbose', '-v',
        'help', 'h', '--help', '-h',
        'version', '--version',
        '_', '$0'
      ]);

      // Check for unknown options
      const unknownOptions = Object.keys(argv).filter(key => {
        // Skip camelCase versions of known dashed options
        if (key === 'fork' || key === 'verbose') return false;
        return !knownOptions.has(key);
      });

      if (unknownOptions.length > 0) {
        throw new Error(`Unknown option(s): ${unknownOptions.join(', ')}`);
      }

      return true;
    })
    .fail((msg, err, yargs) => {
      console.error('❌ Validation Error:');
      console.error(msg);
      process.exit(1);
    })
    .argv;

  console.log('✅ Parsing succeeded:');
  console.log('   fork:', argv.fork);
  console.log('   verbose:', argv.verbose);
  console.log('   _:', argv._);

} catch (error) {
  console.error('❌ Caught error:', error.message);
  process.exit(1);
}
