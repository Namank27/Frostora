// ThreeUI LiquidMetalButton — vendored byte-for-byte from the verified
// source bundle (https://threeui.com/source-code/liquid-metal-button.json):
// this component SHA-256 89b940bab445f17fafb444a7833b3c785d24c86a28156d8ad
// 231e18de9503e11, the authored document ./liquid-metal-button.html SHA-256
// 76624e881a3aecbd79b473d9c51f53c7157d47052abd0f9dc28fefd223b0a819.
// The authored .html file on disk is unchanged. Host-boundary adaptations
// (the same pattern as the Nebula component): the document is imported as
// a Vite "?raw" text import bound through a string cast; one
// undefined-entry guard in the IntersectionObserver callback satisfies
// this project's strict index checks; and the runtime source string gets
// the small-host fixes documented at HOST_FIX_STYLE below (stage
// centring + transparent ground + no render-blocking font stylesheet —
// without them the pill renders as a solid black rectangle in a small
// host, the bug reported from the phone). All renderer, shader,
// interaction and lifecycle logic is otherwise the authored code.
//
// Player frost theme (play variant only, the user's explicit override:
// "don't make it black — keep the white and grey frosted theme, just
// use the animation and the stroke"): the play adapter's runtime copy
// restyles the plate to a frosted white / light-grey gradient with
// grey shadows and a charcoal glyph, and its config handler retunes
// the metal through the authored window.__set hook to an icy-white
// finish — dispersion skewed hard to the blue end so the ribbons and
// the travelling rim fringe ice-blue against white cores, at CALM
// levels (gain / hot / glow / punch at or below ~1.0, rim at 0.06
// laps/s): the first icy retune's past-1.0 values clipped the field
// to blown white and the button pulsed / flashed on the phone —
// see the flicker-fix note at the __set call — and swaps the glyph
// to pause bars while the label is "Pause". (An earlier all-white
// retune — dispersion and chroma at zero — was invisible on the
// white plate: white light on white glass. The ice-blue fringe is
// what makes the stroke read.)
// No shader, motion or interaction code changes; the pill and circle
// variants keep the authored finish. If the WebGL button fails its
// health handshake, the play fallback is the app's own
// .frosted-play-btn at the same diameter, so the transport never has
// a dead or black play button.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import liquidMetalButtonHtml from "./liquid-metal-button.html?raw";

// The "?raw" import above is a plain string at runtime.
// The Google Fonts <link> tags are stripped from the runtime copy only:
// a stylesheet in <head> blocks the srcDoc document's first paint (and
// its scripts) until it loads, which on a phone network can leave the
// iframe sitting black for seconds. The authored font stack already
// falls back to system fonts, which is what the label then uses.
const liquidMetalButtonSource = (liquidMetalButtonHtml as unknown as string)
  .replace(/<link rel="preconnect"[^>]*>\n?/g, "")
  .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>\n?/, "");

export type LiquidMetalButtonVariant = "pill" | "circle" | "play";

export type LiquidMetalButtonProps = {
  variant?: LiquidMetalButtonVariant;
  className?: string;
  rendering?: "colored" | "monotone";
  diameter?: number;
  strokeWidth?: number;
  text?: string;
  embedded?: boolean;
  onClick?: () => void;
};

