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
app.use(cors());
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

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal", message: err.message });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`predictable-api listening on http://localhost:${port}`);
});
