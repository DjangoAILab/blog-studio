# Hexo compatibility evidence — 2026-08-02

This scan exercised the built Hexo adapter against the private reference blog
without copying article bodies, front matter, or filenames into this repository.

## Result

- Hexo detection: true, confidence 1, no detection diagnostics.
- Collections: posts and drafts.
- Documents discovered: 93 posts and 5 drafts.
- Existing generated output: 92 of 92 resolvable posts matched the adapter's
  computed public URL.
- One source document has a pre-existing malformed date. The adapter now rejects
  it as a compatibility error instead of inventing an incorrect URL.
- Ten sampled URLs used the configured `https://blog.wj2015.com` origin.
- Aggregate SHA-256 before and after discovery was identical:
  `8a8c666f768b17cf45ed7bf2674ff0ca0c8fb3b27571396529401d46311f34e7`.

## Reproduction policy

Run the built adapter's `detect`, `inspect`, `listDocuments`, and
`resolvePublicUrl` methods. Before and after the run, recursively hash
`_config.yml`, `package.json`, `source/_posts`, and `source/_drafts`; sort the
per-file hashes and hash that stream again. The two aggregate hashes must match.

The compatibility command intentionally emits only counts and aggregate hashes.
It must not print or persist article content in this public repository.
