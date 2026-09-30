import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { isZip, readZip, writeZip } from "./index.ts";

/** Minimal writer, enough to build fixtures: stored or deflated entries. */
export const makeZip = (files: Array<{ name: string; data: string | Buffer; deflate?: boolean }>): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const body = file.deflate ? deflateRawSync(data) : data;
    const name = Buffer.from(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(file.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(file.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};

test("reads stored and deflated entries", () => {
  const zip = makeZip([
    { name: "applovin/game.html", data: "<html>a</html>" },
    { name: "google.zip", data: "x".repeat(5000), deflate: true },
  ]);
  assert.ok(isZip(zip));
  const entries = readZip(zip);
  assert.deepEqual(entries.map((entry) => entry.name), ["applovin/game.html", "google.zip"]);
  assert.equal(entries[0].data.toString(), "<html>a</html>");
  assert.equal(entries[1].data.length, 5000);
});

test("drops folders, system junk and paths that leave the archive", () => {
  const entries = readZip(
    makeZip([
      { name: "builds/", data: "" },
      { name: "__MACOSX/builds/._a.html", data: "junk" },
      { name: "builds/.DS_Store", data: "junk" },
      { name: "../outside.html", data: "evil" },
      { name: "/etc/passwd", data: "evil" },
      { name: "builds\\unity.html", data: "ok" },
    ])
  );
  assert.deepEqual(entries.map((entry) => entry.name), ["builds/unity.html"]);
});

test("rejects something that is not a zip", () => {
  assert.throws(() => readZip(Buffer.from("<html></html>".repeat(10))), /Not a zip/);
  assert.equal(isZip(Buffer.from("<html>")), false);
});

test("writeZip packs files that readZip reads back", () => {
  const files = [
    { name: "index.html", data: Buffer.from("<html>" + "a".repeat(2000) + "</html>") },
    { name: "shots/первый.png", data: Buffer.from([1, 2, 3, 4]) },
    { name: "empty.txt", data: Buffer.alloc(0) },
  ];
  const archive = writeZip(files);
  assert.equal(isZip(archive), true);
  assert.ok(archive.length < 2000);
  assert.deepEqual(readZip(archive), files);
});
