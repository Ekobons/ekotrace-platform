/** Minimal ZIP writer (deflate, no dependency): enough for data exports. */
import { crc32, deflateRawSync } from 'node:zlib';

export class Zip {
  private parts: Buffer[] = [];
  private central: Buffer[] = [];
  private offset = 0;
  add(name: string, data: Buffer | string) {
    const raw = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const comp = deflateRawSync(raw, { level: 6 });
    const useStore = comp.length >= raw.length;
    const body = useStore ? raw : comp;
    const fname = Buffer.from(name, 'utf8');
    const crc = crc32(raw) >>> 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(useStore ? 0 : 8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(fname.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(useStore ? 0 : 8, 10);
    cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(fname.length, 28); cen.writeUInt32LE(this.offset, 42);
    this.parts.push(local, fname, body);
    this.central.push(cen, fname);
    this.offset += local.length + fname.length + body.length;
  }
  finish(): Buffer {
    const cd = Buffer.concat(this.central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(this.central.length / 2, 8); end.writeUInt16LE(this.central.length / 2, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(this.offset, 16);
    return Buffer.concat([...this.parts, cd, end]);
  }
}
