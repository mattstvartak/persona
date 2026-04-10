#!/usr/bin/env bash
# Install Persona slash commands for Claude Code
# Copies command files to ~/.claude/commands/ so they're available globally

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/.claude/commands"
TARGET_DIR="$HOME/.claude/commands"
FORCE=false

if [ "$1" = "--force" ]; then
  FORCE=true
fi

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Error: Source directory not found: $SOURCE_DIR"
  exit 1
fi

mkdir -p "$TARGET_DIR"

COMMANDS=(persona-evolve persona-soul persona-profile persona-analyze persona-reset persona-tune)
INSTALLED=0
SKIPPED=0

for cmd in "${COMMANDS[@]}"; do
  src="$SOURCE_DIR/$cmd.md"
  dest="$TARGET_DIR/$cmd.md"

  if [ ! -f "$src" ]; then
    echo "  skip: $cmd.md (not found in source)"
    continue
  fi

  if [ -f "$dest" ] && [ "$FORCE" = false ]; then
    echo "  exists: $cmd.md (use --force to overwrite)"
    SKIPPED=$((SKIPPED + 1))
  else
    cp "$src" "$dest"
    echo "  installed: $cmd.md"
    INSTALLED=$((INSTALLED + 1))
  fi
done

echo ""
echo "Done. $INSTALLED installed, $SKIPPED skipped."
echo ""
echo "Available commands:"
echo "  /persona-evolve [generate|history]  Review evolution proposals"
echo "  /persona-soul [file] [edit]         View or edit soul files"
echo "  /persona-profile [detailed]         View behavioral profile"
echo "  /persona-analyze [sync]             Analyze communication style"
echo "  /persona-reset [preset]             Reset or load a preset"
echo "  /persona-tune <instruction>         Quick personality adjustment"
