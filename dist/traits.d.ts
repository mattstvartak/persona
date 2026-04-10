import type { BigFiveTraits, StyleVector } from './types.js';
/**
 * Update Big Five traits using exponential moving average.
 * Traits update slowly (EMA decay 0.95) to represent stable personality.
 */
export declare function updateBigFive(current: BigFiveTraits, message: string): BigFiveTraits;
/**
 * Compute a style vector from a message.
 * 5 dimensions: formality, energy, verbosity, humor, specificity.
 */
export declare function computeStyleVector(message: string): StyleVector;
/**
 * Compute target response style: 0.7 * user + 0.3 * baseline.
 * The 0.3 baseline prevents full mirroring of extreme states.
 */
export declare function computeTargetStyle(userStyle: StyleVector, baseline: StyleVector): StyleVector;
/**
 * Update a baseline style vector with EMA.
 * This is the slow-moving "who this user is" style, not the per-message read.
 */
export declare function updateBaselineStyle(current: StyleVector, observation: StyleVector): StyleVector;
