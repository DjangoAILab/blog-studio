# Site lifecycle, authoring, and local-preview design

**Status:** selected with the owner on 2026-08-07.
**Scope:** next release after v0.2; this is a design decision, not an
implementation record.

## Outcomes

The next release fixes the clipped Markdown preview and turns the existing
adapter, generator, filesystem publisher, and release capabilities into one
owner-operable Site lifecycle:

```text
discover -> configure -> validate -> register -> author/preview
         -> prepare -> apply -> commit -> release -> verify/rollback
```

Files and Git remain canonical for content. Studio-owned operational
configuration, audit history, working copies, preview processes, and release
state remain separate from article source.

## Confirmed decisions

| Area                    | Selected decision                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration authority | Owner manages non-secret Site configuration in the UI. Host administrators retain allowed roots, adapter policy, credentials, environment values, and process safety boundaries.                                                          |
| Configuration source    | One independent, atomically written YAML file per Site at `/data/sites/<site-id>.yml`; SQLite holds revision/audit data, not a competing configuration copy.                                                                              |
| Config and content      | Site configuration has its own draft, validate, activate, rollback, and audit flow. Content ChangeSets freeze the active configuration revision and become stale if it changes.                                                           |
| Local development       | A persistent, per-Site isolated sandbox runs configured dev commands. Working copies are synced automatically; hot reload is preferred and a failed sync/health check triggers a controlled restart.                                      |
| Local-site presentation | Open the real local Site in a new tab by default; the Studio preview panel remains an embedded, current-article aid.                                                                                                                      |
| Front matter            | Preserve raw YAML/AST as well as typed values. Common fields have controls, Site schemas configure theme fields, and all other fields remain available through advanced YAML editing.                                                     |
| Content order           | Offer sortable fields and direction. Default is `activityAt desc`; filesystem mtime is diagnostic-only.                                                                                                                                   |
| Site deletion           | Default action unregisters only. It preserves configuration, working copies, audit history, and release history. Irreversible Studio-data purge is a separately re-authenticated action and never removes a repository or publish target. |

## Correctness fixes

### Full Markdown preview

`PreviewPane` declares three CSS grid rows while the fallback banner is
conditional. Without that banner, the canvas is auto-placed in the second
`auto` row and receives only the iframe's intrinsic height. The canvas must be
assigned to the flexible row irrespective of banner presence, or the layout
must use a header/content wrapper with one flexible content row. Regression
coverage must test both banner states and desktop/mobile viewports.

### Time semantics and ordering

The current Hexo adapter uses `frontMatter.updated`, then filesystem `mtime`.
Checkout or migration gives unrelated posts the same `mtime`, making fallback
title order look like a broken recent list. Content summaries will expose:

- `publishedAt`: front-matter `date`;
- `contentUpdatedAt`: front-matter `updated`, falling back to `publishedAt`;
- `workingCopySavedAt`: Studio working-copy timestamp;
- `filesystemModifiedAt`: diagnostic-only; and
- `activityAt`: working-copy save, otherwise content update, otherwise publish.

The Site overview and library support `activityAt`, `publishedAt`,
`contentUpdatedAt`, `title`, `state`, `path`, plus schema-marked custom fields,
each ascending or descending. Empty values sort after present values and
`documentId` is the deterministic final tie-breaker. Search defaults to
relevance but can opt into the selected field order.

### Search

The content API already supports title/path/tag query filtering. The top-nav
search currently only navigates to Content, so it must become a focusable global
search/command surface. The library searches after a short debounce, preserves
its query/filter/sort in the URL, and searches categories plus schema-marked
custom metadata. Enter remains supported but is never required for the first
result update.

## Front matter model

Working copies need `frontMatterRaw`, a parsed YAML document/AST representation
or patch set, typed values, and body. Saving a normal form field patches only
that AST key; it must preserve unknown keys, key order, comments, scalar
spelling/quoting, and existing string-versus-array forms. Deleting a key is an
explicit mutation, never an interpretation of a blank control.

The editor contains three layers:

1. Common controls: title, dates, tags, categories, slug, cover, description,
   layout, permalink, and publication state where the adapter supports them.
2. Site-defined schema controls: field type, default, enum choices, help text,
   validation, searchability, and sortability for theme/plugin properties.
3. An advanced YAML editor for all other values, nested objects, and exact
   maintenance. It shows line/column parse errors.

Unparseable source front matter enters source-repair mode. Studio must not
serialize it through a form or overwrite it while recovering a working copy.
New documents use a Site template/defaults rather than a hard-coded
`title + date` object. Source conflicts compare raw YAML, individual fields,
and body rather than silently choosing one side.

## Site configuration and lifecycle

