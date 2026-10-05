import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The PlayGuard logo, small, inside the page: the pages the hub writes are sent on as single files. */
export const LOGO_URI = (() => {
  try {
    const root = process.env.PLAYGUARD_ROOT ? path.resolve(process.env.PLAYGUARD_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    return `data:image/png;base64,${readFileSync(path.join(root, "apps/lab-console/public/favicon.png")).toString("base64")}`;
  } catch {
    return "";
  }
})();

/** The logo and the name, as the pages open with. */
export const brandMark = (size = 22): string =>
  LOGO_URI
    ? `<img src="${LOGO_URI}" alt="" width="${size}" height="${size}" style="vertical-align:-${Math.round(size / 4)}px;margin-right:6px" />PlayGuard`
    : "PlayGuard";
