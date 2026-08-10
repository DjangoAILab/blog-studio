import { access, readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = fileURLToPath(new URL('..', import.meta.url));
const outputRoot = join(websiteRoot, 'dist');
const configuredBase = (process.env.BLOG_STUDIO_DOCS_BASE ?? '').replace(
  /^\/+|\/+$/g,
  '',
);

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? htmlFiles(path)
        : Promise.resolve(extname(path) === '.html' ? [path] : []);
    }),
  );
  return nested.flat();
}

function outputPath(pathname) {
  let clean = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (
    configuredBase &&
    (clean === configuredBase || clean.startsWith(`${configuredBase}/`))
  )
    clean = clean.slice(configuredBase.length).replace(/^\/+/, '');
  if (!clean) return join(outputRoot, 'index.html');
  return extname(clean)
    ? join(outputRoot, clean)
    : join(outputRoot, clean, 'index.html');
}

const failures = [];
for (const file of await htmlFiles(outputRoot)) {
  const html = await readFile(file, 'utf8');
  const links = [...html.matchAll(/\shref=["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  for (const href of links) {
    if (
      href.startsWith('http:') ||
      href.startsWith('https:') ||
      href.startsWith('mailto:') ||
      href.startsWith('data:')
    )
      continue;
    const url = new URL(
      href,
      `https://local.invalid/${file.slice(outputRoot.length + 1)}`,
    );
    const target = href.startsWith('#') ? file : outputPath(url.pathname);
    try {
      await access(resolve(target));
    } catch {
      failures.push(`${file.slice(outputRoot.length + 1)} -> ${href}`);
      continue;
    }
    if (url.hash) {
      const targetHtml =
        target === file ? html : await readFile(target, 'utf8');
      const id = decodeURIComponent(url.hash.slice(1));
      if (!targetHtml.includes(`id="${id}"`))
        failures.push(
          `${file.slice(outputRoot.length + 1)} -> missing ${url.hash}`,
        );
    }
  }
}

if (failures.length > 0)
  throw new Error(`Broken internal links:\n${failures.join('\n')}`);
console.log('internal link check passed');
