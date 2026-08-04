import type { SiteSettingsSnapshot } from '@blog-studio/core';

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

interface SiteAuditEventRow {
  readonly sequence: number;
  readonly site_id: string;
  readonly event_type: 'registered' | 'settings-updated';
  readonly actor: 'owner' | 'migration';
  readonly at: string;
  readonly before_json: string | null;
  readonly after_json: string;
}

export interface SiteAuditEventRecord {
  readonly sequence: number;
  readonly siteId: string;
  readonly type: 'registered' | 'settings-updated';
  readonly actor: 'owner' | 'migration';
  readonly at: string;
  readonly before?: SiteSettingsSnapshot;
  readonly after: SiteSettingsSnapshot;
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

function settingsSnapshot(input: {
  readonly displayName: string;
  readonly canonicalUrl?: string;
}): SiteSettingsSnapshot {
  return {
    displayName: input.displayName,
    ...(input.canonicalUrl ? { canonicalUrl: input.canonicalUrl } : {}),
  };
}

function parseSettingsSnapshot(value: string): SiteSettingsSnapshot {
  const parsed: unknown = JSON.parse(value);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof (parsed as { displayName?: unknown }).displayName !== 'string'
  ) {
    throw new Error('Stored Site settings audit snapshot is invalid');
  }
  const canonicalUrl = (parsed as { canonicalUrl?: unknown }).canonicalUrl;
  if (canonicalUrl !== undefined && canonicalUrl !== null) {
    if (typeof canonicalUrl !== 'string')
      throw new Error('Stored Site settings audit snapshot is invalid');
    return {
      displayName: (parsed as { displayName: string }).displayName,
      canonicalUrl,
    };
  }
  return { displayName: (parsed as { displayName: string }).displayName };
}

function auditEventFromRow(row: SiteAuditEventRow): SiteAuditEventRecord {
  return {
    sequence: row.sequence,
    siteId: row.site_id,
    type: row.event_type,
    actor: row.actor,
    at: row.at,
    ...(row.before_json === null
      ? {}
      : { before: parseSettingsSnapshot(row.before_json) }),
    after: parseSettingsSnapshot(row.after_json),
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
    this.database.exec('BEGIN IMMEDIATE');
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
      this.database
        .prepare(
          `INSERT INTO site_audit_events (
             site_id, event_type, actor, at, before_json, after_json
           ) VALUES (?, 'registered', 'owner', ?, NULL, ?)`,
        )
        .run(
          input.id,
          input.createdAt,
          JSON.stringify(settingsSnapshot(input)),
        );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
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

  public events(siteId: string): readonly SiteAuditEventRecord[] {
    return (
      this.database
        .prepare(
          `SELECT sequence, site_id, event_type, actor, at,
                  before_json, after_json
             FROM site_audit_events
            WHERE site_id = ?
            ORDER BY sequence`,
        )
        .all(siteId) as unknown as SiteAuditEventRow[]
    ).map(auditEventFromRow);
  }

  public update(input: {
    readonly id: string;
    readonly expectedUpdatedAt: string;
    readonly displayName: string;
    readonly canonicalUrl?: string;
    readonly capabilities: Readonly<Record<string, unknown>>;
    readonly updatedAt: string;
  }): SiteRecord {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.get(input.id);
      if (!existing || existing.updatedAt !== input.expectedUpdatedAt)
        throw new SiteRevisionConflictError(input.id);
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
      this.database
        .prepare(
          `INSERT INTO site_audit_events (
             site_id, event_type, actor, at, before_json, after_json
           ) VALUES (?, 'settings-updated', 'owner', ?, ?, ?)`,
        )
        .run(
          input.id,
          input.updatedAt,
          JSON.stringify(settingsSnapshot(existing)),
          JSON.stringify(settingsSnapshot(input)),
        );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      if (error instanceof Error) {
        const field = uniqueField(error);
        if (field) throw new SiteAlreadyExistsError(field);
      }
      throw error;
    }
    return this.get(input.id)!;
  }
}
