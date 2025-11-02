if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const linoModule = await use('links-notation');
const LinoParser = linoModule.Parser || linoModule.default?.Parser;

const fs = await import('fs');
const path = await import('path');
const os = await import('os');

export class LinksNotationManager {
  constructor() {
    this.parser = new LinoParser();
    this.cacheDir = path.join(os.homedir(), '.hive-mind');
  }

  parse(input) {
    if (!input) return [];

    const parsed = this.parser.parse(input);

    if (parsed && parsed.length > 0) {
      const link = parsed[0];
      const values = [];

      if (link.values && link.values.length > 0) {
        for (const value of link.values) {
          const val = value.id || value;
          values.push(val);
        }
      } else if (link.id) {
        values.push(link.id);
      }

      return values;
    }

    return [];
  }

  parseNumericIds(input) {
    if (!input) return [];

    const parsed = this.parser.parse(input);

    if (parsed && parsed.length > 0) {
      const link = parsed[0];
      const ids = [];

      if (link.values && link.values.length > 0) {
        for (const value of link.values) {
          const num = parseInt(value.id || value);
          if (!isNaN(num)) {
            ids.push(num);
          }
        }
      } else if (link.id) {
        const nums = link.id.match(/\d+/g);
        if (nums) {
          ids.push(...nums.map(n => parseInt(n)).filter(n => !isNaN(n)));
        }
      }

      return ids;
    }

    return [];
  }

  parseStringValues(input) {
    if (!input) return [];

    const parsed = this.parser.parse(input);

    if (parsed && parsed.length > 0) {
      const link = parsed[0];
      const links = [];

      if (link.values && link.values.length > 0) {
        for (const value of link.values) {
          const linkStr = value.id || value;
          if (typeof linkStr === 'string') {
            links.push(linkStr);
          }
        }
      } else if (link.id) {
        if (typeof link.id === 'string') {
          links.push(link.id);
        }
      }

      return links;
    }

    return [];
  }

  format(values) {
    if (!values || values.length === 0) return '()';

    const formattedValues = values.map(value => `  ${value}`).join('\n');
    return `(\n${formattedValues}\n)`;
  }

  ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      return true;
    }
    return false;
  }

  saveToCache(filename, values) {
    this.ensureCacheDir();
    const cacheFile = path.join(this.cacheDir, filename);
    const linksNotation = this.format(values);
    fs.writeFileSync(cacheFile, linksNotation);
    return cacheFile;
  }

  loadFromCache(filename) {
    const cacheFile = path.join(this.cacheDir, filename);

    if (!fs.existsSync(cacheFile)) {
      return null;
    }

    const content = fs.readFileSync(cacheFile, 'utf8');
    return {
      raw: content,
      parsed: this.parse(content),
      numericIds: this.parseNumericIds(content),
      stringValues: this.parseStringValues(content),
      file: cacheFile
    };
  }

  cacheExists(filename) {
    const cacheFile = path.join(this.cacheDir, filename);
    return fs.existsSync(cacheFile);
  }

  getCachePath(filename) {
    return path.join(this.cacheDir, filename);
  }

  requireCache(filename, errorMessage) {
    const cache = this.loadFromCache(filename);

    if (!cache) {
      const cacheFile = this.getCachePath(filename);
      console.error(`❌ ${errorMessage || `Cache file not found: ${cacheFile}`}`);
      console.log('💡 Run the appropriate script first to create the cache file');
      process.exit(1);
    }

    console.log(`📂 Using cached data from: ${cache.file}\n`);
    return cache;
  }
}

export const CACHE_FILES = {
  TELEGRAM_CHATS: 'telegram-chats.lino'
};

export const lino = new LinksNotationManager();
