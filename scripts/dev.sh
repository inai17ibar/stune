#!/bin/bash
# Launch sTunes in dev mode
# Run this from Terminal.app (not from VSCode terminal)
cd "$(dirname "$0")/.."

# Remove ELECTRON_RUN_AS_NODE which VSCode/Claude Code sets
unset ELECTRON_RUN_AS_NODE

# Compile Electron TypeScript
npx tsc -p tsconfig.electron.json

# Start Vite + Electron
npx concurrently \
  "npx vite" \
  "npx tsc -p tsconfig.electron.json --watch" \
  "npx wait-on http://localhost:5173 && npx electron ."
