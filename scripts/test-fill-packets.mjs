#!/usr/bin/env node
// Calibration harness: fills every packet with sample data + a test
// signature, writes PDFs to tmp-packets/ for visual coordinate checks.
//
// Usage: node scripts/test-fill-packets.mjs

import fs from "fs";
import zlib from "zlib";
import { buildPacketPdf } from "../lib/agreements/fill-engine.mjs";
import { PACKETS } from "../lib/agreements/registry.mjs";

// Tiny generated signature squiggle PNG (same as e2e).
function makeSigPng() {
  const W = 240, H = 80;
  const px = Buffer.alloc(W * H * 4, 0); // transparent
  for (let x = 10; x < W - 10; x++) {
    const y = Math.round(H / 2 + Math.sin(x / 14) * 18 - x / 24);
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      const i = (yy * W + x) * 4;
      px[i] = 26; px[i + 1] = 35; px[i + 2] = 80; px[i + 3] = 255;
    }
  }
  const raw = Buffer.alloc(H * (W * 4 + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const idat = zlib.deflateSync(raw);
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let crc = 0xffffffff;
    for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const FIELDS = {
  businessName: "SAMPLE BAKERY LLC",
  contactName: "PAT DOE",
  title: "OWNER",
  email: "PAT@SAMPLE.COM",
  phone: "(410) 555-0123",
  address: "123 MAIN STREET",
  city: "BALTIMORE",
  zip: "21201",
  accountNumber: "5550012345678",
  hvacUnits: "4",
};

fs.mkdirSync("tmp-packets", { recursive: true });
const sig = makeSigPng();
for (const key of Object.keys(PACKETS)) {
  const pdf = await buildPacketPdf({
    packetKey: key,
    fields: FIELDS,
    primaryUse: "Restaurant",
    customerType: "LLC",
    signaturePng: sig,
  });
  const file = `tmp-packets/${key}.pdf`;
  fs.writeFileSync(file, pdf);
  console.log(`${file}: ${(pdf.length / 1024).toFixed(0)} KB`);
}
