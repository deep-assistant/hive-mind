# Log Compression and Large File Upload

**Issue**: #587 - Alternatives to gh gist for transferring large logs

## Overview

The hive-mind system now supports automatic compression and enhanced upload methods for large log files. This solves the problem where GitHub Gist would reject very large log files (e.g., 200MB) with "contents are too large" errors.

## Features

### 1. Automatic Compression

Log files larger than 1MB are automatically compressed using gzip before uploading to GitHub Gist. This typically achieves:
- **10:1 to 7:1 compression ratio** for text logs
- **90-99% size reduction** for repetitive log content

### 2. Enhanced Upload Methods

The system uses a two-tier approach:

#### Tier 1: Standard Upload (< 25MB)
- Uses `gh gist create` CLI command
- Fast and simple
- Works for most logs

#### Tier 2: Git-Based Upload (25MB - 100MB)
- Uses `git push` to upload to gist
- Supports files up to 100MB (vs 25MB limit with CLI)
- Automatically triggered when standard upload fails

### 3. User-Friendly Decompression

When a compressed log is uploaded, the GitHub comment includes:
- Original and compressed file sizes
- Clear decompression instructions for:
  - Linux/Mac/WSL users
  - Windows PowerShell users
  - GUI users (7-Zip, WinRAR, etc.)

## Examples

### Example 1: Small log (< 64KB)
```
Log: 45KB
Action: Posted inline in GitHub comment
```

### Example 2: Medium log (64KB - 25MB)
```
Log: 5MB
Action: Uploaded as gist using gh CLI
Result: https://gist.github.com/user/abc123
```

### Example 3: Large log (25MB - 100MB uncompressed)
```
Log: 50MB (uncompressed)
Action:
  1. Compressed to 5MB (90% reduction)
  2. Uploaded via git push
Result: https://gist.github.com/user/abc123
Comment includes decompression instructions
```

### Example 4: Very large log (200MB)
```
Log: 200MB (uncompressed)
Action:
  1. Compressed to 20MB (90% reduction)
  2. Uploaded via git push
Result: https://gist.github.com/user/abc123
Comment includes decompression instructions
```

## Technical Details

### Compression Threshold
- Default: 1MB (1,048,576 bytes)
- Configurable via environment variable (future enhancement)

### Maximum File Sizes
- **Inline comment**: 64KB (GitHub limit)
- **Uncompressed gist**: 25MB (gh CLI limit)
- **Compressed gist**: 100MB (git push limit)

### Fallback Strategy
1. Try inline comment (if < 64KB)
2. Try compression + gist upload (if > 64KB)
3. If upload fails, use truncated comment
4. Always provide clear error messages

## How It Works

### Compression Flow
```
1. Check log size
2. If > 1MB:
   a. Create temporary copy
   b. Compress using gzip (max compression)
   c. Report compression ratio
3. Upload compressed file to gist
4. Include decompression instructions
5. Clean up temporary files
```

### Upload Flow
```
1. Determine repository visibility (public/private)
2. Check file size
3. If < 25MB:
   a. Try gh CLI upload
   b. If fails, fall back to git-based upload
4. If 25MB - 100MB:
   a. Use git-based upload
   b. Clone empty gist
   c. Add file via git
   d. Push to gist
5. If > 100MB:
   a. Return error with helpful message
   b. Suggest compression or chunking
```

## Usage

The compression and upload features are **automatic** and require no user configuration. The system will:
- Automatically detect when compression is beneficial
- Choose the best upload method based on file size
- Provide clear feedback during the process
- Include decompression instructions when needed

## Configuration

No configuration is required. The system uses sensible defaults:
- Compression threshold: 1MB
- Maximum gist size: 100MB
- Fallback to truncated comment if all else fails

## Testing

A comprehensive test suite is available:
```bash
bun run experiments/test-log-compression.mjs
```

Tests cover:
- File size formatting
- Compression/decompression
- Compression ratio calculations
- File splitting (for future chunking support)
- Decompression instruction generation

## Performance

### Compression Performance
- **Speed**: ~100-200 MB/s on typical hardware
- **Ratio**: 7:1 to 10:1 for text logs
- **Time**: 200MB log takes ~1-2 seconds to compress

### Upload Performance
- **gh CLI**: 1-5 seconds for files < 25MB
- **git push**: 5-15 seconds for files 25-100MB
- **Network**: Depends on connection speed

## Future Enhancements

Potential improvements for extremely large files:
1. **Chunking**: Split files > 100MB into multiple gists
2. **GitHub Releases**: Use release assets for files > 100MB
3. **External storage**: Optional S3/GCS integration
4. **Streaming compression**: For very large files
5. **Parallel uploads**: For chunked files

## Related Files

- `src/log-compression.lib.mjs` - Compression utilities
- `src/gist-upload.lib.mjs` - Enhanced gist upload
- `src/github.lib.mjs` - Main log attachment logic
- `experiments/test-log-compression.mjs` - Test suite
- `experiments/issue-587-log-transfer-alternatives.md` - Research notes

## References

- Issue #587: https://github.com/deep-assistant/hive-mind/issues/587
- GitHub Gist Limits: https://docs.github.com/en/rest/gists
- Git LFS Alternative: https://git-lfs.github.com/
