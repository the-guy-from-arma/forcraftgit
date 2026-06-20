import bcrypt from "bcryptjs";
import type { Express, Request, Response } from "express";
import type { Server as SocketIOServer } from "socket.io";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "./db";
import {
  AuthedRequest,
  bearerToken,
  issueSession,
  requireAdmin,
  requireAuth,
  requireDepartment,
  requireDispatcher,
  respondWithMe
} from "./auth";
import {
  auditAction,
  cleanText,
  makeCallNumber,
  normalizeEmail,
  publicUser,
  roleForDepartmentType,
  unitStatusLabels
} from "./security";

type Handler = (req: Request, res: Response) => Promise<void>;

const text = (max = 1000) => z.string().min(1).max(max).transform((value) => cleanText(value, max));
const optionalText = (max = 1000) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value ? cleanText(value, max) : undefined));

const asyncHandler =
  (handler: Handler) =>
  async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "CoreOne service fault. Check server logs." });
    }
  };

function parseBody<T>(schema: z.Schema<T>, req: Request, res: Response): T | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      error: "Validation failed.",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
    return null;
  }

  return parsed.data;
}

function parseQuery(value: unknown, max = 120) {
  if (typeof value !== "string") return "";
  return cleanText(value, max);
}

function authed(req: Request) {
  return (req as AuthedRequest).auth.user;
}

function authedSession(req: Request) {
  return (req as AuthedRequest).auth.session;
}

const userInclude = {
  profile: true,
  memberships: {
    where: { active: true },
    include: { department: true, rank: true }
  }
};

