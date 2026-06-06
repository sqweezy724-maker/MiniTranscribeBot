import { PrismaClient } from "@prisma/client";
import { TranscriptionProvider, LLMProvider } from "../types";
import { validateReport } from "../utils/validate-report";
import { withRetry } from "../utils/retry";

/** Extract a human-readable message from any thrown value, including axios errors */
function extractMessage(err: unknown): string {
  if (err && typeof err === "object") {
    // Axios error: response body often has the real reason
    const axiosErr = err as {
      response?: { data?: { error?: { message?: string }; message?: string }; status?: number };
      message?: string;
    };
    if (axiosErr.response) {
      const status = axiosErr.response.status;
      const body = axiosErr.response.data;
      const detail =
        body?.error?.message ?? body?.message ?? JSON.stringify(body);
      return `HTTP ${status}: ${detail}`;
    }
    if ("message" in (err as { message?: string })) {
      return (err as { message: string }).message;
    }
  }
  return String(err);
}

export class PipelineService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly transcription: TranscriptionProvider,
    private readonly llm: LLMProvider
  ) {}

  /**
   * Main processing pipeline: transcription → LLM analysis → persist results.
   * Runs fully async; job status is updated in DB throughout.
   */
  async run(jobId: string): Promise<void> {
    // ── Step 0: fetch job ──────────────────────────────────────────────────
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      console.error(`[pipeline] Job ${jobId} not found`);
      return;
    }

    // ── Step 1: Transcription ──────────────────────────────────────────────
    let transcript: string;
    try {
      transcript = await withRetry(
        () => this.transcription.transcribe(job.filePath),
        1,
        "transcription"
      );
    } catch (err) {
      const message = extractMessage(err);
      console.error(`[pipeline] Transcription failed for job ${jobId}: ${message}`);
      await this.prisma.job.update({
        where: { id: jobId },
        data: { status: "error", errorMessage: `TRANSCRIPTION_FAILED: ${message}` },
      });
      return;
    }

    // Persist transcript & advance status
    await this.prisma.job.update({
      where: { id: jobId },
      data: { transcript, status: "transcribed" },
    });

    // ── Step 2: LLM Analysis ───────────────────────────────────────────────
    let reportJson: string;
    try {
      const report = await withRetry(
        async () => {
          const raw = await this.llm.analyze(transcript);
          return validateReport(raw);
        },
        1,
        "llm-analysis"
      );
      reportJson = JSON.stringify(report);
    } catch (err) {
      const message = extractMessage(err);
      console.error(`[pipeline] LLM analysis failed for job ${jobId}: ${message}`);
      await this.prisma.job.update({
        where: { id: jobId },
        data: { status: "error", errorMessage: `LLM_FAILED: ${message}` },
      });
      return;
    }

    // ── Step 3: Finalize ───────────────────────────────────────────────────
    await this.prisma.job.update({
      where: { id: jobId },
      data: { report: reportJson, status: "done" },
    });

    // ── Step 4: Deduct usage ───────────────────────────────────────────────
    await this.prisma.user.update({
      where: { id: job.userId },
      data: { usedSeconds: { increment: job.durationSeconds } },
    });

    console.log(`[pipeline] Job ${jobId} completed successfully`);
  }
}
