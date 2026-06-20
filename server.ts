import "dotenv/config";

import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { registerApi } from "./src/server/routes";
import { registerSocketHandlers } from "./src/server/socket";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOST || "0.0.0.0";

const nextApp = next({ dev, hostname, port });
const handle = nextApp.getRequestHandler();

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  : undefined;

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
