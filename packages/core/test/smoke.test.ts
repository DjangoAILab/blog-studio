import { describe, expect, it } from 'vitest';

import { CORE_API_VERSION } from '../src/index.js';

describe('core package', () => {
  it('publishes an explicit API version', () => {
    expect(CORE_API_VERSION).toBe(1);
  });
});