const LIQUID_METAL_BUTTON_BRIDGE = `
<script id="liquid-metal-button-bridge">
  window.addEventListener('message', event => {
    if(event.source !== parent) return;
    if(event.data && event.data.liquidMetalButtonPing) { reportHealth(); return; }
    const config = event.data && event.data.liquidMetalButton;
    if(!config) return;
    const text = typeof config.text === 'string' ? config.text.slice(0, 24) : '';
    const label = btn.querySelector('.lbl');
    if(label) label.textContent = text;
    btn.setAttribute('aria-label', text || 'Button');
    if(Number.isFinite(config.pillWidthUnits)) {
      stage.style.setProperty('--bw', 'calc(' + config.pillWidthUnits + ' * var(--u))');
    }
    document.body.style.background = config.embedded ? '#0e0f12' : '';
    stage.style.position = config.embedded ? 'absolute' : '';
    stage.style.top = config.embedded ? '50%' : '';
    stage.style.left = config.embedded ? '50%' : '';
    stage.style.transform = config.embedded ? 'translate(-50%, -50%)' : '';
  });

  btn.addEventListener('click', () => {
    parent.postMessage({ liquidMetalButton: { type: 'activate' } }, '*');
  });

  /* Host health handshake + resting glow. The metal field only lights
     while hovered (uHover), and a touch screen never hovers — so at
     rest on a phone the pill is a near-black plate on a near-black
     ground. The authored tuning hook window.__hover(true) lights the
     metal at rest; press ripples still layer on top. The health report
     lets the parent verify the button really landed inside the iframe
     viewport (and that the WebGL path ran to completion — __hover is
     only defined when it did) and swap in a glass fallback if not. */
  function reportHealth() {
    try {
      let ok = false, bw = 0, bh = 0;
      if (typeof btn !== 'undefined' && btn) {
        const r = btn.getBoundingClientRect();
        bw = r.width; bh = r.height;
        ok = bw > 10 && bh > 10 &&
          r.left >= -2 && r.top >= -2 &&
          r.right <= window.innerWidth + 2 &&
          r.bottom <= window.innerHeight + 2 &&
          typeof window.__hover === 'function';
      }
      parent.postMessage({
        liquidMetalButton: {
          type: 'health', ok,
          btnW: Math.round(bw), btnH: Math.round(bh),
          viewW: window.innerWidth, viewH: window.innerHeight,
        },
      }, '*');
      if (ok && window.__hover) window.__hover(true);
    } catch (e) {
      parent.postMessage({ liquidMetalButton: { type: 'health', ok: false } }, '*');
    }
  }
  window.addEventListener('load', () => {
    setTimeout(reportHealth, 60);
    setTimeout(reportHealth, 700);
  });
</script>`;

/* Small-host fix (the black-rectangle bug). The authored stage is the
   pill PLUS a bloom pad of 900 units a side — 323x233px around a 52px
   pill — and the authored body centres it with display:grid. A grid
   track larger than its container starts at the container's top-left
   instead of centring, so in a small host (the Speed Dial pill's
   212x76 iframe) the pill sat at the stage's centre, ~116px down:
   below the visible iframe. All the host ever painted was the
   top-left corner of the stage — the document's opaque black ground.
   The fix, applied to the runtime copy only: shrink the pad so the
   stage fits the host, centre the stage absolutely (the same trick
   the play adapter already used), and make the document ground
   transparent so the iframe can never paint a black box of its own —
   the app's background is the ground the metal sits on. */
const HOST_FIX_STYLE = `
<style id="liquid-metal-host-fix">
  html { color-scheme: dark; }
  html, body { background: transparent !important; }
  .stage {
    --pad: calc(110 * var(--u));
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
</style>`;

const CIRCLE_RUNTIME_STYLE = `
<style id="liquid-metal-circle-variant">
  body[data-shape="circle"] .stage {
    --h: clamp(56px, 10vmin, 72px);
    --bw: var(--h);
  }

  body[data-shape="circle"] .btn {
    gap: 0;
  }

  body[data-shape="circle"] .btn .ico {
    width: 28%;
    height: 28%;
  }

  body[data-shape="circle"] .btn .lbl {
    display: none;
  }
</style>`;

function sourceForVariant(variant: Exclude<LiquidMetalButtonVariant, "play">) {
  if (variant === "pill") {
    return liquidMetalButtonSource
      .replace("</head>", `${HOST_FIX_STYLE}\n</head>`)
      .replace("</body>", `${LIQUID_METAL_BUTTON_BRIDGE}\n</body>`);
  }

  return liquidMetalButtonSource
    .replace("</head>", `${CIRCLE_RUNTIME_STYLE}\n${HOST_FIX_STYLE}\n</head>`)
    .replace("<body>", '<body data-shape="circle">')
    .replace(
      '<button class="btn" id="btn" type="button">',
      '<button class="btn" id="btn" type="button" aria-label="Add">',
    )
    .replace("</body>", `${LIQUID_METAL_BUTTON_BRIDGE}\n</body>`);
}

