declare module '@yaireo/tagify' {
  export interface TagData {
    value: string;
    title?: string;
  }

  export interface TagifySettings {
    mode?: 'mix' | 'select';
    pattern?: RegExp | string;
    duplicates?: boolean;
    editTags?: boolean | number;
    addTagOnBlur?: boolean;
    pasteAsTags?: boolean;
    whitelist?: Array<string | TagData>;
    placeholder?: string;
    originalInputValueFormat?: (value: TagData) => string;
    dropdown?: { enabled?: number; maxItems?: number };
    a11y?: { inputAriaLabel?: string };
  }

  export default class Tagify {
    constructor(
      input: HTMLInputElement | HTMLTextAreaElement,
      settings?: TagifySettings,
    );
    whitelist: Array<string | TagData>;
    value: TagData[];
    DOM: { input: HTMLElement; originalInput: HTMLElement };
    addTags(tags: Array<string | TagData>): unknown;
    removeAllTags(): void;
    getInputValue(): string;
    update(): void;
    destroy(): void;
    on(event: string, cb: (event: CustomEvent) => void): this;
  }
}
