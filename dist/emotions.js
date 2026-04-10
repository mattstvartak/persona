import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { NEUTRAL_TONE, DEFAULT_TRAIT_STATE } from './types.js';
/**
 * Emotional tone detection based on Plutchik's wheel of emotions.
 *
 * 8 primary emotions as basis vectors. Compound emotions emerge naturally
 * from the vector (contempt = anger + disgust, awe = surprise + fear, etc.)
 *
 * Also detects "text micro-expressions" -- involuntary leakage through
 * punctuation shifts, message length changes, lexical regression, and
 * pronoun shifts. Based on Ekman's micro-expression research adapted for text.
 *
 * Emotional associations form asymmetrically: negative associations in 1-2
 * exposures (learning rate 0.8), positive need 5-10 (learning rate 0.2).
 * Modeled after amygdala emotional memory encoding.
 */
// ── Lexicons ───────────────────────────────────────────────────────
const EMOTION_LEXICON = {
    joy: [
        /\b(happy|glad|great|awesome|love|perfect|excellent|amazing|wonderful|fantastic|nice|cool|sweet|yay|yep|yes)\b/i,
        /\b(haha|lol|lmao|rofl|😊|😄|🎉|❤️)\b/i,
        /(!{2,})/,
    ],
    trust: [
        /\b(trust|reliable|solid|consistent|dependable|sure|definitely|absolutely|agree|exactly|right)\b/i,
        /\b(thanks|thank you|appreciate|grateful)\b/i,
    ],
    fear: [
        /\b(afraid|scared|worried|nervous|anxious|panic|terrified|dread|risky|dangerous)\b/i,
        /\b(careful|watch out|be careful|warning|uh oh)\b/i,
    ],
    surprise: [
        /\b(wow|whoa|really|seriously|no way|wait what|holy|damn|unexpected|shocking)\b/i,
        /\b(didn't expect|surprised|huh|wtf|omg)\b/i,
        /(\?{2,})/,
    ],
    sadness: [
        /\b(sad|disappointed|unfortunately|sucks|miss|lost|gone|depressing|bummer|damn)\b/i,
        /\b(too bad|wish|if only|regret)\b/i,
        /\.{3,}/, // trailing ellipses
    ],
    disgust: [
        /\b(gross|disgusting|awful|terrible|horrible|worst|hate|despise|ugh|ew|yuck)\b/i,
        /\b(garbage|trash|crap|crapshoot|dumpster)\b/i,
    ],
    anger: [
        /\b(angry|furious|pissed|frustrated|annoyed|mad|rage|stupid|ridiculous|insane)\b/i,
        /\b(wtf|bs|bullshit|fuck|shit|dammit|damn)\b/i,
        /[A-Z]{3,}/, // SHOUTING
    ],
    anticipation: [
        /\b(hope|expect|looking forward|can't wait|excited|soon|plan|going to|gonna|want to|need to)\b/i,
        /\b(next|upcoming|tomorrow|later|ready)\b/i,
    ],
};
// ── Core Detection ─────────────────────────────────────────────────
/**
 * Detect emotional tone from a single message.
 * Returns an 8-dimensional vector with scores 0-1 per emotion.
 */
export function detectEmotionalTone(message) {
    const tone = { ...NEUTRAL_TONE };
    const lower = message.toLowerCase();
    const wordCount = message.split(/\s+/).length || 1;
    for (const [emotion, patterns] of Object.entries(EMOTION_LEXICON)) {
        let hits = 0;
        for (const pattern of patterns) {
            const matches = message.match(pattern);
            if (matches)
                hits += matches.length;
        }
        // Normalize by message length, cap at 1
        tone[emotion] = Math.min(1, hits / Math.max(3, wordCount * 0.3));
    }
    // Boost from micro-expression signals
    const microSignals = detectMicroExpressions(message);
    if (microSignals.energyDrop) {
        tone.sadness = Math.min(1, tone.sadness + 0.2);
        tone.anger = Math.min(1, tone.anger + 0.1);
    }
    if (microSignals.shouting) {
        tone.anger = Math.min(1, tone.anger + 0.3);
    }
    if (microSignals.hedging) {
        tone.fear = Math.min(1, tone.fear + 0.15);
    }
    return tone;
}
export function detectMicroExpressions(message) {
    const words = message.split(/\s+/);
    return {
        energyDrop: false, // needs message history, handled in session tracking
        shouting: (message.match(/\b[A-Z]{3,}\b/g) || []).length >= 2,
        hedging: countHedges(message) >= 3,
        lexicalRegression: false, // needs message history
        pronounShift: false, // needs message history
    };
}
function countHedges(message) {
    const hedges = /\b(maybe|perhaps|possibly|sort of|kind of|I think|I guess|not sure|might|probably|seems like)\b/gi;
    return (message.match(hedges) || []).length;
}
// ── Emotional Valence (collapsed to single value) ──────────────────
/**
 * Collapse the 8-dim vector to a single valence score (-1 to 1).
 * Positive emotions push toward 1, negative toward -1.
 */
export function emotionalValence(tone) {
    const positive = tone.joy + tone.trust + tone.anticipation + tone.surprise * 0.3;
    const negative = tone.anger + tone.sadness + tone.disgust + tone.fear;
    const total = positive + negative || 1;
    return (positive - negative) / total;
}
/**
 * Collapse to arousal (0 to 1). High-activation emotions push up.
 */
export function emotionalArousal(tone) {
    const highArousal = tone.anger + tone.joy + tone.surprise + tone.anticipation + tone.fear;
    const lowArousal = tone.sadness + tone.trust;
    const total = highArousal + lowArousal || 1;
    return highArousal / total;
}
// ── Emotional Associations (amygdala-inspired) ─────────────────────
function traitStatePath(config) {
    return join(config.dataDir, 'trait-state.json');
}
export function loadTraitState(config) {
    const path = traitStatePath(config);
    if (!existsSync(path))
        return { ...DEFAULT_TRAIT_STATE };
    try {
        const raw = JSON.parse(readFileSync(path, 'utf-8'));
        return { ...DEFAULT_TRAIT_STATE, ...raw };
    }
    catch {
        return { ...DEFAULT_TRAIT_STATE };
    }
}
export function saveTraitState(config, state) {
    const path = traitStatePath(config);
    const dir = dirname(path);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
}
/**
 * Update emotional associations for a topic.
 * Negative associations form fast (amygdala one-shot learning),
 * positive associations form slowly (needs repeated exposure).
 */
export function updateEmotionalAssociation(state, topic, valence, arousal) {
    const existing = state.emotionalAssociations.find(a => a.topic === topic);
    // Asymmetric learning rates: negative fast (0.8), positive slow (0.2)
    const lr = valence < 0 ? 0.8 : 0.2;
    if (existing) {
        existing.valence = existing.valence * (1 - lr) + valence * lr;
        existing.arousal = existing.arousal * (1 - lr) + arousal * lr;
        existing.exposureCount++;
        existing.lastSeen = new Date().toISOString();
    }
    else {
        state.emotionalAssociations.push({
            topic,
            valence: valence < 0 ? valence : valence * 0.5, // cautious on first positive
            arousal,
            exposureCount: 1,
            lastSeen: new Date().toISOString(),
        });
    }
    // Cap at 50 associations, drop oldest low-exposure ones
    if (state.emotionalAssociations.length > 50) {
        state.emotionalAssociations.sort((a, b) => b.exposureCount - a.exposureCount);
        state.emotionalAssociations = state.emotionalAssociations.slice(0, 50);
    }
}
/**
 * Check if a topic has a negative emotional association.
 * Returns the association if found and negative, null otherwise.
 */
export function getEmotionalFlag(state, topic) {
    const assoc = state.emotionalAssociations.find(a => topic.toLowerCase().includes(a.topic.toLowerCase()) && a.valence < -0.3);
    return assoc ?? null;
}
//# sourceMappingURL=emotions.js.map