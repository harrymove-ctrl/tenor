// Records Tenor's product demo from the live site and renders it with an
// animated intro, voiceover, sound effects and camera moves.
//
//   CHROMIUM_PATH=<chrome binary> node video/record-demo.mjs [url]
//   node video/record-demo.mjs --render-only     re-render the last capture
//
// 1. Playwright captures the scripted walkthrough at 2x (2560x1600) with the
//    overlay from video/overlay.js (cursor, captions, intro, outro).
// 2. While it runs, the script logs a clock of cues: voice lines
//    (video/vo/<id>.mp3; missing clips are skipped), sound effects
//    (video/sfx/<id>.wav, from video/make-sfx.sh) and camera moves.
// 3. One ffmpeg pass trims to the intro, applies eased zooms with a soft
//    vignette, mixes voice and effects at their cue times (voice -16 LUFS),
//    and writes video/out/tenor-demo.mp4 at 1920x1200, 30 fps.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const require = createRequire(path.resolve(import.meta.dirname, "../web/package.json"));

const RENDER_ONLY = process.argv.includes("--render-only");
const URL = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "https://harrymove-ctrl.github.io/tenor/";
const HERE = import.meta.dirname;
const OUT = path.join(HERE, "out");
const VO = path.join(HERE, "vo");
const SFX = path.join(HERE, "sfx");
// Capture at 2560x1600: a 2560x1600 viewport with CSS zoom 2 lays out exactly
// like 1280x800 but renders every pixel at 2x (Playwright video ignores
// deviceScaleFactor). Element boxes therefore arrive in frame pixels.
const FRAME_W = 2560;
const FRAME_H = 1600;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const probe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());

