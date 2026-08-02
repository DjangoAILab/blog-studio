import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const workspace = new URL('../', import.meta.url);
const postsDirectory = new URL('content/posts/', workspace);
const outputDirectory = new URL('public/', workspace);

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function parseMarkdown(raw, filename) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  const frontMatter = match?.[1] ?? '';
  const field = (name) =>
    new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(frontMatter)?.[1]?.trim();
  const title = field('title') ?? basename(filename, extname(filename));
  const permalink = (
    field('permalink') ?? `${basename(filename, extname(filename))}/`
  ).replace(/^\/+/, '');
  if (
    permalink.length === 0 ||
    permalink.includes('..') ||
    /^[a-z]+:/i.test(permalink)
  )
    throw new Error(`Unsafe permalink in ${filename}`);
  return { title, permalink, body: raw.slice(match?.[0].length ?? 0) };
}

function renderMarkdown(markdown) {
  return markdown
    .trim()
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const heading = /^#\s+(.+)$/.exec(block);
      return heading
        ? `<h1>${escapeHtml(heading[1])}</h1>`
        : `<p>${escapeHtml(block).replaceAll(/\r?\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(new URL('static/', workspace), new URL('public/static/', workspace), {
  recursive: true,
});

const posts = [];
for (const filename of (await readdir(postsDirectory)).sort()) {
  if (!['.md', '.markdown'].includes(extname(filename).toLowerCase())) continue;
  const post = parseMarkdown(
    await readFile(new URL(filename, postsDirectory), 'utf8'),
    filename,
  );
  const destination = new URL(
    `${post.permalink.replace(/\/?$/, '/')}`,
    outputDirectory,
  );
  await mkdir(destination, { recursive: true });
  await writeFile(
    new URL('index.html', destination),
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(post.title)}</title><link rel="stylesheet" href="/static/site.css"></head><body><a href="/">Example blog</a><main>${renderMarkdown(post.body)}</main></body></html>`,
  );
  posts.push(post);
}

await writeFile(
  new URL('index.html', outputDirectory),
  `<!doctype html><html><head><meta charset="utf-8"><title>Example blog</title><link rel="stylesheet" href="/static/site.css"></head><body><h1>Example blog</h1><ol>${posts.map((post) => `<li><a href="/${post.permalink}">${escapeHtml(post.title)}</a></li>`).join('')}</ol></body></html>`,
);
