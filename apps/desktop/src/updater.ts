import { app, dialog, Notification, shell } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateInfo } from "electron-updater";

const RELEASES = "https://github.com/Micky-52Entertainment/PlayGuard/releases/latest";
const EVERY = 6 * 60 * 60 * 1000;
const ru = (): boolean => /^ru/i.test(app.getLocale());
const say = (en: string, russian: string): string => (ru() ? russian : en);

// macOS installs an update only into a signed app. Until PlayGuard is signed,
// the Mac app says a new version is out and opens its download page.
const canInstall = process.platform !== "darwin";

let asked = false;

const offerDownload = async (info: UpdateInfo): Promise<void> => {
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: say(`PlayGuard ${info.version} is out`, `Вышел PlayGuard ${info.version}`),
    detail: say(
      "Download the new version and install it over this one. Your checks and settings stay.",
      "Скачайте новую версию и установите поверх этой. Проверки и настройки сохранятся."
    ),
    buttons: [say("Download", "Скачать"), say("Later", "Позже")],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    void shell.openExternal(RELEASES);
  }
};

export const startUpdates = (): void => {
  if (!app.isPackaged) {
    return;
  }
  autoUpdater.autoDownload = canInstall;
  autoUpdater.autoInstallOnAppQuit = canInstall;
  autoUpdater.on("update-available", (info) => {
    if (!canInstall) {
      void offerDownload(info);
    }
  });
  autoUpdater.on("update-downloaded", (info) => {
    new Notification({
      title: say(`PlayGuard ${info.version} is ready`, `PlayGuard ${info.version} готов`),
      body: say("It installs when you quit PlayGuard.", "Обновление установится, когда вы выйдете из PlayGuard."),
    }).show();
  });
  autoUpdater.on("error", () => undefined);
  const check = (): void => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, EVERY).unref();
};

/** "Check for updates", from the tray or the console: answers even when there is nothing new. */
export const checkNow = async (): Promise<void> => {
  if (!app.isPackaged) {
    await dialog.showMessageBox({ message: say("Updates work in the installed app only.", "Обновления работают только в установленном приложении.") });
    return;
  }
  if (asked) {
    return;
  }
  asked = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    const newer = result?.isUpdateAvailable ? result.updateInfo : null;
    if (!newer) {
      await dialog.showMessageBox({
        type: "info",
        message: say(`PlayGuard ${app.getVersion()} is the latest version.`, `PlayGuard ${app.getVersion()} — последняя версия.`),
      });
    } else if (canInstall) {
      await dialog.showMessageBox({
        type: "info",
        message: say(`Downloading PlayGuard ${newer.version}`, `Загружаем PlayGuard ${newer.version}`),
        detail: say("It installs when you quit PlayGuard.", "Обновление установится, когда вы выйдете из PlayGuard."),
      });
    }
    // On macOS the "update-available" handler already offered the download.
  } catch (error) {
    await dialog.showMessageBox({
      type: "warning",
      message: say("Could not check for updates.", "Не удалось проверить обновления."),
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    asked = false;
  }
};
