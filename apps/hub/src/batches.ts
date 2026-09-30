import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectNetwork, networkById, networkNameFromFile, overallStatus, runStaticChecks } from "@playable-lab/checks";
import type { CheckResult, CheckStatus } from "@playable-lab/checks";
import { isZip, readZip } from "@playable-lab/zip";
import type { ZipEntry } from "@playable-lab/zip";
import { lastLine, runRunner } from "./runner.ts";
import type { Depth } from "./runner.ts";
import { applyScreens } from "./runner.ts";
import type { Lang, Progress, ScreenTile } from "./runner.ts";

export type Verdict = "pass" | "warn" | "fail";

export interface BatchBuild {
  id: string;
  /** Path of the build inside the uploaded archive. */
  name: string;
  /** How the build ships: a bare HTML, or an archive (zip or folder) with an entry HTML. */
  kind: "html" | "zip";
  /**
   * The network this build is for. `known` is false when the file names a
   * network the lab has no profile for: it is shown as named and gets the
   * general checks only.
   */
  network: { id: string; name: string; known: boolean } | null;
  networkBy: "name" | "content" | null;
  /** Size of what gets uploaded to the network. */
  bytes: number;
  /** "skipped": its network is turned off in Settings. */
  state: "queued" | "running" | "done" | "failed" | "interrupted" | "skipped";
  /** Screens tested so far, while running. */
  progress?: Progress;
  /** Every screen of the build's run, with the ones done so far; kept only while it runs. */
  tiles?: ScreenTile[];
  error?: string;
  /** File checks first, then each replay check at its worst across screens. */
  checks: CheckResult[];
  verdict: Verdict | null;
  screens: Record<Verdict, number> | null;
  reportDir: string | null;
  reportUrl: string | null;
}

export interface Batch {
  id: string;
  name: string;
  createdAt: number;
  /** Recording replayed on every build; null means a load-only run. */
  traceId: string | null;
  /** The other orientation's recording, replayed with it. */
  alsoTraceIds?: string[];
  /** Quick or full, as the last round of tests was started. */
  depth?: Depth;
  /** When the current (or last) round of tests was started. */
  runStartedAt?: number;
  /** Language of the reports' plain summary. */
  lang?: Lang;
  /** Who uploaded it, or last ran it. */
  by?: string;
  builds: BatchBuild[];
}

interface StoredBuild extends BatchBuild {
  /** Entry HTML, relative to the batch folder. */
  entry: string;
}

interface StoredBatch extends Omit<Batch, "builds"> {
  builds: StoredBuild[];
}

interface Inspection {
  network: BatchBuild["network"];
  networkBy: BatchBuild["networkBy"];
  checks: CheckResult[];
}

/** Whose build this is, and the checks that need only the files. */
const inspect = (name: string, kind: "html" | "zip", bytes: number, entry: string, files: ZipEntry[]): Inspection => {
  const entryFile = files.find((file) => file.name === entry);
  const html = entryFile ? entryFile.data.toString("utf8") : "";
  const detected = detectNetwork(name, html);
  const named = detected.network ? null : networkNameFromFile(name);
  return {
    network: detected.network
      ? { id: detected.network.id, name: detected.network.name, known: true }
      : named
        ? { id: named.toLowerCase(), name: named, known: false }
        : null,
    networkBy: detected.network ? detected.by : named ? "name" : null,
    checks: runStaticChecks(
      html,
      detected.network,
      kind === "zip"
        ? {
            zipBytes: bytes,
            files: files.map((file) => file.name),
            sizes: files.map((file) => ({ name: file.name, bytes: file.data.length })),
            entry,
            scripts: files
              .filter((file) => /\.m?js$/i.test(file.name))
              .map((file) => file.data.toString("utf8"))
              .join("\n"),
          }
        : undefined
    ),
  };
};

const readTree = async (root: string, prefix = ""): Promise<ZipEntry[]> => {
  const out: ZipEntry[] = [];
  const items = await readdir(path.join(root, prefix), { withFileTypes: true });
  for (let i = 0; i < items.length; i += 1) {
    const relative = prefix ? `${prefix}/${items[i].name}` : items[i].name;
    if (items[i].isDirectory()) {
      out.push(...(await readTree(root, relative)));
    } else {
      out.push({ name: relative, data: await readFile(path.join(root, relative)) });
    }
  }
  return out;
};

