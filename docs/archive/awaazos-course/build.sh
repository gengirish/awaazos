#!/bin/bash
# Assembles the course from module files into a single index.html.
# Run from inside the course directory: bash build.sh
set -e

if [ ! -f _base.html ]; then
  echo "Error: run this from inside the course directory (the one with _base.html)." >&2
  exit 1
fi

if [ ! -d modules ] || [ -z "$(ls modules/*.html 2>/dev/null)" ]; then
  echo "Error: no module files found in modules/. Did Claude finish writing them?" >&2
  exit 1
fi

# Sort modules explicitly so order is predictable across all filesystems.
cat _base.html $(ls modules/*.html | sort) _footer.html > index.html
echo "Built index.html — open it in your browser."
