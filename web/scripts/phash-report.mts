// Measures how the perceptual hash behaves, which is the evidence behind
// PHASH_MATCH_THRESHOLD.
//
//   npm run phash:report                      generated test scenes
//   npm run phash:report -- a.jpg b.jpg ...   your own photos (2+ recommended)
//
// For each original it prints the Hamming distance to every variant (re-encodes,
// resizes, filters, edits), then the distances between UNRELATED images. A good
// threshold sits above the benign variants and well below unrelated pairs.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { computePHash, hammingDistance, PHASH_MATCH_THRESHOLD } from "../src/lib/crypto/phash";
import { decodeImage } from "../src/lib/image/decode-node";
import { makeScene, makeVariants } from "../test/fixtures/scenes";

const files = process.argv.slice(2);
const originals: { name: string; bytes: Buffer }[] = files.length
  ? await Promise.all(files.map(async (f) => ({ name: path.basename(f), bytes: await readFile(f) })))
  : await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(async (s) => ({ name: `scene-${s}`, bytes: await makeScene(s) })));

const phashOf = async (bytes: Buffer) => computePHash(await decodeImage(bytes));
const pad = (s: string, n: number) => s.padEnd(n);

const distancesByVariant = new Map<string, number[]>();

// Detailed table for the first two originals, summary for all.
for (const [i, original] of originals.entries()) {
  const donor = originals[(i + 1) % originals.length].bytes;
  const base = await phashOf(original.bytes);
  const variants = await makeVariants(original.bytes, donor);
  if (i < 2) console.log(`\n${original.name}  pHash ${base}`);

  for (const v of variants) {
    const d = hammingDistance(base, await phashOf(v.bytes));
    distancesByVariant.set(v.name, [...(distancesByVariant.get(v.name) ?? []), d]);
    if (i < 2) {
      const verdict = d <= PHASH_MATCH_THRESHOLD ? "match" : "no match";
      console.log(`  ${pad(v.name, 46)} ${String(d).padStart(2)}  ${verdict}`);
    }
  }
}

const hashes = await Promise.all(originals.map((o) => phashOf(o.bytes)));
const unrelated: number[] = [];
for (let a = 0; a < hashes.length; a++)
  for (let b = a + 1; b < hashes.length; b++) unrelated.push(hammingDistance(hashes[a], hashes[b]));

const stats = (xs: number[]) =>
  xs.length ? `min ${Math.min(...xs)}, max ${Math.max(...xs)}, mean ${(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1)}` : "n/a";

const matchRate = (xs: number[]) =>
  `${Math.round((100 * xs.filter((d) => d <= PHASH_MATCH_THRESHOLD).length) / xs.length)}% matched`;

console.log(`\nSummary over ${originals.length} originals (Hamming distance out of 64 bits)`);
for (const [name, ds] of distancesByVariant)
  console.log(`  ${pad(name, 46)} ${pad(stats(ds), 30)} ${matchRate(ds)}`);
console.log(`  ${pad("UNRELATED image pairs", 46)} ${pad(stats(unrelated), 30)} ${matchRate(unrelated)}`);
console.log(`\n  current PHASH_MATCH_THRESHOLD = ${PHASH_MATCH_THRESHOLD}\n`);
