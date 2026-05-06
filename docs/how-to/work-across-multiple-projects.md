# How to work across multiple projects

**You have:** several repositories, each one related to a different Kanboard project.

**You want:** your agent to automatically pick the right Kanboard project based on which repo you're working in — without having to repeat the project id in every prompt.

**You'll use:** `.kanboard.yaml`, a per-repo configuration file the server walks up to find.

---

## The recipe

In **each** repository, drop a `.kanboard.yaml` at the root:

```yaml
# repo: ~/code/mobile-app/.kanboard.yaml
project_id: 42
default_column_id: 588          # Backlog
```

```yaml
# repo: ~/code/api-server/.kanboard.yaml
project_id: 17
default_column_id: 234          # Bereit (Ready)
```

Now any time you launch your agent from inside `~/code/mobile-app`, every tool that needs a project will resolve to **#42**. From inside `~/code/api-server`, the same tools resolve to **#17**. No prompt changes, no config swaps — just `cd` and go.

## How the resolver works

When a tool needs a project context and the input doesn't supply one, the server walks up from the current working directory looking for `.kanboard.yaml`. It stops at:

- `$HOME` (it never reads outside your home directory)
- the git repo root, if `cwd` is inside a git repo

The first match wins. If no file is found, tools that need a project will fail with a structured error pointing to this exact mechanism.

## Per-call overrides

The walked-up file gives you a default. You can always override it on a single call by passing `project_id` (or `project_identifier`) explicitly in the tool input.

This is what lets you say things like:

> *"Show me everything overdue in **project 17** even though we're in the mobile-app repo."*

The agent will pass `project_id: 17` to `list_overdue_tasks` and bypass the resolver for that one call.

## What `.kanboard.yaml` accepts

```yaml
# Use exactly one of these — they are mutually exclusive
project_id: 42
# project_identifier: "MOBILE"

# Optional defaults — applied to any tool input that doesn't supply its own value
default_column_id: 588          # most common: your Backlog or Bereit column
default_swimlane_id: 7          # only useful if your project uses swimlanes
default_owner_id: 12            # auto-assign newly-created tasks to this user
default_category_id: 3          # auto-tag newly-created tasks with this category
```

`project_id` is a number. `project_identifier` is the short string you set in Kanboard's project settings (alphanumeric, dash, underscore). Pick one.

## Common patterns

### One file at the org level, multiple repos under it

If you have a parent directory with several repos that all map to the same project:

```
~/code/acme-corp/.kanboard.yaml          # project_id: 99
~/code/acme-corp/frontend/               # → resolves to 99
~/code/acme-corp/backend/                # → resolves to 99
~/code/acme-corp/infra/                  # → resolves to 99
```

The walk-up will find the parent file from any of the subdirectories.

### Override defaults inside a subfolder

You can put a more specific `.kanboard.yaml` in a subfolder. Closer files win:

```
~/code/acme-corp/.kanboard.yaml            # project_id: 99 (general)
~/code/acme-corp/qa/.kanboard.yaml         # project_id: 100 (QA-specific)
```

When you `cd ~/code/acme-corp/qa`, the QA file is the closer match — you get project 100.

## Caching

The file is read **once per server process** and cached. If you edit `.kanboard.yaml`, restart the MCP server (in Claude Code: just close and reopen the session, or use the `/mcp` reconnect flow).

## Common issues

| Issue | Likely cause | Fix |
|-------|--------------|-----|
| Tools say "no project resolved" | No `.kanboard.yaml` in the walked-up path | Add one at your repo root |
| Wrong project getting resolved | A closer file is overriding | `find . -name .kanboard.yaml -maxdepth 4` and check |
| Recent edits to `.kanboard.yaml` not taking effect | Cache hasn't refreshed | Restart the MCP server / Claude Code session |
| `project_id and project_identifier are mutually exclusive` error | Both set in the file | Comment out one — the validator enforces exactly one |

## Security note

`.kanboard.yaml` does NOT contain secrets. Project ids and column ids are not sensitive. **Commit it.** The token lives in your MCP client's `env` block, never in this file.

## See also

- [Tutorial — Your first task](../tutorials/your-first-task.md) for the basic setup.
- [Configuration reference](../reference/configuration.md) for the full schema and validation rules.
