import { describe, expect, it } from 'vitest';

import { STUDIO_APP_NAME } from '../src/index.js';

describe('studio app', () => {
  it('has a stable product name', () => {
    expect(STUDIO_APP_NAME).toBe('Blog Studio');
  });
});
