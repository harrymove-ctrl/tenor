// Injected into every page of the recording (context.addInitScript). Adds a
// fake cursor with click ripples, a caption bar, and the animated intro and
// outro stages. Everything is attached to <html>, outside <body>, so app
// layout and dialogs are untouched. window.__demo drives it from Playwright.
(() => {
  const css = `
  #demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px)}
  #demo-cursor svg{filter:drop-shadow(0 2px 3px rgb(0 0 0/.45))}
  .demo-ripple{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid #f59e0b;z-index:2147483646;pointer-events:none;animation:demo-rip .55s ease-out forwards}
  @keyframes demo-rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.7);opacity:0}}
  #demo-sync{position:fixed;left:0;top:0;width:3px;height:3px;background:#000;z-index:2147483647;pointer-events:none}
  #demo-caption{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(12px);max-width:900px;width:max-content;z-index:2147483645;pointer-events:none;
    background:rgb(12 10 9/.88);color:#fafaf9;border:1px solid rgb(255 255 255/.12);border-radius:14px;padding:12px 20px;
    font:500 19px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;opacity:0;transition:opacity .35s,transform .35s;backdrop-filter:blur(6px);text-align:center}
  #demo-caption.on{opacity:1;transform:translateX(-50%) translateY(0)}
  #demo-caption b{color:#fbbf24;font-weight:600}

  .demo-stage{position:fixed;inset:0;z-index:2147483644;pointer-events:none;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#fafaf9}
  .demo-half{position:absolute;inset:0;background:#0b0908;overflow:hidden}
  .demo-half.top{clip-path:inset(0 0 calc(100% - var(--cut)) 0)}
  .demo-half.bottom{clip-path:inset(var(--cut) 0 0 0)}
  .demo-glow{position:absolute;inset:-20%;background:radial-gradient(40% 40% at 50% 46%,rgb(245 158 11/.32),rgb(245 158 11/.08) 45%,transparent 70%);opacity:0}
  .demo-grain{position:absolute;inset:-50%;opacity:.07;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")}
  .demo-center{position:absolute;inset:0;display:grid;place-items:center}
  .demo-block{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;transform:translateY(-4%)}
  .demo-mark{width:76px;height:76px;border-radius:20px;background:#fafaf9;color:#d97706;display:grid;place-items:center;font-size:40px;font-weight:800;opacity:0;box-shadow:0 0 0 0 rgb(245 158 11/.5)}
  .demo-word{margin-top:22px;font-size:96px;font-weight:700;letter-spacing:-.04em;line-height:1;display:flex}
  .demo-word span{display:inline-block;opacity:0}
  .demo-tag{margin-top:16px;font-size:26px;color:#d6d3d1;opacity:0}
  .demo-meta{margin-top:26px;font:600 13px/1 ui-monospace,Menlo,monospace;letter-spacing:.2em;text-transform:uppercase;color:#a8a29e;opacity:0}
  .demo-stamp{position:absolute;right:-240px;top:-40px;width:210px;height:210px;color:#f59e0b;opacity:0}
  .demo-perf{position:absolute;left:0;right:0;top:var(--cut);height:0;border-top:2px dashed rgb(250 250 249/.35);transform-origin:left;transform:scaleX(0)}
  .demo-notch{position:absolute;top:calc(var(--cut) - 14px);width:28px;height:28px;border-radius:50%;background:#e7e5e4;opacity:0}
  .demo-notch.l{left:-14px}.demo-notch.r{right:-14px}

  .demo-stage.play .demo-glow{animation:dg-glow 1.4s ease-out forwards, dg-breathe 4s 1.4s ease-in-out infinite}
  .demo-stage.play .demo-grain{animation:dg-grain .5s steps(4) infinite}
  .demo-stage.play .demo-mark{animation:dg-mark .8s .35s cubic-bezier(.2,1.5,.35,1) forwards, dg-ring 1.2s 1.05s ease-out}
  .demo-stage.play .demo-word span{animation:dg-letter .55s cubic-bezier(.2,.9,.3,1) forwards;animation-delay:calc(1s + var(--i) * 70ms)}
  .demo-stage.play .demo-tag{animation:dg-up .6s 1.75s ease-out forwards}
  .demo-stage.play .demo-stamp{animation:dg-stamp .3s 2.45s cubic-bezier(.55,0,1,.45) forwards}
  .demo-stage.play .demo-block{animation:dg-shake .32s 2.75s linear}
  .demo-stage.play .demo-meta{animation:dg-up .6s 3.3s ease-out forwards}
  .demo-stage.play .demo-perf{animation:dg-perf .6s 4.15s cubic-bezier(.6,0,.2,1) forwards}
  .demo-stage.play .demo-notch{animation:dg-up .3s 4.6s ease-out forwards}
  .demo-stage.tear .demo-half.top{animation:dg-tear-top .95s cubic-bezier(.7,0,.2,1) forwards}
  .demo-stage.tear .demo-half.bottom{animation:dg-tear-bot .95s cubic-bezier(.7,0,.2,1) forwards}

  @keyframes dg-glow{to{opacity:1}}
  @keyframes dg-breathe{50%{transform:scale(1.06)}}
  @keyframes dg-grain{0%{transform:translate(0,0)}25%{transform:translate(-3%,2%)}50%{transform:translate(2%,-3%)}75%{transform:translate(-2%,-1%)}}
  @keyframes dg-mark{from{opacity:0;transform:scale(.35) rotate(-12deg);filter:blur(10px)}to{opacity:1;transform:scale(1);filter:blur(0)}}
  @keyframes dg-ring{from{box-shadow:0 0 0 0 rgb(245 158 11/.55)}to{box-shadow:0 0 0 38px rgb(245 158 11/0)}}
  @keyframes dg-letter{from{opacity:0;transform:translateY(28px);filter:blur(10px)}to{opacity:1;transform:none;filter:blur(0)}}
  @keyframes dg-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  @keyframes dg-stamp{from{opacity:0;transform:scale(2.6) rotate(4deg)}to{opacity:.95;transform:scale(1) rotate(-13deg)}}
  @keyframes dg-shake{20%{transform:translate(-6px,4px)}40%{transform:translate(5px,-4px)}60%{transform:translate(-3px,2px)}80%{transform:translate(2px,-1px)}100%{transform:translateY(-4%)}}
  @keyframes dg-perf{to{transform:scaleX(1)}}
  @keyframes dg-tear-top{to{transform:translateY(-104%) rotate(-1.5deg)}}
  @keyframes dg-tear-bot{to{transform:translateY(104%) rotate(1deg)}}

  #demo-outro{opacity:0;transition:opacity .6s}
  #demo-outro.on{opacity:1}
  #demo-outro .demo-word{font-size:64px}
  #demo-outro .demo-links{margin-top:30px;font-size:17px;line-height:1.8;color:#a8a29e;opacity:0}
  #demo-outro.play .demo-links{animation:dg-up .6s 1.9s ease-out forwards}
  #demo-outro .demo-stamp{right:-200px;top:-70px}
  #demo-outro.play .demo-stamp{animation:dg-stamp .3s 1.45s cubic-bezier(.55,0,1,.45) forwards}
  #demo-outro.play .demo-block{animation:dg-shake .32s 1.75s linear}
  `;

  const stamp = (ring, big, small) => `
    <svg class="demo-stamp" viewBox="0 0 160 160" aria-hidden="true">
      <defs>
        <filter id="dink"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="g"/>
          <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -4 2.85" result="m"/>
          <feComposite in="SourceGraphic" in2="m" operator="in"/></filter>
        <path id="dring" d="M80,80 m-57,0 a57,57 0 1,1 114,0 a57,57 0 1,1 -114,0"/>
      </defs>
      <g filter="url(#dink)" fill="none" stroke="currentColor" style="font-family:ui-monospace,Menlo,monospace">
        <circle cx="80" cy="80" r="75" stroke-width="3.4"/><circle cx="80" cy="80" r="66" stroke-width="1.2"/>
        <circle cx="80" cy="80" r="45" stroke-width="1" stroke-dasharray="2 3"/>
        <text fill="currentColor" stroke="none" font-size="10.5" letter-spacing="2.6" font-weight="700"><textPath href="#dring">${ring}</textPath></text>
        <text x="80" y="84" text-anchor="middle" fill="currentColor" stroke="none" font-size="22" font-weight="800">${big}</text>
        <text x="80" y="101" text-anchor="middle" fill="currentColor" stroke="none" font-size="8.5" letter-spacing="1.6" font-weight="700">${small}</text>
      </g>
    </svg>`;

  const letters = (word) => [...word].map((c, i) => `<span style="--i:${i}">${c === " " ? "&nbsp;" : c}</span>`).join("");

  const introHalf = (cls) => `
    <div class="demo-half ${cls}">
      <div class="demo-glow"></div><div class="demo-grain"></div>
      <div class="demo-center"><div class="demo-block">
        <div class="demo-mark">T</div>
        <div class="demo-word">${letters("Tenor")}</div>
        <div class="demo-tag">Fixed-rate MUSD on Mezo</div>
        <div class="demo-meta">Mezo Buildathon · Wave 2 · Track 1 DeFi</div>
        ${stamp("FIXED RATE · LOCKED · FIXED RATE · LOCKED ·", "FIXED", "TO MATURITY")}
      </div></div>
      <div class="demo-perf"></div><div class="demo-notch l"></div><div class="demo-notch r"></div>
    </div>`;

  function install() {
    if (document.getElementById("demo-cursor")) return;
    const root = document.documentElement;
    const style = document.createElement("style");
    style.textContent = css;
    root.append(style);

    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    const caption = document.createElement("div");
    caption.id = "demo-caption";

    // Intro stage is up from the first paint, so the app never flashes first.
    const intro = document.createElement("div");
    intro.id = "demo-intro";
    intro.className = "demo-stage";
    intro.style.setProperty("--cut", "66%");
    intro.innerHTML = introHalf("top") + introHalf("bottom");

    const outro = document.createElement("div");
    outro.id = "demo-outro";
    outro.className = "demo-stage";
    outro.style.setProperty("--cut", "100%");
    outro.innerHTML = `<div class="demo-half"><div class="demo-glow"></div><div class="demo-grain"></div>
      <div class="demo-center"><div class="demo-block">
        <div class="demo-mark">T</div>
        <div class="demo-word">${letters("Know what your MUSD earns.")}</div>
        <div class="demo-links">harrymove-ctrl.github.io/tenor<br>github.com/harrymove-ctrl/tenor</div>
        ${stamp("TENOR · ON MEZO · TENOR · ON MEZO ·", "MUSD", "FIXED RATE")}
      </div></div></div>`;
    outro.style.display = "none";

    // Sync marker: flashes white for a moment on demand, so the render pass can
    // map wall-clock cue times onto the capture even when its encoder lags.
    const sync = document.createElement("div");
    sync.id = "demo-sync";
    root.append(intro, outro, caption, cursor, sync);

    addEventListener("mousemove", (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
    }, true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.className = "demo-ripple";
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      root.append(r);
      setTimeout(() => r.remove(), 600);
    }, true);

    window.__demo = {
      caption(html) {
        caption.classList.remove("on");
        setTimeout(() => {
          caption.innerHTML = html;
          if (html) caption.classList.add("on");
        }, html ? 180 : 0);
      },
      mark() {
        sync.style.background = "#fff";
        setTimeout(() => (sync.style.background = "#000"), 240);
      },
      playIntro() {
        intro.classList.add("play");
      },
      tearIntro() {
        intro.classList.add("tear");
        setTimeout(() => intro.remove(), 1000);
      },
      playOutro() {
        outro.style.display = "";
        requestAnimationFrame(() => outro.classList.add("on", "play"));
      },
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