interface FoundBuild {
  name: string;
  kind: "html" | "zip";
  bytes: number;
  entry: string;
  files: ZipEntry[];
}

const isHtml = (name: string): boolean => /\.html?$/i.test(name);
const dirOf = (name: string): string => (name.includes("/") ? name.slice(0, name.lastIndexOf("/") + 1) : "");
const depth = (name: string): number => name.split("/").length;

const pickEntry = (files: ZipEntry[]): ZipEntry | undefined => {
  const pages = files.filter((file) => isHtml(file.name));
  pages.sort(
    (a, b) =>
      depth(a.name) - depth(b.name) ||
      Number(/(^|\/)index\.html?$/i.test(b.name)) - Number(/(^|\/)index\.html?$/i.test(a.name))
  );
  return pages[0];
};

/**
 * Finds every build in an uploaded archive: bare HTML files, nested zips, and
 * folders that hold an index.html with its assets.
 */
export const findBuilds = (archiveName: string, archive: Buffer): FoundBuild[] => {
  const entries = readZip(archive);
  const builds: FoundBuild[] = [];
  const pages = entries.filter((entry) => isHtml(entry.name));
  const nested = entries.filter((entry) => /\.zip$/i.test(entry.name));

  // The archive itself is one multi-file build.
  const rootIndex = entries.find((entry) => /^index\.html?$/i.test(entry.name));
  if (rootIndex && pages.length === 1 && nested.length === 0 && entries.length > 1) {
    return [{ name: archiveName, kind: "zip", bytes: archive.length, entry: rootIndex.name, files: entries }];
  }

  for (let i = 0; i < nested.length; i += 1) {
    if (!isZip(nested[i].data)) {
      continue;
    }
    let files: ZipEntry[];
    try {
      files = readZip(nested[i].data);
    } catch {
      continue;
    }
    // A zip that only wraps one folder: look inside it.
    const entry = pickEntry(files);
    if (entry) {
      builds.push({ name: nested[i].name, kind: "zip", bytes: nested[i].data.length, entry: entry.name, files });
    }
  }

  const claimed = new Set<string>();
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const dir = dirOf(page.name);
    const siblings = entries.filter(
      (entry) => entry !== page && entry.name.startsWith(dir) && !isHtml(entry.name) && !/\.zip$/i.test(entry.name)
    );
    // index.html with assets beside it is an unpacked multi-file build.
    if (dir && /(^|\/)index\.html?$/i.test(page.name) && siblings.length > 0) {
      const files = [page, ...siblings].map((entry) => ({ name: entry.name.slice(dir.length), data: entry.data }));
      let bytes = 0;
      for (let f = 0; f < files.length; f += 1) {
        bytes += files[f].data.length;
        claimed.add(dir + files[f].name);
      }
      builds.push({ name: dir.replace(/\/$/, ""), kind: "zip", bytes, entry: page.name.slice(dir.length), files });
    }
  }
  for (let i = 0; i < pages.length; i += 1) {
    if (!claimed.has(pages[i].name)) {
      builds.push({
        name: pages[i].name,
        kind: "html",
        bytes: pages[i].data.length,
        entry: "index.html",
        files: [{ name: "index.html", data: pages[i].data }],
      });
    }
  }
  return builds.sort((a, b) => a.name.localeCompare(b.name));
};

const RANK: Record<CheckStatus, number> = { fail: 3, warn: 2, pass: 1, info: 0, skip: 0 };

interface ReportRun {
  id: string;
  status: Verdict;
  device: { name: string };
  orientation: string;
  /** A language run: the phone's language code. */
  language?: string;
  checks: CheckResult[];
}

