---
title: Development and release
description: Use the unstable home-server editor from the dev branch, and only tag main when that revision is ready.
---

Blog Studio has two deployment channels.

| Channel  | Git                              | Audience                                |
| -------- | -------------------------------- | --------------------------------------- |
| Unstable | `dev`                            | Internal editor on the home-server host |
| Stable   | annotated `vX.Y.Z` tag on `main` | Documented public installs              |

The home-server editor is always unstable. Look at a change there before
promoting it. Do not install `dev` images on a durable public host.

## Unstable work

1. Branch from `dev` and open the pull request **into `dev`**.
2. After merge, GitHub Actions builds `blog-studio:dev-<sha>` on the
   home-server runner and recreates only Studio.
3. Confirm the journey at `https://blog-editor.internal.wj2015.com`.
4. If it is wrong, send another pull request to `dev`. Keep the previous
   `dev-<sha>` image for a fast rollback.

`gh pr create --base dev` is the normal command. Manual redeploy:

```sh
gh workflow run unstable-deploy.yml --ref dev
```

## Stable release

Promote only after the unstable editor has been used for the intended journey.

1. Open a pull request from `dev` into `main`.
2. Merge after `quality` and `security` are green.
3. Push an annotated signed tag `vX.Y.Z` from that `main` commit.
4. The Release workflow publishes `ghcr.io/djangoailab/blog-studio` and the
   GitHub Release artifacts.
5. Durable hosts upgrade from the immutable digest in that release. See
   [Upgrade and rollback](../upgrading/).

The complete command list, runner registration, and rollback notes live in the
repository guide `docs/guides/development-and-release.md`.
