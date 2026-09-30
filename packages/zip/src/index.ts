import { deflateRawSync, inflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** Forward-slash path inside the archive, never absolute, never with "..". */
  name: string;
  data: Buffer;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const MAX_ENTRIES = 5000;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

const isJunk = (name: string): boolean =>
  name.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/.test(name) || /(^|\/)Thumbs\.db$/i.test(name);

const safeName = (raw: string): string | null => {
  const name = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!name || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
    return null;
  }
  if (name.split("/").some((part) => part === "..")) {
    return null;
  }
  return name;
};

/**
 * Reads the files of a zip archive held in memory. Stored and deflated entries
 * only, which is what build tools and ad networks produce. Entries that would
 * escape the archive root are dropped.
 */
export const readZip = (buffer: Buffer): ZipEntry[] => {
  let end = -1;
  const floor = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= floor; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new Error("Not a zip archive.");
  }
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  if (count > MAX_ENTRIES) {
    throw new Error(`The archive has ${count} entries; the limit is ${MAX_ENTRIES}.`);
  }

  const entries: ZipEntry[] = [];
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL) {
      throw new Error("The zip archive is damaged.");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    const name = safeName(rawName);
    if (!name || name.endsWith("/") || isJunk(name)) {
      continue;
    }
    if (flags & 1) {
      throw new Error(`"${name}" is encrypted.`);
    }
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL) {
      throw new Error("The zip archive is damaged.");
    }
    const start =
      localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(start, start + compressedSize);
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
    } else if (method === 8) {
      data = inflateRawSync(raw, { maxOutputLength: MAX_TOTAL_BYTES });
    } else {
      throw new Error(`"${name}" uses compression method ${method}, which is not supported.`);
    }
    total += data.length;
    if (total > MAX_TOTAL_BYTES || (size && data.length !== size)) {
      throw new Error(total > MAX_TOTAL_BYTES ? "The archive unpacks to more than 1 GB." : "The zip archive is damaged.");
    }
    entries.push({ name, data });
  }
  return entries;
};

export const isZip = (buffer: Buffer): boolean =>
  buffer.length > 4 && buffer.readUInt32LE(0) === LOCAL;

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

const crc32 = (data: Buffer): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** Media that is already compressed: deflating it again only costs time. */
const PACKED = /\.(png|jpe?g|gif|webp|webm|mp4|mp3|ogg|m4a|woff2?|zip)$/i;

/** Packs files into a zip archive in memory. */
export const writeZip = (files: ZipEntry[]): Buffer => {
  const parts: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  for (let i = 0; i < files.length; i += 1) {
    const name = Buffer.from(files[i].name, "utf8");
    const data = files[i].data;
    const deflate = data.length > 0 && !PACKED.test(files[i].name);
    const body = deflate ? deflateRawSync(data) : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  let centralSize = 0;
  for (let i = 0; i < centrals.length; i += 1) {
    centralSize += centrals[i].length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...centrals, end]);
};
