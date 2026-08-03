import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createProductionWriterPolicy,
  productionWriterInputFromConfig,
} from './tencent-production-writer-policy.mjs';

const exampleBase = 'qcs::cos:ap-guangzhou:uid/1250000000:example-1250000000';
const writerInput = {
  region: 'ap-guangzhou',
  appId: '1250000000',
  bucket: 'example-1250000000',
  targetPrefix: 'blog.example.com',
  statePrefix: 'blog-studio-state/blog.example.com',
  protectedPrefixes: [
    'static',
    'legacy/path-to-preserve',
    'legacy-object.html',
  ],
};

const examples = [
  {
    file: new URL(
      '../deploy/tencent/cam-staging-policy.example.json',
      import.meta.url,
    ),
    prefixes: [
      'blog.example.com%2F__blog-studio-staging%2Frun-001%2F*',
      'blog-studio-state%2Fblog.example.com%2F__blog-studio-staging%2Frun-001%2F*',
    ],
  },
  {
    file: new URL(
      '../deploy/tencent/cam-production-adoption-policy.example.json',
      import.meta.url,
    ),
    prefixes: [
      'blog.example.com%2F*',
      'blog-studio-state%2Fblog.example.com%2F*',
    ],
    adoptionOnly: true,
  },
  {
    file: new URL(
      '../deploy/tencent/cam-production-writer-policy.example.json',
      import.meta.url,
    ),
    prefixes: [
      'blog.example.com%2F*',
      'blog-studio-state%2Fblog.example.com%2F*',
    ],
    writer: true,
  },
];

function wildcardMatch(pattern, value) {
  const expression = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*');
  return new RegExp(`^${expression}$`).test(value);
}

function decision(policy, action, resource, context = {}) {
  const matches = policy.statement.filter((statement) => {
    if (!statement.action.some((pattern) => wildcardMatch(pattern, action)))
      return false;
    if (!statement.resource.some((pattern) => wildcardMatch(pattern, resource)))
      return false;
    const prefixPatterns = statement.condition?.string_like?.['cos:prefix'];
    if (!prefixPatterns) return true;
    return (
      typeof context.prefix === 'string' &&
      prefixPatterns.some((pattern) => wildcardMatch(pattern, context.prefix))
    );
  });
  if (matches.some((statement) => statement.effect === 'deny')) return 'deny';
  if (matches.some((statement) => statement.effect === 'allow')) return 'allow';
  return 'deny';
}

