import { describe, expect, it } from 'vitest';

import {
  isProtectedHtmlSource,
  protectedSourceLabel,
} from '../src/features/editor/protected-source.js';

describe('protected visual-editor source blocks', () => {
  it('recognises multiline HTML comments as opaque Markdown source', () => {
    const source = '<!-- > image prompt\n\n![cover](../assets/cover.jpg) -->';

    expect(isProtectedHtmlSource(source)).toBe(true);
    expect(protectedSourceLabel(source)).toContain('图片或资源');
  });

  it('does not hide ordinary visible HTML', () => {
    expect(isProtectedHtmlSource('<mark>Visible text</mark>')).toBe(false);
  });
});
