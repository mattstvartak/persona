#!/usr/bin/env bash
# Persona pre-compact hook — runs BEFORE context window compression.
# ALWAYS blocks to ensure persona signals are recorded before context is lost.

echo '{"decision":"block","reason":"⚠️ CONTEXT COMPACTION IMMINENT — behavioral signals will be lost.\n\nBefore compaction, you MUST:\n1. persona_signal: Record ALL observed user reactions from this session (corrections, approvals, frustrations, style preferences)\n2. persona_synthesize: Run synthesis if 3+ signals were recorded to update the personality profile\n3. Also save memories to Engram (memory_ingest, memory_diary_write) if not done recently\n\nThis is NOT optional. Capture all behavioral data now."}'