async function main() {
  const { chromium } = require("@playwright/test");
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--force-color-profile=srgb", "--hide-scrollbars"],
  });
  const context = await browser.newContext({
    viewport: { width: FRAME_W, height: FRAME_H },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    recordVideo: { dir: OUT, size: { width: FRAME_W, height: FRAME_H } },
  });
  await context.addInitScript(() => {
    const zoom = () => (document.documentElement.style.zoom = "2");
    if (document.documentElement) zoom();
    document.addEventListener("DOMContentLoaded", zoom);
  });
  await context.addInitScript({ path: path.join(HERE, "overlay.js") });
  await context.addInitScript(() => {
    try {
      localStorage.removeItem("tenor.receipts.v1");
      localStorage.setItem("tenor.receiptTheme", "paper");
    } catch {}
  });
  const page = await context.newPage();
  const recStart = Date.now(); // the screencast starts with the page
  const now = () => (Date.now() - recStart) / 1000;
  const mouse = page.mouse;

  // Cue clock ------------------------------------------------------------
  const voice = []; // { id, t }
  const effects = []; // { id, t, gain }
  const cams = []; // { t0, t1, cx, cy, s }  (CSS px, seconds)
  const captions = []; // { html, t }  drawn after the camera pass so zooms never crop them
  let lineEnds = 0;
  const sfx = (id, offsetMs = 0, gain = 1) => effects.push({ id, t: now() + offsetMs / 1000, gain });
  async function finishLine() {
    const left = lineEnds - Date.now();
    if (left > 0) await wait(left);
  }
  /** Waits for the previous line, shows the caption, starts this line. */
  async function beat(id, html) {
    await finishLine();
    if (html !== undefined) captions.push({ html, t: now() });
    const f = path.join(VO, `${id}.mp3`);
    const len = existsSync(f) ? probe(f) : 0;
    voice.push({ id, t: now(), len });
    lineEnds = Date.now() + (len ? len * 1000 + 350 : 2600);
  }
  /** Eased zoom toward a locator, held for holdMs, logged for the ffmpeg pass. */
  async function camera(locator, s, holdMs) {
    const b = await locator.boundingBox();
    const t0 = now();
    cams.push({ t0, t1: t0 + 0.8 + holdMs / 1000, cx: b.x + b.width / 2, cy: b.y + b.height / 2, s });
    sfx("whoosh", 0, 0.35);
    sfx("whoosh", 800 + holdMs, 0.25);
  }

  // Pointer helpers --------------------------------------------------------
  async function moveTo(locator, { dx = 0.5, dy = 0.5, steps = 28 } = {}) {
    await locator.scrollIntoViewIfNeeded();
    const b = await locator.boundingBox();
    await mouse.move(b.x + b.width * dx, b.y + b.height * dy, { steps });
  }
  async function click(locator, opts) {
    await moveTo(locator, opts);
    await wait(160);
    sfx("click", 0, 0.5);
    await mouse.down();
    await wait(90);
    await mouse.up();
  }
  async function typeSlow(locator, text) {
    await click(locator);
    for (const ch of text) {
      await page.keyboard.type(ch);
      sfx("click", 0, 0.18);
      await wait(115);
    }
  }
  async function smoothScrollTo(locator, block = "center") {
    await locator.evaluate((el, b) => el.scrollIntoView({ behavior: "smooth", block: b }), block);
    await wait(900);
  }
  const dialog = () => page.getByRole("dialog");
  async function receiptOpened() {
    await dialog().waitFor();
    sfx("stamp", 330, 0.9); // the stamp springs onto the ticket about 0.3 s after the dialog mounts
  }
  async function closeDialog() {
    await click(dialog().getByRole("button", { name: /close/i }).first());
    await wait(650);
  }

  // Scenes -----------------------------------------------------------------
  await page.goto(URL, { waitUntil: "networkidle" });
  const marks = []; // wall-clock times of sync flashes
  let marking = true;
  const markLoop = (async () => {
    while (marking) {
      const t = now();
      if (await page.evaluate(() => window.__demo.mark()).then(() => true, () => false)) marks.push(t);
      await wait(1500);
    }
  })();
  await mouse.move(FRAME_W / 2, FRAME_H / 2 + 40);
  await wait(400);

  // 0. Intro: glow, mark, letters, stamp thunk, perforation, tear.
  const introAt = now();
  await page.evaluate(() => window.__demo.playIntro());
  sfx("riser", 0, 0.55);
  sfx("stamp", 2750, 1);
  await wait(900);
  await beat("s0");
  await wait(3300); // the perforation finishes drawing at 4.75 s
  await finishLine();
  sfx("tear", 0, 0.8);
  await page.evaluate(() => window.__demo.tearIntro());
  await wait(1100);

  // 1. Problem
  await beat("s1", `sMUSD paid <b>almost nothing</b> over the last 7 days and <b>about 2%</b> over 30. Savers can't plan on that.`);
  await camera(page.getByRole("region", { name: "Rates" }), 1.45, 5200);
  await moveTo(page.getByRole("button", { name: "sMUSD paid, 7 days" }));
  await wait(2600);
  await moveTo(page.getByRole("button", { name: "sMUSD paid, 30 days" }));
  await wait(2600);

  // 2. Idea
  await beat("s2", `Tenor splits sMUSD into <b>PT</b>, worth exactly 1 MUSD at maturity, and <b>YT</b>, all the yield until then.`);
  await moveTo(page.getByRole("button", { name: "Fixed rate today" }));
  await wait(1500);

  // 3. Lock a fixed rate
  await beat("s3a", `Lock a fixed rate: the quote shows the payout, the rate and the price impact before any wallet.`);
  await typeSlow(page.getByRole("textbox", { name: "Amount in MUSD" }), "2500");
  await wait(600);
  await camera(page.getByText(/You receive on/).first(), 1.4, 2600);
  await wait(3200);
  await beat("s3b", `One click: approve, swap on Tigris, confirmed.`);
  await click(page.getByRole("button", { name: "Lock fixed rate" }));
  await receiptOpened();
  await beat("s3c", `Every action leaves a receipt, with an ink stamp of the rate you locked.`);
  await wait(500);
  await camera(dialog().getByRole("article").locator("footer svg").first(), 1.75, 2400);
  await wait(3400);
  await beat("s3d", `Paper or Night, download it as a PNG, or copy a link that reopens the receipt anywhere.`);
  await click(dialog().getByRole("radio", { name: "Night" }));
  await wait(1800);
  await moveTo(dialog().getByRole("button", { name: /copy link/i }));
  await wait(1000);
  await finishLine();
  await closeDialog();

  // 4. Rate bet
  await beat("s4a", `Think Mezo's revenue will rise? Buy <b>YT</b> instead: leverage on the sMUSD rate.`);
  await click(page.getByRole("radio", { name: "Rate bet" }));
  await wait(400);
  await typeSlow(page.getByRole("textbox", { name: "Amount in MUSD" }), "100");
  await wait(900);
  await beat("s4b", `100 MUSD buys yield on about 16,000 MUSD. Break-even and payoffs are shown up front.`);
  await moveTo(page.getByText("Break-even sMUSD rate").first());
  await camera(page.getByText(/sMUSD at 3%/).first(), 1.5, 3000);
  await wait(3800);
  await finishLine();
  await click(page.getByRole("button", { name: "Buy YT" }));
  await receiptOpened();
  await wait(2400);
  await closeDialog();

  // 5. Time passes, claim
  await beat("s5a", `Say sMUSD pays <b>8%</b> for a week…`);
  await click(page.getByRole("radio", { name: "8%" }));
  await wait(600);
  await click(page.getByRole("button", { name: "+1 week" }));
  await wait(900);
  await beat("s5b", `…the YT has earned real MUSD, ready to claim.`);
  const yieldBox = page.getByText("Yield to claim", { exact: true }).first();
  await moveTo(yieldBox);
  await camera(yieldBox, 1.6, 2000);
  await wait(3700); // let the zoom ease out before the receipt opens
  await click(page.getByRole("region", { name: "Your position" }).getByRole("button", { name: "Claim" }));
  await receiptOpened();
  await wait(2400);
  await closeDialog();

  // 6. Stamp book
  const stamps = page.getByRole("region", { name: "Your stamps" });
  await smoothScrollTo(stamps);
  await beat("s6", `Your stamps: one for every lock, bet, claim and redemption.`);
  await camera(stamps, 1.7, 2800);
  for (const b of await stamps.getByRole("button").all()) {
    await moveTo(b, { steps: 18 });
    await wait(650);
  }
  await wait(1400);

  // 7. Live on testnet
  const live = page.getByRole("region", { name: "Live testnet" });
  await smoothScrollTo(live);
  await beat("s7a", `Live on <b>Mezo testnet</b>: two markets, real Tigris pools, rates read from chain.`);
  await moveTo(live.getByText(/Matures 31DEC26/).first());
  await camera(live, 1.45, 3200);
  await wait(4000);
  await beat("s7b", `On-chain proof passed 6 of 6: buy PT, buy YT, sMUSD yield, claim, combine, and 1 sMUSD backing every PT.`);
  await wait(3000);

  // 8. Maturity and redemption
  await smoothScrollTo(page.getByRole("region", { name: "Your position" }), "start");
  await beat("s8a", `At maturity, PT redeems one to one.`);
  await click(page.getByRole("button", { name: "Jump to maturity" }));
  await wait(900);
  const hold = page.getByRole("button", { name: /Hold to redeem/ });
  await beat("s8b", `Hold to confirm, so a stray click never redeems.`);
  await moveTo(hold);
  await camera(hold, 1.55, 2300);
  await wait(500);
  // Hold with Enter: under the capture's CSS zoom the component's pointer
  // tolerance check releases a mouse hold, while keyboard hold is identical on screen.
  await hold.focus();
  sfx("click", 0, 0.5);
  await page.keyboard.down("Enter");
  await wait(3000);
  await page.keyboard.up("Enter");
  await dialog().waitFor({ timeout: 5000 }).catch(() => {});
  if (await dialog().count()) sfx("stamp", 330, 0.9);
  await wait(2600);
  await finishLine();
  if (await dialog().count()) await closeDialog();

  // 9. Outro
  captions.push({ html: "", t: now() });
  await page.evaluate(() => window.__demo.playOutro());
  sfx("whoosh", 0, 0.4);
  sfx("stamp", 1750, 1);
  await wait(900);
  await beat("s9");
  await wait(2200);
  await finishLine();
  await wait(1200);
  const endAt = now();
  await wait(2500); // let the capture flush past the last cue
  marking = false;
  await markLoop;

  // Caption plates: each caption as a transparent 2x PNG, styled like the app.
  const plates = await context.newPage();
  await plates.setContent(`<html><body style="margin:0;background:transparent"><div id="c" style="display:inline-block;max-width:900px;
    background:rgb(12 10 9/.88);color:#fafaf9;border:1px solid rgb(255 255 255/.14);border-radius:14px;padding:12px 20px;
    font:500 19px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;text-align:center"></div>
    <style>#c b{color:#fbbf24;font-weight:600}</style></body></html>`);
  // The overlay init script runs on this page too; remove its stages so they don't cover the plate.
  await plates.evaluate(() => {
    document.querySelectorAll("#demo-intro,#demo-outro,#demo-cursor,#demo-caption,#demo-sync").forEach((e) => e.remove());
    document.documentElement.style.zoom = "2"; // plates at 2x, like the capture
  });
  const capList = [];
  for (let i = 0; i < captions.length; i++) {
    const c = captions[i];
    if (!c.html) continue;
    const end = captions.slice(i + 1).find(() => true)?.t ?? now();
    const file = path.join(OUT, `caption-${String(i).padStart(2, "0")}.png`);
    await plates.evaluate((h) => (document.getElementById("c").innerHTML = h), c.html);
    await plates.locator("#c").screenshot({ path: file, omitBackground: true });
    capList.push({ file, t0: c.t, t1: end });
  }
  await plates.close();

  const video = page.video();
  await context.close();
  await browser.close();
  const webm = path.join(OUT, "capture.webm");
  renameSync(await video.path(), webm);
  for (const f of readdirSync(OUT)) if (f.endsWith(".webm") && f !== "capture.webm") rmSync(path.join(OUT, f));

  const cues = { start: Math.max(0, introAt - 0.05), end: endAt, voice, effects, cams, captions: capList, marks };
  writeFileSync(path.join(OUT, "cues.json"), JSON.stringify(cues, null, 2));
  render(webm, cues);
}

