import type { AgentApprovalMode } from './agent-sessions.js';
import type { StudioDatabase } from './database.js';

export type AgentApprovalPreferenceSource =
  'session' | 'site' | 'global' | 'default';

export interface ResolvedAgentApprovalPreference {
  readonly mode: AgentApprovalMode;
  readonly source: AgentApprovalPreferenceSource;
}

export class AgentSessionSiteMismatchError extends Error {
  public constructor(
    readonly sessionId: string,
    readonly siteId: string,
  ) {
    super(`Agent Session ${sessionId} does not belong to Site ${siteId}`);
    this.name = 'AgentSessionSiteMismatchError';
  }
}

export class SqliteAgentPreferenceRepository {
  public constructor(private readonly database: StudioDatabase) {}

  public setGlobal(mode: AgentApprovalMode, updatedAt: string): void {
    this.database
      .prepare(
        `INSERT INTO agent_global_preferences (owner_id, approval_mode, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET
           approval_mode = excluded.approval_mode,
           updated_at = excluded.updated_at`,
      )
      .run(mode, updatedAt);
  }

  public global(): AgentApprovalMode | null {
    const row = this.database
      .prepare(
        'SELECT approval_mode FROM agent_global_preferences WHERE owner_id = 1',
      )
      .get() as { readonly approval_mode: AgentApprovalMode } | undefined;
    return row?.approval_mode ?? null;
  }

  public setSite(
    siteId: string,
    mode: AgentApprovalMode,
    updatedAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO agent_site_preferences (site_id, approval_mode, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(site_id) DO UPDATE SET
           approval_mode = excluded.approval_mode,
           updated_at = excluded.updated_at`,
      )
      .run(siteId, mode, updatedAt);
  }

  public clearSite(siteId: string): boolean {
    return (
      this.database
        .prepare('DELETE FROM agent_site_preferences WHERE site_id = ?')
        .run(siteId).changes === 1
    );
  }

  public site(siteId: string): AgentApprovalMode | null {
    const row = this.database
      .prepare(
        'SELECT approval_mode FROM agent_site_preferences WHERE site_id = ?',
      )
      .get(siteId) as { readonly approval_mode: AgentApprovalMode } | undefined;
    return row?.approval_mode ?? null;
  }

  public setSession(
    siteId: string,
    sessionId: string,
    mode: AgentApprovalMode,
    updatedAt: string,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE agent_sessions
            SET approval_mode = ?, updated_at = ?
          WHERE id = ? AND site_id = ?`,
      )
      .run(mode, updatedAt, sessionId, siteId);
    if (result.changes !== 1) {
      throw new AgentSessionSiteMismatchError(sessionId, siteId);
    }
  }

  public clearSession(
    siteId: string,
    sessionId: string,
    updatedAt: string,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE agent_sessions
            SET approval_mode = NULL, updated_at = ?
          WHERE id = ? AND site_id = ?`,
      )
      .run(updatedAt, sessionId, siteId);
    if (result.changes !== 1) {
      throw new AgentSessionSiteMismatchError(sessionId, siteId);
    }
  }

  public resolve(
    siteId: string,
    sessionId?: string,
  ): ResolvedAgentApprovalPreference {
    if (sessionId) {
      const session = this.database
        .prepare(
          `SELECT approval_mode
             FROM agent_sessions
            WHERE id = ? AND site_id = ?`,
        )
        .get(sessionId, siteId) as
        { readonly approval_mode: AgentApprovalMode | null } | undefined;
      if (!session) throw new AgentSessionSiteMismatchError(sessionId, siteId);
      if (session.approval_mode) {
        return { mode: session.approval_mode, source: 'session' };
      }
    }

    const site = this.database
      .prepare(
        'SELECT approval_mode FROM agent_site_preferences WHERE site_id = ?',
      )
      .get(siteId) as { readonly approval_mode: AgentApprovalMode } | undefined;
    if (site) return { mode: site.approval_mode, source: 'site' };

    const global = this.database
      .prepare(
        'SELECT approval_mode FROM agent_global_preferences WHERE owner_id = 1',
      )
      .get() as { readonly approval_mode: AgentApprovalMode } | undefined;
    if (global) return { mode: global.approval_mode, source: 'global' };

    return { mode: 'approval', source: 'default' };
  }
}