/** One line per check: its worst status across screens, and where it went wrong. */
export const mergeRuns = (runs: ReportRun[]): CheckResult[] => {
  const merged: CheckResult[] = [];
  for (let r = 0; r < runs.length; r += 1) {
    for (let c = 0; c < runs[r].checks.length; c += 1) {
      const check = runs[r].checks[c];
      if (check.status === "info") {
        continue;
      }
      const where = `${runs[r].device.name} ${runs[r].orientation}${runs[r].language ? ` (${runs[r].language})` : ""}`;
      let target = merged.find((item) => item.id === check.id);
      if (!target) {
        target = { id: check.id, title: check.title, status: check.status, message: check.message, details: [] };
        merged.push(target);
      } else if (RANK[check.status] > RANK[target.status]) {
        target.status = check.status;
        target.message = check.message;
        target.details = [];
      }
      if (check.status === target.status && (check.status === "fail" || check.status === "warn")) {
        target.details!.push(where);
      }
    }
  }
  for (let i = 0; i < merged.length; i += 1) {
    const screens = merged[i].details || [];
    if (screens.length > 0) {
      merged[i].message = `${screens.length} of ${runs.length} screens: ${merged[i].message}`;
    }
  }
  return merged;
};

const MAX_PARALLEL = 3;

/** Uploaded archives of builds, and the queue that tests every build in them. */
export class BatchStore {
  private readonly _batches = new Map<string, StoredBatch>();
  private readonly _queue: Array<{ batchId: string; buildId: string }> = [];
  private _running = 0;
  /** Networks whose builds are not tested, from Settings. */
  public skip: (networkId: string) => boolean = () => false;
  private _seq = 0;

  public constructor(
    private readonly _root: string,
    private readonly _batchesDir: string,
    private readonly _tracesDir: string,
    private readonly _reportsDir: string
  ) {}

  /** Batches saved by an earlier hub process; whatever was mid-run then is marked as such. */
  public async restore(): Promise<void> {
    let ids: string[] = [];
    try {
      ids = await readdir(this._batchesDir);
    } catch {
      return;
    }
    for (let i = 0; i < ids.length; i += 1) {
      try {
        const batch = JSON.parse(
          await readFile(path.join(this._batchesDir, ids[i], "batch.json"), "utf8")
        ) as StoredBatch;
        for (let b = 0; b < batch.builds.length; b += 1) {
          if (batch.builds[b].state === "queued" || batch.builds[b].state === "running") {
            batch.builds[b].state = "interrupted";
          }
        }
        this._batches.set(batch.id, batch);
      } catch {
        continue;
      }
    }
  }

  /** Every build as something the record view can open: id, name, entry HTML on disk. */
  public playables(
    batchId?: string
  ): Array<{ id: string; name: string; entryPath: string; bundled: boolean; bytes: number }> {
    const out: Array<{ id: string; name: string; entryPath: string; bundled: boolean; bytes: number }> = [];
    this._batches.forEach((batch) => {
      if (batchId && batch.id !== batchId) {
        return;
      }
      for (let i = 0; i < batch.builds.length; i += 1) {
        const build = batch.builds[i];
        out.push({
          id: `${batch.id}_${build.id}`,
          name: path.basename(build.name),
          entryPath: path.join(this._batchesDir, batch.id, build.entry),
          bundled: build.kind === "zip",
          bytes: build.bytes,
        });
      }
    });
    return out;
  }

