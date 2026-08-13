import { Crepe } from '@milkdown/crepe';
import { htmlSchema } from '@milkdown/kit/preset/commonmark';
import { $view } from '@milkdown/kit/utils';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { useEffect, useRef } from 'react';

import {
  isProtectedHtmlSource,
  protectedSourceLabel,
} from './protected-source.js';

interface VisualEditorProps {
  readonly markdown: string;
  readonly onChange: (markdown: string) => void;
  readonly resolveImageSource: (source: string) => string;
  readonly onSelectionChange?: (selection?: {
    readonly text: string;
    readonly startLine: number;
    readonly endLine: number;
  }) => void;
}

const protectedHtmlSourceView = $view(htmlSchema.node, () => (node) => {
  const source = String(node.attrs.value ?? '');
  const dom = document.createElement('span');
  dom.dataset.type = 'html';
  dom.dataset.value = source;

  if (isProtectedHtmlSource(source)) {
    dom.className = 'studio3-protected-source';
    dom.contentEditable = 'false';
    dom.setAttribute(
      'aria-label',
      '已隐藏的 Markdown 源块；请切换到 Markdown 源码编辑。',
    );
    dom.title = '此 HTML 注释会原样保留；请在 Markdown 源码中编辑。';
    dom.textContent = protectedSourceLabel(source);
  } else {
    dom.className = 'studio3-raw-html';
    dom.textContent = source;
  }

  return {
    dom,
    ignoreMutation: () => true,
  };
});

function EditorSurface({
  markdown,
  onChange,
  resolveImageSource,
  onSelectionChange,
}: VisualEditorProps) {
  const changeHandler = useRef(onChange);
  const selectionHandler = useRef(onSelectionChange);
  const surface = useRef<HTMLDivElement>(null);
  changeHandler.current = onChange;
  selectionHandler.current = onSelectionChange;
  useEditor((root) => {
    const crepe = new Crepe({ root, defaultValue: markdown }).addFeature(
      (editor) => editor.use(protectedHtmlSourceView),
    );
    let initialized = false;
    crepe.on((listener) => {
      listener.markdownUpdated((_context, next, previous) => {
        // Crepe emits one normalization update while loading defaultValue. It is
        // editor initialization, not an author edit, so it must not create a draft.
        if (!initialized) {
          initialized = true;
          return;
        }
        if (next !== previous) changeHandler.current(next);
      });
    });
    return crepe;
  });
  useEffect(() => {
    const root = surface.current;
    if (!root) return;
    const emitSelection = () => {
      const selection = window.getSelection();
      if (
        !selection ||
        selection.isCollapsed ||
        !selection.anchorNode ||
        !root.contains(selection.anchorNode)
      ) {
        selectionHandler.current?.(undefined);
        return;
      }
      const text = selection.toString();
      if (!text.trim()) {
        selectionHandler.current?.(undefined);
        return;
      }
      const lines = text.split('\n').length;
      selectionHandler.current?.({
        text,
        startLine: 1,
        endLine: Math.max(1, lines),
      });
    };
    document.addEventListener('selectionchange', emitSelection);
    return () => document.removeEventListener('selectionchange', emitSelection);
  }, []);
  useEffect(() => {
    const root = surface.current;
    if (!root) return;
    const rewrite = () => {
      const editor = root.querySelector<HTMLElement>(
        '[contenteditable="true"]',
      );
      if (editor) editor.setAttribute('aria-label', '文章正文');
      for (const image of root.querySelectorAll<HTMLImageElement>('img[src]')) {
        if (image.dataset.blogStudioSource) continue;
        const source = image.getAttribute('src');
        if (!source || /^(?:data|blob|https?):/i.test(source)) continue;
        image.dataset.blogStudioSource = source;
        image.src = resolveImageSource(source);
      }
    };
    const observer = new MutationObserver(rewrite);
    observer.observe(root, { childList: true, subtree: true });
    rewrite();
    return () => observer.disconnect();
  }, [resolveImageSource]);
  return (
    <div ref={surface}>
      <Milkdown />
    </div>
  );
}

export function VisualEditor(props: VisualEditorProps) {
  return (
    <MilkdownProvider>
      <EditorSurface {...props} />
    </MilkdownProvider>
  );
}
