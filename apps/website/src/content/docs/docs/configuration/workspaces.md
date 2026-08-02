---
title: Workspace configuration
description: Register trusted sites with strict v1 YAML and explicit adapter ownership.
---

Studio loads one or more administrator-owned YAML files from
`BLOG_STUDIO_CONFIG_PATHS`. Unknown keys are rejected so misspelled security or
provider options cannot silently become defaults.

## Minimal filesystem workspace

```yaml
version: 1

workspace:
  id: personal-blog
  root: /workspaces/blog

generator:
  adapter: hexo

repository:
  adapter: local-git

assets:
  adapter: filesystem
  options:
    rootDirectory: source
    managedPrefix: media/posts
    protectedPrefixes: [static]
    publicBaseUrl: https://blog.example.com/

publish:
  adapter: filesystem
  options:
    directory: /workspaces/blog/.published

cache:
  adapter: none

verification:
  baseUrl: https://blog.example.com
```

## Path containment

`workspace.root` must resolve below `BLOG_STUDIO_WORKSPACE_ROOT`. Asset and
document paths are normalized and checked again after resolving symlinks. Never
make `/`, a home directory, or a shared application directory the allowed
workspace root.

## Credentials

Configuration stores references, not secret values:

```yaml
credentials:
  secretId:
    env: TENCENT_SECRET_ID
  secretKey:
    env: TENCENT_SECRET_KEY
```

Supply those variables to the server from a secret manager. They are never
returned to the browser. For containers, the companion
`TENCENT_SECRET_ID_FILE` and `TENCENT_SECRET_KEY_FILE` variables can point at
mounted Docker secrets; the Tencent deployment override configures this
automatically. The Studio login and cookie secrets use the same file-based
pattern in the supplied Compose deployment.

## Multiple workspaces

Set `BLOG_STUDIO_CONFIG_PATHS` to a comma-separated list of configuration paths.
Every workspace ID must be stable and every root must remain under the allowed
root. v0.1 remains single-user even when several site workspaces are configured.

See the generated [configuration reference](/docs/reference/configuration/) for
the schema's top-level requirements.
