import type { PersonaConfig, SessionState } from './types.js';
export declare function setSessionState(session: SessionState): void;
export declare function getSessionState(): SessionState;
export declare function getAdaptations(config: PersonaConfig, category?: string): string;
/**
 * Get a summary of the current profile for display.
 */
export declare function getProfileSummary(config: PersonaConfig): string;
