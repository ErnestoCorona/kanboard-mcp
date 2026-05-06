/**
 * Integration-suite resource tracker.
 *
 * Internal test infrastructure — NOT exported from the package.
 *
 * Each `it()` that creates a Kanboard entity registers the resulting id via
 * a `track*` helper. A single file-level `afterAll` hook in
 * `kanboard.int.test.ts` drains the tracker in FK-dependency order
 * (children before parents) using `try/catch` + log-only on failure.
 *
 * Per orchestrator-correction #4: tracker MUST include `files: Set<number>`
 * so `delete_task_file` symmetry is exercised in cleanup.
 *
 * Subtask + swimlane removal needs the parent FK as well (Kanboard JSON-RPC
 * `removeSubtask({subtask_id})` actually only needs the subtask id, but
 * `removeSwimlane({project_id, swimlane_id})` requires both — the tracker
 * stores the pair to keep cleanup self-contained).
 */

export interface CreatedResources {
  tasks: Set<number>;
  subtasks: Set<number>;
  comments: Set<number>;
  /** Used by delete_task_file symmetry — orchestrator-correction #4. */
  files: Set<number>;
  columns: Set<number>;
  swimlanes: Set<number>;
  projects: Set<number>;
}

/**
 * Build a fresh tracker. Each integration test file MUST call this once at
 * module scope; the tracker is mutated as tests create entities and drained
 * once in a single file-level `afterAll`.
 */
export function createTracker(): CreatedResources {
  return {
    tasks: new Set<number>(),
    subtasks: new Set<number>(),
    comments: new Set<number>(),
    files: new Set<number>(),
    columns: new Set<number>(),
    swimlanes: new Set<number>(),
    projects: new Set<number>(),
  };
}

// ---------------------------------------------------------------------------
// track* helpers — one per resource kind. Thin sugar over `Set.add`, kept
// as named functions so tests read intent-fully:
//
//   trackTask(tracker, taskId);
//
// is more obvious than:
//
//   tracker.tasks.add(taskId);
//
// at the call-site, especially across an 18kB integration file.
// ---------------------------------------------------------------------------

export function trackTask(tracker: CreatedResources, taskId: number): void {
  tracker.tasks.add(taskId);
}

export function trackSubtask(tracker: CreatedResources, subtaskId: number): void {
  tracker.subtasks.add(subtaskId);
}

export function trackComment(tracker: CreatedResources, commentId: number): void {
  tracker.comments.add(commentId);
}

export function trackFile(tracker: CreatedResources, fileId: number): void {
  tracker.files.add(fileId);
}

export function trackColumn(tracker: CreatedResources, columnId: number): void {
  tracker.columns.add(columnId);
}

export function trackSwimlane(tracker: CreatedResources, swimlaneId: number): void {
  tracker.swimlanes.add(swimlaneId);
}

export function trackProject(tracker: CreatedResources, projectId: number): void {
  tracker.projects.add(projectId);
}

// ---------------------------------------------------------------------------
// drainTier — shared cleanup helper for afterAll hooks.
//
// Deletes every id in `ids` concurrently via `deleteFn`. Failures are caught
// and logged via console.warn — NEVER thrown — so a botched cleanup cannot
// mask earlier test failures (Group 7 "Partial cleanup failure" scenario).
//
// Use one call per FK tier (e.g. comments, then files, then tasks, …).
// Concurrency within a tier is safe because every id in the tier is
// independent; FK ordering is preserved across tiers by call order.
// ---------------------------------------------------------------------------

export async function drainTier<T>(
  label: string,
  ids: Iterable<T>,
  deleteFn: (id: T) => Promise<unknown>,
): Promise<void> {
  const arr = Array.from(ids);
  if (arr.length === 0) return;
  const results = await Promise.allSettled(arr.map((id) => deleteFn(id)));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const err = r.reason as unknown;
      console.warn(
        `[afterAll cleanup] ${label}(${String(arr[i])}) failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  });
}
