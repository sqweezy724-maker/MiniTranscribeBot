import { FastifyRequest, FastifyReply } from "fastify";
import { JwtPayload } from "../types";

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const payload = await request.jwtVerify<JwtPayload>();
    request.user = payload;
  } catch {
    reply.status(401).send({ error: "UNAUTHORIZED", message: "Invalid or missing token" });
  }
}
