#!/usr/bin/env node
// One command for the whole lab: starts the hub and the console, waits until
// both answer, opens the console in the browser. Ctrl+C stops everything.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HUB_PORT = process.env.HUB_PORT || "8787";
const CONSOLE_PORT = process.env.CONSOLE_PORT || "5173";
const HUB_URL = `http://127.0.0.1:${HUB_PORT}/api/health`;
const OLD_HUB_URL = `http://127.0.0.1:${HUB_PORT}/api/meta`;
// The hub serves the built console: one address for this computer and for the team.
const CONSOLE_URL = `http://localhost:${HUB_PORT}/`;
const WINDOWS = process.platform === "win32";
const RU = /^ru/i.test(process.env.LANG || process.env.LC_ALL || Intl.DateTimeFormat().resolvedOptions().locale || "");

const say = (en, ru) => console.log(RU ? ru : en);

const answers = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
};

const openBrowser = (url) => {
  if (process.env.PLAYABLE_LAB_NO_OPEN) {
    return;
  }
  const command = process.platform === "darwin" ? "open" : WINDOWS ? "cmd" : "xdg-open";
  const args = WINDOWS ? ["/c", "start", "", url] : [url];
  spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
};

const children = [];
let stopping = false;

const stop = (code) => {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const child of children) {
    try {
      if (WINDOWS) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      } else {
        // Each part runs in its own process group, so its helpers stop with it.
        process.kill(-child.pid, "SIGTERM");
      }
    } catch {
      // Already gone.
    }
  }
  process.exit(code);
};

const run = (name, script) => {
  const child = spawn("npm", ["run", script], {
    cwd: ROOT,
    env: { ...process.env, HUB_PORT, CONSOLE_PORT },
    stdio: ["ignore", "pipe", "pipe"],
    shell: WINDOWS,
    detached: !WINDOWS,
  });
  let tail = "";
  const collect = (chunk) => {
    tail = (tail + chunk.toString()).slice(-3000);
    if (process.env.PLAYABLE_LAB_VERBOSE) {
      process.stdout.write(chunk);
    }
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.on("exit", (code) => {
    if (stopping) {
      return;
    }
    console.error(tail.trim());
    say(
      `\nPlayGuard stopped: the ${name} exited (code ${code}). The lines above say why.`,
      `\nPlayGuard остановлен: ${name === "hub" ? "серверная часть" : "интерфейс"} завершилась (код ${code}). Причина — в строках выше.`
    );
    stop(1);
  });
  children.push(child);
};

const main = async () => {
  if (Number(process.versions.node.split(".")[0]) < 20) {
    say("PlayGuard needs Node.js 20 or newer: https://nodejs.org", "PlayGuard нужен Node.js 20 или новее: https://nodejs.org");
    process.exit(1);
  }
  if (!existsSync(path.join(ROOT, "node_modules", ".bin"))) {
    say("First start: installing dependencies, this takes a minute…", "Первый запуск: устанавливаем зависимости, это займёт минуту…");
    const installed = spawnSync("npm", ["install"], { cwd: ROOT, stdio: "inherit", shell: WINDOWS });
    if (installed.status !== 0) {
      say("npm install failed. See the lines above.", "npm install завершился с ошибкой. Причина — в строках выше.");
      process.exit(1);
    }
  }

  const hubUp = await answers(HUB_URL);
  // A hub started before the last update answers, but does not know the new console.
  if (!hubUp && (await answers(OLD_HUB_URL))) {
    const fix = WINDOWS
      ? `for /f "tokens=5" %p in ('netstat -ano ^| findstr :${HUB_PORT}') do taskkill /PID %p /F`
      : `lsof -ti tcp:${HUB_PORT} -ti tcp:${CONSOLE_PORT} | xargs kill`;
    say(
      `An older PlayGuard is still running on port ${HUB_PORT}. Stop it (close its terminal window, or run the line below), then start again:\n\n  ${fix}\n`,
      `На порту ${HUB_PORT} всё ещё работает старая версия PlayGuard. Остановите её (закройте её окно терминала или выполните строку ниже) и запустите снова:\n\n  ${fix}\n`
    );
    process.exit(1);
  }
  if (hubUp) {
    say(`PlayGuard is already running: ${CONSOLE_URL}`, `PlayGuard уже запущен: ${CONSOLE_URL}`);
    openBrowser(CONSOLE_URL);
    return;
  }

  say("Starting PlayGuard…", "Запускаем PlayGuard…");
  const built = spawnSync("npm", ["run", "build", "-w", "@playable-lab/lab-console"], {
    cwd: ROOT,
    stdio: process.env.PLAYABLE_LAB_VERBOSE ? "inherit" : "ignore",
    shell: WINDOWS,
  });
  if (built.status !== 0) {
    say("The console did not build. Run with PLAYABLE_LAB_VERBOSE=1 to see why.", "Интерфейс не собрался. Запустите с PLAYABLE_LAB_VERBOSE=1, чтобы увидеть причину.");
    process.exit(1);
  }
  run("hub", "hub");
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if ((await answers(HUB_URL)) && (await answers(CONSOLE_URL))) {
      openBrowser(CONSOLE_URL);
      let team = "";
      try {
        team = (await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/meta`)).json()).teamUrl || "";
      } catch {
        team = "";
      }
      say(
        `\nPlayGuard is running: ${CONSOLE_URL}${team ? `\nFor the team, on the same network: ${team}` : ""}\nKeep this window open. Press Ctrl+C to stop.`,
        `\nPlayGuard запущен: ${CONSOLE_URL}${team ? `\nДля команды в той же сети: ${team}` : ""}\nНе закрывайте это окно. Чтобы остановить, нажмите Ctrl+C.`
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  say("PlayGuard did not start in a minute. Run with PLAYABLE_LAB_VERBOSE=1 to see why.", "PlayGuard не запустился за минуту. Запустите с PLAYABLE_LAB_VERBOSE=1, чтобы увидеть причину.");
  stop(1);
};

void main();
