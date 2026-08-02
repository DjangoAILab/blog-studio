---
title: Configuration schema v1
description: Generated top-level reference for the strict Blog Studio workspace configuration.
---

> Generated from `schemas/blog-studio.v1.schema.json`. Do not edit this page by hand.

## Top-level fields

| Field          | Required | Type         | Constraint             |
| -------------- | -------- | ------------ | ---------------------- |
| `version`      | yes      | constant `1` | Must equal `1`         |
| `workspace`    | yes      | object       | Unknown keys rejected. |
| `generator`    | yes      | object       | Unknown keys rejected. |
| `repository`   | yes      | object       | Unknown keys rejected. |
| `assets`       | yes      | object       | Unknown keys rejected. |
| `publish`      | yes      | object       | Unknown keys rejected. |
| `cache`        | no       | object       | Unknown keys rejected. |
| `content`      | no       | object       | Unknown keys rejected. |
| `verification` | no       | object       | Unknown keys rejected. |

All object sections are strict: an unknown key fails configuration loading. An
adapter ID uses lowercase kebab-case. Credential values are environment
references shaped as `{ env: "VARIABLE_NAME" }`, never literal secrets.

## Complete generic example

```yaml
version: 1

workspace:
  id: example-blog
  root: /workspaces/example-blog

generator:
  adapter: command
  options:
    build:
      command: npm
      args: [run, build]
    outputDirectory: public

repository:
  adapter: local-git
  options:
    remote: origin

assets:
  adapter: filesystem
  options:
    rootDirectory: public
    managedPrefix: media/posts
    protectedPrefixes: [static]
    publicBaseUrl: https://blog.example.com/

publish:
  adapter: filesystem
  options:
    directory: /srv/www/blog

cache:
  adapter: none

content:
  collections:
    posts:
      path: content/posts
      draftPath: content/drafts
      assetScope: media/posts/{documentId}

verification:
  baseUrl: https://blog.example.com
```

The machine-readable source is the repository's
[JSON Schema](https://github.com/DjangoAILab/blog-studio/blob/main/schemas/blog-studio.v1.schema.json).
