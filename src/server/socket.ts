import type { Server as SocketIOServer } from "socket.io";
import { getPrisma } from "./db";
import { resolveUserFromToken } from "./auth";
import { canAccessDepartment, canAccessDispatch, cleanText, unitStatusLabels } from "./security";

export function registerSocketHandlers(io: SocketIOServer) {
  io.use(async (socket, next) => {
    const token =
      typeof socket.handshake.auth?.token === "string"
        ? socket.handshake.auth.token
        : typeof socket.handshake.headers.authorization === "string"
          ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, "")
          : null;

    const resolved = await resolveUserFromToken(token);
    if (!resolved) {
      next(new Error("unauthorized"));
      return;
    }

    socket.data.user = resolved.user;
    socket.data.session = resolved.session;
    next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);

    if (canAccessDepartment(user.role)) {
      socket.join("department-users");
      for (const membership of user.memberships || []) {
        socket.join(`department:${membership.departmentId}`);
      }
    }

    if (canAccessDispatch(user.role)) {
      socket.join("dispatchers");
    }

    socket.emit("system:ready", {
      message: "FairCroft CoreOne live link established.",
      role: user.role
    });

    socket.on("dispatch:message", async (payload: { body?: string; channel?: string }) => {
      if (!canAccessDepartment(user.role)) return;

      const prisma = getPrisma();
      const body = cleanText(payload.body, 500);
      const channel = cleanText(payload.channel || "dispatch", 50) || "dispatch";
      if (!body) return;

      const message = await prisma.dispatchMessage.create({
        data: {
          userId: user.id,
          body,
          channel
        },
        include: {
          user: { select: { id: true, name: true, role: true } }
        }
      });

      io.to("department-users").emit("dispatch:message", message);
    });

    socket.on("unit:status", async (payload: { unitId?: string; status?: string }) => {
      if (!canAccessDepartment(user.role)) return;
      if (!payload.unitId || !payload.status || !unitStatusLabels[payload.status]) return;

      const prisma = getPrisma();
      const unit = await prisma.cadUnit.findFirst({
        where: {
          id: payload.unitId,
          OR: [{ userId: user.id }, { department: { memberships: { some: { userId: user.id, active: true } } } }]
        }
      });

      if (!unit) return;

      const updated = await prisma.cadUnit.update({
        where: { id: unit.id },
        data: { status: payload.status as any },
        include: { department: true, user: { select: { id: true, name: true, role: true } } }
      });

      io.to("department-users").emit("unit:status", updated);
    });
  });
}
