import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface StoragePart {
  count: number;
  bytes: number;
}

/** How much of the disk the lab's history takes, by kind. */
export interface StorageReport {
  reports: StoragePart;
  traces: StoragePart;
  batches: StoragePart;
  playables: StoragePart;
}

export const folderSize = async (target: string): Promise<number> => {
  let info;
  try {
    info = await stat(target);
  } catch {
    return 0;
  }
  if (!info.isDirectory()) {
    return info.size;
  }
  let total = 0;
  const items = await readdir(target);
  for (let i = 0; i < items.length; i += 1) {
    total += await folderSize(path.join(target, items[i]));
  }
  return total;
};

/** Entries of a folder with their age; hidden files and the placeholder that keeps the folder in git are left alone. */
export const entriesOf = async (dir: string, pattern?: RegExp): Promise<Array<{ name: string; modified: number }>> => {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: Array<{ name: string; modified: number }> = [];
  for (let i = 0; i < names.length; i += 1) {
    if (names[i].startsWith(".") || (pattern && !pattern.test(names[i]))) {
      continue;
    }
    try {
      out.push({ name: names[i], modified: (await stat(path.join(dir, names[i]))).mtimeMs });
    } catch {
      continue;
    }
  }
  return out;
};

export const sizeOf = async (dir: string, pattern?: RegExp): Promise<StoragePart> => {
  const entries = await entriesOf(dir, pattern);
  let bytes = 0;
  for (let i = 0; i < entries.length; i += 1) {
    bytes += await folderSize(path.join(dir, entries[i].name));
  }
  return { count: entries.length, bytes };
};

/** Removes one entry of a lab folder; the name must not leave that folder. */
export const removeEntry = async (dir: string, name: string): Promise<boolean> => {
  const safe = path.basename(name);
  if (!safe || safe.startsWith(".") || safe !== name) {
    return false;
  }
  const target = path.join(dir, safe);
  try {
    await stat(target);
  } catch {
    return false;
  }
  await rm(target, { recursive: true, force: true });
  return true;
};
