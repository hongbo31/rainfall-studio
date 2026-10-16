import sharp from "sharp";
import fs from "node:fs";
const svg =
  '<svg width="256" height="256"><rect width="256" height="256" rx="52" fill="#20192b"/><circle cx="128" cy="128" r="76" fill="#c5a4eb"/><path d="M52 128a76 76 0 0 1 152 0" fill="#20192b"/><circle cx="128" cy="128" r="76" fill="none" stroke="#c5a4eb" stroke-width="5"/></svg>';
const png = await sharp(Buffer.from(svg)).png().toBuffer();
fs.writeFileSync("assets/rainfall.png", png);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
fs.writeFileSync("assets/rainfall.ico", Buffer.concat([ico, png]));
