import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { AppError, LLMReport } from "../types";
import { getAudioDuration } from "../utils/ffprobe";
import { PipelineService } from "./pipeline.service";

const LIMIT_SECONDS = 1800; // 30 minutes
const ALLOWED_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".flac"]);

export class JobService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly pipeline: PipelineService,
    private readonly uploadsDir: string
  ) {}

  async createJob(
    userId: string,
    fileBuffer: Buffer,
    filename: string
  ): Promise<{ jobId: string; status: string }> {
    // ── Validate extension ─────────────────────────────────────────────────
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new AppError(
        "FILE_INVALID",
        `Unsupported file format. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
        400
      );
    }

    // ── Persist file ───────────────────────────────────────────────────────
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }

    const safeFilename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const filePath = path.join(this.uploadsDir, safeFilename);
    fs.writeFileSync(filePath, fileBuffer);

    // ── Extract duration ───────────────────────────────────────────────────
    let durationSeconds: number;
    try {
      durationSeconds = await getAudioDuration(filePath);
    } catch (err) {
      fs.unlinkSync(filePath);
      const msg = err instanceof Error ? err.message : String(err);
      throw new AppError("FILE_INVALID", `Cannot read audio file: ${msg}`, 400);
    }

    // ── Enforce usage limit ────────────────────────────────────────────────
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError("UNAUTHORIZED", "User not found", 401);

    if (user.usedSeconds + durationSeconds > LIMIT_SECONDS) {
      fs.unlinkSync(filePath);
      const remainingMin = ((LIMIT_SECONDS - user.usedSeconds) / 60).toFixed(1);
      throw new AppError(
        "LIMIT_EXCEEDED",
        `Audio duration exceeds remaining limit. You have ${remainingMin} minutes left.`,
        400
      );
    }

    // ── Create job record ──────────────────────────────────────────────────
    const job = await this.prisma.job.create({
      data: {
        userId,
        status: "processing",
        filePath,
        originalName: filename,
        durationSeconds,
      },
    });

    // ── Kick off async pipeline (fire-and-forget) ─────────────────────────
    this.pipeline.run(job.id).catch((err) => {
      console.error(`[job-service] Unhandled pipeline error for job ${job.id}:`, err);
    });

    return { jobId: job.id, status: "processing" };
  }

  async listJobs(
    userId: string,
    opts: { limit?: number; offset?: number; status?: string } = {}
  ) {
    const limit  = Math.min(opts.limit  ?? 20, 100); // max 100 за раз
    const offset = opts.offset ?? 0;

    const where: Record<string, unknown> = { userId };
    if (opts.status) where.status = opts.status;

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id:              true,
          status:          true,
          durationSeconds: true,
          originalName:    true,
          errorMessage:    true,
          createdAt:       true,
          updatedAt:       true,
        },
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      jobs: jobs.map((j) => ({
        id:              j.id,
        status:          j.status,
        durationSeconds: j.durationSeconds,
        filename:        j.originalName || j.id,
        errorMessage:    j.errorMessage ?? null,
        createdAt:       j.createdAt,
        updatedAt:       j.updatedAt,
      })),
      total,
      limit,
      offset,
    };
  }

  async getJob(jobId: string, userId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });

    if (!job) {
      throw new AppError("NOT_FOUND", "Job not found", 404);
    }

    // ── User isolation ─────────────────────────────────────────────────────
    if (job.userId !== userId) {
      throw new AppError("FORBIDDEN", "Access denied", 403);
    }

    let report: LLMReport | null = null;
    if (job.report) {
      try {
        report = JSON.parse(job.report) as LLMReport;
      } catch {
        report = null;
      }
    }

    return {
      id:              job.id,
      status:          job.status,
      filename:        job.originalName || job.id,
      durationSeconds: job.durationSeconds,
      transcript:      job.transcript ?? null,
      report,
      errorMessage:    job.errorMessage ?? null,
      createdAt:       job.createdAt,
      updatedAt:       job.updatedAt,
    };
  }

  async getUsage(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError("UNAUTHORIZED", "User not found", 401);

    return {
      used_minutes: parseFloat((user.usedSeconds / 60).toFixed(2)),
      limit_minutes: 30,
    };
  }
}
