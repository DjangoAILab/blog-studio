# AI Content Workspace Positioning Design

## Decision

Position Blog Studio as a **self-hosted AI content workspace** whose defining
capability is a Site Agent that can understand and safely modify an existing
Markdown website. Preserve the existing product boundary: AI prepares local,
reviewable changes; a human reviews and initiates publishing.

## Message hierarchy

1. **Category:** self-hosted AI content workspace.
2. **Core capability:** a Site-aware Agent with durable Sessions, explicit
   context, bounded file and local Git tools, and optional per-change approval.
3. **Differentiator:** keep Markdown, Git, the real generator, theme, URLs, and
   hosting instead of migrating into a hosted AI CMS.
4. **Trust promise:** AI changes are inspectable and recoverable; publishing
   remains a separate human-reviewed action.

## Public experience

The landing page should make the Site Agent visible in the hero and show an
authentic task flowing from request to bounded changes and review. Supporting
sections explain the four-part journey: ask, inspect, preview, publish. Adapter
architecture remains present but moves behind the user value rather than
defining the first impression.

Repository and documentation entry points use the same category, capability,
and trust language. Historical release notes remain unchanged because they
describe the positioning of earlier releases at their publication time.

## Guardrails

- Do not call the product an autonomous publisher or AI article generator.
- Do not imply that the Agent can push, publish, or bypass Site boundaries.
- Keep self-hosting and compatibility with existing infrastructure prominent.
- Keep Chinese and English claims semantically aligned.

## Success criteria

- A first-time visitor identifies Blog Studio as an AI tool from the page title,
  hero, product preview, and primary proof points.
- The README, package metadata, documentation home, and in-product introduction
  repeat the same positioning.
- Existing website unit, build, link, locale, accessibility, and responsive
  tests pass after copy assertions are updated.
