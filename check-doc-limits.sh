#!/bin/bash
# File size enforcement check for documentation
# Required by issue #25 - CRITICAL REQUIREMENT

set -e

echo "📏 Checking documentation file size limits..."

# Maximum allowed lines per file
MAX_LINES=2500
ERRORS_FOUND=0

# Check all markdown files in docs directory
if [ -d "docs/" ]; then
    while IFS= read -r -d '' file; do
        line_count=$(wc -l < "$file")
        if [ "$line_count" -gt $MAX_LINES ]; then
            echo "❌ ERROR: $file has $line_count lines (max $MAX_LINES)"
            ERRORS_FOUND=$((ERRORS_FOUND + 1))
        else
            echo "✅ OK: $file ($line_count lines)"
        fi
    done < <(find docs/ -name "*.md" -print0)
fi

# Check README.md
if [ -f "README.md" ]; then
    readme_lines=$(wc -l < README.md)
    if [ "$readme_lines" -gt $MAX_LINES ]; then
        echo "❌ ERROR: README.md has $readme_lines lines (max $MAX_LINES)"
        ERRORS_FOUND=$((ERRORS_FOUND + 1))
    else
        echo "✅ OK: README.md ($readme_lines lines)"
    fi
fi

# Summary
if [ $ERRORS_FOUND -eq 0 ]; then
    echo "🎉 All files pass size requirements"
    exit 0
else
    echo "💥 Found $ERRORS_FOUND files exceeding size limits"
    echo "📝 Split large files into subdirectories as required"
    exit 1
fi