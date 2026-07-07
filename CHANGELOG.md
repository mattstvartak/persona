# Changelog

All notable changes to `@onenomad/przm-voice` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-07-07

### Fixed

- **Profile rebuild is now deterministic.** `rebuildProfile` fires on
  every `voice_signal` call but mutated persisted state incrementally,
  so the whole 30-day signal window was re-applied on top of the last
  rebuild's output every time. Live profiles showed
  `topicPreferences.code.signalCount = 241` against 32 total signals,
  global verbosity pinned at 0.92, and per-topic satisfaction saturated
  at the clamps. Derived fields are now reset and recomputed by
  replaying signals in timestamp order — rebuild(signals) is a pure
  function of the history (pinnedFeedback stays user-curated).

- **Likes/avoids extraction no longer captures garbage.** The
  extractors ran an unbounded `.{5,60}` window over the whole narrated
  signal content, so a trigger word anywhere captured across quote and
  clause boundaries (live example: a stored "avoid" of
  `resize my browser windows please" — while testing responsive`).
  Extraction now scopes to quoted user speech when present, stops at
  clause boundaries, never ends mid-word, and 'perfect'/'exactly' were
  dropped as capture triggers. Covered by `dist/tests/profile-rebuild.js`.

- **Trait state no longer evaporates on session exit.** Persistence was
  throttled to every 10th update with no shutdown flush, but each
  Claude Code session is a fresh short-lived server process — up to 9
  updates were lost per session (a profile with 32 signals had only 8
  Big Five samples). Default save interval is now 1, and a shutdown
  hook (beforeExit / SIGINT / SIGTERM / stdin close) flushes the cache
  and records a session summary, so `sessionsAnalyzed` finally grows
  without anyone calling `voice_consolidate` manually.

- **Evolution proposals actually fire.** The auto-generation gate was
  `totalSignals % proposalThreshold === 0`, which a single auto-detect
  turn recording 2-3 signals steps right over (11 -> 13 skips 12) —
  deployments with 30+ signals had never generated a proposal. The gate
  is now a persisted watermark (`traitState.lastProposalSignalCount`):
  past the threshold, generation runs whenever there are new signals
  since the last attempt.

- **Domain classifier reads the right text.** `domainTechnicalRatio`
  classified only the signal's reaction snippet ("perfect", "no, do X"),
  so a full-time developer profiled as "casual" (ratio 0.05). Detection
  now folds in the signal's `context`, treats a code/dev `category` as
  a 0.9 observation, seeds from the first observation instead of
  EMA-ing up from zero, and adapts at alpha 0.15 instead of 0.05.

### Changed

- **Big Five reliability threshold lowered 15 -> 10** and exported as
  `RELIABILITY_THRESHOLD` (the literal was duplicated in three display
  strings that could drift). Chosen against observed real-world signal
  density: 15 left profiles in "building..." for months.

## [1.0.1] - 2026-05-20

### Added

- **`engines.node = >=22.0.0`** in `package.json`. Matches the runtime
  the project is actually developed and tested against; npm will now
  warn at install time if Node 20 or earlier is in use.
