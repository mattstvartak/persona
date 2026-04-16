import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { loadProposals } from './evolution.js';
import { readAllSoulFiles } from './soul.js';
const BRIDGE_PATH = join(homedir(), '.claude', 'procedural-bridge.json');
// ── File I/O ───────────────────────────────────────────────────────
function loadBridgeFile() {
    if (!existsSync(BRIDGE_PATH)) {
        return { version: 1, lastUpdated: new Date().toISOString(), rules: [] };
    }
    try {
        return JSON.parse(readFileSync(BRIDGE_PATH, 'utf-8'));
    }
    catch {
        return { version: 1, lastUpdated: new Date().toISOString(), rules: [] };
    }
}
function saveBridgeFile(data) {
    const dir = dirname(BRIDGE_PATH);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    data.lastUpdated = new Date().toISOString();
    writeFileSync(BRIDGE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}
// ── Export Applied Proposals → Bridge ──────────────────────────────
export function exportProposalsToBridge(config) {
    const proposals = loadProposals(config);
    const applied = proposals.filter(p => p.status === 'applied');
    const bridge = loadBridgeFile();
    // Keep Engram-sourced rules, replace Persona-sourced rules
    const engramRules = bridge.rules.filter(r => r.source === 'engram');
    const personaRules = applied.map(p => ({
        id: `persona:${p.id}`,
        rule: p.content,
        domain: mapProposalDomain(p.type, p.target),
        confidence: p.confidence,
        source: 'persona',
        sourceId: p.id,
        evidence: [p.rationale],
        createdAt: p.createdAt,
        updatedAt: new Date().toISOString(),
    }));
    bridge.rules = [...engramRules, ...personaRules];
    saveBridgeFile(bridge);
    return personaRules.length;
}
// ── Import Engram Rules → Persona Proposals ────────────────────────
export function importRulesFromBridge(config) {
    const bridge = loadBridgeFile();
    const engramRules = bridge.rules.filter(r => r.source === 'engram');
    const existing = loadProposals(config);
    const soulFiles = readAllSoulFiles(config);
    let imported = 0;
    let skipped = 0;
    const conflicts = [];
    for (const rule of engramRules) {
        // Skip if we already have a proposal with this content
        const alreadyExists = existing.some(p => p.content === rule.rule ||
            p.id === `engram-${rule.sourceId}`);
        if (alreadyExists) {
            skipped++;
            continue;
        }
        // Check if rule aligns with or contradicts existing soul file content
        const conflict = checkSoulConflict(rule.rule, soulFiles);
        if (conflict) {
            conflicts.push(`Rule "${rule.rule.slice(0, 60)}..." conflicts with ${conflict}`);
            continue;
        }
        // Map to a proposal type and target
        const { type, target } = mapRuleToProposal(rule.domain);
        const proposal = {
            id: `engram-${rule.sourceId}`,
            type,
            target,
            action: 'add',
            content: rule.rule,
            rationale: `Discovered by Engram from user behavior patterns. Evidence: ${rule.evidence[0] ?? 'behavioral pattern'}`,
            evidence: [{ signalType: 'explicit_feedback', count: rule.confidence > 0.7 ? 3 : 1 }],
            confidence: Math.min(0.7, rule.confidence), // Cap initial confidence — needs user approval
            status: 'pending',
            createdAt: new Date().toISOString(),
        };
        existing.push(proposal);
        imported++;
    }
    // Save updated proposals
    if (imported > 0) {
        const dir = dirname(join(config.dataDir, 'proposals.json'));
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        writeFileSync(join(config.dataDir, 'proposals.json'), JSON.stringify(existing, null, 2), 'utf-8');
    }
    return { imported, skipped, conflicts };
}
// ── Sync (bidirectional) ───────────────────────────────────────────
export function syncBridge(config) {
    const exported = exportProposalsToBridge(config);
    const { imported, skipped, conflicts } = importRulesFromBridge(config);
    return { exported, imported, skipped, conflicts };
}
// ── Helpers ─────────────────────────────────────────────────────────
function mapProposalDomain(type, target) {
    if (type === 'skill_edit' || target === 'skill')
        return 'code';
    if (type === 'style_edit' || target === 'style')
        return 'communication';
    return 'general';
}
function mapRuleToProposal(domain) {
    switch (domain) {
        case 'code': return { type: 'skill_edit', target: 'skill' };
        case 'communication': return { type: 'style_edit', target: 'style' };
        case 'workflow': return { type: 'skill_edit', target: 'skill' };
        default: return { type: 'personality_edit', target: 'personality' };
    }
}
function checkSoulConflict(rule, soulFiles) {
    const ruleLower = rule.toLowerCase();
    // Check for direct contradictions with soul file content
    const negations = ['not', 'never', "don't", 'avoid', 'stop'];
    const ruleHasNeg = negations.some(n => ruleLower.includes(n));
    for (const [fileName, content] of Object.entries(soulFiles)) {
        if (!content)
            continue;
        const contentLower = content.toLowerCase();
        const lines = contentLower.split('\n').filter(l => l.trim().length > 10);
        for (const line of lines) {
            const lineHasNeg = negations.some(n => line.includes(n));
            // One has negation, the other doesn't, and they share key words
            if (ruleHasNeg !== lineHasNeg) {
                const ruleWords = new Set(ruleLower.split(/\s+/).filter(w => w.length > 4));
                const lineWords = new Set(line.split(/\s+/).filter(w => w.length > 4));
                let overlap = 0;
                for (const w of ruleWords)
                    if (lineWords.has(w))
                        overlap++;
                if (overlap >= 3)
                    return `${fileName}.md: "${line.trim().slice(0, 60)}..."`;
            }
        }
    }
    return null;
}
//# sourceMappingURL=procedural-bridge.js.map