import { micromark } from 'micromark';

export function AgentMarkdown({ text }: { readonly text: string }) {
  const html = micromark(text, { allowDangerousHtml: false });
  return (
    <div
      className="studio2-agent-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
