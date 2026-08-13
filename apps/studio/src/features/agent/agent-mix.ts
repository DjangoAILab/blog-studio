export function parseTagifyMix(raw: string): {
  readonly text: string;
  readonly refs: string[];
} {
  const refs: string[] = [];
  const text = raw.replace(/\[\[(.*?)\]\]/gs, (full, inner: string) => {
    try {
      const parsed = JSON.parse(inner) as { value?: string } | string;
      const value = typeof parsed === 'string' ? parsed : (parsed.value ?? '');
      if (value) refs.push(value);
      return value;
    } catch {
      const value = inner.trim();
      if (value) refs.push(value);
      return value || full;
    }
  });
  return { text, refs };
}
