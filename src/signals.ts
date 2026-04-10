import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BehavioralSignal, SignalType, PersonaConfig } from './types.js';

/**
 * Behavioral signal recording and storage.
 *
 * Signals are observations about user behavior -- corrections, approvals,
 * frustration, style preferences, etc. They're the raw input that drives
 * profile building and evolution proposals.
 *
 * Storage: dataDir/signals.json (bounded to maxSignals, FIFO)
 */

function signalsPath(config: PersonaConfig): string {
  return join(config.dataDir, 'signals.json');
}

export function loadSignals(config: PersonaConfig): BehavioralSignal[] {
  const path = signalsPath(config);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}

function saveSignals(config: PersonaConfig, signals: BehavioralSignal[]): void {
  const dir = dirname(signalsPath(config));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Bound to maxSignals
  const bounded = signals.slice(-config.maxSignals);
  writeFileSync(signalsPath(config), JSON.stringify(bounded, null, 2), 'utf-8');
}

/**
 * Record a new behavioral signal.
 */
export function recordSignal(
  config: PersonaConfig,
  type: SignalType,
  content: string,
  context?: string,
  category?: string
): BehavioralSignal {
  const signal: BehavioralSignal = {
    id: randomUUID(),
    type,
    content: content.slice(0, 500),
    context: context?.slice(0, 300),
    category,
    timestamp: new Date().toISOString(),
  };

  const signals = loadSignals(config);
  signals.push(signal);
  saveSignals(config, signals);

  return signal;
}

/**
 * Get signal counts by type.
 */
export function getSignalCounts(signals: BehavioralSignal[]): Record<SignalType, number> {
  const counts: Record<string, number> = {};
  for (const s of signals) {
    counts[s.type] = (counts[s.type] ?? 0) + 1;
  }
  return counts as Record<SignalType, number>;
}

/**
 * Get recent signals within a time window.
 */
export function getRecentSignals(signals: BehavioralSignal[], daysBack: number = 7): BehavioralSignal[] {
  const cutoff = Date.now() - daysBack * 86_400_000;
  return signals.filter(s => new Date(s.timestamp).getTime() > cutoff);
}
