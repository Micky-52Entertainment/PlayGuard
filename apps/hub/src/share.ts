import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";
import express from "express";

/**
 * A report opened from outside the office. The lab stays on this computer: a
 * Cloudflare quick tunnel (cloudflared, no account) reaches a small separate
 * server that shows nothing but the reports a link was made for, each behind
 * a random key and only until the link expires or is revoked.
 */

export type ToolState = "missing" | "installing" | "ready" | "failed";
export type TunnelState = "off" | "starting" | "on" | "failed";

export interface ShareLink {
  token: string;
  dir: string;
  lang: string;
  by?: string;
  createdAt: number;
  expiresAt: number;
}

export interface ShareStatus {
  tool: ToolState;
  /** Download size in bytes, when known: shown before asking to download. */
  size: number | null;
  source: string;
  tunnel: TunnelState;
  url: string | null;
  error: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
/** How long a link works unless revoked sooner. */
export const LINK_DAYS = 7;

const releaseAsset = (): { file: string; archive: boolean } | null => {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null;
  if (!arch) {
    return null;
  }
  if (process.platform === "darwin") {
    return { file: `cloudflared-darwin-${arch}.tgz`, archive: true };
  }
  if (process.platform === "linux") {
    return { file: `cloudflared-linux-${arch}`, archive: false };
  }
  if (process.platform === "win32") {
    return { file: `cloudflared-windows-${arch}.exe`, archive: false };
  }
  return null;
};

const RELEASES = "https://github.com/cloudflare/cloudflared/releases/latest/download/";

export class Sharing {
  private _links: ShareLink[] = [];
  private _tool: ToolState = "missing";
  private _toolError: string | null = null;
  private _size: number | null = null;
  private _tunnel: TunnelState = "off";
  private _tunnelError: string | null = null;
  private _url: string | null = null;
  private _child: ChildProcess | null = null;
  private _starting: Promise<string> | null = null;
  private _server: Server | null = null;
  private _port = 0;
  private readonly _bin: string;
  private readonly _file: string;

