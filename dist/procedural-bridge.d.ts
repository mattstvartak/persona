import type { PersonaConfig } from './types.js';
export declare function exportProposalsToBridge(config: PersonaConfig): number;
export declare function importRulesFromBridge(config: PersonaConfig): {
    imported: number;
    skipped: number;
    conflicts: string[];
};
export declare function syncBridge(config: PersonaConfig): {
    exported: number;
    imported: number;
    skipped: number;
    conflicts: string[];
};
