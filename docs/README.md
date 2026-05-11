# Kanboard MCP — Documentation

Welcome. These docs follow the [Diátaxis](https://diataxis.fr/) framework — four kinds of documentation, each with a single job:

- **Tutorials** teach you something step by step.
- **How-to guides** show you how to solve a specific problem.
- **Reference** is for looking things up.
- **Explanation** discusses the *why* behind the design.

If you're new, start with the tutorial. If you have a job to do, the how-to guides are the fastest path. If you're integrating or debugging, the reference is your friend. If you want to understand how the server thinks, read the explanations.

---

## 🎓 Tutorials — start here

Hand-held, step-by-step. You follow along; we promise concrete results.

- [Your first task from Claude Code](./tutorials/your-first-task.md) — install Kanboard MCP, connect it to your Kanboard, and create your first task in 5 minutes.

## 🛠️ How-to guides — recipes for real problems

Goal-oriented. You know what you want; we tell you how to get there.

- [Turn a document into a backlog](./how-to/turn-document-into-backlog.md) — use `create_tasks_batch` to extract tasks from emails, transcripts, or specs in one round-trip.
- [Work across multiple projects](./how-to/work-across-multiple-projects.md) — use `.kanboard.yaml` to make your agent auto-switch boards as you switch repos.
- [Set up integration tests](./how-to/set-up-integration-tests.md) — point the integration suite at a sandbox Kanboard project safely, with cleanup.
- [Use application mode for bots and CI](./how-to/use-app-mode-for-bots-and-ci.md) — run kanboard-mcp under a service identity instead of a personal account.
- [Debug with MCP Inspector](./how-to/debug-with-mcp-inspector.md) — inspect tool schemas, fire individual calls, and watch JSON-RPC traffic in a browser UI.

## 📖 Reference — facts and tables

Lookup-oriented. Read it when you need an exact answer.

- [Configuration](./reference/configuration.md) — every environment variable and `.kanboard.yaml` field, with defaults and validation rules.
- [Tools](./reference/tools.md) — all 37 tools, grouped by domain, with required and optional inputs.
- [Errors](./reference/errors.md) — the error envelope, error types, and what each one means.

## 💡 Explanation — the *why*

Understanding-oriented. Read these when you want to know how the server thinks.

- [The access-control model](./explanation/access-control.md) — why authorization is delegated entirely to Kanboard's project ACL, and what that means in practice.
- [Authentication modes](./explanation/authentication-modes.md) — personal vs application mode, when to use each, and what changes under the hood.
- [Retries and redaction](./explanation/retry-and-redaction.md) — why we retry reads but never writes, and how secrets are kept out of logs.
- [The batch architecture](./explanation/the-batch-architecture.md) — why JSON-RPC 2.0 batching matters for AI workflows, and where the limits come from.

---

## What's not in these docs (yet)

- HTTP / SSE transport — coming in v0.4.
- Webhooks and IMAP-to-task ingestion — coming in v0.5.

If you'd like to contribute a tutorial or recipe, see [CONTRIBUTING.md](../CONTRIBUTING.md).
