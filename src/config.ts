import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PersonaConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

export function loadConfig(overrides?: Partial<PersonaConfig>): PersonaConfig {
  return {
    ...DEFAULT_CONFIG,
    dataDir: process.env.PERSONA_DATA_DIR ?? join(homedir(), '.claude', 'persona'),
    ...overrides,
  };
}
