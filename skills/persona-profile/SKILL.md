---
name: persona-profile
description: "View the behavioral profile and signal statistics. Use when the user says /persona-profile, wants to know what the system has learned about them, or asks 'what do you think of me' or 'how am I doing'."
user-invocable: true
metadata: {"version":"1.0.0-beta.2"}
---

# Persona Profile

See what the system has learned about you.

## Usage

```
/persona-profile [detailed]
```

## Behavior

### Default: Profile summary
1. Call `persona_profile` for the readable summary
2. Present it naturally. Cover:
   - Overall satisfaction rate (how often you approve vs correct)
   - Verbosity preference (terse, balanced, or detailed)
   - Key style preferences (code-first? bullet points? direct answers?)
   - Avoid patterns (things you've told the agent to stop doing)
   - Preferred patterns (things you've praised)
   - Top topic preferences if any exist
3. Frame it as "here's what I've picked up about how you like to work" not as a clinical report

### detailed: Full stats
1. Call `persona_stats` for the complete picture
2. Show signal counts by type, proposal history, soul file sizes
3. Include the profile summary too
4. This is the "under the hood" view for users who want to see the numbers

## Tone

Be genuine about what the system knows and doesn't know. If there's limited data, say so. Don't overstate confidence. If satisfaction is low, acknowledge it and ask what could be better.