The host starts Studio with a policy-only configuration: allowed workspace
roots, allowed adapters, credential references, and command execution policy.
Owners create Site configuration in a data-directory YAML through the UI. A
configuration activation validates schema, real paths, adapter support,
repository access, content discovery, sandbox feasibility, dev readiness, and
publish-target safety before atomically replacing the active YAML and
dynamically reloading only that Site. A failed activation keeps the previous
runtime and configuration active.

The navigation always exposes **Add Site** and **Manage Sites**. Each Site has
these states: candidate, configuring, active, paused, invalid/recovering, and
unregistered. Pausing stops development processes and blocks release but keeps
canonical content and operational history. An invalid Site is repaired in
isolation without degrading other Sites.

Site settings are divided into Basic, Content model, Local development,
Resources, Publishing, and Advanced diagnostics. Risky changes such as
publish-directory or command changes require re-authentication and an explicit
validation run.

## Development preview

The development supervisor creates a durable, per-Site sandbox under Studio
state. It copies the configured source revision, overlays the current working
copies, runs the allowlisted command without a shell, probes `baseUrl` plus an
optional readiness path, and proxies the result through Studio. The proxy makes
container-local development URLs reachable from the owner's browser and avoids
assuming that browser `localhost` is the same machine as the Studio process.

It records stopped, starting, syncing, ready, stale, restarting, and failed
states; PID/process identity, bound URL, source/draft revision, logs, and
cleanup journal; it must never run a development command in the canonical
workspace. Sandbox sync is automatic after a working-copy change. When hot
reload does not expose the desired revision in time, Studio restarts the process
and reports why.

Daily controls live at the Site overview and content heading, not in Settings:
start/open/restart/stop/logs. The preview pane keeps Markdown and deterministic
theme-snapshot modes; the whole local Site opens in a new tab by default and is
available in the pane as a secondary current-article view. The ChangeSet review
states whether that local Site has the same working-copy/configuration revision.

## Release closure

Development commands are separate from production build commands. A remote
release only builds an applied, selected-path Git commit. For a filesystem
target, Studio validates that the directory does not overlap a repository,
Studio data, or another Site; requires explicit baseline adoption for an
existing target; uses a manifest to touch only managed files; and never deletes
protected prefixes or unknown files.

Publish uses a version/staging directory and an atomic switch where the target
filesystem allows it, otherwise a durable recovery journal. It verifies the
public `canonicalUrl`/verification base URL with a release marker, records a
rollback point, and restores only the previous published manifest on rollback.
It does not roll back canonical source or Git.

## Configuration shape

The exact schema is implementation work, but these concepts are required:

```yaml
site:
  displayName: wj2015-blog
  canonicalUrl: https://blog.wj2015.com/
development:
  command: npm
  args: [run, server]
  baseUrl: http://127.0.0.1:4000/
  readinessPath: /
  autoSync: true
build:
  command: npm
  args: [run, build]
  outputDirectory: public
publish:
  adapter: filesystem
  directory: /srv/www/blog
  protectedPrefixes: [legacy]
```

Credentials are references resolved only by host policy; literal secret values
are invalid in owner-editable Site YAML.

## Acceptance criteria

- A bannerless and a fallback Markdown preview fill the available preview
  canvas, with no clipping at desktop or mobile widths.
- Editing any normal or custom front-matter field on the reference blog leaves
  unrelated values, comments, order, and scalar/list representation intact.
- A malformed front matter file cannot be silently rewritten; it has a safe
  source-repair path.
- The reference blog's NAS HTTPS post ranks by its front-matter date, not its
  checkout mtime. Default recent order is `activityAt desc`, and every supported
  sort field/direction is stable across pages.
- The top-nav search focuses a command/search panel and returns results without
  requiring Enter; URL restoration returns to the same query/filter/sort/page.
- An owner can add a second trusted Site after the first is registered, pause,
  repair, and unregister it without losing canonical files.
- A working-copy edit appears in the isolated local Site; Studio can open it in
  a new tab, report its synchronization revision, restart it, and show bounded
  logs. No dev command runs in the canonical repository.
- Filesystem publishing refuses unsafe targets, adopts a baseline explicitly,
  preserves protected/unmanaged files, verifies the public marker, and can
  recover or roll back after interruption.
- Configuration edits are audited, atomically activated, dynamically reloaded,
  and invalidate stale Content ChangeSets without modifying article Git history.

## Implementation sequencing

1. Repair preview layout; add time fields, sort contract, and top-nav search.
2. Introduce raw-YAML working copies, schema-driven metadata editor, and
   migration/compatibility tests against the reference blog corpus.
3. Add dynamic Site configuration repository, activation/rollback, Site
   management UI, and lifecycle state model.
4. Implement sandbox development supervisor, proxy, controls, logs, and
   working-copy synchronization.
5. Close configuration/change-set version checks and filesystem release safety;
   execute disposable and real home-server acceptance before release.
