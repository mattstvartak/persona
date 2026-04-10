---
name: persona-soul
description: "View or edit the agent's soul files (personality, style, skill). Use when the user says /persona-soul, wants to see the current personality, or wants to directly edit how the agent behaves."
user-invocable: true
metadata: {"version":"1.0.0-beta.2"}
---

# Persona Soul

Read and edit the agent's personality directly.

## Usage

```
/persona-soul [file] [edit]
```

**Files:** `personality`, `style`, `skill`

## Behavior

### No args: Show all soul files
Call `persona_read` for each file (personality, style, skill). Present them clearly with headers. This gives the user a full picture of who the agent currently "is."

### With file name: Show that file
Call `persona_read` for the specified file. Show the content.

### With file name + edit: Edit mode
1. Call `persona_read` to show current content
2. Ask the user what they want to change
3. Help them draft the new content (or apply their edits)
4. Call `persona_edit` with the updated content
5. Confirm the change

## Notes

Soul files are plain markdown. The user can write whatever they want in them. Common things people put in:

- **Personality**: tone (direct, casual, formal), humor level, how opinionated to be, energy level
- **Style**: formatting preferences (bullets vs prose, code-first), verbosity, things to avoid, things to keep doing
- **Skill**: when to ask vs act, deep-dive topics, quick-answer topics, workflow preferences

If the user isn't sure what to write, offer to run `/persona-analyze` first to see what the system has detected about their style, then suggest content based on that.