- **`src/version.ts`** — single source of truth for the MCP server's
  self-reported version. Reads `package.json` once at startup and
  caches the result. Replaces the hardcoded `'1.0.0'` string that had
  to be hand-bumped in step with every release (and would have started
  lying as of this release if it hadn't been replaced).

### Changed

- **Hooks renamed: `persona_*.sh` → `voice_*.sh`.** The two Claude Code
  hooks under `hooks/` (`persona_precompact_hook.sh`,
  `persona_stop_hook.sh`) now ship as `voice_precompact_hook.sh` and
  `voice_stop_hook.sh`. Their bodies use the current `voice_signal` /
  `voice_synthesize` / `memory-ingest` / `memory-diary-write` tool
  names. The `hooks/README.md` rewrite documents the rename and
  includes a migration note for anyone whose `settings.json` still
  points at the old paths.
- **Server instruction text** now references `przm-memory` and
  `voice` instead of the deprecated `engram` / `persona` brand pair
  (line: "If przm-memory available: memory = WHAT, voice = HOW.").
- **Slash command tool references** under `.claude/commands/` updated
  from `persona_*` to `voice_*` to match the renamed MCP tools. The
  slash command file names (`persona-evolve.md` etc) are intentionally
  unchanged so any user who already wired `/persona-evolve` into their
  workflow keeps working.
- **Workspace bench packages** renamed from
  `@onenomad/persona-bench-*` to `@onenomad/voice-bench-*`. Affects 6
  package.json files plus 5 `.ts` files of import statements plus 4
  `--filter` invocations in the root `package.json` scripts. The
  package directories themselves were not renamed; dir-name
  consistency was not worth the lockfile/receipt churn this release.
  Local dev must run `pnpm install` once after this update so the
  workspace symlinks resolve to the new names; the bench scripts will
  fail with "package not found" until that's done.

## [1.0.0] - 2026-05-19

Initial public release on npm under the `przm` umbrella. Prior internal development happened under the `persona` / `@onenomad/persona-mcp` name; that package is deprecated in favor of this one. The repo, package, and version line all start fresh at 1.0.0.

### Added

- **Soul / Role / Journal trichotomy.** Three-layer personality composition with clear ownership boundaries. `soul/` is user territory (PERSONALITY.md, STYLE.md, SKILL.md, edited via `voice_edit` or directly). `journal/` is przm Voice's territory (applied evolution proposals land here, never in the soul). Roles are domain overlays on top — five bundled (`developer`, `designer`, `pm`, `writer`, `researcher`) plus user-defined overrides.
- **Signal recording (12 types).** `correction`, `approval`, `frustration`, `elaboration`, `simplification`, `code_accepted`, `code_rejected`, `regen_request`, `explicit_feedback`, `style_correction`, `praise`, `abandonment`. FIFO buffer, 500 max.
- **Behavioral profile.** Satisfaction score, style preferences (verbosity, code-first, bullets, directness, opinion strength), per-topic tuning, and a running list of avoid/praise items. Rebuilds from the last 30 days of signals after every new signal.
- **Adaptations layer.** Auto-injected directives based on the current profile state — frustration / correction-rate thresholds trigger explicit "double-check" guidance; per-topic elaboration patterns trigger deeper-detail rules.
- **Evolution proposals.** Every 12 signals (configurable), the engine generates concrete soul-file edits with target / action / confidence / evidence. Nothing auto-applies. `voice_proposals`, `voice_apply`, `voice_reject`, `voice_evolve`.
- **Brain systems (v2).** Emotional tone (Plutchik 8-dim + 16 compound dyads + text micro-expressions), Big Five personality inference with EMA + 15-interaction reliability gate + domain-adjusted baselines, style mirroring (5-dim vector, 0.7 user + 0.3 baseline), cognitive load detection (flow vs overload heuristics), between-session consolidation with two-timescale update rule (fast session-state + slow trait-state).
- **Sycophancy detection.** New in 1.0.0 — `voice_detect_sycophancy` MCP tool scans assistant text for four rules-based patterns: flattery openers ("great question," "absolutely"), walk-backs without new evidence, position flips (pre-pushback X → post-pushback ¬X), and agreement cascades (N consecutive turns lacking disagreement). Rules-based deliberately — a model evaluating its own sycophancy is contaminated by the same failure mode. Includes 17-assertion smoke test (`npm run smoke:sycophancy`) and a benchmark sub-project under `benchmarks/sycophancy-detection/`.
- **Sycophancy resistance.** Consolidation pass flags approval rate > 85% as a sycophancy-drift signal. The immutable core principles in PERSONALITY.md (honesty over agreeability, genuine engagement) cannot be overwritten by the evolution system.
- **9 bundled soul presets:** default, coach, mentor, devils-advocate, reflective-listener, creative-partner, dungeon-master, personal-assistant, study-buddy. `voice_soul_presets_list`, `voice_soul_preset_read`, `voice_soul_preset_apply`.
- **27 MCP tools** across context, signals, profile, evolution, soul files, presets, roles, journal, synthesis, consolidation, sycophancy detection, and the cross-server bridge endpoint (`voice_state`).
- **6 slash commands:** `/persona-evolve`, `/persona-soul`, `/persona-profile`, `/persona-analyze`, `/persona-reset`, `/persona-tune`.
- **Storage backends.** `file` (default — JSON + markdown under `PERSONA_DATA_DIR`), `postgres` (multi-tenant via tenant-scoped tables), and `cloud` (przm Cloud, opt-in via `przm-voice login`).
- **`przm-voice` / `przm-voice-mcp` / `przm-voice login` / `logout` CLI** for the MCP server, the read-only CLI router, and przm Cloud pairing. Credentials at `~/.pyre/credentials.json` (mode 0600).

### Security

- **Path traversal hardening** in role name handling: `assertSafeRoleName()` enforces a `^[a-z0-9][a-z0-9_-]{0,62}$` whitelist at every `voice_role_*` tool entry point plus a defense-in-depth check inside the file storage adapter's `rolePath` / `writeRole` / `deleteRole`. A name like `../../etc/cron.d/foo` is rejected before any filesystem join.
- **Storage routing visibility.** `createStorage()` writes one stderr line at startup naming the resolved backend (`przm-voice: storage=cloud (auto-routed via ~/.pyre/credentials.json) · …`). Auto-routing to przm Cloud when credentials exist can be disabled with `PERSONA_NO_AUTO_CLOUD=1` for benchmark / CI runs that must stay local.

[Unreleased]: https://github.com/OneNomad-LLC/przm-voice/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/OneNomad-LLC/przm-voice/releases/tag/v1.0.0
