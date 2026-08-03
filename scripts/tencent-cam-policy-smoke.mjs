import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
];

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
}

console.log(
  'Tencent CAM policy examples passed encoded-prefix and adoption-boundary checks',
);
