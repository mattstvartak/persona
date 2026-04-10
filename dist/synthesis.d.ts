import type { PersonaConfig } from './types.js';
import { loadProfile } from './profile.js';
/**
 * Personality synthesis -- builds soul files organically from user interactions.
 *
 * Instead of starting with a predefined personality, the system observes
 * the user's communication patterns and gradually constructs a personality
 * that complements their style. The AI becomes a natural fit for THIS user.
 *
 * Traits are extracted from:
 *   1. User message patterns (how they write, not what they write)
 *   2. Behavioral signals (what they approve/correct/praise)
 *   3. Accumulated preferences in the profile
 *
 * Soul files start empty and get written as traits emerge with enough evidence.
 */
export interface CommunicationTraits {
    avgMessageLength: number;
    avgSentenceLength: number;
    usesEmoji: boolean;
    usesSlang: boolean;
    formalityLevel: number;
    technicalDepth: number;
    humorFrequency: number;
    directness: number;
    questionStyle: 'exploratory' | 'direct' | 'mixed';
    usesExclamations: boolean;
    usesProfanity: boolean;
    prefersTerse: boolean;
    sampleSize: number;
}
/**
 * Analyze a batch of user messages to extract communication traits.
 */
export declare function analyzeUserMessages(messages: string[]): CommunicationTraits;
/**
 * Synthesize personality from accumulated traits and signals.
 * Generates soul file content that emerges from actual interactions.
 */
export declare function synthesizePersonality(config: PersonaConfig, traits: CommunicationTraits, profile?: ReturnType<typeof loadProfile>): {
    personality: string;
    style: string;
    skill: string;
};
/**
 * Run synthesis and update soul files if enough evidence exists.
 * Returns what changed.
 */
export declare function updateSoulFromSynthesis(config: PersonaConfig, messages: string[]): {
    updated: boolean;
    traits: CommunicationTraits;
    changes: string[];
};
