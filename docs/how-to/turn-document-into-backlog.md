# How to turn a document into a backlog

**You have:** a meeting transcript, a customer email thread, a product spec, or a brain-dump in markdown.

**You want:** every actionable item from that document in your Kanboard backlog, with sensible titles, priorities, and column placement — without typing each one in by hand.

**You'll use:** `create_tasks_batch` (one HTTP round-trip, up to 100 tasks).

---

## The recipe

1. Open the document in your editor (or paste it into the Claude chat).
2. Make sure your repo has a `.kanboard.yaml` so the project context is auto-resolved (see [Work across multiple projects](./work-across-multiple-projects.md)) — or pass `project_id` explicitly in step 3.
3. Tell your agent what you want, in plain language:

> *"Read [path/to/file.md] (or 'this email I'm pasting'), extract every actionable task, and create them in the Backlog column. Use priority 1 for blockers, 2 for normal work, 3 for nice-to-haves."*

The agent will typically:

1. Read the document.
2. Call `list_columns` to resolve the Backlog column id (if not already cached).
3. Call `create_tasks_batch` once with all tasks at once.
4. Return the list of created task ids.

## Why batching matters here

Without batching, a 30-task import is 30 sequential HTTP calls — easily 5–15 seconds of latency, and 30 separate audit-log entries on the Kanboard side. With `create_tasks_batch`, it's **one** JSON-RPC 2.0 batch request, one TCP round-trip, and one logical operation — typically under 500 ms even on slow links.

The hard limit is **100 tasks per batch**. If your document has more, the agent will (or should) split into multiple batches automatically.

## Tuning the prompt

Some practical refinements that improve the output:

- **Constrain the title length**: *"Keep titles under 80 characters."* Avoids agents producing essay-length titles.
- **Force a column choice**: *"Put bugs in Backlog, ideas in Ideas, follow-ups in Bereit."* Otherwise everything lands in the default column.
- **Require descriptions**: *"For each task, include a one-paragraph description in markdown summarising the source context."*
- **Reference the source**: *"Add the original quote at the bottom of each description, in a blockquote, so I can trace it back."*

## Example: customer email → sprint backlog

Prompt:

> *"Here's an email from a customer. Pull every concrete bug or feature request, create them as tasks in project 42, Backlog column. Priority 1 if they used the words 'broken', 'critical', or 'urgent'. Priority 2 otherwise. Each task should include the relevant excerpt as a blockquote. Email follows: [paste email]"*

Expected agent behavior:

1. Reads the email.
2. Optionally calls `list_projects` if the project id isn't cached.
3. Calls `list_columns(42)` to resolve the Backlog column id (e.g. `588`).
4. Calls `create_tasks_batch(42, [...])` with maybe 6–12 tasks.
5. Returns: *"Created 8 tasks in Mobile/Backlog: #2451, #2452, ..."*

## Common issues

| Issue | Likely cause | Fix |
|-------|--------------|-----|
| Tasks created but in the wrong column | Default column from `.kanboard.yaml` overrode the prompt | Pass `column_id` explicitly per task in your prompt |
| Some tasks missing | Agent silently dropped items it didn't classify as actionable | Be explicit: *"Include even ambiguous items as priority 3 — better to delete one than miss one."* |
| `Validation failed: priority must be ≤ 3` | Agent invented priority values like 4 or 5 | Kanboard priorities are 0–3; remind the agent in the prompt |
| `Batch exceeds 100 task limit` | Document has > 100 candidate items | Ask the agent to split: *"Process in batches of 50."* |

## Variations

- **From a Slack export** — the same recipe works on a JSON Slack export. Tell the agent to filter by `@username` or by reactions like `:bug:`.
- **From git log** — *"For every commit that mentions 'TODO:', create a follow-up task."*
- **From a PR description** — *"Create one task per checklist item that's still unchecked."*

## See also

- [Tools reference → `create_tasks_batch`](../reference/tools.md#batch-operations) for the full input schema.
- [The batch architecture](../explanation/the-batch-architecture.md) for the design rationale and performance numbers.
