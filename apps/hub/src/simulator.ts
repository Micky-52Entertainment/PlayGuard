import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * "ready": Xcode and an iPhone simulator are here. "no-xcode": a Mac without
 * Xcode. "no-runtime": Xcode without the iOS platform. "unsupported": not a Mac.
 */
export type SimulatorState = "ready" | "no-xcode" | "no-runtime" | "unsupported";

const XCODE_DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";
const XCODE_STORE_URL = "macappstore://apps.apple.com/app/xcode/id497799835";
/** Xcode is not installed or removed every minute; asking it on every poll would be wasteful. */
const CACHE_MS = 20000;

interface SimDevice {
  name: string;
  udid: string;
  state: string;
  runtime: string;
}

const run = (command: string, args: string[], timeoutMs: number): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        // Works without `xcode-select -s`, which would need the administrator's password.
        env: existsSync(XCODE_DEVELOPER_DIR)
          ? { ...process.env, DEVELOPER_DIR: XCODE_DEVELOPER_DIR }
          : process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message).trim().split("\n")[0]));
          return;
        }
        resolve(stdout);
      }
    );
  });

const listIphones = async (): Promise<SimDevice[]> => {
  const raw = JSON.parse(await run("xcrun", ["simctl", "list", "devices", "available", "-j"], 15000)) as {
    devices: Record<string, Array<{ name: string; udid: string; state: string }>>;
  };
  const out: SimDevice[] = [];
  const runtimes = Object.keys(raw.devices).filter((key) => /iOS/i.test(key));
  for (let r = 0; r < runtimes.length; r += 1) {
    const list = raw.devices[runtimes[r]];
    for (let i = 0; i < list.length; i += 1) {
      if (/^iPhone/.test(list[i].name)) {
        out.push({ ...list[i], runtime: runtimes[r] });
      }
    }
  }
  return out;
};

/** The numbers in a runtime id or a device name, for "newest first". */
const rank = (text: string): number[] => (text.match(/\d+/g) || []).map(Number);
const newer = (a: number[], b: number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) {
      return (b[i] || 0) - (a[i] || 0);
    }
  }
  return 0;
};

/** The iPhone simulator that comes with Xcode: the closest thing to a real iPhone on a Mac. */
export class Simulator {
  private _cached: { at: number; state: SimulatorState } | null = null;

  public async state(): Promise<SimulatorState> {
    if (process.platform !== "darwin") {
      return "unsupported";
    }
    if (this._cached && Date.now() - this._cached.at < CACHE_MS) {
      return this._cached.state;
    }
    let state: SimulatorState;
    try {
      state = (await listIphones()).length > 0 ? "ready" : "no-runtime";
    } catch {
      state = existsSync(XCODE_DEVELOPER_DIR) ? "no-runtime" : "no-xcode";
    }
    this._cached = { at: Date.now(), state };
    return state;
  }

  /** Opens Xcode's page in the App Store; the operator installs it there. */
  public openStore(): void {
    spawn("open", [XCODE_STORE_URL], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  }

  /** Boots an iPhone simulator if none is running, and opens `url` in its Safari. Returns the device's name. */
  public async open(url: string): Promise<string> {
    this._cached = null;
    const phones = await listIphones();
    if (phones.length === 0) {
      throw new Error("No iPhone simulator is installed.");
    }
    const device =
      phones.find((item) => item.state === "Booted") ||
      phones
        .slice()
        .sort((a, b) => newer(rank(a.runtime), rank(b.runtime)) || newer(rank(a.name), rank(b.name)))
        // A plain or Pro model: the screen most players have.
        .find((item) => /^iPhone \d+( Pro)?$/.test(item.name)) ||
      phones[0];
    if (device.state !== "Booted") {
      await run("xcrun", ["simctl", "boot", device.udid], 60000).catch((error: Error) => {
        if (!/already booted|current state: Booted/i.test(error.message)) {
          throw error;
        }
      });
    }
    await run("open", ["-a", "Simulator"], 15000);
    await run("xcrun", ["simctl", "bootstatus", device.udid, "-b"], 180000);
    await run("xcrun", ["simctl", "openurl", device.udid, url], 30000);
    return device.name;
  }
}
