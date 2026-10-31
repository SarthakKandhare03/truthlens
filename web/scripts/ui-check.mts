// Automated UI walkthrough with a headless browser and a FAKE camera.
// Drives the real app through the demo story and saves screenshots:
//
//   home (3D hero) → verify (empty) → capture viewfinder → shutter → sealed
//   → "Verify it" → AUTHENTIC → provenance timeline → edited copy → EDITED
//   → unrelated → UNVERIFIED → chain explorer (new block on top)
//
//   npm run ui:check                (needs chain + deploy + `npm run dev`)
//   npm run ui:check -- --mobile    (phone-sized viewport with touch)
//   npm run ui:check -- --reduced-motion   (OS "reduce motion" setting on)
//   npm run ui:check -- --dark             (night shift theme; default here is day shift)
//
// Chromium's --use-fake-device-for-media-stream supplies a synthetic camera
// feed, so the capture flow runs without real hardware. Screenshots go to
// test-results/ui/. Any browser console error fails the run.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { chromium, type Page } from "playwright";
import { makeScene } from "../test/fixtures/scenes";

const BASE = process.env.UI_BASE_URL ?? "http://localhost:3000";
const mobile = process.argv.includes("--mobile");
const reducedMotion = process.argv.includes("--reduced-motion");
const theme = process.argv.includes("--dark") ? "dark" : "light";
const outDir = path.resolve("test-results/ui", (mobile ? "mobile" : "desktop") + (theme === "dark" ? "-dark" : "") + (reducedMotion ? "-reduced-motion" : ""));
await mkdir(outDir, { recursive: true });

/**
 * A custom fake camera feed: a Motion-JPEG "video" of a photo-like scene that
 * is unique to this run, with fresh sensor grain on every frame. Chromium's
 * built-in test pattern loops identically, so it can produce a frame that was
 * already sealed in an earlier run (the server then correctly answers 409).
 */
async function makeFakeCameraFeed(file: string) {
  const base = await sharp(await makeScene(Math.floor(Math.random() * 1e9), 1280, 720)).raw().toBuffer({ resolveWithObject: true });
  const frames: Buffer[] = [];
  for (let i = 0; i < 12; i++) {
    const grain = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 10 } } }).png().toBuffer();
    frames.push(
      await sharp(base.data, { raw: base.info }).composite([{ input: grain, blend: "soft-light" }]).jpeg({ quality: 90 }).toBuffer(),
    );
  }
  await writeFile(file, Buffer.concat(frames)); // MJPEG = JPEG frames back to back
}
/**
 * A fake camera filming a photo on a SCREEN, for live verify: the photo sits
 * at ~80% of the frame on a dark bezel, tilted, with glare and fresh sensor
 * grain on every frame.
 */
async function makeScreenFeed(photo: Buffer, file: string) {
  const W = 1280, H = 720;
  const shown = await sharp(photo).resize(Math.round(W * 0.62), Math.round(H * 0.62), { fit: "fill" }).rotate(1.5, { background: "#111" }).toBuffer();
  const glare = Buffer.from(
    `<svg width="${W}" height="${H}"><defs><radialGradient id="g" cx="0.3" cy="0.25" r="0.5"><stop offset="0" stop-color="white" stop-opacity="0.3"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
  const meta = await sharp(shown).metadata();
  const screen = await sharp({ create: { width: W, height: H, channels: 3, background: "#111111" } })
    .composite([{ input: shown, left: Math.round((W - meta.width!) / 2) + 18, top: Math.round((H - meta.height!) / 2) - 10 }, { input: glare }])
    .blur(0.8)
    .png()
    .toBuffer();
  const frames: Buffer[] = [];
  for (let i = 0; i < 8; i++) {
    const grain = await sharp({ create: { width: W, height: H, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 12 } } }).png().toBuffer();
    frames.push(await sharp(screen).composite([{ input: grain, blend: "soft-light" }]).jpeg({ quality: 85 }).toBuffer());
  }
  await writeFile(file, Buffer.concat(frames));
}

/** Opens Verify → Live camera in a browser whose camera plays `feedFile`, and waits for `expect`. */
async function liveCheck(feedFile: string, expectText: string, shotName: string) {
  const b = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${feedFile}`],
  });
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["camera"] });
    await ctx.addInitScript((t) => localStorage.setItem("truthlens-theme", t), theme);
    const lp = await ctx.newPage();
    lp.on("pageerror", (e) => problems.push(`live page error: ${e.message}`));
    await lp.goto(BASE + "/verify", { waitUntil: "networkidle" });
    await lp.getByRole("tab", { name: /Live camera/ }).click();
    await lp.getByRole("heading", { name: expectText }).waitFor({ timeout: 20_000 });
    await lp.waitForTimeout(900);
    await shot(shotName, lp);
    console.log(`  ✓ live camera: "${expectText}"`);
  } finally {
    await b.close();
  }
}

