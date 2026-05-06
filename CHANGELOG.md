# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] — 2026-05-06

### Added

- `delete_column` — destructive MCP tool for permanent column removal. Confirm-gated via `confirm: z.literal(true)` + `assertConfirmed("delete_column", ...)`. Resolves `project_id` via `getColumn` for resolver invalidation (NFR-9). Mirrors the `delete_swimlane` pattern.
- `KanboardHandler.removeColumn(column_id)` — JSON-RPC wrapper for Kanboard's `removeColumn` method (wire param `column_id`). Closes the column-deletion gap that left v0.3.0's integration tracker drain warn-only.

### Changed

- `tests/integration/_helpers/cleanup.ts` columns tier now actually deletes via `handler.removeColumn` (was warn-only in v0.3.0). The `afterAll` drain in `kanboard.int.test.ts` integrates columns into the FK-ordered tier sequence (comments → files → subtasks → tasks → swimlanes → columns → projects) using the standard `drainTier` helper.
- Total registered MCP tools 36 → 37 (`allTools` array in `src/tools/index.ts`). Tool-count assertions in `tests/unit/tools/index.test.ts` and `tests/unit/transports/bootstrap.test.ts` updated.

### Fixed

- Closes the warn-only branch in the integration `afterAll` cleanup (verify-report SUGGESTION 1 from v0.3.0). Spec scenario "afterAll calls delete_task × N and delete_column × M" now fully exercised — no more deferred column-cleanup branch.

### Docs

- README — new "Troubleshooting" section documents the pre-existing `tsx`/`npx` exit-code propagation quirk (`process.exit(1)` may not propagate through the tsx wrapper, so `scripts/preflight.sh` may report exit 0 even when `npm run selftest` failed internally). Workaround: re-run preflight 2–3 times before publish, or check the script output explicitly for `selftest pass`. Not specific to kanboard-mcp (verify-report SUGGESTION 2 from v0.3.0).

### Reference

SDD change: `mcp-kanboard-v0.3.1-removecolumn-patch` (engram topic family `sdd/mcp-kanboard-v0.3.1-removecolumn-patch/*`). Condensed mini-cycle — single-batch apply addressing v0.3.0 verify-report suggestions.

## [0.3.0] — 2026-05-06

### Breaking changes — input renames (no aliases)

- `update_task` — input field `id` removed; replaced by `task_id`. Strict-mode Zod rejects the legacy `id` as an unknown property. The Kanboard wire param remains `id`; the handler remaps `task_id → id` at the transport boundary.
- `update_subtask` — input field `id` removed; replaced by `subtask_id`. Same wire remap pattern as `update_task`.
- `add_comment` → `create_comment`. The tool registry now exposes only `create_comment`. Internal exports renamed `addCommentTool → createCommentTool`, `AddCommentInput → CreateCommentInput`. `add_project_user` is retained intentionally (relationship-creation semantics, not entity-creation).

Pre-publish window with zero external users — no deprecation period, no alias layer.

### Added — 11 new tools (25 → 36)

- **Destructive (6, all confirm-gated via `confirm: z.literal(true)`):** `delete_task`, `delete_project`, `delete_subtask`, `delete_comment`, `delete_task_file`, `remove_project_user`. Each refuses to act without explicit `confirm: true`. `delete_project` and `remove_project_user` invalidate the project resolver cache on success.
- **Swimlane CRUD (4):** `create_swimlane`, `update_swimlane`, `move_swimlane`, `delete_swimlane`. Mirrors the column tool pattern: project resolution via `.kanboard.yaml`, at-least-one-field refine on update, project-scoped resolver invalidation on success. `delete_swimlane` is confirm-gated.
- **Comment symmetry (1):** `update_comment` — input `{comment_id, content}`. Handler remaps `comment_id → id` for the Kanboard wire.

### Changed

- `create_tasks_batch` — each item now accepts the full `create_task` field set. Added optional `creator_id`, `score`, `date_started`, `tags`, `reference` (mirrors `create_task` types and nullability). `date_started` flows through `isoToEpoch` exactly like `date_due`. Forwarded as-is to the handler — no coercion.
- `list_overdue_tasks` — vestigial `.refine(() => true)` no-op removed. Behavior identical for all valid inputs (`scope: mine | all | project`).

### Internal

- `assertConfirmed(toolName, confirm)` helper centralizes confirm gating for all 7 destructive tools (`src/shared/confirm.ts`). Throws `ValidationError` when `confirm !== true`. Belt-and-suspenders defence against direct handler calls bypassing Zod.
- `KanboardHandler` gains 13 typed methods: `removeTask`, `removeProject`, `removeSubtask`, `removeComment`, `removeTaskFile`, `removeProjectUser`, `getSwimlane`, `addSwimlane`, `updateSwimlane`, `changeSwimlanePosition`, `removeSwimlane`, `updateComment`, `closeTask` (Phase 9 board-hygiene helper).
- `tests/integration/_helpers/cleanup.ts` — per-suite tracker (`CreatedResources` Sets for tasks/subtasks/comments/files/columns/swimlanes/projects) + `drainTier(label, ids, deleteFn)` helper. File-level `afterAll(60_000)` in `kanboard.int.test.ts` drains each FK tier concurrently via `Promise.allSettled` (subtasks → tasks → comments → files → swimlanes → columns → projects). Failures are logged warn-only and never re-throw.
- `scripts/cleanup-sandbox.ts` — repo-resident sandbox drain script. Dual safety gate (project name matches `/sandbox|test/i` AND each entity name starts with `[TEST-`). Idempotent. Drains `[TEST-` tasks (active + closed). Columns require manual cleanup (no `removeColumn` handler in v0.3.0).
- `scripts/preflight.sh` — pre-publish gate: `rm -rf node_modules package-lock.json && npm install && npm run selftest`.
- `.npmignore` extended defensively (`scripts/`, `tests/`, `.kanboard.yaml`, `.env`). The `package.json` `files` whitelist already restricts the published bundle to `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`, and the two `.example` files.
- Total registered MCP tools 25 → 36 (`allTools` array in `src/tools/index.ts`).
- Unit test suite expanded by 100+ cases across the new tools, helper, schema edits, and tracker. Tool-count assertion bumped to 36 in `tests/unit/tools/index.test.ts` and `tests/unit/transports/bootstrap.test.ts`.

### Reference

SDD change: `mcp-kanboard-v0.3.0-public-ready` (engram topic family `sdd/mcp-kanboard-v0.3.0-public-ready/*`).

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

[0.3.1]: https://github.com/ErnestoCorona/kanboard-mcp/releases/tag/v0.3.1
[0.3.0]: https://github.com/ErnestoCorona/kanboard-mcp/releases/tag/v0.3.0
[0.2.6]: https://github.com/ErnestoCorona/kanboard-mcp/releases/tag/v0.2.6
[0.2.5]: https://github.com/ErnestoCorona/kanboard-mcp/releases/tag/v0.2.5
[0.1.0]: https://github.com/ErnestoCorona/kanboard-mcp/releases/tag/v0.1.0
