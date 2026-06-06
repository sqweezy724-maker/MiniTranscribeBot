import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticate } from "../middleware/auth.middleware";
import { JobService } from "../services/job.service";
import { AppError } from "../types";

export async function jobRoutes(
  fastify: FastifyInstance,
  options: { jobService: JobService }
) {
  const { jobService } = options;

  // ── POST /jobs ────────────────────────────────────────────────────────────
  // Spec: responds { "jobId": "string" }  (no "status" in body)
  // Spec: HTTP 202
  fastify.post(
    "/jobs",
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const data = await request.file();
        if (!data) {
          return reply.status(400).send({ error: "FILE_INVALID", message: "No file uploaded" });
        }

        const chunks: Buffer[] = [];
        for await (const chunk of data.file) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        const result = await jobService.createJob(
          request.user.userId,
          buffer,
          data.filename
        );

        // Spec: { "jobId": "string" } only
        return reply.status(202).send({ jobId: result.jobId });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    }
  );

  // ── GET /jobs — список (опционально, не в core spec) ─────────────────────
  fastify.get<{
    Querystring: { limit?: string; offset?: string; status?: string };
  }>(
    "/jobs",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { limit, offset, status } = request.query;
        const result = await jobService.listJobs(request.user.userId, {
          limit:  limit  ? parseInt(limit,  10) : undefined,
          offset: offset ? parseInt(offset, 10) : undefined,
          status,
        });
        return reply.send(result);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    }
  );

  // ── GET /jobs/:id ─────────────────────────────────────────────────────────
  // Spec responses:
  //   processing: { status }
  //   done:       { status, transcript, report }
  //   error:      { status, errorMessage }
  fastify.get<{ Params: { id: string } }>(
    "/jobs/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const job = await jobService.getJob(request.params.id, request.user.userId);

        // Shape response exactly per spec — no extra fields
        if (job.status === "done") {
          return reply.send({
            status:     job.status,
            transcript: job.transcript,
            report:     job.report,
          });
        }

        if (job.status === "error") {
          return reply.send({
            status:       job.status,
            errorMessage: job.errorMessage,
          });
        }

        // processing / transcribed / analyzed / uploaded → spec says { status }
        return reply.send({ status: job.status });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    }
  );

  // ── GET /me/usage ─────────────────────────────────────────────────────────
  // Spec: { used_minutes, limit_minutes } only
  fastify.get(
    "/me/usage",
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const usage = await jobService.getUsage(request.user.userId);
        return reply.send(usage);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    }
  );
}
