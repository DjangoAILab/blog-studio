import { parse } from 'yaml';

import {
  parseBlogStudioConfig,
  parseOwnerSiteConfiguration,
  type BlogStudioConfig,
  type OwnerSiteConfiguration,
} from './schema.js';

export function parseBlogStudioConfigYaml(source: string): BlogStudioConfig {
  return parseBlogStudioConfig(parse(source, { uniqueKeys: true }));
}

export function parseOwnerSiteConfigurationYaml(
  source: string,
): OwnerSiteConfiguration {
  return parseOwnerSiteConfiguration(parse(source, { uniqueKeys: true }));
}