export function registerApi(app: Express, io: SocketIOServer) {
  app.get(
    "/api/health",
    asyncHandler(async (_req, res) => {
      res.json({
        ok: true,
        name: "FairCroft CoreOne",
        roleplayOnly: true,
        timestamp: new Date().toISOString()
      });
    })
  );

  app.post(
    "/api/auth/register",
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          email: z.string().email().transform(normalizeEmail),
          password: z.string().min(8).max(128),
          firstName: text(80),
          lastName: text(80),
          phone: optionalText(40),
          dateOfBirth: optionalText(40),
          address: optionalText(160),
          city: optionalText(80),
          state: optionalText(12),
          postalCode: optionalText(20)
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      if (existing) {
        res.status(409).json({ error: "An account already exists for that email." });
        return;
      }

      const passwordHash = await bcrypt.hash(body.password, 12);
      const user = await prisma.user.create({
        data: {
          email: body.email,
          passwordHash,
          name: `${body.firstName} ${body.lastName}`,
          phone: body.phone,
          role: "civilian",
          profile: {
            create: {
              firstName: body.firstName,
              lastName: body.lastName,
              phone: body.phone,
              dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
              address: body.address,
              city: body.city || "FairCroft",
              state: body.state || "FC",
              postalCode: body.postalCode
            }
          }
        },
        include: userInclude
      });

      await auditAction(prisma, req, {
        actorId: user.id,
        action: "auth.register",
        entity: "User",
        entityId: user.id
      });

      const session = await issueSession(user, req);
      res.status(201).json({ token: session.token, expiresAt: session.expiresAt, user: publicUser(user) });
    })
  );

  app.post(
    "/api/auth/login",
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          email: z.string().email().transform(normalizeEmail),
          password: z.string().min(1).max(128)
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const user = await prisma.user.findUnique({
        where: { email: body.email },
        include: userInclude
      });

      if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
        res.status(401).json({ error: "Invalid email or password." });
        return;
      }

      if (user.suspended) {
        res.status(403).json({ error: "This account is suspended." });
        return;
      }

      await auditAction(prisma, req, {
        actorId: user.id,
        action: "auth.login",
        entity: "User",
        entityId: user.id
      });

      const session = await issueSession(user, req);
      res.json({ token: session.token, expiresAt: session.expiresAt, user: publicUser(user) });
    })
  );

  app.post(
    "/api/auth/logout",
    requireAuth,
    asyncHandler(async (req, res) => {
      const prisma = getPrisma();
      await prisma.session.update({
        where: { id: authedSession(req).id },
        data: { revokedAt: new Date() }
      });
      res.json({ ok: true });
    })
  );

  app.get("/api/auth/me", requireAuth, asyncHandler(respondWithMe));

  app.get(
    "/api/civilian/overview",
    requireAuth,
    asyncHandler(async (req, res) => {
      const prisma = getPrisma();
      const user = authed(req);
      const [freshUser, vehicles, licenses, permits, warrants, citations, applications, notifications] =
        await Promise.all([
          prisma.user.findUnique({ where: { id: user.id }, include: userInclude }),
          prisma.vehicle.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" } }),
          prisma.license.findMany({ where: { userId: user.id }, orderBy: { issuedAt: "desc" } }),
          prisma.permit.findMany({ where: { userId: user.id }, orderBy: { issuedAt: "desc" } }),
          prisma.warrant.findMany({
            where: {
              OR: [{ subjectId: user.id }, { subjectName: { contains: user.name, mode: "insensitive" } }]
            },
            orderBy: { issuedAt: "desc" }
          }),
          prisma.citation.findMany({ where: { userId: user.id }, orderBy: { issuedAt: "desc" } }),
          prisma.departmentApplication.findMany({
            where: { userId: user.id },
            include: { department: true },
            orderBy: { submittedAt: "desc" }
          }),
          prisma.notification.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
            take: 15
          })
        ]);

      res.json({
        user: publicUser(freshUser),
        vehicles,
        licenses,
        permits,
        warrants,
        citations,
        applications,
        notifications
      });
    })
  );

  app.patch(
    "/api/civilian/profile",
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          phone: optionalText(40),
          address: optionalText(160),
          city: optionalText(80),
          state: optionalText(12),
          postalCode: optionalText(20),
          notes: optionalText(500)
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const user = authed(req);
      const profile = await prisma.civilianProfile.update({
        where: { userId: user.id },
        data: body
      });

      await auditAction(prisma, req, {
        actorId: user.id,
        action: "civilian.profile.update",
        entity: "CivilianProfile",
        entityId: profile.id
      });

      res.json({ profile });
    })
  );

  app.get(
    "/api/departments",
    requireAuth,
    asyncHandler(async (_req, res) => {
      const prisma = getPrisma();
      const departments = await prisma.department.findMany({
        where: { isActive: true },
        include: { ranks: { orderBy: { level: "asc" } } },
        orderBy: { name: "asc" }
      });
      res.json({ departments });
    })
  );

  app.post(
    "/api/civilian/applications",
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          departmentId: text(80),
          statement: text(1200),
          experience: optionalText(1200)
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const user = authed(req);
      const department = await prisma.department.findFirst({ where: { id: body.departmentId, isActive: true } });
      if (!department) {
        res.status(404).json({ error: "Department not found." });
        return;
      }

      const open = await prisma.departmentApplication.findFirst({
        where: { userId: user.id, departmentId: department.id, status: "pending" }
      });
      if (open) {
        res.status(409).json({ error: "You already have a pending application for this department." });
        return;
      }

      const application = await prisma.departmentApplication.create({
        data: {
          userId: user.id,
          departmentId: department.id,
          desiredRole: roleForDepartmentType(department.type) as any,
          statement: body.statement,
          experience: body.experience
        },
        include: { department: true }
      });

      if (user.role === "civilian") {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: "pending_department" }
        });
      }

      await auditAction(prisma, req, {
        actorId: user.id,
        action: "department.application.submit",
        entity: "DepartmentApplication",
        entityId: application.id,
        metadata: { department: department.code }
      });

      io.to("dispatchers").emit("admin:application", application);
      res.status(201).json({ application });
    })
  );

  app.post(
    "/api/civilian/911",
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          emergencyType: text(80),
          location: text(180),
          description: text(1400),
          callerName: text(120),
          callbackNumber: text(40)
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const user = authed(req);
      const call = await prisma.call911.create({
        data: {
          callerId: user.id,
          emergencyType: body.emergencyType,
          location: body.location,
          description: body.description,
          callerName: body.callerName,
          callbackNumber: body.callbackNumber,
          status: "queued",
          priority: "emergency"
        },
        include: {
          caller: { select: { id: true, name: true, phone: true } }
        }
      });

      await auditAction(prisma, req, {
        actorId: user.id,
        action: "911.submit",
        entity: "Call911",
        entityId: call.id,
        metadata: { emergencyType: call.emergencyType, location: call.location }
      });

      io.to("dispatchers").emit("911:incoming", call);
      res.status(201).json({ call });
    })
  );

  app.get(
    "/api/dispatch/queue",
    requireAuth,
    requireDispatcher,
    asyncHandler(async (_req, res) => {
      const prisma = getPrisma();
      const calls = await prisma.call911.findMany({
        where: { status: "queued" },
        include: { caller: { select: { id: true, name: true, phone: true } } },
        orderBy: { createdAt: "asc" }
      });
      res.json({ calls });
    })
  );

  app.post(
    "/api/dispatch/911/:id/accept",
    requireAuth,
    requireDispatcher,
    asyncHandler(async (req, res) => {
      const prisma = getPrisma();
      const user = authed(req);

      const call = await prisma.call911.findUnique({ where: { id: req.params.id } });
      if (!call || call.status !== "queued") {
        res.status(409).json({ error: "911 call is no longer queued." });
        return;
      }

      const accepted = await prisma.$transaction(async (tx) => {
        const updated911 = await tx.call911.update({
          where: { id: call.id },
          data: {
            status: "accepted",
            acceptedById: user.id,
            acceptedAt: new Date()
          }
        });

        const cadCall = await tx.cadCall.create({
          data: {
            call911Id: updated911.id,
            callNumber: makeCallNumber("FC-CAD"),
            type: updated911.emergencyType,
            location: updated911.location,
            description: updated911.description,
            priority: updated911.priority,
            status: "active",
            acceptedById: user.id,
            createdById: user.id
          },
          include: {
            assignments: { include: { cadUnit: { include: { department: true, user: true } } } }
          }
        });

        await tx.call911.update({
          where: { id: updated911.id },
          data: { status: "converted" }
        });

        return cadCall;
      });

      await auditAction(prisma, req, {
        actorId: user.id,
        action: "dispatch.911.accept",
        entity: "CadCall",
        entityId: accepted.id,
        metadata: { source911: call.id }
      });

      io.to("dispatchers").emit("911:accepted", { callId: call.id, cadCall: accepted });
      io.to("department-users").emit("cad:call-created", accepted);
      res.json({ cadCall: accepted });
    })
  );

  app.get(
    "/api/cad/dashboard",
    requireAuth,
    requireDepartment,
    asyncHandler(async (req, res) => {
      const prisma = getPrisma();
      const user = authed(req);
      const departmentIds = (user.memberships || []).map((membership: any) => membership.departmentId);

      const [calls, units, bolos, warrants, messages, notifications] = await Promise.all([
        prisma.cadCall.findMany({
          where: { status: { in: ["active", "assigned", "on_scene"] as any } },
          include: {
            assignments: { include: { cadUnit: { include: { department: true, user: true } } } }
          },
          orderBy: { createdAt: "desc" },
          take: 40
        }),
        prisma.cadUnit.findMany({
          where: departmentIds.length ? { departmentId: { in: departmentIds }, active: true } : { active: true },
          include: { department: true, user: { select: { id: true, name: true, role: true } } },
          orderBy: { unitNumber: "asc" }
        }),
        prisma.bolo.findMany({ where: { status: "active" }, orderBy: { createdAt: "desc" }, take: 20 }),
        prisma.warrant.findMany({ where: { status: "active" }, orderBy: { issuedAt: "desc" }, take: 20 }),
        prisma.dispatchMessage.findMany({
          include: { user: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: "desc" },
          take: 40
        }),
        prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 })
      ]);

      res.json({ calls, units, bolos, warrants, messages: messages.reverse(), notifications, unitStatusLabels });
    })
  );

  app.get(
    "/api/cad/calls",
    requireAuth,
    requireDepartment,
    asyncHandler(async (_req, res) => {
      const prisma = getPrisma();
      const calls = await prisma.cadCall.findMany({
        include: {
          assignments: { include: { cadUnit: { include: { department: true, user: true } } } }
        },
        orderBy: { createdAt: "desc" },
        take: 100
      });
      res.json({ calls });
    })
  );

  app.post(
    "/api/cad/calls",
    requireAuth,
    requireDepartment,
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          type: text(100),
          location: text(180),
          description: text(1400),
          priority: z.enum(["low", "routine", "priority", "emergency"]).default("routine")
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const user = authed(req);
      const cadCall = await prisma.cadCall.create({
        data: {
          callNumber: makeCallNumber("FC-CAD"),
          type: body.type,
          location: body.location,
          description: body.description,
          priority: body.priority,
          status: "active",
          createdById: user.id
        },
        include: {
          assignments: { include: { cadUnit: { include: { department: true, user: true } } } }
        }
      });

      await auditAction(prisma, req, {
        actorId: user.id,
        action: "cad.call.create",
        entity: "CadCall",
        entityId: cadCall.id
      });

      io.to("department-users").emit("cad:call-created", cadCall);
      res.status(201).json({ cadCall });
    })
  );

  app.post(
    "/api/cad/calls/:id/assign",
    requireAuth,
    requireDispatcher,
    asyncHandler(async (req, res) => {
      const body = parseBody(z.object({ unitId: text(80) }), req, res);
      if (!body) return;

      const prisma = getPrisma();
      const user = authed(req);
      const assignment = await prisma.unitAssignment.create({
        data: {
          cadCallId: req.params.id,
          cadUnitId: body.unitId,
          assignedById: user.id
        },
        include: {
          cadCall: true,
          cadUnit: { include: { department: true, user: { select: { id: true, name: true, role: true } } } }
        }
      });

      await prisma.cadCall.update({ where: { id: req.params.id }, data: { status: "assigned" } });
      await prisma.cadUnit.update({ where: { id: body.unitId }, data: { status: "TEN_97_EN_ROUTE" } });

      if (assignment.cadUnit.user?.id) {
        const notification = await prisma.notification.create({
          data: {
            userId: assignment.cadUnit.user.id,
            title: "CAD Assignment",
            body: `${assignment.cadCall.callNumber}: ${assignment.cadCall.type} at ${assignment.cadCall.location}`,
            type: "cad_assignment",
            payload: { cadCallId: assignment.cadCallId, assignmentId: assignment.id } as Prisma.InputJsonValue
          }
        });
        io.to(`user:${assignment.cadUnit.user.id}`).emit("notification", notification);
      }

      await auditAction(prisma, req, {
        actorId: user.id,
        action: "cad.unit.assign",
        entity: "UnitAssignment",
        entityId: assignment.id,
        metadata: { cadCallId: req.params.id, unitId: body.unitId }
      });

      io.to("department-users").emit("cad:unit-assigned", assignment);
      res.status(201).json({ assignment });
    })
  );

  app.post(
    "/api/cad/units",
    requireAuth,
    requireDispatcher,
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          departmentId: text(80),
          userId: optionalText(80),
          unitNumber: text(40),
          currentLocation: optionalText(140)
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const user = authed(req);
      const unit = await prisma.cadUnit.create({
        data: {
          departmentId: body.departmentId,
          userId: body.userId,
          unitNumber: body.unitNumber,
          currentLocation: body.currentLocation
        },
        include: { department: true, user: { select: { id: true, name: true, role: true } } }
      });

      await auditAction(prisma, req, {
        actorId: user.id,
        action: "cad.unit.create",
        entity: "CadUnit",
        entityId: unit.id
      });

      io.to("department-users").emit("unit:status", unit);
      res.status(201).json({ unit });
    })
  );

  app.patch(
    "/api/cad/units/:id/status",
    requireAuth,
    requireDepartment,
    asyncHandler(async (req, res) => {
      const body = parseBody(z.object({ status: z.enum(Object.keys(unitStatusLabels) as [string, ...string[]]) }), req, res);
      if (!body) return;

      const prisma = getPrisma();
      const user = authed(req);
      const unit = await prisma.cadUnit.update({
        where: { id: req.params.id },
        data: { status: body.status as any },
        include: { department: true, user: { select: { id: true, name: true, role: true } } }
      });

      await auditAction(prisma, req, {
        actorId: user.id,
        action: "cad.unit.status",
        entity: "CadUnit",
        entityId: unit.id,
        metadata: { status: body.status }
      });

      io.to("department-users").emit("unit:status", unit);
      res.json({ unit });
    })
  );

  app.get(
    "/api/cad/search/people",
    requireAuth,
    requireDepartment,
    asyncHandler(async (req, res) => {
      const q = parseQuery(req.query.q, 120);
      const prisma = getPrisma();
      const people = q
        ? await prisma.user.findMany({
            where: {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { profile: { firstName: { contains: q, mode: "insensitive" } } },
                { profile: { lastName: { contains: q, mode: "insensitive" } } }
              ]
            },
            select: {
              id: true,
              name: true,
              role: true,
              phone: true,
              profile: true,
              vehicles: true,
              licenses: true,
              permits: true
            },
            take: 15
          })
        : [];
      res.json({ people });
    })
  );

  app.get(
    "/api/cad/search/vehicles",
    requireAuth,
    requireDepartment,
    asyncHandler(async (req, res) => {
      const q = parseQuery(req.query.q || req.query.plate, 80);
      const prisma = getPrisma();
      const vehicles = q
        ? await prisma.vehicle.findMany({
            where: {
              OR: [
                { plate: { contains: q, mode: "insensitive" } },
                { vin: { contains: q, mode: "insensitive" } },
                { make: { contains: q, mode: "insensitive" } },
                { model: { contains: q, mode: "insensitive" } }
              ]
            },
            include: { owner: { select: { id: true, name: true, role: true, profile: true } } },
            take: 15
          })
        : [];
      res.json({ vehicles });
    })
  );

  app.get(
    "/api/cad/records",
    requireAuth,
    requireDepartment,
    asyncHandler(async (_req, res) => {
      const prisma = getPrisma();
      const [warrants, citations, bolos, vehicles, licenses, incidentReports, arrestReports, fireReports, emsReports] =
        await Promise.all([
          prisma.warrant.findMany({ orderBy: { issuedAt: "desc" }, take: 50 }),
          prisma.citation.findMany({ orderBy: { issuedAt: "desc" }, take: 50 }),
          prisma.bolo.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
          prisma.vehicle.findMany({
            include: { owner: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
            take: 50
          }),
          prisma.license.findMany({
            include: { user: { select: { id: true, name: true } } },
            orderBy: { issuedAt: "desc" },
            take: 50
          }),
          prisma.incidentReport.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
          prisma.arrestReport.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
          prisma.fireReport.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
          prisma.eMSReport.findMany({ orderBy: { createdAt: "desc" }, take: 25 })
        ]);

      res.json({ warrants, citations, bolos, vehicles, licenses, incidentReports, arrestReports, fireReports, emsReports });
    })
  );

  app.post(
    "/api/cad/bolos",
    requireAuth,
    requireDepartment,
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          title: text(140),
          description: text(1200),
          plate: optionalText(20),
          personName: optionalText(120),
          vehicleDescription: optionalText(240)
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const user = authed(req);
      const bolo = await prisma.bolo.create({ data: { ...body, createdById: user.id } });
      await auditAction(prisma, req, { actorId: user.id, action: "records.bolo.create", entity: "Bolo", entityId: bolo.id });
      io.to("department-users").emit("records:bolo", bolo);
      res.status(201).json({ bolo });
    })
  );

  app.post(
    "/api/cad/warrants",
    requireAuth,
    requireDepartment,
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          subjectName: text(140),
          charges: text(1000),
          issuingCourt: optionalText(140),
          severity: z.enum(["low", "routine", "priority", "emergency"]).default("routine")
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const user = authed(req);
      const warrant = await prisma.warrant.create({
        data: {
          subjectName: body.subjectName,
          charges: body.charges,
          issuingCourt: body.issuingCourt || "FairCroft Municipal Court",
          severity: body.severity,
          createdById: user.id
        }
      });
      await auditAction(prisma, req, {
        actorId: user.id,
        action: "records.warrant.create",
        entity: "Warrant",
        entityId: warrant.id
      });
      res.status(201).json({ warrant });
    })
  );

  app.post(
    "/api/cad/citations",
    requireAuth,
    requireDepartment,
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          subjectName: text(140),
          statute: text(80),
          description: text(1000),
          fineCents: z.coerce.number().int().min(0).max(250000).default(0),
          location: optionalText(160)
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const user = authed(req);
      const citation = await prisma.citation.create({
        data: { ...body, officerId: user.id }
      });
      await auditAction(prisma, req, {
        actorId: user.id,
        action: "records.citation.create",
        entity: "Citation",
        entityId: citation.id
      });
      res.status(201).json({ citation });
    })
  );

  app.post(
    "/api/cad/reports/:type",
    requireAuth,
    requireDepartment,
    asyncHandler(async (req, res) => {
      const reportType = cleanText(req.params.type, 40);
      const prisma = getPrisma();
      const user = authed(req);
      const base = z.object({
        cadCallId: optionalText(80),
        title: optionalText(160),
        narrative: text(1800)
      });
      const body = parseBody(base.catchall(z.any()), req, res);
      if (!body) return;

      let report: any;
      if (reportType === "incident") {
        report = await prisma.incidentReport.create({
          data: {
            cadCallId: body.cadCallId,
            authorId: user.id,
            departmentId: user.memberships?.[0]?.departmentId,
            reportNumber: makeCallNumber("FC-IR"),
            title: body.title || "Incident Report",
            narrative: body.narrative
          }
        });
      } else if (reportType === "arrest") {
        report = await prisma.arrestReport.create({
          data: {
            cadCallId: body.cadCallId,
            arrestingOfficerId: user.id,
            subjectName: cleanText(req.body.subjectName, 140) || "Unknown Subject",
            charges: cleanText(req.body.charges, 1000) || "Pending review",
            narrative: body.narrative,
            bookingNumber: makeCallNumber("FC-BOOK")
          }
        });
      } else if (reportType === "fire") {
        report = await prisma.fireReport.create({
          data: {
            cadCallId: body.cadCallId,
            authorId: user.id,
            incidentType: cleanText(req.body.incidentType, 120) || "Fire Service Call",
            cause: cleanText(req.body.cause, 160) || undefined,
            actions: cleanText(req.body.actions, 1000) || body.narrative,
            narrative: body.narrative
          }
        });
      } else if (reportType === "ems") {
        report = await prisma.eMSReport.create({
          data: {
            cadCallId: body.cadCallId,
            authorId: user.id,
            patientName: cleanText(req.body.patientName, 140) || "Roleplay Patient",
            patientAge: req.body.patientAge ? Number(req.body.patientAge) : undefined,
            chiefComplaint: cleanText(req.body.chiefComplaint, 500) || "Roleplay only",
            careProvided: cleanText(req.body.careProvided, 1200) || body.narrative,
            disposition: cleanText(req.body.disposition, 500) || "Roleplay disposition",
            roleplayOnly: true
          }
        });
      } else {
        res.status(404).json({ error: "Unknown report type." });
        return;
      }

      await auditAction(prisma, req, {
        actorId: user.id,
        action: `reports.${reportType}.create`,
        entity: `${reportType}Report`,
        entityId: report.id
      });

      res.status(201).json({ report });
    })
  );

  app.get(
    "/api/admin/overview",
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const prisma = getPrisma();
      const [users, pendingApplications, departments, activeCalls, auditLogs] = await Promise.all([
        prisma.user.count(),
        prisma.departmentApplication.count({ where: { status: "pending" } }),
        prisma.department.count(),
        prisma.cadCall.count({ where: { status: { in: ["active", "assigned", "on_scene"] as any } } }),
        prisma.auditLog.findMany({
          include: { actor: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: "desc" },
          take: 20
        })
      ]);
      res.json({ metrics: { users, pendingApplications, departments, activeCalls }, auditLogs });
    })
  );

  app.get(
    "/api/admin/applications",
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const prisma = getPrisma();
      const applications = await prisma.departmentApplication.findMany({
        include: {
          user: { select: { id: true, name: true, email: true, role: true, profile: true } },
          department: true,
          reviewedBy: { select: { id: true, name: true } }
        },
        orderBy: { submittedAt: "desc" }
      });
      res.json({ applications });
    })
  );

  app.post(
    "/api/admin/applications/:id/decision",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          decision: z.enum(["approved", "denied"]),
          rankId: optionalText(80),
          role: z
            .enum(["police", "sheriff", "fire", "ems", "dispatcher", "department_supervisor"])
            .optional(),
          badgeNumber: optionalText(40),
          reason: optionalText(500)
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const admin = authed(req);
      const application = await prisma.departmentApplication.findUnique({
        where: { id: req.params.id },
        include: { department: true, user: true }
      });
      if (!application || application.status !== "pending") {
        res.status(404).json({ error: "Pending application not found." });
        return;
      }

      const role = body.role || (roleForDepartmentType(application.department.type) as any);
      const updated = await prisma.$transaction(async (tx) => {
        const decided = await tx.departmentApplication.update({
          where: { id: application.id },
          data: {
            status: body.decision,
            decisionReason: body.reason,
            reviewedAt: new Date(),
            reviewedById: admin.id
          },
          include: { department: true, user: true }
        });

        if (body.decision === "approved") {
          await tx.departmentMembership.upsert({
            where: {
              userId_departmentId: {
                userId: application.userId,
                departmentId: application.departmentId
              }
            },
            create: {
              userId: application.userId,
              departmentId: application.departmentId,
              rankId: body.rankId,
              role,
              badgeNumber: body.badgeNumber,
              active: true
            },
            update: {
              rankId: body.rankId,
              role,
              badgeNumber: body.badgeNumber,
              active: true
            }
          });

          await tx.user.update({
            where: { id: application.userId },
            data: { role }
          });

          await tx.notification.create({
            data: {
              userId: application.userId,
              title: "Department Application Approved",
              body: `Approved for ${application.department.name}. MDT access is now enabled.`,
              type: "application",
              payload: { applicationId: application.id, departmentId: application.departmentId } as Prisma.InputJsonValue
            }
          });
        } else {
          const activeMemberships = await tx.departmentMembership.count({
            where: { userId: application.userId, active: true }
          });
          if (!activeMemberships) {
            await tx.user.update({ where: { id: application.userId }, data: { role: "civilian" } });
          }

          await tx.notification.create({
            data: {
              userId: application.userId,
              title: "Department Application Decision",
              body: `Application for ${application.department.name} was denied.${body.reason ? ` Reason: ${body.reason}` : ""}`,
              type: "application",
              payload: { applicationId: application.id, departmentId: application.departmentId } as Prisma.InputJsonValue
            }
          });
        }

        return decided;
      });

      await auditAction(prisma, req, {
        actorId: admin.id,
        action: `admin.application.${body.decision}`,
        entity: "DepartmentApplication",
        entityId: application.id,
        metadata: { role, rankId: body.rankId }
      });

      io.to(`user:${application.userId}`).emit("notification", {
        title: "Application updated",
        body: `Your ${application.department.name} application was ${body.decision}.`
      });
      res.json({ application: updated });
    })
  );

  app.get(
    "/api/admin/users",
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const prisma = getPrisma();
      const users = await prisma.user.findMany({
        include: userInclude,
        orderBy: { createdAt: "desc" },
        take: 250
      });
      res.json({ users: users.map(publicUser) });
    })
  );

  app.patch(
    "/api/admin/users/:id",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          role: z
            .enum([
              "civilian",
              "pending_department",
              "police",
              "sheriff",
              "fire",
              "ems",
              "dispatcher",
              "department_supervisor",
              "site_admin",
              "owner"
            ])
            .optional(),
          suspended: z.boolean().optional(),
          name: optionalText(120),
          phone: optionalText(40)
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const admin = authed(req);
      const updateData: any = {};
      if (body.role) updateData.role = body.role;
      if (typeof body.suspended === "boolean") updateData.suspended = body.suspended;
      if (body.name) updateData.name = body.name;
      if (body.phone) updateData.phone = body.phone;

      const user = await prisma.user.update({
        where: { id: req.params.id },
        data: updateData,
        include: userInclude
      });

      await auditAction(prisma, req, {
        actorId: admin.id,
        action: "admin.user.update",
        entity: "User",
        entityId: user.id,
        metadata: updateData
      });

      res.json({ user: publicUser(user) });
    })
  );

  app.get(
    "/api/admin/departments",
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const prisma = getPrisma();
      const departments = await prisma.department.findMany({
        include: { ranks: { orderBy: { level: "asc" } }, memberships: { include: { user: true, rank: true } } },
        orderBy: { name: "asc" }
      });
      res.json({ departments });
    })
  );

  app.post(
    "/api/admin/departments",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          name: text(140),
          code: text(20),
          type: z.enum(["police", "sheriff", "fire", "ems", "dispatch"]),
          description: optionalText(500)
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const admin = authed(req);
      const department = await prisma.department.create({
        data: { ...body, code: body.code.toUpperCase() }
      });
      await auditAction(prisma, req, {
        actorId: admin.id,
        action: "admin.department.create",
        entity: "Department",
        entityId: department.id
      });
      res.status(201).json({ department });
    })
  );

  app.post(
    "/api/admin/ranks",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          departmentId: text(80),
          name: text(120),
          level: z.coerce.number().int().min(1).max(999).default(1),
          permissions: z.record(z.string(), z.any()).default({})
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const admin = authed(req);
      const rank = await prisma.rank.create({ data: body });
      await auditAction(prisma, req, {
        actorId: admin.id,
        action: "admin.rank.create",
        entity: "Rank",
        entityId: rank.id
      });
      res.status(201).json({ rank });
    })
  );

  app.get(
    "/api/admin/audit-logs",
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const prisma = getPrisma();
      const auditLogs = await prisma.auditLog.findMany({
        include: { actor: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: "desc" },
        take: 200
      });
      res.json({ auditLogs });
    })
  );

  app.delete(
    "/api/admin/records/:type/:id",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const prisma = getPrisma();
      const admin = authed(req);
      const type = cleanText(req.params.type, 40);
      const id = cleanText(req.params.id, 80);
      const map: Record<string, () => Promise<unknown>> = {
        vehicle: () => prisma.vehicle.delete({ where: { id } }),
        license: () => prisma.license.delete({ where: { id } }),
        permit: () => prisma.permit.delete({ where: { id } }),
        warrant: () => prisma.warrant.delete({ where: { id } }),
        citation: () => prisma.citation.delete({ where: { id } }),
        bolo: () => prisma.bolo.delete({ where: { id } }),
        incidentReport: () => prisma.incidentReport.delete({ where: { id } }),
        arrestReport: () => prisma.arrestReport.delete({ where: { id } }),
        fireReport: () => prisma.fireReport.delete({ where: { id } }),
        emsReport: () => prisma.eMSReport.delete({ where: { id } })
      };

      if (!map[type]) {
        res.status(404).json({ error: "Unsupported fake record type." });
        return;
      }

      await map[type]();
      await auditAction(prisma, req, {
        actorId: admin.id,
        action: "admin.record.delete",
        entity: type,
        entityId: id
      });
      res.json({ ok: true });
    })
  );

  app.patch(
    "/api/admin/civilian-records/:userId",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = parseBody(
        z.object({
          notes: optionalText(1000),
          recordFlags: z.array(z.string().max(80).transform((value) => cleanText(value, 80))).default([])
        }),
        req,
        res
      );
      if (!body) return;

      const prisma = getPrisma();
      const admin = authed(req);
      const profile = await prisma.civilianProfile.update({
        where: { userId: req.params.userId },
        data: {
          notes: body.notes,
          recordFlags: body.recordFlags
        }
      });
      await auditAction(prisma, req, {
        actorId: admin.id,
        action: "admin.civilian-record.update",
        entity: "CivilianProfile",
        entityId: profile.id
      });
      res.json({ profile });
    })
  );

  app.get(
    "/api/admin/settings",
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const prisma = getPrisma();
      const settings = await prisma.serverSetting.findMany({ orderBy: { key: "asc" } });
      res.json({ settings });
    })
  );

  app.patch(
    "/api/admin/settings",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = parseBody(z.object({ key: text(80), value: z.record(z.string(), z.any()).default({}) }), req, res);
      if (!body) return;

      const prisma = getPrisma();
      const admin = authed(req);
      const setting = await prisma.serverSetting.upsert({
        where: { key: body.key },
        create: { key: body.key, value: body.value },
        update: { value: body.value }
      });
      await auditAction(prisma, req, {
        actorId: admin.id,
        action: "admin.setting.update",
        entity: "ServerSetting",
        entityId: setting.id,
        metadata: { key: setting.key }
      });
      res.json({ setting });
    })
  );

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "FairCroft CoreOne API route not found." });
  });
}
