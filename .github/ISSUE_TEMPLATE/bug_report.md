---
name: Bug report
about: Something is not working as expected
title: "[bug] "
labels: bug
assignees: ErnestoCorona
---

## Summary

<!-- One-sentence description of the bug. -->

## Steps to reproduce

1.
2.
3.

## Expected behavior

<!-- What did you expect to happen? -->

## Actual behavior

<!-- What actually happened? Include exact error messages if any. -->

## Environment

- `kanboard-mcp` version: <!-- output of `npm list -g @ernestocorona/kanboard-mcp` or value from package.json -->
- Node.js version: <!-- `node --version` -->
- OS: <!-- macOS 14, Ubuntu 22.04, Windows 11, etc. -->
- MCP client: <!-- Claude Code, Claude Desktop, Cursor, Cline, Zed, other -->
- Kanboard server version: <!-- visible at <your-kanboard-url>/?controller=ConfigController&action=index for admins -->
- Auth mode: <!-- personal | app -->

## Tool & arguments

<!-- Which MCP tool failed, and the arguments passed. Replace any tokens with [REDACTED]. -->

```json
{
  "tool": "create_task",
  "arguments": {
    "project_id": 1,
    "title": "..."
  }
}
```

## Logs

<!-- Relevant stderr output. The server auto-redacts tokens, so logs are safe to paste. Wrap in a collapsible block if long: -->

<details>
<summary>stderr (click to expand)</summary>

```
paste log lines here
```

</details>

## Additional context

<!-- Anything else that might help: a hypothesis, a related issue, a workaround you found. -->
