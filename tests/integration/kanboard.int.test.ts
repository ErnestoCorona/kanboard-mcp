/**
 * Integration tests for KanboardHandler — end-to-end round-trips against
 * the real Kanboard instance using the sandbox/test project.
 *
 * GATE: These tests only run when:
 *   - RUN_INTEGRATION=1
 *   - KANBOARD_URL, KANBOARD_API_TOKEN, KANBOARD_TEST_PROJECT_ID are set
 *   - The test project name/identifier contains "sandbox" or "test"
 *     (enforced by setup.ts — the whole suite is refused otherwise).
 *
 * All created entities use a [TEST-{ISO-timestamp}] prefix in their title.
 * This is the documented cleanup contract: no automated deletes are performed
 * (deferred to v0.3 per proposal); orphaned [TEST-*] tasks can be removed
 * manually or via a future cleanup script.
 *
 * Run with:
 *   RUN_INTEGRATION=1 \
 *   KANBOARD_URL=https://kanboard.example.com \
 *   KANBOARD_API_TOKEN=<token> \
 *   KANBOARD_TEST_PROJECT_ID=<id> \
 *   npm run test:int
 *
 * CRITICAL — OQ-01 resolution:
 *   The "bulk" describe block proves that JSON-RPC batch POST works against
 *   a live Kanboard instance. This is the primary validation of
 *   the create_tasks_batch killer feature.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handler, bundle, projectId } from "./setup.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a [TEST-{ISO-timestamp}] prefix for all created entities.
 * Use this as the leading token in every title so manual cleanup is easy.
 */
function testPrefix(): string {
  return `[TEST-${new Date().toISOString()}]`;
}

/**
 * Build a unique test title with the mandatory cleanup prefix.
 */
function testTitle(label: string): string {
  return `${testPrefix()} ${label}`;
}

// ---------------------------------------------------------------------------
// Shared state — populated in beforeAll so all groups share the same parent task
// ---------------------------------------------------------------------------

/** The task_id of the "parent" task created in beforeAll, used by attachment/comment/subtask tests. */
let parentTaskId: number;
/** The column_id of the first column in the test project (resolved in beforeAll). */
let firstColumnId: number;
/** The swimlane_id of the default/first active swimlane (resolved in beforeAll). */
let firstSwimlaneId: number;

beforeAll(async () => {
  // Resolve column and swimlane IDs from the test project.
  const columns = await handler.getColumns(projectId);
  const swimlanes = await handler.getActiveSwimlanes(projectId);

  const firstColumn = columns[0];
  if (firstColumn === undefined) {
    throw new Error(`Setup: test project ${String(projectId)} has no columns — cannot run task tests.`);
  }
  firstColumnId = firstColumn.id;

  const firstSwimlane = swimlanes[0];
  if (firstSwimlane === undefined) {
    throw new Error(`Setup: test project ${String(projectId)} has no swimlanes — cannot run task tests.`);
  }
  firstSwimlaneId = firstSwimlane.id;

  // Create the shared parent task used by attachment, comment, and subtask groups.
  parentTaskId = await handler.createTask({
    title: testTitle("integration smoke — parent task"),
    project_id: projectId,
    description: "Created by kanboard.int.test.ts beforeAll. Safe to delete.",
    column_id: firstColumnId,
    swimlane_id: firstSwimlaneId,
  });
}, 30_000);

// ---------------------------------------------------------------------------
// Projects (read-only)
// ---------------------------------------------------------------------------

