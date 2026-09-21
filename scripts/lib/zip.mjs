import { deflateRawSync, crc32 } from 'node:zlib';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Dependency-free ZIP writer.
 *
 * The web bundle that the Android shell installs is a plain zip, and the project
 * ships no packaging library — a stored/deflated archive is a few dozen lines of
 * Node built-ins, so it stays that way.
 */

const encoder = new Date();

/** `createZip('dist', 'build/frontier-web.zip')` */
export function createZip(sourceDir, targetFile) {
  const files = collect(sourceDir).map((path) => {
    const name = relative(sourceDir, path).split(sep).join('/');
    return { name, path };
  });

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const raw = readFileSync(file.path);
    const deflated = deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const payload = useDeflate ? deflated : raw;
    const nameBytes = Buffer.from(file.name, 'utf8');
    const crc = crc32(raw) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); // method
    local.writeUInt16LE(dosTime(), 10);
    local.writeUInt16LE(dosDate(), 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBytes, payload);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(useDeflate ? 8 : 0, 10);
    entry.writeUInt16LE(dosTime(), 12);
    entry.writeUInt16LE(dosDate(), 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(payload.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(0, 30); // extra
    entry.writeUInt16LE(0, 32); // comment
    entry.writeUInt16LE(0, 34); // disk
    entry.writeUInt16LE(0, 36); // internal attrs
    entry.writeUInt32LE(0o644 << 16, 38); // external attrs
    entry.writeUInt32LE(offset, 42);

    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + payload.length;
  }

  const centralSize = central.reduce((sum, buffer) => sum + buffer.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  writeFileSync(targetFile, Buffer.concat([...chunks, ...central, end]));
  return { files: files.length, bytes: statSync(targetFile).size };
}

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(path));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

function dosTime() {
  return (encoder.getHours() << 11) | (encoder.getMinutes() << 5) | (encoder.getSeconds() >> 1);
}

function dosDate() {
  return ((encoder.getFullYear() - 1980) << 9) | ((encoder.getMonth() + 1) << 5) | encoder.getDate();
}
