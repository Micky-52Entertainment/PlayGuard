// PlayGuard as an installed app: starts the hub in the background, shows the
// console in its own window and keeps the hub running for the team while the
// window is closed. The hub and the console are the same as with `npm start`.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
  utilityProcess,
} from "electron";
import type { MenuItemConstructorOptions, Rectangle, UtilityProcess } from "electron";
import { checkNow, startUpdates } from "./updater";

const PORT = Number(process.env.HUB_PORT || 8787);
const HOME = `http://localhost:${PORT}/`;
const HEALTH = `http://127.0.0.1:${PORT}/api/health`;
const SMOKE = process.env.PLAYGUARD_SMOKE === "1";
const MAC = process.platform === "darwin";
const WINDOWS = process.platform === "win32";

/** The app folder: the bundled hub, runner and console, laid out like the repo. */
const APP_ROOT = app.getAppPath();
const DATA = app.getPath("userData");
// The window's own caches go to a subfolder, so the data folder holds only PlayGuard's checks.
app.setPath("sessionData", path.join(DATA, "Session"));
/** Browsers shipped with the installer; a dev run without them uses Playwright's usual cache. */
const BROWSERS = app.isPackaged ? path.join(process.resourcesPath, "browsers") : path.join(APP_ROOT, "../browsers");

const ru = (): boolean => /^ru/i.test(app.getLocale());
const say = (en: string, russian: string): string => (ru() ? russian : en);

let hub: UtilityProcess | null = null;
let hubLog = "";
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let toldAboutTray = false;

// ---- The hub ---------------------------------------------------------------

const answers = async (url: string): Promise<boolean> => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};

const json = async <T>(url: string): Promise<T | null> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
};

const startHub = (): void => {
  hubLog = "";
  hub = utilityProcess.fork(path.join(APP_ROOT, "out/hub.mjs"), [], {
    serviceName: "PlayGuard Hub",
    stdio: "pipe",
    env: {
      ...process.env,
      HUB_PORT: String(PORT),
      PLAYGUARD_DESKTOP: "1",
      PLAYGUARD_ROOT: APP_ROOT,
      PLAYGUARD_DATA: DATA,
      PLAYGUARD_RUNNER_JS: path.join(APP_ROOT, "out/runner.mjs"),
      // The runner runs on this app's binary in Node mode: no separate Node to install.
      PLAYGUARD_NODE: process.execPath,
      ...(existsSync(BROWSERS) ? { PLAYWRIGHT_BROWSERS_PATH: BROWSERS } : {}),
    },
  });
  const collect = (chunk: Buffer): void => {
    hubLog = (hubLog + chunk.toString()).slice(-3000);
  };
  hub.stdout?.on("data", collect);
  hub.stderr?.on("data", collect);
  hub.on("exit", (code) => {
    hub = null;
    if (!quitting) {
      void hubStopped(code);
    }
  });
};

/** Stops the hub and whatever it started: runners and their browsers. */
const stopHub = (): void => {
  const pid = hub?.pid;
  if (pid) {
    killTree(pid);
  }
  hub?.kill();
  hub = null;
};

