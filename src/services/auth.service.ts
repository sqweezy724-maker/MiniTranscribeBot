import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { AppError, JwtPayload } from "../types";

const SALT_ROUNDS = 12;

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly fastify: FastifyInstance
  ) {}

  async register(email: string, password: string): Promise<string> {
    if (!email || !password) {
      throw new AppError("VALIDATION_ERROR", "email and password are required", 400);
    }
    if (password.length < 8) {
      throw new AppError("VALIDATION_ERROR", "password must be at least 8 characters", 400);
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError("CONFLICT", "Email already registered", 409);
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email, passwordHash },
    });

    return this.signToken({ userId: user.id, email: user.email });
  }

  async login(email: string, password: string): Promise<string> {
    if (!email || !password) {
      throw new AppError("VALIDATION_ERROR", "email and password are required", 400);
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppError("UNAUTHORIZED", "Invalid credentials", 401);
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new AppError("UNAUTHORIZED", "Invalid credentials", 401);
    }

    return this.signToken({ userId: user.id, email: user.email });
  }

  private signToken(payload: JwtPayload): string {
    return (this.fastify.jwt as { sign: (p: JwtPayload) => string }).sign(payload);
  }
}
