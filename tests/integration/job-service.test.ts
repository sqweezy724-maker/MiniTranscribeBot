import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";

import { JobService } from "../../src/services/job.service";
import { PipelineService } from "../../src/services/pipeline.service";
import {
  createMockTranscriptionProvider,
  createMockLLMProvider,
} from "../helpers/mocks";
import { AppError } from "../../src/types";

// ── Mock ffprobe ───────────────────────────────────────────────────────────────
vi.mock("../../src/utils/ffprobe", () => ({
  getAudioDuration: vi.fn().mockResolvedValue(60),
}));

const TEST_DB_URL = "file:./prisma/test-job-service.db";
const TEST_UPLOADS_DIR = path.join(process.cwd(), "test-uploads-tmp");

let prisma: PrismaClient;
let jobService: JobService;

async function createUser(email = "svc@example.com") {
  return prisma.user.create({
    data: { email, passwordHash: "hash", usedSeconds: 0 },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("JobService", () => {
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    await prisma.$connect();

    const pipeline = new PipelineService(
      prisma,
      createMockTranscriptionProvider(),
      createMockLLMProvider()
    );

    jobService = new JobService(prisma, pipeline, TEST_UPLOADS_DIR);
    fs.mkdirSync(TEST_UPLOADS_DIR, { recursive: true });
  });

  afterAll(async () => {
    await prisma.job.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
    fs.rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.job.deleteMany();
    await prisma.user.deleteMany();
    // clean uploads
    for (const f of fs.readdirSync(TEST_UPLOADS_DIR)) {
      fs.unlinkSync(path.join(TEST_UPLOADS_DIR, f));
    }
  });

  it("creates a job and returns jobId + processing status", async () => {
    const user = await createUser();
    const buf = Buffer.from("fake mp3 data");
    const result = await jobService.createJob(user.id, buf, "test.mp3");

    expect(typeof result.jobId).toBe("string");

    const job = await prisma.job.findUnique({ where: { id: result.jobId } });
    expect(job).not.toBeNull();
    expect(job?.userId).toBe(user.id);
  });

  it("LIMIT_EXCEEDED: rejects upload when user is at limit", async () => {
    const user = await prisma.user.create({
      data: { email: "limited@example.com", passwordHash: "hash", usedSeconds: 1800 },
    });

    await expect(
      jobService.createJob(user.id, Buffer.from("data"), "test.mp3")
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("FILE_INVALID: rejects unsupported file extension", async () => {
    const user = await createUser("ext@example.com");
    await expect(
      jobService.createJob(user.id, Buffer.from("data"), "file.txt")
    ).rejects.toMatchObject({ code: "FILE_INVALID" });
  });

  it("getJob: user isolation — user B cannot read user A job", async () => {
    const userA = await createUser("a@example.com");
    const userB = await createUser("b@example.com");

    const result = await jobService.createJob(userA.id, Buffer.from("data"), "test.mp3");

    await expect(
      jobService.getJob(result.jobId, userB.id)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("getJob: owner can read their own job", async () => {
    const user = await createUser("owner@example.com");
    const { jobId } = await jobService.createJob(user.id, Buffer.from("data"), "test.mp3");

    const job = await jobService.getJob(jobId, user.id);
    expect(job.id).toBe(jobId); // internal service still returns full object
  });

  it("getJob: returns 404 for non-existent job", async () => {
    const user = await createUser("nojob@example.com");
    await expect(
      jobService.getJob("does-not-exist", user.id)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getUsage: returns correct initial usage", async () => {
    const user = await createUser("usage@example.com");
    const usage = await jobService.getUsage(user.id);
    expect(usage.used_minutes).toBe(0);
    expect(usage.limit_minutes).toBe(30);
  });

  it("getUsage: returns updated usage", async () => {
    const user = await createUser("usage2@example.com");
    await prisma.user.update({
      where: { id: user.id },
      data: { usedSeconds: 900 },
    });
    const usage = await jobService.getUsage(user.id);
    expect(usage.used_minutes).toBe(15);
  });
});
