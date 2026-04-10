import type { PersonaConfig, SessionState } from './types.js';
export interface ConsolidationResult {
    sessionsAnalyzed: number;
    traitUpdates: string[];
    emotionalDecay: number;
    contradictions: string[];
    styleShift: boolean;
}
/**
 * Run the full consolidation pass.
 * Call this between sessions or periodically.
 */
export declare function runConsolidation(config: PersonaConfig): ConsolidationResult;
/**
 * Record a session summary for future consolidation.
 */
export declare function recordSessionSummary(config: PersonaConfig, session: SessionState, signalCounts: Record<string, number>): void;
