import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { parse } from 'yaml';

const writerActions = ['cos:PutObject', 'cos:DeleteObject'];

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${label} is required`);
  return value.trim();
}

function portablePrefix(value, label, allowRoot = false) {
  const text = requiredText(value, label);
  if (allowRoot && text === '/') return '';
  if (
    text.includes('\\') ||
    text.includes('*') ||
    /[\u0000-\u001f\u007f]/.test(text)
  )
    throw new Error(`${label} must be a portable object-key prefix`);
  const prefix = text.replace(/^\/+|\/+$/g, '');
  if (
    !prefix ||
    prefix.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`${label} must be a portable object-key prefix`);
  return prefix;
}

function objectResource(base, key) {
  return key ? `${base}/${key}` : `${base}/*`;
}

function descendantResource(base, prefix) {
  return prefix ? `${base}/${prefix}/*` : `${base}/*`;
}

function encodedListPrefix(prefix) {
  if (!prefix) return '*';
  return `${prefix.split('/').map(encodeURIComponent).join('%2F')}%2F*`;
}

export function createProductionWriterPolicy(input) {
  const region = requiredText(input.region, 'region');
  if (!/^[a-z0-9-]+$/.test(region))
    throw new Error('region must use a Tencent region identifier');
  const appId = requiredText(input.appId, 'appId');
  if (!/^\d+$/.test(appId)) throw new Error('appId must contain only digits');
  const bucket = requiredText(input.bucket, 'bucket');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(bucket) || !bucket.endsWith(`-${appId}`))
    throw new Error('bucket must be a COS bucket name ending in -APPID');
  const targetPrefix = portablePrefix(input.targetPrefix, 'targetPrefix', true);
  const statePrefix = portablePrefix(input.statePrefix, 'statePrefix');
  const protectedPrefixes = [
    ...new Set(
      (input.protectedPrefixes ?? []).map((value, index) =>
        portablePrefix(value, `protectedPrefixes[${index}]`),
      ),
    ),
  ].sort();
  if (protectedPrefixes.length === 0)
    throw new Error('At least one protected prefix is required');
  if (protectedPrefixes.includes('blog-studio-release.json'))
    throw new Error('The release marker cannot be a protected prefix');

  const base = `qcs::cos:${region}:uid/${appId}:${bucket}`;
  const publicPrefix = targetPrefix;
  const publicResource = descendantResource(base, publicPrefix);
  const stateResource = descendantResource(base, statePrefix);
  const protectedResources = protectedPrefixes.flatMap((prefix) => {
    const key = publicPrefix ? `${publicPrefix}/${prefix}` : prefix;
    return [objectResource(base, key), descendantResource(base, key)];
  });

  return {
    version: '2.0',
    statement: [
      {
        effect: 'allow',
        action: ['cos:GetBucket'],
        resource: [`${base}/*`],
        condition: {
          string_like: {
            'cos:prefix': [
              encodedListPrefix(publicPrefix),
              encodedListPrefix(statePrefix),
            ],
          },
        },
      },
      {
        effect: 'allow',
        action: ['cos:GetObject'],
        resource: [publicResource, stateResource],
      },
      {
        effect: 'allow',
        action: writerActions,
        resource: [publicResource, stateResource],
      },
      {
        effect: 'deny',
        action: writerActions,
        resource: protectedResources,
      },
      {
        effect: 'allow',
        action: ['cdn:PurgeUrlsCache', 'cdn:DescribePurgeTasks'],
        resource: ['*'],
      },
    ],
  };
}

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}

export function productionWriterInputFromConfig(config, appId) {
  const root = record(config, 'configuration');
  const publish = record(root.publish, 'publish');
  if (publish.adapter !== 'tencent-cos')
    throw new Error('publish.adapter must be tencent-cos');
  const options = record(publish.options, 'publish.options');
  if (!Array.isArray(options.protectedPrefixes))
    throw new Error('publish.options.protectedPrefixes must be an array');
  return {
    region: options.region,
    appId,
    bucket: options.bucket,
    targetPrefix: options.targetPrefix,
    statePrefix: options.statePrefix,
    protectedPrefixes: options.protectedPrefixes,
  };
}

function usage() {
  return `Usage:
  node scripts/tencent-production-writer-policy.mjs \\
    --config /path/to/blog-studio.yml \\
    --app-id 1250000000 \\
    [--output /secure/path/policy.json]

Manual input (prefer --config so protected prefixes cannot be omitted):
  node scripts/tencent-production-writer-policy.mjs \\
    --region ap-guangzhou \\
    --app-id 1250000000 \\
    --bucket example-1250000000 \\
    --target-prefix blog.example.com \\
    --state-prefix blog-studio-state/blog.example.com \\
    --protected-prefix static \\
    [--protected-prefix legacy/path] \\
    [--output /secure/path/policy.json]

The command prints JSON to stdout unless --output is provided. It never reads
or writes Tencent credentials.`;
}

function parseArguments(argumentsList) {
  const values = { protectedPrefixes: [] };
  const names = new Map([
    ['--region', 'region'],
    ['--app-id', 'appId'],
    ['--bucket', 'bucket'],
    ['--target-prefix', 'targetPrefix'],
    ['--state-prefix', 'statePrefix'],
    ['--config', 'config'],
    ['--output', 'output'],
  ]);
  for (let index = 0; index < argumentsList.length; index++) {
    const argument = argumentsList[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--protected-prefix') {
      const value = argumentsList[++index];
      if (value === undefined)
        throw new Error('--protected-prefix needs a value');
      values.protectedPrefixes.push(value);
      continue;
    }
    const name = names.get(argument);
    if (!name) throw new Error(`Unknown argument: ${argument}`);
    const value = argumentsList[++index];
    if (value === undefined) throw new Error(`${argument} needs a value`);
    if (values[name] !== undefined)
      throw new Error(`${argument} may only be provided once`);
    values[name] = value;
  }
  return values;
}

async function main() {
  const argumentsValue = parseArguments(process.argv.slice(2));
  if (argumentsValue.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { output, config, ...manualInput } = argumentsValue;
  let input = manualInput;
  if (config) {
    const manualNames = ['region', 'bucket', 'targetPrefix', 'statePrefix'];
    if (
      manualNames.some((name) => manualInput[name] !== undefined) ||
      manualInput.protectedPrefixes.length > 0
    )
      throw new Error('--config cannot be combined with manual target options');
    input = productionWriterInputFromConfig(
      parse(await readFile(config, 'utf8')),
      manualInput.appId,
    );
  }
  const json = `${JSON.stringify(createProductionWriterPolicy(input), null, 2)}\n`;
  if (output) await writeFile(output, json, { encoding: 'utf8', flag: 'wx' });
  else process.stdout.write(json);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
