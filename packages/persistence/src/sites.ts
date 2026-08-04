import type { StudioDatabase } from './database.js';

export interface SiteRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly displayName: string;
  readonly canonicalUrl?: string;
  readonly configurationPath: string;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CreateSiteInput = SiteRecord;

interface SiteRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly display_name: string;
  readonly canonical_url: string | null;
  readonly configuration_path: string;
  readonly capabilities_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export type SiteUniqueField =
  'displayName' | 'workspaceId' | 'configurationPath';

export class SiteAlreadyExistsError extends Error {
  public constructor(readonly field: SiteUniqueField) {
    super(`A Site already exists with the same ${field}`);
    this.name = 'SiteAlreadyExistsError';
  }
}

export class SiteRevisionConflictError extends Error {
  public constructor(readonly siteId: string) {
    super(`Site ${siteId} changed since it was read`);
    this.name = 'SiteRevisionConflictError';
  }
}

function parseCapabilities(value: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored Site capabilities must be an object');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function siteFromRow(row: SiteRow): SiteRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    displayName: row.display_name,
    ...(row.canonical_url === null ? {} : { canonicalUrl: row.canonical_url }),
    configurationPath: row.configuration_path,
    capabilities: parseCapabilities(row.capabilities_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function uniqueField(error: Error): SiteUniqueField | undefined {
  if (/sites_display_name_unique/.test(error.message)) return 'displayName';
  if (/sites\.workspace_id/.test(error.message)) return 'workspaceId';
  if (/sites\.configuration_path/.test(error.message)) {
    return 'configurationPath';
  }
  return undefined;
}

const selectSite = `SELECT id, workspace_id, display_name, canonical_url,
                            configuration_path, capabilities_json,
                            created_at, updated_at
                       FROM sites`;

export class SqliteSiteRepository {
  public constructor(private readonly database: StudioDatabase) {}

  public create(input: CreateSiteInput): SiteRecord {
    try {
      this.database
        .prepare(
          `INSERT INTO sites (
             id, workspace_id, display_name, canonical_url,
             configuration_path, capabilities_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.workspaceId,
          input.displayName,
          input.canonicalUrl ?? null,
          input.configurationPath,
          JSON.stringify(input.capabilities),
          input.createdAt,
          input.updatedAt,
        );
    } catch (error) {
      if (error instanceof Error) {
        const field = uniqueField(error);
        if (field) throw new SiteAlreadyExistsError(field);
      }
      throw error;
    }
    return this.get(input.id)!;
  }

  public get(id: string): SiteRecord | null {
    const row = this.database.prepare(`${selectSite} WHERE id = ?`).get(id) as
      SiteRow | undefined;
    return row ? siteFromRow(row) : null;
  }

  public getByWorkspaceId(workspaceId: string): SiteRecord | null {
    const row = this.database
      .prepare(`${selectSite} WHERE workspace_id = ?`)
      .get(workspaceId) as SiteRow | undefined;
    return row ? siteFromRow(row) : null;
  }

  public list(): readonly SiteRecord[] {
    return (
      this.database
        .prepare(`${selectSite} ORDER BY lower(display_name), id`)
        .all() as unknown as SiteRow[]
    ).map(siteFromRow);
  }

  public update(input: {
    readonly id: string;
    readonly expectedUpdatedAt: string;
    readonly displayName: string;
    readonly canonicalUrl?: string;
    readonly capabilities: Readonly<Record<string, unknown>>;
    readonly updatedAt: string;
  }): SiteRecord {
    try {
      const result = this.database
        .prepare(
          `UPDATE sites
              SET display_name = ?, canonical_url = ?, capabilities_json = ?,
                  updated_at = ?
            WHERE id = ? AND updated_at = ?`,
        )
        .run(
          input.displayName,
          input.canonicalUrl ?? null,
          JSON.stringify(input.capabilities),
          input.updatedAt,
          input.id,
          input.expectedUpdatedAt,
        );
      if (result.changes !== 1) throw new SiteRevisionConflictError(input.id);
    } catch (error) {
      if (error instanceof Error) {
        const field = uniqueField(error);
        if (field) throw new SiteAlreadyExistsError(field);
      }
      throw error;
    }
    return this.get(input.id)!;
  }
}
