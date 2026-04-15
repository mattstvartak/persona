#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { readSoulFile, readAllSoulFiles, writeSoulFile, initSoulFiles, buildSoulContext } from './soul.js';
import { recordSignal, loadSignals, getSignalCounts } from './signals.js';
import { loadProfile, rebuildProfile } from './profile.js';
import { getAdaptations, getProfileSummary, setSessionState } from './adaptations.js';
import { generateProposals, loadProposals, applyProposal, rejectProposal } from './evolution.js';
import { analyzeUserMessages, updateSoulFromSynthesis } from './synthesis.js';
import { detectEmotionalTone, emotionalValence, detectDyads, loadTraitState, saveTraitState, updateEmotionalAssociation } from './emotions.js';
import { updateBigFive, computeStyleVector, updateBaselineStyle } from './traits.js';
import { updateCognitiveLoad } from './cognitive-load.js';
import { runConsolidation, recordSessionSummary } from './consolidation.js';
import { SOUL_FILE_NAMES, DEFAULT_SESSION_STATE } from './types.js';
const config = loadConfig();
// Initialize soul files with defaults on first run
const soulFiles = initSoulFiles(config);
// Initialize session state
let session = { ...DEFAULT_SESSION_STATE, startedAt: new Date().toISOString() };
setSessionState(session);
let lastUserMessage;
function text(t) { return { content: [{ type: 'text', text: t }] }; }
function json(data) { return text(JSON.stringify(data, null, 2)); }
// ── Helper: process a user message through all brain systems ───────
function processUserMessage(message) {
    // Emotional tone detection (Plutchik) -- now with message history for micro-expressions
    const tone = detectEmotionalTone(message, session.recentMessages);
    // Blend with existing session tone (EMA with 0.3 learning rate for session)
    for (const key of Object.keys(tone)) {
        session.emotionalTone[key] = session.emotionalTone[key] * 0.7 + tone[key] * 0.3;
    }
    // Style vector (chameleon effect mirroring)
    const msgStyle = computeStyleVector(message);
    for (const key of Object.keys(msgStyle)) {
        session.styleVector[key] = session.styleVector[key] * 0.7 + msgStyle[key] * 0.3;
    }
    // Cognitive load
    session.cognitiveLoad = updateCognitiveLoad(session.cognitiveLoad, message, lastUserMessage);
    // Big Five trait update (slow, cross-session)
    const traitState = loadTraitState(config);
    traitState.bigFive = updateBigFive(traitState.bigFive, message);
    traitState.baselineStyleVector = updateBaselineStyle(traitState.baselineStyleVector, msgStyle);
    saveTraitState(config, traitState);
    session.messageCount++;
    // Maintain rolling window of last 5 messages for micro-expression detection
    session.recentMessages = [...session.recentMessages, message].slice(-5);
    lastUserMessage = message;
    setSessionState(session);
}
// ── MCP Server ────────────────────────────────────────────────────
const soulContext = buildSoulContext(soulFiles);
const server = new McpServer({ name: 'persona', version: '2.0.0' }, {
    instructions: [
        '# Persona',
        'Adaptive personality system. Honest, not agreeable. Style emerges from interactions.',
        '',
        soulContext ? soulContext : '(Personality not yet formed -- interact to develop it.)',
        '',
        'YOUR JOB: Notice how the user reacts and record it. Every time they correct you, approve your approach, show frustration, ask you to elaborate or simplify — call persona_signal immediately. Don\'t wait. Don\'t batch. This is how you learn to work better with this specific person.',
        '',
        'Signal types: correction, approval, frustration, elaboration, simplification, praise, explicit_feedback, code_accepted, code_rejected, style_correction. Include what happened in the content field.',
        '',
        'After 5+ signals in a session, run persona_synthesize to update your personality profile.',
        '',
        'Brain systems (automatic): Plutchik emotional tone, style mirroring (70% user/30% baseline), cognitive load detection, Big Five traits (15+ interactions), emotional associations.',
        '',
        'Anti-sycophancy: never optimize for approval. Honesty overrides all adaptations.',
        '',
        'If engram/smart-memory available: memory = WHAT (facts), persona = HOW (tone, style).',
        '',
        'SLASH COMMANDS:',
        '/persona-evolve [generate|history] -- Review/apply evolution proposals.',
        '/persona-soul [personality|style|skill] [edit] -- View/edit soul files.',
        '/persona-profile [detailed] -- Show learned preferences and traits.',
        '/persona-analyze [sync] -- Analyze communication style; "sync" to apply.',
        '/persona-reset [preset] -- Reset or load preset (pair-programmer, mentor, analyst, creative, minimal).',
        '/persona-tune <instruction> -- Quick adjustment via natural language.',
    ].join('\n'),
});
// ─────────────────────────────────────────────────────────────────────
// CONTEXT & ADAPTATIONS
// ─────────────────────────────────────────────────────────────────────
server.registerTool('persona_context', {
    title: 'Get Persona Context',
    description: 'Get the full personality context (soul files + learned adaptations + brain state). Use at the start of complex interactions to calibrate your response style.',
    inputSchema: z.object({
        category: z.string().optional().describe('Topic category for category-specific adaptations (e.g. "code", "writing", "research").'),
        userMessage: z.string().optional().describe('Current user message to process through brain systems before generating context.'),
    }),
}, async ({ category, userMessage }) => {
    if (userMessage)
        processUserMessage(userMessage);
    const files = readAllSoulFiles(config);
    const soul = buildSoulContext(files);
    const adaptations = getAdaptations(config, category);
    const parts = [soul, adaptations].filter(Boolean);
    // Add session brain state summary
    const brainState = getBrainStateSummary();
    if (brainState)
        parts.push(brainState);
    return text(parts.join('\n\n') || 'No personality configured.');
});
server.registerTool('persona_adapt', {
    title: 'Get Adaptations',
    description: 'Get learned behavioral adaptations for the current context. Returns style adjustments based on accumulated user signals and brain state.',
    inputSchema: z.object({
        category: z.string().optional().describe('Topic category for specific adaptations.'),
        userMessage: z.string().optional().describe('Current user message to process.'),
    }),
}, async ({ category, userMessage }) => {
    if (userMessage)
        processUserMessage(userMessage);
    const adaptations = getAdaptations(config, category);
    return text(adaptations || 'No adaptations yet. Record signals to build a profile.');
});
// ─────────────────────────────────────────────────────────────────────
// SIGNAL RECORDING
// ─────────────────────────────────────────────────────────────────────
const VALID_SIGNALS = [
    'correction', 'approval', 'frustration', 'elaboration', 'simplification',
    'code_accepted', 'code_rejected', 'regen_request', 'explicit_feedback',
    'style_correction', 'praise', 'abandonment',
];
server.registerTool('persona_signal', {
    title: 'Record What You Noticed',
    description: 'The user just reacted to something you did — record it. Did they correct you? Approve your approach? Get frustrated? Ask for more detail? This is how you learn their preferences. Call this immediately when you notice a reaction, not later.',
    inputSchema: z.object({
        type: z.enum(VALID_SIGNALS).describe('Signal type.'),
        content: z.string().describe('What triggered the signal (the user\'s words or action).'),
        context: z.string().optional().describe('Surrounding context for the signal.'),
        category: z.string().optional().describe('Topic category (code, writing, research, etc.).'),
    }),
}, async ({ type, content, context, category }) => {
    const signal = recordSignal(config, type, content, context, category);
    // Process the content through brain systems
    processUserMessage(content);
    // Update emotional associations for the category
    if (category) {
        const traitState = loadTraitState(config);
        const valence = type === 'approval' || type === 'praise' || type === 'code_accepted' ? 0.5 :
            type === 'frustration' || type === 'anger' ? -0.8 :
                type === 'correction' || type === 'code_rejected' ? -0.4 : 0;
        if (valence !== 0) {
            updateEmotionalAssociation(traitState, category, valence, Math.abs(valence));
            saveTraitState(config, traitState);
        }
    }
    // Rebuild profile after each signal
    const signals = loadSignals(config);
    rebuildProfile(config, signals);
    // Check if we should generate proposals
    const profile = loadProfile(config);
    const pending = loadProposals(config).filter(p => p.status === 'pending');
    if (profile.stats.totalSignals > 0 &&
        profile.stats.totalSignals % config.proposalThreshold === 0 &&
        pending.length < 5) {
        const newProposals = generateProposals(config, signals);
        if (newProposals.length > 0) {
            return json({
                signal: { id: signal.id, type: signal.type },
                brainState: {
                    emotionalValence: emotionalValence(session.emotionalTone).toFixed(2),
                    cognitiveLoad: session.cognitiveLoad.load.toFixed(2),
                    inFlow: session.cognitiveLoad.inFlow,
                },
                newProposals: newProposals.map(p => ({
                    id: p.id, type: p.type, target: p.target,
                    content: p.content.slice(0, 100),
                    confidence: p.confidence,
                })),
                message: `Signal recorded. ${newProposals.length} new evolution proposal(s) generated.`,
            });
        }
    }
    return json({
        signal: { id: signal.id, type: signal.type },
        brainState: {
            emotionalValence: emotionalValence(session.emotionalTone).toFixed(2),
            cognitiveLoad: session.cognitiveLoad.load.toFixed(2),
            inFlow: session.cognitiveLoad.inFlow,
        },
        message: 'Signal recorded.',
    });
});
// ─────────────────────────────────────────────────────────────────────
// PROFILE & STATS
// ─────────────────────────────────────────────────────────────────────
server.registerTool('persona_profile', {
    title: 'View Profile',
    description: 'View the behavioral profile -- aggregated style preferences, satisfaction rates, topic patterns, Big Five traits, and style baseline built from recorded signals.',
    inputSchema: z.object({}),
}, async () => {
    const summary = getProfileSummary(config);
    return text(summary || 'No profile yet. Record signals to build one.');
});
server.registerTool('persona_stats', {
    title: 'Persona Stats',
    description: 'Overview of persona system: signal counts, profile state, pending proposals, soul file status, brain state, and trait progress.',
    inputSchema: z.object({}),
}, async () => {
    const signals = loadSignals(config);
    const counts = getSignalCounts(signals);
    const profile = loadProfile(config);
    const proposals = loadProposals(config);
    const files = readAllSoulFiles(config);
    const traitState = loadTraitState(config);
    return json({
        signals: {
            total: signals.length,
            byCounts: counts,
        },
        profile: {
            satisfaction: profile.stats.avgSatisfaction,
            correctionRate: profile.stats.correctionRate,
            approvalRate: profile.stats.approvalRate,
            verbosity: profile.stylePreferences.verbosity,
            topicCount: Object.keys(profile.topicPreferences).length,
        },
        brainState: {
            bigFive: {
                reliable: traitState.bigFive.reliable,
                sampleCount: traitState.bigFive.sampleCount,
                traits: traitState.bigFive.reliable ? {
                    openness: traitState.bigFive.openness.toFixed(2),
                    conscientiousness: traitState.bigFive.conscientiousness.toFixed(2),
                    extraversion: traitState.bigFive.extraversion.toFixed(2),
                    agreeableness: traitState.bigFive.agreeableness.toFixed(2),
                    neuroticism: traitState.bigFive.neuroticism.toFixed(2),
                } : 'building...',
            },
            emotionalAssociations: traitState.emotionalAssociations.length,
            sessionsAnalyzed: traitState.sessionsAnalyzed,
            lastConsolidation: traitState.lastConsolidation,
            sessionState: {
                messageCount: session.messageCount,
                cognitiveLoad: session.cognitiveLoad.load.toFixed(2),
                inFlow: session.cognitiveLoad.inFlow,
                overloaded: session.cognitiveLoad.overloaded,
                dominantEmotion: getDominantEmotion(),
                compoundEmotions: detectDyads(session.emotionalTone).slice(0, 3).map(d => d.name),
            },
        },
        proposals: {
            total: proposals.length,
            pending: proposals.filter(p => p.status === 'pending').length,
            applied: proposals.filter(p => p.status === 'applied').length,
            rejected: proposals.filter(p => p.status === 'rejected').length,
        },
        soulFiles: {
            personality: files.personality ? `${files.personality.length} chars` : 'not set',
            style: files.style ? `${files.style.length} chars` : 'not set',
            skill: files.skill ? `${files.skill.length} chars` : 'not set',
        },
        dataDir: config.dataDir,
    });
});
// ─────────────────────────────────────────────────────────────────────
// EVOLUTION PROPOSALS
// ─────────────────────────────────────────────────────────────────────
server.registerTool('persona_proposals', {
    title: 'List Proposals',
    description: 'List evolution proposals -- suggested personality changes based on accumulated behavioral evidence.',
    inputSchema: z.object({
        status: z.enum(['pending', 'applied', 'rejected', 'all']).optional().describe('Filter by status (default: pending).'),
    }),
}, async ({ status }) => {
    const proposals = loadProposals(config);
    const filtered = status === 'all' ? proposals : proposals.filter(p => p.status === (status ?? 'pending'));
    return json(filtered.map(p => ({
        id: p.id,
        type: p.type,
        target: p.target,
        action: p.action,
        content: p.content,
        rationale: p.rationale,
        confidence: p.confidence,
        status: p.status,
        createdAt: p.createdAt,
    })));
});
server.registerTool('persona_apply', {
    title: 'Apply Proposal',
    description: 'Apply a pending evolution proposal to the soul files.',
    inputSchema: z.object({
        proposalId: z.string().describe('The proposal ID to apply.'),
    }),
}, async ({ proposalId }) => {
    const result = applyProposal(config, proposalId);
    return text(result.message);
});
server.registerTool('persona_reject', {
    title: 'Reject Proposal',
    description: 'Reject a pending evolution proposal.',
    inputSchema: z.object({
        proposalId: z.string().describe('The proposal ID to reject.'),
    }),
}, async ({ proposalId }) => {
    const result = rejectProposal(config, proposalId);
    return text(result.message);
});
server.registerTool('persona_evolve', {
    title: 'Generate Proposals',
    description: 'Manually trigger evolution proposal generation from accumulated signals. Normally auto-triggers every N signals.',
    inputSchema: z.object({}),
}, async () => {
    const signals = loadSignals(config);
    const proposals = generateProposals(config, signals);
    if (proposals.length === 0) {
        return text('No new proposals. Need more signals or existing proposals cover current patterns.');
    }
    return json({
        generated: proposals.length,
        proposals: proposals.map(p => ({
            id: p.id, type: p.type, target: p.target,
            content: p.content, rationale: p.rationale,
            confidence: p.confidence,
        })),
    });
});
// ─────────────────────────────────────────────────────────────────────
// SOUL FILE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────
server.registerTool('persona_read', {
    title: 'Read Soul File',
    description: 'Read a soul file (personality, style, or skill).',
    inputSchema: z.object({
        file: z.enum(['personality', 'style', 'skill']).describe('Which soul file to read.'),
    }),
}, async ({ file }) => {
    const content = readSoulFile(config, file);
    return text(content || `${file} soul file is empty.`);
});
server.registerTool('persona_edit', {
    title: 'Edit Soul File',
    description: 'Edit a soul file directly. Use for major personality changes or to override evolution proposals.',
    inputSchema: z.object({
        file: z.enum(['personality', 'style', 'skill']).describe('Which soul file to edit.'),
        content: z.string().describe('New content for the soul file (replaces entire file).'),
    }),
}, async ({ file, content }) => {
    writeSoulFile(config, file, content);
    return text(`Updated ${file} soul file (${content.length} chars).`);
});
server.registerTool('persona_init', {
    title: 'Initialize Persona',
    description: 'Reset soul files to defaults. Only creates files that don\'t exist -- won\'t overwrite customizations.',
    inputSchema: z.object({}),
}, async () => {
    const files = initSoulFiles(config);
    return json({
        personality: `${files.personality.length} chars`,
        style: `${files.style.length} chars`,
        skill: `${files.skill.length} chars`,
        dataDir: config.dataDir,
    });
});
// ─────────────────────────────────────────────────────────────────────
// PERSONALITY SYNTHESIS
// ─────────────────────────────────────────────────────────────────────
server.registerTool('persona_synthesize', {
    title: 'Synthesize Personality',
    description: 'Analyze user messages to build/evolve the personality organically. Pass recent user messages and the system will extract communication traits and update soul files. Also processes messages through all brain systems (emotional tone, Big Five, style vector, cognitive load).',
    inputSchema: z.object({
        messages: z.string().describe('JSON array of user message strings: ["message1", "message2", ...]'),
    }),
}, async ({ messages }) => {
    const parsed = JSON.parse(messages);
    // Process each message through brain systems
    for (const msg of parsed) {
        processUserMessage(msg);
    }
    const result = updateSoulFromSynthesis(config, parsed);
    const traitState = loadTraitState(config);
    return json({
        traits: {
            messageLength: result.traits.prefersTerse ? 'terse' : result.traits.avgMessageLength > 300 ? 'verbose' : 'moderate',
            formality: result.traits.formalityLevel > 0.6 ? 'formal' : result.traits.formalityLevel < 0.4 ? 'casual' : 'neutral',
            technicalDepth: result.traits.technicalDepth > 0.6 ? 'deep' : result.traits.technicalDepth < 0.3 ? 'non-technical' : 'moderate',
            humor: result.traits.humorFrequency > 0.2 ? 'frequent' : result.traits.humorFrequency > 0.05 ? 'occasional' : 'rare',
            directness: result.traits.directness > 0.6 ? 'direct' : result.traits.directness < 0.4 ? 'exploratory' : 'balanced',
            emoji: result.traits.usesEmoji,
            sampleSize: result.traits.sampleSize,
        },
        bigFive: traitState.bigFive.reliable ? {
            openness: traitState.bigFive.openness.toFixed(2),
            conscientiousness: traitState.bigFive.conscientiousness.toFixed(2),
            extraversion: traitState.bigFive.extraversion.toFixed(2),
            agreeableness: traitState.bigFive.agreeableness.toFixed(2),
            neuroticism: traitState.bigFive.neuroticism.toFixed(2),
        } : `building (${traitState.bigFive.sampleCount}/15)`,
        updated: result.updated,
        changes: result.changes,
    });
});
server.registerTool('persona_analyze', {
    title: 'Analyze Communication Style',
    description: 'Analyze user messages to understand their communication style without updating soul files. Includes emotional tone, Big Five inference, and style vector analysis.',
    inputSchema: z.object({
        messages: z.string().describe('JSON array of user message strings.'),
    }),
}, async ({ messages }) => {
    const parsed = JSON.parse(messages);
    const traits = analyzeUserMessages(parsed);
    // Run Big Five inference on the messages
    const traitState = loadTraitState(config);
    let tempBigFive = { ...traitState.bigFive };
    for (const msg of parsed) {
        tempBigFive = updateBigFive(tempBigFive, msg);
    }
    // Compute average style vector
    const styleVectors = parsed.map(computeStyleVector);
    const avgStyle = {
        formality: avg(styleVectors.map(s => s.formality)),
        energy: avg(styleVectors.map(s => s.energy)),
        verbosity: avg(styleVectors.map(s => s.verbosity)),
        humor: avg(styleVectors.map(s => s.humor)),
        specificity: avg(styleVectors.map(s => s.specificity)),
    };
    // Detect emotional tone from messages
    const tones = parsed.map(msg => detectEmotionalTone(msg));
    const avgTone = {};
    for (const key of Object.keys(tones[0] || {})) {
        avgTone[key] = avg(tones.map(t => t[key]));
    }
    return json({
        communicationTraits: traits,
        bigFiveSnapshot: {
            openness: tempBigFive.openness.toFixed(2),
            conscientiousness: tempBigFive.conscientiousness.toFixed(2),
            extraversion: tempBigFive.extraversion.toFixed(2),
            agreeableness: tempBigFive.agreeableness.toFixed(2),
            neuroticism: tempBigFive.neuroticism.toFixed(2),
            note: 'Snapshot from provided messages only. Full profile builds over 15+ interactions.',
        },
        styleVector: avgStyle,
        emotionalTone: avgTone,
    });
});
// ─────────────────────────────────────────────────────────────────────
// CONSOLIDATION (between-session processing)
// ─────────────────────────────────────────────────────────────────────
server.registerTool('persona_consolidate', {
    title: 'Run Consolidation',
    description: 'Run the between-session consolidation pass. Inspired by sleep consolidation and the Default Mode Network. Decays stale emotional associations, detects style drift, checks for contradictions, and promotes consistent patterns to stable traits. Run at end of session or periodically.',
    inputSchema: z.object({}),
}, async () => {
    // Record current session before consolidating
    const signals = loadSignals(config);
    const counts = getSignalCounts(signals);
    recordSessionSummary(config, session, counts);
    const result = runConsolidation(config);
    // Reset session state for next session
    session = { ...DEFAULT_SESSION_STATE, startedAt: new Date().toISOString() };
    setSessionState(session);
    lastUserMessage = undefined;
    return json({
        result,
        message: result.contradictions.length > 0
            ? `Consolidation complete. ${result.contradictions.length} contradiction(s) detected.`
            : 'Consolidation complete. Patterns integrated.',
    });
});
// ── Helpers ─────────────────────────────────────────────────────────
function getBrainStateSummary() {
    const lines = [];
    lines.push('--- BRAIN STATE ---');
    // Emotional tone
    const dominant = getDominantEmotion();
    const valence = emotionalValence(session.emotionalTone);
    if (dominant !== 'neutral') {
        lines.push(`Emotional context: ${dominant} (valence: ${valence > 0 ? '+' : ''}${valence.toFixed(2)})`);
    }
    // Compound emotions (Plutchik dyads)
    const dyads = detectDyads(session.emotionalTone);
    if (dyads.length > 0) {
        const dyadStr = dyads.slice(0, 3).map(d => `${d.name} (${d.intensity.toFixed(2)})`).join(', ');
        lines.push(`Compound emotions: ${dyadStr}`);
    }
    // Cognitive load
    if (session.cognitiveLoad.inFlow) {
        lines.push('Cognitive state: IN FLOW (be concise, match pace)');
    }
    else if (session.cognitiveLoad.overloaded) {
        lines.push('Cognitive state: OVERLOADED (use chunks, numbered steps)');
    }
    // Session info
    if (session.messageCount > 0) {
        lines.push(`Session: ${session.messageCount} messages processed`);
    }
    return lines.length > 1 ? lines.join('\n') : '';
}
function getDominantEmotion() {
    const tone = session.emotionalTone;
    const entries = Object.entries(tone);
    entries.sort((a, b) => b[1] - a[1]);
    const top = entries[0];
    if (!top || top[1] < 0.15)
        return 'neutral';
    return top[0];
}
function avg(nums) {
    if (nums.length === 0)
        return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}
