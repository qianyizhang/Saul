import { z } from 'zod';

// Must run before SDK schemas are constructed: Zod captures this setting then.
// MCP hosts forbid generated JavaScript, so validation uses the interpreter.
z.config({ jitless: true });
