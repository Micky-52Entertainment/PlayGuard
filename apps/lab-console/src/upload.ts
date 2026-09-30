/**
 * Whatever the operator drops or picks — one HTML, a zip, several files, a
 * folder of builds — turned into the one thing the hub takes: a playable
 * (a single HTML) or an archive of builds.
 */

export interface PickedFile {
  /** Path inside what was picked, with forward slashes. */
  path: string;
  file: File;
}

export type Upload =
  | { kind: "html"; file: File }
  | { kind: "archive"; file: File }
  | { kind: "unsupported"; name: string };

const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$|(^|\/)__MACOSX\//i;
const OTHER_ARCHIVE = /\.(rar|7z|tar|gz|tgz|bz2|xz)$/i;

/** Files of an <input>, with the folder they came from when a folder was picked. */
export const fromInput = (list: FileList | null): PickedFile[] => {
  const out: PickedFile[] = [];
  for (let i = 0; list && i < list.length; i += 1) {
    const file = list[i];
    const path = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
    if (!JUNK.test(path)) {
      out.push({ path, file });
    }
  }
  return out;
};

const readEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => reader.readEntries(resolve, reject));

const fileOf = (entry: FileSystemFileEntry): Promise<File> => new Promise((resolve, reject) => entry.file(resolve, reject));

const walk = async (entry: FileSystemEntry, prefix: string, out: PickedFile[]): Promise<void> => {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (JUNK.test(path)) {
    return;
  }
  if (entry.isFile) {
    out.push({ path, file: await fileOf(entry as FileSystemFileEntry) });
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // A directory reader hands out its entries in batches until it returns none.
  for (;;) {
    const batch = await readEntries(reader);
    if (batch.length === 0) {
      break;
    }
    for (let i = 0; i < batch.length; i += 1) {
      await walk(batch[i], path, out);
    }
  }
};

/** Everything dropped, folders included. */
export const fromDrop = async (data: DataTransfer): Promise<PickedFile[]> => {
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < data.items.length; i += 1) {
    const entry = data.items[i].webkitGetAsEntry?.();
    if (entry) {
      entries.push(entry);
    }
  }
  if (entries.length === 0) {
    return fromInput(data.files);
  }
  const out: PickedFile[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    await walk(entries[i], "", out);
  }
  return out;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** Packs files into a zip without compressing them: it only travels to this computer's hub. */
export const zipFiles = async (files: PickedFile[]): Promise<Blob> => {
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  const encoder = new TextEncoder();
  let offset = 0;
  for (let i = 0; i < files.length; i += 1) {
    const data = new Uint8Array(await files[i].file.arrayBuffer());
    const name = encoder.encode(files[i].path);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(local.buffer, name, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(entry.buffer, name);
    offset += 30 + name.length + data.length;
  }
  // Each central record is 46 bytes plus its name.
  let size = 0;
  for (let i = 0; i < files.length; i += 1) {
    size += 46 + encoder.encode(files[i].path).length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
};

const isHtml = (name: string): boolean => /\.html?$/i.test(name);
const isZip = (name: string): boolean => /\.zip$/i.test(name);

/**
 * What to send. One HTML is a playable; one zip is an archive as it is;
 * anything else — several files, a folder, a build with its assets — is
 * packed into one archive, and the hub finds the builds in it.
 */
export const prepare = async (files: PickedFile[], asArchive = false): Promise<Upload> => {
  if (files.length === 0) {
    return { kind: "unsupported", name: "" };
  }
  if (files.length === 1) {
    const only = files[0];
    if (OTHER_ARCHIVE.test(only.path)) {
      return { kind: "unsupported", name: only.path };
    }
    if (isZip(only.path)) {
      return { kind: "archive", file: only.file };
    }
    if (isHtml(only.path)) {
      if (!asArchive) {
        return { kind: "html", file: only.file };
      }
      return { kind: "archive", file: new File([await zipFiles(files)], `${only.file.name.replace(/\.html?$/i, "")}.zip`) };
    }
    return { kind: "unsupported", name: only.path };
  }
  if (!files.some((item) => isHtml(item.path) || isZip(item.path))) {
    const odd = files.find((item) => OTHER_ARCHIVE.test(item.path));
    return { kind: "unsupported", name: odd ? odd.path : files[0].path };
  }
  const roots = Array.from(new Set(files.map((item) => item.path.split("/")[0])));
  const name =
    roots.length === 1 && files.some((item) => item.path.includes("/"))
      ? roots[0]
      : `${files[0].file.name.replace(/\.(html?|zip)$/i, "")} +${files.length - 1}`;
  return { kind: "archive", file: new File([await zipFiles(files)], `${name}.zip`) };
};
