import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorageAdapter, setStorage } from '../storage/index.js';
import { rebuildProfile, loadProfile } from '../profile.js';
import { recordSignal, loadSignals } from '../signals.js';
import { loadConfig } from '../config.js';

/**
 * Regression tests for the deterministic profile rebuild.
 *
 * Two live bugs anchor this file:
 *
 * 1. Non-idempotent rebuild — rebuildProfile mutated persisted state
 *    incrementally on every call, so a profile with 32 signals showed
 *    topicPreferences.code.signalCount = 241, verbosity 0.92, and
 *    satisfaction saturated at the clamps. Rebuilding twice from the
 *    same signals must now produce identical output.
 *
 * 2. Quote-blind pattern extraction — the avoid/like extractors ran an
 *    unbounded .{5,60} window over the whole narrated signal content
 *    and captured fragments like:
 *      avoid: resize my browser windows please" — while testing responsive
 *      like:  knucklebones") to the knucklebones title suggestion.
 *    Both source signals are reproduced verbatim below; the extractors
 *    must now stay inside the quoted user speech and stop at clause
 *    boundaries.
 */

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`ASSERT FAIL: ${msg}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'persona-profile-rebuild-'));
  process.env.PERSONA_DATA_DIR = dir;
  try {
    setStorage(new FileStorageAdapter({ dataDir: dir }));
    const config = loadConfig();

    // ── Seed the two real-world signals that produced garbage ──────
    recordSignal(
      config,
      'praise',
      'User reacted strongly positive ("Honestly I love knucklebones") to the Knucklebones title suggestion.',
      undefined,
      'game-design',
    );
    recordSignal(
      config,
      'correction',
      '"Don\'t resize my browser windows please" — while testing responsive breakpoints via claude-in-chrome I called resize_window twice; Matt does not want his browser windows resized. Use iframe-viewport injection or other techniques instead.',
      undefined,
      'code',
    );
    for (let i = 0; i < 3; i++) {
      recordSignal(config, 'approval', 'yes that works', undefined, 'code');
    }

    const signals = loadSignals(config);
    const first = rebuildProfile(config, signals);

    // ── Extraction quality ─────────────────────────────────────────
    const avoids = first.stylePreferences.avoidPatterns;
    const likes = first.stylePreferences.preferredPatterns;
    for (const p of [...avoids, ...likes]) {
      assert(!/["()—]/.test(p), `pattern crossed a quote/clause boundary: "${p}"`);
    }
    assert(
      avoids.some(p => p.includes('resize my browser windows')),
      `avoid pattern should capture the quoted directive, got ${JSON.stringify(avoids)}`,
    );
    assert(
      likes.some(p => p.includes('knucklebones')),
      `like pattern should capture the quoted preference, got ${JSON.stringify(likes)}`,
    );

    // ── Idempotency: rebuild N more times, nothing may drift ───────
    for (let i = 0; i < 5; i++) rebuildProfile(config, signals);
    const after = loadProfile(config);

    assert(
      after.topicPreferences.code.signalCount === first.topicPreferences.code.signalCount,
      `signalCount inflated across rebuilds: ${first.topicPreferences.code.signalCount} -> ${after.topicPreferences.code.signalCount}`,
    );
    assert(
      after.topicPreferences.code.satisfaction === first.topicPreferences.code.satisfaction,
      `satisfaction drifted across rebuilds: ${first.topicPreferences.code.satisfaction} -> ${after.topicPreferences.code.satisfaction}`,
    );
    assert(
      after.stylePreferences.verbosity === first.stylePreferences.verbosity,
      `verbosity drifted across rebuilds: ${first.stylePreferences.verbosity} -> ${after.stylePreferences.verbosity}`,
    );
    assert(
      after.stylePreferences.avoidPatterns.length === first.stylePreferences.avoidPatterns.length,
      'avoidPatterns grew across rebuilds',
    );

    // signalCount now reflects reality: 4 code-category signals.
    assert(
      after.topicPreferences.code.signalCount === 4,
      `code signalCount should equal actual signals (4), got ${after.topicPreferences.code.signalCount}`,
    );

    console.error('profile-rebuild OK');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('profile-rebuild FAIL:', err);
  process.exit(1);
});
