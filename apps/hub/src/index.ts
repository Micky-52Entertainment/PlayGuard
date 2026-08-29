import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectEngine, describeEngine } from "@playable-lab/adapters";
import { DEVICE_CATALOG } from "@playable-lab/device-catalog";
import { wrapPlayableHtml } from "@playable-lab/playable-host";
import type { EngineKind, Orientation, PlayableRef, SessionTrace } from "@playable-lab/protocol";
import { defaultTestChain } from "@playable-lab/test-chain";
import cors from "cors";
import express from "express";
import QRCode from "qrcode";
import { WebSocketServer } from "ws";
import { HubBus } from "./bus.ts";
import { lanIPv4 } from "./lan.ts";
import { renderViewPage } from "./view-page.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PORT = Number(process.env.HUB_PORT || 8787);
const tracesDir = path.join(ROOT, "traces");
const playablesDir = path.join(ROOT, "playables");

const playables = new Map<string, PlayableRef & { html: string }>();

const ensureDirs = async (): Promise<void> => {
  await mkdir(tracesDir, { recursive: true });
  await mkdir(playablesDir, { recursive: true });
};

const persistTrace = async (trace: SessionTrace): Promise<void> => {
  const file = path.join(tracesDir, `${trace.sessionId}.json`);
  await writeFile(file, JSON.stringify(trace, null, 2), "utf8");
};

const addPlayable = (
  id: string,
  name: string,
  html: string,
  engine: EngineKind
): PlayableRef & { html: string } => {
  const playable: PlayableRef & { html: string } = {
    id,
    engine,
    name,
    url: `/playables/${id}/index.html`,
    html,
  };
  playables.set(id, playable);
  return playable;
};

const seedSamplePlayable = async (): Promise<void> => {
  const samplePath = path.join(ROOT, "samples/playable/index.html");
  const html = await readFile(samplePath, "utf8");
  addPlayable("sample-tap", "Sample Tap Target", html, "vanilla");
};

const restorePlayables = async (): Promise<void> => {
  let ids: string[] = [];
  try {
    ids = await readdir(playablesDir);
  } catch {
    return;
  }
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (id.startsWith(".")) {
      continue;
    }
    try {
      const html = await readFile(path.join(playablesDir, id, "source.html"), "utf8");
      addPlayable(id, id, html, detectEngine(html, id));
    } catch {
      continue;
    }
  }
};

const originUrls = () => {
  const host = lanIPv4();
  return {
    http: `http://${host}:${PORT}`,
    ws: `ws://${host}:${PORT}/ws`,
  };
};

const start = async (): Promise<void> => {
  await ensureDirs();
  await restorePlayables();
  await seedSamplePlayable();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "12mb" }));

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const bus = new HubBus(wss, persistTrace);

  app.get("/api/meta", (_req, res) => {
    const urls = originUrls();
    res.json({
      hubHttpUrl: urls.http,
      hubWsUrl: urls.ws,
      engines: ["luna", "cocos", "vanilla"],
    });
  });

  app.get("/api/devices", (_req, res) => {
    res.json(DEVICE_CATALOG);
  });

  app.get("/api/chains", (_req, res) => {
    res.json([defaultTestChain()]);
  });

  app.get("/api/playables", (_req, res) => {
    const list: PlayableRef[] = [];
    playables.forEach((item) => {
      list.push({
        id: item.id,
        engine: item.engine,
        name: item.name,
        url: item.url,
      });
    });
    res.json(list);
  });

  app.post("/api/playables", async (req, res) => {
    const html = String(req.body?.html || "");
    const name = String(req.body?.name || "untitled.html");
    if (!html) {
      res.status(400).json({ error: "html is required" });
      return;
    }
    const engine = (req.body?.engine as EngineKind) || detectEngine(html, name);
    const id = `p_${Date.now().toString(36)}`;
    const dir = path.join(playablesDir, id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "source.html"), html, "utf8");
    addPlayable(id, name, html, engine);
    res.json({
      id,
      engine,
      name,
      url: `/playables/${id}/index.html`,
      engineLabel: describeEngine(engine),
    });
  });

  app.get("/playables/:id/index.html", (req, res) => {
    const item = playables.get(req.params.id);
    if (!item) {
      res.status(404).send("Playable not found");
      return;
    }
    const asSource = req.query.source === "1";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(wrapPlayableHtml(item.html, asSource));
  });

  app.post("/api/sessions", async (req, res) => {
    const playableId = String(req.body?.playableId || "sample-tap");
    const playable = playables.get(playableId);
    if (!playable) {
      res.status(404).json({ error: "Playable not found" });
      return;
    }
    const orientationLock = (req.body?.orientationLock || "portrait") as Orientation;
    const session = bus.createSession({
      playable,
      orientationLock,
      chainId: req.body?.chainId,
      stepId: req.body?.stepId,
    });
    const urls = originUrls();
    const playUrl = `${urls.http}/play/${session.id}?orientation=${orientationLock}`;
    const qrDataUrl = await QRCode.toDataURL(playUrl, { margin: 1, width: 320 });
    res.json({
      sessionId: session.id,
      playUrl,
      qrDataUrl,
      orientationLock,
      pairing: {
        v: 1,
        hubHttpUrl: urls.http,
        hubWsUrl: urls.ws,
        sessionId: session.id,
        playUrl,
        orientationLock,
        engine: playable.engine,
      },
    });
  });

  app.post("/api/sessions/:id/end", async (req, res) => {
    const trace = await bus.end(req.params.id);
    if (!trace) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(trace);
  });

  app.post("/api/sessions/:id/abort", async (req, res) => {
    const trace = await bus.abort(
      req.params.id,
      String(req.body?.reason || "Aborted by operator"),
      "USER_ABORT"
    );
    if (!trace) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(trace);
  });

  app.get("/api/traces", async (_req, res) => {
    const files = await readdir(tracesDir);
    res.json(files.filter((file) => file.endsWith(".json")));
  });

  app.get("/api/traces/:id", async (req, res) => {
    const file = path.join(tracesDir, req.params.id.endsWith(".json") ? req.params.id : `${req.params.id}.json`);
    try {
      const raw = await readFile(file, "utf8");
      res.type("json").send(raw);
    } catch {
      res.status(404).json({ error: "Trace not found" });
    }
  });

  app.get(["/play/:sessionId", "/view/:sessionId"], (req, res) => {
    const session = bus.getSession(req.params.sessionId);
    if (!session) {
      res.status(404).send("Session not found");
      return;
    }
    const role = req.path.startsWith("/play") || req.query.role === "source" ? "source" : "slave";
    const playableSrc = `/playables/${session.playable.id}/index.html?source=${role === "source" ? "1" : "0"}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      renderViewPage({
        sessionId: session.id,
        role,
        playableSrc,
        orientationLock: session.orientationLock,
      })
    );
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    const urls = originUrls();
    console.log(`Playable Lab Hub ${urls.http}`);
    console.log(`WebSocket ${urls.ws}`);
  });
};

void start();
