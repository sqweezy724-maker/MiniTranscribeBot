import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import FormData from "form-data";

import { buildApp } from "../../src/app";
import { createMockTranscriptionProvider, createMockLLMProvider } from "../helpers/mocks";

vi.mock("../../src/utils/ffprobe", () => ({
  getAudioDuration: vi.fn().mockResolvedValue(60),
}));

const TEST_DB_URL = "file:./prisma/test-list-jobs.db";

let app: FastifyInstance;
let prisma: PrismaClient;

async function register(email: string): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/auth/register",
    payload: { email, password: "password123" },
  });
  return res.json<{ token: string }>().token;
}

async function upload(token: string): Promise<string> {
  const form = new FormData();
  form.append("audio", Buffer.from("fake audio"), { filename: "test.mp3", contentType: "audio/mpeg" });
  const res = await app.inject({
    method: "POST", url: "/jobs",
    headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
    payload: form.getBuffer(),
  });
  return res.json<{ jobId: string }>().jobId;
}

describe("GET /jobs — список джобов", () => {
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    await prisma.$connect();
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
  });

  beforeEach(async () => {
    await prisma.job.deleteMany();
    await prisma.user.deleteMany();
  });

  // ── 1. Требует авторизацию ──────────────────────────────────────────────
  it("возвращает 401 без токена", async () => {
    const res = await app.inject({ method: "GET", url: "/jobs" });
    expect(res.statusCode).toBe(401);
  });

  // ── 2. Пустой список для нового пользователя ────────────────────────────
  it("возвращает пустой список для нового пользователя", async () => {
    const token = await register("empty@example.com");
    const res = await app.inject({
      method: "GET", url: "/jobs",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ jobs: unknown[]; total: number }>();
    expect(body.jobs).toEqual([]);
    expect(body.total).toBe(0);
  });

  // ── 3. Список содержит загруженные джобы ───────────────────────────────
  it("возвращает джобы пользователя", async () => {
    const token = await register("hasjobs@example.com");
    await upload(token);
    await upload(token);

    const res = await app.inject({
      method: "GET", url: "/jobs",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ jobs: unknown[]; total: number }>();
    expect(body.total).toBe(2);
    expect(body.jobs).toHaveLength(2);
  });

  // ── 4. Изоляция — чужие джобы не видны ─────────────────────────────────
  it("не возвращает джобы другого пользователя", async () => {
    const tokenA = await register("isolA@example.com");
    const tokenB = await register("isolB@example.com");
    await upload(tokenA);
    await upload(tokenA);

    const res = await app.inject({
      method: "GET", url: "/jobs",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    const body = res.json<{ jobs: unknown[]; total: number }>();
    expect(body.total).toBe(0);
    expect(body.jobs).toHaveLength(0);
  });

  // ── 5. Пагинация limit/offset ───────────────────────────────────────────
  it("корректно применяет limit и offset", async () => {
    const token = await register("paged@example.com");
    await upload(token);
    await upload(token);
    await upload(token);

    const page1 = await app.inject({
      method: "GET", url: "/jobs?limit=2&offset=0",
      headers: { authorization: `Bearer ${token}` },
    });
    const page2 = await app.inject({
      method: "GET", url: "/jobs?limit=2&offset=2",
      headers: { authorization: `Bearer ${token}` },
    });

    const b1 = page1.json<{ jobs: {id:string}[]; total: number }>();
    const b2 = page2.json<{ jobs: {id:string}[]; total: number }>();

    expect(b1.total).toBe(3);
    expect(b1.jobs).toHaveLength(2);
    expect(b2.jobs).toHaveLength(1);

    // id на двух страницах не пересекаются
    const ids1 = b1.jobs.map(j => j.id);
    const ids2 = b2.jobs.map(j => j.id);
    expect(ids1.some(id => ids2.includes(id))).toBe(false);
  });

  // ── 6. Фильтр по статусу ────────────────────────────────────────────────
  it("фильтрует по статусу", async () => {
    const token = await register("filtered@example.com");
    const user = await prisma.user.findUnique({ where: { email: "filtered@example.com" } });

    // создаём по одному джобу каждого статуса напрямую через Prisma
    await prisma.job.create({
      data: { userId: user!.id, status: "processing", filePath: "/tmp/a.mp3", originalName: "a.mp3", durationSeconds: 30 },
    });
    await prisma.job.create({
      data: { userId: user!.id, status: "done", filePath: "/tmp/b.mp3", originalName: "b.mp3", durationSeconds: 30 },
    });
    await prisma.job.create({
      data: { userId: user!.id, status: "error", filePath: "/tmp/c.mp3", originalName: "c.mp3", durationSeconds: 30 },
    });

    const processingRes = await app.inject({
      method: "GET", url: "/jobs?status=processing",
      headers: { authorization: `Bearer ${token}` },
    });
    const doneRes = await app.inject({
      method: "GET", url: "/jobs?status=done",
      headers: { authorization: `Bearer ${token}` },
    });
    const errorRes = await app.inject({
      method: "GET", url: "/jobs?status=error",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(processingRes.json<{jobs:unknown[]}>().jobs).toHaveLength(1);
    expect(doneRes.json<{jobs:unknown[]}>().jobs).toHaveLength(1);
    expect(errorRes.json<{jobs:unknown[]}>().jobs).toHaveLength(1);
  });

  // ── 7. Структура элемента списка ────────────────────────────────────────
  it("каждый элемент списка имеет нужные поля", async () => {
    const token = await register("fields@example.com");
    await upload(token);

    const res = await app.inject({
      method: "GET", url: "/jobs",
      headers: { authorization: `Bearer ${token}` },
    });
    const { jobs } = res.json<{ jobs: Record<string, unknown>[] }>();
    const job = jobs[0];

    expect(job).toHaveProperty("id");
    expect(job).toHaveProperty("status");
    expect(job).toHaveProperty("filename");
    expect(job).toHaveProperty("durationSeconds");
    expect(job).toHaveProperty("createdAt");
    expect(job).toHaveProperty("updatedAt");
    // тяжёлые поля в списке отсутствуют
    expect(job).not.toHaveProperty("transcript");
    expect(job).not.toHaveProperty("report");
  });

  // ── 8. Порядок — новые первыми ──────────────────────────────────────────
  it("возвращает джобы в порядке createdAt desc", async () => {
    const token = await register("order@example.com");
    const id1 = await upload(token);
    await new Promise(r => setTimeout(r, 10));
    const id2 = await upload(token);

    const res = await app.inject({
      method: "GET", url: "/jobs",
      headers: { authorization: `Bearer ${token}` },
    });
    const { jobs } = res.json<{ jobs: { id: string }[] }>();
    // первый в списке — последний загруженный
    expect(jobs[0].id).toBe(id2);
    expect(jobs[1].id).toBe(id1);
  });

  // ── 9. GET /jobs/:id — spec-compliant response shape ───────────────────
  it("GET /jobs/:id возвращает { status, transcript, report } когда done", async () => {
    const token = await register("single@example.com");
    const user  = await prisma.user.findUnique({ where: { email: "single@example.com" } });

    // создаём done-джоб напрямую чтобы избежать race condition
    const job = await prisma.job.create({
      data: {
        userId:       user!.id,
        status:       "done",
        filePath:     "/tmp/done.mp3",
        originalName: "meeting.mp3",
        durationSeconds: 90,
        transcript:   "Hello world",
        report: JSON.stringify({
          summary: "Test summary sentence one. Sentence two. Sentence three.",
          topics: ["testing"],
          sentiment: "positive",
          action_items: ["Write tests"],
        }),
      },
    });

    const res = await app.inject({
      method: "GET", url: `/jobs/${job.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();

    // Spec: done → { status, transcript, report }
    expect(body.status).toBe("done");
    expect(body.transcript).toBe("Hello world");
    expect(body.report).toMatchObject({ sentiment: "positive" });

    // Spec: no extra fields like id, filename, durationSeconds in GET /jobs/:id
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("filename");
    expect(body).not.toHaveProperty("durationSeconds");
  });

  it("GET /jobs/:id возвращает { status } когда processing", async () => {
    const token = await register("proc@example.com");
    const user  = await prisma.user.findUnique({ where: { email: "proc@example.com" } });

    const job = await prisma.job.create({
      data: { userId: user!.id, status: "processing", filePath: "/tmp/p.mp3", originalName: "f.mp3", durationSeconds: 30 },
    });

    const res = await app.inject({
      method: "GET", url: `/jobs/${job.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    // Spec: processing → { status } only
    expect(body.status).toBe("processing");
    expect(body).not.toHaveProperty("transcript");
    expect(body).not.toHaveProperty("report");
  });

  it("GET /jobs/:id возвращает { status, errorMessage } когда error", async () => {
    const token = await register("err@example.com");
    const user  = await prisma.user.findUnique({ where: { email: "err@example.com" } });

    const job = await prisma.job.create({
      data: { userId: user!.id, status: "error", filePath: "/tmp/e.mp3", originalName: "f.mp3", durationSeconds: 30, errorMessage: "TRANSCRIPTION_FAILED: 503" },
    });

    const res = await app.inject({
      method: "GET", url: `/jobs/${job.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    // Spec: error → { status, errorMessage }
    expect(body.status).toBe("error");
    expect(body.errorMessage).toBe("TRANSCRIPTION_FAILED: 503");
    expect(body).not.toHaveProperty("transcript");
    expect(body).not.toHaveProperty("report");
  });
});
