import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import episodesRouter from "./routes/episodes.js";
import callsRouter from "./routes/calls.js";
import marketsRouter from "./routes/markets.js";
import scoreboardRouter from "./routes/scoreboard.js";
import miscRouter from "./routes/misc.js";
import adminRouter from "./routes/admin.js";

dotenv.config();

const app = express();
// Strip Express's "x-powered-by: Express" header — no need to advertise the stack.
app.disable("x-powered-by");

// CORS: in prod the SPA is same-origin (served via the nginx /api proxy), so the
// only legit cross-origin callers are local dev (vite on :5173) and explicit allowlist.
// Default-allow when CORS_ORIGINS is unset so dev/staging keep working; lock down in prod env.
const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length === 0
      ? true // dev fallback — reflect request origin
      : (origin, cb) => {
          // Same-origin / curl / server-side fetches have no Origin header — let through.
          if (!origin) return cb(null, true);
          cb(null, allowedOrigins.includes(origin));
        },
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use("/api/episodes", episodesRouter);
app.use("/api/calls", callsRouter);
app.use("/api/markets", marketsRouter);
app.use("/api/scoreboard", scoreboardRouter);
app.use("/api", miscRouter);
app.use("/api/admin", adminRouter);

// JSON 404 for any /api/* path that didn't match a route — better than Express's
// default HTML for clients that always expect JSON.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal", message: err.message });
});

// Default to 3801 (the nginx upstream). Port 3001 on the prod box is
// permanently held by another tenant's docker-proxy, so defaulting there
// would crash-loop on EADDRINUSE if pm2 ever resurrected without PORT set.
const port = Number(process.env.PORT ?? 3801);
app.listen(port, () => {
  console.log(`predictable-api listening on http://localhost:${port}`);
});
