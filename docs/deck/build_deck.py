"""Builds docs/tenor-deck.pdf (16:9, vector) with ReportLab.

Usage: python docs/deck/build_deck.py
Testnet facts are read from deployments/31611.json when it exists, so a rerun
after `npm run deploy && npm run seed && npm run prove` fills in addresses.
"""
import json
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "tenor-deck.pdf"
W, H = 960, 540
BG, INK, MUTED, LINE, ACCENT, SOFT = (
    HexColor("#fafaf9"), HexColor("#1c1917"), HexColor("#78716c"), HexColor("#e7e5e4"), HexColor("#b45309"), HexColor("#f5f5f4"))
GOOD = HexColor("#047857")

dep_file = ROOT / "deployments" / "31611.json"
DEP = json.loads(dep_file.read_text()) if dep_file.exists() else None


def page(c, n, kicker, title):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(ACCENT)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(56, H - 56, kicker.upper())
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 30)
    c.drawString(56, H - 98, title)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(56, 28, "Tenor · fixed-rate MUSD on Mezo")
    c.drawRightString(W - 56, 28, str(n))


def para(c, x, y, text, size=15, color=INK, width=840, leading=1.35, font="Helvetica"):
    """Simple word wrap. Returns the y below the paragraph."""
    c.setFont(font, size)
    c.setFillColor(color)
    words, line = text.split(), ""
    for w in words:
        trial = f"{line} {w}".strip()
        if c.stringWidth(trial, font, size) > width:
            c.drawString(x, y, line)
            y -= size * leading
            line = w
        else:
            line = trial
    if line:
        c.drawString(x, y, line)
        y -= size * leading
    return y


def numbered(c, x, y, items, size=15, width=820, gap=8):
    for i, item in enumerate(items, 1):
        c.setFont("Helvetica-Bold", size)
        c.setFillColor(ACCENT)
        c.drawString(x, y, f"{i}.")
        y = para(c, x + 26, y, item, size=size, width=width - 26) - gap
    return y


def table(c, x, y, rows, widths, size=12, head=True, row_h=26):
    for r, row in enumerate(rows):
        if r == 0 and head:
            c.setFillColor(SOFT)
            c.rect(x, y - 8, sum(widths), row_h, fill=1, stroke=0)
        cx = x
        for i, cell in enumerate(row):
            bold = r == 0 and head
            c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
            c.setFillColor(INK if bold or i == 0 else MUTED)
            text = str(cell)
            while c.stringWidth(text, "Helvetica", size) > widths[i] - 12 and len(text) > 4:
                text = text[:-2]
            c.drawString(cx + 8, y, text)
            cx += widths[i]
        c.setStrokeColor(LINE)
        c.line(x, y - 9, x + sum(widths), y - 9)
        y -= row_h
    return y


def box(c, x, y, w, h, title, body, accent=False):
    c.setFillColor(HexColor("#ffffff"))
    c.setStrokeColor(ACCENT if accent else LINE)
    c.roundRect(x, y, w, h, 10, fill=1, stroke=1)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(x + 14, y + h - 26, title)
    para(c, x + 14, y + h - 48, body, size=11.5, color=MUTED, width=w - 28)


def arrow(c, x1, y1, x2, y2):
    c.setStrokeColor(MUTED)
    c.setLineWidth(1.2)
    c.line(x1, y1, x2, y2)
    c.line(x2, y2, x2 - 7, y2 + 4)
    c.line(x2, y2, x2 - 7, y2 - 4)


