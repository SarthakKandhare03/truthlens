// Renders the app icons (public/icons/*.png) from one SVG, so the icon is
// reproducible and lives in code instead of a design file.
//
//   npm run icons
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

/**
 * The TruthLens mark (see components/ui/brand.tsx): a lens in a viewfinder,
 * in cream ink on the night-shift board, with a caution-yellow pupil.
 */
function iconSvg(size: number, padding: number): string {
  const u = (size - padding * 2) / 32; // the mark is drawn on a 32-unit grid
  const o = padding;
  const at = (v: number) => o + v * u;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#13110e"/>
  <g fill="none" stroke="#ece3cf">
    <circle cx="${at(16)}" cy="${at(16)}" r="${11 * u}" stroke-width="${1.6 * u}"/>
    <circle cx="${at(16)}" cy="${at(16)}" r="${6.5 * u}" stroke-width="${1.2 * u}" stroke-dasharray="${2.2 * u} ${1.6 * u}"/>
    <path d="M${at(16)} ${at(1)}v${5 * u}M${at(16)} ${at(26)}v${5 * u}M${at(1)} ${at(16)}h${5 * u}M${at(26)} ${at(16)}h${5 * u}" stroke-width="${1.6 * u}"/>
  </g>
  <circle cx="${at(16)}" cy="${at(16)}" r="${3.2 * u}" fill="#ffd60a"/>
</svg>`;
}

await mkdir("public/icons", { recursive: true });
const icons: [string, number, number][] = [
  ["icon-192.png", 192, 8],
  ["icon-512.png", 512, 20],
  ["icon-maskable-512.png", 512, 90], // extra safe zone: Android crops maskable icons to a circle
  ["apple-touch-icon.png", 180, 10],
];
for (const [name, size, padding] of icons) {
  await sharp(Buffer.from(iconSvg(size, padding))).png().toFile(`public/icons/${name}`);
  console.log(`  public/icons/${name}`);
}
