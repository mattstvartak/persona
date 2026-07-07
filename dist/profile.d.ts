import type { BehavioralProfile, BehavioralSignal, PersonaConfig } from './types.js';
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
export declare function loadProfile(_config: PersonaConfig): BehavioralProfile;
/**
 * Persist a profile directly. Used by feedback pin/unpin which mutates
 * profile fields outside the signal-rebuild path.
 */
export declare function saveProfileExternal(config: PersonaConfig, profile: BehavioralProfile): void;
/**
 * Rebuild profile from current signal history.
 */
export declare function rebuildProfile(config: PersonaConfig, signals: BehavioralSignal[]): BehavioralProfile;
