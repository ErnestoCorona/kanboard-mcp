# The batch architecture

`create_tasks_batch` is the most "load-bearing" tool in the server. It's the difference between an AI agent that can paste an email and create one task, and an AI agent that can paste an email and create twenty tasks in one round-trip without choking on Kanboard's rate limits or your patience.

This page explains why batching matters specifically for AI workflows, how Kanboard's JSON-RPC 2.0 batching works, why we capped batches at 100, and what trade-offs we made.

---

## Why batching is the AI-workflow primitive

When a person uses Kanboard, they create tasks one at a time. Click *New task* → fill the form → save. The latency cost of doing this 30 times in a row is not a problem because typing the form takes 30 seconds and the round-trip takes 200ms — the network is invisible.

When an AI agent uses Kanboard, the proportions invert:

- The agent has already produced the 30 tasks in its own context window.
- Each task is one structured object the agent could send right now.
- The cost of sending them is now dominated by network round-trips.

A 30-task workflow without batching:
- 30 sequential HTTP calls.
- Median wall time: ~6 seconds on a typical Kanboard. Worst case (rate-limited or slow): 15+ seconds.
- 30 separate log entries, 30 separate audit records.
- **The agent loses focus during the wait.** Multi-turn agents will either spin uselessly or, worse, decide to "do something else" mid-create — leaving an inconsistent partial state.

A 30-task workflow with batching:
- 1 HTTP call, one batch JSON-RPC envelope.
- Median wall time: ~300–500ms.
- 1 log entry on the client, ideally 1 audit record on Kanboard.
- The agent stays on task; the workflow feels instant.

The latency improvement isn't the most important part. The most important part is **agent reliability**: an agent doing a single fast operation is dramatically more predictable than one doing 30 sequential operations with retry logic in between.

## How JSON-RPC 2.0 batching works

JSON-RPC 2.0 supports batch requests natively. Instead of sending one request object, you send an array:

```json
[
  { "jsonrpc": "2.0", "id": 1, "method": "createTask", "params": { ... } },
  { "jsonrpc": "2.0", "id": 2, "method": "createTask", "params": { ... } },
  { "jsonrpc": "2.0", "id": 3, "method": "createTask", "params": { ... } }
]
```

The server processes them and returns an array of responses, in arbitrary order, each carrying the matching `id`:

```json
[
  { "jsonrpc": "2.0", "id": 2, "result": 1235 },
  { "jsonrpc": "2.0", "id": 1, "result": 1234 },
  { "jsonrpc": "2.0", "id": 3, "error": { "code": -32603, "message": "..." } }
]
```

Three properties of this design matter for our use case:

1. **One round-trip, many operations.** The whole batch ships in a single HTTP POST. Latency is bounded by the slowest individual operation, not by the sum.
2. **Per-item failure isolation.** A bad task in the middle doesn't kill the others. The response carries individual results, and we surface them as a structured success/failure list to the caller.
3. **Order-independent.** Responses can come back in any order. We use the request `id` to correlate.

## Why we cap batches at 100

The cap is a deliberate choice, not a Kanboard limit. Three reasons:

1. **Memory.** A batch of 1000 tasks would create a request body large enough to stress Kanboard's PHP request handler (often `post_max_size` is a few MB). At 100 tasks, even the worst-case payload (rich descriptions, many tags) fits comfortably.

2. **Validation cost.** Zod validates the entire input array up-front. At 100 items, this is microseconds. At 10,000 items, you start to see GC pressure on the agent's process, especially when running through `tsx`.

3. **Failure blast radius.** If the agent miscategorizes input, an "all-or-nothing" 100-task error is a recoverable mistake. A 5,000-task error is a rollback nightmare.

If you genuinely need to ingest more than 100 tasks at once (e.g., importing from a Slack export), the agent splits into multiple batches. Two `create_tasks_batch` calls for 200 tasks is still much better than 200 individual `create_task` calls — and it doesn't require any special chunking logic on our side.

## All-or-nothing input validation, per-item server reporting

There are two distinct validation passes, and they have different semantics:

### Pass 1: Zod input validation (all-or-nothing)

When `create_tasks_batch` is called, we validate the **entire** input array against the Zod schema before doing anything else. If any single task fails (e.g., `priority: 5` when 0–3 is the allowed range), the **whole batch is rejected**. No HTTP request is sent.

Why all-or-nothing here? Because the agent generated the whole batch from one logical prompt. If one item is malformed, the prompt was probably wrong; partial success would just deliver partial garbage. Failing loudly is more useful than partial success.

### Pass 2: Kanboard server-side processing (per-item)

If Pass 1 succeeds, we send the batch to Kanboard. Kanboard processes each task individually and reports per-item success or failure (e.g., one bad `owner_id` doesn't sink the others, but it does fail that specific task).

Why per-item here? Because by this stage, we've validated the inputs are *structurally* correct. Failures now are runtime conditions — Kanboard's view of the world (a user got removed from the project, a column got deleted) — and partial success is actually useful. We surface a structured result with `successful_ids` and `failed_items` so the agent can react.

## What we don't do

A few things batching could imply but doesn't:

- **No transactional semantics.** Kanboard's batch isn't a database transaction. If task #5 in a 10-task batch fails, tasks 1–4 are already committed. There's no rollback. Plan for partial success on the server side.
- **No parallel operations within a batch.** Kanboard processes batch items sequentially internally. Batching doesn't make individual tasks faster — it just removes the network round-trip overhead.
- **No batching for other tools.** Only `create_tasks_batch` is exposed. We considered `create_subtasks_batch` and `update_tasks_batch` but didn't ship them in v0.3 because the use cases are weaker (subtasks are usually small N; updates are usually individual).

`create_tasks_batch` exists because turning a document into a sprint backlog is a real, common, high-value workflow. The other batch tools would be solutions in search of a problem.

## Performance numbers (as of v0.3)

Measured against a vanilla Kanboard 1.2.x install on a low-spec VPS, over a typical residential internet connection:

| Workload | `create_task` ×N | `create_tasks_batch` (one call) | Speedup |
|----------|------------------|--------------------------------|---------|
| 5 tasks | ~1.0s | ~280ms | 3.6× |
| 10 tasks | ~2.1s | ~340ms | 6.2× |
| 30 tasks | ~6.4s | ~480ms | 13.3× |
| 100 tasks | ~22s | ~1.1s | 20× |

The speedup grows with N because the per-call overhead is fixed per request, not per task. At 100 tasks, the round-trip dominates.

## See also

- [Turn a document into a backlog](../how-to/turn-document-into-backlog.md) — the canonical use case.
- [Tools reference → `create_tasks_batch`](../reference/tools.md#batch-operations) — the input contract.
- [Errors reference](../reference/errors.md) — the error envelope, including the `failed_items` structure.
