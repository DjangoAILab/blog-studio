import Tagify from '@yaireo/tagify';
import '@yaireo/tagify/dist/tagify.css';
import { useEffect, useImperativeHandle, useRef } from 'react';

import { parseTagifyMix } from './agent-mix.js';

export interface AgentMixTag {
  readonly value: string;
  readonly title: string;
}

export interface AgentMixPayload {
  readonly text: string;
  readonly refs: string[];
}

export interface AgentMixInputHandle {
  read: () => AgentMixPayload;
  clear: () => void;
}

interface AgentMixInputProps {
  readonly handleRef: React.Ref<AgentMixInputHandle>;
  readonly tags: readonly AgentMixTag[];
  readonly placeholder: string;
  readonly disabled?: boolean;
  readonly onChange?: (payload: AgentMixPayload) => void;
  readonly onSubmit: () => void;
  readonly onRemoveRef?: (value: string) => void;
}

function syncTags(instance: Tagify, tags: readonly AgentMixTag[]): void {
  const existing = new Set(
    instance.value.map((item) => String(item.value ?? '')),
  );
  for (const tag of tags) {
    if (existing.has(tag.value)) continue;
    instance.whitelist = [
      ...(instance.whitelist ?? []),
      { value: tag.value, title: tag.title },
    ];
    instance.addTags([{ value: tag.value, title: tag.title }]);
  }
}

export function AgentMixInput({
  handleRef,
  tags,
  placeholder,
  disabled = false,
  onChange,
  onSubmit,
  onRemoveRef,
}: AgentMixInputProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const tagify = useRef<Tagify | undefined>(undefined);
  const tagsRef = useRef(tags);
  const submit = useRef(onSubmit);
  const removeRef = useRef(onRemoveRef);
  const changeRef = useRef(onChange);
  tagsRef.current = tags;
  submit.current = onSubmit;
  removeRef.current = onRemoveRef;
  changeRef.current = onChange;

  useEffect(() => {
    const input = area.current;
    if (!input) return;
    const instance = new Tagify(input, {
      mode: 'mix',
      pattern: /#\d+/,
      duplicates: false,
      editTags: false,
      addTagOnBlur: false,
      pasteAsTags: false,
      dropdown: { enabled: 0, maxItems: 0 },
      originalInputValueFormat: (value) =>
        JSON.stringify({ value: String(value.value ?? '') }),
      placeholder,
      a11y: { inputAriaLabel: '发送给 AI' },
    });
    const emitChange = () => {
      changeRef.current?.(parseTagifyMix(instance.getInputValue() ?? ''));
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        submit.current();
      }
    };
    instance.DOM.input.addEventListener('keydown', onKey);
    instance.on('change', emitChange);
    instance.on('input', emitChange);
    instance.on('add', emitChange);
    instance.on('remove', (event) => {
      const value = (event.detail as { data?: { value?: string } } | undefined)
        ?.data?.value;
      if (value) removeRef.current?.(value);
      emitChange();
    });
    tagify.current = instance;
    syncTags(instance, tagsRef.current);
    emitChange();
    return () => {
      instance.DOM.input.removeEventListener('keydown', onKey);
      instance.destroy();
      tagify.current = undefined;
    };
  }, [placeholder]);

  useEffect(() => {
    const instance = tagify.current;
    if (instance) syncTags(instance, tags);
  }, [tags]);

  useEffect(() => {
    const node = tagify.current?.DOM.input;
    if (node) node.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }, [disabled]);

  useImperativeHandle(handleRef, () => ({
    read() {
      const raw = tagify.current?.getInputValue() ?? area.current?.value ?? '';
      return parseTagifyMix(raw);
    },
    clear() {
      tagify.current?.removeAllTags();
      if (tagify.current?.DOM.input) tagify.current.DOM.input.textContent = '';
      tagify.current?.update();
      changeRef.current?.({ text: '', refs: [] });
    },
  }));

  return (
    <textarea
      ref={area}
      className="agent-mix-source"
      aria-hidden="true"
      disabled={disabled}
      rows={4}
    />
  );
}