/** One ffmpeg pass: trim, camera zooms, vignette, fades, voice and effects mix. */
/** Rising edges of the corner sync marker in the capture, in seconds. */
function syncEdges(webm) {
  const fps = 25; // Playwright writes constant 25 fps
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", webm, "-vf", "crop=4:4:0:0,scale=1:1,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
  const edges = [];
  for (let i = 1; i < raw.length; i++) if (raw[i] > 128 && raw[i - 1] <= 128) edges.push(i / fps);
  return edges;
}

/** Piecewise-linear map from wall-clock cue time to capture time, from matched sync flashes. */
function timeMap(marks, edges) {
  const pairs = [];
  let j = 0;
  let drift = edges.length && marks.length ? edges[0] - marks[0] : 0;
  for (const w of marks) {
    while (j < edges.length && edges[j] < w + drift - 0.6) j++;
    if (j < edges.length && Math.abs(edges[j] - (w + drift)) < 1.2) {
      pairs.push([w, edges[j]]);
      drift = edges[j] - w;
      j++;
    }
  }
  if (pairs.length < 2) return (t) => t;
  return (t) => {
    let k = pairs.findIndex(([w]) => w > t);
    if (k === -1) k = pairs.length - 1;
    if (k === 0) k = 1;
    const [w0, v0] = pairs[k - 1];
    const [w1, v1] = pairs[k];
    return v0 + ((t - w0) * (v1 - v0)) / (w1 - w0);
  };
}

