// ThreeUI StructureFlowCollection — Nebula variant ("Julian Vance nebula background").
// Registered source bundle: https://threeui.com/source-code/nebula.json
// The shader document (sources/julian-vance-nebula.html, SHA-256
// e4f3bda31a5c260356790add556a2ae59bb97ad6015a1f84cc6c9801b37e5a4d) and the
// shared stylesheet (../threeui.css, SHA-256
// efe4447139f1358dd8e9be68edf6fa46cbefbd1de423a4d6c439ca61d2c8eccf) are vendored
// byte-for-byte from that bundle. This component file is the bundle's
// NeuformCraftEffects.tsx with one mechanical adaptation: the shader
// document and vendored libraries are imported as Vite "?raw" text
// imports (the Muse build used Bun text import attributes),
// and the effect registry keeps only the nebula entry (the bundle ships
// no other variant sources), the import is bound through a string cast,
// and two destructuring defaults satisfy this project's strict index
// checks. All rendering logic below is the authored code, unchanged.

import { useMemo, type CSSProperties } from "react";

import julianVanceNebulaHtml from "./sources/julian-vance-nebula.html?raw";
import threeJsSource from "./sources/vendor/three.min.js.txt?raw";
import gsapJsSource from "./sources/vendor/gsap.min.js.txt?raw";
import scrollTriggerJsSource from "./sources/vendor/ScrollTrigger.min.js.txt?raw";

// The "?raw" imports above are plain strings at runtime.
const julianVanceNebulaSource = julianVanceNebulaHtml as unknown as string;

// The authored page loads Three.js r128, GSAP and ScrollTrigger from the
// cdnjs CDN. On desktop browsers (Edge tracking prevention, blockers) those
// CDN requests can be refused, which left "THREE is not defined" and a flat
// black iframe. The exact same library builds are now vendored under
// sources/vendor/ (SHA-256: three 9274bbcec8d96168626c732b5d31c775aa8cfb7ea
// a0599bec0c175908a2c1ce2, gsap 28033e449a31ebcc396e5be8b13b63152bf03094288f
// b5867034321927bce087, ScrollTrigger ad33c2df9ada8a663c2147357828f980d0b7ca
// 731ef33eb3c6e4f327c3b2cda5) and inlined into the document at build time —
// no network fetch is involved. The Tailwind CDN and Iconify scripts only
// styled the authored page's own chrome, which the focus isolation hides
// anyway, so those two tags are dropped rather than left as failure points.
function localizeLibraryScripts(source: string): string {
  let out = source;
  out = out.replace('<script src="https://cdn.tailwindcss.com"></script>', "");
  out = out.replace(
    '<script src="https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js"></script>',
    "",
  );
  out = out.replace(
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>',
    () => `<script>\n${threeJsSource}\n</script>`,
  );
  out = out.replace(
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>',
    () => `<script>\n${gsapJsSource}\n</script>`,
  );
  out = out.replace(
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>',
    () => `<script>\n${scrollTriggerJsSource}\n</script>`,
  );
  return out;
}

// Health reporter: tells the parent page whether the shader actually
// started (Three.js present + the canvas has real size), so the parent
// can drop the iframe and show its brushed-metal gradient fallback
// instead of a flat black rectangle when WebGL fails.
const NEBULA_HEALTH_SCRIPT = `<script data-threeui-health>
(function () {
  function report() {
    var canvas = document.getElementById('bg-canvas');
    var ok = typeof window.THREE !== 'undefined' && !!canvas && canvas.width > 0 && canvas.height > 0;
    try { window.parent.postMessage({ type: 'nebula-health', ok: ok }, '*'); } catch (e) {}
  }
  window.addEventListener('load', function () { setTimeout(report, 900); setTimeout(report, 2600); });
})();
</script>`;

type FocusRole = "background" | "ui";
type EffectMode = "dark" | "light";

type FocusTarget = {
  selector: string;
  role: FocusRole;
  width?: string;
};

type EffectDefinition = {
  title: string;
  source: string;
  background: string | ((mode: EffectMode) => string);
  targets: readonly FocusTarget[];
  presentation?: "animated-typography" | "woven-cloth-label";
};

