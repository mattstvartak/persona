import type { EvolutionProposal, BehavioralSignal, PersonaConfig } from './types.js';
export declare function loadProposals(config: PersonaConfig): EvolutionProposal[];
/**
 * Generate evolution proposals from accumulated signals.
 * Uses heuristic pattern detection -- no LLM needed.
 */
export declare function generateProposals(config: PersonaConfig, signals: BehavioralSignal[]): EvolutionProposal[];
export declare function applyProposal(config: PersonaConfig, proposalId: string): {
    success: boolean;
    message: string;
};
export declare function rejectProposal(config: PersonaConfig, proposalId: string): {
    success: boolean;
    message: string;
};
