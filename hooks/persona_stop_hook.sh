#!/usr/bin/env bash
# Persona auto-signal hook — runs on every Stop event.
# Blocks every 10 human messages to force persona signal recording.
# Ensures behavioral data is captured for personality evolution.

INPUT=$(cat)

USER_MSG_COUNT=$(echo "$INPUT" | node -e "
  const input = require('fs').readFileSync('/dev/stdin', 'utf8');
  try {
    const data = JSON.parse(input);
    const messages = data.messages || data.transcript || [];
    const userMsgs = messages.filter(m => m.role === 'user' || m.role === 'human');
    console.log(userMsgs.length);
  } catch { console.log(0); }
" 2>/dev/null)

USER_MSG_COUNT=${USER_MSG_COUNT:-0}

if [ "$USER_MSG_COUNT" -gt 0 ] && [ $((USER_MSG_COUNT % 10)) -eq 0 ]; then
  echo '{"decision":"block","reason":"🎭 PERSONA checkpoint (every 10 messages). Before continuing:\n1. persona_signal: Record any user reactions from the last few exchanges (correction, approval, frustration, elaboration, simplification, praise, explicit_feedback, code_accepted, code_rejected, style_correction)\n2. If 5+ signals recorded this session, run persona_synthesize to update the profile\n\nDo this NOW, then continue."}'
else
  echo '{"decision":"allow"}'
fi
