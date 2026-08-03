import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/editor/visual-editor.js', () => {
  throw new Error('the visual editor must stay unloaded until it is rendered');
});

import { STUDIO_APP_NAME } from '../src/index.js';

describe('studio app', () => {
  it('has a stable product name', () => {
    expect(STUDIO_APP_NAME).toBe('Blog Studio');
  });
});
