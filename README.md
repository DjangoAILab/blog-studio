# Blog Studio

Blog Studio is a self-hosted publishing workbench for file-based websites.
It keeps Markdown, Git, the existing static-site generator, and the existing
hosting stack while making the complete writing-to-production journey usable
from one browser tab.

> Status: product design and v0.1 implementation are in progress.

## Product promise

- Write without waiting for Git or deployments.
- Paste media into an article-scoped asset library.
- Preview with the real site generator and theme.
- Publish through a visible, verifiable release pipeline.
- Preserve existing files, URLs, and infrastructure.

The first production integration targets Hexo, Tencent COS, Tencent CDN, and
GitHub. The core contracts are generator-, storage-, repository-, and
deployment-independent.

## Documentation

- [Product definition](docs/product/product-definition.md)
- [Architecture](docs/architecture/overview.md)
- [Roadmap](docs/roadmap.md)
- [v0.1 release checklist](docs/checklists/v0.1.md)
- [v0.1 implementation plan](docs/plans/2026-08-02-blog-studio-v0.1.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
