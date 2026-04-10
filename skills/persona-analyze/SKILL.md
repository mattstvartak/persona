---
name: persona-analyze
description: "Analyze the user's communication style from recent messages. Use when the user says /persona-analyze, wants to know how they come across, or asks the agent to learn their style."
user-invocable: true
metadata: {"version":"1.0.0-beta.2"}
---

# Persona Analyze

Analyze communication style from recent messages.

## Usage

```
/persona-analyze [sync]
```

## Behavior

### Default: Analyze only (read-only)
1. Gather the user's recent messages from the current conversation (at least 5 for meaningful results)
2. Call `persona_analyze` with the messages as a JSON array
3. Present the detected traits naturally:
   - Message style: terse or verbose?
   - Formality: casual, neutral, or formal?
   - Technical depth: how technical is the vocabulary?
   - Humor: rare, occasional, or frequent?
   - Directness: gives commands or asks politely?
   - Question style: exploratory or direct?
   - Emoji and exclamation usage
4. Frame it as "here's how your messages read to me" and invite the user to correct anything that seems off

### sync: Analyze and update soul files
1. Same analysis as above
2. Call `persona_synthesize` instead of `persona_analyze` to actually update the soul files
3. Show what changed
4. This is how the user explicitly triggers a personality sync from their current writing style

## Notes

If fewer than 3 messages are available, let the user know you need more data. Don't try to draw conclusions from one or two messages.

The analysis is purely heuristic (pattern matching on the text). It picks up on things like slang, technical terms, sentence length, and punctuation patterns. It's not reading emotions or intent, just surface-level communication style.
