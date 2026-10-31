// Measures the tamper heatmap: how much of the image is reported as modified
// for each kind of change. This is the evidence behind PIXEL_THRESHOLD and
// NOT_A_DERIVATIVE_PERCENT in src/lib/image/diff.ts.
//
//   npm run diff:report
import { compareImages, GRID_SIZE, NOT_A_DERIVATIVE_PERCENT, PIXEL_THRESHOLD } from "../src/lib/image/diff";
import { makeScene, makeVariants } from "../test/fixtures/scenes";

const seeds = [1, 2, 3, 4, 5, 6];
const byVariant = new Map<string, number[]>();
const flags = new Map<string, string>();

for (const [i, seed] of seeds.entries()) {
  const original = await makeScene(seed);
  const variants = await makeVariants(original, await makeScene(seeds[(i + 1) % seeds.length]));
  for (const v of variants) {
    const diff = await compareImages(original, v.bytes);
    byVariant.set(v.name, [...(byVariant.get(v.name) ?? []), diff.changedPercent]);
    if (i === 0) flags.set(v.name, `${diff.alignment}${diff.globalAdjustment ? ", global adj." : ""}`);
  }
  const unrelated = await compareImages(original, await makeScene(100 + seed));
  byVariant.set("UNRELATED image", [...(byVariant.get("UNRELATED image") ?? []), unrelated.changedPercent]);
}

const fmt = (xs: number[]) =>
  `min ${Math.min(...xs).toFixed(1)}%  max ${Math.max(...xs).toFixed(1)}%  mean ${(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1)}%`;

console.log(`\n% of image reported as modified (${seeds.length} scenes, ${GRID_SIZE}×${GRID_SIZE} grid, pixel threshold ${PIXEL_THRESHOLD})\n`);
for (const [name, xs] of byVariant) {
  console.log(`  ${name.padEnd(46)} ${fmt(xs).padEnd(40)} ${flags.get(name) ?? ""}`);
}
console.log(`\n  > ${NOT_A_DERIVATIVE_PERCENT}% modified is treated as "not a derivative" → UNVERIFIED\n`);