  public list(): Batch[] {
    return Array.from(this._batches.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((batch) => this._public(batch));
  }

  /** Forgets a batch and deletes its files. False while one of its builds is being tested. */
  public async remove(id: string): Promise<boolean> {
    const batch = this._batches.get(id);
    if (!batch || batch.builds.some((build) => build.state === "queued" || build.state === "running")) {
      return false;
    }
    this._batches.delete(id);
    await rm(path.join(this._batchesDir, path.basename(id)), { recursive: true, force: true });
    return true;
  }

  /** Report folders of a batch's builds, to delete along with it. */
  public reportDirs(id: string): string[] {
    const batch = this._batches.get(id);
    return batch ? batch.builds.map((build) => build.reportDir).filter((dir): dir is string => Boolean(dir)) : [];
  }

  public get(id: string): Batch | undefined {
    const batch = this._batches.get(id);
    return batch ? this._public(batch) : undefined;
  }

  public async create(
    archiveName: string,
    archive: Buffer,
    traceId: string | null,
    lang: Lang = "en",
    by?: string,
    depth?: Depth
  ): Promise<Batch> {
    const found = findBuilds(archiveName, archive);
    if (found.length === 0) {
      throw new Error("No builds in the archive: it has no HTML files and no zipped builds.");
    }
    const id = `b_${Date.now().toString(36)}_${this._seq}`;
    this._seq += 1;
    const dir = path.join(this._batchesDir, id);
    const builds: StoredBuild[] = [];
    for (let i = 0; i < found.length; i += 1) {
      const build = found[i];
      const buildDir = path.join(dir, String(i));
      for (let f = 0; f < build.files.length; f += 1) {
        const target = path.join(buildDir, build.files[f].name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, build.files[f].data);
      }
      const seen = inspect(build.name, build.kind, build.bytes, build.entry, build.files);
      builds.push({
        id: String(i),
        name: build.name,
        kind: build.kind,
        network: seen.network,
        networkBy: seen.networkBy,
        bytes: build.bytes,
        state: "queued",
        checks: seen.checks,
        verdict: null,
        screens: null,
        reportDir: null,
        reportUrl: null,
        entry: path.join(String(i), build.entry),
      });
    }
    const batch: StoredBatch = {
      id,
      name: archiveName,
      createdAt: Date.now(),
      traceId,
      runStartedAt: Date.now(),
      lang,
      by,
      depth,
      builds,
    };
    this._batches.set(id, batch);
    await this._save(batch);
    for (let i = 0; i < builds.length; i += 1) {
      if (this._skipped(builds[i])) {
        builds[i].state = "skipped";
        continue;
      }
      this._queue.push({ batchId: id, buildId: builds[i].id });
    }
    await this._save(batch);
    this._pump();
    return this._public(batch);
  }

  /** Tests every build of a batch again, optionally replaying a recording on each. */
  public async rerun(
    id: string,
    traceId: string | null,
    lang: Lang = "en",
    by?: string,
    also: string[] = [],
    depth?: Depth
  ): Promise<Batch | undefined> {
    const batch = this._batches.get(id);
    if (!batch) {
      return undefined;
    }
    batch.traceId = traceId;
    batch.alsoTraceIds = also.length > 0 ? also : undefined;
    batch.depth = depth;
    batch.lang = lang;
    batch.by = by || batch.by;
    batch.runStartedAt = Date.now();
    for (let i = 0; i < batch.builds.length; i += 1) {
      const build = batch.builds[i];
      if (build.state === "queued" || build.state === "running") {
        continue;
      }
      build.state = "queued";
      build.error = undefined;
      build.verdict = null;
      build.screens = null;
      // Look at the files again: the lab may know more networks than when they were uploaded.
      try {
        const buildDir = path.join(this._batchesDir, batch.id, build.id);
        const seen = inspect(
          build.name,
          build.kind,
          build.bytes,
          path.relative(build.id, build.entry).split(path.sep).join("/"),
          await readTree(buildDir)
        );
        build.network = seen.network;
        build.networkBy = seen.networkBy;
        build.checks = seen.checks;
      } catch {
        build.checks = build.checks.filter((check) => STATIC_IDS.has(check.id));
      }
      if (this._skipped(build)) {
        build.state = "skipped";
        continue;
      }
      this._queue.push({ batchId: id, buildId: build.id });
    }
    await this._save(batch);
    this._pump();
    return this._public(batch);
  }

  private _skipped(build: BatchBuild): boolean {
    return Boolean(build.network?.known && this.skip(build.network.id));
  }

  private _public(batch: StoredBatch): Batch {
    return {
      id: batch.id,
      name: batch.name,
      createdAt: batch.createdAt,
      traceId: batch.traceId,
      alsoTraceIds: batch.alsoTraceIds,
      depth: batch.depth,
      runStartedAt: batch.runStartedAt,
      by: batch.by,
      builds: batch.builds.map(({ entry: _entry, ...build }) => build),
    };
  }

  private async _save(batch: StoredBatch): Promise<void> {
    const dir = path.join(this._batchesDir, batch.id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "batch.json"), JSON.stringify(batch, null, 2), "utf8");
  }

  private _pump(): void {
    while (this._running < MAX_PARALLEL && this._queue.length > 0) {
      const job = this._queue.shift()!;
      const batch = this._batches.get(job.batchId);
      const build = batch?.builds.find((item) => item.id === job.buildId);
      if (!batch || !build) {
        continue;
      }
      this._running += 1;
      void this._run(batch, build).finally(() => {
        this._running -= 1;
        this._pump();
      });
    }
  }

