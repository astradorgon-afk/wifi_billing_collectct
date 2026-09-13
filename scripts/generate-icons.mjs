/**
 * Generates PWA PNG icons from a clean procedural design (no image deps).
 * Usage: npm run icons   (or: node scripts/generate-icons.mjs)
 *
 * Renders a professional blue-gradient tile with a WiFi signal arc above a
 * coin hub (the "$" coin is the WiFi focal point = network billing), then
 * encodes raw RGBA pixels to PNG via Node's built-in zlib — no external deps.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

/* ---------------------------------------------------------------- design */

const C_TOP = [59, 130, 246]; // blue-500
const C_BOTTOM = [30, 58, 138]; // blue-900
const C_SYMBOL = [255, 255, 255];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp255 = (v) => Math.round(v < 0 ? 0 : v > 255 ? 255 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Distance from a point (normalized coords) to segment ab. */
function dSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = clamp01(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/**
 * Render one frame at size×size on a unit canvas. maskable shrinks the whole
 * mark into the safe zone while keeping the gradient full-bleed.
 */
function render(size, { maskable = false } = {}) {
  const soft = 1.5 / size; // ~1.5px anti-aliased edge (normalized)
  const N = maskable ? 0.68 : 1.0;
  const map = (q) => 0.5 + (q - 0.5) * N;

  const band = (d, lo, hi) => {
    const a = smooth((d - lo) / soft);
    const b = smooth((hi - d) / soft);
    return clamp01(Math.min(a, b));
  };

  // Signal mark geometry (normalized, final space). $ is defined in a unit
  // box centered at (0.5, 0.585) and scaled by f about the coin center.
  const gx = 0.5; // coin center x (map(0.5) === 0.5)
  const gy = map(0.585); // coin center y
  const f = 0.42 * N; // glyph scale factor

  const arcs = [0.185, 0.255, 0.325].map((r) => ({ rn: r * N, sw: 0.013 * N }));
  const coinR = 0.122 * N;
  const coinSW = 0.027 * N;

  const gP = (x, y) => ({ x: gx + (x - 0.5) * f, y: gy + (y - 0.585) * f });
  const stem = { a: gP(0.5, 0.4), b: gP(0.5, 0.73), r: 0.028 * f };
  const topLoop = { c: gP(0.5, 0.48), rx: 0.075 * f, ry: 0.052 * f, sw: 0.013 * f, edgeY: gy + (0.47 - 0.585) * f, above: true };
  const botLoop = { c: gP(0.5, 0.655), rx: 0.09 * f, ry: 0.058 * f, sw: 0.013 * f, edgeY: gy + (0.615 - 0.585) * f, above: false };
  const topBar = { a: gP(0.4, 0.525), b: gP(0.545, 0.525), r: 0.017 * f };
  const botBar = { a: gP(0.4, 0.625), b: gP(0.545, 0.625), r: 0.017 * f };

  const inArc = (u, v) => {
    const ang = Math.atan2(v - gy, u - gy);
    return ang <= -Math.PI / 4 && ang >= (-3 * Math.PI) / 4;
  };

  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / (size - 1);
    const bg = lerp3(C_TOP, C_BOTTOM, v);
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      // subtle top-left sheen for depth
      const sheen = clamp01(1 - Math.hypot(u - 0.12, v - 0.08) * 2.6) * 0.09;
      const col = [
        clamp255(bg[0] + (255 * sheen * C_TOP[0]) / 255),
        clamp255(bg[1] + (255 * sheen * C_TOP[1]) / 255),
        clamp255(bg[2] + (255 * sheen * C_TOP[2]) / 255),
      ];

      let a = 0;

      // WiFi signal arcs (upward cone, rising behind the coin)
      const dist = Math.hypot(u - gx, v - gy);
      for (const arc of arcs) {
        const arcA = band(dist - arc.rn, -arc.sw, arc.sw) * (inArc(u, v) ? 1 : 0);
        a = Math.max(a, arcA);
      }

      // Coin hub — white outlined disc
      a = Math.max(a, band(dist - coinR, -coinSW, coinSW));

      // "$" glyph (stem, two loops, two bars)
      a = Math.max(a, smooth((stem.r + soft - dSeg(u, v, stem.a.x, stem.a.y, stem.b.x, stem.b.y)) / soft));
      a = Math.max(a, smooth((topBar.r + soft - dSeg(u, v, topBar.a.x, topBar.a.y, topBar.b.x, topBar.b.y)) / soft));
      a = Math.max(a, smooth((botBar.r + soft - dSeg(u, v, botBar.a.x, botBar.a.y, botBar.b.x, botBar.b.y)) / soft));

      for (const loop of [topLoop, botLoop]) {
        const dx = (u - loop.c.x) / loop.rx;
        const dy = (v - loop.c.y) / loop.ry;
        const t = Math.hypot(dx, dy);
        const d = (t - 1) * Math.min(loop.rx, loop.ry);
        const clip = loop.above
          ? smooth((loop.edgeY - v) / soft)
          : smooth((v - loop.edgeY) / soft);
        a = Math.max(a, band(d, -loop.sw, loop.sw) * clip);
      }

      const i = (y * size + x) * 4;
      px[i] = clamp255(lerp(col[0], C_SYMBOL[0], a));
      px[i + 1] = clamp255(lerp(col[1], C_SYMBOL[1], a));
      px[i + 2] = clamp255(lerp(col[2], C_SYMBOL[2], a));
      px[i + 3] = 255;
    }
  }
  return px;
}

/* ------------------------------------------------------------ png encode */

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // raw scanlines, filter byte 0 per row
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ main */

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "maskable-192.png", size: 192, maskable: true },
  { file: "maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: false },
];

for (const t of targets) {
  const png = encodePNG(render(t.size, { maskable: t.maskable }), t.size, t.size);
  writeFileSync(path.join(outDir, t.file), png);
  console.log(`✓ public/icons/${t.file} (${t.size}×${t.size}${t.maskable ? ", maskable" : ""})`);
}