import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";

import { buildApp } from "../../src/app";
import {
  createMockTranscriptionProvider,
  createMockLLMProvider,
  createAlwaysFailingTranscriptionProvider,
  MOCK_REPORT,
  MOCK_TRANSCRIPT,
} from "../helpers/mocks";

vi.mock("../../src/utils/ffprobe", () => ({
  getAudioDuration: vi.fn().mockResolvedValue(60),
}));

const TEST_DB_URL   = "file:./prisma/test-retry.db";
const TEST_UPLOADS  = path.join(process.cwd(), "test-retry-uploads");

let app: FastifyInstance;
let prisma: PrismaClient;

async function register(email: string): Promise<string> {
  const r = await app.inject({
    method: "POST", url: "/auth/register",
    payload: { email, password: "password123" },
  });
  return r.json<{ token: string }>().token;
}

async function makeErrorJob(userId: string, withFile = true): Promise<string> {
  if (withFile && !fs.existsSync(TEST_UPLOADS)) fs.mkdirSync(TEST_UPLOADS, { recursive: true });
  const filePath = withFile
    ? path.join(TEST_UPLOADS, `fake-${Date.now()}.mp3`)
    : "/tmp/does-not-exist-ever.mp3";
  if (withFile) fs.writeFileSync(filePath, Buffer.from("fake audio"));

  const j = await prisma.job.create({
    data: {
      userId,
      status:       "error",
      filePath,
      originalName: "test.mp3",
      durationSeconds: 60,
      errorMessage: "TRANSCRIPTION_FAILED: 503",
    },
  });
  return j.id;
}

describe("POST /jobs/:id/retry", () => {
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    await prisma.$connect();
    if (!fs.existsSync(TEST_UPLOADS)) fs.mkdirSync(TEST_UPLOADS, { recursive: true });

    // Use succeeding providers by default
    app = await buildApp({
      prisma,
      transcriptionProvider: createMockTranscriptionProvider(),
      llmProvider: createMockLLMProvider(),
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.job.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
    fs.rmSync(TEST_UPLOADS, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.job.deleteMany();
    await prisma.user.deleteMany();
  });

  // ── 1. Happy path ──────────────────────────────────────────────────────
  it("повторяет упавший job и приводит к done", async () => {
    const token = await register("retry-ok@example.com");
    const user  = await prisma.user.findUnique({ where: { email: "retry-ok@example.com" } });
    const jobId = await makeErrorJob(user!.id);

    const res = await app.inject({
      method: "POST", url: `/jobs/${jobId}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json<{ jobId: string }>().jobId).toBe(jobId);

    // Wait for pipeline
    await new Promise(r => setTimeout(r, 300));

    const updated = await prisma.job.findUnique({ where: { id: jobId } });
    expect(updated?.status).toBe("done");
    expect(updated?.transcript).toBe(MOCK_TRANSCRIPT);
    expect(updated?.errorMessage).toBeNull();
  });

  // ── 2. Requires auth ──────────────────────────────────────────────────
  it("возвращает 401 без токена", async () => {
    const res = await app.inject({ method: "POST", url: "/jobs/any-id/retry" });
    expect(res.statusCode).toBe(401);
  });

  // ── 3. User isolation ─────────────────────────────────────────────────
  it("пользователь B не может ретраить job пользователя A", async () => {
    const tokenA = await register("rA@example.com");
    const tokenB = await register("rB@example.com");
    const userA  = await prisma.user.findUnique({ where: { email: "rA@example.com" } });
    const jobId  = await makeErrorJob(userA!.id);

    const res = await app.inject({
      method: "POST", url: `/jobs/${jobId}/retry`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
  });

  // ── 4. Non-existent job ───────────────────────────────────────────────
  it("возвращает 404 для несуществующего job", async () => {
    const token = await register("r404@example.com");
    const res = await app.inject({
      method: "POST", url: "/jobs/nonexistent-id/retry",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── 5. Cannot retry non-error job ────────────────────────────────────
  it("нельзя ретраить job не в статусе error", async () => {
    const token = await register("rstatus@example.com");
    const user  = await prisma.user.findUnique({ where: { email: "rstatus@example.com" } });

    const doneJob = await prisma.job.create({
      data: { userId: user!.id, status: "done", filePath: "/tmp/x.mp3", originalName: "x.mp3", durationSeconds: 30 },
    });

    const res = await app.inject({
      method: "POST", url: `/jobs/${doneJob.id}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_STATE");
  });

  // ── 6. File missing on disk ───────────────────────────────────────────
  it("возвращает 410 если файл удалён с диска", async () => {
    const token = await register("rfile@example.com");
    const user  = await prisma.user.findUnique({ where: { email: "rfile@example.com" } });
    const jobId = await makeErrorJob(user!.id, false); // filePath points to non-existent file

    const res = await app.inject({
      method: "POST", url: `/jobs/${jobId}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toBe("FILE_MISSING");
  });

  // ── 7. Clears error state before re-running ───────────────────────────
  it("очищает errorMessage и transcript перед повтором", async () => {
    const token = await register("rclean@example.com");
    const user  = await prisma.user.findUnique({ where: { email: "rclean@example.com" } });

    const filePath = path.join(TEST_UPLOADS, `clean-${Date.now()}.mp3`);
    fs.writeFileSync(filePath, Buffer.from("audio"));

    const job = await prisma.job.create({
      data: {
        userId: user!.id, status: "error",
        filePath, originalName: "clean.mp3", durationSeconds: 30,
        errorMessage: "old error", transcript: "old transcript",
      },
    });

    await app.inject({
      method: "POST", url: `/jobs/${job.id}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });

    // Immediately after retry call, status should be processing (error cleared)
    const mid = await prisma.job.findUnique({ where: { id: job.id } });
    expect(mid?.status).toBe("processing");
    expect(mid?.errorMessage).toBeNull();
    expect(mid?.transcript).toBeNull();
  });
});
