/**
 * PlayGuard as an app with its own window and icon. The browser offers the
 * install once the page qualifies; the offer is kept here until someone asks.
 */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let offer: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = (): void => listeners.forEach((listener) => listener());

export type InstallState = "installed" | "ready" | "manual" | "insecure";

/** What the installed desktop app puts into its window (apps/desktop/src/preload.cts). */
export interface DesktopApp {
  version: string;
  checkForUpdates: () => Promise<void>;
}

/** The installed desktop app, when the console is open in its window. */
export const desktopApp = (): DesktopApp | null =>
  (window as { playguardDesktop?: DesktopApp }).playguardDesktop ?? null;

export const installState = (): InstallState => {
  if (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone) {
    return "installed";
  }
  if (offer) {
    return "ready";
  }
  // Browsers install only from localhost or https: a teammate on the office address cannot.
  return window.isSecureContext ? "manual" : "insecure";
};

export const onInstallChange = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const install = async (): Promise<boolean> => {
  if (!offer) {
    return false;
  }
  const current = offer;
  offer = null;
  await current.prompt();
  const choice = await current.userChoice;
  changed();
  return choice.outcome === "accepted";
};

export const startInstall = (): void => {
  // Already an app: no browser install, and no offline page for a server that lives in the app.
  if (desktopApp()) {
    return;
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    offer = event as InstallPrompt;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    changed();
  });
  if ("serviceWorker" in navigator && window.isSecureContext) {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }
};
