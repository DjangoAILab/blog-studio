# Development and release

Blog Studio has two deployment channels. They are not interchangeable.

| Channel  | Git                              | What it is                                 | Who can see it                                     |
| -------- | -------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| Unstable | `dev`                            | Internal preview on the home-server editor | The operator, for looking at work before a release |
| Stable   | annotated `vX.Y.Z` tag on `main` | Documented public release                  | Anyone following a tagged install                  |

The home-server host (`https://blog-editor.internal.wj2015.com`) is always the
unstable channel. Do not treat it as production, and do not deploy a home-server
image from `main` or a release tag unless you are deliberately promoting that
exact revision through the tagged release path first.

## Daily development

1. Branch from the latest `dev`.
2. Change one coherent thing. Add tests with the behavior.
3. Run the local gates that the change can actually break:

   ```sh
   CI=true pnpm --filter @blog-studio/studio test
   CI=true pnpm --filter @blog-studio/studio e2e
   ```

   Wider `pnpm check` is required before a pull request is merged.

4. Open a pull request **into `dev`**, not `main`.
5. After merge, GitHub Actions builds `blog-studio:dev` and
   `blog-studio:dev-<sha>` on the home-server runner and recreates only the
   Studio container. Watch
   [Unstable deploy](https://github.com/DjangoAILab/blog-studio/actions/workflows/unstable-deploy.yml).
6. Check the change at `https://blog-editor.internal.wj2015.com`. If it is
   wrong, fix it with another pull request to `dev`. The previous
   `blog-studio:dev-<sha>` image stays on the host for a fast image-tag
   rollback.

Unreleased product work must not target `main`.

## Promote a stable release

Promote only after the unstable editor has been used for the intended journey
and the operator is willing to keep that revision.

1. Open a pull request from `dev` into `main`. Summarize what was proven on the
   home-server editor and what remains unproven.
2. Merge to `main` only after `quality` and `security` are green.
3. Create an annotated, signed tag on that `main` commit:

   ```sh
   git checkout main
   git pull --ff-only
   git tag -s "vX.Y.Z" -m "Blog Studio vX.Y.Z"
   git push origin "vX.Y.Z"
   ```

4. The [Release](../../.github/workflows/release.yml) workflow verifies the
   signed tag, publishes `ghcr.io/djangoailab/blog-studio`, writes release
   artifacts, and opens the GitHub Release.
5. Production and other durable installs follow
   [Upgrade and rollback](upgrading.md) with the immutable digest from that
   release. They do not track `dev`.

Lightweight tags and tags that do not point at `main` are rejected.

## Operator commands

Create or update `dev` from a machine with `gh`:

```sh
gh api -X POST repos/DjangoAILab/blog-studio/git/refs \
  -f ref=refs/heads/dev \
  -f sha="$(gh api repos/DjangoAILab/blog-studio/git/ref/heads/main --jq .object.sha)"
```

Open and merge an unreleased change:

```sh
gh pr create --base dev --head "$USER/topic" --title "…" --body "…"
gh pr merge --squash --delete-branch
```

Promote the current unstable line when it is ready:

```sh
gh pr create --base main --head dev --title "Promote unstable editor to main" --body "…"
```

Manual unstable redeploy of the current `dev` tip:

```sh
gh workflow run unstable-deploy.yml --ref dev
```

## Home-server runner

Unstable deploy runs on a self-hosted runner labelled `home-server`. Register it
once on the host that already owns `/home/wang/services/blog-studio`:

```sh
cd /home/wang/actions-runners/blog-studio
./config.sh --url https://github.com/DjangoAILab/blog-studio \
  --token "$(gh api -X POST repos/DjangoAILab/blog-studio/actions/runners/registration-token --jq .token)" \
  --name blog-studio-home-server \
  --labels home-server,unstable \
  --work _work \
  --unattended
sudo ./svc.sh install
sudo ./svc.sh start
```

The runner builds the image from the Actions checkout and recreates Studio with
the host `.env` plus the Traefik Compose files. It does not write site content,
provider secrets, or SQLite backups.

## Rollback

- **Unstable:** set `BLOG_STUDIO_IMAGE=blog-studio:dev-<previous-sha>` in the
  host `.env` and recreate Studio with the same Compose file set used by
  `scripts/deploy-unstable.sh`.
- **Stable:** restore the previous release digest from `container-digest.txt`
  as described in [Upgrade and rollback](upgrading.md).