export type NeuformCraftEffectProps = {
  mode?: EffectMode;
  hue?: number;
  saturation?: number;
  brightness?: number;
  className?: string;
  style?: CSSProperties;
};

export const NEUFORM_CRAFT_DEFAULTS = {
  hue: 0,
  saturation: 1,
  brightness: 1,
} as const;

const EFFECTS = {
  julianVanceNebula: {
    title: "Julian Vance nebula background",
    source: julianVanceNebulaSource,
    background: "#09090b",
    targets: [{ selector: "#bg-canvas", role: "background" }],
  },
} as const satisfies Record<string, EffectDefinition>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function replaceRequired(source: string, authored: string, focused: string) {
  if (!source.includes(authored)) {
    throw new Error(`Neuform source adapter could not find: ${authored}`);
  }
  return source.replace(authored, focused);
}

function animatedTypographySource(source: string) {
  return [
    [
      "return { t0: after + 5.6 + frnd() * 7.2, dur: total, segs: segs };",
      "return { t0: after + 1.25 + frnd() * 1.75, dur: total, segs: segs };",
    ],
    ["if (!ev) ev = nextEvent(4.2);", "if (!ev) ev = nextEvent(0.55);"],
    [
      "cap = Math.min((W - W * 0.12) / blockW, (H - H * 0.18) / blockH);",
      "cap = Math.min((W - W * 0.20) / blockW, (H - H * 0.28) / blockH);",
    ],
    ["var y0 = (H - blockH * cap) * 0.48;", "var y0 = (H - blockH * cap) / 2;"],
  ].reduce(
    (adapted, [authored = "", focused = ""]) => replaceRequired(adapted, authored, focused),
    source,
  );
}

function wovenClothLabelSource(source: string) {
  return [
    ["x.fillText('L W', W/2, 190);", "x.fillText('W C', W/2, 190);"],
    ["x.fillText('· KYOTO ·', W/2, 246);", "x.fillText('· WOVEN CLOTH ·', W/2, 246);"],
    ["x.fillText('LUMINA', W/2, 400);", "x.fillText('WOVEN', W/2, 400);"],
    ["x.fillText('WEAVERS', W/2, 520);", "x.fillText('CLOTH', W/2, 520);"],
    [
      "x.fillText('K I N E T I C   T E X T I L E S   ·   2 0 2 4', W/2, 626);",
      "x.fillText('T E X T I L E   S I M U L A T I O N', W/2, 626);",
    ],
  ].reduce(
    (adapted, [authored = "", focused = ""]) => replaceRequired(adapted, authored, focused),
    source,
  );
}

function resolveBackground(definition: EffectDefinition, mode: EffectMode) {
  return typeof definition.background === "function" ? definition.background(mode) : definition.background;
}