const killTree = (pid: number): void => {
  if (WINDOWS) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
    return;
  }
  const table = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }).stdout || "";
  const children = new Map<number, number[]>();
  for (const line of table.split("\n")) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);
    if (child && parent) {
      children.set(parent, [...(children.get(parent) || []), child]);
    }
  }
  const all: number[] = [];
  const walk = (id: number): void => {
    for (const child of children.get(id) || []) {
      all.push(child);
      walk(child);
    }
  };
  walk(pid);
  for (const id of all.reverse()) {
    try {
      process.kill(id, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
};

const hubStopped = async (code: number): Promise<void> => {
  if (SMOKE) {
    console.error(`Hub stopped (${code}):\n${hubLog}`);
    app.exit(1);
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: "error",
    message: say("PlayGuard stopped working", "PlayGuard перестал работать"),
    detail: hubLog.trim().split("\n").slice(-12).join("\n") || `exit code ${code}`,
    buttons: [say("Restart", "Перезапустить"), say("Quit", "Выйти")],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    await bringUp();
  } else {
    app.quit();
  }
};

/** Starts the hub and waits until it answers. False when the user chose to quit. */
const bringUp = async (): Promise<boolean> => {
  // Something already answers on the port: most likely PlayGuard started from the project folder.
  while (await answers(HEALTH)) {
    if (SMOKE) {
      console.error(`Port ${PORT} is busy`);
      return false;
    }
    const { response } = await dialog.showMessageBox({
      type: "warning",
      message: say("PlayGuard is already running", "PlayGuard уже запущен"),
      detail: say(
        `Another PlayGuard answers on port ${PORT} — probably started from the project folder (PlayGuard.command / .bat / npm start). Close it, then press Retry.`,
        `На порту ${PORT} уже работает другой PlayGuard — скорее всего, запущенный из папки проекта (PlayGuard.command / .bat / npm start). Закройте его и нажмите «Повторить».`
      ),
      buttons: [say("Retry", "Повторить"), say("Quit", "Выйти")],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 1) {
      return false;
    }
  }
  startHub();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (!hub) {
      return false;
    }
    if ((await answers(HEALTH)) && (await answers(HOME))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (SMOKE) {
    console.error(`Hub did not answer in 60 s:\n${hubLog}`);
    return false;
  }
  await dialog.showMessageBox({
    type: "error",
    message: say("PlayGuard could not start", "PlayGuard не запустился"),
    detail: hubLog.trim().split("\n").slice(-12).join("\n"),
  });
  return false;
};

// ---- The window ------------------------------------------------------------

const BOUNDS_FILE = path.join(DATA, "window.json");

const savedBounds = (): Partial<Rectangle> => {
  try {
    return JSON.parse(readFileSync(BOUNDS_FILE, "utf8")) as Rectangle;
  } catch {
    return {};
  }
};

const SPLASH = `data:text/html;charset=utf-8,${encodeURIComponent(
  `<!doctype html><meta charset="utf-8"><style>
  html,body{height:100%;margin:0;display:grid;place-items:center;font:15px -apple-system,Segoe UI,sans-serif;background:#f6f7fb;color:#555}
  @media (prefers-color-scheme:dark){html,body{background:#16171c;color:#aaa}}
  </style><body>PlayGuard…</body>`
)}`;

const isOwn = (url: string): boolean => {
  try {
    const { hostname, port } = new URL(url);
    return (hostname === "localhost" || hostname === "127.0.0.1") && Number(port) === PORT;
  } catch {
    return false;
  }
};

const openWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    ...savedBounds(),
    title: "PlayGuard",
    icon: path.join(APP_ROOT, "icon.png"),
    backgroundColor: "#f6f7fb",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(APP_ROOT, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} PlayGuardDesktop/${app.getVersion()}`);
  // Reports and played builds open in a window of their own; everything else in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOwn(url)) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: path.join(APP_ROOT, "icon.png") } };
    }
    if (/^(https?|mailto):/.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isOwn(url) && !url.startsWith("data:")) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  const remember = (): void => {
    try {
      writeFileSync(BOUNDS_FILE, JSON.stringify(win.getNormalBounds()));
    } catch {
      // Not worth a message.
    }
  };
  win.on("resized", remember);
  win.on("moved", remember);
  // Closing the window keeps the hub running: phones and teammates still reach it.
  win.on("close", (event) => {
    if (quitting) {
      return;
    }
    event.preventDefault();
    win.hide();
    if (!toldAboutTray && !MAC && Notification.isSupported()) {
      toldAboutTray = true;
      new Notification({
        title: "PlayGuard",
        body: say(
          "PlayGuard keeps working for your team. Quit it from the icon next to the clock.",
          "PlayGuard продолжает работать для команды. Выйти можно через значок рядом с часами."
        ),
      }).show();
    }
  });
  void win.loadURL(SPLASH);
  return win;
};

const show = (): void => {
  if (!window || window.isDestroyed()) {
    window = openWindow();
    void window.loadURL(HOME);
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
};

// ---- Tray and menu ---------------------------------------------------------

const copyTeamLink = async (): Promise<void> => {
  const meta = await json<{ teamUrl?: string | null }>(`http://127.0.0.1:${PORT}/api/meta`);
  if (meta?.teamUrl) {
    clipboard.writeText(meta.teamUrl);
    new Notification({ title: "PlayGuard", body: say(`Copied: ${meta.teamUrl}`, `Скопировано: ${meta.teamUrl}`) }).show();
  } else {
    void dialog.showMessageBox({
      type: "info",
      message: say("No team link yet", "Ссылки для команды пока нет"),
      detail: say("This computer is not connected to a network teammates can reach.", "Этот компьютер не подключён к сети, через которую его видят коллеги."),
    });
  }
};

const trayItems = (): MenuItemConstructorOptions[] => [
  { label: say("Open PlayGuard", "Открыть PlayGuard"), click: show },
  { label: say("Open in browser", "Открыть в браузере"), click: () => void shell.openExternal(HOME) },
  { label: say("Copy link for the team", "Скопировать ссылку для команды"), click: () => void copyTeamLink() },
  { type: "separator" },
  { label: say("Data folder", "Папка с данными"), click: () => void shell.openPath(DATA) },
  { label: say("Check for updates…", "Проверить обновления…"), click: () => void checkNow() },
  { type: "separator" },
  { label: say("Quit PlayGuard", "Выйти из PlayGuard"), click: () => app.quit() },
];

const makeTray = (): void => {
  const image = nativeImage.createFromPath(path.join(APP_ROOT, "apps/lab-console/public/favicon.png")).resize({ width: MAC ? 18 : 16 });
  tray = new Tray(image);
  tray.setToolTip("PlayGuard");
  tray.setContextMenu(Menu.buildFromTemplate(trayItems()));
  if (!MAC) {
    tray.on("click", show);
  }
};

const makeMenu = (): void => {
  if (!MAC) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "PlayGuard",
        submenu: [
          { role: "about" },
          { label: say("Check for updates…", "Проверить обновления…"), click: () => void checkNow() },
          { type: "separator" },
          { label: say("Data folder", "Папка с данными"), click: () => void shell.openPath(DATA) },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: say("View", "Вид"),
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ])
  );
};

// ---- Start -----------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", show);
  app.on("activate", show);
  app.on("window-all-closed", () => {
    // The hub keeps working; the app quits only from the tray or the menu.
  });
  app.on("before-quit", () => {
    quitting = true;
    stopHub();
  });
  ipcMain.on("playguard:version", (event) => {
    event.returnValue = app.getVersion();
  });
  ipcMain.handle("playguard:check-updates", () => checkNow());

  void app.whenReady().then(async () => {
    if (SMOKE) {
      const up = await bringUp();
      const meta = up ? await json<{ desktop?: boolean }>(`http://127.0.0.1:${PORT}/api/meta`) : null;
      const health = up ? await json<{ browser?: string; webkit?: boolean }>(HEALTH) : null;
      const ok = Boolean(meta?.desktop) && (!app.isPackaged || (health?.browser === "bundled" && health.webkit === true));
      console.log(JSON.stringify({ ok, meta, health }));
      quitting = true;
      stopHub();
      app.exit(ok ? 0 : 1);
      return;
    }
    makeMenu();
    window = openWindow();
    makeTray();
    if (!(await bringUp())) {
      quitting = true;
      app.quit();
      return;
    }
    await window.loadURL(HOME);
    startUpdates();
  });
}
