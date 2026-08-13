import { describe, expect, it } from 'vitest';

import { parseTagifyMix } from '../src/features/agent/agent-mix.js';

describe('parseTagifyMix', () => {
  it('keeps plain text without tags', () => {
    expect(parseTagifyMix('把这篇草稿写完')).toEqual({
      text: '把这篇草稿写完',
      refs: [],
    });
  });

  it('turns mix interpolators into inline #refs', () => {
    const parsed = parseTagifyMix(
      '这一段 [[{"value":"#1"}]] 跟这一段 [[{"value":"#2"}]] 矛盾',
    );
    expect(parsed.text).toBe('这一段 #1 跟这一段 #2 矛盾');
    expect(parsed.refs).toEqual(['#1', '#2']);
  });

  it('accepts a bare interpolator value', () => {
    expect(parseTagifyMix('对照 [[#1]]')).toEqual({
      text: '对照 #1',
      refs: ['#1'],
    });
  });
});
