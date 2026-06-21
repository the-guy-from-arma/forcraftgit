import "dotenv/config";

import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { Server as SocketIOServer } from "socket.io";
import { initializeDatabase, shutdownDatabase } from "./src/server/database.js";
import { registerApi } from "./src/server/routes.js";
import { registerSocketHandlers } from "./src/server/socket.js";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOST || "0.0.0.0";
const serverFile = fileURLToPath(import.meta.url);
const projectDir = dev ? process.cwd() : path.resolve(path.dirname(serverFile), "..");

const nextImport = (await import("next")) as any;
const nextConfig = { dev, hostname, port, dir: projectDir };
const nextApp = nextImport.default ? nextImport.default(nextConfig) : nextImport(nextConfig);
const handle = nextApp.getRequestHandler();

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  : undefined;

await initializeDatabase();
console.log(`[server] Preparing Next.js from ${projectDir}.`);
await nextApp.prepare();

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: allowedOrigins || true,
    credentials: true
  }
});

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);
app.use(
  cors({
    origin: allowedOrigins || true,
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

registerSocketHandlers(io);
registerApi(app, io);

app.all("*", (req, res) => handle(req, res));

httpServer.listen(port, hostname, () => {
  console.log(`FairCroft CoreOne ready on ${hostname}:${port}`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received. Closing FairCroft CoreOne gracefully.`);

  httpServer.close(async () => {
    await shutdownDatabase();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
