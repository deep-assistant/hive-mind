#!/usr/bin/env node

// Wikifunctions Skills Integration for Hive Mind
// Provides AI skills by leveraging https://www.wikifunctions.org functions

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

const https = (await use('https')).default;
const { URL } = (await use('url')).default;

class WikifunctionsSkills {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'https://www.wikifunctions.org/w/api.php';
    this.timeout = options.timeout || 30000;
    this.cache = new Map();
    this.cacheTTL = options.cacheTTL || 300000; // 5 minutes default
  }

  /**
   * Fetch a function definition from Wikifunctions
   * @param {string} zid - The function identifier (e.g., 'Z801')
   * @returns {Promise<Object>} Function definition
   */
  async fetchFunction(zid) {
    const cacheKey = `fetch_${zid}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    const url = new URL(this.baseUrl);
    url.searchParams.set('action', 'wikilambda_fetch');
    url.searchParams.set('zids', zid);
    url.searchParams.set('format', 'json');

    try {
      const response = await this.makeRequest(url);
      const result = response.success ? response : { error: 'Failed to fetch function' };
      
      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    } catch (error) {
      throw new Error(`Failed to fetch function ${zid}: ${error.message}`);
    }
  }

  /**
   * Run a function with given arguments
   * @param {string} zid - The function identifier
   * @param {Object} args - Function arguments
   * @returns {Promise<Object>} Function execution result
   */
  async runFunction(zid, args = {}) {
    const url = new URL(this.baseUrl);
    url.searchParams.set('action', 'wikilambda_run');
    url.searchParams.set('wikilambda_function_call', JSON.stringify({
      Z1K1: 'Z7',
      Z7K1: zid,
      ...args
    }));
    url.searchParams.set('format', 'json');

    try {
      const response = await this.makeRequest(url);
      return response;
    } catch (error) {
      throw new Error(`Failed to run function ${zid}: ${error.message}`);
    }
  }

  /**
   * Search for functions by keyword
   * @param {string} query - Search query
   * @param {number} limit - Number of results to return
   * @returns {Promise<Array>} Array of matching functions
   */
  async searchFunctions(query, limit = 10) {
    const cacheKey = `search_${query}_${limit}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    const url = new URL(this.baseUrl);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('srnamespace', '0');
    url.searchParams.set('srlimit', limit.toString());
    url.searchParams.set('format', 'json');

    try {
      const response = await this.makeRequest(url);
      const results = response.query?.search || [];
      
      this.cache.set(cacheKey, { data: results, timestamp: Date.now() });
      return results;
    } catch (error) {
      throw new Error(`Failed to search functions: ${error.message}`);
    }
  }

  /**
   * Get popular or commonly used functions
   * @returns {Promise<Array>} Array of popular functions
   */
  async getPopularFunctions() {
    // Common useful functions from Wikifunctions
    const popularZids = [
      'Z801', // Prime number check
      'Z802', // Caesar cipher
      'Z803', // Age calculation
      'Z804', // Leap year check
      'Z805', // Fibonacci sequence
      'Z806', // String reverse
      'Z807', // Factorial
      'Z808'  // String length
    ];

    const functions = [];
    for (const zid of popularZids) {
      try {
        const func = await this.fetchFunction(zid);
        if (func && !func.error) {
          functions.push({ zid, ...func });
        }
      } catch (error) {
        console.warn(`Failed to fetch popular function ${zid}:`, error.message);
      }
    }

    return functions;
  }

  /**
   * Utility: Check if a number is prime using Wikifunctions
   * @param {number} number - Number to check
   * @returns {Promise<boolean>} Whether the number is prime
   */
  async isPrime(number) {
    try {
      const result = await this.runFunction('Z801', {
        Z801K1: { Z1K1: 'Z6', Z6K1: number.toString() }
      });
      return result.Z40K1 === 'Z41'; // Z41 = true in Wikifunctions
    } catch (error) {
      throw new Error(`Failed to check if ${number} is prime: ${error.message}`);
    }
  }

  /**
   * Utility: Calculate age using Wikifunctions
   * @param {string} birthDate - Birth date in ISO format
   * @returns {Promise<number>} Age in years
   */
  async calculateAge(birthDate) {
    try {
      const result = await this.runFunction('Z803', {
        Z803K1: { Z1K1: 'Z6', Z6K1: birthDate }
      });
      return parseInt(result.Z6K1);
    } catch (error) {
      throw new Error(`Failed to calculate age: ${error.message}`);
    }
  }

  /**
   * Utility: Apply Caesar cipher using Wikifunctions
   * @param {string} text - Text to encode
   * @param {number} shift - Shift amount
   * @returns {Promise<string>} Encoded text
   */
  async caesarCipher(text, shift = 13) {
    try {
      const result = await this.runFunction('Z802', {
        Z802K1: { Z1K1: 'Z6', Z6K1: text },
        Z802K2: { Z1K1: 'Z6', Z6K1: shift.toString() }
      });
      return result.Z6K1;
    } catch (error) {
      throw new Error(`Failed to apply Caesar cipher: ${error.message}`);
    }
  }

  /**
   * Make HTTP request to Wikifunctions API
   * @private
   */
  async makeRequest(url) {
    return new Promise((resolve, reject) => {
      const options = {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'HiveMind-WikifunctionsIntegration/1.0 (https://github.com/deep-assistant/hive-mind) Node.js/' + process.version,
          'Accept': 'application/json'
        }
      };
      
      const request = https.get(url, options, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          // Handle non-200 status codes
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}: ${data}`));
            return;
          }

          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (error) {
            // Log raw response for debugging
            console.error('Raw API response:', data.slice(0, 200) + '...');
            reject(new Error(`Failed to parse JSON response: ${error.message}`));
          }
        });
      });

      request.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get available skills/capabilities
   * @returns {Array} List of available skills
   */
  getAvailableSkills() {
    return [
      {
        name: 'prime_check',
        description: 'Check if a number is prime',
        example: 'await skills.isPrime(17)'
      },
      {
        name: 'age_calculation',
        description: 'Calculate age from birth date',
        example: 'await skills.calculateAge("1990-01-01")'
      },
      {
        name: 'caesar_cipher',
        description: 'Apply Caesar cipher to text',
        example: 'await skills.caesarCipher("Hello World", 13)'
      },
      {
        name: 'function_search',
        description: 'Search for available functions',
        example: 'await skills.searchFunctions("math")'
      },
      {
        name: 'run_custom_function',
        description: 'Run any Wikifunctions function by ZID',
        example: 'await skills.runFunction("Z801", args)'
      }
    ];
  }
}

// Export for use in other modules
export { WikifunctionsSkills };

// CLI interface when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const yargs = (await use('yargs@latest')).default;

  const argv = yargs(process.argv.slice(2))
    .usage('Usage: $0 <command> [options]')
    .command('search <query>', 'Search for functions', (yargs) => {
      yargs.positional('query', {
        describe: 'Search query',
        type: 'string'
      });
    })
    .command('run <zid> [args]', 'Run a function', (yargs) => {
      yargs.positional('zid', {
        describe: 'Function identifier (e.g., Z801)',
        type: 'string'
      }).positional('args', {
        describe: 'Function arguments as JSON string',
        type: 'string',
        default: '{}'
      });
    })
    .command('prime <number>', 'Check if number is prime', (yargs) => {
      yargs.positional('number', {
        describe: 'Number to check',
        type: 'number'
      });
    })
    .command('popular', 'List popular functions')
    .command('skills', 'List available skills')
    .demandCommand(1, 'You need at least one command')
    .help()
    .argv;

  const skills = new WikifunctionsSkills();

  try {
    switch (argv._[0]) {
      case 'search':
        const searchResults = await skills.searchFunctions(argv.query);
        console.log(JSON.stringify(searchResults, null, 2));
        break;

      case 'run':
        const args = JSON.parse(argv.args);
        const result = await skills.runFunction(argv.zid, args);
        console.log(JSON.stringify(result, null, 2));
        break;

      case 'prime':
        const isPrime = await skills.isPrime(argv.number);
        console.log(`${argv.number} is ${isPrime ? '' : 'not '}prime`);
        break;

      case 'popular':
        const popular = await skills.getPopularFunctions();
        console.log(JSON.stringify(popular, null, 2));
        break;

      case 'skills':
        const availableSkills = skills.getAvailableSkills();
        console.log('\nAvailable Wikifunctions Skills:');
        availableSkills.forEach(skill => {
          console.log(`\n• ${skill.name}: ${skill.description}`);
          console.log(`  Example: ${skill.example}`);
        });
        break;
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}