const liquidMetalPlayButtonSource = liquidMetalButtonSource
  .replace(
    "--bw: calc(1407 * var(--u));",
    "--bw: var(--h);",
  )
  .replace(
    "</style>",
    `
  /* Circular play-button adapter. The renderer and interaction graph stay
     source-exact; only geometry, finish, outline, and accessible naming vary. */
  body{position:relative}
  /* Same small-host fix as the pill: transparent ground (no black
     square behind the circle) and a pad that fits the host, so the
     stage is ~140px in the 118px host instead of ~395px. */
  html{color-scheme:dark}
  html,body{background:transparent !important}
  .stage{
    --h:88px;
    --pad:calc(150 * var(--u));
    position:absolute;top:50%;left:50%;
    transform:translate(-50%,-50%);
  }
  #fx{filter:none}
  .btn{flex-direction:column;gap:0}
  .btn:focus-visible{outline:2px solid rgba(255,255,255,.68);outline-offset:4px}
  .btn .ico{
    width:calc(var(--h) * .25);height:calc(var(--h) * .25);
    transform:translateX(calc(var(--h) * .018));
  }

  /* Frost theme — the music player's override of the authored finish
     (the user's instruction: not black; keep the app's white / grey
     frosted theme, use only the liquid-metal animation and stroke).
     Same plate geometry and the same rest / hot / press shadow
     choreography as the authored rules above — only the body colour,
     shadow colour and glyph colour change: a frosted white /
     light-grey gradient body, soft grey shadows, and a charcoal
     glyph matching the app's .frosted-play-btn. The metal light
     itself is retuned through the authored window.__set tuning
     hook in the config handler below to an icy finish — blown-white
     cores fringed ice-blue — so the travelling stroke, press
     ripples and bloom stay clearly visible on the light plate
     instead of spectral colour on black (or invisible white on
     white). The plate gradient runs a touch cooler for the same
     reason, with a pale ice-blue hairline inset on its edge. */
  .plate{
    background:linear-gradient(155deg,#ffffff 0%,#edf1f7 48%,#ccd6e2 100%);
    box-shadow:
      0 calc(var(--h) * 0.10) calc(var(--h) * 0.22) rgba(23,23,31,.30),
      0 calc(var(--h) * 0.30) calc(var(--h) * 0.66) rgba(23,23,31,.20),
      0 calc(var(--h) * 0.62) calc(var(--h) * 1.30) rgba(23,23,31,.12),
      inset 0 1px 1px rgba(255,255,255,.95),
      inset 0 0 0 1px rgba(140,175,225,.38),
      inset 0 calc(var(--h) * -0.12) calc(var(--h) * 0.22) rgba(74,74,88,.16);
  }
  body.hot .plate{
    background:linear-gradient(155deg,#ffffff 0%,#f1f5fa 48%,#d7e0ec 100%);
    box-shadow:
      0 calc(var(--h) * 0.12) calc(var(--h) * 0.26) rgba(23,23,31,.34),
      0 calc(var(--h) * 0.40) calc(var(--h) * 0.86) rgba(23,23,31,.22),
      0 calc(var(--h) * 0.86) calc(var(--h) * 1.80) rgba(23,23,31,.13),
      inset 0 1px 1px rgba(255,255,255,.95),
      inset 0 0 0 1px rgba(140,175,225,.45),
      inset 0 calc(var(--h) * -0.12) calc(var(--h) * 0.22) rgba(74,74,88,.16);
  }
  body.press .plate{
    background:linear-gradient(155deg,#f7fafc 0%,#e4eaf2 48%,#c3cfdd 100%);
    box-shadow:
      0 calc(var(--h) * 0.05) calc(var(--h) * 0.13) rgba(23,23,31,.36),
      0 calc(var(--h) * 0.16) calc(var(--h) * 0.40) rgba(23,23,31,.24),
      0 calc(var(--h) * 0.34) calc(var(--h) * 0.80) rgba(23,23,31,.14),
      inset 0 1px 1px rgba(255,255,255,.9),
      inset 0 0 0 1px rgba(140,175,225,.5),
      inset 0 calc(var(--h) * -0.12) calc(var(--h) * 0.22) rgba(74,74,88,.18);
    transition-duration:.10s;
  }
  .btn{color:#1d1d22}
  .btn:focus-visible{outline-color:rgba(29,29,34,.55)}
</style>`,
  )
  .replace(
    `<button class="btn" id="btn" type="button">
    <svg class="ico" viewBox="0 0 115 115" aria-hidden="true">
      <g stroke="currentColor" stroke-width="17" stroke-linecap="round">
        <path d="M57.5 8.5 V106.5"/>
        <path d="M8.5 57.5 H106.5"/>
      </g>
    </svg>
    <span class="lbl">Sign up</span>
  </button>`,
    `<button class="btn" id="btn" type="button" aria-label="Play">
    <svg class="ico" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="currentColor" d="M15.5 10.75a2.2 2.2 0 0 1 3.32-1.9l18.04 13.25a2.35 2.35 0 0 1 0 3.8L18.82 39.15a2.2 2.2 0 0 1-3.32-1.9v-26.5Z"/>
    </svg>
  </button>`,
  )
  .replace(
    "let needResize = true;",
    "let needResize = true;\nlet playStrokeWidth = 3;",
  )
  .replace(
    "const bw = Math.max(1.5, 3.2 * (BH/516));      // stroke half-width, device px",
    "const bw = Math.max(0.5 * DPR, playStrokeWidth * DPR * 0.5); // configurable stroke half-width, device px",
  )
  .replace(
    "window.__seek   = v => { clock = v; drawn = null; };",
    `window.__seek   = v => { clock = v; drawn = null; };

window.addEventListener('message', event => {
  if(event.source !== parent) return;
  const config = event.data && event.data.liquidMetalPlayButton;
  if(!config) return;
  const diameter = Math.min(160, Math.max(72, Number(config.diameter) || 88));
  const strokeWidth = Math.min(8, Math.max(1, Number(config.strokeWidth) || 3));
  const text = typeof config.text === 'string' ? config.text.slice(0, 24) : 'Play';
  stage.style.setProperty('--h', diameter + 'px');
  playStrokeWidth = strokeWidth;
  btn.setAttribute('aria-label', text.trim() || 'Play');
  /* Player state glyph: this button is the transport's pause control
     while a song is playing, so the icon follows the label — pause
     bars for "Pause" (centred, no optical offset), the authored play
     triangle otherwise. */
  const ico = btn.querySelector('.ico');
  if(ico){
    if(text.trim() === 'Pause'){
      ico.innerHTML = '<rect fill="currentColor" x="14.5" y="11" width="6.8" height="26" rx="2.3"/><rect fill="currentColor" x="26.7" y="11" width="6.8" height="26" rx="2.3"/>';
      ico.style.transform = 'none';
    } else {
      ico.innerHTML = '<path fill="currentColor" d="M15.5 10.75a2.2 2.2 0 0 1 3.32-1.9l18.04 13.25a2.35 2.35 0 0 1 0 3.8L18.82 39.15a2.2 2.2 0 0 1-3.32-1.9v-26.5Z"/>';
      ico.style.transform = '';
    }
  }
  /* Icy-white finish through the authored tuning hook — CALM
     retune (flicker fix, 21 Nov). The first icy retune pushed
     gain / hot / glow / punch far past 1.0 (2.35 / 1.50 / 2.60 /
     1.70): the metal field clipped to blown white across most of
     the disc, the bloom halo throbbed as the three rim lobes
     re-pooled, the whole button's brightness swung frame to
     frame, and the across-stroke chroma opened a broad warm arc
     at the rim — on the phone the button read as a flashing disc
     ("the app is flickering"). These values keep every stage at
     or below ~1.0 so highlights roll off instead of clipping:
     the stroke stays drawn (base), the travelling lobes stay
     visible but in a narrow brightness band (hot, gain), the
     halo is a soft rim glow rather than a pulsing blob (glow,
     glowIn, punch), the face sparkle is dimmed so the disc's
     overall brightness holds steady (dim), the warm fringe is
     narrowed back to a hairline (chromA / chromS, skew still
     hard to the blue end so the fringe that remains is
     ice-blue), the fine filaments are quieter (fineAmp), and
     the rim travels at just under the authored speed (0.06
     laps/s vs the authored 0.070) — a calm, clearly visible
     travel instead of a fast sweep. Shaders, motion structure
     and interactions are untouched. */
  if(window.__set) window.__set(
    { disp: 0.30, skew: 2.8, gain: 1.25, dim: 0.45, fineAmp: 0.03, width: 0.60 },
    { base: 0.34, hot: 0.92, chromA: 0.16, chromS: 0.014, speed: 0.06, top: 0.15, press: 0.95, ripple: 1.40 },
    { glow: 1.25, glowIn: 0.20, punch: 1.12, soften: 0.20 },
    {}
  );
  cv.style.filter = config.rendering === 'monotone' ? 'grayscale(1) contrast(1.04)' : 'none';
  needResize = true;
  drawn = null;
});`,
  )
  .replace("</body>", `${LIQUID_METAL_BUTTON_BRIDGE}\n</body>`);

