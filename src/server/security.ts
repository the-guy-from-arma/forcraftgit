import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import sanitizeHtml from "sanitize-html";
import type { PrismaClient } from "@prisma/client";

export const departmentRoles = new Set([
  "police",
  "sheriff",
  "fire",
  "ems",
  "dispatcher",
  "department_supervisor",
  "site_admin",
  "owner"
]);

export const dispatcherRoles = new Set(["dispatcher", "site_admin", "owner"]);
export const adminRoles = new Set(["site_admin", "owner"]);
export const ownerRoles = new Set(["owner"]);

export function canAccessDepartment(role?: string) {
  return !!role && departmentRoles.has(role);
}

export function canAccessDispatch(role?: string) {
  return !!role && dispatcherRoles.has(role);
}

export function canAccessAdmin(role?: string) {
  return !!role && adminRoles.has(role);
}

export function cleanText(value: unknown, maxLength = 1000) {
  if (typeof value !== "string") return "";

  return sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {}
  })
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

export function normalizeEmail(value: string) {
  return cleanText(value, 254).toLowerCase();
}

export function clientIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim();
  return req.socket.remoteAddress;
}

export async function auditAction(
  prisma: PrismaClient,
  req: Request,
  input: {
    actorId?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId || null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId || null,
      metadata: (input.metadata || {}) as Prisma.InputJsonValue,
      ipAddress: clientIp(req),
      userAgent: req.headers["user-agent"]
    }
  });
}

export function roleForDepartmentType(type: string) {
  if (type === "dispatch") return "dispatcher";
  if (type === "police") return "police";
  if (type === "sheriff") return "sheriff";
  if (type === "fire") return "fire";
  if (type === "ems") return "ems";
  return "civilian";
}

export function publicUser(user: any) {
  if (!user) return null;

  const { passwordHash: _passwordHash, sessions: _sessions, ...safe } = user;
  return safe;
}

export const unitStatusLabels: Record<string, string> = {
  TEN_8_AVAILABLE: "10-8 Available",
  TEN_6_BUSY: "10-6 Busy",
  TEN_7_OUT_OF_SERVICE: "10-7 Out of Service",
  TEN_23_ON_SCENE: "10-23 On Scene",
  TEN_97_EN_ROUTE: "10-97 En Route",
  TEN_15_TRANSPORTING: "10-15 Transporting",
  CODE_4_CLEAR: "Code 4 Clear",
  PRIORITY_RESPONSE: "Priority Response"
};

export function makeCallNumber(prefix = "FC") {
  const stamp = new Date();
  const y = stamp.getFullYear();
  const m = String(stamp.getMonth() + 1).padStart(2, "0");
  const d = String(stamp.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${y}${m}${d}-${rand}`;
}
