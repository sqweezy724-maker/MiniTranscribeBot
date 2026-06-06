// ─── Domain Types ────────────────────────────────────────────────────────────

export type JobStatus = "uploaded" | "processing" | "transcribed" | "analyzed" | "done" | "error";

export interface LLMReport {
  summary: string;
  topics: string[];
  sentiment: "positive" | "neutral" | "negative";
  action_items: string[];
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  usedSeconds: number;
  createdAt: Date;
}

export interface Job {
  id: string;
  userId: string;
  status: JobStatus;
  filePath: string;
  durationSeconds: number;
  transcript: string | null;
  report: LLMReport | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Provider Interfaces ─────────────────────────────────────────────────────

export interface TranscriptionProvider {
  transcribe(filePath: string): Promise<string>;
}

export interface LLMProvider {
  analyze(text: string): Promise<LLMReport>;
}

// ─── API Error ───────────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ─── JWT Payload ─────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  email: string;
}

// ─── Fastify JWT augmentation ──────────────────────────────────────────────
// This augments @fastify/jwt's FastifyJWT interface so request.user is typed.

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