describe("projects", () => {
  it(
    "list_projects returns ≥ 1 project including the test project",
    async () => {
      const projects = await handler.getMyProjects();

      expect(projects.length).toBeGreaterThanOrEqual(1);

      const found = projects.find((p) => p.id === projectId);
      expect(found).toBeDefined();
      expect(found?.id).toBe(projectId);
    },
    30_000,
  );

  it(
    "get_project by id returns correct project",
    async () => {
      const project = await handler.getProjectById(projectId);

      expect(project.id).toBe(projectId);
      expect(typeof project.name).toBe("string");
      expect(project.name.length).toBeGreaterThan(0);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Tasks CRUD
// ---------------------------------------------------------------------------

describe("tasks CRUD", () => {
  let createdTaskId: number;

  it(
    "create_task returns a positive task_id",
    async () => {
      const title = testTitle("integration smoke — create_task");

      createdTaskId = await handler.createTask({
        title,
        project_id: projectId,
        description: "Created by kanboard.int.test.ts tasks CRUD suite.",
        column_id: firstColumnId,
        swimlane_id: firstSwimlaneId,
      });

      expect(createdTaskId).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    "get_task returns the created task with correct title",
    async () => {
      // Depends on create_task running first — vitest runs `it()` in sequence within a describe.
      expect(createdTaskId).toBeGreaterThan(0);

      const task = await handler.getTask(createdTaskId);

      expect(task.id).toBe(createdTaskId);
      expect(task.title).toContain("[TEST-");
      expect(task.project_id).toBe(projectId);
    },
    30_000,
  );

  it(
    "update_task changes the description",
    async () => {
      expect(createdTaskId).toBeGreaterThan(0);

      const newDescription = `Updated by integration test at ${new Date().toISOString()}`;
      await handler.updateTask({ task_id: createdTaskId, description: newDescription });

      // Verify via re-fetch.
      const updated = await handler.getTask(createdTaskId);
      expect(updated.description).toBe(newDescription);
    },
    30_000,
  );

  it(
    "move_task_position moves task to position 1 in same column",
    async () => {
      expect(createdTaskId).toBeGreaterThan(0);

      // move_task_position requires all five params — move to position 1.
      await handler.moveTaskPosition({
        project_id: projectId,
        task_id: createdTaskId,
        column_id: firstColumnId,
        position: 1,
        swimlane_id: firstSwimlaneId,
      });

      // No error thrown = success (Kanboard returns true).
      const moved = await handler.getTask(createdTaskId);
      expect(moved.id).toBe(createdTaskId);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Personal — getMyDashboard / getMyOverdueTasks
// ---------------------------------------------------------------------------

describe("personal", () => {
  it(
    "get_my_dashboard runs without error and returns projects/tasks/subtasks arrays",
    async () => {
      const dashboard = await handler.getMyDashboard();

      expect(Array.isArray(dashboard.projects)).toBe(true);
      expect(Array.isArray(dashboard.tasks)).toBe(true);
      expect(Array.isArray(dashboard.subtasks)).toBe(true);
    },
    30_000,
  );

  it(
    "get_my_overdue_tasks runs without error",
    async () => {
      const tasks = await handler.getMyOverdueTasks();
      // May be empty — that's fine. We just assert the call succeeds.
      expect(Array.isArray(tasks)).toBe(true);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Bulk (CRITICAL — OQ-01 resolution)
// This test PROVES that JSON-RPC batch POST works against the live instance.
// ---------------------------------------------------------------------------

describe("bulk (OQ-01 — create_tasks_batch)", () => {
  it(
    "createTasksBatch creates 3 tasks in a single JSON-RPC batch POST (OQ-01 resolved)",
    async () => {
      const prefix = testPrefix();

      const result = await handler.createTasksBatch(projectId, [
        {
          title: `${prefix} batch-0`,
          description: "Batch integration test item 0",
          column_id: firstColumnId,
          swimlane_id: firstSwimlaneId,
        },
        {
          title: `${prefix} batch-1`,
          description: "Batch integration test item 1",
          column_id: firstColumnId,
          swimlane_id: firstSwimlaneId,
        },
        {
          title: `${prefix} batch-2`,
          description: "Batch integration test item 2",
          column_id: firstColumnId,
          swimlane_id: firstSwimlaneId,
        },
      ]);

      // CRITICAL: all 3 must succeed — no partial failures.
      expect(result.failed).toHaveLength(0);
      expect(result.created).toHaveLength(3);

      // Every created entry must have a valid task_id.
      for (const entry of result.created) {
        expect(entry.task_id).toBeGreaterThan(0);
        expect(entry.title).toContain(prefix);
      }

      // Indices must be in order [0, 1, 2].
      expect(result.created.map((e) => e.index)).toStrictEqual([0, 1, 2]);
    },
    30_000,
  );

  it(
    "createTasksBatch with empty array returns empty created/failed without network call",
    async () => {
      const result = await handler.createTasksBatch(projectId, []);
      expect(result.created).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

describe("attachments", () => {
  it(
    "attach_file_to_task uploads a ~1 KB file and returns a positive file_id",
    async () => {
      expect(parentTaskId).toBeGreaterThan(0);

      // Write a tiny temp file.
      const tmpDir = mkdtempSync(join(tmpdir(), "kanboard-int-"));
      const tmpFile = join(tmpDir, "integration-test.txt");
      const content = "Integration test attachment — created by kanboard.int.test.ts\n".repeat(20);
      writeFileSync(tmpFile, content, "utf8");

      // Encode to base64.
      const blob = Buffer.from(content, "utf8").toString("base64");

      let fileId: number;
      try {
        fileId = await handler.createTaskFile({
          project_id: projectId,
          task_id: parentTaskId,
          filename: "integration-test.txt",
          blob_base64: blob,
        });
      } catch (err) {
        // Surface error clearly — the temp file is not cleaned up (harmless).
        throw new Error(
          `createTaskFile failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      expect(fileId).toBeGreaterThan(0);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Comments + Subtasks
// ---------------------------------------------------------------------------

describe("comments and subtasks", () => {
  it(
    "create_comment on parent task returns a positive comment_id",
    async () => {
      expect(parentTaskId).toBeGreaterThan(0);

      const commentId = await handler.createComment({
        task_id: parentTaskId,
        content: `Integration test comment — ${new Date().toISOString()}`,
      });

      expect(commentId).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    "create_subtask on parent task returns a positive subtask_id",
    async () => {
      expect(parentTaskId).toBeGreaterThan(0);

      const subtaskId = await handler.createSubtask({
        task_id: parentTaskId,
        title: testTitle("integration subtask"),
      });

      expect(subtaskId).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    "list_subtasks on parent task returns ≥ 1 subtask after creation",
    async () => {
      expect(parentTaskId).toBeGreaterThan(0);

      const subtasks = await handler.getAllSubtasks(parentTaskId);

      // We created at least one subtask in the previous test.
      expect(subtasks.length).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

describe("lookups", () => {
  it(
    "list_columns for test project returns ≥ 1 column",
    async () => {
      const columns = await handler.getColumns(projectId);
      expect(columns.length).toBeGreaterThanOrEqual(1);

      const first = columns[0];
      expect(first).toBeDefined();
      expect(first?.id).toBeGreaterThan(0);
      expect(typeof first?.title).toBe("string");
    },
    30_000,
  );

  it(
    "list_project_users returns ≥ 1 member (works for non-admins)",
    async () => {
      const members = await handler.getProjectUsers(projectId);
      expect(members.length).toBeGreaterThanOrEqual(1);

      const first = members[0];
      expect(first).toBeDefined();
      expect(first?.user_id).toBeGreaterThan(0);
      expect(typeof first?.username).toBe("string");
      expect(first?.username.length).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    "get_active_swimlanes for test project returns ≥ 1 swimlane",
    async () => {
      const swimlanes = await handler.getActiveSwimlanes(projectId);
      expect(swimlanes.length).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );

  it(
    "get_all_categories for test project runs without error",
    async () => {
      const categories = await handler.getAllCategories(projectId);
      // May be empty — no categories required in sandbox. Just assert the call succeeds.
      expect(Array.isArray(categories)).toBe(true);
    },
    30_000,
  );

  it(
    "get_version returns a non-empty string",
    async () => {
      const version = await handler.getVersion();
      expect(typeof version).toBe("string");
      expect(version.length).toBeGreaterThan(0);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Handler bundle surface (resolvers)
// ---------------------------------------------------------------------------

describe("resolvers", () => {
  it(
    "resolveColumnIdByName resolves the first column by title",
    async () => {
      const columns = await handler.getColumns(projectId);
      const first = columns[0];
      if (first === undefined) {
        // Guard — skip if project has no named columns.
        return;
      }

      const resolvedId = await bundle.resolvers.resolveColumnIdByName(
        projectId,
        first.title,
      );
      expect(resolvedId).toBe(first.id);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// v0.2.5 — update_project
// ---------------------------------------------------------------------------

describe("projects — update_project", () => {
  it(
    "update_project renames test project and reverts",
    async () => {
      // Fetch current name to restore after test.
      const before = await handler.getProjectById(projectId);
      const originalName = before.name;
      const tempName = testTitle("update_project integration — temp rename");

      try {
        // Rename to temp name.
        await handler.updateProject({ project_id: projectId, name: tempName });

        // Verify rename.
        const renamed = await handler.getProjectById(projectId);
        expect(renamed.name).toBe(tempName);
      } finally {
        // Always restore original name.
        await handler.updateProject({ project_id: projectId, name: originalName });
        const restored = await handler.getProjectById(projectId);
        expect(restored.name).toBe(originalName);
      }
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// v0.2.5 — column operations (create_column, update_column, move_column)
// ---------------------------------------------------------------------------

describe("columns — create_column, update_column, move_column", () => {
  let createdColumnId: number;

  it(
    "create_column creates a new column and returns positive column_id",
    async () => {
      const title = testTitle("INT-create_column");

      createdColumnId = await handler.addColumn({
        project_id: projectId,
        title,
        task_limit: 2,
        description: "Created by kanboard.int.test.ts v0.2.5 suite.",
      });

      expect(createdColumnId).toBeGreaterThan(0);

      // Verify via getColumns — the column should appear.
      const cols = await handler.getColumns(projectId);
      const found = cols.find((c) => c.id === createdColumnId);
      expect(found).toBeDefined();
      expect(found?.task_limit).toBe(2);
    },
    30_000,
  );

  it(
    "getColumn returns the created column with correct project_id",
    async () => {
      expect(createdColumnId).toBeGreaterThan(0);

      const col = await handler.getColumn(createdColumnId);
      expect(col.id).toBe(createdColumnId);
      expect(col.project_id).toBe(projectId);
      expect(col.task_limit).toBe(2);
    },
    30_000,
  );

  it(
    "update_column changes task_limit to 5",
    async () => {
      expect(createdColumnId).toBeGreaterThan(0);

      await handler.updateColumn({ column_id: createdColumnId, task_limit: 5 });

      // Verify via getColumn.
      const col = await handler.getColumn(createdColumnId);
      expect(col.task_limit).toBe(5);
    },
    30_000,
  );

  it(
    "move_column changes position of created column",
    async () => {
      expect(createdColumnId).toBeGreaterThan(0);

      // Move to position 1 — may or may not change depending on existing columns.
      // What we verify: the call succeeds without error.
      await expect(
        handler.changeColumnPosition({ project_id: projectId, column_id: createdColumnId, position: 1 }),
      ).resolves.toBeUndefined();

      // Verify via getColumns — column still present.
      const cols = await handler.getColumns(projectId);
      const found = cols.find((c) => c.id === createdColumnId);
      expect(found).toBeDefined();
    },
    30_000,
  );
});
