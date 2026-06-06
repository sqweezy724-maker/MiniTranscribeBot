import { FastifyInstance } from "fastify";
import { AuthService } from "../services/auth.service";
import { AppError } from "../types";

interface AuthBody {
  email: string;
  password: string;
}

export async function authRoutes(
  fastify: FastifyInstance,
  options: { authService: AuthService }
) {
  const { authService } = options;

  // ── POST /auth/register ──────────────────────────────────────────────────
  fastify.post<{ Body: AuthBody }>("/auth/register", async (request, reply) => {
    try {
      const { email, password } = request.body ?? {};
      const token = await authService.register(email, password);
      return reply.status(201).send({ token });
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  // ── POST /auth/login ─────────────────────────────────────────────────────
  fastify.post<{ Body: AuthBody }>("/auth/login", async (request, reply) => {
    try {
      const { email, password } = request.body ?? {};
      const token = await authService.login(email, password);
      return reply.send({ token });
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });
}
