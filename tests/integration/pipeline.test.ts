import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";

import { PipelineService } from "../../src/services/pipeline.service";
import {
  createMockTranscriptionProvider,
  createMockLLMProvider,
  createAlwaysFailingTranscriptionProvider,
  createInvalidJsonLLMProvider,
  MOCK_TRANSCRIPT,
  MOCK_REPORT,
} from "../helpers/mocks";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_DB_URL = "file:./prisma/test-pipeline.db";

function createTestPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
}

async function createUser(prisma: PrismaClient) {
  return prisma.user.create({
    data: {
      email: `test-${Date.now()}@example.com`,
      passwordHash: "hash",
      usedSeconds: 0,
    },
  });
}

async function createJob(prisma: PrismaClient, userId: string, filePath = "/tmp/fake.mp3") {
  return prisma.job.create({
    data: {
      userId,
      status: "processing",
      filePath,
      durationSeconds: 60,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("PipelineService", () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    // Clean DB
    await prisma.job.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.job.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  // ── Test 1: Happy Path ─────────────────────────────────────────────────────
  it("happy path: transcription → LLM → done", async () => {
    const user = await createUser(prisma);
    const job = await createJob(prisma, user.id);

    const pipeline = new PipelineService(
      prisma,
      createMockTranscriptionProvider(),
      createMockLLMProvider()
    );

    await pipeline.run(job.id);

    const updatedJob = await prisma.job.findUnique({ where: { id: job.id } });
    expect(updatedJob?.status).toBe("done");
    expect(updatedJob?.transcript).toBe(MOCK_TRANSCRIPT);

    const report = JSON.parse(updatedJob?.report ?? "null");
    expect(report).toMatchObject(MOCK_REPORT);

    // Usage should be incremented
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.usedSeconds).toBe(60);
  });

  // ── Test 2: Transcription fails → retried → fails job ─────────────────────
  it("transcription always fails → marks job as error", async () => {
    const user = await createUser(prisma);
    const job = await createJob(prisma, user.id);

    const pipeline = new PipelineService(
      prisma,
      createAlwaysFailingTranscriptionProvider(),
      createMockLLMProvider()
    );

    await pipeline.run(job.id);

    const updatedJob = await prisma.job.findUnique({ where: { id: job.id } });
    expect(updatedJob?.status).toBe("error");
    expect(updatedJob?.errorMessage).toContain("TRANSCRIPTION_FAILED");

    // Usage should NOT be incremented
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.usedSeconds).toBe(0);
  });

  // ── Test 3: LLM invalid JSON → retried twice → error ─────────────────────
  it("LLM always returns invalid → marks job as error", async () => {
    const user = await createUser(prisma);
    const job = await createJob(prisma, user.id);

    // failTimes=2 means both attempts fail
    const pipeline = new PipelineService(
      prisma,
      createMockTranscriptionProvider(),
      createInvalidJsonLLMProvider(2)
    );

    await pipeline.run(job.id);

    const updatedJob = await prisma.job.findUnique({ where: { id: job.id } });
    expect(updatedJob?.status).toBe("error");
    expect(updatedJob?.errorMessage).toContain("LLM_INVALID_JSON");

    // Usage NOT incremented on failure
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.usedSeconds).toBe(0);
  });

  // ── Test 4: LLM fails once, succeeds on retry ─────────────────────────────
  it("LLM fails once then succeeds on retry → done", async () => {
    const user = await createUser(prisma);
    const job = await createJob(prisma, user.id);

    // failTimes=1 means first attempt fails, second succeeds
    const pipeline = new PipelineService(
      prisma,
      createMockTranscriptionProvider(),
      createInvalidJsonLLMProvider(1)
    );

    await pipeline.run(job.id);

    const updatedJob = await prisma.job.findUnique({ where: { id: job.id } });
    expect(updatedJob?.status).toBe("done");
    expect(updatedJob?.transcript).toBe(MOCK_TRANSCRIPT);
  });

  // ── Test 5: Non-existent job is handled gracefully ────────────────────────
  it("handles non-existent job gracefully", async () => {
    const pipeline = new PipelineService(
      prisma,
      createMockTranscriptionProvider(),
      createMockLLMProvider()
    );

    // Should not throw
    await expect(pipeline.run("non-existent-id")).resolves.toBeUndefined();
  });

  // ── Test 6: Transcript is saved even if LLM fails ─────────────────────────
  it("saves transcript even when LLM analysis fails", async () => {
    const user = await createUser(prisma);
    const job = await createJob(prisma, user.id);

    const pipeline = new PipelineService(
      prisma,
      createMockTranscriptionProvider(),
      createInvalidJsonLLMProvider(2)
    );

    await pipeline.run(job.id);

    const updatedJob = await prisma.job.findUnique({ where: { id: job.id } });
    expect(updatedJob?.transcript).toBe(MOCK_TRANSCRIPT);
    expect(updatedJob?.status).toBe("error");
  });
});
