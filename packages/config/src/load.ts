import { parse } from 'yaml';

import { parseBlogStudioConfig, type BlogStudioConfig } from './schema.js';

export function parseBlogStudioConfigYaml(source: string): BlogStudioConfig {
  return parseBlogStudioConfig(parse(source, { uniqueKeys: true }));
}
