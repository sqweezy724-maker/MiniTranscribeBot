import "dotenv/config";
import Fastify, { FastifyInstance, FastifyError } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "path";
import { PrismaClient } from "@prisma/client";

import { AuthService } from "./services/auth.service";
import { JobService } from "./services/job.service";
import { PipelineService } from "./services/pipeline.service";
import { createTranscriptionProvider } from "./providers/transcription";
import { createLLMProvider } from "./providers/llm";
import { authRoutes } from "./routes/auth.routes";
import { jobRoutes } from "./routes/jobs.routes";
import type { TranscriptionProvider, LLMProvider } from "./types";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

export interface AppOverrides {
  prisma?: PrismaClient;
  transcriptionProvider?: TranscriptionProvider;
  llmProvider?: LLMProvider;
}

export async function buildApp(overrides?: AppOverrides): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: process.env.NODE_ENV !== "test" });

  // ── JWT ──────────────────────────────────────────────────────────────────
  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET ?? "dev_secret_change_me",
  });

  // ── Multipart ────────────────────────────────────────────────────────────
  await fastify.register(fastifyMultipart, {
    limits: { fileSize: MAX_FILE_SIZE },
  });

  // ── Database ─────────────────────────────────────────────────────────────
  const prisma = overrides?.prisma ?? new PrismaClient();

  // ── Providers ────────────────────────────────────────────────────────────
  const transcriptionProvider =
    overrides?.transcriptionProvider ??
    createTranscriptionProvider(
      process.env.TRANSCRIPTION_PROVIDER ?? "groq",
      process.env.TRANSCRIPTION_API_KEY ?? ""
    );

  const llmProvider =
    overrides?.llmProvider ??
    createLLMProvider(
      process.env.LLM_PROVIDER ?? "openrouter",
      process.env.LLM_API_KEY ?? ""
    );

  // ── Services ─────────────────────────────────────────────────────────────
  const pipeline = new PipelineService(prisma, transcriptionProvider, llmProvider);
  const uploadsDir = path.join(process.cwd(), "uploads");

  const authService = new AuthService(prisma, fastify);
  const jobService = new JobService(prisma, pipeline, uploadsDir);

  // ── API Routes (registered BEFORE static so they always win) ─────────────
  await fastify.register(authRoutes, { authService });
  await fastify.register(jobRoutes, { jobService });

  // ── Health check ─────────────────────────────────────────────────────────
  fastify.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

  // ── Static (frontend) — registered LAST, wildcard:false so it never
  //    intercepts API routes that are already defined above ─────────────────
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, "../public"),
    prefix: "/",
    wildcard: false,        // only serve files that physically exist
    index: ["index.html"],  // serve index.html for "/"
  });

  // ── Global error handler ──────────────────────────────────────────────────
  fastify.setErrorHandler((error: FastifyError, _request, reply) => {
    fastify.log.error(error);
    reply.status(error.statusCode ?? 500).send({
      error: "INTERNAL_ERROR",
      message: error.message ?? "An unexpected error occurred",
    });
  });

  fastify.addHook("onClose", async () => {
    if (!overrides?.prisma) {
      await prisma.$disconnect();
    }
  });

  return fastify;
}
