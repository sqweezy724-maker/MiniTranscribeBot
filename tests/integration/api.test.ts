import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import FormData from "form-data";
import fs from "fs";
import path from "path";

import { buildApp } from "../../src/app";
import {
  createMockTranscriptionProvider,
  createMockLLMProvider,
  MOCK_REPORT,
  MOCK_TRANSCRIPT,
} from "../helpers/mocks";

// ── Mock ffprobe ───────────────────────────────────────────────────────────────
vi.mock("../../src/utils/ffprobe", () => ({
  getAudioDuration: vi.fn().mockResolvedValue(60), // 60 seconds
}));

const TEST_DB_URL = "file:./prisma/test-api.db";

let app: FastifyInstance;
let prisma: PrismaClient;

async function registerUser(
  email = "user@example.com",
  password = "password123"
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password },
  });
  const body = res.json<{ token: string }>();
  return body.token;
}

async function uploadAudio(token: string, dummyBuffer?: Buffer): Promise<Response & { json: () => any }> {
  const buf = dummyBuffer ?? Buffer.from("fake audio data");
  const form = new FormData();
  form.append("audio", buf, { filename: "test.mp3", contentType: "audio/mpeg" });

  const res = await app.inject({
    method: "POST",
    url: "/jobs",
    headers: {
      authorization: `Bearer ${token}`,
      ...form.getHeaders(),
    },
    payload: form.getBuffer(),
  });

  return res as any;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("API Integration Tests", () => {
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

  // ──────────────────────────────────────────────────────────────────────────
  // AUTH
  // ──────────────────────────────────────────────────────────────────────────

  describe("POST /auth/register", () => {
    it("registers a new user and returns a JWT", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email: "new@example.com", password: "password123" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ token: string }>();
      expect(typeof body.token).toBe("string");
      expect(body.token.split(".")).toHaveLength(3); // valid JWT
    });

    it("rejects duplicate email with 409", async () => {
      await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email: "dup@example.com", password: "password123" },
      });
      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email: "dup@example.com", password: "password123" },
      });
      expect(res.statusCode).toBe(409);
    });

    it("rejects short password with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email: "short@example.com", password: "abc" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /auth/login", () => {
    it("logs in with correct credentials", async () => {
      await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email: "login@example.com", password: "password123" },
      });
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "login@example.com", password: "password123" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ token: string }>();
      expect(typeof body.token).toBe("string");
    });

    it("rejects wrong password with 401", async () => {
      await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email: "bad@example.com", password: "password123" },
      });
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "bad@example.com", password: "wrongpassword" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects unknown email with 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "ghost@example.com", password: "password123" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // JOBS
  // ──────────────────────────────────────────────────────────────────────────

  describe("POST /jobs", () => {
    it("requires auth", async () => {
      const res = await app.inject({ method: "POST", url: "/jobs" });
      expect(res.statusCode).toBe(401);
    });

    it("rejects invalid file type", async () => {
      const token = await registerUser("upload-badtype@example.com");
      const form = new FormData();
      form.append("audio", Buffer.from("data"), {
        filename: "test.exe",
        contentType: "application/octet-stream",
      });
      const res = await app.inject({
        method: "POST",
        url: "/jobs",
        headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
        payload: form.getBuffer(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("FILE_INVALID");
    });

    it("accepts valid audio and returns jobId", async () => {
      const token = await registerUser("upload-ok@example.com");
      const res = await uploadAudio(token);
      expect(res.statusCode).toBe(202);
      const body = res.json();
      // Spec: POST /jobs returns { jobId } only
      expect(typeof body.jobId).toBe("string");
    });
  });

  describe("GET /jobs/:id", () => {
    it("requires auth", async () => {
      const res = await app.inject({ method: "GET", url: "/jobs/fake-id" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for non-existent job", async () => {
      const token = await registerUser("notfound@example.com");
      const res = await app.inject({
        method: "GET",
        url: "/jobs/non-existent-id",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });

    // ── Test: User Isolation ──────────────────────────────────────────────
    it("USER ISOLATION: user A cannot access user B job", async () => {
      const tokenA = await registerUser("userA@example.com");
      const tokenB = await registerUser("userB@example.com");

      // User A uploads
      const uploadRes = await uploadAudio(tokenA);
      const { jobId } = uploadRes.json();

      // User B tries to fetch it
      const res = await app.inject({
        method: "GET",
        url: `/jobs/${jobId}`,
        headers: { authorization: `Bearer ${tokenB}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("FORBIDDEN");
    });

    it("user can access their own job", async () => {
      const token = await registerUser("own-job@example.com");
      const uploadRes = await uploadAudio(token);
      const { jobId } = uploadRes.json();

      const res = await app.inject({
        method: "GET",
        url: `/jobs/${jobId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      // Spec: GET /jobs/:id while processing returns { status } only
      expect(res.json().status).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: LIMIT EXCEEDED
  // ──────────────────────────────────────────────────────────────────────────

  describe("Limit enforcement", () => {
    it("rejects upload when user is already at limit", async () => {
      const token = await registerUser("over-limit@example.com");

      // Manually set usedSeconds to 1800 (30 min limit)
      const user = await prisma.user.findUnique({
        where: { email: "over-limit@example.com" },
      });
      await prisma.user.update({
        where: { id: user!.id },
        data: { usedSeconds: 1800 },
      });

      const res = await uploadAudio(token);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("LIMIT_EXCEEDED");
    });

    it("allows upload when user has enough remaining quota", async () => {
      const token = await registerUser("under-limit@example.com");

      // usedSeconds = 0, duration = 60 → should be fine
      const res = await uploadAudio(token);
      expect(res.statusCode).toBe(202);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // USAGE
  // ──────────────────────────────────────────────────────────────────────────

  describe("GET /me/usage", () => {
    it("requires auth", async () => {
      const res = await app.inject({ method: "GET", url: "/me/usage" });
      expect(res.statusCode).toBe(401);
    });

    it("returns usage info for authenticated user", async () => {
      const token = await registerUser("usage@example.com");
      const res = await app.inject({
        method: "GET",
        url: "/me/usage",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.used_minutes).toBe(0);
      expect(body.limit_minutes).toBe(30);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // HEALTH
  // ──────────────────────────────────────────────────────────────────────────

  describe("GET /health", () => {
    it("returns ok", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("ok");
    });
  });
});
