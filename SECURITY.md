# Security policy

## Supported versions

Until v1.0, only the latest tagged minor release receives security fixes. The
`dev` branch is the unstable internal editor. `main` is the integration branch
for the next tagged release and is not itself a supported install channel.

| Version     | Supported |
| ----------- | --------- |
| Latest v0.x | Yes       |
| Older v0.x  | No        |

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** private-reporting flow for
this repository. Do not open a public issue, discussion, or pull request with
exploit details or credentials.

Include the affected version or commit, deployment shape, reproduction steps,
impact, and any suggested mitigation. Remove real site content, tokens, cookie
values, cloud account identifiers that are not already public, and personal
data from logs. The maintainers will acknowledge a complete report within five
business days and coordinate disclosure after a fix is available.

## Deployment responsibility

Blog Studio can write source files and publish public objects. Operators must
restrict the workspace root, use least-privilege provider credentials, keep the
Studio behind HTTPS, back up data before upgrades, and test against an isolated
target before adopting production. The public site must not depend on Studio
availability.