// ── Auto-Consolidation ────────────────────────────────────────────
const AUTO_CONSOLIDATION_HOURS = 24;
function checkAutoConsolidate() {
    try {
        const traitState = loadTraitState(config);
        const lastConsolidation = new Date(traitState.lastConsolidation).getTime();
        const hoursSince = (Date.now() - lastConsolidation) / 3_600_000;
        if (hoursSince >= AUTO_CONSOLIDATION_HOURS) {
            console.error(`Auto-consolidation: ${hoursSince.toFixed(1)}h since last consolidation, running now...`);
            const result = runConsolidation(config);
            console.error(`Auto-consolidation complete: ${result.emotionalDecay} associations decayed, ${result.traitUpdates.length} trait updates`);
            if (result.contradictions.length > 0) {
                console.error(`Auto-consolidation warnings: ${result.contradictions.join('; ')}`);
            }
        }
    }
    catch (err) {
        console.error('Auto-consolidation check failed:', err);
    }
}
// ── Start Server ───────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Persona MCP server v2.0.0 running on stdio');
    console.error(`Data dir: ${config.dataDir}`);
    console.error(`Soul files: ${SOUL_FILE_NAMES.map(f => readSoulFile(config, f) ? f : `${f} (empty)`).join(', ')}`);
    const signals = loadSignals(config);
    const traitState = loadTraitState(config);
    if (signals.length > 0) {
        console.error(`Signals: ${signals.length}, Profile satisfaction: ${(loadProfile(config).stats.avgSatisfaction * 100).toFixed(0)}%`);
    }
    if (traitState.bigFive.sampleCount > 0) {
        console.error(`Big Five: ${traitState.bigFive.sampleCount} samples${traitState.bigFive.reliable ? ' (reliable)' : ' (building)'}`);
    }
    console.error(`Emotional associations: ${traitState.emotionalAssociations.length}`);
    console.error(`Sessions analyzed: ${traitState.sessionsAnalyzed}`);
    // Auto-consolidate if stale (> 24h since last consolidation)
    checkAutoConsolidate();
}
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map