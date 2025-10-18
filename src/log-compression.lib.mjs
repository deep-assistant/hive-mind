#!/usr/bin/env node

/**
 * Log compression utilities for reducing file sizes before upload
 * Addresses issue #587: Need alternatives to gh gist for large log files
 */

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const fs = (await use('fs')).promises;
const zlib = (await use('zlib')).default;
const { promisify } = await use('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Compress a log file using gzip
 * @param {string} inputPath - Path to the input file
 * @param {string} outputPath - Path to save the compressed file
 * @returns {Promise<{originalSize: number, compressedSize: number, compressionRatio: number}>}
 */
export async function compressLogFile(inputPath, outputPath) {
  try {
    // Read the input file
    const inputData = await fs.readFile(inputPath);
    const originalSize = inputData.length;

    // Compress with maximum compression level
    const compressed = await gzip(inputData, {
      level: zlib.constants.Z_BEST_COMPRESSION
    });
    const compressedSize = compressed.length;

    // Write compressed data
    await fs.writeFile(outputPath, compressed);

    const compressionRatio = originalSize / compressedSize;

    return {
      originalSize,
      compressedSize,
      compressionRatio,
      savedBytes: originalSize - compressedSize,
      savedPercentage: ((originalSize - compressedSize) / originalSize * 100).toFixed(1)
    };
  } catch (error) {
    throw new Error(`Failed to compress log file: ${error.message}`);
  }
}

/**
 * Decompress a gzipped log file
 * @param {string} inputPath - Path to the compressed file
 * @param {string} outputPath - Path to save the decompressed file
 * @returns {Promise<{originalSize: number, decompressedSize: number}>}
 */
export async function decompressLogFile(inputPath, outputPath) {
  try {
    const compressedData = await fs.readFile(inputPath);
    const originalSize = compressedData.length;

    const decompressed = await gunzip(compressedData);
    const decompressedSize = decompressed.length;

    await fs.writeFile(outputPath, decompressed);

    return {
      originalSize,
      decompressedSize
    };
  } catch (error) {
    throw new Error(`Failed to decompress log file: ${error.message}`);
  }
}

/**
 * Check if a file should be compressed based on its size
 * @param {number} fileSize - Size of the file in bytes
 * @param {number} threshold - Minimum size threshold for compression (default: 1MB)
 * @returns {boolean} True if file should be compressed
 */
export function shouldCompress(fileSize, threshold = 1024 * 1024) {
  return fileSize >= threshold;
}

/**
 * Split a large file into chunks
 * @param {string} inputPath - Path to the input file
 * @param {number} chunkSizeMB - Size of each chunk in MB (default: 50MB)
 * @returns {Promise<string[]>} Array of chunk file paths
 */
export async function splitFileIntoChunks(inputPath, chunkSizeMB = 50) {
  const chunkSize = chunkSizeMB * 1024 * 1024;
  const chunks = [];

  try {
    const fileData = await fs.readFile(inputPath);
    const totalSize = fileData.length;
    const numChunks = Math.ceil(totalSize / chunkSize);

    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, totalSize);
      const chunk = fileData.slice(start, end);

      const chunkPath = `${inputPath}.chunk${i + 1}of${numChunks}`;
      await fs.writeFile(chunkPath, chunk);
      chunks.push(chunkPath);
    }

    return chunks;
  } catch (error) {
    throw new Error(`Failed to split file into chunks: ${error.message}`);
  }
}

/**
 * Generate decompression instructions for users
 * @param {string} filename - Name of the compressed file
 * @returns {string} Markdown-formatted instructions
 */
export function getDecompressionInstructions(filename) {
  return `
### How to decompress this log file

The log file has been compressed to reduce size. To view it:

**Option 1: Command line (Linux/Mac/WSL)**
\`\`\`bash
# Download the file, then decompress:
gunzip ${filename}
# Or view without decompressing:
zcat ${filename} | less
\`\`\`

**Option 2: Command line (Windows PowerShell)**
\`\`\`powershell
# Download the file, then:
# Install 7-Zip, then:
7z x ${filename}
\`\`\`

**Option 3: GUI**
- Use any archive tool (7-Zip, WinRAR, The Unarchiver, etc.)
- Right-click the downloaded file and select "Extract" or "Decompress"
`.trim();
}

/**
 * Generate reassembly instructions for chunked files
 * @param {number} numChunks - Number of chunks
 * @param {string} baseFilename - Base filename for the chunks
 * @returns {string} Markdown-formatted instructions
 */
export function getReassemblyInstructions(numChunks, baseFilename) {
  return `
### How to reassemble chunked log file

This log file was split into ${numChunks} chunks. To reassemble:

**Linux/Mac/WSL:**
\`\`\`bash
# Download all ${numChunks} chunks, then:
cat ${baseFilename}.chunk* > ${baseFilename}
\`\`\`

**Windows PowerShell:**
\`\`\`powershell
# Download all ${numChunks} chunks to the same directory, then:
cmd /c copy /b ${baseFilename}.chunk* ${baseFilename}
\`\`\`

After reassembly, if the file is compressed (.gz extension), follow the decompression instructions.
`.trim();
}

/**
 * Format file size in human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "1.5 MB")
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default {
  compressLogFile,
  decompressLogFile,
  shouldCompress,
  splitFileIntoChunks,
  getDecompressionInstructions,
  getReassemblyInstructions,
  formatFileSize
};
