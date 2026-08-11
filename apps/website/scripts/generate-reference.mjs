import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { format } from 'prettier';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const websiteRoot = fileURLToPath(new URL('..', import.meta.url));
const outputRoot = join(
  websiteRoot,
  'src',
  'content',
  'docs',
  'en',
  'docs',
  'reference',
);
const publicRoot = join(websiteRoot, 'public');

const crcTable = Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let bit = 0; bit < 8; bit += 1)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer)
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const label = Buffer.from(type);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([length, label, data, checksum]);
}

function favicon() {
  const size = 32;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = [0];
    for (let x = 0; x < size; x += 1) {
      const slash = Math.abs(x - (size - 1 - y)) < 3;
      const paper = x >= 7 && x <= 12 && y >= 7 && y <= 24;
      row.push(
        ...(slash
          ? [214, 83, 45, 255]
          : paper
            ? [244, 240, 228, 255]
            : [29, 40, 36, 255]),
      );
    }
    rows.push(...row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function extractInterface(source, name) {
  const start = source.indexOf(`export interface ${name}`);
  if (start < 0) throw new Error(`Interface not found: ${name}`);
  const opening = source.indexOf('{', start);
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated interface: ${name}`);
}

function schemaType(schema) {
  if (schema.const !== undefined) return `constant \`${schema.const}\``;
  if (Array.isArray(schema.type)) return schema.type.join(' or ');
  return schema.type ?? 'schema reference';
}

const schemaPath = join(
  repositoryRoot,
  'schemas',
  'blog-studio.v1.schema.json',
);
const examplePath = join(
  repositoryRoot,
  'examples',
  'config',
  'blog-studio.yml',
);
const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
const example = (await readFile(examplePath, 'utf8')).trimEnd();
const required = new Set(schema.required ?? []);
const rows = Object.entries(schema.properties)
  .map(([name, definition]) => {
    const notes = [];
    if (definition.pattern) notes.push(`Pattern: \`${definition.pattern}\``);
    if (definition.const !== undefined)
      notes.push(`Must equal \`${definition.const}\``);
    if (definition.additionalProperties === false)
      notes.push('Unknown keys rejected.');
    return `| \`${name}\` | ${required.has(name) ? 'yes' : 'no'} | ${schemaType(definition)} | ${notes.join(' ') || 'See nested schema.'} |`;
  })
  .join('\n');

const configDocument = `---
title: Configuration schema v1
description: Generated top-level reference for the strict Blog Studio workspace configuration.
---

> Generated from \`schemas/blog-studio.v1.schema.json\`. Do not edit this page by hand.

## Top-level fields

| Field | Required | Type | Constraint |
| --- | --- | --- | --- |
${rows}

All object sections are strict: an unknown key fails configuration loading. An
adapter ID uses lowercase kebab-case. Credential values are environment
references shaped as \`{ env: "VARIABLE_NAME" }\`, never literal secrets.

## Complete generic example

\`\`\`yaml
${example}
\`\`\`

## Optional image processing

Article resources preserve original bytes, format, extension, and metadata when
this section is absent or disabled. Enabling it affects only future uploads.

\`\`\`yaml
resources:
  imageProcessing:
    enabled: true
    format: webp       # original | webp
    quality: 82        # 1..100
    maxWidth: 1920     # 64..16384
    stripMetadata: true
\`\`\`

The machine-readable source is the repository's
[JSON Schema](https://github.com/DjangoAILab/blog-studio/blob/main/schemas/blog-studio.v1.schema.json).
`;

const interfaces = [
  ['common.ts', 'AdapterDescriptor'],
  ['generator.ts', 'GeneratorAdapter'],
  ['repository.ts', 'RepositoryAdapter'],
  ['assets.ts', 'AssetProvider'],
  ['publishing.ts', 'Publisher'],
  ['cache.ts', 'CacheProvider'],
];
const extracted = [];
for (const [filename, name] of interfaces) {
  const source = await readFile(
    join(repositoryRoot, 'packages', 'core', 'src', 'adapters', filename),
    'utf8',
  );
  extracted.push(
    `## ${name}\n\n\`\`\`ts\n${extractInterface(source, name)}\n\`\`\``,
  );
}
const adapterDocument = `---
title: Adapter API v1
description: Generated TypeScript interfaces for Blog Studio generator and provider adapters.
---

> Generated from \`packages/core/src/adapters/*.ts\`. Do not edit this page by hand.

\`ADAPTER_API_VERSION\` is currently \`1\`. Implementations also need the domain
types referenced by these contracts and should pass the reusable adapter testkit.

${extracted.join('\n\n')}

Read the [adapter architecture](../../adapters/overview/) before implementing a
provider. Source is authoritative when a generated page and a package version
differ.
`;

await Promise.all([
  mkdir(outputRoot, { recursive: true }),
  mkdir(publicRoot, { recursive: true }),
]);
await Promise.all([
  writeFile(
    join(outputRoot, 'configuration.md'),
    await format(configDocument, { parser: 'markdown', singleQuote: true }),
  ),
  writeFile(
    join(outputRoot, 'adapter-api.md'),
    await format(adapterDocument, { parser: 'markdown', singleQuote: true }),
  ),
  writeFile(join(publicRoot, 'favicon.png'), favicon()),
]);