  /** A screen of a build's report was checked again: the build's line follows the report. */
  public async refreshReport(reportDir: string): Promise<void> {
    for (const batch of this._batches.values()) {
      const build = batch.builds.find((item) => item.reportDir === reportDir);
      if (build) {
        await this._applyReport(build, reportDir);
        await this._save(batch);
      }
    }
  }

  private async _applyReport(build: StoredBuild, reportDir: string): Promise<void> {
    try {
      const report = JSON.parse(
        await readFile(path.join(this._reportsDir, reportDir, "report.json"), "utf8")
      ) as { status: Verdict; fileChecks: CheckResult[]; runs: ReportRun[]; stress?: ReportRun[]; languages?: ReportRun[]; oldPhones?: ReportRun[] };
      const screens: Record<Verdict, number> = { pass: 0, warn: 0, fail: 0 };
      for (let i = 0; i < report.runs.length; i += 1) {
        screens[report.runs[i].status] += 1;
      }
      // A stress scenario runs on one screen, so its check is already the whole answer.
      const stress = (report.stress || []).flatMap((run) => run.checks);
      // Language runs add their words to the screens' remarks: text that does not fit, missing translations.
      const languages = mergeRuns(report.languages || []).filter((check) => check.id === "language");
      build.checks = [...report.fileChecks, ...mergeRuns([...report.runs, ...(report.languages || [])].map((run) => ({
        ...run,
        checks: run.checks.filter((check) => check.id !== "language"),
      }))), ...stress, ...languages, ...mergeRuns((report.oldPhones || []).map((run) => ({
        ...run,
        // An old phone answers only for itself: its load and error checks stay in its own section.
        checks: run.checks.filter((check) => check.id === "old-phone" || check.id === "old-code"),
      })))];
      build.verdict = overallStatus(build.checks);
      build.screens = screens;
      build.reportDir = reportDir;
      build.reportUrl = `/reports/${encodeURIComponent(reportDir)}/index.html`;
      build.state = "done";
    } catch (error) {
      build.state = "failed";
      build.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async _run(batch: StoredBatch, build: StoredBuild): Promise<void> {
    build.state = "running";
    build.error = undefined;
    await this._save(batch);
    const label = `${build.network ? build.network.name : "Unknown network"} · ${path.basename(build.name)}`;
    const profile = build.network?.known ? networkById(build.network.id) : undefined;
    const args = [
      "--playable",
      path.join(this._batchesDir, batch.id, build.entry),
      "--name",
      label,
      "--out",
      this._reportsDir,
      "--no-video",
      "--settle",
      "3500",
      "--lang",
      batch.lang || "en",
    ];
    if (profile) {
      args.push("--network", profile.id);
    }
    if (build.kind === "zip") {
      args.push("--bundle", "--zip-bytes", String(build.bytes));
    }
    if (batch.traceId) {
      args.push("--trace", path.join(this._tracesDir, `${batch.traceId}.json`));
      for (const other of batch.alsoTraceIds || []) {
        args.push("--trace", path.join(this._tracesDir, `${other}.json`));
      }
    }
    if (batch.by) {
      args.push("--by", batch.by);
    }
    // Every build of an archive is the same game for another network: its
    // languages are checked once, on the first build that is tested.
    const first = batch.builds.find((item) => item.state !== "skipped");
    if (first && first.id !== build.id) {
      args.push("--languages", "none", "--old-phones", "none");
    }

    build.progress = undefined;
    const result = await runRunner(this._root, args, {
      depth: batch.depth,
      onUpdate: (update) => {
        if (update.progress) {
          build.progress = update.progress;
        }
        build.tiles = applyScreens(build.tiles, update);
      },
    });
    build.progress = undefined;
    build.tiles = undefined;

    if (!result.reportDir) {
      build.state = "failed";
      build.error = lastLine(result.output) || "The runner did not produce a report.";
      await this._save(batch);
      return;
    }
    await this._applyReport(build, result.reportDir);
    await this._save(batch);
  }
}

/** Checks the hub computes itself at upload; everything else comes from a run. */
const STATIC_IDS = new Set([
  "size",
  "packaging",
  "external-refs",
  "single-file",
  "cta-source",
  "required-source",
  "discouraged-source",
  "viewport-meta",
  "store-links",
]);
