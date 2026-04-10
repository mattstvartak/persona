import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_CONFIG } from './types.js';
export function loadConfig(overrides) {
    return {
        ...DEFAULT_CONFIG,
        dataDir: process.env.PERSONA_DATA_DIR ?? join(homedir(), '.claude', 'persona'),
        ...overrides,
    };
}
//# sourceMappingURL=config.js.map