---
name: persona-evolve
description: "Review, apply, or reject personality evolution proposals. Use when the user says /persona-evolve, wants to see pending personality changes, or asks about how the agent's personality is evolving."
user-invocable: true
metadata: {"version":"1.0.0-beta.2"}
---

# Persona Evolve

Walk through pending evolution proposals interactively.

## Usage

```
/persona-evolve [generate|history]
```

## Behavior

### Default (no args): Review pending proposals

1. Call `persona_proposals` with status "pending"
2. If no pending proposals, let the user know and suggest running `/persona-evolve generate` to create some from accumulated signals
3. If proposals exist, present each one clearly:
   - What it wants to change (which soul file, what content)
   - Why (the rationale and evidence)
   - Confidence score
4. For each proposal, ask the user: apply, reject, or skip?
5. Apply with `persona_apply`, reject with `persona_reject`
6. After going through all proposals, summarize what changed

### generate
Call `persona_evolve` to force proposal generation from current signals. Show the new proposals and offer to walk through them.

### history
Call `persona_proposals` with status "all". Show applied and rejected proposals so the user can see how the personality has evolved over time. Group by status.

## Tone

This is a collaborative process. The user is shaping how the agent talks to them. Present proposals as suggestions, not demands. Make it clear the user has full control.
