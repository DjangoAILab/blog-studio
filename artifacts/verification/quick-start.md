# Documentation-only Quick Start verification — 2026-08-02

## Scope

The repository Quick Start was executed as a first-time, provider-free
installation using only checked-in documentation and example files. The test
did not reuse the reference Hexo workspace, home-server state, Tencent
credentials, or a package-manager executable inside the runtime image.

Command:

```sh
pnpm quick-start:smoke
```

The script implements the documented sequence in a disposable directory:

1. copy `examples/config/blog-studio.yml` and `examples/workspace/`;
2. initialize and commit the trusted workspace in local Git;
3. generate file-backed login and cookie secrets;
4. validate Compose, build the production image with `--pull`, and start it;
5. follow the authenticated writing/preview journey; and
6. remove the isolated Compose project and all temporary state.

## Observed result

- the production image built from the current worktree without npm in its
  runtime layer; its local OCI manifest-list digest was
  `sha256:f45868b65bc1f292a8bfb7faaac0baf5f13b545a8597fdf87dd1e16b14dbc240`;
- the container reached `healthy` and an unauthenticated workspace request
  returned `401`;
- the workspace API reported generator `command`, native creation disabled,
  publisher `none`, and `configured: false`;
- the browser API did not expose the administrator build executable or args;
- compatibility scan detected the example marker with confidence `1` and
  returned the `posts` and `drafts` collections;
- `Welcome to Blog Studio` was discovered from canonical Markdown;
- an edited body was acknowledged as durable draft version `1` in SQLite;
- real generator output served through the preview proxy contained the edited
  body; and
- the canonical example workspace remained Git-clean.

The terminal acceptance line was:

```text
quick start passed: command workspace, auth, article discovery, durable autosave, real preview, publish disabled
```

A second run reused the exact built image and completed the runtime journey in
7.4 seconds. Both runs removed their containers and networks. This closes the
documentation-only Quick Start gate; remote publishing remains a separate
provider gate.
