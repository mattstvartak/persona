---
name: persona-tune
description: "Fine-tune specific personality traits without editing soul files directly. Use when the user says /persona-tune, or gives quick feedback like 'be more direct', 'less verbose', 'more opinionated', 'tone it down'."
user-invocable: true
metadata: {"version":"1.0.0-beta.2"}
---

# Persona Tune

Quick personality adjustments through natural language.

## Usage

```
/persona-tune <instruction>
```

## Behavior

1. Parse the user's instruction for what they want to change
2. Record appropriate signals via `persona_signal`:
   - "be more direct" / "get to the point" -> signal type `simplification`
   - "more detail" / "explain more" -> signal type `elaboration`
   - "be more opinionated" / "tell me what you think" -> signal type `explicit_feedback`
   - "less formal" / "keep it casual" -> signal type `style_correction`
   - "stop doing X" / "don't X" -> signal type `correction`
   - "I like when you X" / "keep doing X" -> signal type `praise`
3. Also apply the change immediately to the current conversation by calling `persona_adapt` to get updated adaptations
4. If the instruction is clear and specific enough, offer to write it directly into the appropriate soul file via `persona_edit` for permanent effect
5. Confirm what changed and how it will affect future responses

## Examples

- `/persona-tune be more concise` - Records simplification signal, adjusts verbosity
- `/persona-tune show code before explaining` - Records style correction, updates code-first preference
- `/persona-tune stop adding trailing summaries` - Records correction, adds to avoid patterns
- `/persona-tune I like how direct you've been today` - Records praise, reinforces current approach
- `/persona-tune more casual, less corporate` - Records style correction, adjusts formality

## Notes

This is the quick-feedback path. For bigger personality changes, point users to `/persona-soul edit` or `/persona-evolve`. For a full style analysis, point to `/persona-analyze sync`.
