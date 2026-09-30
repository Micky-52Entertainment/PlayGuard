import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectEngine, describeEngine } from "@playable-lab/adapters";
import { AD_NETWORKS, guessNetwork, linkGate, networkById, overallStatus, runStaticChecks, scanSourceRefs } from "@playable-lab/checks";
import { DEVICE_CATALOG } from "@playable-lab/device-catalog";
import { wrapPlayableHtml } from "@playable-lab/playable-host";
import type { EngineKind, Orientation, PlayableRef, SessionTrace } from "@playable-lab/protocol";
import { defaultTestChain } from "@playable-lab/test-chain";
import cors from "cors";
import express from "express";
import QRCode from "qrcode";
import { isZip, writeZip } from "@playable-lab/zip";
import type { ZipEntry } from "@playable-lab/zip";
import { WebSocketServer } from "ws";
import { BatchStore } from "./batches.ts";
import { renderBrief } from "./brief.ts";
import type { RunReport } from "../../playwright-runner/src/report.ts";
import { summarize } from "../../playwright-runner/src/summary.ts";
import { batchPack, reportPack } from "./pack.ts";
import { HubBus } from "./bus.ts";
import { Health } from "./health.ts";
import { lanIPv4 } from "./lan.ts";
import { Library } from "./library.ts";
import { asDepth, asLang, lastLine, runRunner, runnerDefaults } from "./runner.ts";
import { renderSheet } from "./sheet.ts";
import { Simulator } from "./simulator.ts";
import { RunStore } from "./runs.ts";
import { Settings, isProvider } from "./settings.ts";
import { entriesOf, removeEntry, sizeOf } from "./storage.ts";
import { Sharing } from "./share.ts";
import type { StorageReport } from "./storage.ts";
import { renderViewPage } from "./view-page.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PORT = Number(process.env.HUB_PORT || 8787);
/** Where recordings, reports and settings live: the project folder, or a separate one (the site's own tests use a scratch folder). */
const DATA = process.env.PLAYGUARD_DATA ? path.resolve(process.env.PLAYGUARD_DATA) : ROOT;
const tracesDir = path.join(DATA, "traces");
const playablesDir = path.join(DATA, "playables");
const reportsDir = path.join(DATA, "reports");
const batchesDir = path.join(DATA, "batches");

/** Folders of multi-file builds, for the assets their HTML asks for. */
const playableDirs = new Map<string, string>();

const playables = new Map<string, PlayableRef & { html: string }>();

/** Where each playable's entry HTML is on disk, for runs that need no recording. */
const playableFiles = new Map<string, { file: string; bundleBytes?: number }>();

/** Every file under a folder, as zip entries below `prefix`. */
const readFolder = async (root: string, prefix: string): Promise<ZipEntry[]> => {
  const out: ZipEntry[] = [];
  const items = await readdir(root, { withFileTypes: true });
  for (let i = 0; i < items.length; i += 1) {
    const target = path.join(root, items[i].name);
    const name = `${prefix}/${items[i].name}`;
    if (items[i].isDirectory()) {
      out.push(...(await readFolder(target, name)));
    } else if (items[i].isFile()) {
      out.push({ name, data: await readFile(target) });
    }
  }
  return out;
};

/** Settings and runs spend the operator's money and disk: only this computer may ask. */
const localOnly: express.RequestHandler = (req, res, next) => {
  const address = req.socket.remoteAddress || "";
  // A page from elsewhere, open in the operator's browser, also arrives from this computer.
  const origin = req.headers.origin;
  let ownPage = true;
  if (origin) {
    try {
      ownPage = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
    } catch {
      ownPage = false;
    }
  }
  if (ownPage && (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1")) {
    next();
    return;
  }
  res.status(403).json({ error: "Only available on the computer that runs the lab.", code: "LOCAL_ONLY" });
};

/** The request comes from this computer, not from a teammate's. */
const isLocal = (req: express.Request): boolean => {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
};

/**
 * For what the whole team does — checks, AI runs: the request must come from
 * the lab's own page, whichever computer opened it. A page of another site,
 * open in someone's browser, is refused.
 */
const ownPage: express.RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const from = new URL(origin);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(from.hostname);
      if (!local && from.host !== req.headers.host) {
        res.status(403).json({ error: "Requests from other sites are refused.", code: "LOCAL_ONLY" });
        return;
      }
    } catch {
      res.status(403).json({ error: "Requests from other sites are refused.", code: "LOCAL_ONLY" });
      return;
    }
  }
  next();
};

