/**
 * Unit tests for src/tools/attach-file-to-task.ts
 *
 * FR-15:
 * - Accepts exactly one of file_path XOR content_base64.
 * - project_id resolved from getTask(task_id) — NOT from resolveProjectContext.
 * - File size (decoded) ≤ 5 MB enforced BEFORE any HTTP call.
 *
 * Strategy:
 * - Real temp files (mkdtempSync + writeFileSync) — avoids ESM mock-fs issues.
 * - handler.getTask mocked to return a task with project_id=12.
 * - handler.createTaskFile mocked for upload.
 *
 * Cases covered:
 * - Happy path: file_path → getTask called, project_id from task, upload succeeds.
 * - Happy path: content_base64 → decoded size check, upload succeeds.
 * - Explicit filename used as-is.
 * - File not found → ConfigError (before any handler call).
 * - File > 5 MB via file_path → ValidationError BEFORE any handler call (S4, FR-15).
 * - content_base64 decoded size > 5 MB → ValidationError BEFORE upload call.
 * - Both file_path AND content_base64 → ValidationError (Zod refine).
 * - Neither file_path NOR content_base64 → ValidationError (Zod refine).
 * - project_id auto-resolved from getTask (not from resolveProjectContext).
 * - base64 encoding is correct for file_path path.
 * - Handler error propagation.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { attachFileToTaskTool } from "../../../src/tools/attach-file-to-task.js";
import { ConfigError, KanboardApiError, ValidationError, NotFoundError } from "../../../src/shared/errors.js";
import { FILE_SIZE_CAP_BYTES } from "../../../src/shared/constants.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";
import type { Task } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_TASK: Task = {
  id: 5,
  project_id: 12,
  title: "Target task",
  description: "",
  status: true,
  column_id: 1,
  swimlane_id: 1,
  owner_id: 3,
  creator_id: 3,
  category_id: null,
  color_id: "blue",
  position: 1,
  priority: 0,
  score: 0,
  reference: "",
  tags: [],
  date_creation: "2026-04-01T00:00:00.000Z",
  date_modification: "2026-04-27T00:00:00.000Z",
  date_due: null,
  date_started: null,
  date_moved: null,
  date_completed: null,
  url: "https://pm.example.com/?task_id=5",
};

// ---------------------------------------------------------------------------
// Temp file helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "attach-test-"));
  tempDirs.push(d);
  return d;
}

function writeTempFile(dir: string, name: string, content: Buffer | string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, content);
  return filePath;
}

// ---------------------------------------------------------------------------
// Mock builder
// ---------------------------------------------------------------------------

function buildMockDeps(overrides?: {
  file_id?: number | "api-error";
  task?: Task | "not-found";
}): {
  handler: KanboardHandler;
  resolvers: Resolvers;
  createTaskFileMock: ReturnType<typeof vi.fn>;
  getTaskMock: ReturnType<typeof vi.fn>;
} {
  const createTaskFileMock = vi.fn<KanboardHandler["createTaskFile"]>();
  const getTaskMock = vi.fn<KanboardHandler["getTask"]>();

  if (overrides?.file_id === "api-error") {
    createTaskFileMock.mockRejectedValue(
      new KanboardApiError(
        "createTaskFile",
        "createTaskFile failed (Kanboard returned false — pre-validate inputs)",
      ),
    );
  } else {
    createTaskFileMock.mockResolvedValue(overrides?.file_id ?? 99);
  }

  if (overrides?.task === "not-found") {
    getTaskMock.mockRejectedValue(
      new NotFoundError("getTask", "getTask: entity not found"),
    );
  } else {
    getTaskMock.mockResolvedValue(overrides?.task ?? FAKE_TASK);
  }

  const handler = {
    createTaskFile: createTaskFileMock,
    getTask: getTaskMock,
  } as unknown as KanboardHandler;

  const resolvers = {} as unknown as Resolvers;

  return { handler, resolvers, createTaskFileMock, getTaskMock };
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests — file_path happy path
// ---------------------------------------------------------------------------

describe("attach_file_to_task — file_path happy path", () => {
  it("uploads file successfully and returns file_id", async () => {
    const dir = tmpDir();
    const filePath = writeTempFile(dir, "report.pdf", Buffer.from("PDF content here"));
    const { handler, resolvers, createTaskFileMock } = buildMockDeps({ file_id: 99 });

    const result = await attachFileToTaskTool.handler(
      { task_id: 5, filename: "report.pdf", file_path: filePath },
      { handler, resolvers },
    );

    expect(result.structuredContent).toEqual({ file_id: 99 });
    expect(createTaskFileMock).toHaveBeenCalledOnce();
  });

  it("uses filename field as-is (not basename from file_path)", async () => {
    const dir = tmpDir();
    const filePath = writeTempFile(dir, "abc123.bin", Buffer.from("binary content"));
    const { handler, resolvers, createTaskFileMock } = buildMockDeps({ file_id: 20 });

    await attachFileToTaskTool.handler(
      { task_id: 5, filename: "my-report.pdf", file_path: filePath },
      { handler, resolvers },
    );

    expect(createTaskFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "my-report.pdf" }),
    );
  });

  it("passes base64-encoded content to createTaskFile", async () => {
    const dir = tmpDir();
    const content = Buffer.from("Hello, Kanboard!");
    const filePath = writeTempFile(dir, "hello.txt", content);
    const { handler, resolvers, createTaskFileMock } = buildMockDeps({ file_id: 1 });

    await attachFileToTaskTool.handler(
      { task_id: 5, filename: "hello.txt", file_path: filePath },
      { handler, resolvers },
    );

    expect(createTaskFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ blob_base64: content.toString("base64") }),
    );
  });

  it("accepts a file exactly at the 5 MB limit (boundary condition)", async () => {
    const dir = tmpDir();
    const exactContent = Buffer.alloc(FILE_SIZE_CAP_BYTES, 0x43);
    const filePath = writeTempFile(dir, "exact-limit.bin", exactContent);
    const { handler, resolvers, createTaskFileMock } = buildMockDeps({ file_id: 50 });

    const result = await attachFileToTaskTool.handler(
      { task_id: 5, filename: "exact-limit.bin", file_path: filePath },
      { handler, resolvers },
    );

    expect(result.structuredContent).toEqual({ file_id: 50 });
    expect(createTaskFileMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tests — content_base64 happy path
// ---------------------------------------------------------------------------

describe("attach_file_to_task — content_base64 happy path", () => {
  it("uploads via content_base64 successfully and returns file_id", async () => {
    const content = Buffer.from("Hello from base64!");
    const base64 = content.toString("base64");
    const { handler, resolvers, createTaskFileMock } = buildMockDeps({ file_id: 77 });

    const result = await attachFileToTaskTool.handler(
      { task_id: 5, filename: "hello.txt", content_base64: base64 },
      { handler, resolvers },
    );

    expect(result.structuredContent).toEqual({ file_id: 77 });
    expect(createTaskFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ blob_base64: base64, filename: "hello.txt" }),
    );
  });

  it("passes content_base64 directly to createTaskFile without re-encoding", async () => {
    const content = Buffer.from("Direct base64 upload");
    const base64 = content.toString("base64");
    const { handler, resolvers, createTaskFileMock } = buildMockDeps({ file_id: 88 });

    await attachFileToTaskTool.handler(
      { task_id: 5, filename: "doc.txt", content_base64: base64 },
      { handler, resolvers },
    );

    expect(createTaskFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ blob_base64: base64 }),
    );
  });

  it("accepts content_base64 exactly at the 5 MB decoded limit", async () => {
    const exactContent = Buffer.alloc(FILE_SIZE_CAP_BYTES, 0x41);
    const base64 = exactContent.toString("base64");
    const { handler, resolvers, createTaskFileMock } = buildMockDeps({ file_id: 55 });

    const result = await attachFileToTaskTool.handler(
      { task_id: 5, filename: "limit.bin", content_base64: base64 },
      { handler, resolvers },
    );

    expect(result.structuredContent).toEqual({ file_id: 55 });
    expect(createTaskFileMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tests — project_id auto-resolved from getTask
// ---------------------------------------------------------------------------

describe("attach_file_to_task — project_id resolved from getTask (FR-15)", () => {
  it("calls getTask(task_id) to get project_id", async () => {
    const dir = tmpDir();
    const filePath = writeTempFile(dir, "file.txt", "content");
    const { handler, resolvers, getTaskMock } = buildMockDeps();

    await attachFileToTaskTool.handler(
      { task_id: 5, filename: "file.txt", file_path: filePath },
      { handler, resolvers },
    );

    expect(getTaskMock).toHaveBeenCalledOnce();
    expect(getTaskMock).toHaveBeenCalledWith(5);
  });

  it("passes task.project_id to createTaskFile (not from explicit arg)", async () => {
    const dir = tmpDir();
    const filePath = writeTempFile(dir, "file.txt", "content");
    const taskWithProject99 = { ...FAKE_TASK, project_id: 99 };
    const { handler, resolvers, createTaskFileMock } = buildMockDeps({ task: taskWithProject99 });

    await attachFileToTaskTool.handler(
      { task_id: 5, filename: "file.txt", file_path: filePath },
      { handler, resolvers },
    );

    expect(createTaskFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 99 }),
    );
  });

  it("resolves project_id from getTask when using content_base64", async () => {
    const base64 = Buffer.from("test content").toString("base64");
    const taskWithProject42 = { ...FAKE_TASK, project_id: 42 };
    const { handler, resolvers, createTaskFileMock } = buildMockDeps({ task: taskWithProject42 });

    await attachFileToTaskTool.handler(
      { task_id: 5, filename: "file.txt", content_base64: base64 },
      { handler, resolvers },
    );

    expect(createTaskFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 42 }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — file_path errors
// ---------------------------------------------------------------------------

describe("attach_file_to_task — file_path errors", () => {
  it("throws ConfigError when file_path does not exist", async () => {
    const { handler, resolvers, createTaskFileMock } = buildMockDeps();

    await expect(
      attachFileToTaskTool.handler(
        { task_id: 5, filename: "missing.pdf", file_path: "/nonexistent/path/to/file.pdf" },
        { handler, resolvers },
      ),
    ).rejects.toBeInstanceOf(ConfigError);

    expect(createTaskFileMock).not.toHaveBeenCalled();
  });

  it("throws ValidationError when file_path file exceeds 5 MB cap — handler NOT called (S4)", async () => {
    const dir = tmpDir();
    const oversizedContent = Buffer.alloc(FILE_SIZE_CAP_BYTES + 1, 0x41);
    const filePath = writeTempFile(dir, "big-file.bin", oversizedContent);
    const { handler, resolvers, createTaskFileMock } = buildMockDeps();

    await expect(
      attachFileToTaskTool.handler(
        { task_id: 5, filename: "big-file.bin", file_path: filePath },
        { handler, resolvers },
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(createTaskFileMock).not.toHaveBeenCalled();
  });

  it("ValidationError for oversized file_path includes actual size and 5 MB limit", async () => {
    const dir = tmpDir();
    const oversizedContent = Buffer.alloc(FILE_SIZE_CAP_BYTES + 100, 0x42);
    const filePath = writeTempFile(dir, "oversized.bin", oversizedContent);
    const { handler, resolvers } = buildMockDeps();

    let caughtError: unknown;
    try {
      await attachFileToTaskTool.handler(
        { task_id: 5, filename: "oversized.bin", file_path: filePath },
        { handler, resolvers },
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ValidationError);
    if (caughtError instanceof ValidationError) {
      expect(caughtError.message).toContain(String(FILE_SIZE_CAP_BYTES + 100));
      expect(caughtError.message).toContain(String(FILE_SIZE_CAP_BYTES));
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — content_base64 size errors
// ---------------------------------------------------------------------------

describe("attach_file_to_task — content_base64 size errors", () => {
  it("throws ValidationError when content_base64 decodes to > 5 MB", async () => {
    const oversizedContent = Buffer.alloc(FILE_SIZE_CAP_BYTES + 1, 0x41);
    const base64 = oversizedContent.toString("base64");
    const { handler, resolvers, createTaskFileMock } = buildMockDeps();

    await expect(
      attachFileToTaskTool.handler(
        { task_id: 5, filename: "big.bin", content_base64: base64 },
        { handler, resolvers },
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    // createTaskFile MUST NOT be called
    expect(createTaskFileMock).not.toHaveBeenCalled();
  });

  it("ValidationError for oversized content_base64 includes actual size and limit", async () => {
    const oversized = Buffer.alloc(FILE_SIZE_CAP_BYTES + 500, 0x43);
    const base64 = oversized.toString("base64");
    const { handler, resolvers } = buildMockDeps();

    let caughtError: unknown;
    try {
      await attachFileToTaskTool.handler(
        { task_id: 5, filename: "big.bin", content_base64: base64 },
        { handler, resolvers },
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ValidationError);
    if (caughtError instanceof ValidationError) {
      expect(caughtError.message).toContain(String(FILE_SIZE_CAP_BYTES + 500));
      expect(caughtError.message).toContain(String(FILE_SIZE_CAP_BYTES));
    }
  });

  it("throws ValidationError BEFORE calling createTaskFile for oversized base64", async () => {
    const oversized = Buffer.alloc(FILE_SIZE_CAP_BYTES + 1, 0x44);
    const base64 = oversized.toString("base64");
    const { handler, resolvers, createTaskFileMock } = buildMockDeps();

    await expect(
      attachFileToTaskTool.handler(
        { task_id: 5, filename: "big.bin", content_base64: base64 },
        { handler, resolvers },
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(createTaskFileMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Zod refine: XOR file_path / content_base64
// ---------------------------------------------------------------------------

describe("attach_file_to_task — Zod refine XOR validation", () => {
  it("throws ZodError when both file_path AND content_base64 are provided", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      attachFileToTaskTool.handler(
        {
          task_id: 5,
          filename: "file.txt",
          file_path: "/some/path.txt",
          content_base64: "aGVsbG8=",
        },
        { handler, resolvers },
      ),
    ).rejects.toThrow();
  });

  it("throws ZodError when neither file_path NOR content_base64 is provided", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      attachFileToTaskTool.handler(
        { task_id: 5, filename: "file.txt" },
        { handler, resolvers },
      ),
    ).rejects.toThrow();
  });

  it("throws ZodError when task_id is missing", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      attachFileToTaskTool.handler(
        { filename: "file.txt", file_path: "/some/path.txt" },
        { handler, resolvers },
      ),
    ).rejects.toThrow();
  });

  it("throws ZodError when filename is missing", async () => {
    const { handler, resolvers } = buildMockDeps();

    await expect(
      attachFileToTaskTool.handler(
        { task_id: 5, file_path: "/some/path.txt" },
        { handler, resolvers },
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests — handler error propagation
// ---------------------------------------------------------------------------

describe("attach_file_to_task — handler error propagation", () => {
  it("propagates KanboardApiError from handler.createTaskFile (file_path path)", async () => {
    const dir = tmpDir();
    const filePath = writeTempFile(dir, "valid.txt", "content");
    const { handler, resolvers } = buildMockDeps({ file_id: "api-error" });

    await expect(
      attachFileToTaskTool.handler(
        { task_id: 5, filename: "valid.txt", file_path: filePath },
        { handler, resolvers },
      ),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });

  it("propagates KanboardApiError from handler.createTaskFile (content_base64 path)", async () => {
    const base64 = Buffer.from("test").toString("base64");
    const { handler, resolvers } = buildMockDeps({ file_id: "api-error" });

    await expect(
      attachFileToTaskTool.handler(
        { task_id: 5, filename: "test.txt", content_base64: base64 },
        { handler, resolvers },
      ),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});
