import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { useRef } from 'react';

interface VisualEditorProps {
  readonly markdown: string;
  readonly onChange: (markdown: string) => void;
}

function EditorSurface({ markdown, onChange }: VisualEditorProps) {
  const changeHandler = useRef(onChange);
  changeHandler.current = onChange;
  useEditor((root) => {
    const crepe = new Crepe({ root, defaultValue: markdown });
    crepe.on((listener) => {
      listener.markdownUpdated((_context, next, previous) => {
        if (next !== previous) changeHandler.current(next);
      });
    });
    return crepe;
  });
  return <Milkdown />;
}

export function VisualEditor(props: VisualEditorProps) {
  return (
    <MilkdownProvider>
      <EditorSurface {...props} />
    </MilkdownProvider>
  );
}