function buildFocusedDocument(definition: EffectDefinition, mode: EffectMode) {
  const targetJson = JSON.stringify(definition.targets).replace(/</g, "\\u003c");
  const background = resolveBackground(definition, mode);
  const monochromeFilter = mode === "light"
    ? "grayscale(1) invert(1) contrast(1.08)"
    : "grayscale(1) contrast(1.08)";
  const presentationStyle = definition.presentation === "animated-typography"
    ? `
@keyframes sf-neon-type-breathe {
  0%, 100% { transform: translate3d(0, 3px, 0) scale(0.988); opacity: 0.88; }
  45% { transform: translate3d(0, -3px, 0) scale(1); opacity: 1; }
  68% { transform: translate3d(0, 0, 0) scale(0.996); opacity: 0.96; }
}
#board { overflow: visible !important; }
#neon {
  transform-origin: 50% 52%;
  animation: sf-neon-type-breathe 5.6s cubic-bezier(0.22, 1, 0.36, 1) infinite;
  filter: ${monochromeFilter};
  will-change: transform, opacity;
}
@media (prefers-reduced-motion: reduce) {
  #neon { animation: none !important; transform: none !important; opacity: 1 !important; }
}
`
    : "";
  const focusStyle = `<style data-threeui-focus>
html, body { width: 100% !important; height: 100% !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: ${background} !important; }
body { position: relative !important; display: flex !important; align-items: center !important; justify-content: center !important; }
body > * { visibility: hidden !important; }
body[data-threeui-ready] > [data-threeui-role] { visibility: visible !important; }
[data-threeui-residual] { display: none !important; }
[data-threeui-role="background"] { position: fixed !important; inset: 0 !important; width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; z-index: 0 !important; opacity: 1 !important; pointer-events: none !important; }
[data-threeui-role="ui"] { position: relative !important; z-index: 1 !important; width: min(calc(100% - 32px), var(--threeui-target-width, 1040px)) !important; max-width: none !important; max-height: calc(100% - 32px) !important; margin: auto !important; overflow: auto !important; opacity: 1 !important; transform: none !important; filter: none !important; flex: none !important; box-sizing: border-box !important; }
${presentationStyle}
</style>`;
  const focusScript = `<script data-threeui-focus>
(function () {
  var isolated = false;
  function isolate() {
    if (isolated) return;
    var specs = ${targetJson};
    var roots = [];
    specs.forEach(function (spec) {
      var element = document.querySelector(spec.selector);
      if (!element) return;
      element.setAttribute('data-threeui-role', spec.role);
      if (spec.width) element.style.setProperty('--threeui-target-width', spec.width);
      if (!roots.some(function (root) { return root.contains(element); })) roots.push(element);
    });
    if (!roots.length) return;
    isolated = true;
    roots.forEach(function (root) { document.body.appendChild(root); });
    Array.from(document.body.children).forEach(function (element) {
      if (roots.indexOf(element) !== -1) return;
      element.setAttribute('data-threeui-residual', '');
      element.setAttribute('aria-hidden', 'true');
      if ('inert' in element) element.inert = true;
    });
    document.body.setAttribute('data-threeui-ready', '');
    requestAnimationFrame(function () { window.dispatchEvent(new Event('resize')); });
  }
  function scheduleIsolation() { setTimeout(isolate, 100); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleIsolation, { once: true });
  else scheduleIsolation();
  window.addEventListener('load', isolate, { once: true });
})();
</script>`;
  const presentedSource = definition.presentation === "animated-typography"
    ? animatedTypographySource(definition.source)
    : definition.presentation === "woven-cloth-label"
      ? wovenClothLabelSource(definition.source)
      : definition.source;
  return localizeLibraryScripts(presentedSource)
    .replace(/<\/head>/i, `${focusStyle}</head>`)
    .replace(/<\/body>/i, `${focusScript}${NEBULA_HEALTH_SCRIPT}</body>`);
}

function NeuformCraftEffect({
  definition,
  mode = "dark",
  hue = NEUFORM_CRAFT_DEFAULTS.hue,
  saturation = NEUFORM_CRAFT_DEFAULTS.saturation,
  brightness = NEUFORM_CRAFT_DEFAULTS.brightness,
  className,
  style,
}: NeuformCraftEffectProps & { definition: EffectDefinition }) {
  const safeMode: EffectMode = mode === "light" ? "light" : "dark";
  const background = resolveBackground(definition, safeMode);
  const source = useMemo(() => buildFocusedDocument(definition, safeMode), [definition, safeMode]);
  const safeHue = clamp(hue, -180, 180);
  const safeSaturation = clamp(saturation, 0, 2);
  const safeBrightness = clamp(brightness, 0.35, 1.65);
  const filter = safeHue === 0 && safeSaturation === 1 && safeBrightness === 1
    ? undefined
    : `hue-rotate(${safeHue}deg) saturate(${safeSaturation}) brightness(${safeBrightness})`;

  return (
    <iframe
      className={className}
      data-mode={safeMode}
      title={definition.title}
      srcDoc={source}
      sandbox="allow-scripts"
      loading="eager"
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        border: 0,
        background,
        filter,
        ...style,
      }}
    />
  );
}

function createEffectComponent(definition: EffectDefinition) {
  return function EffectComponent(props: NeuformCraftEffectProps) {
    return <NeuformCraftEffect {...props} definition={definition} />;
  };
}

export const NebulaBackground = createEffectComponent(EFFECTS.julianVanceNebula);
