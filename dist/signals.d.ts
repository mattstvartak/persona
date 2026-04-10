import type { BehavioralSignal, SignalType, PersonaConfig } from './types.js';
export declare function loadSignals(config: PersonaConfig): BehavioralSignal[];
/**
 * Record a new behavioral signal.
 */
export declare function recordSignal(config: PersonaConfig, type: SignalType, content: string, context?: string, category?: string): BehavioralSignal;
/**
 * Get signal counts by type.
 */
export declare function getSignalCounts(signals: BehavioralSignal[]): Record<SignalType, number>;
/**
 * Get recent signals within a time window.
 */
export declare function getRecentSignals(signals: BehavioralSignal[], daysBack?: number): BehavioralSignal[];
