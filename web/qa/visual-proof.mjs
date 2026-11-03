// Drives the Tenor demo end to end in headless Chromium, checks layout and
// contrast, and writes visual proof to qa/artifacts/.
//
// Usage: node qa/visual-proof.mjs [baseUrl]
// Env:   CHROMIUM_PATH (optional) to use a locally installed Chromium build.
import { chromium } from "@playwright/test";
import { mkdirSync, renameSync, readdirSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5178/";
const OUT = path.resolve(import.meta.dirname, "artifacts");
mkdirSync(OUT, { recursive: true });

const launch = () =>
  chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function setAmount(page, value) {
  const input = page.getByRole("textbox", { name: "Amount in MUSD" });
  await input.fill(value);
  await page.waitForTimeout(400);
}

async function wallet(page) {
  const text = await page.getByRole("region", { name: "Your position" }).innerText();
  return Number(text.match(/Wallet ([\d,.]+) MUSD/)[1].replace(/,/g, ""));
}

async function geometry(page, label) {
  const g = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const overflow = [...document.querySelectorAll("body *")].filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && style.visibility !== "hidden" && r.right > vw + 1 && !el.closest("[aria-hidden=true]");
    }).length;
    return { vw, scrollW: document.documentElement.scrollWidth, overflow };
  });
  check(`${label}: no horizontal scroll`, g.scrollW <= g.vw, `scrollWidth ${g.scrollW} vs ${g.vw}`);
}

async function contrast(page, label) {
  const worst = await page.evaluate(() => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c;
      }
      return parse(getComputedStyle(document.body).backgroundColor);
    };
    const rows = [];
    for (const el of document.querySelectorAll("p, span, dt, dd, h1, h2, button, label, li, code")) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || Number(s.opacity) < 0.6 || el.closest("[aria-hidden=true],[disabled],.sr-only")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const fg = parse(s.color);
      const L1 = lum(fg), L2 = lum(bgOf(el));
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      rows.push({ ratio: Math.round(ratio * 100) / 100, text: el.textContent.trim().slice(0, 40) });
    }
    rows.sort((a, b) => a.ratio - b.ratio);
    return rows.slice(0, 3);
  });
  check(`${label}: text contrast >= 4.5:1`, worst[0].ratio >= 4.5, worst.map((w) => `${w.ratio} "${w.text}"`).join("; "));
}

async function shots(scheme) {
  const browser = await launch();
  for (const [name, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(1200);
    const suffix = scheme === "dark" ? "" : "-light";
    await page.screenshot({ path: path.join(OUT, `before-${name}${suffix}.png`) });
    await geometry(page, `${name} ${scheme} idle`);
    await contrast(page, `${name} ${scheme} idle`);

    await setAmount(page, "2500");
    const cta = page.getByRole("button", { name: "Lock fixed rate" });
    const box = await cta.boundingBox();
    if (name === "desktop") check(`${name} ${scheme}: primary button above the fold`, box.y + box.height <= viewport.height, `bottom ${Math.round(box.y + box.height)}`);
    await cta.click();
    await page.getByText("Fixed rate locked.").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `after-${name}${suffix}.png`) });
    await geometry(page, `${name} ${scheme} after trade`);
    await contrast(page, `${name} ${scheme} after trade`);
    await ctx.close();
  }
  await browser.close();
}

async function flow() {
  const browser = await launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
    recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
  });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(1500);

  // 1. Lock a fixed rate, triple-clicking to prove a single execution.
  await setAmount(page, "2500");
  const lock = page.getByRole("button", { name: "Lock fixed rate" });
  await lock.click({ clickCount: 3 });
  await page.getByText("Fixed rate locked.").waitFor();
  check("triple click executes once", (await wallet(page)) === 7500, `wallet ${await wallet(page)}`);

  // 2. Buy YT.
  await page.getByRole("radio", { name: "Rate bet" }).click();
  await setAmount(page, "100");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Buy YT" }).click();
  await page.getByText("YT bought.").waitFor();
  check("YT purchase spends 100 MUSD", (await wallet(page)) === 7400);

  // 3. sMUSD pays 8% for a week; claim.
  await page.getByRole("radio", { name: "8%" }).click();
  await page.getByRole("button", { name: "+1 week" }).click();
  await page.waitForTimeout(800);
  const pos = await page.getByRole("region", { name: "Your position" }).innerText();
  const claimable = Number(pos.match(/Yield to claim\n([\d.,]+)/)[1].replace(/,/g, ""));
  check("YT earns yield after a week at 8%", claimable > 15 && claimable < 30, `${claimable} MUSD`);
  await page.getByRole("button", { name: "Claim" }).click();
  await page.waitForTimeout(1200);
  check("claim pays out", (await wallet(page)) > 7400);

  // 4. Cancel mid-flight leaves the balance untouched.
  await page.getByRole("radio", { name: "Fixed rate" }).click();
  await setAmount(page, "50");
  const before = await wallet(page);
  await page.getByRole("button", { name: "Lock fixed rate" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(2200);
  check("cancel mid-flight spends nothing", (await wallet(page)) === before);

  // 5. Maturity: hold to redeem.
  await page.getByRole("button", { name: "Jump to maturity" }).click();
  await page.waitForTimeout(800);
  const hold = page.getByRole("button", { name: /Hold to redeem/ });
  const hb = await hold.boundingBox();
  const preRedeem = await wallet(page);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2300);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  check("hold to redeem pays PT 1:1", (await wallet(page)) > preRedeem + 2500, `wallet ${await wallet(page)}`);
  await page.screenshot({ path: path.join(OUT, "after-flow-final.png") });

  const video = page.video();
  await ctx.close();
  await browser.close();
  const src = await video.path();
  renameSync(src, path.join(OUT, "after-flow.webm"));
}

async function failure() {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
  await page.goto(`${BASE}?fail=swap`);
  await page.waitForTimeout(1000);
  await setAmount(page, "300");
  await page.getByRole("button", { name: "Lock fixed rate" }).click();
  await page.getByText(/Swap reverted/).waitFor();
  check("failed swap shows a reason and spends nothing", (await wallet(page)) === 10000);
  await page.screenshot({ path: path.join(OUT, "after-error-desktop.png") });
  await browser.close();
}

await shots("dark");
await shots("light");
await flow();
await failure();
for (const f of readdirSync(OUT)) if (f.endsWith(".webm") && f !== "after-flow.webm") renameSync(path.join(OUT, f), path.join(OUT, `extra-${f}`));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