/** The console, built once, served by the hub itself so a teammate needs only a link. */
const CONSOLE_DIR = path.join(ROOT, "apps/lab-console/dist");

/** The name a teammate gave the console, kept short and plain. */
/**
 * Optional paging and search for list endpoints: `?q=text&limit=N&offset=M`.
 * With none of them the whole list is sent, as before. With any of them the
 * array shape stays the same and the matching count goes in X-Total-Count.
 */
const pageOf = <T>(req: express.Request, res: express.Response, list: T[], text: (item: T) => string): T[] => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const hasLimit = typeof req.query.limit === "string" && req.query.limit !== "";
  const hasOffset = typeof req.query.offset === "string" && req.query.offset !== "";
  if (!q && !hasLimit && !hasOffset) {
    return list;
  }
  const matched = q ? list.filter((item) => text(item).toLowerCase().includes(q)) : list;
  const offset = hasOffset ? Math.max(0, Math.floor(Number(req.query.offset)) || 0) : 0;
  const limit = hasLimit ? Math.max(0, Math.floor(Number(req.query.limit)) || 0) : matched.length;
  res.setHeader("X-Total-Count", String(matched.length));
  return matched.slice(offset, offset + limit);
};

const byOf = (value: unknown): string | undefined => {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) : "";
  return text || undefined;
};

