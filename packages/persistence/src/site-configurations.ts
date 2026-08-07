import type { StudioDatabase } from './database.js';

export interface SiteConfigurationRevision {
  readonly siteId: string;
  readonly revision: number;
  readonly yaml: string;
  readonly source: 'legacy' | 'owner' | 'revert';
  readonly createdAt: string;
}

export interface ActiveSiteConfiguration extends SiteConfigurationRevision {
  readonly updatedAt: string;
}

interface RevisionRow {
  readonly site_id: string;
  readonly revision: number;
  readonly yaml: string;
  readonly source: SiteConfigurationRevision['source'];
  readonly created_at: string;
}

interface ActiveRow extends RevisionRow {
  readonly updated_at: string;
}

function revisionFromRow(row: RevisionRow): SiteConfigurationRevision {
  return {
    siteId: row.site_id,
    revision: row.revision,
    yaml: row.yaml,
    source: row.source,
    createdAt: row.created_at,
  };
}

export class SiteConfigurationRevisionConflictError extends Error {
  public constructor(readonly siteId: string) {
    super(`Site configuration ${siteId} changed since it was read`);
  }
}

export class SqliteSiteConfigurationRepository {
  public constructor(private readonly database: StudioDatabase) {}

  public active(siteId: string): ActiveSiteConfiguration | null {
    const row = this.database
      .prepare(
        `SELECT revision.site_id, revision.revision, revision.yaml,
                revision.source, revision.created_at, active.updated_at
           FROM site_configuration_active active
           JOIN site_configuration_revisions revision
             ON revision.site_id = active.site_id
            AND revision.revision = active.revision
          WHERE active.site_id = ?`,
      )
      .get(siteId) as ActiveRow | undefined;
    return row ? { ...revisionFromRow(row), updatedAt: row.updated_at } : null;
  }

  public revision(
    siteId: string,
    revision: number,
  ): SiteConfigurationRevision | null {
    const row = this.database
      .prepare(
        `SELECT site_id, revision, yaml, source, created_at
           FROM site_configuration_revisions
          WHERE site_id = ? AND revision = ?`,
      )
      .get(siteId, revision) as RevisionRow | undefined;
    return row ? revisionFromRow(row) : null;
  }

  public list(siteId: string): readonly SiteConfigurationRevision[] {
    return (
      this.database
        .prepare(
          `SELECT site_id, revision, yaml, source, created_at
             FROM site_configuration_revisions
            WHERE site_id = ?
            ORDER BY revision DESC`,
        )
        .all(siteId) as unknown as RevisionRow[]
    ).map(revisionFromRow);
  }

  public activate(input: {
    readonly siteId: string;
    readonly expectedRevision: number;
    readonly yaml: string;
    readonly source: SiteConfigurationRevision['source'];
    readonly at: string;
  }): ActiveSiteConfiguration {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.active(input.siteId);
      const actualRevision = current?.revision ?? 0;
      if (actualRevision !== input.expectedRevision)
        throw new SiteConfigurationRevisionConflictError(input.siteId);
      const nextRevision = actualRevision + 1;
      this.database
        .prepare(
          `INSERT INTO site_configuration_revisions (
             site_id, revision, yaml, source, created_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(input.siteId, nextRevision, input.yaml, input.source, input.at);
      this.database
        .prepare(
          `INSERT INTO site_configuration_active (site_id, revision, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(site_id) DO UPDATE SET
             revision = excluded.revision,
             updated_at = excluded.updated_at`,
        )
        .run(input.siteId, nextRevision, input.at);
      this.database.exec('COMMIT');
      return {
        siteId: input.siteId,
        revision: nextRevision,
        yaml: input.yaml,
        source: input.source,
        createdAt: input.at,
        updatedAt: input.at,
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
