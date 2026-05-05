# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.6] — 2026-05-05

### Added

- `create_project` — input gains optional `start_date`, `end_date`, and `email` fields (W9 / FR-05). Dates accept ISO 8601 strings or Unix epoch seconds (converted via the existing `isoToEpoch` helper); emails are validated via Zod. Tool description updated.

### Changed

- **BREAKING**: `list_users` tool removed and replaced with `list_project_users` (W14 / FR-W14). The previous tool called Kanboard's admin-only `getAllUsers`, returning HTTP 403 for `app-manager` and `app-user` roles. The new tool calls the user-scoped `getProjectUsers(project_id)`, accepts `project_id` / `project_identifier` / `.kanboard.yaml` fallback (matches the `list_columns` pattern), and works for non-admin roles. Output shape: `{ user_id: number; username: string }[]` sorted by `user_id`.
- `move_task_position` — when `column_name` matches multiple columns with the same title, the resolver now throws `API_ERROR` listing the matched column IDs so callers can disambiguate by `column_id` (W10 / FR-11). Previously a silent first-match was returned, which could move a task to the wrong column on boards with duplicate titles.
- `move_task_position` — when `column_name` does not match any column in the project, the resolver now throws `NOT_FOUND` instead of `VALIDATION_ERROR` (W11 / FR-11). The error code now correctly distinguishes "your input is malformed" from "your input is well-formed but the column doesn't exist on the server".

### Fixed

- `.kanboard.yaml` walk-up resolver now stops at the git root (a directory containing `.git`, file or directory — handles git worktrees and submodules) in addition to `$HOME` and the filesystem root (W7 / FR-02). Prevents the resolver from picking up an unrelated yaml in a parent repo in monorepo or nested-repo setups. Yaml-existence check still runs first at every level, so a yaml colocated with `.git` at the repo root is still picked up correctly.
- `selftest` no longer calls the admin-only `getAllProjects()` method — switched to `getMyProjects()` (same method as the production `list_projects` tool). Selftest now passes for `app-manager` and `app-user` roles (W15).

### Security

- Logger `redactionPaths` extended with `password` (top-level / flat) and `*.password` (any 1-level nested key) (W13 / NFR-Logging). Closes the gap where flat `{ password: "..." }` payloads or non-`auth`/`credentials`-prefixed nested passwords would have leaked verbatim. Existing `auth.password` and `credentials.password` paths kept for explicit clarity.

### Internal

- `Resolvers.resolveColumnIdByName` reworked: `Array.find` → `Array.filter`, now branches into 1-match (return) / >1-match (`KanboardApiError`) / 0-match (`NotFoundError`) paths.
- `KanboardHandler.createProject` signature extended with the 3 new optional input fields.
- 27 new unit test cases across `logger`, `kanboard-yaml`, `resolvers`, `create-project`, `move-task-position`. Total unit test suite: 834 → 861.

## [0.2.5] — 2026-05-05

### Added

- `update_project` — rename, change description, owner, start/end dates, or email after project creation.
- `create_column` — add a column to a project board with optional WIP limit and description.
- `update_column` — update a column's title, WIP limit, or description (at least one field required).
- `move_column` — reorder a column to a new 1-based position on the project board.

### Changed

- `move_task_position` — `position` is now optional (defaults to `1` = top of column). Callers that always pass `position` are unaffected (backward compatible).

### Internal

- `KanboardHandler` gains 5 new methods: `updateProject`, `getColumn`, `addColumn`, `updateColumn`, `changeColumnPosition`. Total typed methods 27 → 31.
- Total registered MCP tools 21 → 25 (`allTools` array in `src/tools/index.ts`).
- 51 new unit test cases (handler + tool layers). Total unit test suite: 783 → 834.
- Resolver invalidation contract (NFR-9): `create_column`, `update_column`, and `move_column` all invalidate the project resolver cache on the success path via `deps.resolvers.invalidate(project_id)`.

## [0.1.0] — 2026-05-01

### Added

- **21 MCP tools** covering 7 functional groups:
  - Projects: `list_projects`, `get_project`, `create_project`, `add_project_user`
  - Task CRUD: `list_tasks`, `get_task`, `create_task`, `update_task`, `move_task_position`
  - Personal workflow: `list_my_tasks`, `list_overdue_tasks`
  - Batch creation: `create_tasks_batch` (JSON-RPC 2.0 batch, up to 100 tasks per call)
  - Attachments: `attach_file_to_task` (file path or raw base64, max 5 MB)
  - Comments/subtasks: `add_comment`, `create_subtask`, `update_subtask`, `list_subtasks`
  - Lookups: `list_columns`, `list_categories`, `list_users`, `list_swimlanes`
