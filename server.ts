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

process.on("uncaughtException", (error) => {
  console.error("[server] uncaughtException", error);
});
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection", reason);
});

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

app.use((req, res, nextMiddleware) => {
  const shouldLog =
    req.method === "GET" &&
    !req.path.startsWith("/_next/") &&
    !req.path.startsWith("/icons/") &&
    req.path !== "/favicon.ico";

  if (!shouldLog) {
    nextMiddleware();
    return;
  }

  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(`[request] ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${Date.now() - startedAt}ms`);
  });
  nextMiddleware();
});

app.get("/__coreone/preflight.json", (_req, res) => {
  res.json({
    ok: true,
    name: "FairCroft CoreOne",
    layer: "express",
    nextProjectDir: projectDir,
    nodeEnv: process.env.NODE_ENV || "development",
    railwayEnvironment: process.env.RAILWAY_ENVIRONMENT || null,
    timestamp: new Date().toISOString()
  });
});

app.get("/__coreone/preflight", (_req, res) => {
  res
    .status(200)
    .type("html")
    .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>FairCroft CoreOne Preflight</title>
    <style>
      :root { color-scheme: dark; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        color: #f7fbff;
        background:
          radial-gradient(circle at 20% 10%, rgba(94,168,255,.35), transparent 32rem),
          radial-gradient(circle at 80% 90%, rgba(242,196,109,.25), transparent 30rem),
          linear-gradient(135deg, #07111f, #0b1424 45%, #03060c);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      }
      main {
        width: min(680px, 100%);
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 28px;
        padding: 28px;
        background: rgba(255,255,255,.08);
        box-shadow: 0 24px 80px rgba(0,0,0,.35);
      }
      p:first-child {
        color: #f2c46d;
        font-size: 12px;
        font-weight: 900;
        letter-spacing: .18em;
        text-transform: uppercase;
      }
      h1 { margin: 0 0 12px; font-size: clamp(34px, 8vw, 64px); }
      a {
        display: inline-flex;
        margin-top: 18px;
        border-radius: 999px;
        padding: 12px 18px;
        color: #06101d;
        background: #f2c46d;
        font-weight: 900;
        text-decoration: none;
      }
      code {
        color: #9ef7da;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <main>
      <p>FairCroft CoreOne Preflight</p>
      <h1>Server is painting HTML.</h1>
      <p>If this page shows, Railway and Express are alive. A white screen on the main app is inside the Next/React layer.</p>
      <p>Next project root: <code>${projectDir}</code></p>
      <a href="/">Open CoreOne</a>
    </main>
  </body>
</html>`);
});

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