  public constructor(
    root: string,
    dataDir: string,
    private readonly _reportsDir: string,
    private readonly _brief: (dir: string, lang: string) => Promise<string>
  ) {
    this._bin = path.join(root, ".playable-lab", "bin", process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
    this._file = path.join(dataDir, ".playable-lab", "shares.json");
    this._tool = existsSync(this._bin) ? "ready" : "missing";
  }

  public async load(): Promise<void> {
    try {
      this._links = (JSON.parse(await readFile(this._file, "utf8")) as ShareLink[]).filter((link) => link.expiresAt > Date.now());
    } catch {
      this._links = [];
    }
  }

  public status(): ShareStatus {
    return {
      tool: this._tool,
      size: this._size,
      source: "github.com/cloudflare/cloudflared",
      tunnel: this._tunnel,
      url: this._url,
      error: this._tool === "failed" ? this._toolError : this._tunnel === "failed" ? this._tunnelError : null,
    };
  }

  /** The download's size, asked for before anything is downloaded. */
  public async measure(): Promise<void> {
    const asset = releaseAsset();
    if (!asset || this._size !== null || this._tool === "ready") {
      return;
    }
    try {
      const response = await fetch(RELEASES + asset.file, { method: "HEAD", redirect: "follow" });
      const length = Number(response.headers.get("content-length"));
      this._size = Number.isFinite(length) && length > 0 ? length : null;
    } catch {
      this._size = null;
    }
  }

  /** Downloads cloudflared into the lab's own folder; the operator agreed to it first. */
  public async install(): Promise<void> {
    if (this._tool === "installing" || this._tool === "ready") {
      return;
    }
    const asset = releaseAsset();
    if (!asset) {
      this._tool = "failed";
      this._toolError = `No cloudflared build for ${process.platform} ${process.arch}.`;
      return;
    }
    this._tool = "installing";
    this._toolError = null;
    try {
      await mkdir(path.dirname(this._bin), { recursive: true });
      const response = await fetch(RELEASES + asset.file, { redirect: "follow" });
      if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status}`);
      }
      const data = Buffer.from(await response.arrayBuffer());
      if (asset.archive) {
        const archive = `${this._bin}.tgz`;
        await writeFile(archive, data);
        await new Promise<void>((resolve, reject) => {
          const tar = spawn("tar", ["-xzf", archive, "-C", path.dirname(this._bin)]);
          tar.on("error", reject);
          tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Could not unpack cloudflared (tar ${code}).`))));
        });
        await rm(archive, { force: true });
      } else {
        await writeFile(`${this._bin}.part`, data);
        await rename(`${this._bin}.part`, this._bin);
      }
      await chmod(this._bin, 0o755);
      this._tool = "ready";
    } catch (error) {
      this._tool = "failed";
      this._toolError = error instanceof Error ? error.message : String(error);
    }
  }

  public linksFor(dir: string): ShareLink[] {
    return this._links.filter((link) => link.dir === dir && link.expiresAt > Date.now());
  }

  /** A new link for one report; starts the tunnel when it is not running. */
  public async create(dir: string, lang: string, by?: string): Promise<{ link: ShareLink; url: string }> {
    const base = await this._ensureTunnel();
    const link: ShareLink = {
      token: randomBytes(18).toString("base64url"),
      dir,
      lang,
      by,
      createdAt: Date.now(),
      expiresAt: Date.now() + LINK_DAYS * DAY,
    };
    this._links.push(link);
    await this._save();
    return { link, url: `${base}/s/${link.token}/` };
  }

  public async revoke(token: string): Promise<boolean> {
    const before = this._links.length;
    this._links = this._links.filter((link) => link.token !== token);
    await this._save();
    return this._links.length < before;
  }

  /** The public address of a link, while the tunnel is up. */
  public urlOf(token: string): string | null {
    return this._url ? `${this._url}/s/${token}/` : null;
  }

  public stop(): void {
    this._child?.kill();
    this._server?.close();
  }

  private async _save(): Promise<void> {
    await mkdir(path.dirname(this._file), { recursive: true });
    await writeFile(this._file, JSON.stringify(this._links.filter((link) => link.expiresAt > Date.now()), null, 2), "utf8");
  }

  private _find(token: string): ShareLink | undefined {
    return this._links.find((link) => link.token === token && link.expiresAt > Date.now());
  }

  /** The only thing the outside can reach: the reports that have a live link, read-only. */
  private async _serve(): Promise<number> {
    if (this._server) {
      return this._port;
    }
    const app = express();
    app.disable("x-powered-by");
    app.use((_req, res, next) => {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Referrer-Policy", "no-referrer");
      next();
    });
    app.get("/s/:token/", async (req, res) => {
      const link = this._find(req.params.token);
      if (!link) {
        res.status(404).send(GONE);
        return;
      }
      try {
        const html = await this._brief(link.dir, link.lang);
        const more = link.lang === "ru" ? "Полный технический отчёт" : link.lang === "fr" ? "Rapport technique complet" : "Full technical report";
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(
          html.replace(
            "</body>",
            `<p style="text-align:center;margin:28px 0 40px;font:15px system-ui,sans-serif"><a href="report/index.html">${more} →</a></p></body>`
          )
        );
      } catch {
        res.status(404).send(GONE);
      }
    });
    app.get("/s/:token/report/*", (req, res) => {
      const link = this._find(req.params.token);
      const rest = (req.params as unknown as Record<string, string>)[0] || "index.html";
      // How the check was started stays on this computer: it holds local paths.
      if (!link || rest === "run.json") {
        res.status(404).send(GONE);
        return;
      }
      const root = path.join(this._reportsDir, link.dir);
      const file = path.resolve(root, rest);
      if (!file.startsWith(root + path.sep)) {
        res.status(404).send(GONE);
        return;
      }
      res.sendFile(file, (error) => {
        if (error && !res.headersSent) {
          res.status(404).send(GONE);
        }
      });
    });
    app.use((_req, res) => {
      res.status(404).send(GONE);
    });
    await new Promise<void>((resolve) => {
      this._server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this._server!.address();
    this._port = typeof address === "object" && address ? address.port : 0;
    return this._port;
  }

  private async _ensureTunnel(): Promise<string> {
    if (this._tunnel === "on" && this._url) {
      return this._url;
    }
    if (this._starting) {
      return this._starting;
    }
    if (this._tool !== "ready") {
      throw new Error("cloudflared is not installed.");
    }
    this._starting = (async () => {
      const port = await this._serve();
      this._tunnel = "starting";
      this._tunnelError = null;
      return await new Promise<string>((resolve, reject) => {
        const child = spawn(this._bin, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        this._child = child;
        let log = "";
        const timer = setTimeout(() => {
          fail(new Error("Cloudflare did not give an address within 40 s. Check the internet connection and try again."));
        }, 40000);
        const fail = (error: Error): void => {
          clearTimeout(timer);
          this._tunnel = "failed";
          this._tunnelError = error.message;
          this._url = null;
          child.kill();
          reject(error);
        };
        const read = (chunk: Buffer): void => {
          log = `${log}${chunk.toString()}`.slice(-4000);
          const found = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log);
          if (found && this._tunnel !== "on") {
            clearTimeout(timer);
            this._url = found[0];
            this._tunnel = "on";
            console.log(`[hub] reports can be opened from outside through ${this._url}`);
            resolve(found[0]);
          }
        };
        child.stdout?.on("data", read);
        child.stderr?.on("data", read);
        child.on("error", (error) => fail(error));
        child.on("close", () => {
          if (this._tunnel === "on") {
            this._tunnel = "off";
            this._url = null;
          }
        });
      });
    })().finally(() => {
      this._starting = null;
    });
    return this._starting;
  }
}

const GONE = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PlayGuard</title></head>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;font:16px system-ui,sans-serif;background:#0d1117;color:#e6ebf2;text-align:center">
<div style="max-width:32ch;padding:24px"><h1 style="font-size:20px">This link no longer works</h1><p style="color:#94a1b2">It has expired or was revoked. Ask for a new one. · Ссылка больше не работает: срок истёк или её отозвали. Попросите новую.</p></div></body></html>`;
