import { z } from 'zod';

import { blogStudioConfigSchema } from './schema.js';

export function createBlogStudioJsonSchema(): object {
  return z.toJSONSchema(blogStudioConfigSchema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
  });
}