const feed = path.join(outDir, "fake-camera.mjpeg");
await makeFakeCameraFeed(feed);

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${feed}`],
});
const context = await browser.newContext({
  ...(mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 } }),
  permissions: ["camera", "clipboard-read", "clipboard-write"],
  reducedMotion: reducedMotion ? "reduce" : "no-preference",
  acceptDownloads: true,
});
// Pin the theme (the site otherwise opens in night shift) so runs are repeatable.
await context.addInitScript((t) => localStorage.setItem("truthlens-theme", t), theme);
const page = await context.newPage();

const problems: string[] = [];
page.on("console", (m) => {
  if (m.type() !== "error") return;
  // A record whose original is missing from storage (e.g. the smoke-test
  // record) makes its thumbnail 404; the UI shows an "unavailable" tile by
  // design, so that one case is expected, not a failure.
  if (m.text().startsWith("Failed to load resource") && m.location().url.includes("/api/images/")) return;
  problems.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));

/** Upload a file on the Verify page. Scoped to <main>: the hidden-but-mounted
 *  Capture page (React <Activity>) has its own file input that must not be hit. */
async function uploadToVerify(file: string) {
  await page.getByText("Drop an image to verify").waitFor();
  await page.locator('main input[type="file"]').setInputFiles(file);
}

let n = 0;
async function shot(name: string, p: Page = page) {
  const file = path.join(outDir, `${String(++n).padStart(2, "0")}-${name}.png`);
  await p.screenshot({ path: file });
  console.log(`  📸 ${path.relative(process.cwd(), file)}`);
}
const step = (s: string) => console.log(`\n▸ ${s}`);

try {
  step("Home");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByText("Images secured").first().waitFor({ timeout: 15_000 });
  await page.locator("canvas").first().waitFor({ timeout: 15_000 }); // the 3D eyes (one per polaroid) mounted
  await page.mouse.move(1000, 300); // the eye follows the mouse
  await page.waitForTimeout(2500);
  await shot("home");

  step("Verify: empty state");
  await page.goto(BASE + "/verify", { waitUntil: "networkidle" });
  await page.getByText("Drop an image to verify").waitFor();
  await page.waitForTimeout(600);
  await shot("verify-idle");

  step("Capture: viewfinder with HUD");
  await page.goto(BASE + "/capture", { waitUntil: "networkidle" });
  await page.getByText("SECURE", { exact: true }).waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => (document.querySelector("video")?.videoWidth ?? 0) > 0, null, { timeout: 15_000 });
  await page.waitForTimeout(800);
  await shot("capture-viewfinder");

  step("Capture: shutter → sealing sequence");
  await page.getByRole("button", { name: "Take and seal photo" }).click();
  await page.waitForTimeout(1300);
  await shot("capture-sealing");
  await page.getByText("Provenance sealed").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await shot("capture-sealed");

  // Keep the exact sealed bytes, as a user would by pressing Download.
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download" }).click();
  const sealedPath = path.join(outDir, "sealed.jpg");
  await (await download).saveAs(sealedPath);
  console.log(`  ⬇ sealed photo saved (${(await readFile(sealedPath)).length} bytes)`);

  step("Verify the sealed photo → AUTHENTIC");
  await page.getByRole("button", { name: "Verify it" }).click();
  await page.waitForURL("**/verify");

  // Next.js 16 keeps the previous page mounted but hidden (React <Activity>) for
  // instant back-navigation. Its effects are cleaned up while hidden, so the
  // camera must be released: no "camera in use" light after leaving /capture.
  await page.waitForTimeout(300);
  const liveTracks = await page.evaluate(() =>
    Array.from(document.querySelectorAll("video")).flatMap((v) =>
      ((v.srcObject as MediaStream | null)?.getTracks() ?? []).filter((t) => t.readyState === "live"),
    ).length,
  );
  if (liveTracks > 0) problems.push(`camera still live after leaving /capture (${liveTracks} track(s))`);
  else console.log("  ✓ camera released after leaving the capture page");
  // With reduced motion the scan lasts only ~0.3 s, so the panel may already be
  // gone by the time we look. Screenshot it only if it was caught.
  if (await page.getByText("Analysing").waitFor({ timeout: reducedMotion ? 1500 : 10_000 }).then(() => true, () => false)) {
    await page.waitForTimeout(reducedMotion ? 0 : 900);
    await shot("verify-scanning");
  }
  await page.getByRole("heading", { name: "AUTHENTIC" }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2200);
  await shot("verify-authentic");

  step("Provenance timeline of the sealed photo");
  await page.getByRole("link", { name: "View provenance timeline" }).click();
  await page.waitForURL("**/provenance/**");
  await page.getByText("The life of this image").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1800); // track draws itself
  await shot("provenance-timeline");
  await page.goto(BASE + "/verify", { waitUntil: "networkidle" });

  step("Verify an edited copy → EDITED + heatmap");
  const sealed = await readFile(sealedPath);
  const { width = 1280, height = 720 } = await sharp(sealed).metadata();
  const sticker = await sharp({
    create: { width: Math.round(width * 0.28), height: Math.round(height * 0.3), channels: 3, background: "#ff2a6d" },
  }).png().toBuffer();
  const editedPath = path.join(outDir, "edited.jpg");
  // Random position on every run, so edits from earlier runs on the same chain
  // can't be mistaken for this one.
  const left = Math.round(width * (0.05 + Math.random() * 0.6));
  const top = Math.round(height * (0.05 + Math.random() * 0.6));
  await sharp(sealed).composite([{ input: sticker, left, top }]).jpeg({ quality: 88 }).toFile(editedPath);
  await uploadToVerify(editedPath);
  await page.getByRole("heading", { name: "EDITED" }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2200);
  await shot("verify-edited");
  await page.getByText("Compare with the original").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot("verify-edited-compare");

  step("Verify an unrelated image → UNVERIFIED");
  const strangerPath = path.join(outDir, "unrelated.jpg");
  await sharp(await makeScene(4242)).toFile(strangerPath);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Verify another" }).click();
  await uploadToVerify(strangerPath);
  await page.getByRole("heading", { name: "UNVERIFIED" }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shot("verify-unverified");

  step("Live camera: the sealed photo shown on a screen → its sealed original is found");
  const screenFeed = path.join(outDir, "live-screen.mjpeg");
  await makeScreenFeed(sealed, screenFeed);
  await liveCheck(screenFeed, "Sealed original found", "live-match");

  step("Live camera: an unrelated photo on a screen → no sealed original");
  const strangerFeed = path.join(outDir, "live-stranger.mjpeg");
  await makeScreenFeed(await readFile(strangerPath), strangerFeed);
  await liveCheck(strangerFeed, "No sealed original", "live-none");

  step("Chain explorer: the photo sealed above is the newest block");
  await page.goto(BASE + "/explorer", { waitUntil: "networkidle" });
  await page.getByText("Every seal, block by block").waitFor();
  const sealedSha = (await import("node:crypto")).createHash("sha256").update(await readFile(sealedPath)).digest("hex");
  const topCard = page.locator("ol > li").first();
  await topCard.waitFor();
  if (!(await topCard.innerText()).includes(sealedSha.slice(0, 6))) {
    problems.push("explorer: the newly sealed photo is not the top block");
  } else console.log("  ✓ newest block in the explorer is the photo sealed in this run");
  await page.waitForTimeout(800);
  await shot("explorer");
} catch (err) {
  problems.push(`walkthrough failed: ${(err as Error).message.split("\n")[0]}`);
  await shot("failure").catch(() => undefined);
} finally {
  await browser.close();
}

// exitCode (not process.exit) lets Node close sockets first; on Windows an
// abrupt exit can trip a libuv assertion.
if (problems.length) {
  console.log(`\n✗ ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log(
    `\n✓ UI walkthrough passed with no browser errors (${mobile ? "mobile" : "desktop"}, ${theme}${reducedMotion ? ", reduced motion" : ""}).\n`,
  );
}
