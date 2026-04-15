# Persona Auto-Signal Hooks

Claude Code hooks that mechanically enforce behavioral signal recording. Without these, Claude forgets to call `persona_signal` when focused on tasks.

## What they do

### `persona_stop_hook.sh` (Stop event)
Fires after every assistant turn. Every 10 user messages, **blocks** Claude from continuing until it records:
- User behavioral signals via `persona_signal`
- Runs `persona_synthesize` if enough signals accumulated

### `persona_precompact_hook.sh` (PreCompact event)
Fires before context window compression. **Always blocks.** Forces Claude to capture all observed behavioral signals before context is lost.

## Installation

Add to your Claude Code settings (global `~/.claude/settings.json` or per-project `.claude/settings.local.json`):

```json
{
  "hooks": {
    "Stop": [
      {
        "command": "bash /path/to/persona/hooks/persona_stop_hook.sh"
      }
    ],
    "PreCompact": [
      {
        "command": "bash /path/to/persona/hooks/persona_precompact_hook.sh"
      }
    ]
  }
}
```
