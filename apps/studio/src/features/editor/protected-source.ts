/**
 * A visual editor cannot safely edit every Markdown construct. In particular,
 * HTML comments may intentionally contain Markdown that must remain invisible
 * on the published site. Keep those opaque blocks out of the WYSIWYG surface.
 */
export function isProtectedHtmlSource(value: string): boolean {
  return /^<!--[\s\S]*-->$/.test(value.trim());
}

export function protectedSourceLabel(value: string): string {
  if (/!\[[^\]]*\]\([^)]*\)/.test(value))
    return '已隐藏的 Markdown 源块 · 含图片或资源';
  return '已隐藏的 Markdown 源块 · HTML 注释';
}
