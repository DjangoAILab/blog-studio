import { describe, expect, it } from 'vitest';

import {
  materializeAgentMessage,
  SiteAgentContextError,
} from '../services/site-agent-context.js';

describe('Site Agent one-message context', () => {
  it('materializes typed article, dirty buffer, and Markdown selection once', () => {
    const message = materializeAgentMessage({
      text: 'Revise this section',
      contexts: [
        {
          type: 'article',
          documentId: 'post-one',
          collectionId: 'posts',
          title: 'One',
          path: 'source/_posts/one.md',
        },
        {
          type: 'editor-buffer',
          documentId: 'post-one',
          collectionId: 'posts',
          sourceRevision: 'revision-one',
          body: '# Dirty buffer',
        },
        {
          type: 'markdown-selection',
          documentId: 'post-one',
          startLine: 2,
          endLine: 3,
          text: 'Selected Markdown',
        },
      ],
    });

    expect(message.match(/type="article"/g)).toHaveLength(1);
    expect(message.match(/type="editor-buffer"/g)).toHaveLength(1);
    expect(message.match(/type="markdown-selection"/g)).toHaveLength(1);
    expect(message.match(/Selected Markdown/g)).toHaveLength(1);
    expect(materializeAgentMessage({ text: 'Next message' })).toBe(
      'Next message',
    );
  });

  it('rejects excessive context without truncating it silently', () => {
    expect(() =>
      materializeAgentMessage({
        text: 'Use this',
        contexts: [
          {
            type: 'markdown-selection',
            documentId: 'post-one',
            startLine: 1,
            endLine: 1,
            text: 'x'.repeat(60_001),
          },
        ],
      }),
    ).toThrowError(SiteAgentContextError);
  });
});
