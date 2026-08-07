import type { FrontMatterField, FrontMatterValue } from '@blog-studio/core';
import { useEffect, useState } from 'react';
import { parseDocument, stringify } from 'yaml';

type FrontMatter = Readonly<Record<string, unknown>>;

interface FrontMatterEditorProps {
  readonly disabled: boolean;
  readonly fields: readonly FrontMatterField[];
  readonly frontMatter: FrontMatter;
  readonly frontMatterSource?: string;
  readonly frontMatterParseError?: string;
  readonly onChange: (frontMatter: FrontMatter) => void;
  readonly onRepair?: (frontMatterSource: string) => Promise<void>;
}

function listValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .filter((item): item is string => typeof item === 'string')
    .join(', ');
}

function updateValue(
  frontMatter: FrontMatter,
  key: string,
  value: unknown,
): FrontMatter {
  const next = { ...frontMatter } as Record<string, unknown>;
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

function updateList(
  frontMatter: FrontMatter,
  key: string,
  text: string,
  preserveSingle = false,
): FrontMatter {
  const values = text
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return updateValue(
    frontMatter,
    key,
    values.length === 0
      ? undefined
      : preserveSingle && values.length === 1
        ? values[0]
        : values,
  );
}

function validValue(value: unknown): value is FrontMatterValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return true;
  if (Array.isArray(value)) return value.every(validValue);
  return (
    typeof value === 'object' &&
    Object.values(value as Record<string, unknown>).every(validValue)
  );
}

function CustomField({
  field,
  frontMatter,
  disabled,
  onChange,
}: {
  readonly field: FrontMatterField;
  readonly frontMatter: FrontMatter;
  readonly disabled: boolean;
  readonly onChange: (next: FrontMatter) => void;
}) {
  const value = frontMatter[field.key];
  const common = {
    disabled,
    id: `front-matter-${field.key}`,
  };
  if (field.type === 'boolean') {
    return (
      <label className="studio3-front-matter-checkbox" htmlFor={common.id}>
        <input
          {...common}
          checked={value === true}
          type="checkbox"
          onChange={(event) =>
            onChange(updateValue(frontMatter, field.key, event.target.checked))
          }
        />
        <span>{field.label}</span>
      </label>
    );
  }
  if (field.type === 'list') {
    return (
      <label htmlFor={common.id}>
        {field.label}
        <input
          {...common}
          placeholder={field.description ?? '用逗号分隔'}
          value={listValue(value)}
          onChange={(event) =>
            onChange(updateList(frontMatter, field.key, event.target.value))
          }
        />
      </label>
    );
  }
  if (field.type === 'object') {
    return (
      <label htmlFor={common.id}>
        {field.label}
        <input
          {...common}
          disabled
          placeholder={field.description ?? '请在高级 YAML 中编辑'}
          value="在高级 YAML 中编辑"
          readOnly
        />
      </label>
    );
  }
  if (field.enum) {
    return (
      <label htmlFor={common.id}>
        {field.label}
        <select
          {...common}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) =>
            onChange(
              updateValue(
                frontMatter,
                field.key,
                event.target.value || undefined,
              ),
            )
          }
        >
          <option value="">未设置</option>
          {field.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label htmlFor={common.id}>
      {field.label}
      <input
        {...common}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        placeholder={field.description}
        type={field.type === 'number' ? 'number' : 'text'}
        value={
          typeof value === 'string' || typeof value === 'number'
            ? String(value)
            : ''
        }
        onChange={(event) => {
          const next = event.target.value;
          onChange(
            updateValue(
              frontMatter,
              field.key,
              next === ''
                ? undefined
                : field.type === 'number'
                  ? Number(next)
                  : next,
            ),
          );
        }}
      />
    </label>
  );
}

export function FrontMatterEditor({
  disabled,
  fields,
  frontMatter,
  frontMatterSource,
  frontMatterParseError,
  onChange,
  onRepair,
}: FrontMatterEditorProps) {
  const [raw, setRaw] = useState(
    frontMatterSource ?? stringify(frontMatter, { lineWidth: 0 }).trimEnd(),
  );
  const [rawError, setRawError] = useState('');
  const source =
    frontMatterSource ?? stringify(frontMatter, { lineWidth: 0 }).trimEnd();

  useEffect(() => {
    setRaw(source);
    setRawError('');
  }, [source]);

  function applyRaw(): void {
    const document = parseDocument(raw);
    if (document.errors.length > 0) {
      setRawError(document.errors[0]?.message ?? 'YAML 无法解析');
      return;
    }
    const value = document.toJSON() as unknown;
    if (
      value === null ||
      Array.isArray(value) ||
      typeof value !== 'object' ||
      !validValue(value)
    ) {
      setRawError('属性 YAML 必须是只包含受支持值的对象。');
      return;
    }
    setRawError('');
    if (onRepair) {
      void onRepair(raw).catch((reason: unknown) =>
        setRawError(
          reason instanceof Error ? reason.message : '修复 YAML 失败',
        ),
      );
      return;
    }
    onChange(value as FrontMatter);
  }

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
            onChange(
              updateList(frontMatter, 'categories', event.target.value, true),
            )
          }
        />
      </label>
      {fields.map((field) => (
        <CustomField
          key={field.key}
          disabled={disabled}
          field={field}
          frontMatter={frontMatter}
          onChange={onChange}
        />
      ))}
      <details className="studio3-front-matter-advanced">
        <summary>高级 YAML</summary>
        <p>
          {frontMatterParseError
            ? '原始 YAML 无法解析。修复后会直接替换这一段属性，正文不会改变。'
            : '编辑任何主题支持的属性。应用后，未变更的原始字段、注释和顺序会保留。'}
        </p>
        <textarea
          aria-label="高级 YAML"
          disabled={disabled && !onRepair}
          value={raw}
          onChange={(event) => {
            setRaw(event.target.value);
            setRawError('');
          }}
        />
        {rawError ? <p role="alert">{rawError}</p> : null}
        <button
          type="button"
          disabled={(disabled && !onRepair) || raw === source}
          onClick={applyRaw}
        >
          {onRepair ? '修复原始 YAML' : '应用 YAML 属性'}
        </button>
      </details>
    </section>
  );
}
