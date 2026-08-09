# Sites and first run

Blog Studio treats a **Site** as the owner-facing root object. A Site is the
durable identity, capabilities, content library and audit history for one
trusted file-based website. The underlying workspace ID, filesystem root and
configuration path remain administrator diagnostics rather than primary
navigation.

## The three independent first-run states

Open `/api/setup/status` or the Studio login page after the container is
reachable. The public status exposes only safe state and next-action labels:

| State                 | Meaning                                                                          | Safe next action                                    |
| --------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| Credentials not ready | No owner password verifier exists                                                | Initialize it from the trusted host CLI             |
| Configuration invalid | The administrator configuration cannot be loaded safely                          | Repair the mounted configuration, then retry        |
| No Site registered    | Credentials and configuration are valid, but no Site identity has been confirmed | Log in, inspect discovery, and register a candidate |

These facets are independent. Invalid configuration keeps the recovery page,
password login and setup status reachable, but health is degraded and Site,
content, preview, ChangeSet and release APIs fail closed. The browser can never
claim first ownership.

## Initialize the owner

Run the CLI from the trusted host. Interactive initialization reads and
confirms the password without echoing it:

```sh
docker compose run --rm studio \
  node dist/server/cli.js auth init \
  --database /data/blog-studio.sqlite
```

Use `auth status` to inspect only whether credentials exist. Use `auth reset`
for forgotten-password recovery; reset rotates the credential generation and
invalidates every existing browser session. For automation, `--password-stdin`
keeps the password out of process arguments and Compose interpolation.

## Discover and register a Site

After password login, Studio inspects only workspaces already declared by the
administrator configuration and confined to the configured allowlisted root.
Each candidate previews:

- proposed display name and canonical URL;
- generator and Provider capabilities;
- published/draft content counts and resource policy;
- Git branch, revision, dirty count and capability diagnostics; and
- advanced workspace/configuration paths behind progressive disclosure.

Review the candidate and choose **注册站点**. Registration writes a new Site
identity and audit event to SQLite, then creates a versioned owner Site
configuration in Studio data. It does not rewrite Markdown, Git or a public
target. Existing v0.1 configurations need no mandatory `site` block—their
workspace becomes a discoverable candidate.

## Site settings

`站点资料` edits only the supported display name and canonical HTTP(S) URL. It
also shows the stored capability snapshot and immutable owner audit history.
Settings use optimistic revisions. If another session saves first, Studio shows
the latest stored values beside the owner's input and asks whether to load the
latest version or explicitly retry the owner's values.

A successful settings update never changes canonical content, configuration or
the public Site. The same sheet includes a versioned **站点配置** editor: validate
before activation, inspect its history, and recover an earlier version. Owner
YAML may define content fields and select one local-development profile only.
Generator, storage, repository, credentials, workspace paths, executable
commands, environment allowlists, base URLs, and publishing policy remain
administrator-controlled configuration.

### Local-development profiles

The administrator declares safe, named profiles in the mounted host
configuration. A profile is a complete command policy; Studio persists only the
chosen profile ID in the owner configuration. This keeps an owner YAML edit
from becoming command execution or an environment/URL override.

```yaml
# Mounted host configuration: /config/blog-studio.yml
developmentProfiles:
  hexo-preview:
    label: Hexo 本地预览
    command: /workspaces/blog/node_modules/.bin/hexo
    args: [server, --ip, 0.0.0.0, --port, '4000']
    baseUrl: http://127.0.0.1:4000/
    previewUrl: https://blog-editor-preview.internal.example.com/
    readinessPath: /
    startupTimeoutMs: 30000
    environmentAllowlist: []
```

In **站点资料 → 站点配置**, choose `Hexo 本地预览`, then validate and activate.
The resulting owner YAML intentionally contains only:

```yaml
development:
  profile: hexo-preview
```

The overview’s **配置本地调试** button opens this exact control when profiles
are available but none is active. Start, restart, and open the isolated preview
from the overview after activation. `baseUrl` is an internal readiness target;
`previewUrl` is the browser-facing origin selected by the deployment operator.
Studio opens that origin directly and does not proxy generated site responses.
The public URL remains the Site’s canonical URL.

The host must route `previewUrl` to the configured container port. For example,
the supplied optional Traefik preview override routes
`blog-editor-preview.internal.example.com` directly to port 4000. Preview
access is controlled by that host ingress: anyone allowed to reach the preview
origin can read its content, independently of a Studio browser session.

Use the lifecycle controls when taking a Site out of service. **暂停站点** stops
its local development process and blocks content, ChangeSet, build, and release
operations without deleting any canonical files. **解除注册** retains its Studio
history and configuration while enforcing the same block; **恢复站点** returns it
to service. It never removes a repository or a publish target.

## Recovery boundaries

- If configuration is invalid, repair the mounted YAML or its referenced
  environment/secret values on the trusted host. Studio never edits policy
  configuration over HTTP.
- If discovery is empty, confirm the configuration path, allowlisted workspace
  root, mounted Site checkout and generator dependencies, then retry.
- If registration reports a duplicate identity, choose a unique display name;
  do not create a second record for the same workspace.
- Back up SQLite before upgrade or migration. Site identity, audit history,
  credentials and working copies live there; Markdown and Git remain canonical.

Continue with [Prepare, commit and release](prepare-commit-release.md) after the
Site and content library are healthy.