function clamp(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function LiquidMetalButton({
  className = "",
  variant = "pill",
  rendering = "colored",
  diameter = 88,
  strokeWidth = 3,
  text,
  embedded = false,
  onClick,
}: LiquidMetalButtonProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const intersectsRef = useRef(true);
  const [mounted, setMounted] = useState(true);
  const [ready, setReady] = useState(false);
  const safeVariant: LiquidMetalButtonVariant =
    variant === "circle" || variant === "play" ? variant : "pill";
  const isPlayButton = safeVariant === "play";
  const safeText = String(text ?? (safeVariant === "pill" ? "Sign up" : safeVariant === "circle" ? "Add" : "Play"))
    .slice(0, 24);
  const pillWidthUnits = safeVariant === "pill"
    ? Math.min(3000, Math.max(1407, 820 + safeText.length * 94))
    : undefined;
  const source = useMemo(
    () => isPlayButton ? liquidMetalPlayButtonSource : sourceForVariant(safeVariant),
    [isPlayButton, safeVariant],
  );
  const playConfig = {
    diameter: clamp(diameter, 72, 160, 88),
    strokeWidth: clamp(strokeWidth, 1, 8, 3),
    rendering,
    text: safeText,
  } as const;

  const syncButtonConfig = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({
      liquidMetalButton: { text: safeText, pillWidthUnits, embedded },
    }, "*");
  }, [embedded, pillWidthUnits, safeText]);

  const syncPlayConfig = useCallback(() => {
    if (!isPlayButton) return;
    frameRef.current?.contentWindow?.postMessage({ liquidMetalPlayButton: playConfig }, "*");
  }, [isPlayButton, playConfig.diameter, playConfig.rendering, playConfig.strokeWidth, playConfig.text]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const sync = () => setMounted(intersectsRef.current && document.visibilityState !== "hidden");
    const observer = new IntersectionObserver(([entry]) => {
      // Strict index check in this project: an observer callback always
      // delivers at least one entry, but the type is `Entry | undefined`.
      if (!entry) return;
      intersectsRef.current = entry.isIntersecting;
      sync();
    }, { rootMargin: "80px" });

    observer.observe(host);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  /* Health handshake: the iframe must report (via the bridge) that its
     button is laid out inside the viewport and its WebGL path ran,
     within HEALTH_TIMEOUT_MS of mounting. If it never reports healthy —
     WebGL2 blocked, shader compile failed, document stalled — the
     liquid-glass fallback below replaces the iframe, so the control is
     never a black blank rectangle. A WebGL2 pre-check in the parent
     skips the iframe entirely where the API is missing. */
  const [health, setHealth] = useState<"pending" | "ok" | "failed">("pending");
  const webgl2Ok = useMemo(() => {
    try {
      const canvas = document.createElement("canvas");
      return !!canvas.getContext("webgl2");
    } catch {
      return false;
    }
  }, []);
  const showFallback = !webgl2Ok || health === "failed";

  useEffect(() => {
    if (!mounted) {
      setReady(false);
      setHealth("pending");
    }
  }, [mounted]);

  useEffect(() => {
    if (!ready) return;
    syncButtonConfig();
    syncPlayConfig();
  }, [ready, syncButtonConfig, syncPlayConfig]);

  useEffect(() => {
    const receiveHealth = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const report = event.data?.liquidMetalButton;
      if (report?.type === "health" && report.ok) setHealth("ok");
    };
    window.addEventListener("message", receiveHealth);
    return () => window.removeEventListener("message", receiveHealth);
  }, []);

  useEffect(() => {
    if (!mounted || showFallback) return undefined;
    const timer = setTimeout(() => {
      setHealth((h) => (h === "ok" ? h : "failed"));
    }, HEALTH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [mounted, showFallback, safeVariant]);

  useEffect(() => {
    if (!onClick) return undefined;
    const receiveMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.liquidMetalButton?.type !== "activate") return;
      onClick();
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [onClick]);

  return (
    <div
      ref={hostRef}
      className={`liquid-metal-button${className ? ` ${className}` : ""}`}
      data-state={showFallback ? "fallback" : !mounted ? "paused" : health === "ok" ? "ready" : "loading"}
      data-variant={safeVariant}
    >
      {showFallback ? (
        <MetalFallbackButton
          variant={safeVariant}
          text={safeText}
          diameter={playConfig.diameter}
          onClick={onClick}
        />
      ) : mounted ? (
        <iframe
          key={safeVariant}
          ref={frameRef}
          className={`liquid-metal-button__frame${health === "ok" ? " is-ready" : ""}`}
          title={safeVariant === "circle"
            ? "Interactive liquid metal circle button"
            : isPlayButton
              ? "Interactive liquid metal play button"
              : "Interactive liquid metal button"}
          srcDoc={source}
          sandbox="allow-scripts allow-same-origin"
          loading="eager"
          onLoad={() => {
            setReady(true);
            syncButtonConfig();
            syncPlayConfig();
            frameRef.current?.contentWindow?.postMessage({ liquidMetalButtonPing: true }, "*");
          }}
        />
      ) : null}
    </div>
  );
}

const HEALTH_TIMEOUT_MS = 8000;

/* Liquid-glass fallback for when the WebGL button cannot prove it
   rendered: same host size, same label, same tap action, in the app's
   own glass theme — visible and tappable instead of a black box. */
function MetalFallbackButton({
  variant,
  text,
  diameter,
  onClick,
}: {
  variant: LiquidMetalButtonVariant;
  text: string;
  diameter: number;
  onClick?: () => void;
}) {
  const glyph =
    text === "Pause" ? (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6.5" y="5" width="4" height="14" rx="1" />
        <rect x="13.5" y="5" width="4" height="14" rx="1" />
      </svg>
    ) : variant === "circle" ? (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    ) : (
      <svg width="15" height="15" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">
        <path d="M15.5 10.75a2.2 2.2 0 0 1 3.32-1.9l18.04 13.25a2.35 2.35 0 0 1 0 3.8L18.82 39.15a2.2 2.2 0 0 1-3.32-1.9v-26.5Z" />
      </svg>
    );

  if (variant === "pill") {
    return (
      <span className="flex h-full w-full items-center justify-center">
        <button
          type="button"
          onClick={onClick}
          aria-label={text}
          className="glass flex h-[52px] w-[168px] items-center justify-center gap-2 rounded-full text-[15px] font-medium text-white transition-transform duration-150 active:scale-[0.97]"
        >
          {glyph}
          <span>{text}</span>
        </button>
      </span>
    );
  }

  /* Play variant fallback: the player's frosted-white glass button
     itself (.frosted-play-btn — white gradient, charcoal glyph), at
     the configured diameter, so a WebGL failure swaps the liquid
     metal for the exact control the theme already uses. */
  if (variant === "play") {
    return (
      <span className="relative flex h-full w-full items-center justify-center">
        <span
          className="play-rim-glow"
          aria-hidden="true"
          style={{ width: diameter + 12, height: diameter + 12 }}
        />
        <button
          type="button"
          onClick={onClick}
          aria-label={text}
          className="frosted-play-btn np-press relative flex items-center justify-center rounded-full"
          style={{ width: diameter, height: diameter }}
        >
          {text === "Pause" ? (
            <svg width="27" height="27" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6.5" y="5" width="4" height="14" rx="1" />
              <rect x="13.5" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true" className="translate-x-[2px]">
              <path d="M15.5 10.75a2.2 2.2 0 0 1 3.32-1.9l18.04 13.25a2.35 2.35 0 0 1 0 3.8L18.82 39.15a2.2 2.2 0 0 1-3.32-1.9v-26.5Z" />
            </svg>
          )}
        </button>
      </span>
    );
  }

  const size = 64;
  return (
    <span className="flex h-full w-full items-center justify-center">
      <button
        type="button"
        onClick={onClick}
        aria-label={text}
        className="glass flex items-center justify-center rounded-full text-white transition-transform duration-150 active:scale-[0.97]"
        style={{ width: size, height: size }}
      >
        {glyph}
      </button>
    </span>
  );
}
