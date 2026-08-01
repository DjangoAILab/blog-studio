import { createBlogStudioJsonSchema } from './json-schema.js';

process.stdout.write(
  `${JSON.stringify(createBlogStudioJsonSchema(), null, 2)}\n`,
);