def build():
    c = canvas.Canvas(str(OUT), pagesize=(W, H))
    c.setTitle("Tenor: fixed-rate MUSD on Mezo")
    c.setAuthor("harrymove-ctrl")

    # 1. Title
    c.setFillColor(INK)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(HexColor("#fbbf24"))
    c.setFont("Helvetica-Bold", 13)
    c.drawString(64, H - 90, "MEZO BUILDATHON · WAVE 2 · TRACK 1 DEFI")
    c.setFillColor(HexColor("#fafaf9"))
    c.setFont("Helvetica-Bold", 64)
    c.drawString(64, H - 190, "Tenor")
    c.setFont("Helvetica", 28)
    c.drawString(64, H - 238, "Know what your MUSD earns.")
    para(c, 64, H - 300, "Tenor splits Mezo's savings token sMUSD into a fixed-rate principal token and a variable-rate yield token, "
         "and prices the fixed rate on a Tigris pool.", size=17, color=HexColor("#d6d3d1"), width=760)
    c.setFont("Helvetica", 12)
    c.setFillColor(HexColor("#a8a29e"))
    c.drawString(64, 64, "Harry Phan (harrymove-ctrl) · contracts, app, ops")
    c.showPage()

    # 2. Problem
    page(c, 2, "The problem", "Nobody can plan on sMUSD's rate")
    para(c, 56, H - 150, "sMUSD pays MUSD from trove interest through PCV. Read from Mezo mainnet on 2026-11-03 (block 12,951,840), "
         "its realized rate depends on the week you look at:", size=15, width=840)
    table(c, 56, H - 230, [["Window", "Realized sMUSD rate, annualized"], ["Last 7 days", "0.03%"], ["Last 14 days", "2.13%"],
                           ["Last 30 days", "2.06%"], ["Last 60 days", "3.35%"], ["Last 90 days", "2.42%"]], [260, 360], size=13)
    para(c, 56, 120, "Supply fell from 7.38M to 6.78M sMUSD in a week. Savers who want a known return leave; "
         "people with a view on Mezo's revenue have no way to express it.", size=14, color=MUTED, width=840)
    c.showPage()

    # 3. Solution
    page(c, 3, "The product", "Split the yield from the principal")
    box(c, 56, 250, 270, 170, "PT: the fixed rate", "Redeems for exactly 1 MUSD at maturity, whatever sMUSD pays. Bought below 1 MUSD, so the discount is your fixed return.", accent=True)
    box(c, 345, 250, 270, 170, "YT: the variable rate", "Collects every MUSD of sMUSD yield on 1 MUSD until maturity. Costs a fraction of a MUSD: leverage on Mezo's protocol revenue.")
    box(c, 634, 250, 270, 170, "PT/MUSD Tigris pool", "A stable pool on Mezo's own DEX prices PT, so the market sets the fixed rate. Anyone can provide liquidity and earn fees.")
    numbered(c, 56, 200, [
        "Saver: 1,000 MUSD buys about 1,002 PT, worth 1,002 MUSD on Dec 31 (rate fixed today).",
        "Rate trader: 3 MUSD buys about 90 YT, which pays out if sMUSD averages above the break-even rate.",
        "Before maturity, 1 PT + 1 YT always combine back into 1 MUSD plus earned yield.",
    ], size=13.5)
    c.showPage()

    # 4. How it works
    page(c, 4, "How it works", "One sMUSD backs one PT, always")
    nodes = [(56, "MUSD", "from the user"), (236, "TenorMarket", "deposits into sMUSD, mints PT + YT"), (446, "sMUSD", "Mezo savings vault, unstaked"), (656, "Yield index", "claimYield() spread over YT")]
    for x, t, s in nodes:
        box(c, x, 300, 180, 110, t, s, accent=(t == "TenorMarket"))
    for x in (236, 446, 656):
        arrow(c, x - 18, 355, x - 2, 355)
    numbered(c, 56, 250, [
        "TenorRouter buys and sells PT on the Tigris stable pool and buys YT in one transaction with a flash swap (IPoolCallee.hook).",
        "Every PT and YT transfer settles earned yield for both sides first, the same rule sMUSD applies to itself.",
        "At maturity the market settles: yield earned before goes to YT, yield after goes to PT holders who wait. PT redeems 1:1.",
        "No owner, no pause, no upgrade path in Tenor's contracts. A 5% fee on harvested yield goes to an immutable recipient.",
    ], size=13)
    c.showPage()

    # 5. Mezo integration
    page(c, 5, "Mezo integration", "Built on Mezo's own primitives")
    table(c, 56, H - 150, [
        ["Mezo contract", "What Tenor does with it"],
        ["sMUSD (MUSDSavingsRate)", "deposit, withdraw, claimYield; reads yieldIndex and claimable for live quotes"],
        ["Tigris PoolFactory", "createPool(PT, MUSD, stable) permissionlessly for each maturity"],
        ["Tigris Pool", "getAmountOut and swap, including the flash callback that buys YT in one transaction"],
        ["Tigris Router", "starter flow: swap testnet BTC for MUSD so a new user only needs the faucet"],
        ["MUSD", "the asset every PT redeems into"],
    ], [250, 590], size=12)
    para(c, 56, 200, "New MUSD demand, not a router over old venues: fixed-rate savers hold MUSD in PT to a date, rate traders buy YT with MUSD, "
         "and liquidity providers park MUSD in the PT pool.", size=14, width=840)
    para(c, 56, 130, "Next: route part of the fee to gauge bribes for veBTC voters, and a MEZO-mode YT that stakes sMUSD in its gauge.", size=13, color=MUTED, width=840)
    c.showPage()

    # 6. Proof
    page(c, 6, "Proof", "Tested against the real Tigris pool")
    rows = [["Check", "Result"],
            ["Unit and fuzz tests (real Tigris Pool and PoolFactory)", "24 pass; 2 mainnet fork tests opt-in"],
            ["Invariants: backing, supply parity, yield solvency", "3 pass, 16,384 calls each, 0 reverts"],
            ["End-to-end rehearsal: deploy, seed, prove, redeem", "8 of 8 checks pass"],
            ["Live panel with real transactions (approve, buy PT, buy YT, claim)", "pass on the rehearsal chain"],
            ["Keeper brings a skewed pool back to target", "66.4% to 3.36% in one pass"]]
    if DEP and DEP.get("factory"):
        rows.append(["Mezo testnet factory", DEP["factory"]])
        rows.append(["Mezo testnet router", DEP["router"]])
    else:
        rows.append(["Mezo testnet deployment", "scripts ready; awaiting faucet BTC"])
    table(c, 56, H - 150, rows, [520, 320], size=12)
    para(c, 56, 100, "A bug the tests caught: sMUSD.withdraw can release fresh yield inside the call. Burning tokens first sent that yield to fees; "
         "Tenor now withdraws first, then burns.", size=12.5, color=MUTED, width=840)
    c.showPage()

    # 7. Business
    page(c, 7, "Business model", "Who pays, and why it lasts")
    numbered(c, 56, H - 150, [
        "Tenor takes 5% of the sMUSD yield it harvests for YT holders. Savers buying PT pay only the pool fee.",
        "Liquidity providers earn Tigris swap fees on every PT and YT trade.",
        "No dependence on emissions: revenue scales with sMUSD's own rate and with how much MUSD wants a fixed date.",
        "Precedent: Pendle holds about $5B, over 80% of it in stablecoin yield. Mezo has no rate market today; 0 of 135 Wave 1 entries built one.",
    ], size=14.5)
    c.showPage()

    # 8. Roadmap and asks
    page(c, 8, "Next", "Roadmap and asks")
    table(c, 56, H - 150, [
        ["When", "What"],
        ["Wave 2 (by Nov 13)", "Testnet markets for Nov 12 and Dec 31; live redemption at maturity; outside testers"],
        ["Wave 3", "Capped mainnet market for Dec 31; keeper on a schedule; public proof page"],
        ["After", "Concentrated-liquidity PT pool for depth; MEZO-mode YT; PT as Morpho collateral"],
    ], [220, 620], size=12.5)
    numbered(c, 56, 250, [
        "Mezo: whitelist PT for a gauge so liquidity providers can earn MEZO.",
        "Mezo: a lower stable fee for PT pools. The 0.05% fee is charged on the full notional of every YT buy.",
        "Testers: lock a rate or buy YT on testnet and tell us what was unclear.",
    ], size=14)
    c.showPage()
    c.save()
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB, 8 slides)")


if __name__ == "__main__":
    build()
