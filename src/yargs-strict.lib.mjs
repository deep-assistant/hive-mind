// Yargs strict options validation library
// This module provides utilities to enforce strict option validation in yargs
// to prevent unrecognized options from being silently ignored

/**
 * Helper to check if a string looks like it was meant to be an option
 * This catches various dash characters including em-dash, en-dash, etc.
 * @param {string} str - String to check
 * @returns {boolean} - True if string looks like an option
 */
export const looksLikeOption = (str) => {
  // Match various dash characters (hyphen-minus \u002D, en-dash \u2013, em-dash \u2014, etc.)
  return /^[\u002D\u2010\u2011\u2012\u2013\u2014]+[a-zA-Z]/.test(str);
};

/**
 * Helper to check if a string looks like a URL
 * @param {string} str - String to check
 * @returns {boolean} - True if string looks like a URL
 */
export const looksLikeUrl = (str) => {
  // Check for common URL patterns: http://, https://, ftp://, etc.
  return /^[a-z]+:\/\//.test(str);
};

/**
 * Creates a yargs check function that validates against explicitly defined options
 * @param {Set<string>} definedOptions - Set of explicitly defined option names (including aliases)
 * @param {boolean} exitOnError - Whether to exit process on error (default: false, throw instead)
 * @returns {Function} - Check function for yargs
 */
export const createStrictOptionsCheck = (definedOptions, exitOnError = false) => {
  return (argv) => {
    const errors = [];

    // Check argv keys against our explicitly defined options
    for (const key of Object.keys(argv)) {
      // Skip special keys
      if (key === '_' || key === '$0') continue;

      // Skip keys that look like URLs (yargs parses https://... as --https://...)
      if (looksLikeUrl(key)) continue;

      // Check if this key is in our defined options or is a variant (--key, etc.)
      const normalizedKey = key.replace(/^-+/, '');

      if (!definedOptions.has(key) && !definedOptions.has(normalizedKey)) {
        errors.push(`Unknown option: ${key}`);
      }
    }

    // Check for positional arguments that look like options
    if (argv._ && Array.isArray(argv._)) {
      for (const arg of argv._) {
        if (typeof arg === 'string' && looksLikeOption(arg)) {
          errors.push(`Unrecognized option: ${arg}`);
        }
      }
    }

    if (errors.length > 0) {
      const errorMessage = errors.join('\n');
      if (exitOnError) {
        console.error(errorMessage);
        process.exit(1);
      } else {
        throw new Error(errorMessage);
      }
    }

    return true;
  };
};

/**
 * Validates argv against defined options and exits with error if invalid
 * This should be called AFTER argv is parsed and initial logging is done
 * @param {object} argv - Parsed argv object
 * @param {Set<string>} definedOptions - Set of explicitly defined option names
 */
export const validateStrictOptions = (argv, definedOptions) => {
  try {
    createStrictOptionsCheck(definedOptions, false)(argv);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
};

/**
 * Wrapper around yargs instance to make it easy to add strict options validation
 * Usage:
 *   const strictYargs = withStrictOptions(yargs(args));
 *   strictYargs.option('foo', { ... });
 *   strictYargs.finalize(); // Adds the check
 *
 * @param {object} yargsInstance - Yargs instance
 * @returns {object} - Wrapped yargs instance with finalize() method
 */
export const withStrictOptions = (yargsInstance) => {
  const definedOptions = new Set(['help', 'version', 'h', '_', '$0']);

  // Wrap the option() method to track defined options
  const originalOption = yargsInstance.option.bind(yargsInstance);
  yargsInstance.option = function(key, config) {
    definedOptions.add(key);
    if (config?.alias) {
      if (Array.isArray(config.alias)) {
        config.alias.forEach(a => definedOptions.add(a));
      } else {
        definedOptions.add(config.alias);
      }
    }
    return originalOption(key, config);
  };

  // Add finalize method to add the strict check
  yargsInstance.finalize = function() {
    return this.check(createStrictOptionsCheck(definedOptions));
  };

  return yargsInstance;
};

/**
 * Applies strict options validation to an existing yargs config
 * This should be called after all options are defined
 *
 * @param {object} yargsInstance - Yargs instance
 * @param {Array<string>} optionNames - Array of option names (including aliases)
 * @returns {object} - Yargs instance with strict check added
 */
export const applyStrictOptions = (yargsInstance, optionNames) => {
  const definedOptions = new Set(['help', 'version', 'h', '_', '$0', ...optionNames]);
  return yargsInstance.check(createStrictOptionsCheck(definedOptions));
};
