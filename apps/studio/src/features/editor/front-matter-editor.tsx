type FrontMatter = Readonly<Record<string, unknown>>;

interface FrontMatterEditorProps {
  readonly disabled: boolean;
  readonly frontMatter: FrontMatter;
  readonly onChange: (frontMatter: FrontMatter) => void;
}

function listValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .filter((item): item is string => typeof item === 'string')
    .join(', ');
}

function updateList(
  frontMatter: FrontMatter,
  key: 'tags' | 'categories',
  text: string,
): FrontMatter {
  const values = text
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const next = { ...frontMatter } as Record<string, unknown>;
  if (values.length === 0) delete next[key];
  else if (key === 'categories' && values.length === 1) next[key] = values[0];
  else next[key] = values;
  return next;
}

export function FrontMatterEditor({
  disabled,
  frontMatter,
  onChange,
}: FrontMatterEditorProps) {
  return (
    <section className="studio3-front-matter" aria-label="文章属性">
      <label>
        标签
        <input
          disabled={disabled}
          placeholder="用逗号分隔"
          value={listValue(frontMatter.tags)}
          onChange={(event) =>
            onChange(updateList(frontMatter, 'tags', event.target.value))
          }
        />
      </label>
      <label>
        分类
        <input
          disabled={disabled}
          placeholder="用逗号分隔"
          value={listValue(frontMatter.categories)}
          onChange={(event) =>
            onChange(updateList(frontMatter, 'categories', event.target.value))
          }
        />
      </label>
    </section>
  );
}
