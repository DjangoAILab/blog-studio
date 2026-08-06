import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { useEffect, useRef } from 'react';

interface VisualEditorProps {
  readonly markdown: string;
  readonly onChange: (markdown: string) => void;
  readonly resolveImageSource: (source: string) => string;
}

function EditorSurface({
  markdown,
  onChange,
  resolveImageSource,
}: VisualEditorProps) {
  const changeHandler = useRef(onChange);
  const surface = useRef<HTMLDivElement>(null);
  changeHandler.current = onChange;
  useEditor((root) => {
    const crepe = new Crepe({ root, defaultValue: markdown });
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
