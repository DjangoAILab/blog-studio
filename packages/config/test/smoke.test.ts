import { describe, expect, it } from 'vitest';

import { CONFIG_SCHEMA_VERSION } from '../src/index.js';

describe('config package', () => {
  it('publishes an explicit schema version', () => {
    expect(CONFIG_SCHEMA_VERSION).toBe(1);
  });
});