- **Dual auth mode**: `personal` (acts as the authenticated Kanboard user) and `app` (global service token using the `jsonrpc` system user). Mode selected via `KANBOARD_AUTH_MODE` env var (defaults to `personal`).
- **`.kanboard.yaml` walk-up resolver**: walks from `process.cwd()` to `$HOME`, picks up the first `.kanboard.yaml` found. Supports `project_id` (numeric) XOR `project_identifier` (string) plus optional default column, swimlane, owner, and category IDs. Config is cached for the process lifetime.
- **Lazy project existence validation** (FR-30): the first tool call that consumes a project ID resolves and validates the project via `getProjectById`. Result cached for the process lifetime. Non-existent project returns `NOT_FOUND` with a hint pointing at the config source.
- **`getMe()` identity cache** (FR-29): populated once per process on first need. Used by `add_comment` to inject `user_id` automatically. Cache failure surfaces as `AuthError` — no silent fallback.
- **Retry policy for idempotent reads**: up to 2 retries on HTTP 429/502/503/504 and network errors. Exponential backoff: 300 ms then 900 ms. Mutations are never retried.
- **Configurable request timeout**: 15 s default via `AbortSignal.timeout()`. Override with `KANBOARD_TIMEOUT_MS` (positive integer ms). Timeout surfaces as `TIMEOUT_ERROR`.
- **Stable error codes**: `NOT_FOUND`, `VALIDATION_ERROR`, `AUTH_ERROR`, `API_ERROR`, `TIMEOUT_ERROR`, `CONFIG_ERROR` — consistent across all tools.
- **Date normalization**: all Unix-epoch-seconds fields in Kanboard responses (`date_creation`, `date_due`, etc.) are converted to ISO 8601 strings at the handler boundary. Tool inputs accepting dates (`date_due`, `date_started`) convert ISO 8601 to epoch seconds before sending.
- **Type coercion**: integer IDs coerced from string-or-number; FK fields where Kanboard returns `"0"` or `""` coerced to `null`; boolean-ish `"0"`/`"1"` fields coerced to `boolean`.
- **Pino structured logging**: all output to stderr only. Token redaction covers `apiToken`, `req.headers.authorization`, `*.token`, `*.secret`, `credentials.apiToken`. A dedicated unit test verifies the token literal never appears verbatim in any emitted log line.
- **`npm run selftest`**: smoke-tests credentials and connectivity without starting the full MCP server. Checks `getVersion()`, `getMe()` (personal mode only), and `getAllProjects()`. All output to stderr; exit code 0 = pass.
- **Integration test harness**: gated behind `RUN_INTEGRATION=1` + `KANBOARD_TEST_PROJECT_ID`. Aborts before any mutation if the target project's name does not contain `"sandbox"` or `"test"`. Created entities prefixed `[TEST-{ISO-timestamp}]`; cleanup in `try/finally`.
- **Unit test suite**: 708 tests covering handler methods, tool layers, api-client retry/timeout/redaction/error-mapping, config loading, YAML resolution, and constants.
- **TypeScript strict mode**, `tsup` ESM bundle, target Node 22, shebang injected into output bundle. Binary name: `kanboard-mcp`.

### Changed

- `list_overdue_tasks` now accepts a `scope` parameter (`mine` | `all` | `project`); the literal 4th branch from spec FR-13 (`getOverdueTasksByUser`) is omitted because that JSON-RPC method does not exist in the Kanboard API.
- `attach_file_to_task` accepts `content_base64` as an alternative to `file_path` (Zod XOR refine). The `filename` field is now required (no basename fallback).
- `create_task`, `update_task`, `create_tasks_batch` now accept dates as ISO 8601 strings or Unix epoch seconds; conversion to epoch happens at the tool layer before the API call.
- `.kanboard.yaml` resolution now eagerly validates that the project exists, returning a friendly `ConfigError` with a source-aware hint instead of an opaque API error.

### Security

- API token is never included in any error message or log output — only the env var name is referenced.
- No destructive tools (`delete_*`, `remove_*`) in v1 — all write operations are additive or in-place updates only.
- Integration test suite refuses to run against a project that does not have `"sandbox"` or `"test"` in its name.
- Logger redaction expanded to cover `*.secret` and `credentials.apiToken` paths.

### Known Limitations

- Integration tests against a live Kanboard instance have not been executed; OQ-01 (JSON-RPC batch support) is verified by harness but pending real-instance confirmation.
- 7 backlog items deferred to v0.2 — see `v0.2-backlog.md`.

[0.2.6]: https://github.com/ErnestoCorona/kanboard-mcp/releases/tag/v0.2.6
[0.2.5]: https://github.com/ErnestoCorona/kanboard-mcp/releases/tag/v0.2.5
[0.1.0]: https://github.com/ErnestoCorona/kanboard-mcp/releases/tag/v0.1.0