for (const example of examples) {
  const policy = JSON.parse(await readFile(example.file, 'utf8'));
  const listStatement = policy.statement.find((statement) =>
    statement.action.includes('cos:GetBucket'),
  );
  assert.ok(listStatement, `${example.file.pathname} must grant GetBucket`);

  const prefixes = listStatement.condition?.string_like?.['cos:prefix'];
  assert.deepEqual(
    prefixes,
    example.prefixes,
    `${example.file.pathname} must URL-encode every slash in cos:prefix`,
  );
  assert.ok(
    prefixes.every((prefix) => !prefix.includes('/')),
    `${example.file.pathname} contains a literal slash in cos:prefix`,
  );

  if (example.adoptionOnly) {
    const writeStatement = policy.statement.find((statement) =>
      statement.action.includes('cos:PutObject'),
    );
    assert.deepEqual(writeStatement.resource, [
      'qcs::cos:ap-guangzhou:uid/1250000000:example-1250000000/blog.example.com/blog-studio-release.json',
      'qcs::cos:ap-guangzhou:uid/1250000000:example-1250000000/blog-studio-state/blog.example.com/*',
    ]);
    assert.ok(
      !writeStatement.resource.includes(
        'qcs::cos:ap-guangzhou:uid/1250000000:example-1250000000/blog.example.com/*',
      ),
      'the adoption policy must not grant ordinary production content writes',
    );
  }

  if (example.writer) {
    assert.deepEqual(policy, createProductionWriterPolicy(writerInput));
    const writeStatement = policy.statement.find(
      (statement) =>
        statement.effect === 'allow' &&
        statement.action.includes('cos:PutObject'),
    );
    assert.deepEqual(writeStatement.resource, [
      `${exampleBase}/blog.example.com/*`,
      `${exampleBase}/blog-studio-state/blog.example.com/*`,
    ]);
    const protectedStatement = policy.statement.find(
      (statement) =>
        statement.effect === 'deny' &&
        statement.action.includes('cos:PutObject'),
    );
    assert.deepEqual(protectedStatement.resource, [
      `${exampleBase}/blog.example.com/legacy-object.html`,
      `${exampleBase}/blog.example.com/legacy-object.html/*`,
      `${exampleBase}/blog.example.com/legacy/path-to-preserve`,
      `${exampleBase}/blog.example.com/legacy/path-to-preserve/*`,
      `${exampleBase}/blog.example.com/static`,
      `${exampleBase}/blog.example.com/static/*`,
    ]);
    assert.ok(
      policy.statement.every(
        (statement) => !statement.action.includes('cdn:PurgePathCache'),
      ),
      'the production writer must not grant directory purge',
    );

    const publicObject = `${exampleBase}/blog.example.com/index.html`;
    const stateObject = `${exampleBase}/blog-studio-state/blog.example.com/active.json`;
    const staticObject = `${exampleBase}/blog.example.com/static/legacy.js`;
    const legacyObject = `${exampleBase}/blog.example.com/legacy-object.html`;
    const outsideObject = `${exampleBase}/outside/index.html`;
    assert.equal(decision(policy, 'cos:PutObject', publicObject), 'allow');
    assert.equal(decision(policy, 'cos:DeleteObject', publicObject), 'allow');
    assert.equal(decision(policy, 'cos:PutObject', stateObject), 'allow');
    assert.equal(decision(policy, 'cos:DeleteObject', stateObject), 'allow');
    assert.equal(decision(policy, 'cos:PutObject', staticObject), 'deny');
    assert.equal(decision(policy, 'cos:DeleteObject', staticObject), 'deny');
    assert.equal(decision(policy, 'cos:PutObject', legacyObject), 'deny');
    assert.equal(decision(policy, 'cos:DeleteObject', legacyObject), 'deny');
    assert.equal(decision(policy, 'cos:GetObject', staticObject), 'allow');
    assert.equal(decision(policy, 'cos:PutObject', outsideObject), 'deny');
    assert.equal(decision(policy, 'cos:PutBucket', `${exampleBase}/*`), 'deny');
    assert.equal(
      decision(policy, 'cos:GetBucket', `${exampleBase}/*`, {
        prefix: 'blog.example.com%2Farticles%2F',
      }),
      'allow',
    );
    assert.equal(
      decision(policy, 'cos:GetBucket', `${exampleBase}/*`, {
        prefix: 'outside%2F',
      }),
      'deny',
    );
    assert.equal(decision(policy, 'cdn:PurgeUrlsCache', '*'), 'allow');
    assert.equal(decision(policy, 'cdn:DescribePurgeTasks', '*'), 'allow');
    assert.equal(decision(policy, 'cdn:PurgePathCache', '*'), 'deny');
  }
}

assert.throws(
  () => createProductionWriterPolicy({ ...writerInput, protectedPrefixes: [] }),
  /protected prefix/i,
);
assert.throws(
  () =>
    createProductionWriterPolicy({
      ...writerInput,
      protectedPrefixes: ['blog-studio-release.json'],
    }),
  /release marker/i,
);
assert.throws(
  () =>
    createProductionWriterPolicy({
      ...writerInput,
      bucket: 'wrong-app-id-1250000001',
    }),
  /APPID/i,
);
assert.throws(
  () =>
    createProductionWriterPolicy({
      ...writerInput,
      targetPrefix: 'blog.*.example.com',
    }),
  /portable object-key prefix/i,
);
const rootPolicy = createProductionWriterPolicy({
  ...writerInput,
  targetPrefix: '/',
  protectedPrefixes: ['static', '旧资源/保留'],
});
assert.deepEqual(rootPolicy.statement[0].condition.string_like['cos:prefix'], [
  '*',
  'blog-studio-state%2Fblog.example.com%2F*',
]);
assert.ok(
  rootPolicy.statement[3].resource.includes(`${exampleBase}/旧资源/保留/*`),
  'root targets and Unicode protected prefixes must retain exact COS keys',
);
assert.deepEqual(
  productionWriterInputFromConfig(
    {
      publish: {
        adapter: 'tencent-cos',
        options: {
          region: writerInput.region,
          bucket: writerInput.bucket,
          targetPrefix: writerInput.targetPrefix,
          statePrefix: writerInput.statePrefix,
          protectedPrefixes: writerInput.protectedPrefixes,
        },
      },
    },
    writerInput.appId,
  ),
  writerInput,
);
assert.throws(
  () =>
    productionWriterInputFromConfig(
      { publish: { adapter: 'filesystem', options: {} } },
      writerInput.appId,
    ),
  /tencent-cos/,
);

console.log(
  'Tencent CAM policy examples passed encoded-prefix, adoption, writer, and protected-object checks',
);
