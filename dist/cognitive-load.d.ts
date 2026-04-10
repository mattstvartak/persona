import type { CognitiveLoadState } from './types.js';
/**
 * Update cognitive load state from a new message.
 * Returns updated state with flow/overload detection.
 */
export declare function updateCognitiveLoad(state: CognitiveLoadState, message: string, previousMessage?: string): CognitiveLoadState;
/**
 * Get verbosity recommendation based on cognitive load.
 * Returns a multiplier: <1 means be more concise, >1 means can be verbose.
 */
export declare function getVerbosityMultiplier(state: CognitiveLoadState): number;
