import type { BigFiveTraits, StyleVector } from './types.js';
import { DEFAULT_BIG_FIVE, DEFAULT_STYLE_VECTOR } from './types.js';

/**
 * Big Five (OCEAN) personality trait inference from text signals.
 *
 * Based on psychometric research mapping behavioral signals to trait dimensions.
 * Uses exponential moving average with 0.95 decay per interaction.
 * Requires ~15-20 interactions before marking scores as reliable.
 *
 * Also computes a 5-dimensional style mirroring vector based on the
 * chameleon effect (Chartrand & Bargh, 1999). Target response style =
 * 0.7 * user_style + 0.3 * baseline, preventing full mirroring of
 * extreme states.
 */

const EMA_DECAY = 0.95;
const RELIABILITY_THRESHOLD = 15;

// ── Big Five Inference ─────────────────────────────────────────────

/**
 * Infer Big Five trait signals from a single message.
 * Returns raw observation scores (0-1) per trait.
 */
function inferTraitSignals(message: string): Omit<BigFiveTraits, 'sampleCount' | 'reliable'> {
  const lower = message.toLowerCase();
  const words = message.split(/\s+/);
  const wordCount = words.length || 1;

  // ── Openness ──────────────────────────────────────────────
  // Vocabulary diversity (type-token ratio), hypotheticals, topic variety
  const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, '')).filter(w => w.length > 2));
  const typeTokenRatio = uniqueWords.size / wordCount;
  const hypotheticals = (lower.match(/\b(what if|imagine|consider|could we|would it|explore|alternative|maybe we could)\b/g) || []).length;
  const openness = clamp(typeTokenRatio * 0.7 + Math.min(1, hypotheticals / 3) * 0.3, 0, 1);

  // ── Conscientiousness ─────────────────────────────────────
  // Structure markers, specificity, follow-through language
  const structureMarkers = (message.match(/^\s*[-*\d.]+/gm) || []).length;  // bullets/numbers
  const specifics = (lower.match(/\b(specifically|exactly|precisely|steps?|first|second|third|ensure|verify|check)\b/g) || []).length;
  const conscientiousness = clamp(
    Math.min(1, structureMarkers / 3) * 0.4 +
    Math.min(1, specifics / 4) * 0.3 +
    (wordCount > 50 ? 0.3 : wordCount > 20 ? 0.15 : 0),
    0, 1
  );

  // ── Extraversion ──────────────────────────────────────────
  // Message length, exclamation marks, personal anecdotes, social references
  const exclamations = (message.match(/!/g) || []).length;
  const socialRefs = (lower.match(/\b(my friend|my team|we|us|everyone|people|told me|said)\b/g) || []).length;
  const personalAnecdotes = (lower.match(/\b(I was|I went|I did|I had|one time|yesterday I|last week I)\b/g) || []).length;
  const extraversion = clamp(
    Math.min(1, exclamations / 3) * 0.25 +
    Math.min(1, socialRefs / 3) * 0.25 +
    Math.min(1, personalAnecdotes / 2) * 0.25 +
    Math.min(1, wordCount / 200) * 0.25,
    0, 1
  );

  // ── Agreeableness ─────────────────────────────────────────
  // Hedging, gratitude, conflict avoidance, softening
  const hedges = (lower.match(/\b(maybe|perhaps|I think|I guess|sort of|kind of|if that's ok|no worries|sorry)\b/g) || []).length;
  const gratitude = (lower.match(/\b(thanks|thank you|appreciate|grateful|please|kindly)\b/g) || []).length;
  const bluntness = (lower.match(/\b(just do|wrong|no\.|stop|don't|fix this|broken)\b/g) || []).length;
  const agreeableness = clamp(
    (Math.min(1, hedges / 4) * 0.35 + Math.min(1, gratitude / 3) * 0.35) -
    Math.min(0.5, bluntness / 4) * 0.3 + 0.3,  // 0.3 baseline
    0, 1
  );

  // ── Neuroticism ───────────────────────────────────────────
  // Negative emotion words, catastrophizing, reassurance-seeking
  const negativeWords = (lower.match(/\b(frustrated|annoyed|worried|stressed|broken|failing|terrible|awful|panic|impossible|never works)\b/g) || []).length;
  const catastrophizing = (lower.match(/\b(everything|always|never|nothing works|completely|totally broken)\b/g) || []).length;
  const reassurance = (lower.match(/\b(right\?|is that ok|does that make sense|am I wrong|should I)\b/g) || []).length;
  const neuroticism = clamp(
    Math.min(1, negativeWords / 4) * 0.4 +
    Math.min(1, catastrophizing / 3) * 0.35 +
    Math.min(1, reassurance / 3) * 0.25,
    0, 1
  );

  return { openness, conscientiousness, extraversion, agreeableness, neuroticism };
}

/**
 * Update Big Five traits using exponential moving average.
 * Traits update slowly (EMA decay 0.95) to represent stable personality.
 */
export function updateBigFive(current: BigFiveTraits, message: string): BigFiveTraits {
  const signals = inferTraitSignals(message);
  const count = current.sampleCount + 1;

  return {
    openness: ema(current.openness, signals.openness),
    conscientiousness: ema(current.conscientiousness, signals.conscientiousness),
    extraversion: ema(current.extraversion, signals.extraversion),
    agreeableness: ema(current.agreeableness, signals.agreeableness),
    neuroticism: ema(current.neuroticism, signals.neuroticism),
    sampleCount: count,
    reliable: count >= RELIABILITY_THRESHOLD,
  };
}

function ema(current: number, observation: number): number {
  return current * EMA_DECAY + observation * (1 - EMA_DECAY);
}

// ── Style Vector Computation ───────────────────────────────────────

/**
 * Compute a style vector from a message.
 * 5 dimensions: formality, energy, verbosity, humor, specificity.
 */
export function computeStyleVector(message: string): StyleVector {
  const lower = message.toLowerCase();
  const words = message.split(/\s+/);
  const wordCount = words.length || 1;

  // Formality: formal markers vs informal markers
  let formality = 0.5;
  const formalMarkers = (lower.match(/\b(please|kindly|would you|could you|appreciate|regards|dear)\b/g) || []).length;
  const informalMarkers = (lower.match(/\b(gonna|wanna|gotta|lol|lmao|haha|bruh|dude|nah|yep|yeah|hey|yo)\b/g) || []).length;
  if (formalMarkers + informalMarkers > 0) {
    formality = clamp(0.5 + (formalMarkers - informalMarkers) * 0.15, 0, 1);
  }

  // Energy: exclamations, caps, intensifiers
  const exclamations = (message.match(/!/g) || []).length;
  const caps = (message.match(/\b[A-Z]{2,}\b/g) || []).length;
  const intensifiers = (lower.match(/\b(very|really|super|extremely|absolutely|totally|so)\b/g) || []).length;
  const energy = clamp((exclamations + caps + intensifiers) / Math.max(5, wordCount * 0.15), 0, 1);

  // Verbosity: raw message length
  const verbosity = clamp(wordCount / 150, 0, 1);

  // Humor: humor markers
  const humorMarkers = (lower.match(/\b(lol|lmao|haha|heh|rofl|jk|kidding|xd|:D|;\))\b/gi) || []).length;
  const sarcasm = (lower.match(/\b(obviously|surely|clearly|right\?|wow)\b/gi) || []).length;
  const humor = clamp((humorMarkers + sarcasm * 0.5) / Math.max(3, wordCount * 0.1), 0, 1);

  // Specificity: concrete references vs abstract language
  const concreteRefs = (lower.match(/\b(file|line|function|error|version|port|path|url|api|endpoint|\d+)\b/g) || []).length;
  const abstractRefs = (lower.match(/\b(concept|idea|approach|strategy|philosophy|theory|generally|overall)\b/g) || []).length;
  const specificity = concreteRefs + abstractRefs > 0
    ? clamp(concreteRefs / (concreteRefs + abstractRefs), 0, 1)
    : 0.5;

  return { formality, energy, verbosity, humor, specificity };
}

/**
 * Compute target response style: 0.7 * user + 0.3 * baseline.
 * The 0.3 baseline prevents full mirroring of extreme states.
 */
export function computeTargetStyle(userStyle: StyleVector, baseline: StyleVector): StyleVector {
  return {
    formality: userStyle.formality * 0.7 + baseline.formality * 0.3,
    energy: userStyle.energy * 0.7 + baseline.energy * 0.3,
    verbosity: userStyle.verbosity * 0.7 + baseline.verbosity * 0.3,
    humor: userStyle.humor * 0.7 + baseline.humor * 0.3,
    specificity: userStyle.specificity * 0.7 + baseline.specificity * 0.3,
  };
}

/**
 * Update a baseline style vector with EMA.
 * This is the slow-moving "who this user is" style, not the per-message read.
 */
export function updateBaselineStyle(current: StyleVector, observation: StyleVector): StyleVector {
  return {
    formality: ema(current.formality, observation.formality),
    energy: ema(current.energy, observation.energy),
    verbosity: ema(current.verbosity, observation.verbosity),
    humor: ema(current.humor, observation.humor),
    specificity: ema(current.specificity, observation.specificity),
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
