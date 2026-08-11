---
title: Adapter architecture
description: Extend generators and providers without coupling the core to a site stack.
---

All adapters implement API version 1 and expose a stable ID and display name.
Inputs and outputs are serializable domain values. Core packages may not import
Hexo, COS, Tencent, GitHub, or Traefik implementations.

## Boundaries

| Adapter        | Owns                                                   | Must not own           |
| -------------- | ------------------------------------------------------ | ---------------------- |
| Generator      | detection, content model, read/write, permalink, build | remote publishing      |
| Repository     | status, checkpoint, push                               | draft persistence      |
| Asset provider | article asset put/list/delete policy                   | generated site release |
| Publisher      | manifest diff application and exact rollback           | content editing        |
| Cache provider | invalidation request and provider task result          | public verification    |

## Conformance before integration

An adapter should be developed against reusable fake contexts before it receives
real credentials. Required properties include deterministic serialization,
idempotent retry behavior, containment, awaited failure, stable diagnostics, and
redacted logs.

Provider packages depend inward on core contracts. The Studio adapter registry
is administrator-controlled; v0.1 does not load arbitrary third-party JavaScript
inside the server process.

## Generator guidance

A generator adapter should:

1. detect without writing;
2. describe collections and output paths;
3. preserve unsupported document constructs;
4. calculate stable public URLs;
5. invoke commands as arrays with timeout and allowed environment; and
6. return a complete content-hash manifest from a production build.

## Provider guidance

Storage and publishing adapters should make ownership explicit. Immutable keys
are preferable for article media. A publisher must distinguish assets from pages,
retain the last verified manifest, and restore exact previous bytes. Cache
invalidation is followed by independent public verification.

Publishers should implement `recoverInterrupted` when they persist rollback
state before their first target mutation. On restart, it may report
`not-started` only when a missing durable state proves the target was untouched;
otherwise it must perform and report an exact rollback. Manual `rollback`
remains strict so missing or corrupt state cannot be mistaken for success.

The generated [adapter API reference](../../reference/adapter-api/) is extracted
from the current TypeScript interfaces during every docs build.
