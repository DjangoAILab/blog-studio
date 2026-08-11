# Site Agent CLIProxy production POC

Date: 2026-08-11

This evidence intentionally records no endpoint hostname, token, response text,
or credential-bearing artifact. The approved local CLIProxy configuration was
read without echoing either secret value.

## Pi language-model POC

| Field            | Result                                                 |
| ---------------- | ------------------------------------------------------ |
| Timestamp        | `2026-08-11T04:07:04.846Z`                             |
| Endpoint class   | HTTPS, Anthropic Messages-compatible                   |
| Pi SDK           | `@earendil-works/pi-coding-agent` `0.84.1`             |
| Model            | `glm-5.2`                                              |
| Request shape    | non-interactive, ephemeral, no tools, no context files |
| Stream result    | completed; expected nonce observed                     |
| Workspace writes | none                                                   |

The temporary operator directory was mode `0700`. It contained mode-`0600`
`auth.json`, `models.json`, and `settings.json`. The redacted configuration
shape was:

```json
{
  "auth.json": {
    "cliproxy": { "type": "api_key", "key": "[REDACTED]" }
  },
  "models.json": {
    "providers": {
      "cliproxy": {
        "baseUrl": "[REDACTED HTTPS ENDPOINT]",
        "api": "anthropic-messages",
        "models": [{ "id": "glm-5.2", "input": ["text"] }]
      }
    }
  },
  "settings.json": {
    "defaultProvider": "cliproxy",
    "defaultModel": "glm-5.2",
    "defaultThinkingLevel": "off"
  }
}
```

## Vision-model POC

| Field            | Result                                       |
| ---------------- | -------------------------------------------- |
| Timestamp        | `2026-08-11T04:07:21.285Z`                   |
| Endpoint class   | HTTPS, OpenAI Chat Completions-compatible    |
| Model            | `minimax-m3`                                 |
| Input            | disposable one-pixel local PNG as a data URL |
| HTTP status      | `200`                                        |
| Response shape   | non-empty chat completion                    |
| Workspace writes | none                                         |

The credential-bearing temporary operator files and disposable image were
removed immediately after each request. A follow-up search found no temporary
POC directory under the workspace.
