# Internal production rollout evidence

Date: 2026-08-11

This record is intentionally redacted. It contains no internal hostname, API
token, owner password, cookie, secret value, or credential-bearing file
contents. The rollout did not invoke a content Provider or publish blog
content.

## Reviewed release inputs

| Item                    | Result                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| Internationalization PR | [#42](https://github.com/DjangoAILab/blog-studio/pull/42), merged as `08eca9bf3fca94f6d43571a4c84f041f4db7ab9f` |
| SSE hard-gate fix PR    | [#43](https://github.com/DjangoAILab/blog-studio/pull/43), merged as `e1f8cfcab55337e0afea500d6fb5dc889872c87b` |
| PR checks               | `quality` and `security` passed for both PRs                                                                    |
| Main checks             | CI passed for both merged revisions; Documentation passed for the internationalization revision                 |
| Production image        | `blog-studio:home-i18n-e1f8cfc`                                                                                 |
| Production image ID     | `sha256:002a724723996b2a183f30ef1c3507a45495b786d65f94ec189e984a4e1c32ef`                                       |
| OCI revision            | `e1f8cfcab55337e0afea500d6fb5dc889872c87b`                                                                      |

The accepted image was built natively on the production host from a streamed
`git archive` of the reviewed `origin/main`. The temporary build source was
removed after the image ID and OCI revision label were verified.

## Public bilingual release

The repository About homepage is
`https://djangoailab.github.io/blog-studio/`. The following deployed GitHub
Pages routes returned HTTPS `200`:

- `/blog-studio/`
- `/blog-studio/en/`
- `/blog-studio/en/docs/`
- `/blog-studio/zh-cn/`
- `/blog-studio/zh-cn/docs/`
- both English and Chinese self-hosting guide routes

The root page statically selects English. Browser acceptance also exercised the
reciprocal language links, localized document language, “Self-host Blog
Studio”, “Understand the journey”, their Chinese equivalents, and
representative nested documentation links under the project base path.

## Backup and rollback boundary

The pre-upgrade server-only backup is:

| Field                       | Value                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| Path                        | `runtime/backups/blog-studio-backup-20260811T044924Z.tar.gz`       |
| Size                        | `619097000` bytes                                                  |
| SHA-256                     | `9d178aafd12fb68ce03f79219e1c225f24f93f94fb705635b5ab9dcf45686700` |
| Archive/checksum modes      | `0600` / `0600`                                                    |
| Final checksum verification | passed                                                             |

The previous rollback target remains present as
`blog-studio:home-v032-00cd73f`, image ID
`sha256:9ec07a4795e14075b495024dad23c9447c2c68d7a0bed1eea3634b5449a6e2b5`.
Pre-switch environment snapshots remain mode `0600`.

An acceptance hard gate first exposed an incorrect assumption about which
isolated CLIProxy network the Studio should use. No router, routing-policy, or
persistent host-route change was retained. Runtime credential copies from that
attempt were removed, the pre-upgrade database and image were restored, and
health plus all canonical hashes were reverified before continuing with the
operator-approved endpoint. This was a successful rollback rehearsal, not a
new network bridge between the isolated services.

## Agent runtime and model proof

The production Agent runtime directory is mode `0700`. Its `auth.json`,
`models.json`, and `settings.json`, the dedicated read-only vision secret, the
active `.env`, and both retained pre-switch `.env` snapshots are mode `0600`.
No token was printed, committed, or added to an image layer.

The approved server-side CLIProxy configuration was read without echoing its
token. Direct, no-workspace-write probes passed before installation:

| Path                                      | Model        | Result                                                             |
| ----------------------------------------- | ------------ | ------------------------------------------------------------------ |
| Anthropic Messages-compatible             | `glm-5.2`    | HTTP `200`; expected nonce observed                                |
| OpenAI Chat Completions-compatible vision | `minimax-m3` | HTTP `200`; non-empty interpretation of an in-memory one-pixel PNG |

Authenticated production acceptance then proved the same configuration through
Blog Studio:

- two Agent Sessions persisted;
- per-session approval mode persisted, and the YOLO control and warning were
  visible without enabling a content release;
- `glm-5.2` returned the exact nonce `PROD-GLM-52-FINAL-20260811`;
- a 68-byte PNG attachment reached status `ready` with
  `vision_model=minimax-m3`, after which the language-model turn completed;
- the final container had zero automatic restarts and its logs contained zero
  `ERR_STREAM_WRITE_AFTER_END` occurrences.

The first production vision attempt uncovered that the SSE route closed on the
request stream while asynchronous vision preprocessing was still running. The
Studio process then attempted a late write and failed with
`ERR_STREAM_WRITE_AFTER_END`. PR #43 moved lifecycle handling to the response
stream, guarded late writes, added delayed-stream cancellation regression
coverage, and passed the 96-test Studio suite plus the full CI-equivalent check
before the final image was built. The interrupted attachment remains only as a
durable diagnostic record; the successful final attachment is the acceptance
result.

## HTTPS, editing, preview, and recovery acceptance

- The internal HTTPS root returned `200`; an unauthenticated `/api/sites`
  request returned `401`.
- Owner login loaded the existing Site inventory and 98 content entries.
- A published article was changed only in the SQLite working-copy layer,
  autosaved, rendered in full preview, and frozen into ChangeSet review. The
  review explicitly reported that the frozen record had not been written to
  files.
- The test working copy was discarded. Its temporary marker has zero rows in
  the `drafts` table; the un-applied frozen ChangeSet remains as the durable
  audit record. No apply, Git commit, Provider invocation, or release was
  performed.
- The direct-preview Compose path reached `ready`; its HTTPS route returned
  `200` with the expected blog title. Preview was stopped after verification,
  leaving zero preview generator processes.
- Studio alone was cold-stopped and force-recreated with the base, Traefik, and
  direct-preview Compose files. It returned healthy on the same exact image,
  with a new container ID
  `1cc3ff978219feba7d3f26c36a0a78e7c859d00968198f37aceb557b3a14640b`
  and restart count `0`.
- After the cold recreation, owner authentication, both Agent Sessions,
  approval mode, the `glm-5.2` nonce, and the successful `minimax-m3`
  attachment/result all reloaded from durable storage.

## Final immutable-boundary comparison

| Boundary                              | Before                                                             | Final | Result    |
| ------------------------------------- | ------------------------------------------------------------------ | ----- | --------- |
| Canonical blog revision               | `da94f63a35e39e7061de2e92b0821a5e8dbda777`                         | same  | unchanged |
| Canonical Git status count            | `0`                                                                | `0`   | clean     |
| Public aggregate SHA-256              | `1a0d4d7b097afbda5b133f018e909c1f171c43f40e5d2e73f8d2ef72c6c80cb1` | same  | unchanged |
| Representative `reading.jpeg` SHA-256 | `22bd07ecf69d2e63d8634b6f9e31e069763ec3b700140bea9982a2a242e49fbd` | same  | unchanged |
| Wrong-network persistent route count  | `0`                                                                | `0`   | unchanged |

Only `studio` was rebuilt/recreated. Existing Traefik and direct-preview
Compose overlays were reused. The final service is healthy on the reviewed
image, the old image and checksum-verified backup remain available for
rollback, and the canonical blog repository and generated public output are
byte-for-byte unchanged at the recorded boundaries.

## Safety result

No canonical Markdown file, Git revision, public output, router rule, content
Provider, remote publication target, or object-storage/CDN output was changed.
Future content application, commit, Provider invocation, and release continue
to require separate contemporaneous owner action.
