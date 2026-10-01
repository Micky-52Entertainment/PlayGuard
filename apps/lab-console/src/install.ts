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