function render(webm, cuesIn) {
  const edges = syncEdges(webm);
  const map = timeMap(cuesIn.marks ?? [], edges);
  const drift = (map(cuesIn.end) - cuesIn.end).toFixed(2);
  console.log(`SYNC marks=${(cuesIn.marks ?? []).length} edges=${edges.length} drift_at_end=${drift}s`);
  const start = map(cuesIn.start);
  const end = map(cuesIn.end);
  const voice = cuesIn.voice.map((c) => ({ ...c, t: map(c.t) }));
  const effects = cuesIn.effects.map((e) => ({ ...e, t: map(e.t) }));
  const cams = cuesIn.cams.map((c) => ({ ...c, t0: map(c.t0), t1: map(c.t1) }));
  const captions = (cuesIn.captions ?? []).map((c) => ({ ...c, t0: map(c.t0), t1: map(c.t1) }));
  const length = end - start;
  const W = FRAME_W;
  const H = FRAME_H;

  // Voice clips that landed after the capture are added at their scene's cue
  // time on re-render, as long as the line was paced in (see beat()).
  const known = voice.filter((c) => existsSync(path.join(VO, `${c.id}.mp3`)));

  // Camera: z(t) = 1 + sum_k (s_k - 1) * (ease_in_k(t) - ease_out_k(t)); focus follows the active move.
  const ease = (x) => `(clip(${x},0,1)*clip(${x},0,1)*(3-2*clip(${x},0,1)))`;
  // zoompan names input time `it`; vignette names it `t`.
  const curve = (c, v) => `(${ease(`(${v}-${(c.t0 - start).toFixed(3)})/0.8`)}-${ease(`(${v}-${(c.t1 - start).toFixed(3)})/0.7`)})`;
  const terms = cams.map((c) => ({ k: curve(c, "it"), kt: curve(c, "t"), c }));
  const z = terms.length ? `1+${terms.map((t) => `${(t.c.s - 1).toFixed(3)}*${t.k}`).join("+")}` : "1";
  const focus = (axis) =>
    terms.length
      ? terms.map((t) => `${(axis === "x" ? t.c.cx : t.c.cy).toFixed(1)}*between(it,${(t.c.t0 - start - 0.01).toFixed(3)},${(t.c.t1 - start + 0.75).toFixed(3)})`).join("+")
      : "0";
  const zx = `clip((${focus("x")})-iw/zoom/2,0,iw-iw/zoom)`;
  const zy = `clip((${focus("y")})-ih/zoom/2,0,ih-ih/zoom)`;
  const vig = terms.length ? `PI/9+PI/7*(${terms.map((t) => t.kt).join("+")})` : "PI/9";
  const video = [
    `[0:v]drawbox=x=0:y=0:w=10:h=10:color=0x11110f:t=fill,fps=30,zoompan=z='${z}':x='${zx}':y='${zy}':d=1:s=${W}x${H}:fps=30`,
    `vignette=angle='${vig}':eval=frame`,
    `scale=1920:1200:flags=lanczos[base]`,
  ].join(",");

  const inputs = [];
  const parts = [];
  const voiceLabels = [];
  const fxLabels = [];
  let n = 1;
  for (const c of known) {
    inputs.push("-i", path.join(VO, `${c.id}.mp3`));
    const ms = Math.max(0, Math.round((c.t - start) * 1000));
    parts.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}:all=1[v${n}]`);
    voiceLabels.push(`[v${n}]`);
    n++;
  }
  for (const e of effects) {
    const f = path.join(SFX, `${e.id}.wav`);
    if (!existsSync(f)) continue;
    inputs.push("-i", f);
    const ms = Math.max(0, Math.round((e.t - start) * 1000));
    parts.push(`[${n}:a]aformat=channel_layouts=stereo,volume=${e.gain.toFixed(2)},adelay=${ms}:all=1[f${n}]`);
    fxLabels.push(`[f${n}]`);
    n++;
  }
  const audio = [];
  if (voiceLabels.length) audio.push(`${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0,loudnorm=I=-16:TP=-2:LRA=11[vo]`);
  if (fxLabels.length) audio.push(`${fxLabels.join("")}amix=inputs=${fxLabels.length}:normalize=0,volume=0.6[fx]`);
  const mixCount = (voiceLabels.length ? 1 : 0) + (fxLabels.length ? 1 : 0);
  if (mixCount) audio.push(`${voiceLabels.length ? "[vo]" : ""}${fxLabels.length ? "[fx]" : ""}amix=inputs=${mixCount}:normalize=0,alimiter=limit=0.95,apad[a]`);

  // Captions: looped PNG plates, scaled from 2x capture to 1920 wide, faded, centered 42 px above the bottom.
  const capParts = [];
  let last = "[base]";
  captions.forEach((c, i) => {
    inputs.push("-loop", "1", "-t", length.toFixed(3), "-i", c.file);
    const a = Math.max(0, c.t0 - start + 0.15);
    const b = Math.max(a + 0.5, c.t1 - start);
    capParts.push(`[${n}:v]format=rgba,scale=iw*0.75:-1,fade=t=in:st=${a.toFixed(2)}:d=0.25:alpha=1,fade=t=out:st=${(b - 0.25).toFixed(2)}:d=0.25:alpha=1[c${i}]`);
    capParts.push(`${last}[c${i}]overlay=x=(W-w)/2:y=H-h-42:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'[o${i}]`);
    last = `[o${i}]`;
    n++;
  });
  capParts.push(`${last}fade=t=in:st=0:d=0.4,fade=t=out:st=${(length - 0.9).toFixed(2)}:d=0.9[v]`);

  const graph = [video, ...parts, ...audio, ...capParts].join(";");
  writeFileSync(path.join(OUT, "filter.txt"), graph);
  const mp4 = path.join(OUT, "tenor-demo.mp4");
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-ss", start.toFixed(3), "-t", length.toFixed(3), "-i", webm,
    ...inputs,
    "-filter_complex_script", path.join(OUT, "filter.txt"),
    "-map", "[v]", ...(mixCount ? ["-map", "[a]"] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow",
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", mp4,
  ], { maxBuffer: 1 << 26 });
  console.log(`DEMO_DONE ${mp4} duration=${probe(mp4).toFixed(1)}s voice=${known.length} sfx=${effects.length} camera=${cams.length}`);
}

if (RENDER_ONLY) {
  const cues = JSON.parse(readFileSync(path.join(OUT, "cues.json"), "utf8"));
  render(path.join(OUT, "capture.webm"), cues);
} else {
  main().catch((e) => {
    console.error("DEMO_FAILED", e.stack ?? e.message);
    process.exit(1);
  });
}
