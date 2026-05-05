<div align="center">

# 📋 Kanboard MCP

### Kanboard, accessible from any AI editor.

A [Model Context Protocol](https://modelcontextprotocol.io/) server that brings your [Kanboard](https://kanboard.org/) board into Claude Code, Claude Desktop, Cursor, Cline, Zed, and beyond.

**25 typed tools · JSON-RPC batching · Dual authentication · TypeScript strict**

[![npm version](https://img.shields.io/npm/v/@ernestocorona/kanboard-mcp.svg?color=cb3837&logo=npm)](https://www.npmjs.com/package/@ernestocorona/kanboard-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js >=22](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-837%20passing-brightgreen.svg)](#development)
[![TypeScript Strict](https://img.shields.io/badge/typescript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-7c3aed)](https://modelcontextprotocol.io/)

[![Originally developed at aisys-media GmbH](https://img.shields.io/badge/originally%20developed%20at-aisys--media%20GmbH-9333ea?style=flat-square)](https://www.aisys-media.de/)

</div>

---

## Why this MCP server

- **25 typed tools** across 8 groups — projects, tasks, columns, swimlanes, comments, subtasks, attachments, lookups
- **JSON-RPC 2.0 batching** — create up to 100 tasks in one HTTP round-trip; turn an email or document into a sprint backlog in seconds
- **Dual authentication** — personal token (acts as you, with your Kanboard identity) or app token (service identity for CI and bots)
- **`.kanboard.yaml` walk-up resolver** — drop one file at your repo root, every tool auto-resolves the project context
- **Zero runtime HTTP dependencies** — native Node 22 `fetch`, 4 production deps total
- **Pino structured logging** with automatic secret redaction — token values never reach stdout, stderr, or any log line
- **TypeScript strict mode**, 837 unit tests across 50 test files, integration suite gated against accidental writes to non-test projects
- **Automatic retries** for idempotent reads on transient HTTP failures (429/502/503/504); mutations are never retried

## 60-second quick start

### 1. Install

```bash
npm install -g @ernestocorona/kanboard-mcp
```

### 2. Get a Kanboard API token

In Kanboard: **Profile → API → Generate token** (personal mode), or **Settings → API → Application token** (app mode for service accounts).

### 3. Register with your MCP client

Add to your client's config (`.mcp.json`, `claude_desktop_config.json`, etc.):

```json
{
  "mcpServers": {
    "kanboard": {
      "command": "kanboard-mcp",
      "env": {
        "KANBOARD_URL": "https://your-kanboard.example.com",
        "KANBOARD_USERNAME": "your-kanboard-login",
        "KANBOARD_API_TOKEN": "your-personal-token"
      }
    }
  }
}
```

### 4. Verify

```bash
KANBOARD_URL=https://your-kanboard.example.com \
KANBOARD_USERNAME=your-login \
KANBOARD_API_TOKEN=your-token \
npx @ernestocorona/kanboard-mcp selftest
```

Expected output (exit 0 = ready):

```
[ok] kanboard server version: 1.x.x
[ok] authenticated as: your-login (id=3)
[ok] visible projects: 7
[ok] selftest passed (3 checks)
```

That's it. Restart your MCP client and the 25 tools are available.

## Compatible MCP clients

This server speaks the standard MCP **stdio transport**, so any MCP-compatible client works. Verified configurations:

### Claude Code (per-project `.mcp.json`)

```json
{
  "mcpServers": {
    "kanboard": {
      "command": "kanboard-mcp",
      "env": {
        "KANBOARD_URL": "https://your-kanboard.example.com",
        "KANBOARD_USERNAME": "your-login",
        "KANBOARD_API_TOKEN": "your-token"
      }
    }
  }
}
```

### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS)

Same JSON shape as above, under the same `mcpServers` key.

### Cursor / Cline / Zed / VS Code + Continue

All use the same MCP config schema (`mcpServers` → `command` + `env`). Point `command` to `kanboard-mcp` (after global install) or to the absolute path of the built file:

```json
{
  "mcpServers": {
    "kanboard": {
      "command": "node",
      "args": ["/absolute/path/to/kanboard-mcp/dist/index.js"],
      "env": {
        "KANBOARD_URL": "https://your-kanboard.example.com",
        "KANBOARD_USERNAME": "your-login",
        "KANBOARD_API_TOKEN": "your-token"
      }
    }
  }
}
```

### App mode (service identity — for CI, bots, shared agents)

```json
{
  "env": {
    "KANBOARD_URL": "https://your-kanboard.example.com",
    "KANBOARD_AUTH_MODE": "app",
    "KANBOARD_API_TOKEN": "your-application-token"
  }
}
```

In app mode, `KANBOARD_USERNAME` is not required and is ignored — the server uses Kanboard's protocol-level `jsonrpc` user. Comments and tasks created via app mode are authored by the `jsonrpc` system user.

## Project context with `.kanboard.yaml`

Drop a `.kanboard.yaml` at your repo root and every tool auto-resolves the project. The server walks up from `cwd` (stops at `$HOME` or git root):

```yaml
# Use exactly one — they are mutually exclusive
project_id: 12
# project_identifier: "MYPROJ"

# Optional defaults, override per call if needed
default_column_id: 2
default_swimlane_id: 1
default_owner_id: 5
default_category_id: 3
```

When present, tools that need a `project_id` resolve it from this file. You can still override per call by passing `project_id` explicitly.

## Tool catalog

25 tools across 8 groups:

| Group | Tools |
|-------|-------|
| **Projects (5)** | `list_projects`, `get_project`, `create_project`, `update_project`, `add_project_user` |
| **Columns (3)** | `create_column`, `update_column`, `move_column` |
| **Tasks — CRUD (5)** | `list_tasks`, `get_task`, `create_task`, `update_task`, `move_task_position` |
| **Tasks — Personal (2)** | `list_my_tasks`, `list_overdue_tasks` |
| **Tasks — Batch (1)** | `create_tasks_batch` — up to 100 tasks per HTTP round-trip |
| **Comments & Subtasks (4)** | `add_comment`, `create_subtask`, `update_subtask`, `list_subtasks` |
| **Attachments (1)** | `attach_file_to_task` — file path or base64, 5 MB cap |
| **Lookups (4)** | `list_columns`, `list_categories`, `list_project_users`, `list_swimlanes` |

Each tool ships with a strict Zod schema for inputs and outputs. Inputs are validated before any HTTP request; outputs are parsed and reshaped into a stable type-safe contract regardless of Kanboard's per-version response shape.

## Configuration

### Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KANBOARD_URL` | Yes | — | Base URL of your Kanboard instance, e.g. `https://kanboard.example.com` |
| `KANBOARD_API_TOKEN` | Yes | — | API token (personal or application, depending on auth mode) |
| `KANBOARD_AUTH_MODE` | No | `personal` | `personal` (acts as a Kanboard user) or `app` (service identity) |
| `KANBOARD_USERNAME` | personal mode only | — | Your Kanboard login username |
| `KANBOARD_TIMEOUT_MS` | No | `15000` | Per-request HTTP timeout in milliseconds |
| `LOG_LEVEL` | No | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

Required variables are validated at startup. Missing or invalid values cause an immediate non-zero exit before any tool is registered or any network call is made.

### `.kanboard.yaml` schema

```yaml
project_id: 12                    # numeric project ID
# OR
project_identifier: "MYPROJ"      # string identifier (alphanumeric, dash, underscore)

# Optional defaults
default_column_id: 2
default_swimlane_id: 1
default_owner_id: 5
default_category_id: 3
```

`project_id` and `project_identifier` are mutually exclusive — exactly one must be set. The file is cached for the process lifetime; restart the server to pick up changes.

## Security

Defaults are designed to fail safe:

- **Token storage**: keep `KANBOARD_API_TOKEN` in `.env` (gitignored) or in your MCP client's `env` block. Never paste a token into chat or commit one to a repository.
- **Automatic redaction**: the Pino logger redacts `apiToken`, `req.headers.authorization`, `*.token`, `*.secret`, and `credentials.apiToken` from every log line at every log level. Token values never appear verbatim in any output.
- **Stdout reserved for MCP**: all logging goes to stderr exclusively. Stdout is the MCP protocol channel — no leaks possible there.
- **No destructive tools (yet)**: `delete_*` and `remove_*` operations are intentionally absent from v0.2 — additive and in-place updates only. Destructive tools land in v0.3 behind an explicit `confirmation` flag.
- **Integration test gating**: integration tests refuse to run unless `RUN_INTEGRATION=1` and `KANBOARD_TEST_PROJECT_ID` are set, AND the target project name contains `"sandbox"` or `"test"`. The suite aborts before any write request if these conditions aren't met.
- **Auth errors fail loud**: if `getMe()` fails at startup (wrong personal token), the server exits — it never falls back silently to a default identity.
- **Token rotation**: rotate your Kanboard API token regularly. The server picks up the new token on next start; no in-memory cache to invalidate.

For vulnerability disclosure, see [SECURITY.md](./SECURITY.md).

## Development

```bash
git clone https://github.com/ErnestoCorona/kanboard-mcp.git
cd kanboard-mcp
npm install

npm run typecheck       # tsc --noEmit (TypeScript strict mode)
npm run lint            # ESLint flat config
npm run lint:fix        # ESLint with auto-fix
npm run test            # 837 unit tests, no network (default for `npm test`)
npm run test:int        # integration tests (requires .env + RUN_INTEGRATION=1)
npm run build           # tsup ESM bundle → dist/
npm run dev             # tsup watch mode
npm run selftest        # smoke test against live Kanboard
```

### Integration tests

Set up a `.env` (copy from `.env.example`) pointing to a Kanboard project whose name contains `sandbox` or `test`:

```env
RUN_INTEGRATION=1
KANBOARD_URL=https://your-kanboard.example.com
KANBOARD_USERNAME=your-login
KANBOARD_API_TOKEN=your-token
KANBOARD_TEST_PROJECT_ID=42
```

All test entities are prefixed `[TEST-{ISO-timestamp}]` and tracked for manual or scripted cleanup. The suite never deletes; cleanup is the user's responsibility (deferred to v0.3 destructive tools).

### Pre-commit

The repo uses [husky](https://typicode.github.io/husky/) + [gitleaks](https://github.com/gitleaks/gitleaks) to block commits containing secrets. Run `npm install` once after cloning to install hooks.

## Roadmap

- **v0.2.6** (next): quality cycle — bug fixes from the v0.2 backlog, including a non-admin-friendly `list_users` (uses `getMembers` instead of `getAllUsers`) and a small breaking change to align field names with the spec
- **v0.3**: destructive tools (`delete_task`, `delete_project`, `delete_subtask`, `delete_comment`, `delete_task_file`, `remove_project_user`) behind an explicit `confirmation` flag
- **v0.4**: HTTP/SSE transport for team deployments; multi-tenant per-user authentication; container image
- **v0.5**: webhooks support; IMAP inbox watcher (email-to-task ingestion)

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR. All contributors are expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE) © Ernesto Corona

## Acknowledgments

This project was originally developed at [**aisys-media GmbH**](https://www.aisys-media.de/) (Würzburg, Germany) and is released as open source with their permission. Thanks to the team for the green light to share this work with the wider community.

## Author

**Ernesto Corona** &mdash; senior architect, TypeScript / Node / MCP servers.
[GitHub](https://github.com/ErnestoCorona) · [npm](https://www.npmjs.com/~ernestocorona)
