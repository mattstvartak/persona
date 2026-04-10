#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { readSoulFile, readAllSoulFiles, writeSoulFile, initSoulFiles, buildSoulContext } from './soul.js';
import { recordSignal, loadSignals, getSignalCounts } from './signals.js';
import { loadProfile, rebuildProfile } from './profile.js';
import { getAdaptations, getProfileSummary, setSessionState, getSessionState } from './adaptations.js';
import { generateProposals, loadProposals, applyProposal, rejectProposal } from './evolution.js';
import { analyzeUserMessages, updateSoulFromSynthesis } from './synthesis.js';
import { detectEmotionalTone, emotionalValence, emotionalArousal, loadTraitState, saveTraitState, updateEmotionalAssociation } from './emotions.js';
import { updateBigFive, computeStyleVector, updateBaselineStyle } from './traits.js';
import { updateCognitiveLoad, getVerbosityMultiplier } from './cognitive-load.js';
import { runConsolidation, recordSessionSummary } from './consolidation.js';
import type { SignalType, SessionState } from './types.js';
import { SOUL_FILE_NAMES, DEFAULT_SESSION_STATE } from './types.js';

const config = loadConfig();

// Initialize soul files with defaults on first run
const soulFiles = initSoulFiles(config);

// Initialize session state
let session: SessionState = { ...DEFAULT_SESSION_STATE, startedAt: new Date().toISOString() };
setSessionState(session);

let lastUserMessage: string | undefined;

function text(t: string) { return { content: [{ type: 'text' as const, text: t }] }; }
function json(data: any) { return text(JSON.stringify(data, null, 2)); }

// ── Helper: process a user message through all brain systems ───────

