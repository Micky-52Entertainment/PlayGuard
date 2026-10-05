// What the console sees of the app it is open in: see apps/lab-console/src/install.ts.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("playguardDesktop", {
  version: ipcRenderer.sendSync("playguard:version") as string,
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke("playguard:check-updates"),
});
