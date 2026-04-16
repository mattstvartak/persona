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
import { detectEmotionalTone, emotionalValence, emotionalArousal, detectDyads, loadTraitState, saveTraitState, updateEmotionalAssociation } from './emotions.js';
import { updateBigFive, computeStyleVector, updateBaselineStyle, detectTechnicalDomain } from './traits.js';
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
  const tone = detectEmotionalTone(message, session.recentMessages);
  for (const key of Object.keys(tone) as (keyof typeof tone)[]) {
    session.emotionalTone[key] = session.emotionalTone[key] * 0.7 + tone[key] * 0.3;
  }

  const msgStyle = computeStyleVector(message);
  for (const key of Object.keys(msgStyle) as (keyof typeof msgStyle)[]) {
    session.styleVector[key] = session.styleVector[key] * 0.7 + msgStyle[key] * 0.3;
  }

  session.cognitiveLoad = updateCognitiveLoad(session.cognitiveLoad, message, lastUserMessage);

  const traitState = loadTraitState(config);
  const techRatio = detectTechnicalDomain(message);
  traitState.domainTechnicalRatio = traitState.domainTechnicalRatio * 0.95 + techRatio * 0.05;
  traitState.bigFive = updateBigFive(traitState.bigFive, message, traitState.domainTechnicalRatio);
  traitState.baselineStyleVector = updateBaselineStyle(traitState.baselineStyleVector, msgStyle);
  saveTraitState(config, traitState);

  session.messageCount++;
  session.recentMessages = [...session.recentMessages, message].slice(-5);
  lastUserMessage = message;
  setSessionState(session);
}

// ── MCP Server ────────────────────────────────────────────────────

const soulContext = buildSoulContext(soulFiles);

const server = new McpServer(
  { name: 'persona', version: '2.1.0' },
  {
    instructions: [
      '# Persona',
      'Adaptive personality. Honest, not agreeable. Style emerges from interactions.',
      soulContext ? '' : '(Personality not yet formed.)',
      soulContext || '',
      '',
      'Record user reactions immediately with persona_signal: correction, approval, frustration, elaboration, simplification, praise, explicit_feedback, code_accepted, code_rejected, style_correction.',
      'After 5+ signals: run persona_synthesize.',
      'If engram available: memory = WHAT, persona = HOW.',
    ].filter(Boolean).join('\n'),
  }
);

// ─────────────────────────────────────────────────────────────────────
// CONTEXT
// ─────────────────────────────────────────────────────────────────────

server.registerTool(
  'persona_context',
  {
    title: 'Get Context',
    description: 'Full personality context: soul files + adaptations + brain state. Pass adaptationsOnly=true for just the adaptive directives.',
    inputSchema: z.object({
      category: z.string().optional().describe('Topic for category-specific adaptations.'),
      userMessage: z.string().optional().describe('Process through brain systems first.'),
      adaptationsOnly: z.boolean().optional().describe('If true, return only adaptations (not soul files).'),
    }),
  },
  async ({ category, userMessage, adaptationsOnly }) => {
    if (userMessage) processUserMessage(userMessage);

    const adaptations = getAdaptations(config, category);

    // Adaptations-only mode (replaces old persona_adapt tool)
    if (adaptationsOnly) {
      return text(adaptations || 'No adaptations yet. Record signals to build a profile.');
    }

    const files = readAllSoulFiles(config);
    const soul = buildSoulContext(files);
    const parts = [soul, adaptations].filter(Boolean);

    const brainState = getBrainStateSummary();
    if (brainState) parts.push(brainState);

    return text(parts.join('\n\n') || 'No personality configured.');
  }
);