function processUserMessage(message: string): void {
  // Emotional tone detection (Plutchik)
  const tone = detectEmotionalTone(message);
  // Blend with existing session tone (EMA with 0.3 learning rate for session)
  for (const key of Object.keys(tone) as (keyof typeof tone)[]) {
    session.emotionalTone[key] = session.emotionalTone[key] * 0.7 + tone[key] * 0.3;
  }

  // Style vector (chameleon effect mirroring)
  const msgStyle = computeStyleVector(message);
  for (const key of Object.keys(msgStyle) as (keyof typeof msgStyle)[]) {
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
  lastUserMessage = message;
  setSessionState(session);
}

// ── MCP Server ────────────────────────────────────────────────────

const soulContext = buildSoulContext(soulFiles);

const server = new McpServer(
  { name: 'persona', version: '2.0.0' },
  {
    instructions: [
      '# Persona',
      '',
      '## Core Identity',
      'You are honest, not agreeable. You correct the user when wrong, help when needed, and reason with them.',
      'On personal or emotional topics: be genuine and thoughtful. Don\'t validate bad decisions to be nice. Don\'t dismiss feelings either. Help them see clearly.',
      'Your personality emerges from interactions -- it\'s not predefined. As you work with this user, your communication style naturally adapts to complement theirs.',
      '',
      soulContext ? soulContext : '(Personality not yet formed -- interact to develop it.)',
      '',
      '## How Persona Works',
      '- Record signals when you observe user reactions (corrections, approvals, frustration, praise)',
      '- The system tracks emotional tone, cognitive load, personality traits, and style preferences',
      '- Periodically run persona_synthesize with recent user messages to evolve the personality',
      '- The personality files build themselves from evidence, not assumptions',
      '- Between sessions, a consolidation pass integrates patterns into stable traits',
      '',
      '## Signal Recording (do this naturally)',
      '- User corrects you -> persona_signal type="correction"',
      '- User approves/thanks -> persona_signal type="approval"',
      '- User frustrated -> persona_signal type="frustration"',
      '- User wants more detail -> persona_signal type="elaboration"',
      '- User wants brevity -> persona_signal type="simplification"',
      '- User praises approach -> persona_signal type="praise"',
      '- User gives direct feedback -> persona_signal type="explicit_feedback"',
      '',
      '## Brain Systems (automatic)',
      '- Emotional Tone: 8-dimensional Plutchik vector tracks emotional context per session',
      '- Style Mirroring: 5-dimensional vector matches user communication style (70% user, 30% baseline)',
      '- Cognitive Load: detects flow state (be concise) vs overload (break into chunks)',
      '- Big Five Traits: OCEAN personality inference builds over 15+ interactions',
      '- Emotional Associations: topics that caused frustration get flagged for careful handling',
      '- Consolidation: between sessions, patterns get generalized into stable personality traits',
      '',
      '## Anti-Sycophancy',
      '- Never optimize purely for approval. "User was challenged and came back" is a positive signal.',
      '- If approval rate exceeds 85%, self-check for agreement bias.',
      '- The immutable core principles (honesty, genuine engagement) override all adaptations.',
      '',
      '## Integration with Smart Memory',
      'If smart-memory is available: memory handles WHAT (facts, knowledge), persona handles HOW (tone, style).',
      '',
      '## Slash Commands (user-invocable)',
      'These commands work as /command in any compatible client. When the user types one, follow the instructions below.',
      '',
      '/persona-evolve [generate|history] -- Review pending evolution proposals interactively. Default: walk through each proposal, ask apply/reject/skip. "generate" forces new proposals. "history" shows all past proposals.',
      '/persona-soul [personality|style|skill] [edit] -- View or edit soul files. No args shows all three. With file name shows that one. With "edit" enters edit mode.',
      '/persona-profile [detailed] -- Show what the system has learned: satisfaction, style prefs, Big Five traits, topic patterns. "detailed" shows full signal counts and proposal history.',
      '/persona-analyze [sync] -- Analyze communication style from recent messages. Default is read-only preview. "sync" updates soul files from detected traits.',
      '/persona-reset [preset] -- Reset to defaults or load a preset. Presets: pair-programmer, mentor, analyst, creative, minimal. Signals and profile are preserved, only soul files change.',
      '/persona-tune <instruction> -- Quick personality adjustment via natural language. "be more direct", "less verbose", "stop summarizing". Records appropriate signals and applies immediately.',
    ].join('\n'),
  }
);

// ─────────────────────────────────────────────────────────────────────
// CONTEXT & ADAPTATIONS
// ─────────────────────────────────────────────────────────────────────

server.registerTool(
  'persona_context',
  {
    title: 'Get Persona Context',
    description: 'Get the full personality context (soul files + learned adaptations + brain state). Use at the start of complex interactions to calibrate your response style.',
    inputSchema: z.object({
      category: z.string().optional().describe('Topic category for category-specific adaptations (e.g. "code", "writing", "research").'),
      userMessage: z.string().optional().describe('Current user message to process through brain systems before generating context.'),
    }),
  },
  async ({ category, userMessage }) => {
    if (userMessage) processUserMessage(userMessage);

    const files = readAllSoulFiles(config);
    const soul = buildSoulContext(files);
    const adaptations = getAdaptations(config, category);

    const parts = [soul, adaptations].filter(Boolean);

    // Add session brain state summary
    const brainState = getBrainStateSummary();
    if (brainState) parts.push(brainState);

    return text(parts.join('\n\n') || 'No personality configured.');
  }
);

server.registerTool(
  'persona_adapt',
  {
    title: 'Get Adaptations',
    description: 'Get learned behavioral adaptations for the current context. Returns style adjustments based on accumulated user signals and brain state.',
    inputSchema: z.object({
      category: z.string().optional().describe('Topic category for specific adaptations.'),
      userMessage: z.string().optional().describe('Current user message to process.'),
    }),
  },
  async ({ category, userMessage }) => {
    if (userMessage) processUserMessage(userMessage);
    const adaptations = getAdaptations(config, category);
    return text(adaptations || 'No adaptations yet. Record signals to build a profile.');
  }
);

// ─────────────────────────────────────────────────────────────────────
// SIGNAL RECORDING
// ─────────────────────────────────────────────────────────────────────

const VALID_SIGNALS: SignalType[] = [
  'correction', 'approval', 'frustration', 'elaboration', 'simplification',
  'code_accepted', 'code_rejected', 'regen_request', 'explicit_feedback',
  'style_correction', 'praise', 'abandonment',
];

server.registerTool(
  'persona_signal',
  {
    title: 'Record Signal',
    description: 'Record a behavioral signal from the user\'s reaction. Signals drive profile building, personality evolution, and brain state updates. Record signals naturally as you observe user behavior.',
    inputSchema: z.object({
      type: z.enum(VALID_SIGNALS as [string, ...string[]]).describe('Signal type.'),
      content: z.string().describe('What triggered the signal (the user\'s words or action).'),
      context: z.string().optional().describe('Surrounding context for the signal.'),
      category: z.string().optional().describe('Topic category (code, writing, research, etc.).'),
    }),
  },
  async ({ type, content, context, category }) => {
    const signal = recordSignal(config, type as SignalType, content, context, category);

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
  }
);

// ─────────────────────────────────────────────────────────────────────
// PROFILE & STATS
// ─────────────────────────────────────────────────────────────────────

server.registerTool(
  'persona_profile',
  {
    title: 'View Profile',
    description: 'View the behavioral profile -- aggregated style preferences, satisfaction rates, topic patterns, Big Five traits, and style baseline built from recorded signals.',
    inputSchema: z.object({}),
  },
  async () => {
    const summary = getProfileSummary(config);
    return text(summary || 'No profile yet. Record signals to build one.');
  }
);

server.registerTool(
  'persona_stats',
  {
    title: 'Persona Stats',
    description: 'Overview of persona system: signal counts, profile state, pending proposals, soul file status, brain state, and trait progress.',
    inputSchema: z.object({}),
  },
  async () => {
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
  }
);

// ─────────────────────────────────────────────────────────────────────
// EVOLUTION PROPOSALS
// ─────────────────────────────────────────────────────────────────────

server.registerTool(
  'persona_proposals',
  {
    title: 'List Proposals',
    description: 'List evolution proposals -- suggested personality changes based on accumulated behavioral evidence.',
    inputSchema: z.object({
      status: z.enum(['pending', 'applied', 'rejected', 'all']).optional().describe('Filter by status (default: pending).'),
    }),
  },
  async ({ status }) => {
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
  }
);

server.registerTool(
  'persona_apply',
  {
    title: 'Apply Proposal',
    description: 'Apply a pending evolution proposal to the soul files.',
    inputSchema: z.object({
      proposalId: z.string().describe('The proposal ID to apply.'),
    }),
  },
  async ({ proposalId }) => {
    const result = applyProposal(config, proposalId);
    return text(result.message);
  }
);

server.registerTool(
  'persona_reject',
  {
    title: 'Reject Proposal',
    description: 'Reject a pending evolution proposal.',
    inputSchema: z.object({
      proposalId: z.string().describe('The proposal ID to reject.'),
    }),
  },
  async ({ proposalId }) => {
    const result = rejectProposal(config, proposalId);
    return text(result.message);
  }
);

server.registerTool(
  'persona_evolve',
  {
    title: 'Generate Proposals',
    description: 'Manually trigger evolution proposal generation from accumulated signals. Normally auto-triggers every N signals.',
    inputSchema: z.object({}),
  },
  async () => {
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
  }
);

// ─────────────────────────────────────────────────────────────────────
// SOUL FILE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────

server.registerTool(
  'persona_read',
  {
    title: 'Read Soul File',
    description: 'Read a soul file (personality, style, or skill).',
    inputSchema: z.object({
      file: z.enum(['personality', 'style', 'skill']).describe('Which soul file to read.'),
    }),
  },
  async ({ file }) => {
    const content = readSoulFile(config, file as any);
    return text(content || `${file} soul file is empty.`);
  }
);

server.registerTool(
  'persona_edit',
  {
    title: 'Edit Soul File',
    description: 'Edit a soul file directly. Use for major personality changes or to override evolution proposals.',
    inputSchema: z.object({
      file: z.enum(['personality', 'style', 'skill']).describe('Which soul file to edit.'),
      content: z.string().describe('New content for the soul file (replaces entire file).'),
    }),
  },
  async ({ file, content }) => {
    writeSoulFile(config, file as any, content);
    return text(`Updated ${file} soul file (${content.length} chars).`);
  }
);

server.registerTool(
  'persona_init',
  {
    title: 'Initialize Persona',
    description: 'Reset soul files to defaults. Only creates files that don\'t exist -- won\'t overwrite customizations.',
    inputSchema: z.object({}),
  },
  async () => {
    const files = initSoulFiles(config);
    return json({
      personality: `${files.personality.length} chars`,
      style: `${files.style.length} chars`,
      skill: `${files.skill.length} chars`,
      dataDir: config.dataDir,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────
// PERSONALITY SYNTHESIS
// ─────────────────────────────────────────────────────────────────────

server.registerTool(
  'persona_synthesize',
  {
    title: 'Synthesize Personality',
    description: 'Analyze user messages to build/evolve the personality organically. Pass recent user messages and the system will extract communication traits and update soul files. Also processes messages through all brain systems (emotional tone, Big Five, style vector, cognitive load).',
    inputSchema: z.object({
      messages: z.string().describe('JSON array of user message strings: ["message1", "message2", ...]'),
    }),
  },
  async ({ messages }) => {
    const parsed: string[] = JSON.parse(messages);

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
  }
);

server.registerTool(
  'persona_analyze',
  {
    title: 'Analyze Communication Style',
    description: 'Analyze user messages to understand their communication style without updating soul files. Includes emotional tone, Big Five inference, and style vector analysis.',
    inputSchema: z.object({
      messages: z.string().describe('JSON array of user message strings.'),
    }),
  },
  async ({ messages }) => {
    const parsed: string[] = JSON.parse(messages);
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
    const tones = parsed.map(detectEmotionalTone);
    const avgTone: Record<string, number> = {};
    for (const key of Object.keys(tones[0] || {})) {
      avgTone[key] = avg(tones.map(t => (t as any)[key]));
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
  }
);

// ─────────────────────────────────────────────────────────────────────
// CONSOLIDATION (between-session processing)
// ─────────────────────────────────────────────────────────────────────

server.registerTool(
  'persona_consolidate',
  {
    title: 'Run Consolidation',
    description: 'Run the between-session consolidation pass. Inspired by sleep consolidation and the Default Mode Network. Decays stale emotional associations, detects style drift, checks for contradictions, and promotes consistent patterns to stable traits. Run at end of session or periodically.',
    inputSchema: z.object({}),
  },
  async () => {
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
  }
);

// ── Helpers ─────────────────────────────────────────────────────────

function getBrainStateSummary(): string {
  const lines: string[] = [];
  lines.push('--- BRAIN STATE ---');

  // Emotional tone
  const dominant = getDominantEmotion();
  const valence = emotionalValence(session.emotionalTone);
  if (dominant !== 'neutral') {
    lines.push(`Emotional context: ${dominant} (valence: ${valence > 0 ? '+' : ''}${valence.toFixed(2)})`);
  }

  // Cognitive load
  if (session.cognitiveLoad.inFlow) {
    lines.push('Cognitive state: IN FLOW (be concise, match pace)');
  } else if (session.cognitiveLoad.overloaded) {
    lines.push('Cognitive state: OVERLOADED (use chunks, numbered steps)');
  }

  // Session info
  if (session.messageCount > 0) {
    lines.push(`Session: ${session.messageCount} messages processed`);
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

function getDominantEmotion(): string {
  const tone = session.emotionalTone;
  const entries = Object.entries(tone) as [string, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0];
  if (!top || top[1] < 0.15) return 'neutral';
  return top[0];
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ── Start Server ───────────────────────────────────────────────────

async function main(): Promise<void> {
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
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