const ensureDirs = async (): Promise<void> => {
  await mkdir(tracesDir, { recursive: true });
  await mkdir(playablesDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });
  await mkdir(batchesDir, { recursive: true });
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
  playableFiles.set("sample-tap", { file: samplePath });
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
      let name = id;
      try {
        const meta = JSON.parse(await readFile(path.join(playablesDir, id, "meta.json"), "utf8"));
        name = String(meta.name || id);
      } catch {
        // Uploaded before names were stored next to the source.
      }
      addPlayable(id, name, html, detectEngine(html, name));
      playableFiles.set(id, { file: path.join(playablesDir, id, "source.html") });
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
  app.use(cors({ exposedHeaders: ["X-Total-Count"] }));
  app.use(express.json({ limit: "12mb" }));

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const bus = new HubBus(wss, persistTrace);
  const library = new Library(ROOT, tracesDir, reportsDir);
  const batches = new BatchStore(ROOT, batchesDir, tracesDir, reportsDir);
  await batches.restore();
  const runs = new RunStore(ROOT, reportsDir);
  const settings = new Settings(DATA);
  await settings.load();
  runnerDefaults.argsFor = (depth) => settings.runnerArgs(depth);
  batches.skip = (networkId) => settings.networksOff.includes(networkId);
  const health = new Health(ROOT);
  const simulator = new Simulator();
  const sharing = new Sharing(ROOT, DATA, reportsDir, (dir, lang) => renderBrief(reportsDir, dir, asLang(lang)));
  await sharing.load();

  // Builds from an uploaded archive can be recorded on like any other playable.
  const registerBuilds = async (batchId?: string): Promise<void> => {
    const items = batches.playables(batchId);
    for (let i = 0; i < items.length; i += 1) {
      try {
        const html = await readFile(items[i].entryPath, "utf8");
        addPlayable(items[i].id, items[i].name, html, detectEngine(html, items[i].name));
        playableFiles.set(items[i].id, {
          file: items[i].entryPath,
          bundleBytes: items[i].bundled ? items[i].bytes : undefined,
        });
        if (items[i].bundled) {
          playableDirs.set(items[i].id, path.dirname(items[i].entryPath));
        }
      } catch {
        continue;
      }
    }
  };
  await registerBuilds();

  const rawArchive = express.raw({
    type: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
    limit: "400mb",
  });

  app.get("/api/batches", (_req, res) => {
    res.json(batches.list());
  });

  // One archive with the builds for every network: find them, test them all.
  app.post("/api/batches", rawArchive, async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Send the zip archive as the request body.", code: "BAD_ARCHIVE" });
      return;
    }
    if (!isZip(req.body)) {
      res.status(400).json({ error: "The file is not a zip archive.", code: "BAD_ARCHIVE" });
      return;
    }
    const name = typeof req.query.name === "string" && req.query.name ? req.query.name : "builds.zip";
    const traceId = typeof req.query.trace === "string" && /^[\w-]+$/.test(req.query.trace) ? req.query.trace : null;
    try {
      const batch = await batches.create(path.basename(name), req.body, traceId, asLang(req.query.lang), byOf(req.query.by), asDepth(req.query.depth));
      await registerBuilds(batch.id);
      res.status(201).json(batch);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read the archive.";
      res.status(400).json({ error: message, code: message.startsWith("No builds") ? "NO_BUILDS" : "BAD_ARCHIVE" });
    }
  });

  // Every network's build of one creative on one sheet, to hand over as the acceptance record.
  app.get("/api/batches/:id/sheet", async (req, res) => {
    const batch = batches.get(req.params.id);
    if (!batch) {
      res.status(404).json({ error: "Batch not found", code: "BATCH_NOT_FOUND" });
      return;
    }
    const html = await renderSheet(batch, reportsDir, asLang(req.query.lang));
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (req.query.download === "1") {
      const name = batch.name.replace(/\.zip$/i, "").replace(/[^\w.-]+/g, "_") || "release";
      res.setHeader("Content-Disposition", `attachment; filename="${name}-summary.html"`);
    }
    res.send(html);
  });

  app.post("/api/batches/:id/run", async (req, res) => {
    const requested = typeof req.body?.traceId === "string" ? req.body.traceId : "";
    const traceId = /^[\w-]+$/.test(requested) ? requested : null;
    const also = Array.isArray(req.body?.also)
      ? (req.body.also as unknown[]).filter((other): other is string => typeof other === "string" && /^[\w-]+$/.test(other))
      : [];
    const batch = await batches.rerun(req.params.id, traceId, asLang(req.body?.lang), byOf(req.body?.by), traceId ? also : [], asDepth(req.body?.depth));
    if (!batch) {
      res.status(404).json({ error: "Batch not found", code: "BATCH_NOT_FOUND" });
      return;
    }
    res.json(batch);
  });

  app.get("/api/meta", (_req, res) => {
    const urls = originUrls();
    res.json({
      hubHttpUrl: urls.http,
      hubWsUrl: urls.ws,
      lan: lanIPv4() !== "127.0.0.1",
      // The link teammates open: this computer's address, when the hub serves the console itself.
      teamUrl: existsSync(path.join(CONSOLE_DIR, "index.html")) && lanIPv4() !== "127.0.0.1" ? urls.http : null,
      engines: ["luna", "cocos", "vanilla"],
    });
  });

  app.get("/api/health", async (_req, res) => {
    res.json({ ...health.report(), simulator: await simulator.state() });
  });

  // Xcode comes from the App Store under the operator's own Apple ID: the lab can only open its page.
  app.post("/api/simulator/xcode", localOnly, (_req, res) => {
    simulator.openStore();
    res.status(202).json({ opened: true });
  });

  // The session's page in the iPhone simulator's Safari, in place of a phone that scanned the QR.
  app.post("/api/simulator/open", localOnly, async (req, res) => {
    const session = bus.getSession(String(req.body?.sessionId || ""));
    if (!session) {
      res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
      return;
    }
    const url = `http://127.0.0.1:${PORT}/play/${session.id}?orientation=${session.orientationLock}&lang=${asLang(req.body?.lang)}`;
    try {
      res.json({ device: await simulator.open(url) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error), code: "SIMULATOR_FAILED" });
    }
  });

  app.post("/api/health/install", localOnly, async (_req, res) => {
    health.install();
    res.status(202).json({ ...health.report(), simulator: await simulator.state() });
  });

  app.get("/api/settings", ownPage, (req, res) => {
    const view = settings.view();
    // Teammates see whether a key is there, never a piece of it.
    if (!isLocal(req)) {
      view.keys.claude.hint = null;
      view.keys.gpt.hint = null;
    }
    res.json({ ...view, local: isLocal(req) });
  });

  app.put("/api/settings", ownPage, async (req, res) => {
    // A teammate may say which app the playable advertises; keys and the depth of the checks stay with the host.
    if (!isLocal(req)) {
      await settings.update({ apps: req.body?.apps });
      runnerDefaults.argsFor = (depth) => settings.runnerArgs(depth);
      res.json({ ...settings.view(), local: false });
      return;
    }
    await settings.update({
      provider: req.body?.provider,
      stress: req.body?.stress,
      safari: req.body?.safari,
      idleSeconds: req.body?.idleSeconds,
      platforms: req.body?.platforms,
      orientations: req.body?.orientations,
      networksOff: req.body?.networksOff,
      languages: req.body?.languages,
      oldPhones: req.body?.oldPhones,
      depth: req.body?.depth,
      apps: req.body?.apps,
      keys: req.body?.keys,
    });
    runnerDefaults.argsFor = (depth) => settings.runnerArgs(depth);
    res.json(settings.view());
  });

  // A run that needs no recording: an AI plays the playable, or it is only loaded on every screen.
  app.post("/api/runs", ownPage, (req, res) => {
    const playableId = String(req.body?.playableId || "");
    const item = playables.get(playableId);
    const source = playableFiles.get(playableId);
    if (!item || !source) {
      res.status(404).json({ error: "Playable not found", code: "PLAYABLE_NOT_FOUND" });
      return;
    }
    const mode = req.body?.mode === "ai" ? "ai" : "load";
    const provider = isProvider(req.body?.provider) ? req.body.provider : settings.provider;
    if (mode === "ai" && !settings.hasKey(provider)) {
      res.status(400).json({ error: `No API key for ${provider}.`, code: "AI_KEY_MISSING" });
      return;
    }
    const network = networkById(typeof req.body?.network === "string" ? req.body.network : "");
    res.status(202).json(
      runs.start({
        playableId,
        playable: item.name,
        file: source.file,
        bundleBytes: source.bundleBytes,
        mode,
        provider,
        network: network?.id,
        lang: asLang(req.body?.lang),
        by: byOf(req.body?.by),
        depth: asDepth(req.body?.depth),
        env: mode === "ai" ? settings.env(provider) : {},
      })
    );
  });

  app.get("/api/runs/:id", (req, res) => {
    const run = runs.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found", code: "RUN_NOT_FOUND" });
      return;
    }
    res.json(run);
  });

  // What the history takes on disk, for the Settings page.
  app.get("/api/storage", async (_req, res) => {
    res.json({
      reports: await sizeOf(reportsDir),
      traces: await sizeOf(tracesDir, /\.json$/),
      batches: await sizeOf(batchesDir),
      playables: await sizeOf(playablesDir),
    } satisfies StorageReport);
  });

  app.delete("/api/reports/:dir", localOnly, async (req, res) => {
    const removed = await removeEntry(reportsDir, req.params.dir);
    res.status(removed ? 200 : 404).json({ removed });
  });

  app.delete("/api/traces/:id", localOnly, async (req, res) => {
    const id = path.basename(req.params.id);
    if (library.busy(id)) {
      res.status(409).json({ error: "A check of this recording is running.", code: "BUSY" });
      return;
    }
    const removed = await removeEntry(tracesDir, `${id}.json`);
    res.status(removed ? 200 : 404).json({ removed });
  });

  app.delete("/api/batches/:id", localOnly, async (req, res) => {
    const reports = batches.reportDirs(req.params.id);
    const removed = await batches.remove(req.params.id);
    if (!removed) {
      res.status(batches.get(req.params.id) ? 409 : 404).json({ error: "The archive is being checked.", code: "BUSY" });
      return;
    }
    // A build's report means nothing without the build.
    for (let i = 0; i < reports.length; i += 1) {
      await removeEntry(reportsDir, reports[i]);
    }
    const prefix = `${path.basename(req.params.id)}_`;
    Array.from(playables.keys()).forEach((key) => {
      if (key.startsWith(prefix)) {
        playables.delete(key);
        playableFiles.delete(key);
        playableDirs.delete(key);
      }
    });
    res.json({ removed });
  });

  // Clears the history: everything, or what is older than a number of days. Running checks are kept.
  app.post("/api/storage/clean", localOnly, async (req, res) => {
    const days = typeof req.body?.olderThanDays === "number" && req.body.olderThanDays > 0 ? req.body.olderThanDays : 0;
    const before = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : Number.POSITIVE_INFINITY;
    const old = (modified: number): boolean => modified < before;
    const removed = { reports: 0, traces: 0, batches: 0, playables: 0 };

    const list = batches.list();
    for (let i = 0; i < list.length; i += 1) {
      if (old(list[i].createdAt)) {
        const reports = batches.reportDirs(list[i].id);
        if (await batches.remove(list[i].id)) {
          removed.batches += 1;
          for (let r = 0; r < reports.length; r += 1) {
            await removeEntry(reportsDir, reports[r]);
          }
        }
      }
    }
    const reportEntries = await entriesOf(reportsDir);
    for (let i = 0; i < reportEntries.length; i += 1) {
      if (old(reportEntries[i].modified) && (await removeEntry(reportsDir, reportEntries[i].name))) {
        removed.reports += 1;
      }
    }
    const traceEntries = await entriesOf(tracesDir, /\.json$/);
    for (let i = 0; i < traceEntries.length; i += 1) {
      const id = traceEntries[i].name.replace(/\.json$/, "");
      if (old(traceEntries[i].modified) && !library.busy(id) && (await removeEntry(tracesDir, traceEntries[i].name))) {
        removed.traces += 1;
      }
    }
    if (req.body?.playables === true) {
      const uploaded = await entriesOf(playablesDir);
      for (let i = 0; i < uploaded.length; i += 1) {
        if (old(uploaded[i].modified) && (await removeEntry(playablesDir, uploaded[i].name))) {
          playables.delete(uploaded[i].name);
          playableFiles.delete(uploaded[i].name);
          removed.playables += 1;
        }
      }
    }
    // Builds of deleted archives are no longer playable.
    Array.from(playables.keys()).forEach((key) => {
      const batch = /^(b_[a-z0-9]+_\d+)_\d+$/.exec(key);
      if (batch && !batches.get(batch[1])) {
        playables.delete(key);
        playableFiles.delete(key);
        playableDirs.delete(key);
      }
    });
    res.json({ removed });
  });

  // Videos, every screen and the networks, zipped for a client.
  app.get("/api/reports/:dir/pack", async (req, res) => {
    try {
      const pack = await reportPack(reportsDir, req.params.dir, asLang(req.query.lang));
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${pack.name}.zip"`);
      res.send(writeZip(pack.entries));
    } catch {
      res.status(404).json({ error: "Report not found", code: "REPORT_NOT_FOUND" });
    }
  });

  app.get("/api/batches/:id/pack", async (req, res) => {
    const batch = batches.get(req.params.id);
    if (!batch) {
      res.status(404).json({ error: "Batch not found", code: "BATCH_NOT_FOUND" });
      return;
    }
    const lang = asLang(req.query.lang);
    // The recording's own check has the video; the builds replaying it were run without one.
    const own = new Set(batch.builds.map((build) => build.reportDir));
    const reports = batch.traceId ? (await library.reports()).filter((report) => report.sessionId === batch.traceId) : [];
    const played =
      reports.find((report) => !own.has(report.dir))?.dir ||
      batch.builds.find((build) => build.state === "done" && build.reportDir)?.reportDir ||
      null;
    const pack = await batchPack(batch, reportsDir, lang, played, await renderSheet(batch, reportsDir, lang));
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${pack.name}.zip"`);
    res.send(writeZip(pack.entries));
  });

  // The verdict, the video and the numbers on one self-contained page, for a manager.
  // A report's plain summary in the reader's language, whatever language it was written in.
  app.get("/api/reports/:dir/summary", async (req, res) => {
    const dir = path.basename(req.params.dir);
    try {
      const report = JSON.parse(await readFile(path.join(reportsDir, dir, "report.json"), "utf8")) as RunReport;
      res.json(summarize(report, asLang(req.query.lang)));
    } catch {
      res.status(404).json({ error: "Report not found", code: "REPORT_NOT_FOUND" });
    }
  });

  app.get("/api/reports/:dir/brief", async (req, res) => {
    const dir = path.basename(req.params.dir);
    try {
      const html = await renderBrief(reportsDir, dir, asLang(req.query.lang));
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (req.query.download === "1") {
        res.setHeader("Content-Disposition", `attachment; filename="${dir.replace(/[^\w.-]+/g, "_")}-brief.html"`);
      }
      res.send(html);
    } catch {
      res.status(404).json({ error: "Report not found", code: "REPORT_NOT_FOUND" });
    }
  });

  // A whole report as one file, to send to someone who does not run the lab.
  app.get("/api/reports/:dir/download", async (req, res) => {
    const dir = path.basename(req.params.dir);
    const folder = path.join(reportsDir, dir);
    try {
      if (!(await stat(path.join(folder, "index.html"))).isFile()) {
        throw new Error("not a report");
      }
      const archive = writeZip(await readFolder(folder, dir));
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${dir.replace(/[^\w.-]+/g, "_")}.zip"`);
      res.send(archive);
    } catch {
      res.status(404).json({ error: "Report not found", code: "REPORT_NOT_FOUND" });
    }
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
      res.status(400).json({ error: "html is required", code: "EMPTY_FILE" });
      return;
    }
    const engine = (req.body?.engine as EngineKind) || detectEngine(html, name);
    const id = `p_${Date.now().toString(36)}`;
    const dir = path.join(playablesDir, id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "source.html"), html, "utf8");
    await writeFile(path.join(dir, "meta.json"), JSON.stringify({ name, engine }, null, 2), "utf8");
    addPlayable(id, name, html, engine);
    playableFiles.set(id, { file: path.join(dir, "source.html") });
    res.json({
      id,
      engine,
      name,
      url: `/playables/${id}/index.html`,
      engineLabel: describeEngine(engine),
    });
  });

  app.get("/api/networks", (_req, res) => {
    res.json(
      AD_NETWORKS.map((network) => ({
        id: network.id,
        name: network.name,
        ctaCall: network.ctaCall,
        notes: network.notes,
        docs: network.docs,
      }))
    );
  });

  // File-level checks for one playable: size, packaging, references, network APIs.
  // Before a check starts: do the store links in the playable lead to the app the team named?
  app.get("/api/playables/:id/links", async (req, res) => {
    const item = playables.get(req.params.id);
    if (!item) {
      res.status(404).json({ error: "Playable not found", code: "PLAYABLE_NOT_FOUND" });
      return;
    }
    let text = item.html;
    // A build with its own files keeps the store address in its scripts as often as in the page.
    const dir = playableDirs.get(item.id);
    if (dir) {
      const files = await readFolder(dir, "").catch(() => []);
      text += files.filter((file) => /\.(m?js|json)$/i.test(file.name)).map((file) => file.data.toString("utf8")).join("\n");
    }
    const apps = settings.view().apps;
    res.json(linkGate(scanSourceRefs(text).storeUrls, { ios: apps.ios.text, android: apps.android.text }));
  });

  app.get("/api/playables/:id/checks", (req, res) => {
    const item = playables.get(req.params.id);
    if (!item) {
      res.status(404).json({ error: "Playable not found" });
      return;
    }
    const requested = typeof req.query.network === "string" ? req.query.network : "";
    const network = networkById(requested) || (requested ? undefined : guessNetwork(item.name));
    const checks = runStaticChecks(item.html, network);
    res.json({
      network: network ? { id: network.id, name: network.name } : null,
      status: overallStatus(checks),
      checks,
    });
  });

  app.get("/playables/:id/index.html", (req, res) => {
    const item = playables.get(req.params.id);
    if (!item) {
      res.status(404).send("Playable not found");
      return;
    }
    const asSource = req.query.source === "1";
    const seed = typeof req.query.seed === "string" ? Number(req.query.seed) : undefined;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(wrapPlayableHtml(item.html, asSource, seed));
  });

  app.post("/api/sessions", async (req, res) => {
    const playableId = String(req.body?.playableId || "sample-tap");
    const playable = playables.get(playableId);
    if (!playable) {
      res.status(404).json({ error: "Playable not found", code: "PLAYABLE_NOT_FOUND" });
      return;
    }
    const orientationLock = (req.body?.orientationLock || "portrait") as Orientation;
    const known = new Set(DEVICE_CATALOG.map((device) => device.id));
    const deviceIds = Array.isArray(req.body?.deviceIds)
      ? (req.body.deviceIds as unknown[]).filter(
          (id): id is string => typeof id === "string" && known.has(id)
        )
      : [];
    const session = bus.createSession({
      playable,
      orientationLock,
      deviceIds: deviceIds.length > 0 ? deviceIds : undefined,
      chainId: req.body?.chainId,
      stepId: req.body?.stepId,
      by: byOf(req.body?.by),
    });
    const urls = originUrls();
    const playPath = `/play/${session.id}?orientation=${orientationLock}&lang=${asLang(req.body?.lang)}`;
    const playUrl = `${urls.http}${playPath}`;
    if (typeof req.body?.after === "string" && req.body.after) {
      bus.announceNext(req.body.after, session.id, playPath, orientationLock);
    }
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

  app.get("/api/traces", async (req, res) => {
    const traces = await library.traces();
    res.json(pageOf(req, res, traces, (trace) => [trace.id, trace.playable, trace.stepId, trace.by, trace.orientation].join(" ")));
  });

  // Replay a saved trace on its step's screens and write a report.
  app.post("/api/traces/:id/checks", async (req, res) => {
    const id = path.basename(req.params.id);
    const traces = await library.traces();
    if (!/^[\w-]+$/.test(id) || !traces.some((trace) => trace.id === id)) {
      res.status(404).json({ error: "Trace not found", code: "TRACE_NOT_FOUND" });
      return;
    }
    const requested = typeof req.body?.network === "string" ? req.body.network : "";
    const network = networkById(requested);
    const also = Array.isArray(req.body?.also)
      ? (req.body.also as unknown[]).filter(
          (other): other is string => typeof other === "string" && other !== id && traces.some((trace) => trace.id === other)
        )
      : undefined;
    const started = await library.startChecks(id, network?.id, asLang(req.body?.lang), byOf(req.body?.by), also, asDepth(req.body?.depth));
    res.status(started ? 202 : 409).json({ started });
  });

  // Reports opened from outside the office, one link per report.
  app.get("/api/share/status", ownPage, async (req, res) => {
    await sharing.measure();
    res.json(sharing.status());
  });

  app.post("/api/share/install", localOnly, (_req, res) => {
    void sharing.install();
    res.status(202).json(sharing.status());
  });

  app.get("/api/reports/:dir/shares", ownPage, (req, res) => {
    const dir = path.basename(req.params.dir);
    res.json(
      sharing.linksFor(dir).map((link) => ({ token: link.token, expiresAt: link.expiresAt, by: link.by || null, url: sharing.urlOf(link.token) }))
    );
  });

  app.post("/api/reports/:dir/shares", ownPage, async (req, res) => {
    const dir = path.basename(req.params.dir);
    if (!existsSync(path.join(reportsDir, dir, "report.json"))) {
      res.status(404).json({ error: "Report not found", code: "REPORT_NOT_FOUND" });
      return;
    }
    try {
      const made = await sharing.create(dir, asLang(req.body?.lang), byOf(req.body?.by));
      res.json({ token: made.link.token, expiresAt: made.link.expiresAt, url: made.url });
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : String(error), code: "SHARE_FAILED" });
    }
  });

  app.delete("/api/shares/:token", ownPage, async (req, res) => {
    res.json({ revoked: await sharing.revoke(req.params.token) });
  });

  // One screen of a check done again, in place: a screen that failed for a
  // passing reason (a hiccup of the computer) does not cost the whole check.
  const retries = new Map<string, { id: string; state: "running" | "failed"; error?: string }>();
  const safeDir = (dir: string): string | null => (/^[\w.-]+$/.test(dir) ? dir : null);

  app.get("/api/reports/:dir/retry", async (req, res) => {
    const dir = safeDir(req.params.dir);
    if (!dir) {
      res.status(404).json({ error: "Report not found", code: "REPORT_NOT_FOUND" });
      return;
    }
    let available = false;
    try {
      const saved = JSON.parse(await readFile(path.join(reportsDir, dir, "run.json"), "utf8")) as { argv?: string[] };
      // The AI's own playthrough cannot be replayed on one screen: it played it once.
      available = Array.isArray(saved.argv) && !saved.argv.includes("--autoplay");
    } catch {
      available = false;
    }
    res.json({
      available,
      screens: Array.from(retries.entries())
        .filter(([key]) => key.startsWith(`${dir}/`))
        .map(([, value]) => value),
    });
  });

  app.post("/api/reports/:dir/screens/:id/retry", ownPage, async (req, res) => {
    const dir = safeDir(req.params.dir);
    const id = /^[\w.-]+$/.test(req.params.id) ? req.params.id : null;
    if (!dir || !id) {
      res.status(404).json({ error: "Report not found", code: "REPORT_NOT_FOUND" });
      return;
    }
    const key = `${dir}/${id}`;
    if (retries.get(key)?.state === "running") {
      res.status(409).json({ started: false });
      return;
    }
    let argv: string[];
    try {
      const saved = JSON.parse(await readFile(path.join(reportsDir, dir, "run.json"), "utf8")) as { argv?: string[] };
      if (!Array.isArray(saved.argv) || saved.argv.includes("--autoplay")) {
        throw new Error("not repeatable");
      }
      argv = saved.argv;
    } catch {
      res.status(409).json({ error: "This check cannot repeat one screen", code: "RETRY_UNAVAILABLE" });
      return;
    }
    retries.set(key, { id, state: "running" });
    res.status(202).json({ started: true });
    console.log(`[hub] checking ${id} again in ${dir}`);
    const result = await runRunner(ROOT, [...argv, "--only", id, "--into", path.join(reportsDir, dir)], { noDefaults: true });
    if (result.code === 0 || result.code === 1) {
      retries.delete(key);
      await batches.refreshReport(dir);
    } else {
      retries.set(key, { id, state: "failed", error: lastLine(result.output) || `Runner exited with code ${result.code}` });
    }
  });

  app.get("/api/reports", async (req, res) => {
    const reports = await library.reports();
    res.json(
      pageOf(req, res, reports, (report) =>
        [report.dir, report.playable, report.network, report.stepId, report.by, report.ai, report.status].join(" ")
      )
    );
  });

  app.use("/reports", express.static(reportsDir));

  // Assets of a multi-file build, next to its index.html.
  app.get("/playables/:id/*", (req, res) => {
    const dir = playableDirs.get(req.params.id);
    const relative = path.normalize((req.params as Record<string, string>)[0] || "");
    const target = dir ? path.join(dir, relative) : "";
    if (!dir || !target.startsWith(dir + path.sep)) {
      res.status(404).send("Not found");
      return;
    }
    res.sendFile(target, (error) => {
      if (error && !res.headersSent) {
        res.status(404).send("Not found");
      }
    });
  });

  app.get("/api/traces/:id", async (req, res) => {
    const id = path.basename(req.params.id);
    const file = path.join(tracesDir, id.endsWith(".json") ? id : `${id}.json`);
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
    // Playing on the computer itself: a window, not a phone, so no fullscreen step.
    const desktop = req.query.pc === "1";
    const playableSrc = `/playables/${session.playable.id}/index.html?source=${role === "source" ? "1" : "0"}&seed=${session.seed}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      renderViewPage({
        sessionId: session.id,
        role,
        playableSrc,
        orientationLock: session.orientationLock,
        desktop,
        lang: asLang(req.query.lang),
      })
    );
  });

  // Anything else is the console's own page, when it has been built.
  if (existsSync(path.join(CONSOLE_DIR, "index.html"))) {
    app.use(express.static(CONSOLE_DIR, { index: "index.html" }));
    app.get(/^\/(?!api\/|reports\/|playables\/|play\/|view\/|ws).*/, (_req, res) => {
      res.sendFile(path.join(CONSOLE_DIR, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    const urls = originUrls();
    console.log(`PlayGuard Hub ${urls.http}`);
    console.log(`WebSocket ${urls.ws}`);
  });
};

void start();
