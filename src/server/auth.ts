import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { getPrisma } from "./db.js";
import { auditAction, canAccessAdmin, canAccessDepartment, canAccessDispatch, canAccessGovernment, publicUser } from "./security.js";

const DEFAULT_DEV_SECRET = "faircroft-coreone-dev-secret-change-me";
type JwtExpiresIn = NonNullable<SignOptions["expiresIn"]>;

const DEFAULT_JWT_EXPIRES: JwtExpiresIn = "7d";

export type AuthedRequest = Request & {
  auth: {
    user: any;
    session: any;
    tokenId: string;
  };
};

type SessionPayload = {
  sub: string;
  role: string;
  jti: string;
};

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production.");
  }
  return secret || DEFAULT_DEV_SECRET;
}

function getJwtExpires(): JwtExpiresIn {
  const configured = process.env.JWT_EXPIRES_IN?.trim();
  if (!configured) return DEFAULT_JWT_EXPIRES;

  if (/^\d+$/.test(configured)) return Number(configured);
  if (/^\d+(ms|s|m|h|d|w|y)$/i.test(configured)) return configured as JwtExpiresIn;

  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_EXPIRES_IN must be a duration like 7d, 12h, 30m, or a number of seconds.");
  }

  return DEFAULT_JWT_EXPIRES;
}

function getTokenExpiryMs(): number {
  const configured = getJwtExpires();
  if (typeof configured === "number") return configured * 1000;

  const match = configured.match(/^(\d+)(ms|s|m|h|d|w|y)$/i);
  if (!match) return 7 * 24 * 60 * 60 * 1000;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "ms") return value;
  if (unit === "s") return value * 1000;
  if (unit === "m") return value * 60 * 1000;
  if (unit === "h") return value * 60 * 60 * 1000;
  if (unit === "d") return value * 24 * 60 * 60 * 1000;
  if (unit === "w") return value * 7 * 24 * 60 * 60 * 1000;
  return value * 365 * 24 * 60 * 60 * 1000;
}

export async function issueSession(user: any, req: Request) {
  const prisma = getPrisma();
  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + getTokenExpiryMs());

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
    getJwtSecret(),
    {
      expiresIn: getJwtExpires()
    }
  );

  return { token, expiresAt };
}

export function bearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim();
}

export async function resolveUserFromToken(token: string | null) {
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as SessionPayload;
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

function authorizationError(res: Response, message: string) {
  res.status(403).json({ error: message });
}

async function auditSecurityEvent(
  req: Request,
  input: {
    actorId?: string | null;
    action: string;
    reason: string;
  }
) {
  try {
    await auditAction(getPrisma(), req, {
      actorId: input.actorId || null,
      action: input.action,
      entity: "Route",
      entityId: null,
      metadata: {
        method: req.method,
        route: req.originalUrl,
        reason: input.reason
      }
    });
  } catch {
    // Authentication and authorization failures should never expose database internals to callers.
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const resolved = await resolveUserFromToken(bearerToken(req));
  if (!resolved) {
    void auditSecurityEvent(req, {
      action: "auth.required.denied",
      reason: "missing_or_invalid_session"
    });
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  (req as AuthedRequest).auth = resolved;
  next();
}

export function requireDepartment(req: Request, res: Response, next: NextFunction) {
  const authed = req as AuthedRequest;
  if (!canAccessDepartment(authed.auth?.user?.role)) {
    void auditSecurityEvent(req, {
      actorId: authed.auth?.user?.id,
      action: "permission.department.denied",
      reason: `role:${authed.auth?.user?.role || "unknown"}`
    });
    return authorizationError(res, "Department access required.");
  }
  next();
}

export function requireDispatcher(req: Request, res: Response, next: NextFunction) {
  const authed = req as AuthedRequest;
  if (!canAccessDispatch(authed.auth?.user?.role)) {
    void auditSecurityEvent(req, {
      actorId: authed.auth?.user?.id,
      action: "permission.dispatch.denied",
      reason: `role:${authed.auth?.user?.role || "unknown"}`
    });
    return authorizationError(res, "Dispatch access required.");
  }
  next();
}

export function requireGovernment(req: Request, res: Response, next: NextFunction) {
  const authed = req as AuthedRequest;
  if (!canAccessGovernment(authed.auth?.user?.role)) {
    void auditSecurityEvent(req, {
      actorId: authed.auth?.user?.id,
      action: "permission.government.denied",
      reason: `role:${authed.auth?.user?.role || "unknown"}`
    });
    return authorizationError(res, "Government employee access required.");
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authed = req as AuthedRequest;
  if (!canAccessAdmin(authed.auth?.user?.role)) {
    void auditSecurityEvent(req, {
      actorId: authed.auth?.user?.id,
      action: "permission.admin.denied",
      reason: `role:${authed.auth?.user?.role || "unknown"}`
    });
    return authorizationError(res, "Administrator access required.");
  }
  next();
}

export async function respondWithMe(req: Request, res: Response) {
  const authed = req as AuthedRequest;
  res.json({ user: publicUser(authed.auth.user) });
}
