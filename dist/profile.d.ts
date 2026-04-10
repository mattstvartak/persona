import type { BehavioralProfile, BehavioralSignal, PersonaConfig } from './types.js';
export declare function loadProfile(config: PersonaConfig): BehavioralProfile;
/**
 * Rebuild profile from current signal history.
 */
export declare function rebuildProfile(config: PersonaConfig, signals: BehavioralSignal[]): BehavioralProfile;
