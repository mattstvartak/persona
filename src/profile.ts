import type {
  BehavioralProfile,
  BehavioralSignal,
  PersonaConfig,
  StylePreferences,
} from './types.js';
import { DEFAULT_PROFILE, DEFAULT_STYLE_PREFERENCES } from './types.js';
import { getSignalCounts, getRecentSignals } from './signals.js';
import { getStorage } from './storage/index.js';

/**
 * Behavioral profile -- aggregated view of user preferences built from signals.
 *
 * The profile tracks style preferences (verbosity, code-first, etc.),
 * per-topic adjustments, satisfaction rates, and explicit feedback.
 *
 * The rebuild is DETERMINISTIC: derived fields are reset and recomputed
 * by replaying the signal history in timestamp order. rebuildProfile
 * fires on every voice_signal call, so anything that mutates persisted
 * state incrementally gets re-applied once per rebuild instead of once
 * per signal — that bug is how a live profile ended up with
 * topicPreferences.code.signalCount = 241 against 32 total signals, a
 * verbosity pinned at 0.92, and per-topic satisfaction saturated at the
 * clamp. Replaying from scratch makes rebuild(signals) a pure function
 * of the signal history (plus pinnedFeedback, which is user-curated and
 * never derived).
 */

export function loadProfile(_config: PersonaConfig): BehavioralProfile {
  return getStorage().getProfile() ?? { ...DEFAULT_PROFILE };
}

/**
 * Persist a profile directly. Used by feedback pin/unpin which mutates
 * profile fields outside the signal-rebuild path.
 */
export function saveProfileExternal(config: PersonaConfig, profile: BehavioralProfile): void {
  saveProfile(config, profile);
}

function saveProfile(_config: PersonaConfig, profile: BehavioralProfile): void {
  profile.lastUpdated = new Date().toISOString();
  getStorage().putProfile(profile);
}

/**
 * Rebuild profile from current signal history.
 */
export function rebuildProfile(config: PersonaConfig, signals: BehavioralSignal[]): BehavioralProfile {
  const profile = loadProfile(config);
  const recent = getRecentSignals(signals, 30);
  const counts = getSignalCounts(recent);
  const total = recent.length || 1;

  // ── Reset derived state ───────────────────────────────────────
  // Everything below is recomputed from signals. pinnedFeedback is the
  // only user-curated field and survives untouched.
  profile.stylePreferences = { ...DEFAULT_STYLE_PREFERENCES, avoidPatterns: [], preferredPatterns: [], deepDiveTopics: [], quickAnswerTopics: [] };
  profile.topicPreferences = {};
  profile.recentFeedback = [];

  // ── Stats ─────────────────────────────────────────────────────
  profile.stats.totalSignals = signals.length;
  profile.stats.correctionRate = (counts.correction ?? 0) / total;
  profile.stats.approvalRate = ((counts.approval ?? 0) + (counts.praise ?? 0)) / total;
  profile.stats.frustrationRate = ((counts.frustration ?? 0) + (counts.abandonment ?? 0)) / total;

  // Satisfaction: approvals and praise increase, corrections and frustration decrease
  const positives = (counts.approval ?? 0) + (counts.praise ?? 0) + (counts.code_accepted ?? 0);
  const negatives = (counts.correction ?? 0) + (counts.frustration ?? 0) + (counts.code_rejected ?? 0) + (counts.abandonment ?? 0);
  profile.stats.avgSatisfaction = total > 0 ? Math.max(0, Math.min(1, 0.5 + (positives - negatives) / (total * 2))) : 0.5;

  const prefs = profile.stylePreferences;

  // ── Replay signals in order ───────────────────────────────────
  // Per-signal deltas are the same magnitudes as before; the change is
  // that each signal is applied exactly once per rebuild (starting from
  // the reset baseline) instead of the whole window being re-applied on
  // top of last rebuild's output.
  const ordered = [...recent].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const signal of ordered) {
    // Global verbosity: elaboration pushes up, simplification pushes
    // down. EMA per signal so later signals weigh more.
    if (signal.type === 'elaboration' || signal.type === 'curiosity') {
      prefs.verbosity = clamp(prefs.verbosity * 0.8 + 0.2, -1, 1);
    }
    if (signal.type === 'simplification') {
      prefs.verbosity = clamp(prefs.verbosity * 0.8 - 0.2, -1, 1);
    }

    if (signal.type === 'style_correction' || signal.type === 'correction') {
      extractStylePatterns(signal, prefs);
    }
    if (signal.type === 'praise') {
      extractPreferredPatterns(signal, prefs);
    }
    if (signal.type === 'explicit_feedback') {
      // Pinned is the canonical home; don't let recent shadow it.
      const inPinned = (profile.pinnedFeedback ?? []).includes(signal.content);
      if (!inPinned && !profile.recentFeedback.includes(signal.content)) {
        profile.recentFeedback.push(signal.content);
        if (profile.recentFeedback.length > 10) {
          profile.recentFeedback = profile.recentFeedback.slice(-10);
        }
      }
    }

    // ── Topic preferences ─────────────────────────────────────
    if (signal.category) {
      const cat = signal.category;
      if (!profile.topicPreferences[cat]) {
        profile.topicPreferences[cat] = { verbosity: 0, satisfaction: 0.5, signalCount: 0 };
      }
      const tp = profile.topicPreferences[cat];
      tp.signalCount++;

      if (signal.type === 'elaboration' || signal.type === 'curiosity') tp.verbosity = clamp(tp.verbosity + 0.1, -1, 1);
      if (signal.type === 'simplification') tp.verbosity = clamp(tp.verbosity - 0.1, -1, 1);
      if (
        signal.type === 'approval' ||
        signal.type === 'praise' ||
        signal.type === 'satisfaction' ||
        signal.type === 'task_complete'
      ) {
        tp.satisfaction = clamp(tp.satisfaction + 0.05, 0, 1);
      }
      if (
        signal.type === 'correction' ||
        signal.type === 'frustration' ||
        signal.type === 'confusion' ||
        signal.type === 'task_abandoned'
      ) {
        tp.satisfaction = clamp(tp.satisfaction - 0.05, 0, 1);
      }
    }
  }

  // Update deep-dive / quick-answer lists from topic preferences
  prefs.deepDiveTopics = Object.entries(profile.topicPreferences)
    .filter(([, v]) => v.verbosity > 0.3 && v.signalCount >= 3)
    .map(([k]) => k);

  prefs.quickAnswerTopics = Object.entries(profile.topicPreferences)
    .filter(([, v]) => v.verbosity < -0.3 && v.signalCount >= 3)
    .map(([k]) => k);

  saveProfile(config, profile);
  return profile;
}