server.registerTool(
  'persona_state',
  {
    title: 'Emotional State',
    description: 'Lightweight valence/arousal/cognitive-load snapshot. Pass values to memory_ingest and memory_search.',
    inputSchema: z.object({}),
  },
  async () => {
    const session = getSessionState();
    const traitState = loadTraitState(config);
    const tone = session.emotionalTone;

    const positiveSum = tone.joy + tone.trust + tone.anticipation;
    const negativeSum = tone.anger + tone.fear + tone.sadness + tone.disgust;
    const valence = (positiveSum - negativeSum) / Math.max(1, positiveSum + negativeSum);
    const arousal = Math.min(1, (tone.surprise + tone.anger + tone.fear + tone.joy) / 2);

    const cogLoad = session.cognitiveLoad;
    const cognitiveLoadLevel = cogLoad.overloaded ? 'high' : cogLoad.inFlow ? 'low' : 'normal';

    let sentiment: string = 'neutral';
    if (tone.anger > 0.4 || tone.disgust > 0.3) sentiment = 'frustrated';
    else if (tone.joy > 0.4) sentiment = 'excited';
    else if (tone.trust > 0.4) sentiment = 'satisfied';
    else if (tone.surprise > 0.4) sentiment = 'curious';
    else if (tone.fear > 0.3 || tone.sadness > 0.3) sentiment = 'confused';

    return json({
      emotionalValence: Math.round(valence * 100) / 100,
      emotionalArousal: Math.round(arousal * 100) / 100,
      sentiment,
      cognitiveLoad: cognitiveLoadLevel,
      domainContext: traitState.domainTechnicalRatio > 0.5 ? 'technical' : traitState.domainTechnicalRatio > 0.2 ? 'mixed' : 'casual',
    });
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
    description: 'Record a user reaction: correction, approval, frustration, elaboration, simplification, praise, etc. Call immediately when noticed.',
    inputSchema: z.object({
      type: z.enum(VALID_SIGNALS as [string, ...string[]]).describe('Signal type.'),
      content: z.string().describe('What triggered it.'),
      context: z.string().optional().describe('Surrounding context.'),
      category: z.string().optional().describe('Topic (code, writing, research, etc.).'),
    }),
  },
  async ({ type, content, context, category }) => {
    const signal = recordSignal(config, type as SignalType, content, context, category);

    processUserMessage(content);

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

    const signals = loadSignals(config);
    rebuildProfile(config, signals);

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
    description: 'Behavioral profile: style preferences, satisfaction, topic patterns, Big Five traits.',
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
    title: 'Stats',
    description: 'System overview: signals, profile, proposals, soul files, brain state, bridge status.',
    inputSchema: z.object({}),
  },
  async () => {
    const signals = loadSignals(config);
    const counts = getSignalCounts(signals);
    const profile = loadProfile(config);
    const proposals = loadProposals(config);
    const files = readAllSoulFiles(config);
    const traitState = loadTraitState(config);

    // Bridge status (new observability)
    let bridge: any = { status: 'no bridge file' };
    try {
      const { readFileSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');
      const bridgePath = join(homedir(), '.claude', 'procedural-bridge.json');
      if (existsSync(bridgePath)) {
        const bridgeFile = JSON.parse(readFileSync(bridgePath, 'utf-8'));
        bridge = {
          lastUpdated: bridgeFile.lastUpdated,
          totalRules: bridgeFile.rules.length,
          engramRules: bridgeFile.rules.filter((r: any) => r.source === 'engram').length,
          personaRules: bridgeFile.rules.filter((r: any) => r.source === 'persona').length,
        };
      }
    } catch { /* no bridge file */ }

    return json({
      signals: { total: signals.length, byCounts: counts },
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
        domainContext: traitState.domainTechnicalRatio > 0.5 ? 'technical' : traitState.domainTechnicalRatio > 0.2 ? 'mixed' : 'casual',
        domainTechnicalRatio: traitState.domainTechnicalRatio.toFixed(2),
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
      bridge,
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
    description: 'Evolution proposals: suggested personality changes from behavioral evidence.',
    inputSchema: z.object({
      status: z.enum(['pending', 'applied', 'rejected', 'all']).optional().describe('Filter (default: pending).'),
    }),
  },
  async ({ status }) => {
    const proposals = loadProposals(config);
    const filtered = status === 'all' ? proposals : proposals.filter(p => p.status === (status ?? 'pending'));
    return json(filtered.map(p => ({
      id: p.id, type: p.type, target: p.target, action: p.action,
      content: p.content, rationale: p.rationale, confidence: p.confidence,
      status: p.status, createdAt: p.createdAt,
    })));
  }
);

server.registerTool(
  'persona_apply',
  {
    title: 'Apply Proposal',
    description: 'Apply a pending evolution proposal.',
    inputSchema: z.object({
      proposalId: z.string().describe('Proposal ID.'),
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
      proposalId: z.string().describe('Proposal ID.'),
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
    description: 'Manually trigger evolution proposal generation from accumulated signals.',
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
        content: p.content, rationale: p.rationale, confidence: p.confidence,
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
      file: z.enum(['personality', 'style', 'skill']).describe('Which file.'),
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
    description: 'Overwrite a soul file directly.',
    inputSchema: z.object({
      file: z.enum(['personality', 'style', 'skill']).describe('Which file.'),
      content: z.string().describe('New content (replaces entire file).'),
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
    title: 'Initialize',
    description: 'Reset soul files to defaults. Won\'t overwrite existing.',
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
    title: 'Synthesize',
    description: 'Analyze user messages, extract communication traits, update soul files, and process through brain systems.',
    inputSchema: z.object({
      messages: z.string().describe('JSON array of user message strings.'),
    }),
  },
  async ({ messages }) => {
    const parsed: string[] = JSON.parse(messages);

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
    title: 'Analyze Style',
    description: 'Analyze communication style without updating soul files. Emotional tone, Big Five, style vector.',
    inputSchema: z.object({
      messages: z.string().describe('JSON array of user message strings.'),
    }),
  },
  async ({ messages }) => {
    const parsed: string[] = JSON.parse(messages);
    const traits = analyzeUserMessages(parsed);

    const traitState = loadTraitState(config);
    let tempBigFive = { ...traitState.bigFive };
    for (const msg of parsed) {
      const techRatio = detectTechnicalDomain(msg);
      tempBigFive = updateBigFive(tempBigFive, msg, techRatio);
    }

    const styleVectors = parsed.map(computeStyleVector);
    const avgStyle = {
      formality: avg(styleVectors.map(s => s.formality)),
      energy: avg(styleVectors.map(s => s.energy)),
      verbosity: avg(styleVectors.map(s => s.verbosity)),
      humor: avg(styleVectors.map(s => s.humor)),
      specificity: avg(styleVectors.map(s => s.specificity)),
    };

    const tones = parsed.map(msg => detectEmotionalTone(msg));
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
        note: 'Snapshot from provided messages only.',
      },
      styleVector: avgStyle,
      emotionalTone: avgTone,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────
// CONSOLIDATION
// ─────────────────────────────────────────────────────────────────────

server.registerTool(
  'persona_consolidate',
  {
    title: 'Consolidate',
    description: 'Between-session consolidation: decay emotions, detect drift, check contradictions, promote patterns, sync Engram bridge.',
    inputSchema: z.object({}),
  },
  async () => {
    const signals = loadSignals(config);
    const counts = getSignalCounts(signals);
    recordSessionSummary(config, session, counts);

    const result = runConsolidation(config);

    // Auto-sync procedural bridge
    let bridgeSync = { exported: 0, imported: 0, skipped: 0, conflicts: [] as string[] };
    try {
      const { syncBridge } = await import('./procedural-bridge.js');
      bridgeSync = syncBridge(config);
    } catch {
      // Bridge sync is best-effort
    }

    session = { ...DEFAULT_SESSION_STATE, startedAt: new Date().toISOString() };
    setSessionState(session);
    lastUserMessage = undefined;

    return json({
      result,
      bridge: bridgeSync,
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

  const dominant = getDominantEmotion();
  const valence = emotionalValence(session.emotionalTone);
  if (dominant !== 'neutral') {
    lines.push(`Emotional context: ${dominant} (valence: ${valence > 0 ? '+' : ''}${valence.toFixed(2)})`);
  }

  const dyads = detectDyads(session.emotionalTone);
  if (dyads.length > 0) {
    const dyadStr = dyads.slice(0, 3).map(d => `${d.name} (${d.intensity.toFixed(2)})`).join(', ');
    lines.push(`Compound emotions: ${dyadStr}`);
  }

  if (session.cognitiveLoad.inFlow) {
    lines.push('Cognitive state: IN FLOW (be concise, match pace)');
  } else if (session.cognitiveLoad.overloaded) {
    lines.push('Cognitive state: OVERLOADED (use chunks, numbered steps)');
  }

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

// ── Auto-Consolidation ────────────────────────────────────────────

const AUTO_CONSOLIDATION_HOURS = 24;

function checkAutoConsolidate(): void {
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
  } catch (err) {
    console.error('Auto-consolidation check failed:', err);
  }
}

// ── Start Server ───────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Persona MCP server v2.1.0 running on stdio');
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

  checkAutoConsolidate();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
