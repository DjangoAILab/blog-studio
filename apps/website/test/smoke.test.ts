import { describe, expect, it } from 'vitest';

import { WEBSITE_TITLE } from '../src/index.js';

describe('website app', () => {
  it('uses the product title', () => {
    expect(WEBSITE_TITLE).toBe('Blog Studio');
  });
});
