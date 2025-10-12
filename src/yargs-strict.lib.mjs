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
 * Helper to convert between camelCase and kebab-case
 */
const toKebabCase = (str) => {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
};

const toCamelCase = (str) => {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
};

/**
 * Check if a string uses non-standard dash characters (em-dash, en-dash, etc.)
 * @param {string} str - String to check
 * @returns {boolean} - True if string uses non-standard dashes
 */
const hasNonStandardDashes = (str) => {
  // Check for non-standard dash characters (not hyphen-minus \u002D)
  return /[\u2010\u2011\u2012\u2013\u2014]/.test(str);
};

/**
 * Parse raw command line arguments to extract option flags (not values)
 * This mimics how yargs parses arguments to identify actual option flags
 * @param {Array<string>} rawArgs - Raw command line arguments (e.g., process.argv.slice(2))
 * @returns {Set<string>} - Set of option flags found in raw arguments
 */
export const parseRawOptionsFromArgs = (rawArgs) => {
  const optionFlags = new Set();

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    // Skip non-option arguments (positional arguments, values, etc.)
    // Use looksLikeOption to catch various dash characters (em-dash, en-dash, etc.)
    if (!looksLikeOption(arg)) {
      continue;
    }

    // If the option uses non-standard dashes (em-dash, en-dash, etc.),
    // keep the raw form to flag it as invalid later
    // This catches typos like —fork (em-dash) instead of --fork
    if (hasNonStandardDashes(arg)) {
      // Keep the full option with non-standard dashes to flag as error
      const withoutValue = arg.includes('=') ? arg.split('=')[0] : arg;
      optionFlags.add(withoutValue);
      continue;
    }

    // Handle --option=value format (standard dashes only)
    if (arg.includes('=')) {
      const [optionPart] = arg.split('=');
      // Remove standard dashes from the start
      const normalized = optionPart.replace(/^-+/, '');
      optionFlags.add(normalized);
      continue;
    }

    // Regular option flag (--option or -o with standard dashes)
    // Remove standard dashes from the start
    const normalized = arg.replace(/^-+/, '');
    optionFlags.add(normalized);

    // The next argument might be the value for this option, but we don't need to track it
    // We only care about validating option flags, not their values
  }

  return optionFlags;
};

/**
 * Creates a yargs check function that validates against explicitly defined options
 * Uses raw argument parsing to avoid false positives from yargs internal quirks
 * @param {Set<string>} definedOptions - Set of explicitly defined option names (including aliases)
 * @param {boolean} exitOnError - Whether to exit process on error (default: false, throw instead)
 * @returns {Function} - Check function for yargs
 */
export const createStrictOptionsCheck = (definedOptions, exitOnError = false) => {
  return (argv) => {
    const seenErrors = new Set(); // Track unique errors to avoid duplicates
    const seenNormalized = new Set(); // Track normalized forms to avoid duplicate reporting

    // Parse raw arguments to get actual option flags (not values)
    // Use process.argv.slice(2) to skip 'node' and script name
    const rawArgs = process.argv.slice(2);
    const actualOptionFlags = parseRawOptionsFromArgs(rawArgs);

    // Validate each actual option flag against defined options
    for (const optionFlag of actualOptionFlags) {
      // Skip URLs (e.g., https://... might look like an option)
      if (looksLikeUrl(`--${optionFlag}`)) continue;

      // Check both the option itself and its normalized forms
      const kebabForm = toKebabCase(optionFlag);
      const camelForm = toCamelCase(optionFlag);

      // Check if this option (or any of its variants) is defined
      const isDefined = definedOptions.has(optionFlag) ||
                       definedOptions.has(kebabForm) ||
                       definedOptions.has(camelForm);

      if (!isDefined) {
        // Only report each unique option once (avoid duplicate kebab/camel errors)
        if (!seenNormalized.has(kebabForm) && !seenNormalized.has(camelForm)) {
          // Prefer kebab-case for error messages (more readable)
          const errorKey = optionFlag.includes('-') ? optionFlag : kebabForm;
          seenErrors.add(errorKey);
          seenNormalized.add(kebabForm);
          seenNormalized.add(camelForm);
        }
      }
    }

    // Check for positional arguments that look like options
    if (argv._ && Array.isArray(argv._)) {
      for (const arg of argv._) {
        if (typeof arg === 'string' && looksLikeOption(arg)) {
          seenErrors.add(arg);
        }
      }
    }

    if (seenErrors.size > 0) {
      const errors = Array.from(seenErrors).map(key => `Unknown option: ${key}`);
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
