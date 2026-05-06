# Configuration reference

Every knob the Kanboard MCP server exposes — environment variables, `.kanboard.yaml` fields, defaults, and validation rules.

---

## Environment variables

| Variable | Required | Default | Validation | Description |
|----------|----------|---------|------------|-------------|
| `KANBOARD_URL` | Yes | — | Must be a valid HTTPS URL (HTTP allowed only for `localhost`) | Base URL of your Kanboard instance |
| `KANBOARD_API_TOKEN` | Yes | — | 40-character hex string, non-empty | API token (personal or application, per `KANBOARD_AUTH_MODE`) |
| `KANBOARD_AUTH_MODE` | No | `personal` | `personal` or `app` | Authentication mode — see [Authentication modes](../explanation/authentication-modes.md) |
| `KANBOARD_USERNAME` | Personal mode only | — | Non-empty string | Your Kanboard login username; ignored in app mode |
| `KANBOARD_TIMEOUT_MS` | No | `15000` | Integer ≥ 1000 | Per-request HTTP timeout in milliseconds |
| `LOG_LEVEL` | No | `info` | One of `trace`, `debug`, `info`, `warn`, `error`, `fatal` | Pino log level |
| `RUN_INTEGRATION` | No | unset | Must equal `1` | Gate flag for the integration test suite |
| `KANBOARD_TEST_PROJECT_ID` | Integration tests only | — | Positive integer | Sandbox project id for integration tests; required to be a project whose name contains `sandbox` or `test` |

**Validation timing:** required variables are validated **at startup, before any tool registration or any network call**. A missing or invalid value causes an immediate non-zero exit with a structured error written to stderr.

**Token redaction:** `KANBOARD_API_TOKEN` is automatically redacted from every log line by Pino (see [Retry and redaction](../explanation/retry-and-redaction.md)). It will not appear in `info`, `debug`, `trace`, error stack traces, or any other output channel.

---

## `.kanboard.yaml`

A per-repo configuration file that the server walks up from `cwd` to find. See [Work across multiple projects](../how-to/work-across-multiple-projects.md) for the resolution rules.

### Schema

```yaml
# Project context — exactly one of these is required
project_id: 12                    # numeric Kanboard project id
# project_identifier: "MYPROJ"    # OR string identifier (alphanumeric, dash, underscore)

# Optional defaults — applied to any tool input that doesn't supply its own value
default_column_id: 2              # numeric column id (e.g., your Backlog column)
default_swimlane_id: 1            # numeric swimlane id
default_owner_id: 5               # numeric user id
default_category_id: 3            # numeric category id
```

### Field reference

| Field | Type | Required | Validation | Notes |
|-------|------|----------|------------|-------|
| `project_id` | integer | One of `project_id` / `project_identifier` | Positive integer | Kanboard's numeric project id |
| `project_identifier` | string | One of `project_id` / `project_identifier` | Matches `^[A-Za-z0-9_-]+$` | Short string identifier |
| `default_column_id` | integer | No | Positive integer | Used when a tool's input doesn't supply `column_id` |
| `default_swimlane_id` | integer | No | Positive integer | Used when a tool's input doesn't supply `swimlane_id` |
| `default_owner_id` | integer | No | Positive integer | Used when a tool's input doesn't supply `owner_id` |
| `default_category_id` | integer | No | Positive integer | Used when a tool's input doesn't supply `category_id` |

### Validation rules

- `project_id` and `project_identifier` are **mutually exclusive** — setting both is a startup error.
- At least **one** of them must be set for the file to be considered valid; otherwise the file is treated as if it didn't exist (tools will require explicit `project_id` per call).
- All `default_*` fields are optional. They never override an explicit value passed by the caller.
- The file is read on the first tool call that needs it, then **cached for the process lifetime**. Restart the MCP server to pick up edits.

### Resolution order (highest priority first)

1. **Explicit input** — `project_id` or `project_identifier` passed in the tool's input arguments.
2. **`.kanboard.yaml`** — the closest file walking up from `cwd`.
3. **Failure** — the tool returns a structured error pointing at this exact mechanism.

---

## File locations summary

| File | Where it lives | Purpose |
|------|----------------|---------|
| `.mcp.json` | Per-project root (Claude Code, Cursor) | Where the MCP client tells Claude how to launch this server |
| `~/.claude.json` | Home directory | Global MCP client config (Claude Code) |
| `claude_desktop_config.json` | macOS: `~/Library/Application Support/Claude/`<br>Windows: `%APPDATA%\Claude\` | Claude Desktop's MCP config |
| `.kanboard.yaml` | Per-repo root, or `$HOME` for global | Project context for the kanboard-mcp server |
| `.env` | Per-repo root (development only) | Local development env, including integration test secrets |
| `.env.example` | Repo root | Template for `.env` |

`.kanboard.yaml` does **not** contain secrets — it's safe to commit. `.env` does — it's `.gitignore`d, and the pre-commit gitleaks hook blocks accidental commits anyway.

## See also

- [Tools reference](./tools.md)
- [Authentication modes](../explanation/authentication-modes.md)
- [Work across multiple projects](../how-to/work-across-multiple-projects.md)
