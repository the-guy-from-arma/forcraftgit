import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getPrisma } from "./db";
import { canAccessAdmin, canAccessDepartment, canAccessDispatch, publicUser } from "./security";

const defaultDevSecret = "faircroft-coreone-dev-secret-change-me";

export type AuthedRequest = Request & {
  auth: {
    user: any;
    session: any;
    tokenId: string;
  };
};

function jwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production.");
  }

  return secret || defaultDevSecret;
}

function expiresInMs() {
  const configured = process.env.JWT_EXPIRES_IN || "7d";
  const match = configured.match(/^(\d+)([hdm])$/);

  if (!match) return 7 * 24 * 60 * 60 * 1000;

  const value = Number(match[1]);
  const unit = match[2];
  if (unit === "h") return value * 60 * 60 * 1000;
  if (unit === "m") return value * 60 * 1000;
  return value * 24 * 60 * 60 * 1000;
}

export async function issueSession(user: any, req: Request) {
  const prisma = getPrisma();
  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + expiresInMs());

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenId,
      expiresAt,
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip
    }
  });

  const token = jwt.sign(
    {
      sub: user.id,
      role: user.role,
      jti: tokenId
    },
    jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );

  return { token, expiresAt };
}

export function bearerToken(req: Request) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

export async function resolveUserFromToken(token: string | null) {
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
    const tokenId = String(decoded.jti || "");
    const userId = String(decoded.sub || "");

    if (!tokenId || !userId) return null;

    const prisma = getPrisma();
    const session = await prisma.session.findUnique({
      where: { tokenId },
      include: {
        user: {
          include: {
            profile: true,
            memberships: {
              where: { active: true },
              include: { department: true, rank: true }
            }
          }
        }
      }
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
    if (session.user.suspended) return null;

    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() }
    });

    return { user: session.user, session, tokenId };
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const resolved = await resolveUserFromToken(bearerToken(req));

  if (!resolved) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  (req as AuthedRequest).auth = resolved;
  next();
}

export function requireDepartment(req: Request, res: Response, next: NextFunction) {
  const authed = req as AuthedRequest;
  if (!canAccessDepartment(authed.auth?.user?.role)) {
    res.status(403).json({ error: "Department access required." });
    return;
  }

  next();
}

export function requireDispatcher(req: Request, res: Response, next: NextFunction) {
  const authed = req as AuthedRequest;
  if (!canAccessDispatch(authed.auth?.user?.role)) {
    res.status(403).json({ error: "Dispatch access required." });
    return;
  }

  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authed = req as AuthedRequest;
  if (!canAccessAdmin(authed.auth?.user?.role)) {
    res.status(403).json({ error: "Administrator access required." });
    return;
  }

  next();
}

export async function respondWithMe(req: Request, res: Response) {
  const authed = req as AuthedRequest;
  res.json({ user: publicUser(authed.auth.user) });
}
