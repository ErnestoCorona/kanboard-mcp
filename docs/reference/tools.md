# Tools reference

Kanboard MCP exposes **39 tools across 9 groups**. Every tool input is validated by a strict Zod schema before any HTTP call. Every output is parsed and reshaped into a stable, type-safe contract — Kanboard's per-version response shape variations are absorbed at the boundary.

This page lists every tool, its required inputs, the optional inputs you'll actually use, and any special semantics. For the canonical schema (every optional field, every refinement), see `src/tools/<tool-name>.ts` — those files are the source of truth.

## Conventions

- **Required** — must be present, otherwise validation fails before any HTTP call.
- **Common optional** — the optional fields you'll actually reach for. Most tools accept additional Kanboard-specific fields; check the source for the full list.
- **Destructive** — tools that delete or remove data refuse to execute without `confirmation: true` in the input. This is enforced at the schema layer.
- **Project context** — for tools that accept `project_id`, the value can be omitted if `.kanboard.yaml` resolves it via walk-up. Explicit input always wins.

---

## Project Management (8 tools)

| Tool | Required | Common optional | Notes |
|------|----------|-----------------|-------|
| `list_projects` | — | — | Returns projects the authenticated user can access |
| `get_project` | `project_id` **or** `project_identifier` | — | Either lookup style works |
| `create_project` | `name` | `identifier`, `description`, `owner_id` | |
| `update_project` | `project_id` | `name`, `description`, `is_active`, `start_date`, `end_date`, `email` | Partial update — only fields you pass are changed |
| `delete_project` | `project_id`, `confirmation: true` | — | **Destructive** |
| `add_project_user` | `project_id`, `user_id`, `role` | — | `role` ∈ `project-manager`, `project-member`, `project-viewer` |
| `remove_project_user` | `project_id`, `user_id`, `confirmation: true` | — | **Destructive** |
| `list_project_users` | `project_id` | — | Returns members and their roles |

## Column Management (5 tools)

| Tool | Required | Common optional | Notes |
|------|----------|-----------------|-------|
| `list_columns` | `project_id` | — | Returns columns ordered by position |
| `create_column` | `project_id`, `title` | `task_limit`, `description` | New column appends to the end |
| `update_column` | `column_id` | `title`, `task_limit`, `description` | Partial update |
| `move_column` | `project_id`, `column_id`, `position` | — | `position` is 1-based |
| `delete_column` | `column_id`, `confirmation: true` | — | **Destructive** — also deletes tasks in that column on the Kanboard side |

## Swimlane Management (5 tools)

| Tool | Required | Common optional | Notes |
|------|----------|-----------------|-------|
| `list_swimlanes` | `project_id` | — | Includes the default swimlane |
| `create_swimlane` | `project_id`, `name` | `description` | |
| `update_swimlane` | `swimlane_id` | `name`, `description`, `is_active` | Partial update |
| `move_swimlane` | `project_id`, `swimlane_id`, `position` | — | `position` is 1-based |
| `delete_swimlane` | `swimlane_id`, `confirmation: true` | — | **Destructive** |

## Task Management (10 tools)

| Tool | Required | Common optional | Notes |
|------|----------|-----------------|-------|
| `list_tasks` | `project_id` | `status_id` (default `1` = open; `0` = closed) | |
| `get_task` | `task_id` | — | Returns the full task object including dates, swimlane, column, owner, score |
| `create_task` | `project_id`, `title` | `column_id`, `swimlane_id`, `owner_id`, `category_id`, `color_id`, `priority` (0–3), `description`, `date_due`, `tags` (array of strings), `score`, `reference` | All defaults from `.kanboard.yaml` apply when fields are omitted |
| `update_task` | `task_id` | Same fields as `create_task` plus `is_active` | Partial update — moves columns, reassigns owners, edits content |
| `delete_task` | `task_id`, `confirmation: true` | — | **Destructive** |
| `close_task` | `task_id` | — | Sets `is_active=0` — archives off the active board, preserved (not deleted). Reversible via `reopen_task` |
| `reopen_task` | `task_id` | — | Sets `is_active=1` — restores a closed task to the active board. Inverse of `close_task` |
| `move_task_position` | `project_id`, `task_id`, `column_id`, `position`, `swimlane_id` | — | `position` is 1-based within the destination column |
| `list_my_tasks` | — | — | Tasks assigned to the authenticated user; empty in app mode |
| `list_overdue_tasks` | — | `project_id` (to scope) | Tasks with `date_due` in the past and `is_active=true` |

## Batch Operations (1 tool)

| Tool | Required | Common optional | Notes |
|------|----------|-----------------|-------|
| `create_tasks_batch` | `project_id`, `tasks` (array, 1–100) | — | All-or-nothing **input validation**; **per-task** result reporting from Kanboard. See [The batch architecture](../explanation/the-batch-architecture.md) |

Each entry in `tasks[]` accepts the same fields as `create_task` minus `project_id` (which is shared at the top level).

## Subtask Management (4 tools)

| Tool | Required | Common optional | Notes |
|------|----------|-----------------|-------|
| `list_subtasks` | `task_id` | — | Returns subtasks ordered by position |
| `create_subtask` | `task_id`, `title` | `user_id`, `time_estimated`, `time_spent`, `status` | |
| `update_subtask` | `subtask_id`, `task_id` | `title`, `status`, `user_id`, `time_estimated`, `time_spent` | `status` ∈ `0` (todo), `1` (in progress), `2` (done) |
| `delete_subtask` | `subtask_id`, `task_id`, `confirmation: true` | — | **Destructive** |

## Comment Management (3 tools)

| Tool | Required | Common optional | Notes |
|------|----------|-----------------|-------|
| `create_comment` | `task_id`, `content` | `user_id` | In app mode, `user_id` is ignored — comment is authored by `jsonrpc` |
| `update_comment` | `comment_id`, `content` | — | Kanboard restricts edits to the comment's author |
| `delete_comment` | `comment_id`, `confirmation: true` | — | **Destructive** |

## Attachment Management (2 tools)

| Tool | Required | Common optional | Notes |
|------|----------|-----------------|-------|
| `attach_file_to_task` | `task_id`, `filename`, exactly one of `file_path` (string) or `blob_base64` (string) | — | 5 MB hard cap, enforced at the schema layer before any read or upload |
| `delete_task_file` | `file_id`, `confirmation: true` | — | **Destructive** |

## Lookups (1 tool)

| Tool | Required | Common optional | Notes |
|------|----------|-----------------|-------|
| `list_categories` | `project_id` | — | Returns the categories defined in the project's settings |

---

## A note on `confirmation: true`

Every `delete_*` and `remove_*` tool requires the literal value `true` in a top-level `confirmation` field of the input. The Zod schema enforces it — without that field, the tool refuses to run and returns a structured error. Two reasons:

1. **Agent misfires.** LLMs occasionally misinterpret a prompt and fire a destructive call. Requiring an explicit confirmation gives the agent (and you, in the loop) a chance to catch it.
2. **No-recovery operations.** Most destructive operations are not recoverable from the API side. The schema-layer check is cheaper than a Kanboard backup.

This is a **schema-layer** check, not a runtime hint. It cannot be bypassed by setting `confirmation: false` or omitting the field — both fail validation.

## See also

- [Configuration reference](./configuration.md) — for environment variables and `.kanboard.yaml`.
- [Errors](./errors.md) — for the shape of errors returned by tool calls.
- [The batch architecture](../explanation/the-batch-architecture.md) — for `create_tasks_batch` design rationale.