// ── Pattern extraction from signal content ──────────────────────────
//
// Signal content is usually a narrated observation that QUOTES the
// user ('User reacted positive ("Honestly I love knucklebones") to the
// title suggestion.'), not the user's raw words. The old extractors ran
// an unbounded `.{5,60}` window over the whole lowercased string, so a
// trigger word anywhere — inside the quote, inside the narration —
// captured straight across quote and clause boundaries. Live profiles
// accumulated fragments like `knucklebones") to the knucklebones title
// suggestion.` as "preferences".
//
// Now: when the content contains quoted spans, only the quoted spans
// (the user's actual words) are searched; captures stop at clause
// boundaries and never end mid-word.

/** Pull double-quoted spans out of a signal's content. */
function quotedSpans(text: string): string[] {
  const spans: string[] = [];
  const re = /"([^"]{3,200})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) spans.push(m[1]);
  return spans;
}

/** Search scope for pattern triggers: quoted user speech when present, whole content otherwise. */
function extractionScopes(signal: BehavioralSignal): string[] {
  const scopes = quotedSpans(signal.content);
  return scopes.length > 0 ? scopes : [signal.content];
}

/** Clause-bounded capture: no quotes, parens, sentence punctuation, or dashes. */
const CLAUSE = `([^"'().!?;\\n\\u2014\\u2013]{5,60})`;

/** Trim a capped capture back to the last complete word. */
function tidyCapture(raw: string): string {
  let out = raw.trim().replace(/[,:\s]+$/, '');
  if (raw.length >= 60 && /\S/.test(out)) {
    const lastSpace = out.lastIndexOf(' ');
    if (lastSpace > 10) out = out.slice(0, lastSpace);
  }
  return out;
}

function pushPattern(list: string[], pattern: string): void {
  if (pattern.length < 5) return;
  if (!list.includes(pattern)) {
    list.push(pattern);
    if (list.length > 20) list.splice(0, list.length - 20);
  }
}

const AVOID_RE = new RegExp(`\\b(?:don't|do not|stop|never|no more)\\s+${CLAUSE}`);
const LIKE_RE = new RegExp(`\\b(?:love|like|prefer|keep)\\s+(?:the |this |that |how you )?${CLAUSE}`);

function extractStylePatterns(signal: BehavioralSignal, prefs: StylePreferences): void {
  const lower = signal.content.toLowerCase();

  // Code-first detection
  if (lower.includes('show code') || lower.includes('code first')) {
    prefs.prefersCodeFirst = true;
  }
  if (lower.includes('explain first') || lower.includes('explain before')) {
    prefs.prefersCodeFirst = false;
  }

  // Bullet preference
  if (lower.includes('bullet') || lower.includes('list')) {
    prefs.prefersBulletPoints = true;
  }

  // Direct answers
  if (lower.includes('just answer') || lower.includes('straight answer') || lower.includes('get to the point')) {
    prefs.prefersDirectAnswers = true;
    prefs.verbosity = clamp(prefs.verbosity - 0.2, -1, 1);
  }

  // Avoid patterns — only from the user's own words, clause-bounded
  for (const scope of extractionScopes(signal)) {
    const avoidMatches = scope.toLowerCase().match(AVOID_RE);
    if (avoidMatches) {
      pushPattern(prefs.avoidPatterns, tidyCapture(avoidMatches[1]));
      break;
    }
  }

  // Opinion strength
  if (lower.includes('your opinion') || lower.includes('what do you think')) {
    prefs.opinionStrength = clamp(prefs.opinionStrength + 0.1, -1, 1);
  }
  if (lower.includes('just the facts') || lower.includes('no opinion')) {
    prefs.opinionStrength = clamp(prefs.opinionStrength - 0.2, -1, 1);
  }
}

function extractPreferredPatterns(signal: BehavioralSignal, prefs: StylePreferences): void {
  // Positive pattern signals — only from the user's own words. 'perfect'
  // and 'exactly' were dropped as capture triggers: they're approval
  // markers, and whatever follows them ("perfect, thanks") is not a
  // reusable preference.
  for (const scope of extractionScopes(signal)) {
    const likeMatches = scope.toLowerCase().match(LIKE_RE);
    if (likeMatches) {
      pushPattern(prefs.preferredPatterns, tidyCapture(likeMatches[1]));
      break;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
