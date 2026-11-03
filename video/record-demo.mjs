// Records a scripted product demo of Tenor (about 1:50) from the live site:
// a visible cursor, lower-third captions, and title and end cards, captured
// with Playwright's recordVideo at 1280x800, then encoded to MP4 with ffmpeg.
//
// Usage (from the repo root):
//   CHROMIUM_PATH=<chrome binary> node video/record-demo.mjs [url]
// Output: video/out/tenor-demo.webm and video/out/tenor-demo.mp4
import { createRequire } from "node:module";
import { mkdirSync, renameSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const require = createRequire(path.resolve(import.meta.dirname, "../web/package.json"));
const { chromium } = require("@playwright/test");

const URL = process.argv[2] ?? "https://harrymove-ctrl.github.io/tenor/";
const OUT = path.resolve(import.meta.dirname, "out");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Overlay: fake cursor with click ripple, caption bar, full-screen cards.
const OVERLAY = () => {
  const css = `
    #demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:none}
    #demo-cursor svg{filter:drop-shadow(0 2px 3px rgb(0 0 0/.45))}
    .demo-ripple{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid #f59e0b;z-index:2147483646;pointer-events:none;animation:demo-rip .55s ease-out forwards}
    @keyframes demo-rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
    #demo-caption{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(12px);max-width:880px;width:max-content;z-index:2147483645;pointer-events:none;
      background:rgb(12 10 9/.86);color:#fafaf9;border:1px solid rgb(255 255 255/.12);border-radius:14px;padding:12px 20px;
      font:500 19px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;letter-spacing:-.005em;opacity:0;transition:opacity .35s,transform .35s;backdrop-filter:blur(6px);text-align:center}
    #demo-caption.on{opacity:1;transform:translateX(-50%) translateY(0)}
    #demo-caption b{color:#fbbf24;font-weight:600}
    #demo-card{position:fixed;inset:0;z-index:2147483644;display:grid;place-items:center;background:#0c0a09;color:#fafaf9;opacity:0;pointer-events:none;transition:opacity .5s;
      font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;text-align:center}
    #demo-card.on{opacity:1}
    #demo-card .k{font:600 13px/1 ui-monospace,Menlo,monospace;letter-spacing:.18em;color:#fbbf24;text-transform:uppercase}
    #demo-card h1{font-size:72px;font-weight:700;letter-spacing:-.03em;margin:18px 0 8px}
    #demo-card p{font-size:24px;color:#d6d3d1;margin:0}
    #demo-card small{display:block;margin-top:28px;font-size:16px;color:#a8a29e;line-height:1.7}
    #demo-card .mark{display:inline-grid;place-items:center;width:64px;height:64px;border-radius:16px;background:#fafaf9;color:#d97706;font-size:32px;font-weight:800}`;
  const install = () => {
    if (document.getElementById("demo-cursor")) return;
    const s = document.createElement("style");
    s.textContent = css;
    document.head.append(s);
    const c = document.createElement("div");
    c.id = "demo-cursor";
    c.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    document.body.append(c);
    const cap = document.createElement("div");
    cap.id = "demo-caption";
    document.body.append(cap);
    const card = document.createElement("div");
    card.id = "demo-card";
    // Title card is up from the first paint, so the app never flashes before it.
    card.className = "on";
    card.innerHTML = `<div><div class="mark">T</div><h1>Tenor</h1><p>Fixed-rate MUSD on Mezo</p><small>Mezo Buildathon · Wave 2 · Track 1 DeFi</small></div>`;
    document.body.append(card);
    addEventListener("mousemove", (e) => (c.style.left = `${e.clientX}px`, c.style.top = `${e.clientY}px`), true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.className = "demo-ripple";
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.body.append(r);
      setTimeout(() => r.remove(), 600);
    }, true);
    window.__demo = {
      caption(html) {
        cap.classList.remove("on");
        setTimeout(() => { cap.innerHTML = html; if (html) cap.classList.add("on"); }, html ? 180 : 0);
      },
      card(html) {
        if (!html) return card.classList.remove("on");
        card.innerHTML = html;
        card.classList.add("on");
      },
    };
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install);
  else install();
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--force-color-profile=srgb", "--hide-scrollbars"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
  });
  await context.addInitScript(OVERLAY);
  await context.addInitScript(() => {
    try {
      localStorage.removeItem("tenor.receipts.v1");
      localStorage.setItem("tenor.receiptTheme", "paper");
    } catch {}
  });
  const page = await context.newPage();
  const mouse = page.mouse;
  let pos = { x: 640, y: 420 };

  const caption = (html) => page.evaluate((h) => window.__demo.caption(h), html);
  const card = (html) => page.evaluate((h) => window.__demo.card(h), html);
  async function moveTo(locator, { dx = 0.5, dy = 0.5, steps = 28 } = {}) {
    await locator.scrollIntoViewIfNeeded();
    const b = await locator.boundingBox();
    const x = b.x + b.width * dx;
    const y = b.y + b.height * dy;
    await mouse.move(x, y, { steps });
    pos = { x, y };
  }
  async function click(locator, opts) {
    await moveTo(locator, opts);
    await wait(180);
    await mouse.down();
    await wait(90);
    await mouse.up();
  }
  async function typeSlow(locator, text) {
    await click(locator);
    for (const ch of text) {
      await page.keyboard.type(ch);
      await wait(110);
    }
  }
  async function smoothScrollTo(locator, block = "center") {
    await locator.evaluate((el, b) => el.scrollIntoView({ behavior: "smooth", block: b }), block);
    await wait(900);
  }
  const dialog = () => page.getByRole("dialog");
  async function closeDialog() {
    await click(dialog().getByRole("button", { name: /close/i }).first());
    await wait(700);
  }

  await page.goto(URL, { waitUntil: "networkidle" });
  await mouse.move(pos.x, pos.y);

  // 0. Title card (already showing since first paint)
  await wait(3600);
  await card("");
  await wait(600);

  // 1. Problem
  await caption(`sMUSD paid <b>0.03%</b> over the last 7 days and <b>2.06%</b> over 30. Savers can't plan on that.`);
  await moveTo(page.getByRole("button", { name: "sMUSD paid, 7 days" }));
  await wait(2600);
  await moveTo(page.getByRole("button", { name: "sMUSD paid, 30 days" }));
  await wait(2600);

  // 2. Idea
  await caption(`Tenor splits sMUSD into <b>PT</b>, worth exactly 1 MUSD at maturity, and <b>YT</b>, all the yield until then.`);
  await moveTo(page.getByRole("button", { name: "Fixed rate today" }));
  await wait(4200);

  // 3. Lock a fixed rate
  await caption(`Lock a fixed rate: the quote shows the payout, the rate and the price impact before any wallet.`);
  await typeSlow(page.getByRole("textbox", { name: "Amount in MUSD" }), "2500");
  await wait(2200);
  await caption(`One click: approve, swap on Tigris, confirmed.`);
  await click(page.getByRole("button", { name: "Lock fixed rate" }));
  await dialog().waitFor();
  await caption(`Every action leaves a receipt, with an ink stamp of the rate you locked.`);
  await wait(2600);
  await moveTo(dialog().getByRole("article"), { dy: 0.3 });
  await wait(2200);
  await click(dialog().getByRole("radio", { name: "Night" }));
  await caption(`Paper or Night, download it as a PNG, or copy a link that reopens the receipt anywhere.`);
  await wait(2600);
  await moveTo(dialog().getByRole("button", { name: /copy link/i }));
  await wait(1600);
  await closeDialog();

  // 4. Rate bet
  await caption(`Think Mezo's revenue will rise? Buy <b>YT</b> instead: leverage on the sMUSD rate.`);
  await click(page.getByRole("radio", { name: "Rate bet" }));
  await wait(500);
  const amount = page.getByRole("textbox", { name: "Amount in MUSD" });
  await typeSlow(amount, "100");
  await wait(1200);
  await moveTo(page.getByText("Break-even sMUSD rate").first());
  await caption(`100 MUSD buys yield on about 16,000 MUSD. Break-even and payoffs are shown up front.`);
  await wait(3200);
  await click(page.getByRole("button", { name: "Buy YT" }));
  await dialog().waitFor();
  await wait(2600);
  await closeDialog();

  // 5. Time passes, claim
  await caption(`Say sMUSD pays <b>8%</b> for a week…`);
  await click(page.getByRole("radio", { name: "8%" }));
  await wait(700);
  await click(page.getByRole("button", { name: "+1 week" }));
  await wait(1200);
  await moveTo(page.getByText("Yield to claim", { exact: true }).first());
  await caption(`…the YT has earned real MUSD, ready to claim.`);
  await wait(2200);
  await click(page.getByRole("region", { name: "Your position" }).getByRole("button", { name: "Claim" }));
  await dialog().waitFor();
  await wait(2400);
  await closeDialog();

  // 6. Stamp book
  const stamps = page.getByRole("region", { name: "Your stamps" });
  await smoothScrollTo(stamps);
  await caption(`Your stamps: one for every lock, bet, claim and redemption.`);
  for (const b of await stamps.getByRole("button").all()) {
    await moveTo(b, { steps: 18 });
    await wait(700);
  }
  await wait(800);

  // 7. Live on testnet
  const live = page.getByRole("region", { name: "Live testnet" });
  await smoothScrollTo(live);
  await caption(`Live on <b>Mezo testnet</b>: two markets, real Tigris pools, rates read from chain.`);
  await moveTo(live.getByText(/Matures 31DEC26/).first());
  await wait(3200);
  await caption(`On-chain proof passed 6 of 6: buy PT, buy YT, sMUSD yield, claim, combine, and 1 sMUSD backing every PT.`);
  await wait(4200);

  // 8. Maturity and redemption
  await smoothScrollTo(page.getByRole("region", { name: "Your position" }), "start");
  await caption(`At maturity, PT redeems one to one.`);
  await click(page.getByRole("button", { name: "Jump to maturity" }));
  await wait(1000);
  const hold = page.getByRole("button", { name: /Hold to redeem/ });
  await moveTo(hold);
  await caption(`Hold to confirm, so a stray click never redeems.`);
  await mouse.down();
  await wait(2300);
  await mouse.up();
  await dialog().waitFor({ timeout: 5000 }).catch(() => {});
  await wait(2600);
  if (await dialog().count()) await closeDialog();

  // 9. End card
  await caption("");
  await card(`<div><div class="k">Tenor</div><h1>Know what your MUSD earns.</h1><small>harrymove-ctrl.github.io/tenor<br>github.com/harrymove-ctrl/tenor</small></div>`);
  await wait(4500);

  const video = page.video();
  await context.close();
  await browser.close();
  const src = await video.path();
  const webm = path.join(OUT, "tenor-demo.webm");
  renameSync(src, webm);
  for (const f of readdirSync(OUT)) if (f.endsWith(".webm") && f !== "tenor-demo.webm") rmSync(path.join(OUT, f));
  const mp4 = path.join(OUT, "tenor-demo.mp4"); // trimmed to the title card, faded in and out
  // Find when the title card first paints (the frame turns from the blank
  // page to the card), start there, and fade in and out.
  const total = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", webm]).toString().trim());
  const start = firstTitleFrame(webm);
  const length = total - start;
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-ss", String(start), "-i", webm,
    "-vf", `fade=t=in:st=0:d=0.5,fade=t=out:st=${(length - 0.8).toFixed(2)}:d=0.8`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", "-movflags", "+faststart", "-r", "30", mp4,
  ]);
  const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4]).toString().trim();
  console.log(`DEMO_DONE ${mp4} duration=${Number(dur).toFixed(1)}s`);
}

/** Seconds until the light "T" mark of the title card shows up near the center of the frame. */
function firstTitleFrame(file) {
  for (let t = 0; t < 8; t += 0.1) {
    const px = execFileSync("ffmpeg", ["-v", "error", "-ss", t.toFixed(1), "-i", file, "-frames:v", "1", "-vf", "crop=64:120:608:220,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    const [r, g, b] = px;
    // The light "T" mark has painted and Chromium's first-paint strip at the bottom is gone.
    const strip = execFileSync("ffmpeg", ["-v", "error", "-ss", t.toFixed(1), "-i", file, "-frames:v", "1", "-vf", "crop=1280:40:0:750,scale=1:1", "-f", "rawvideo", "-pix_fmt", "gray", "-"])[0];
    if (r + g + b > 360 && strip < 40) return t;
  }
  return 0;
}

main().catch((e) => {
  console.error("DEMO_FAILED", e.message);
  process.exit(1);
});
