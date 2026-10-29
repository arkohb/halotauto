// Generates PWA icons from an inline SVG via sharp
import sharpLib from "sharp";

const W = 512;
const H = 512;

function svg(rx) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#101C33"/>
      <stop offset="1" stop-color="#0B1426"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${rx}" fill="url(#bg)"/>
  <rect x="14" y="14" width="484" height="484" rx="${Math.max(0, rx - 12)}" fill="none" stroke="#D4AF37" stroke-width="6" opacity="0.45"/>
  <!-- equal level line -->
  <line x1="92" y1="268" x2="420" y2="268" stroke="#D4AF37" stroke-width="10" stroke-dasharray="30 20" opacity="0.95"/>
  <!-- bearish candle (resistance side) -->
  <line x1="176" y1="96" x2="176" y2="300" stroke="#F23645" stroke-width="14" stroke-linecap="round"/>
  <rect x="146" y="140" width="60" height="118" rx="10" fill="#F23645"/>
  <!-- bullish candle (support side) -->
  <line x1="336" y1="236" x2="336" y2="428" stroke="#089981" stroke-width="14" stroke-linecap="round"/>
  <rect x="306" y="278" width="60" height="118" rx="10" fill="#089981"/>
  <!-- halo diamond -->
  <path d="M256 30 L306 80 L256 130 L206 80 Z" fill="#D4AF37"/>
  <path d="M256 44 L292 80 L256 116 L220 80 Z" fill="none" stroke="#0B1426" stroke-width="5" opacity="0.5"/>
  <!-- C3 arrow -->
  <path d="M120 268 L60 268" stroke="#787B86" stroke-width="9" stroke-linecap="round"/>
  <path d="M78 250 L52 268 L78 286 Z" fill="#787B86"/>
</svg>`;
}

const outDir = "public/icons";

await sharpLib(Buffer.from(svg(96))).resize(512, 512).png().toFile(`${outDir}/icon-512.png`);
await sharpLib(Buffer.from(svg(96))).resize(192, 192).png().toFile(`${outDir}/icon-192.png`);
await sharpLib(Buffer.from(svg(0))).resize(512, 512).png().toFile(`${outDir}/maskable-512.png`);
await sharpLib(Buffer.from(svg(96))).resize(180, 180).png().toFile(`${outDir}/apple-touch-icon.png`);
console.log("icons generated");
