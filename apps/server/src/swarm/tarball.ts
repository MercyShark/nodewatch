// Minimal in-memory ustar + gzip writer, so bundle contents never touch the disk unencrypted.
import { gzipSync } from "node:zlib";

function header(name: string, size: number, mtime: number): Buffer {
  const h = Buffer.alloc(512, 0);
  const put = (s: string, off: number, len: number) => h.write(s.slice(0, len), off, len, "utf8");
  const oct = (n: number, len: number) => n.toString(8).padStart(len - 1, "0") + "\0";
  if (Buffer.byteLength(name) > 100) throw new Error(`tar entry name too long: ${name}`);
  put(name, 0, 100);
  put(oct(0o644, 8), 100, 8);
  put(oct(0, 8), 108, 8);
  put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12);
  put(oct(Math.floor(mtime / 1000), 12), 136, 12);
  put("        ", 148, 8);
  put("0", 156, 1);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}

export function tarGz(files: { name: string; data: Buffer | string }[], mtime = Date.now()): Buffer {
  const parts: Buffer[] = [];
  for (const f of files) {
    const data = typeof f.data === "string" ? Buffer.from(f.data, "utf8") : f.data;
    parts.push(header(f.name, data.length, mtime), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(parts));
}
