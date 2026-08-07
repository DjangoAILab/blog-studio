import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  parseOwnerSiteConfigurationYaml,
  type OwnerSiteConfiguration,
} from '@blog-studio/config';
import {
  SiteConfigurationRevisionConflictError,
  SqliteSiteConfigurationRepository,
  type ActiveSiteConfiguration,
  type SiteConfigurationRevision,
} from '@blog-studio/persistence';
import { stringify } from 'yaml';

import type { SiteService } from './sites.js';
import type { WorkspaceService } from './workspaces.js';

export {
  SiteConfigurationRevisionConflictError,
  type ActiveSiteConfiguration,
  type SiteConfigurationRevision,
};

function canonicalYaml(configuration: OwnerSiteConfiguration): string {
  return stringify(configuration, { lineWidth: 0 });
}

export class SiteConfigurationService {
  public constructor(
    private readonly sites: SiteService,
    private readonly workspaces: WorkspaceService,
    private readonly repository: SqliteSiteConfigurationRepository,
    private readonly directory: string,
  ) {}

  public path(siteId: string): string {
    if (!/^site-[a-z0-9-]+$/.test(siteId))
      throw new Error('Site configuration path is invalid');
    return join(this.directory, `${siteId}.yml`);
  }

  async #atomicWrite(path: string, yaml: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      await writeFile(temporary, yaml, { encoding: 'utf8', mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, path);
      await chmod(path, 0o600);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async #ensure(siteId: string): Promise<ActiveSiteConfiguration> {
    this.sites.get(siteId);
    const active = this.repository.active(siteId);
    if (active) {
      const ownerConfiguration = parseOwnerSiteConfigurationYaml(active.yaml);
      this.workspaces.applyOwnerConfiguration({
        workspaceId: this.sites.managementWorkspaceId(siteId),
        configurationPath: this.path(siteId),
        ownerConfiguration,
      });
      return active;
    }
    const workspaceId = this.sites.managementWorkspaceId(siteId);
    const yaml = canonicalYaml(this.workspaces.ownerConfiguration(workspaceId));
    await this.#atomicWrite(this.path(siteId), yaml);
    const created = this.repository.activate({
      siteId,
      expectedRevision: 0,
      yaml,
      source: 'legacy',
      at: new Date().toISOString(),
    });
    this.workspaces.applyOwnerConfiguration({
      workspaceId,
      configurationPath: this.path(siteId),
      ownerConfiguration: parseOwnerSiteConfigurationYaml(yaml),
    });
    return created;
  }

  public async get(siteId: string): Promise<ActiveSiteConfiguration> {
    return await this.#ensure(siteId);
  }

  public async history(
    siteId: string,
  ): Promise<readonly SiteConfigurationRevision[]> {
    await this.#ensure(siteId);
    return this.repository.list(siteId);
  }

  public validate(yaml: string): OwnerSiteConfiguration {
    return parseOwnerSiteConfigurationYaml(yaml);
  }

  public async activate(input: {
    readonly siteId: string;
    readonly expectedRevision: number;
    readonly yaml: string;
    readonly source?: 'owner' | 'revert';
  }): Promise<ActiveSiteConfiguration> {
    const previous = await this.#ensure(input.siteId);
    if (previous.revision !== input.expectedRevision)
      throw new SiteConfigurationRevisionConflictError(input.siteId);
    const ownerConfiguration = this.validate(input.yaml);
    const normalizedYaml = canonicalYaml(ownerConfiguration);
    const path = this.path(input.siteId);
    await this.#atomicWrite(path, normalizedYaml);
    let activated: ActiveSiteConfiguration;
    try {
      activated = this.repository.activate({
        siteId: input.siteId,
        expectedRevision: input.expectedRevision,
        yaml: normalizedYaml,
        source: input.source ?? 'owner',
        at: new Date().toISOString(),
      });
    } catch (error) {
      await this.#atomicWrite(path, previous.yaml);
      throw error;
    }
    this.workspaces.applyOwnerConfiguration({
      workspaceId: this.sites.managementWorkspaceId(input.siteId),
      configurationPath: path,
      ownerConfiguration,
    });
    return activated;
  }

  public async revert(input: {
    readonly siteId: string;
    readonly expectedRevision: number;
    readonly revision: number;
  }): Promise<ActiveSiteConfiguration> {
    const target = this.repository.revision(input.siteId, input.revision);
    if (!target)
      throw new Error(`Unknown Site configuration revision: ${input.revision}`);
    return await this.activate({
      siteId: input.siteId,
      expectedRevision: input.expectedRevision,
      yaml: target.yaml,
      source: 'revert',
    });
  }
}
