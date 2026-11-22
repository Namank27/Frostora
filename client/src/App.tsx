import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getProfileName, setProfileName, type ApiResponse } from "./api";
import {
  getNativeVolume,
  isNativeApp,
  onNativePlaybackAction,
  setNativePlaying,
  setNativeVolume,
  startBackgroundAudio,
  startNativeVoiceSearch,
  updateNativeMetadata,
  watchNativeVolume,
} from "./nativeAudio";
import { FIELDS } from "./fields";
import LiquidGlassHeroDemo from "./components/liquid-glass-hero-demo";
import TextGenerateEffectDemo from "./components/text-generate-effect-demo";
import DemoOne from "./components/demo";
import { ShinyButton } from "./components/ui/shiny-button";
import { LiquidMetalButton } from "./shaders/liquid-metal-button/LiquidMetalButton";
import frostoraIcon from "./assets/frostora-icon.webp";

type Track = ApiResponse<typeof api, "searchMusic">["results"][number];

/* ---------------- YouTube IFrame player plumbing ---------------- */

interface YTPlayer {
  // The IFrame API accepts either a bare video ID or an object
  // with startSeconds — the object form is how the official-video
  // swap keeps the playback position instead of restarting.
  loadVideoById: (arg: string | { videoId: string; startSeconds?: number }) => void;
  cueVideoById: (arg: string | { videoId: string; startSeconds?: number }) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (sec: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  // 1 = playing, 2 = paused, 3 = buffering, 0 = ended (YT.PlayerState).
  getPlayerState: () => number;
  setVolume: (v: number) => void;
  getVolume: () => number;
  destroy: () => void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId?: string;
      host?: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: () => void;
        onStateChange: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}

function ytWindow(): { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void } {
  return window as unknown as { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };
}

let ytApiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const w = ytWindow();
    if (w.YT?.Player) {
      resolve(w.YT);
      return;
    }
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (w.YT) resolve(w.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    // If the API script itself is refused (Edge tracking prevention /
    // a blocker), fail loudly instead of leaving every tap dead: the
    // caller retries, and a later tap can succeed once it loads.
    script.onerror = () => {
      ytApiPromise = null;
      script.remove();
      reject(new Error("YouTube player API could not be loaded"));
    };
    document.head.appendChild(script);
    // Safety net: if the API never signals readiness, reset so the
    // next attempt re-injects the script instead of waiting forever.
    window.setTimeout(() => {
      if (!w.YT?.Player) ytApiPromise = null;
    }, 10000);
  });
  return ytApiPromise;
}

/* ---------------- Icons (inline SVG, stroke silver) ---------------- */

function Icon({ d, size = 20, filled = false }: { d: string; size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const P = {
  play: "M8 5.5v13l11-6.5z",
  next: "M6 5.5v13l8.5-6.5zM18 5v14",
  prev: "M18 5.5v13L9.5 12zM6 5v14",
  shuffle:
    "M16 3.5h4.5V8M4 20L20 3.5M20 16.5v4H15.5M14.5 14.5L20 20M4 4l5 5",
  repeat: "M17 2.5l3.5 3.5L17 9.5M20.5 6H8a4.5 4.5 0 0 0-4.5 4.5V11M7 21.5L3.5 18 7 14.5M3.5 18H16a4.5 4.5 0 0 0 4.5-4.5V13",
  repeatOne:
    "M17 2.5l3.5 3.5L17 9.5M20.5 6H8a4.5 4.5 0 0 0-4.5 4.5V11M7 21.5L3.5 18 7 14.5M3.5 18H16a4.5 4.5 0 0 0 4.5-4.5V13M10.5 14.5v-4l-1.8 1.2",
  heart:
    "M12 20.5C7 16.5 3.5 13.3 3.5 9.6 3.5 7 5.5 5 8 5c1.7 0 3.2.9 4 2.3C12.8 5.9 14.3 5 16 5c2.5 0 4.5 2 4.5 4.6 0 3.7-3.5 6.9-8.5 10.9z",
  search: "M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-3.8-3.8",
  list: "M8.5 6h12M8.5 12h12M8.5 18h12M4 6h.01M4 12h.01M4 18h.01",
  x: "M6 6l12 12M18 6L6 18",
  back: "M14.5 5.5L8 12l6.5 6.5",
  chevronUp: "M5.5 14.5L12 8l6.5 6.5",
  chevronDown: "M5.5 9.5L12 16l6.5-6.5",
  video: "M3.5 7.5A1.5 1.5 0 0 1 5 6h9a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 14 18H5a1.5 1.5 0 0 1-1.5-1.5zM15.5 10.5l5-3v9l-5-3",
  volume: "M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9.5a4 4 0 0 1 0 5M18 7a7.5 7.5 0 0 1 0 10",
  lyrics: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7",
  download: "M12 4v10.5M7.6 10.8L12 15.2l4.4-4.4M4.5 19.5h15",
  dots: "M12 12h.01M5.5 12h.01M18.5 12h.01",
  dotsV: "M12 5.5h.01M12 12h.01M12 18.5h.01",
  share: "M12 14.5v-10M8.6 7.4L12 4l3.4 3.4M5.5 11.5v7A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5v-7",
  clock: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3.2 2",
  info: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 11.2V16M12 7.9h.01",
  comment:
    "M20 11.6a8 8 0 0 1-8 8c-1.2 0-2.4-.27-3.4-.75L4 20l1.15-4.1A8 8 0 1 1 20 11.6z",
  expand:
    "M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M20 9V5.5A1.5 1.5 0 0 0 18.5 4H15M4 15v3.5A1.5 1.5 0 0 0 5.5 20H9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15",
  image: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 16l4.5-4.5 3 3L16 10l4 4M9 9h.01",
  home: "M4.5 11L12 4.5 19.5 11M6.5 9.5V19a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9.5",
  library: "M9 18.3V6.2L19 4.2v11.6M9 18.3a2.8 2.8 0 1 1-2-2.5M19 15.8a2.8 2.8 0 1 1-2-2.5M4.5 4.5v15",
  person: "M12 11a3.75 3.75 0 1 0 0-7.5A3.75 3.75 0 0 0 12 11zM5.5 19.5c1.1-3 3.6-4.4 6.5-4.4s5.4 1.4 6.5 4.4",
  gear: "M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6zM12 3.5v2.4M12 18.1v2.4M3.5 12h2.4M18.1 12h2.4M6 6l1.7 1.7M16.3 16.3L18 18M18 6l-1.7 1.7M7.7 16.3L6 18",
  history: "M4.6 12a7.4 7.4 0 1 1 2.1 5.2M4.6 12H3m1.6 0L6.3 10.4M12 8.2V12l2.8 1.7",
  refresh: "M20.5 12a8.5 8.5 0 1 1-2.5-5.9M20.5 3.2v4.2h-4.2",
  trending: "M4 16.5L9.5 10l3.5 3L19.5 6.5M15 6.5h4.5V11",
  cast: "M4 17.2A6.8 6.8 0 0 1 10.8 20.5M4 13.6a11.4 11.4 0 0 1 9.9 6.9M4 20.3h.01M6.5 5h11A1.5 1.5 0 0 1 19 6.5v8a1.5 1.5 0 0 1-1.5 1.5H14",
  speakerLow: "M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z",
  note: "M9 18.3V6.2L19 4.2v11.6M9 18.3a2.8 2.8 0 1 1-2-2.5M19 15.8a2.8 2.8 0 1 1-2-2.5",
  grid: "M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z",
  archive: "M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v8A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5zM4 8.5L6.6 4h10.8L20 8.5M10 12.5h4",
  plus: "M12 5.5v13M5.5 12h13",
  chevronRight: "M9.5 5.5L16 12l-6.5 6.5",
  sparkle: "M12 4l1.9 5.3L19.2 11l-5.3 1.9L12 18.2l-1.9-5.3L4.8 11l5.3-1.7z",
  radio: "M4.5 10.5a10 10 0 0 1 15 0M6.8 13.4a6.4 6.4 0 0 1 10.4 0M12 17.2h.01M12 12.5L19 5",
  micStand: "M12 3.5a2.6 2.6 0 0 1 2.6 2.6v4.3a2.6 2.6 0 0 1-5.2 0V6.1A2.6 2.6 0 0 1 12 3.5zM6.5 10.5a5.5 5.5 0 0 0 11 0M12 16v4.5M9 20.5h6",
  mail: "M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM4.5 7l7.5 6 7.5-6",
  arrowRight: "M4 12h15M13.5 5.5L20 12l-6.5 6.5",
  check: "M5 12.5l4.5 4.5L19 7.5",
};

/* Distinctive white starburst play/pause button, like the reference
   player's scalloped white control. Pure SVG + transform — no blur,
   no filters, so it stays cheap on the phone. */
function BurstButton({
  playing,
  onClick,
  label,
  size = 72,
}: {
  playing: boolean;
  onClick: () => void;
  label: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="relative flex flex-none items-center justify-center text-[#17171a] transition-transform duration-150 active:scale-[0.92]"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]"
        aria-hidden="true"
      >
        <path
          fill="#f4f4f6"
          d="M50 1.5 57.5 10 68 4.8 72.3 15.6 83.7 13.4 84.9 25 95.6 26.4 93.2 37.5 101 44.5 94.8 52.8 99.5 61.5 90.4 66.6 91.9 77.8 81.2 79.6 79.3 90.7 68.4 89.2 63.6 99.2 54.4 93.6 46.8 100 41.9 91.4 31.4 94.8 27.8 84.6 17.2 86.4 14.8 75.4 5.6 76.6 6.6 65.2 1.5 66.5Z"
          transform="scale(0.96) translate(2 2)"
        />
      </svg>
      <span className="relative">
        {playing ? <PauseIcon size={Math.round(size * 0.34)} /> : <Icon d={P.play} size={Math.round(size * 0.34)} filled />}
      </span>
    </button>
  );
}

function PauseIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6.5" y="5" width="4" height="14" rx="1" />
      <rect x="13.5" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

/* The player's centre transport: the ThreeUI LiquidMetalButton
   (Play Circle variant, exact authored source vendored under
   client/src/shaders/liquid-metal-button/) at 88px with the 8px
   liquid-metal stroke — the travelling rim light, press ripples and
   bloom are the authored WebGL animation. Per the user's theme
   override it is NOT the authored black finish: the component's
   play adapter restyles the plate to the app's frosted white /
   light-grey glass with a charcoal glyph and retunes the metal to
   silver-white, and if WebGL doesn't prove itself within the
   component's health handshake the frosted-white .frosted-play-btn
   takes over at the same size. The glyph follows playback state —
   pause bars while playing, play triangle while paused — via the
   button's label. The layout box stays exactly the 88px circle;
   the centred host is the play adapter's own 118px box (diameter
   + 30), which fits inside the transport row's gaps so it never
   overlaps the prev / next hit areas. */
function MetalPlayButton({
  playing,
  onClick,
  diameter = 88,
}: {
  playing: boolean;
  onClick: () => void;
  diameter?: number;
}) {
  const host = diameter + 30;
  return (
    <span
      className="relative flex flex-none items-center justify-center"
      style={{ width: diameter, height: diameter }}
    >
      <span
        className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2"
        style={{ width: host, height: host }}
      >
        <LiquidMetalButton
          variant="play"
          rendering="colored"
          diameter={diameter}
          strokeWidth={8.0}
          text={playing ? "Pause" : "Play"}
          onClick={onClick}
          className="liquid-metal-host-fade h-full w-full"
        />
      </span>
    </span>
  );
}

/* Playful volume slider (from the user's reference video): a
   thick dark pill track with tick marks and a white pill thumb; a
   small circular avatar — the playing song's cover art — floats
   above the thumb. The motion is the video's, driven by
   under-damped springs in a rAF loop that writes ONLY transform /
   opacity straight to the DOM (no React re-renders per frame):
   - a position spring chases the volume value, so the avatar,
     thumb and fill glide and settle with a slight overshoot
     instead of snapping to every input event;
   - a pop spring fires when a drag / focus starts: the avatar
     springs up above the thumb with a bounce, bobs and tilts
     with the drag velocity while it moves, then drops back down
     and fades out on release;
   - a stretch spring reads the position spring's velocity: slid
     quickly, the thumb, avatar and fill elongate elastically in
     the direction of travel (squash-and-stretch — longer and
     thinner the faster the drag) and spring back to round as the
     drag slows or stops;
   - a max flicker fires the moment the value reaches 100%: for
     about half a second the thumb and avatar jitter sideways and
     a pale flash layer strobes over the blue fill, like the
     slider is overloaded at max, then everything settles while
     the fill stays blue at full.
   The level label under the slider crossfades + pops (CSS
   keyframes, re-keyed per label) when it changes between Low /
   Medium / High / Extra high, and at the top end the fill
   crossfades to blue. It is the SAME volume control as before —
   a native range input layered invisibly over the custom track,
   so touch, keyboard and aria behaviour are unchanged. */
function PlayfulVolume({
  value,
  onChange,
  avatarSrc,
}: {
  value: number;
  onChange: (v: number) => void;
  avatarSrc: string;
}) {
  const [active, setActive] = useState(false);
  const label = value >= 80 ? "Extra high" : value >= 55 ? "High" : value >= 25 ? "Medium" : "Low";
  const hot = value >= 80;

  const wrapRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const fillWhiteRef = useRef<HTMLDivElement>(null);
  const fillBlueRef = useRef<HTMLDivElement>(null);
  const fillFlashRef = useRef<HTMLDivElement>(null);
  // Spring state: position (fraction 0..1 + velocity), pop
  // (0 hidden .. 1 fully up + velocity) and stretch (elastic
  // elongation, driven by the position velocity). Kept in refs
  // so the rAF loop never re-renders React.
  const springRef = useRef({ x: value / 100, v: 0, pop: 0, popV: 0, stretch: 0, stretchV: 0 });
  const targetRef = useRef(value / 100);
  targetRef.current = value / 100;
  const activeRef = useRef(false);
  activeRef.current = active;
  const rafRef = useRef(0);
  // Max-flicker state: `start` is the timestamp of the current
  // flicker burst (0 = none); `seen`/`wasMax` make the burst fire
  // only on the transition INTO 100%, never on mount at 100%.
  const flickerRef = useRef({ start: 0, wasMax: false, seen: false });

  // Release outside the input (pointer slid off before pointerup)
  // must still drop the avatar.
  useEffect(() => {
    if (!active) return;
    const up = () => setActive(false);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [active]);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let last = performance.now();
    const step = (now: number) => {
      const s = springRef.current;
      const dt = Math.min(0.032, Math.max(0.001, (now - last) / 1000));
      last = now;
      if (reduced) {
        s.x = targetRef.current;
        s.v = 0;
        s.pop = activeRef.current ? 1 : 0;
        s.popV = 0;
        s.stretch = 0;
        s.stretchV = 0;
      } else {
        // Position spring: stiff, lightly under-damped — follows
        // the thumb smoothly and settles with a hint of overshoot.
        const acc = (targetRef.current - s.x) * 340 - s.v * 24;
        s.v += acc * dt;
        s.x += s.v * dt;
        // Pop spring: softer + more under-damped so the avatar
        // visibly bounces up on grab and drops away on release.
        const popAcc = ((activeRef.current ? 1 : 0) - s.pop) * 260 - s.popV * 15;
        s.popV += popAcc * dt;
        s.pop += s.popV * dt;
        // Stretch spring: chases a target proportional to the
        // position velocity, so a fast slide stretches the thumb /
        // avatar / fill elastically along the direction of travel
        // and the spring pulls them back to round as it slows.
        const stretchTarget = Math.max(-0.5, Math.min(0.5, s.v * 0.15));
        const stretchAcc = (stretchTarget - s.stretch) * 300 - s.stretchV * 19;
        s.stretchV += stretchAcc * dt;
        s.stretch += s.stretchV * dt;
      }
      // Max flicker: one ~550ms burst on the transition INTO
      // 100% — the envelope decays linearly while two detuned
      // sine waves strobe the flash layer and jitter the thumb /
      // avatar sideways; then it settles, still blue at max.
      const fl = flickerRef.current;
      const atMax = targetRef.current >= 0.999;
      if (!fl.seen) {
        fl.seen = true;
        fl.wasMax = atMax;
      } else if (atMax && !fl.wasMax && !reduced) {
        fl.start = now;
      }
      fl.wasMax = atMax;
      let flick = 0;
      if (fl.start > 0) {
        const age = (now - fl.start) / 550;
        if (age >= 1 || !atMax) {
          fl.start = 0;
        } else {
          flick = 1 - age;
        }
      }
      const jitter =
        flick > 0 ? flick * (Math.sin(now / 11) * 1.7 + Math.sin(now / 23 + 1.3) * 1.1) : 0;
      const flashWave = 0.5 + 0.5 * Math.sin(now / 7.3) * Math.sin(now / 12.9);
      const wrap = wrapRef.current;
      const avatar = avatarRef.current;
      const thumb = thumbRef.current;
      if (wrap && avatar && thumb) {
        const w = wrap.clientWidth;
        const frac = Math.max(0, Math.min(1, s.x));
        // Thumb centre travels inside the track's ends so neither
        // it nor the avatar ever hangs off the pill at 0% / 100%.
        const thumbX = 6 + Math.max(0, w - 12) * frac;
        const avatarX = 18 + Math.max(0, w - 36) * frac;
        const pop = Math.max(0, s.pop);
        const popScale = 1 + 0.28 * Math.min(1, pop);
        const stretch = reduced ? 0 : s.stretch;
        const sx = 1 + stretch;
        const sy = 1 - stretch * 0.38;
        // Tilt leans into the drag direction/speed; the bob is a
        // gentle float while held plus a lift proportional to
        // speed, so fast drags make the avatar ride up a little.
        const tilt = Math.max(-14, Math.min(14, s.v * 16));
        const bob = activeRef.current && !reduced ? Math.sin(now / 110) * 1.6 - Math.min(5, Math.abs(s.v) * 6) : 0;
        const drop = (1 - Math.min(1, pop)) * 16;
        const avatarBase = 0.55 + 0.6 * pop;
        avatar.style.opacity = String(Math.max(0, Math.min(1, pop)));
        avatar.style.transform = `translate3d(${avatarX - 18 + jitter}px, ${drop + bob}px, 0) rotate(${tilt}deg) scale(${avatarBase * sx}, ${avatarBase * sy})`;
        thumb.style.transform = `translate3d(${thumbX + jitter}px, -50%, 0) translateX(-50%) scale(${popScale * sx}, ${popScale * sy})`;
        // The fill's leading edge stretches with the drag too:
        // it reaches ahead on a fast push and lags on a fast pull.
        const fillFrac = Math.max(0, Math.min(1, frac * (1 + stretch * 0.45)));
        const fill = `scaleX(${fillFrac})`;
        if (fillWhiteRef.current) fillWhiteRef.current.style.transform = fill;
        if (fillBlueRef.current) fillBlueRef.current.style.transform = fill;
        if (fillFlashRef.current) {
          fillFlashRef.current.style.transform = fill;
          fillFlashRef.current.style.opacity = String(flick > 0 ? flick * (0.15 + 0.6 * flashWave) : 0);
        }
      }
      const settled =
        Math.abs(targetRef.current - s.x) < 0.0005 &&
        Math.abs(s.v) < 0.002 &&
        Math.abs((activeRef.current ? 1 : 0) - s.pop) < 0.002 &&
        Math.abs(s.popV) < 0.01 &&
        Math.abs(s.stretch) < 0.004 &&
        Math.abs(s.stretchV) < 0.02 &&
        flick <= 0;
      // Keep looping while held (for the bob), while a max
      // flicker is bursting, or until the springs settle; then
      // stop so an idle slider costs nothing.
      if (!settled || activeRef.current) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = 0;
      }
    };
    if (!rafRef.current) {
      // Run one step synchronously so the avatar / thumb / fill
      // are positioned before the next paint; the step schedules
      // its own follow-up frames while the springs are unsettled.
      last = performance.now();
      step(last);
    }
  }, [value, active]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    },
    [],
  );

  return (
    <div className="min-w-0 flex-1">
      <div className="relative pt-[38px]" ref={wrapRef}>
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={() => setActive(true)}
          onPointerUp={() => setActive(false)}
          onPointerCancel={() => setActive(false)}
          onFocus={() => setActive(true)}
          onBlur={() => setActive(false)}
          aria-label="Volume"
          className="peer absolute inset-x-0 bottom-0 z-10 h-[26px] w-full cursor-pointer opacity-0"
        />
        <div
          ref={avatarRef}
          aria-hidden="true"
          className="vol-avatar pointer-events-none absolute left-0 top-0 z-20 h-9 w-9"
          style={{ opacity: 0 }}
        >
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt=""
              draggable={false}
              decoding="async"
              className="h-full w-full rounded-full border-2 border-white/85 object-cover shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
            />
          ) : (
            <svg viewBox="0 0 36 36" className="h-full w-full rounded-full border-2 border-white/85 shadow-[0_4px_12px_rgba(0,0,0,0.45)]" role="img" aria-label="Volume avatar">
              <circle cx="18" cy="18" r="18" fill="#3a3a41" />
              <circle cx="13" cy="15" r="1.8" fill="#f4f4f6" />
              <circle cx="23" cy="15" r="1.8" fill="#f4f4f6" />
              <path d="M12.5 21.5c1.6 2 3.4 3 5.5 3s3.9-1 5.5-3" stroke="#f4f4f6" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            </svg>
          )}
        </div>
        <div
          aria-hidden="true"
          className="relative h-[26px] overflow-hidden rounded-full border border-white/10 bg-[#17171a]/85 shadow-[inset_0_1px_3px_rgba(0,0,0,0.55)] peer-focus-visible:ring-2 peer-focus-visible:ring-white/60"
        >
          <div
            ref={fillWhiteRef}
            className="absolute inset-0 origin-left bg-white/90"
            style={{ opacity: hot ? 0 : 1, transition: "opacity 220ms ease-out" }}
          />
          <div
            ref={fillBlueRef}
            className="absolute inset-0 origin-left"
            style={{
              opacity: hot ? 1 : 0,
              transition: "opacity 220ms ease-out",
              background: "linear-gradient(90deg, #2b6bff, #35b6ff)",
            }}
          />
          {/* Max-flicker flash layer: a pale strobe over the blue
              fill, opacity driven by the rAF loop only while the
              flicker burst runs at 100% (0 the rest of the time,
              and no CSS transition — the loop IS the flicker). */}
          <div
            ref={fillFlashRef}
            className="absolute inset-0 origin-left"
            style={{
              opacity: 0,
              background: "linear-gradient(90deg, rgba(190,220,255,0.95), rgba(235,247,255,0.95))",
            }}
          />
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((t) => (
            <span
              key={t}
              className="absolute top-1/2 h-[10px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8e8e96]/70"
              style={{ left: `${t}%` }}
            />
          ))}
          <div
            ref={thumbRef}
            className="absolute left-0 top-1/2 h-[18px] w-[12px] rounded-full bg-white shadow-[0_1px_5px_rgba(0,0,0,0.45)]"
          />
        </div>
      </div>
      <p className="mt-1.5 text-center text-[12px] text-white/75" aria-hidden="true">
        <span key={label} className="vol-label inline-block">
          {label}
        </span>
      </p>
    </div>
  );
}

/* Animated now-playing indicator (Liquid Glass pass): three bars
   in a gentle equaliser bounce, painted by the .eq-bar keyframes
   in theme.css — transform-only, and frozen under reduced motion.
   Shown on the current row's artwork while the song is playing,
   in place of the static pause glyph. */
function EqBars() {
  return (
    <span className="flex items-end gap-[2.5px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className="eq-bar" style={{ animationDelay: `${i * 180}ms` }} />
      ))}
    </span>
  );
}

/* About-page Feedback pill: a frosted pill that morphs into a
   text input and sends the note straight from the browser to
   Web3Forms (it emails the note to the creator). 22 Nov: the
   server-side send was blocked by Web3Forms on the free plan —
   server calls get 403 "This method is not allowed", so the pill
   now posts client-side, which is Web3Forms' own documented
   pattern. The key comes from import.meta.env.VITE_WEB3FORMS_ACCESS_KEY
   (set in Vercel, Production); Web3Forms keys are public by design
   — they identify the inbox, they don't authenticate anyone — so
   shipping it in the bundle is how Web3Forms is meant to be used.
   No email is asked of the person writing; the message is all
   that is sent. States: pill → input (a spinner rides the arrow
   button while sending) → "Thanks for your thoughts!" → back to
   the pill after 3 seconds. A failed send keeps the typed text
   and shows a short retry line under the pill. The morph itself
   is the .feedback-morph width/height transition in theme.css. */
function FeedbackPill() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    if (open && !sent) inputRef.current?.focus();
  }, [open, sent]);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const submit = async () => {
    const message = text.trim();
    if (!message || sending || sent) return;
    setSending(true);
    setFailed(false);
    try {
      const key = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY as string | undefined;
      if (!key) throw new Error("Feedback is not configured yet");
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: key,
          subject: "New Frostora Feedback",
          message,
          botcheck: "",
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      const ok =
        res.ok &&
        typeof data === "object" &&
        data !== null &&
        (data as { success?: unknown }).success === true;
      if (!ok) throw new Error("Feedback send failed");
      setSent(true);
      resetTimer.current = window.setTimeout(() => {
        setSent(false);
        setOpen(false);
        setText("");
      }, 3000);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex w-full flex-col items-center">
      <div
        className="glass feedback-morph overflow-hidden rounded-full"
        style={{ width: sent ? 292 : open ? "100%" : 158, maxWidth: 480, height: open && !sent ? 56 : 48 }}
      >
        {sent ? (
          <p
            key="sent"
            className="feedback-in flex h-full items-center justify-center gap-2 px-5 text-[14px] font-medium whitespace-nowrap text-white"
            role="status"
          >
            <Icon d={P.check} size={17} />
            Thanks for your thoughts!
          </p>
        ) : open ? (
          <form
            key="form"
            className="feedback-in flex h-full items-center gap-2 pr-1.5 pl-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (failed) setFailed(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !sending) {
                  setOpen(false);
                  setFailed(false);
                }
              }}
              placeholder="Write your thoughts..."
              aria-label="Write your feedback"
              {...FIELDS.submitFeedback.message}
              disabled={sending}
              className="min-w-0 flex-1 bg-transparent text-[14.5px] text-white outline-none placeholder:text-white/40 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={sending || !text.trim()}
              aria-label="Send feedback"
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-white text-[#101013] shadow-[0_6px_16px_rgba(0,0,0,0.35)] transition-transform duration-150 active:scale-[0.94] disabled:opacity-40"
            >
              {sending ? (
                <span
                  className="block h-[18px] w-[18px] animate-spin rounded-full border-2 border-[#101013]/25 border-t-[#101013]"
                  aria-hidden="true"
                />
              ) : (
                <Icon d={P.arrowRight} size={19} />
              )}
            </button>
          </form>
        ) : (
          <button
            key="pill"
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Send feedback"
            className="feedback-in flex h-full w-full items-center justify-center gap-2 px-5 text-[14.5px] font-medium whitespace-nowrap text-white transition-transform duration-150 active:scale-[0.97]"
          >
            <Icon d={P.mail} size={18} />
            Feedback
          </button>
        )}
      </div>
      {failed && open && !sent && (
        <p className="mt-3 text-center text-[13px] text-[#ffb4ab]" role="alert">
          Couldn&rsquo;t send that — check your connection and tap the arrow to try again.
        </p>
      )}
    </div>
  );
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// "3:01" / "1:02:33" -> seconds (0 when unparseable). Used for the
// collection page's total-duration pill.
function parseDur(d: string): number {
  const parts = d.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j] as T;
    a[j] = tmp as T;
  }
  return a;
}

// Stable per-entry keys for the queue list: a song's key follows
// the SONG (plus an occurrence number for duplicate copies), not
// its slot, so reordering the queue (real-time shuffle) moves the
// existing rows instead of remounting them — which is also what
// lets the FLIP animation in the queue panel track each row from
// its old position to its new one.
function queueKeysFor(list: Track[]): string[] {
  const seen = new Map<string, number>();
  return list.map((t) => {
    const n = seen.get(t.videoId) ?? 0;
    seen.set(t.videoId, n + 1);
    return `${t.videoId}#${n}`;
  });
}

// Rows render thumbnails at 48px — ask the CDN for a small render
// instead of decoding the full-size image on the phone.
function smallThumb(url: string): string {
  if (url.includes("googleusercontent.com")) return url.replace(/=w\d+-h\d+/, "=w120-h120");
  if (url.includes("i.ytimg.com")) return url.replace("hqdefault", "mqdefault");
  return url;
}

// Mid-size tiles (album/playlist cards, artist grids): same
// no-letterbox rule as smallThumb for video thumbnails — mqdefault
// is the true 16:9 frame with no baked black bars, and object-fit:
// cover centre-crops it into the square tile. googleusercontent
// album art is capped at 320px: the tiles render at ~150–230px, so
// the full 540px render was pure decode cost with no visible gain.
function fillThumb(url: string): string {
  if (url.includes("googleusercontent.com")) return url.replace(/=w\d+-h\d+/, "=w320-h320");
  if (url.includes("i.ytimg.com")) return url.replace("hqdefault", "mqdefault");
  return url;
}

// Large cover art (Now Playing, desktop panel, lyrics split view,
// collection header): always rendered with object-fit: cover so the
// poster FILLS its square card — centred crop, no letterbox bars,
// no stretching. YouTube video thumbnails need one extra step:
// i.ytimg "hqdefault" is a 4:3 frame with the 16:9 picture
// letterboxed inside it (black bars baked into the file), so even
// object-fit: cover would keep thin baked bars. Its "hq720"
// variant is the true 16:9 frame with no baked bars — verified
// live that it serves 1280x720 for most videos but 404s for some,
// so a failed load falls back to the track's own thumbnail.
function LargeArt({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const upgraded =
    src.includes("i.ytimg.com") && src.includes("hqdefault")
      ? src.replace("hqdefault", "hq720")
      : src;
  const [cur, setCur] = useState(upgraded);
  useEffect(() => {
    setCur(upgraded);
  }, [upgraded]);
  return (
    <img
      src={cur}
      alt={alt}
      decoding="async"
      onError={() => {
        if (cur !== src) setCur(src);
      }}
      className={className}
    />
  );
}

/* ---------- Liquid morph poster (reference video, 21 Nov) ----------
   The exact transition from the user's video: a square poster
   card whose old image MELTS — heavy wavy turbulence warp — while
   a liquid wave front sweeps across it (bottom→top for Next /
   forward, top→bottom for Previous / backward), the new image
   revealed behind the front, still slightly warped, with small
   refracted droplets riding the front, then everything settles
   clean. Built from two stacked <img> layers: the outgoing layer
   is clipped by a per-frame wavy polygon (clip-path) and both
   layers run through SVG feTurbulence + feDisplacementMap
   filters whose scale is animated on the same rAF clock — the
   outgoing melt starts at full strength (like the video, where
   the old poster is already liquified in the first frame) and
   decays to zero as the wipe completes. Transform / clip /
   filter only, ~950ms, and prefers-reduced-motion swaps the
   poster instantly with no layers at all. Used for Next /
   Previous track changes AND for Video ⇄ Song mode switches
   (song artwork ⇄ official-video poster) in the Now Playing
   card, and for track changes in the desktop panel. */
function upgradeArtSrc(src: string): string {
  return src.includes("i.ytimg.com") && src.includes("hqdefault")
    ? src.replace("hqdefault", "hq720")
    : src;
}

const LIQUID_DROPS: { x: number; r: number; off: number }[] = [
  { x: 16, r: 15, off: 4.2 },
  { x: 36, r: 10, off: 6.6 },
  { x: 55, r: 19, off: 3.4 },
  { x: 73, r: 11, off: 5.8 },
  { x: 89, r: 14, off: 4.6 },
];

function LiquidArt({
  src,
  visualKey,
  dirRef,
  alt,
  playing,
  roundedClass = "rounded-[16px]",
}: {
  src: string;
  visualKey: string;
  dirRef: { current: 1 | -1 };
  alt: string;
  playing: boolean;
  roundedClass?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const fOut = `liqo${uid}`;
  const fIn = `liqi${uid}`;
  const stageRef = useRef<HTMLDivElement>(null);
  const outWrapRef = useRef<HTMLDivElement>(null);
  const outImgRef = useRef<HTMLImageElement>(null);
  const inImgRef = useRef<HTMLImageElement>(null);
  const dispOutRef = useRef<SVGFEDisplacementMapElement>(null);
  const dispInRef = useRef<SVGFEDisplacementMapElement>(null);
  const dropRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [bad, setBad] = useState<ReadonlySet<string>>(new Set());
  const display = useCallback(
    (raw: string) => (bad.has(raw) ? raw : upgradeArtSrc(raw)),
    [bad],
  );
  const [settled, setSettled] = useState(src);
  const [trans, setTrans] = useState<{ from: string; to: string; dir: 1 | -1 } | null>(null);
  const settledRef = useRef(src);
  const transRef = useRef<typeof trans>(null);
  transRef.current = trans;
  const keyRef = useRef(visualKey);

  // Start a morph whenever the visual identity changes (new song,
  // or song ⇄ video poster). A src-only change counts too: the
  // official-video poster URL resolves a beat after a mode flip
  // that happened while this card was hidden behind the video.
  useEffect(() => {
    const keyChanged = keyRef.current !== visualKey;
    const shown = transRef.current?.to ?? settledRef.current;
    if (!keyChanged && shown === src) return;
    keyRef.current = visualKey;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || shown === src) {
      settledRef.current = src;
      setSettled(src);
      setTrans(null);
      return;
    }
    const pre = new Image();
    pre.src = display(src);
    setTrans({ from: shown, to: src, dir: dirRef.current });
  }, [visualKey, src, dirRef, display]);

  // The morph clock: one rAF loop drives the wavy clip wipe, both
  // displacement scales, the layer scales, the card's subtle
  // pulse and the droplets — all in lockstep, like the video.
  useEffect(() => {
    if (!trans) return;
    let raf = 0;
    const dur = 950;
    const t0 = performance.now();
    const dir = trans.dir;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 0.5 - 0.5 * Math.cos(Math.PI * p);
      const stage = stageRef.current;
      const W = stage?.clientWidth ?? 0;
      const edge = dir === 1 ? (1 - e) * 100 : e * 100;
      const amp = 6.5 * Math.sin(Math.PI * Math.min(1, p * 1.04));
      const phase = p * 7 * dir;
      const waveY = (x: number) => edge + Math.sin(x * 0.11 + phase) * amp;
      const outWrap = outWrapRef.current;
      if (outWrap) {
        const xs: number[] = [];
        for (let x = 0; x <= 100; x += 10) xs.push(x);
        if (dir === 1) {
          const pts = xs
            .slice()
            .reverse()
            .map((x) => `${x}% ${waveY(x).toFixed(2)}%`)
            .join(", ");
          outWrap.style.clipPath = `polygon(0% 0%, 100% 0%, ${pts})`;
        } else {
          const pts = xs.map((x) => `${x}% ${waveY(x).toFixed(2)}%`).join(", ");
          outWrap.style.clipPath = `polygon(${pts}, 100% 100%, 0% 100%)`;
        }
      }
      const melt = Math.pow(1 - p, 1.35);
      dispOutRef.current?.setAttribute("scale", String(6 + 64 * melt));
      dispInRef.current?.setAttribute("scale", String(30 * Math.pow(1 - p, 2)));
      if (outImgRef.current) outImgRef.current.style.transform = `scale(${1 + 0.05 * p})`;
      if (inImgRef.current) inImgRef.current.style.transform = `scale(${1.07 - 0.07 * e})`;
      if (stage) stage.style.transform = `scale(${1 + 0.012 * Math.sin(Math.PI * p)})`;
      const appear = Math.sin(Math.PI * Math.min(1, p * 1.08));
      LIQUID_DROPS.forEach((d, i) => {
        const el = dropRefs.current[i];
        if (!el || !W) return;
        const cxPx = (d.x / 100) * W;
        const cyPx = ((waveY(d.x) + (dir === 1 ? d.off : -d.off)) / 100) * W;
        const size = Math.max(0, d.r * (W / 380)) * appear;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.left = `${cxPx - size / 2}px`;
        el.style.top = `${cyPx - size / 2}px`;
        el.style.opacity = String(Math.min(1, appear * 1.4));
        el.style.backgroundSize = `${W}px ${W}px`;
        el.style.backgroundPosition = `${-(cxPx - size / 2)}px ${-(cyPx - size / 2)}px`;
      });
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        settledRef.current = trans.to;
        setSettled(trans.to);
        setTrans(null);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trans]);

  const shown = trans ? trans.to : settled;
  return (
    <div className={`living-art ${playing ? "is-playing" : "is-paused"} aspect-square w-full`}>
      <div
        ref={stageRef}
        className={`relative h-full w-full overflow-hidden border border-white/15 bg-black/30 ${roundedClass}`}
        style={{ willChange: "transform" }}
      >
        <svg aria-hidden="true" className="pointer-events-none absolute h-0 w-0">
          <defs>
            <filter id={fOut} x="-8%" y="-8%" width="116%" height="116%">
              <feTurbulence type="fractalNoise" baseFrequency="0.012 0.032" numOctaves="2" seed="7" result="n" />
              <feDisplacementMap ref={dispOutRef} in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <filter id={fIn} x="-8%" y="-8%" width="116%" height="116%">
              <feTurbulence type="fractalNoise" baseFrequency="0.012 0.032" numOctaves="2" seed="19" result="n" />
              <feDisplacementMap ref={dispInRef} in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>
        <img
          ref={inImgRef}
          src={display(shown)}
          alt={alt}
          decoding="async"
          draggable={false}
          onError={() => {
            if (!bad.has(shown)) setBad((prev) => new Set(prev).add(shown));
          }}
          className="absolute inset-0 h-full w-full object-cover object-center"
          style={trans ? { filter: `url(#${fIn})` } : undefined}
        />
        {trans && (
          <div ref={outWrapRef} className="absolute inset-0" aria-hidden="true">
            <img
              ref={outImgRef}
              src={display(trans.from)}
              alt=""
              decoding="async"
              draggable={false}
              onError={() => {
                if (!bad.has(trans.from)) setBad((prev) => new Set(prev).add(trans.from));
              }}
              className="h-full w-full object-cover object-center"
              style={{ filter: `url(#${fOut})` }}
            />
          </div>
        )}
        {trans &&
          LIQUID_DROPS.map((d, i) => (
            <div
              key={d.x}
              ref={(el) => {
                dropRefs.current[i] = el;
              }}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-full"
              style={{
                backgroundImage: `url("${display(trans.to)}")`,
                opacity: 0,
                boxShadow:
                  "inset 0 0 6px rgba(255,255,255,0.25), 0 2px 8px rgba(0,0,0,0.35)",
              }}
            />
          ))}
      </div>
    </div>
  );
}

/* Title + artist under the morphing poster: on a track change the
   old lines slide out and the new ones slide in, in the direction
   of the switch (CSS classes in theme.css). Mode switches keep
   the same title, so nothing moves there — exactly like the
   reference video, where only the poster and its caption change
   together on a song switch. */
function SlidingTitle({
  title,
  artist,
  dirRef,
}: {
  title: string;
  artist: string;
  dirRef: { current: 1 | -1 };
}) {
  const [cur, setCur] = useState({ title, artist });
  const [prev, setPrev] = useState<{ title: string; artist: string; dir: 1 | -1 } | null>(null);
  const curRef = useRef(cur);
  useEffect(() => {
    if (curRef.current.title === title && curRef.current.artist === artist) return;
    const old = curRef.current;
    const next = { title, artist };
    curRef.current = next;
    setCur(next);
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setPrev(null);
      return;
    }
    setPrev({ ...old, dir: dirRef.current });
    const t = window.setTimeout(() => setPrev(null), 480);
    return () => window.clearTimeout(t);
  }, [title, artist, dirRef]);
  const dir = prev?.dir ?? dirRef.current;
  return (
    <div className="grid min-w-0">
      {prev && (
        <div
          key={`out-${prev.title}`}
          aria-hidden="true"
          className={`min-w-0 [grid-area:1/1] ${dir === 1 ? "title-out-next" : "title-out-prev"}`}
        >
          <h2 className="truncate text-[21px] leading-snug font-bold text-white">{prev.title}</h2>
          <p className="mt-0.5 truncate text-[13.5px] text-white/[0.78]">{prev.artist}</p>
        </div>
      )}
      <div
        key={`in-${cur.title}`}
        className={`min-w-0 [grid-area:1/1] ${prev ? (dir === 1 ? "title-in-next" : "title-in-prev") : ""}`}
      >
        <h2 className="truncate text-[21px] leading-snug font-bold text-white">{cur.title}</h2>
        <p className="mt-0.5 truncate text-[13.5px] text-white/[0.78]">{cur.artist}</p>
      </div>
    </div>
  );
}

/* ---------------- Track row ---------------- */

// Memoized with stable (track, list) handlers: a player progress tick
// re-renders the shell, but rows whose props did not change skip render.
const TrackRow = memo(function TrackRow({
  track,
  list,
  isCurrent,
  isPlaying,
  isLiked,
  card = false,
  onPlayTrack,
  onToggleLikeTrack,
  onPlayNextTrack,
  onAddToQueueTrack,
}: {
  track: Track;
  list: Track[];
  isCurrent: boolean;
  isPlaying: boolean;
  isLiked: boolean;
  // Card variant (album/playlist page, per the user's reference
  // screenshot): the row becomes a standalone frosted card, the
  // title is bold, and the second line reads "artists • duration";
  // the like action lives in the ⋯ menu so the row stays clean.
  card?: boolean;
  onPlayTrack: (track: Track, list: Track[]) => void;
  onToggleLikeTrack: (track: Track) => void;
  onPlayNextTrack?: (track: Track) => void;
  onAddToQueueTrack?: (track: Track) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="relative">
    <div
      className={
        card
          ? `glass-soft flex items-center gap-3 rounded-[22px] px-3 py-2.5 transition-colors duration-200 ${isCurrent ? "silver-glow" : ""}`
          : `flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors duration-200 hover:bg-white/[0.06] ${isCurrent ? "bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : ""}`
      }
    >
      <button
        type="button"
        onClick={() => onPlayTrack(track, list)}
        aria-label={`${isCurrent && isPlaying ? "Pause" : "Play"} ${track.title} by ${track.artist}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="relative block h-12 w-12 flex-none overflow-hidden rounded-xl shadow-[0_6px_14px_rgba(0,0,0,0.35)]">
          <img src={smallThumb(track.thumbnail)} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
          {isCurrent && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
              {isPlaying ? <EqBars /> : <Icon d={P.play} size={17} filled />}
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className={`block truncate text-[15px] ${card ? "font-semibold" : ""} ${isCurrent ? "text-white" : "text-[var(--text)]"}`}>
            {track.title}
          </span>
          <span className="block truncate text-[13px] text-[var(--dim)] tabular-nums">
            {card && track.duration ? `${track.artist} • ${track.duration}` : track.artist}
          </span>
        </span>
      </button>
      {!card && <span className="flex-none text-[12px] text-[var(--dim)] tabular-nums">{track.duration}</span>}
      {!card && (
        <button
          type="button"
          onClick={() => onToggleLikeTrack(track)}
          aria-label={isLiked ? `Remove ${track.title} from Liked Songs` : `Add ${track.title} to Liked Songs`}
          aria-pressed={isLiked}
          className={`flex h-9 w-9 flex-none items-center justify-center rounded-full transition-transform duration-150 active:scale-[0.9] ${isLiked ? "text-[var(--accent)]" : "text-[var(--dim)]"}`}
        >
          <Icon d={P.heart} size={19} filled={isLiked} />
        </button>
      )}
      {(onPlayNextTrack || onAddToQueueTrack) && (
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={`More options for ${track.title}`}
          aria-expanded={menuOpen}
          className="flex h-9 w-7 flex-none items-center justify-center rounded-full text-[var(--dim)] transition-transform duration-150 active:scale-[0.9]"
        >
          <Icon d={card ? P.dotsV : P.dots} size={19} />
        </button>
      )}
    </div>
    {menuOpen && (onPlayNextTrack || onAddToQueueTrack) && (
      <div className="glass-soft rise mx-2 mb-1 flex flex-wrap gap-2 rounded-2xl px-3 py-2.5">
        {onPlayNextTrack && (
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onPlayNextTrack(track);
            }}
            className="glass-soft rounded-full px-3.5 py-1.5 text-[12px] text-[var(--text)]"
          >
            Play next
          </button>
        )}
        {onAddToQueueTrack && (
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onAddToQueueTrack(track);
            }}
            className="glass-soft rounded-full px-3.5 py-1.5 text-[12px] text-[var(--text)]"
          >
            Add to queue
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setMenuOpen(false);
            onToggleLikeTrack(track);
          }}
          className="glass-soft rounded-full px-3.5 py-1.5 text-[12px] text-[var(--text)]"
        >
          {isLiked ? "Remove from Liked" : "Add to Liked"}
        </button>
        <a
          href={`https://www.youtube.com/watch?v=${track.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="glass-soft rounded-full px-3.5 py-1.5 text-[12px] text-[var(--text)]"
        >
          Watch on YouTube
        </a>
      </div>
    )}
    </div>
  );
});

/* ---------------- Ranked popular-song card (search tab) ----------------
   Chart rows like the reference: rank number, square cover, bold
   title, "artist • views" under it, in a soft rounded metal card. */

type PopularSong = ApiResponse<typeof api, "getPopular">["songs"][number];

const PopularRow = memo(function PopularRow({
  song,
  rank,
  list,
  isCurrent,
  isPlaying,
  isLiked,
  onPlayTrack,
  onToggleLikeTrack,
  onPlayNextTrack,
  onAddToQueueTrack,
}: {
  song: PopularSong;
  rank: number;
  list: PopularSong[];
  isCurrent: boolean;
  isPlaying: boolean;
  isLiked: boolean;
  onPlayTrack: (track: Track, list: Track[]) => void;
  onToggleLikeTrack: (track: Track) => void;
  onPlayNextTrack?: (track: Track) => void;
  onAddToQueueTrack?: (track: Track) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={`spatial-card glass rounded-[20px] px-3 py-2.5 ${isCurrent ? "silver-glow" : ""}`}
    >
      <div className="flex items-center gap-3">
      <span className="font-display w-6 flex-none text-center text-[19px] text-[var(--accent)] tabular-nums">{rank}</span>
      <button
        type="button"
        onClick={() => onPlayTrack(song, list)}
        aria-label={`${isCurrent && isPlaying ? "Pause" : "Play"} ${song.title} by ${song.artist}, number ${rank} in Popular Songs`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="relative block h-14 w-14 flex-none overflow-hidden rounded-[14px] shadow-[0_8px_18px_rgba(0,0,0,0.4)]">
          <img src={smallThumb(song.thumbnail)} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
          {isCurrent && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
              {isPlaying ? <EqBars /> : <Icon d={P.play} size={18} filled />}
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className={`block truncate text-[15px] font-semibold ${isCurrent ? "text-white" : "text-[var(--text)]"}`}>
            {song.title}
          </span>
          <span className="block truncate text-[12.5px] text-[var(--dim)] tabular-nums">
            {song.artist}
            {song.plays ? ` • ${song.plays}` : song.duration ? ` • ${song.duration}` : ""}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onToggleLikeTrack(song)}
        aria-label={isLiked ? `Remove ${song.title} from Liked Songs` : `Add ${song.title} to Liked Songs`}
        aria-pressed={isLiked}
        className={`flex h-9 w-9 flex-none items-center justify-center rounded-full transition-transform duration-150 active:scale-[0.9] ${isLiked ? "text-[var(--accent)]" : "text-[var(--dim)]"}`}
      >
        <Icon d={P.heart} size={18} filled={isLiked} />
      </button>
      {(onPlayNextTrack || onAddToQueueTrack) && (
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={`More options for ${song.title}`}
          aria-expanded={menuOpen}
          className="flex h-9 w-7 flex-none items-center justify-center rounded-full text-[var(--dim)] transition-transform duration-150 active:scale-[0.9]"
        >
          <Icon d={P.dots} size={19} />
        </button>
      )}
      </div>
      {menuOpen && (onPlayNextTrack || onAddToQueueTrack) && (
        <div className="glass-soft rise mt-2 flex flex-wrap gap-2 rounded-2xl px-3 py-2.5">
          {onPlayNextTrack && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onPlayNextTrack(song);
              }}
              className="glass-soft rounded-full px-3.5 py-1.5 text-[12px] text-[var(--text)]"
            >
              Play next
            </button>
          )}
          {onAddToQueueTrack && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onAddToQueueTrack(song);
              }}
              className="glass-soft rounded-full px-3.5 py-1.5 text-[12px] text-[var(--text)]"
            >
              Add to queue
            </button>
          )}
        </div>
      )}
    </div>
  );
});

/* ---------------- Speed dial — the rotating carousel ----------------
   Speed Dial palette (Echo Music style): a coverflow carousel over
   the user's 20 songs. The old 3D ring squeezed 20 tiles onto one
   circle — adjacent tiles overlapped, side tiles were rotateY
   slivers cut off mid-title, and the front tile was clipped by its
   neighbours. The palette is now bigger and faces the viewer:
   large 176px tiles on a wide stage, the front tile fully visible
   and centred, the next tile on each side peeking in with a real
   gap (no overlap, no squish), and every other song hidden behind
   until the spin brings it round. Auto-rotating, drag to spin,
   tap the front tile to play it, tap a side tile to spin it to
   the front. Transforms are written straight to the DOM via
   refs — React state only changes when the front tile changes,
   so the spin never re-renders the page. */

function SpeedDial({
  pool,
  onPlayTrack,
  occluded = false,
}: {
  pool: Track[];
  onPlayTrack: (track: Track, list: Track[]) => void;
  // True while a full-screen sheet (Now Playing / lyrics) covers
  // Home: the dial is invisible then, so its paint loop must idle
  // instead of fighting the sheet's own animations (the WebGL
  // play button, the video) for the phone's GPU — occluded
  // per-frame style writes were part of the flicker load.
  occluded?: boolean;
}) {
  const slots = useMemo(() => {
    if (pool.length === 0) return [] as Track[];
    const s: Track[] = [];
    // The dial now holds the user's full set — up to 20 songs
    // (10 most-played + 10 random from their listening) — so every
    // song gets a tile on the ring, not just the first few.
    const target = Math.min(20, Math.max(pool.length, 4));
    for (let i = 0; i < target; i++) {
      const t = pool[i % pool.length];
      if (t) s.push(t);
    }
    // Dedupe consecutive duplicates when the pool is tiny.
    return s.filter((t, i) => i === 0 || t.videoId !== s[i - 1]?.videoId);
  }, [pool]);
  const slotCount = slots.length;
  const step = slotCount > 0 ? 360 / slotCount : 0;
  // Coverflow geometry: one big front tile, neighbours a full
  // tile-width plus a gap away — never overlapping the front tile.
  const TILE = 176;
  const SPACING = 192;
  const DEG_PER_PX = step > 0 ? step / SPACING : 0;
  const angleRef = useRef(0);
  const velRef = useRef(0);
  const targetRef = useRef<number | null>(null);
  const dragRef = useRef<{ startX: number; startAngle: number; moved: boolean; lastX: number; lastT: number } | null>(null);
  const tileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const innerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const shadeRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Perf: the last box-shadow "bucket" written per tile (the shadow
  // is quantised so paint() only touches that paint-expensive
  // property when it visibly changes), and whether the dial is on
  // screen at all — the rAF loop below does no style writes while
  // the carousel is scrolled out of view.
  const shadowBucketRef = useRef<number[]>([]);
  // v1.0.1: the auto-spin fast path (paintAuto, below) writes
  // transform every frame but only touches the paint-expensive
  // properties (opacity / visibility / zIndex / shade / shadow)
  // when a tile's coarse depth bucket changes — during the
  // auto-spin drift a tile's depth barely moves, so most frames
  // become transform-only, GPU-composited writes.
  const tileBucketRef = useRef<number[]>([]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const onScreenRef = useRef(true);
  const occludedRef = useRef(occluded);
  occludedRef.current = occluded;
  const frontRef = useRef(0);
  const [frontSlot, setFrontSlot] = useState(0);
  const [dragging, setDragging] = useState(false);
  const reducedMotion = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const paint = useCallback(() => {
    const angle = angleRef.current;
    // Continuous position of the front slot; each tile's offset
    // from it wraps around the full set of songs.
    const frontFloat = step > 0 ? -angle / step : 0;
    for (let i = 0; i < slotCount; i++) {
      const el = tileRefs.current[i];
      if (!el) continue;
      let offset = i - frontFloat;
      offset = ((offset % slotCount) + slotCount) % slotCount;
      if (offset > slotCount / 2) offset -= slotCount;
      const abs = Math.abs(offset);
      const visible = abs <= 2.35;
      const depth = Math.max(0, 1 - abs / 2.6);
      const scale = 1 - Math.min(abs, 2.35) * 0.13;
      el.style.transform = `translateX(${Math.round(offset * SPACING)}px) scale(${scale.toFixed(3)}) rotateY(${Math.round(offset * -13)}deg)`;
      el.style.opacity = visible ? `${0.35 + 0.65 * Math.pow(depth, 0.7)}` : "0";
      el.style.visibility = visible ? "visible" : "hidden";
      el.style.zIndex = `${Math.round(30 - abs * 6)}`;
      // Keep the auto-spin bucket cache in sync (v1.0.1): paint()
      // writes every property, so the cache must reflect the new
      // state or paintAuto() could later skip a write it owes.
      tileBucketRef.current[i] = visible ? Math.round(depth * 8) : -1;
      const inner = innerRefs.current[i];
      if (inner) {
        inner.style.transform = "";
        // box-shadow is a paint property, not composited — writing
        // a new string for 20 tiles on every animation frame was a
        // constant repaint storm (a visible source of scroll /
        // interaction jank). Quantise depth to 12 steps and only
        // rewrite the shadow when the step changes; transforms and
        // opacity above stay per-frame and GPU-cheap.
        const bucket = Math.round(depth * 12);
        if (shadowBucketRef.current[i] !== bucket) {
          shadowBucketRef.current[i] = bucket;
          const d = bucket / 12;
          inner.style.boxShadow = `0 ${Math.round(10 + d * 16)}px ${Math.round(20 + d * 26)}px rgba(0,0,0,${(0.18 + d * 0.34).toFixed(2)})`;
        }
      }
      const shade = shadeRefs.current[i];
      if (shade) shade.style.opacity = `${Math.min(0.4, abs * 0.2)}`;
    }
    if (slotCount > 0) {
      const f = ((Math.round(-angle / step) % slotCount) + slotCount) % slotCount;
      if (f !== frontRef.current) {
        frontRef.current = f;
        setFrontSlot(f);
      }
    }
  }, [slotCount, step]);

  /* Auto-spin fast path (v1.0.1): same geometry as paint(), but
     during the slow idle drift only the transform is written per
     frame — opacity / visibility / zIndex / shade / shadow are
     re-written only when a tile's coarse depth bucket changes
     (8 steps), which happens a few times a second at most while
     auto-spinning. Dragging, flinging and spin-to-tile keep using
     the full paint() above, so their feel is byte-identical. */
  const paintAuto = useCallback(() => {
    const angle = angleRef.current;
    const frontFloat = step > 0 ? -angle / step : 0;
    for (let i = 0; i < slotCount; i++) {
      const el = tileRefs.current[i];
      if (!el) continue;
      let offset = i - frontFloat;
      offset = ((offset % slotCount) + slotCount) % slotCount;
      if (offset > slotCount / 2) offset -= slotCount;
      const abs = Math.abs(offset);
      const visible = abs <= 2.35;
      const depth = Math.max(0, 1 - abs / 2.6);
      const scale = 1 - Math.min(abs, 2.35) * 0.13;
      el.style.transform = `translateX(${Math.round(offset * SPACING)}px) scale(${scale.toFixed(3)}) rotateY(${Math.round(offset * -13)}deg)`;
      // Coarse bucket: -1 = hidden, else depth in 8 steps. Only
      // when it changes do the paint-expensive writes happen.
      const bucket = visible ? Math.round(depth * 8) : -1;
      if (tileBucketRef.current[i] !== bucket) {
        tileBucketRef.current[i] = bucket;
        el.style.opacity = visible ? `${0.35 + 0.65 * Math.pow(depth, 0.7)}` : "0";
        el.style.visibility = visible ? "visible" : "hidden";
        el.style.zIndex = `${Math.round(30 - abs * 6)}`;
        const inner = innerRefs.current[i];
        if (inner) {
          inner.style.transform = "";
          const sBucket = Math.round(depth * 12);
          if (shadowBucketRef.current[i] !== sBucket) {
            shadowBucketRef.current[i] = sBucket;
            const d = sBucket / 12;
            inner.style.boxShadow = `0 ${Math.round(10 + d * 16)}px ${Math.round(20 + d * 26)}px rgba(0,0,0,${(0.18 + d * 0.34).toFixed(2)})`;
          }
        }
        const shade = shadeRefs.current[i];
        if (shade) shade.style.opacity = `${Math.min(0.4, abs * 0.2)}`;
      }
    }
    if (slotCount > 0) {
      const f = ((Math.round(-angle / step) % slotCount) + slotCount) % slotCount;
      if (f !== frontRef.current) {
        frontRef.current = f;
        setFrontSlot(f);
      }
    }
  }, [slotCount, step]);

  useEffect(() => {
    paint();
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(60, now - last);
      last = now;
      // Off-screen (scrolled past, another tab of the app showing)
      // or occluded by the full-screen player / lyrics sheet:
      // keep the loop alive but skip every style write — an
      // invisible carousel must cost nothing per frame.
      if (!dragRef.current && (!onScreenRef.current || occludedRef.current)) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (!dragRef.current) {
        if (targetRef.current !== null) {
          const target = targetRef.current;
          const diff = ((target - angleRef.current + 540) % 360) - 180;
          if (Math.abs(diff) < 0.08) {
            angleRef.current = target;
            targetRef.current = null;
          } else {
            angleRef.current += diff * Math.min(1, dt * 0.011);
          }
          paint();
        } else if (Math.abs(velRef.current) > 0.0015) {
          angleRef.current += velRef.current * dt;
          velRef.current *= Math.pow(0.94, dt / 16.7);
          paint();
        } else if (!reducedMotion.current) {
          // Idle auto-spin: paint EVERY frame via paintAuto().
          // v1.0.1 throttled auto-spin paints to ~31fps (32ms) to
          // halve the work, but that is exactly why it still
          // stuttered on Naman's 120Hz phone: a 31fps paint
          // cadence can never line up with a 60/120Hz vsync, so
          // frames presented unevenly. Speed alone could not fix
          // that — at the same 32ms cadence a faster spin only
          // makes each jump bigger. Verified by cadence analysis
          // + a frame-timing bench of the exact paint math (the
          // live-browser run could not be captured in this
          // environment, so the phone test is the final check):
          // paintAuto is transform-only per frame, so painting
          // every frame is cheap, and the drift is now 10°/s —
          // Naman's faster-speed suggestion — which at 120Hz is
          // ~0.8px per frame: small, even steps, no judder.
          angleRef.current -= dt * 0.01;
          paintAuto();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paint, paintAuto]);

  // Track whether the dial is anywhere near the viewport; the
  // paint loop above idles while it isn't.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e) onScreenRef.current = e.isIntersecting;
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // A refreshed pool must visibly become a NEW carousel: when the set
  // of songs changes (new Speed Dial fetch), reset the ring to the
  // front instead of keeping the old angle/order on screen.
  const poolKey = slots.map((s) => s.videoId).join("|");
  const poolKeyRef = useRef(poolKey);
  useEffect(() => {
    if (poolKeyRef.current !== poolKey) {
      poolKeyRef.current = poolKey;
      angleRef.current = 0;
      velRef.current = 0;
      targetRef.current = null;
      frontRef.current = 0;
      setFrontSlot(0);
      paint();
    }
  }, [poolKey, paint]);

  const front = slots[frontSlot];
  if (!front) return null;

  const spinTo = (idx: number) => {
    const base = -idx * step;
    const cur = angleRef.current;
    const k = Math.round((cur - base) / 360);
    targetRef.current = base + 360 * k;
    velRef.current = 0;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startAngle: angleRef.current, moved: false, lastX: e.clientX, lastT: performance.now() };
    velRef.current = 0;
    targetRef.current = null;
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 5) d.moved = true;
    angleRef.current = d.startAngle + dx * DEG_PER_PX;
    const now = performance.now();
    const dt = now - d.lastT;
    if (dt > 0) velRef.current = ((e.clientX - d.lastX) / dt) * DEG_PER_PX;
    d.lastX = e.clientX;
    d.lastT = now;
    paint();
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!d) return;
    if (!d.moved) {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-tile-idx]");
      const idxAttr = el?.dataset.tileIdx;
      if (idxAttr !== undefined) {
        const idx = Number(idxAttr);
        const t = slots[idx];
        if (t) {
          if (idx === frontRef.current) onPlayTrack(t, pool);
          else spinTo(idx);
        }
      }
      velRef.current = 0;
    }
  };

  return (
    <div data-spatial-dial="" className="spatial-dial" ref={stageRef}>
      <div
        className="ring-stage relative mx-auto h-[320px] w-full max-w-[720px] overflow-hidden"
        style={{ touchAction: "pan-y", cursor: dragging ? "grabbing" : "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="group"
        aria-label="Speed dial carousel. Drag to spin, tap the front song to play it."
      >
        <span className="spatial-dial-floor" aria-hidden="true" />
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.08) 0%, rgba(138,123,184,0.05) 45%, transparent 70%)" }}
          aria-hidden="true"
        />
        <div className="ring absolute top-1/2 left-1/2 h-0 w-0">
          {slots.map((t, i) => {
            const isFront = i === frontSlot;
            return (
              <div
                key={`${t.videoId}-${i}`}
                data-tile-idx={i}
                ref={(el) => {
                  tileRefs.current[i] = el;
                }}
                className="ring-tile absolute"
                style={{ width: TILE, height: TILE, marginLeft: -TILE / 2, marginTop: -TILE / 2 - 8 }}
              >
                <div
                  ref={(el) => {
                    innerRefs.current[i] = el;
                  }}
                  className={`relative h-full w-full overflow-hidden rounded-[26px] border border-white/15 ${isFront ? "silver-glow" : ""}`}
                >
                  <img src={smallThumb(t.thumbnail)} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} loading="lazy" decoding="async" />
                  <span className="cover-band absolute inset-x-0 bottom-0 px-3 pt-2 pb-2.5">
                    <span className="block truncate text-[12px] leading-tight font-bold text-white">{t.title}</span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-white/65">{t.artist}</span>
                  </span>
                  <div
                    ref={(el) => {
                      shadeRefs.current[i] = el;
                    }}
                    className="pointer-events-none absolute inset-0 rounded-[26px] bg-black"
                    aria-hidden="true"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Front song label only — there is deliberately NO play
          button anywhere in Speed Dial (the user asked for it gone,
          twice). Tapping the front tile itself plays the song;
          tapping a side tile spins it to the front. */}
      <div className="rise mt-1 text-center" key={front.videoId}>
        <p className="font-display truncate px-6 text-[19px] text-[var(--text)]">{front.title}</p>
        <p className="mt-0.5 truncate px-6 text-[13px] text-[var(--dim)]">{front.artist}</p>
      </div>
    </div>
  );
}

/* ---------------- App background (Vision frost theme) ----------------
   Default: the restrained near-black .app-bg from theme.css — static,
   zero JS, zero GPU cost. When the user has picked a wallpaper
   (pasted image link or an upload from their own device, saved
   server-side via getWallpaper), that photo sits fixed behind
   everything under a dark scrim, and the frosted panels blur over
   it — the living-room shots in the reference screenshots. */

function AppBackground({ wallpaperUrl }: { wallpaperUrl: string | null }) {
  if (wallpaperUrl) {
    return (
      <div className="wallpaper-bg" aria-hidden="true">
        <img src={wallpaperUrl} alt="" />
      </div>
    );
  }
  return <div className="app-bg" aria-hidden="true" />;
}

/* ---------------- Dynamic ambient backdrop (Liquid Glass) ----------------
   While a song is loaded as Now Playing (paused or playing —
   like Apple Music, the ambient stays with the song) and no user
   wallpaper is set — the wallpaper always wins — its artwork
   glows behind the main canvas: heavily blurred, darkened and
   held perfectly STATIC (it crossfades in per song, then does
   not move — a moving full-screen blur under the app's many
   backdrop-filter panels made the glass flicker on the phone;
   see .ambient-img in theme.css). Keyed by videoId so each song
   crossfades in. Pure paint — fixed layer, no layout, no JS per
   frame. */

function AmbientGlow({ thumb, videoId }: { thumb: string; videoId: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <img
        key={videoId}
        // The glow is blurred 3xl and darkened — a 120px render is
        // visually identical to the full cover here, but decodes
        // and filters at a fraction of the cost.
        src={smallThumb(thumb)}
        alt=""
        decoding="async"
        className="ambient-img absolute inset-0 h-full w-full object-cover blur-3xl brightness-[0.5] saturate-[1.45]"
      />
      <div className="absolute inset-0 bg-[#0a0a0c]/45" />
    </div>
  );
}

/* ---------------- Lyrics (Apple Music style) ----------------
   Full-screen sheet over the player, the cover dimmed behind it. Synced
   lines are large and bold; the line at the current playback position
   is bright white, neighbours fade with distance. Active lines are
   the SAME size, weight and layout as every other line — colour and
   opacity only — so a line can never re-wrap when it lights up.
   The view auto-scrolls to keep the active line centred — unless the
   user is scrolling by hand, in which case it leaves them alone for a
   few seconds. Tapping a synced line seeks there. Plain lyrics (no
   timing from LRCLib) render as clean readable text with no fake
   highlighting. */

type LyricLine = {
  time: number | null;
  text: string;
  words?: { time: number; text: string }[];
};

/* The timed lines list, memoised: it re-renders ONLY when the
   lines, the kind or the active line change — never on the
   player's per-second progress ticks, which re-render the rest
   of the lyrics sheet (times, progress bar) every second.

   LAYOUT-STABLE LINES (reflow fix, 21 Nov 2026): every line —
   active, sung or upcoming, karaoke or line-synced — renders
   the EXACT same DOM from first paint to last: one inline word
   span per word (.lyr-word), one font (24px / 700 / line-height
   1.3 / normal tracking) set once on the button and inherited
   by every span, and the full text always present, so each
   line's wrapped height is reserved up front and can never
   change mid-playback. Becoming active changes ONLY colour and
   opacity, plus the one-shot word reveal below: no scale, no
   font-weight / size / leading swap, no component swap. The
   old code swapped the active line into a TextGenerateEffect
   tree (text-2xl / leading-snug / tracking-wide word spans
   under a blur transition, the button scaled to 1.05) — those
   metrics differ just enough from the plain-text inactive
   lines that a line sitting near the wrap threshold re-wrapped
   the moment it lit up: "Only want your love if it's solid"
   dropped "if" onto its own line, then jumped back inline
   when the line went inactive again.

   The Text Generate reveal survives as a pure CSS animation
   (.lyr-gen in theme.css): when a line becomes active its word
   spans gain the class and each word fades from blur(10px) /
   opacity 0 to clear with the source's 0.2s stagger and 0.5s
   duration — opacity + filter only, both layout-free, on spans
   that never re-mount, so the reveal runs once per activation
   and the wrap cannot move. In karaoke mode the spans always
   carry their real word timings (data-ws / data-we) in every
   state, and the sweep loop in LyricsView paints those same
   spans by colour only. */
const LyricLines = memo(function LyricLines({
  kind,
  lines,
  activeIdx,
  lineRefs,
  onLineSeek,
}: {
  kind: "karaoke" | "synced";
  lines: LyricLine[];
  activeIdx: number;
  lineRefs: RefObject<(HTMLButtonElement | null)[]>;
  onLineSeek: (line: LyricLine) => void;
}) {
  return (
    <div className="py-[36vh]">
      {lines.map((line, i) => {
        const active = i === activeIdx;
        const dist = Math.abs(i - activeIdx);
        const opacityCls =
          kind === "karaoke"
            ? active
              ? "opacity-100"
              : dist === 1
                ? "opacity-60"
                : dist === 2
                  ? "opacity-45"
                  : "opacity-35"
            : active
              ? "text-white opacity-100"
              : dist === 1
                ? "text-white opacity-50"
                : dist === 2
                  ? "text-white opacity-35"
                  : "text-white opacity-25";
        // One word-span list per line, identical in every state.
        // Karaoke lines use their real per-word timings (the
        // joined words reproduce the line text); line-synced
        // lines split the text on spaces. Either way the spans
        // are keyed by position and never re-mount, so the
        // line's wrapped height is fixed from first paint.
        const timedWords = kind === "karaoke" ? (line.words ?? []) : [];
        const lineEnd = lines[i + 1]?.time ?? (line.time ?? 0) + 5;
        const spans: { text: string; ws?: number; we?: number; trail: boolean }[] =
          timedWords.length > 0
            ? timedWords.map((w, wi) => ({
                text: w.text,
                ws: w.time,
                we: timedWords[wi + 1]?.time ?? lineEnd,
                trail: wi < timedWords.length - 1 && !w.text.endsWith(" "),
              }))
            : line.text.split(" ").map((text) => ({ text, trail: true }));
        return (
          <button
            key={i}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            type="button"
            onClick={() => onLineSeek(line)}
            aria-label={`Play from “${line.text}”`}
            aria-current={active ? "true" : undefined}
            className={`block w-full py-2 text-left text-[24px] leading-[1.3] font-bold whitespace-pre-wrap transition-opacity duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${opacityCls}`}
          >
            {spans.map((s, wi) => (
              <span
                key={wi}
                className={`lyr-word${active ? " lyr-gen" : ""}`}
                style={{ "--wi": wi } as CSSProperties}
                {...(s.ws !== undefined ? { "data-ws": s.ws, "data-we": s.we } : {})}
              >
                {s.text}
                {wi < spans.length - 1 && s.trail ? " " : ""}
              </span>
            ))}
          </button>
        );
      })}
      {kind === "karaoke" && (
        <p className="pt-6 text-[11px] tracking-[0.22em] text-white/40 uppercase">Karaoke · word-synced lyrics</p>
      )}
    </div>
  );
});

function LyricsView({
  track,
  tint,
  currentTime,
  duration,
  isPlaying,
  loading,
  kind,
  lines,
  loadError,
  onRetry,
  onClose,
  onSeek,
  onTogglePlay,
  onNext,
  onPrev,
  volume,
  onVolumeChange,
  shuffle,
  repeat,
  onToggleShuffle,
  onCycleRepeat,
  onShowVideo,
  canShowVideo,
  onRefreshLyrics,
  lyricsRefreshing,
  lyricsRefreshed,
}: {
  track: Track;
  // Dominant colour of the current cover, sampled by the App the
  // same way as the Now Playing ambient background. Null when the
  // cover could not be sampled — the view then falls back to the
  // blurred cover wash.
  tint: { r: number; g: number; b: number } | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  loading: boolean;
  kind: "karaoke" | "synced" | "plain" | "none" | null;
  lines: LyricLine[];
  loadError: string | null;
  onRetry: () => void;
  onClose: () => void;
  onSeek: (sec: number) => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  volume: number;
  onVolumeChange: (v: number) => void;
  shuffle: boolean;
  repeat: 0 | 1 | 2;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onShowVideo: () => void;
  // Video exists in this app ONLY for a verified official music
  // video — the PiP/video button renders solely when the App's
  // official-video lookup confirmed one for this exact song.
  canShowVideo: boolean;
  // Refresh lyrics: re-fetches from LRCLib with every cache layer
  // bypassed; lyricsRefreshing while the fetch is in flight,
  // lyricsRefreshed briefly after it lands.
  onRefreshLyrics: () => void;
  lyricsRefreshing: boolean;
  lyricsRefreshed: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const holdUntilRef = useRef(0);

  const timed = kind === "synced" || kind === "karaoke";

  /* ---- Smooth playback clock -----------------------------------
     The player's progress reaches this view once a second (the
     poll only publishes when the displayed second changes), and
     everything used to be driven straight off that: the active
     line snapped once a second, the karaoke sweep's base reset
     on every tick so it jumped whenever the reported time
     disagreed with the interpolation, and resuming from pause
     raced the sweep ahead by the whole paused duration. Now a
     clock interpolates between reports: small drift is absorbed
     by shifting the base timestamp (the interpolated position
     itself never moves), only a real seek (> 0.35s) snaps,
     pausing freezes the clock at the exact interpolated
     position, resuming re-anchors it, and a buffering stall
     can't run the sweep more than ~1s past the last reported
     position. One rAF loop below drives the active line, the
     auto-scroll and the karaoke sweep from this single clock,
     so all three always agree with each other. */
  const clockRef = useRef<{ t: number; at: number } | null>(null);
  if (clockRef.current === null) {
    clockRef.current = { t: currentTime, at: performance.now() };
  }
  const propTimeRef = useRef(currentTime);
  const playingRef = useRef(isPlaying);
  const interpNow = useCallback(() => {
    const c = clockRef.current ?? { t: 0, at: 0 };
    if (!playingRef.current) return c.t;
    const raw = c.t + (performance.now() - c.at) / 1000;
    return Math.min(raw, propTimeRef.current + 1.1);
  }, []);

  useEffect(() => {
    propTimeRef.current = currentTime;
    const nowPerf = performance.now();
    if (!playingRef.current) {
      clockRef.current = { t: currentTime, at: nowPerf };
      return;
    }
    const drift = interpNow() - currentTime;
    if (Math.abs(drift) > 0.35) {
      // A seek (or a long stall ending): snap to the real position.
      clockRef.current = { t: currentTime, at: nowPerf };
    } else if (drift !== 0) {
      // Absorb the drift by shifting the base — the interpolated
      // position does not move, so the sweep never jumps.
      const c = clockRef.current ?? { t: currentTime, at: nowPerf };
      clockRef.current = { t: c.t, at: c.at + drift * 500 };
    }
  }, [currentTime, interpNow]);

  useEffect(() => {
    if (isPlaying === playingRef.current) {
      playingRef.current = isPlaying;
      return;
    }
    if (isPlaying) {
      playingRef.current = true;
      const c = clockRef.current ?? { t: 0, at: performance.now() };
      clockRef.current = { t: c.t, at: performance.now() };
    } else {
      const frozen = interpNow();
      playingRef.current = false;
      clockRef.current = { t: frozen, at: performance.now() };
    }
  }, [isPlaying, interpNow]);

  const lineIndexAt = useCallback(
    (t: number) => {
      let idx = -1;
      for (let i = 0; i < lines.length; i++) {
        const lt = lines[i]?.time;
        if (lt !== null && lt !== undefined && lt <= t + 0.12) idx = i;
        else break;
      }
      return idx;
    },
    [lines],
  );

  // The active line, driven by the interpolated clock in the rAF
  // loop below — state changes only when the line actually
  // changes, so the memoised list re-renders once per line, not
  // once per progress tick.
  const [liveIdx, setLiveIdx] = useState(() => lineIndexAt(currentTime));

  // Tap-to-seek with a stable identity, so the memoised list
  // doesn't re-render on this sheet's per-second re-renders.
  const onSeekRef = useRef(onSeek);
  useEffect(() => {
    onSeekRef.current = onSeek;
  });
  const handleLineSeek = useCallback((line: LyricLine) => {
    if (line.time !== null) {
      holdUntilRef.current = 0;
      onSeekRef.current(line.time);
    }
  }, []);

  // Karaoke sweep bookkeeping (refs, so the rAF loop never has
  // to restart to see fresh values): the line currently being
  // swept, the line waiting for its final colour pass, and a
  // full-repaint flag for seeks / refreshes / first paint.
  const paintStateRef = useRef({ sweptLine: -2, pendingFinal: -1, needsFullPaint: true });
  const spanStateRef = useRef(new WeakMap<HTMLElement, string>());

  // Fresh lines landed (track change or Refresh lyrics): reset
  // the sweep bookkeeping and re-derive the active line from the
  // last reported position — the loop re-syncs everything else,
  // so the highlight lands back on the line being sung.
  const seenLinesRef = useRef(lines);
  useEffect(() => {
    if (seenLinesRef.current === lines) return;
    seenLinesRef.current = lines;
    paintStateRef.current = { sweptLine: -2, pendingFinal: -1, needsFullPaint: true };
    setLiveIdx(lineIndexAt(propTimeRef.current));
  }, [lines, lineIndexAt]);

  // Lyrics refreshed: release any user-scroll hold — the loop
  // glides the (re-derived) active line back to centre on its own.
  useEffect(() => {
    if (lyricsRefreshed) holdUntilRef.current = 0;
  }, [lyricsRefreshed]);

  /* ---- The one rAF loop: active line, smooth scroll, sweep ----
     Scroll: instead of a fresh native smooth-scroll per line
     change (each interrupting the last, aiming at a target that
     was still moving while the old font-size transition ran),
     scrollTop is damped toward the active line's centred
     position every frame — retargeting mid-glide is seamless
     and it settles exactly on centre. Sweep: only the active
     line's word spans are painted per frame (the old loop
     restyled every word in the whole song, every frame), a
     span's style is written only when its state actually
     changed, and lines left behind are finalised once. */
  useEffect(() => {
    if (!timed) return;
    let raf = 0;
    let lastTs = performance.now();

    // Colour ONLY, three stable states per word (upcoming /
    // current / sung): a span's style is written once when its
    // state flips, never per frame. The old build swept a
    // background-clip gradient across the current word in 50
    // steps — a repaint of the whole line's text on every frame
    // and one more way the active line's rendering differed
    // from every other line's. Nothing here touches width,
    // weight, spacing or filter, so painting can never re-wrap
    // a line.
    const paintSpan = (span: HTMLElement, ws: number, we: number, now: number) => {
      const key = now >= we ? "sung" : now >= ws ? "cur" : "up";
      const fullKey = `${ws}|${key}`;
      if (spanStateRef.current.get(span) === fullKey) return;
      spanStateRef.current.set(span, fullKey);
      if (key === "up") {
        span.style.color = "rgba(255,255,255,0.42)";
      } else {
        span.style.color = "#ffffff";
      }
      span.style.backgroundImage = "none";
      span.style.webkitTextFillColor = "";
    };

    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(80, Math.max(1, ts - lastTs));
      lastTs = ts;
      const now = interpNow();
      const idx = lineIndexAt(now);
      setLiveIdx((prev) => (prev === idx ? prev : idx));

      // Smooth-scroll toward the active line's centre, unless
      // the user is scrolling by hand (their hold still applies).
      const c = containerRef.current;
      if (c && idx >= 0 && Date.now() >= holdUntilRef.current) {
        const el = lineRefs.current[idx];
        if (el) {
          const target = el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2;
          const diff = target - c.scrollTop;
          if (Math.abs(diff) >= 0.6) {
            const k = 1 - Math.exp(-dt / 130);
            c.scrollTop = c.scrollTop + diff * k;
            if (Math.abs(target - c.scrollTop) < 0.6) c.scrollTop = target;
          }
        }
      }

      if (kind !== "karaoke") return;
      const ps = paintStateRef.current;
      if (ps.sweptLine !== idx) {
        if (ps.sweptLine >= 0) ps.pendingFinal = ps.sweptLine;
        if (ps.sweptLine === -2 || Math.abs(idx - ps.sweptLine) > 1) ps.needsFullPaint = true;
        ps.sweptLine = idx;
      }
      // Finalise the line just left — its spans are the same
      // mounted elements it had while active (every line always
      // renders its timed spans), so this is one last colour
      // pass over them, not a re-render.
      if (ps.pendingFinal >= 0 && ps.pendingFinal !== idx) {
        const el = lineRefs.current[ps.pendingFinal];
        const spans = el?.querySelectorAll<HTMLElement>("[data-ws]");
        if (spans && spans.length > 0) {
          spans.forEach((s) => paintSpan(s, Number(s.dataset.ws), Number(s.dataset.we), now));
          ps.pendingFinal = -1;
        }
      }
      // One full pass over the static lines after a seek, a
      // refresh or the first paint, so skipped lines show the
      // right sung / upcoming state when scrolled back to.
      if (ps.needsFullPaint) {
        lineRefs.current.forEach((el, li) => {
          if (!el || li === idx) return;
          el.querySelectorAll<HTMLElement>("[data-ws]").forEach((s) => paintSpan(s, Number(s.dataset.ws), Number(s.dataset.we), now));
        });
        ps.needsFullPaint = false;
      }
      // Sweep the active line's words — the same timed spans
      // (data-ws / data-we) the line renders in every state,
      // painted by colour only, so the sweep can never change
      // the line's layout while it plays.
      if (idx >= 0) {
        const el = lineRefs.current[idx];
        el?.querySelectorAll<HTMLElement>("[data-ws]").forEach((s) => paintSpan(s, Number(s.dataset.ws), Number(s.dataset.we), now));
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [timed, kind, lines, interpNow, lineIndexAt]);

  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="sheet-in fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[#0a0a0c] text-white">
      {/* Ambient background — the SAME system as the redesigned Now
          Playing: a full-bleed vertical gradient sampled from the
          current cover (deep muted tone at the top into a richer,
          luminous tint toward the bottom), crossfading in over
          800ms on track change. When the cover colour could not be
          sampled, a heavily blurred, darkened wash of the cover
          itself is the tint — never a flat background. */}
      {tint ? (
        <div
          key={`lyr-tint-${track.videoId}`}
          aria-hidden="true"
          className="np-fade-in pointer-events-none absolute inset-0"
          style={{
            background: `linear-gradient(180deg, rgb(${Math.round(tint.r * 0.3)}, ${Math.round(tint.g * 0.3)}, ${Math.round(tint.b * 0.3)}) 0%, rgb(${Math.round(tint.r * 0.62)}, ${Math.round(tint.g * 0.62)}, ${Math.round(tint.b * 0.62)}) 42%, rgb(${Math.round(tint.r + (255 - tint.r) * 0.14)}, ${Math.round(tint.g + (255 - tint.g) * 0.14)}, ${Math.round(tint.b + (255 - tint.b) * 0.14)}) 78%, rgb(${Math.round(tint.r * 0.78)}, ${Math.round(tint.g * 0.78)}, ${Math.round(tint.b * 0.78)}) 100%)`,
          }}
        />
      ) : (
        <>
          <img
            src={smallThumb(track.thumbnail)}
            alt=""
            aria-hidden="true"
            decoding="async"
            className="np-fade-in pointer-events-none absolute inset-0 h-full w-full scale-[1.35] object-cover blur-2xl brightness-[0.72] saturate-[1.25]"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-black/25 to-black/70" aria-hidden="true" />
        </>
      )}
      {/* Header — a floating Liquid Glass pill in the Now Playing
          material (.np-glass-card: white 12% glass, blur(36px)
          saturate(180%), specular rim): LYRICS + song title on the
          left, the white pill volume (desktop), video and close on
          the right with the same np-press tactile scale(0.9). */}
      <div className="relative z-10 mx-auto w-full max-w-xl flex-none px-5 pt-[max(env(safe-area-inset-top),14px)]">
        <div className="np-glass-card flex items-center gap-3 rounded-full py-2.5 pr-2.5 pl-5">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] tracking-[0.26em] text-white/60 uppercase">Lyrics</p>
            <p className="truncate text-[15px] leading-snug font-semibold text-white">{track.title}</p>
          </div>
          <div className="hidden flex-none items-center gap-2 lg:flex">
            <span className="text-white/75">
              <Icon d={P.speakerLow} size={17} />
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              aria-label="Volume"
              className="np-fader w-24"
              style={{ ["--fill" as string]: `${volume}%` }}
            />
          </div>
          {canShowVideo && (
            <button
              type="button"
              onClick={onShowVideo}
              aria-label="Picture in picture — switch to the video view"
              className="np-press hidden h-10 w-10 flex-none items-center justify-center rounded-full text-white lg:flex"
            >
              <Icon d={P.video} size={18} />
            </button>
          )}
          <ShinyButton
            onClick={onRefreshLyrics}
            disabled={lyricsRefreshing}
            aria-label={lyricsRefreshing ? "Refreshing lyrics" : "Refresh lyrics — fetch them again and re-sync"}
            aria-busy={lyricsRefreshing}
            className="px-3 py-2 disabled:opacity-60 [&>span]:flex [&>span]:items-center [&>span]:gap-1.5"
          >
            <span className={lyricsRefreshing ? "animate-spin" : ""}>
              <Icon d={P.refresh} size={17} />
            </span>
            <span className="text-[11px] font-semibold whitespace-nowrap">{lyricsRefreshing ? "Refreshing…" : "Refresh lyrics"}</span>
          </ShinyButton>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close lyrics"
            className="np-press flex h-10 w-10 flex-none items-center justify-center rounded-full text-white"
          >
            <Icon d={P.x} size={18} />
          </button>
        </div>
        {lyricsRefreshed && (
          <p className="rise mx-auto mt-3 w-fit rounded-full bg-black/45 px-4 py-1.5 text-center text-[12px] text-white/90" role="status" aria-live="polite">
            Lyrics refreshed
          </p>
        )}
      </div>

      {/* Desktop split (reference: SimpMusic-style lyrics view) — left:
          large art, title/artist, progress with elapsed / remaining,
          format badge, shuffle / prev / pause / next / repeat. */}
      <div className="absolute top-[96px] bottom-0 left-0 z-10 hidden w-[400px] flex-col justify-center px-10 lg:flex">
        <div className="np-glass-card rounded-[30px] px-6 pt-6 pb-7">
          <LargeArt
            src={track.thumbnail}
            alt={`Cover art for ${track.title}`}
            className={`living-art ${isPlaying ? "is-playing" : "is-paused"} aspect-square w-full rounded-[16px] border border-white/15 object-cover object-center`}
          />
          <p className="mt-5 truncate text-[20px] font-bold text-white">{track.title}</p>
          <p className="truncate text-[14px] text-white/[0.78]">{track.artist}</p>
          <div className="mt-4 h-[6px] overflow-hidden rounded-full bg-white/[0.28]">
            <div className="h-full w-full origin-left bg-white transition-transform duration-1000 [transition-timing-function:linear]" style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[11.5px] text-white/70 tabular-nums">
            <span>{fmt(currentTime)}</span>
            <span>-{fmt(Math.max(0, duration - currentTime))}</span>
          </div>
          <span className="np-seg-pill mt-3 inline-flex w-fit items-center rounded-full px-3 py-1 text-[11px] tracking-[0.14em] text-white/85 uppercase">
            YouTube Music
          </span>
          <div className="mt-5 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={onToggleShuffle}
              aria-label={shuffle ? "Turn shuffle off" : "Turn shuffle on"}
              aria-pressed={shuffle}
              className={`np-press flex h-10 w-10 items-center justify-center rounded-full ${shuffle ? "text-white" : "text-white/55"}`}
            >
              <Icon d={P.shuffle} size={17} />
            </button>
            <button
              type="button"
              onClick={onPrev}
              aria-label="Previous song"
              className="np-press flex h-11 w-11 items-center justify-center text-white"
            >
              <Icon d={P.prev} size={22} filled />
            </button>
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
              aria-pressed={isPlaying}
              className="np-press flex h-14 w-14 items-center justify-center text-white"
            >
              {isPlaying ? <PauseIcon size={30} /> : <Icon d={P.play} size={30} filled />}
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label="Next song"
              className="np-press flex h-11 w-11 items-center justify-center text-white"
            >
              <Icon d={P.next} size={22} filled />
            </button>
            <button
              type="button"
              onClick={onCycleRepeat}
              aria-label={repeat === 0 ? "Repeat off — tap to repeat all" : repeat === 1 ? "Repeat all — tap to repeat this song" : "Repeat this song — tap to turn repeat off"}
              className={`np-press flex h-10 w-10 items-center justify-center rounded-full ${repeat > 0 ? "text-white" : "text-white/55"}`}
            >
              <Icon d={repeat === 2 ? P.repeatOne : P.repeat} size={17} />
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="relative z-10 mx-auto w-full max-w-xl flex-1 space-y-5 px-7 pt-[26vh] lg:mx-0 lg:ml-[400px] lg:max-w-none" aria-label="Loading lyrics">
          {[0, 1, 2, 3].map((k) => (
            <div key={k} className="h-7 animate-pulse rounded bg-white/[0.06]" style={{ width: `${88 - k * 14}%` }} />
          ))}
          <p className="pt-3 text-sm text-[var(--dim)]">Loading lyrics…</p>
        </div>
      )}

      {!loading && kind === "karaoke" && (
        <div
          ref={containerRef}
          className="relative z-10 mx-auto w-full max-w-xl flex-1 overflow-y-auto px-7 lg:mx-0 lg:ml-[400px] lg:max-w-none"
          onPointerDown={() => {
            holdUntilRef.current = Date.now() + 5000;
          }}
          onWheel={() => {
            holdUntilRef.current = Date.now() + 5000;
          }}
        >
          <LyricLines kind="karaoke" lines={lines} activeIdx={liveIdx} lineRefs={lineRefs} onLineSeek={handleLineSeek} />
        </div>
      )}

      {!loading && kind === "synced" && (
        <div
          ref={containerRef}
          className="relative z-10 mx-auto w-full max-w-xl flex-1 overflow-y-auto px-7 lg:mx-0 lg:ml-[400px] lg:max-w-none"
          onPointerDown={() => {
            holdUntilRef.current = Date.now() + 5000;
          }}
          onWheel={() => {
            holdUntilRef.current = Date.now() + 5000;
          }}
        >
          <LyricLines kind="synced" lines={lines} activeIdx={liveIdx} lineRefs={lineRefs} onLineSeek={handleLineSeek} />
        </div>
      )}

      {!loading && kind === "plain" && (
        <div className="relative z-10 mx-auto w-full max-w-xl flex-1 overflow-y-auto px-7 lg:mx-0 lg:ml-[400px] lg:max-w-none">
          <div className="py-10">
            {lines.map((line, i) =>
              line.text ? (
                <p key={i} className="py-1 text-[19px] font-medium leading-[1.45] text-white/75">
                  {line.text}
                </p>
              ) : (
                <div key={i} className="h-5" />
              ),
            )}
            <p className="pt-8 text-[12px] tracking-[0.14em] text-[var(--dim)] uppercase">
              Lyrics for this song aren't time-synced
            </p>
          </div>
        </div>
      )}

      {!loading && (kind === "none" || kind === null) && (
        <div className="relative z-10 mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-8 lg:mx-0 lg:ml-[400px] lg:max-w-none">
          <div className="np-glass-card flex flex-col items-center rounded-[30px] px-8 py-9 text-center">
            <span className="text-white/60">
              <Icon d={P.lyrics} size={34} />
            </span>
            <p className="font-display mt-5 text-[22px] text-white">No lyrics for this song yet</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              {loadError
                ? "Lyrics couldn't be loaded just now."
                : `LRCLib doesn't have “${track.title}” yet — nothing made up, just an honest blank.`}
            </p>
            {loadError && (
              <button
                type="button"
                onClick={onRetry}
                className="np-seg-pill np-press mt-5 rounded-full px-5 py-2 text-[12px] tracking-[0.18em] text-white uppercase"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mini-player pinned under the lyrics — a floating Liquid
          Glass card in the Now Playing material (.np-glass-card,
          30px radius): cover + title/artist + tabular time, the
          white pill progress bar, and white prev / play-pause /
          next with the np-press scale(0.9) tactile press. */}
      <div className="relative z-10 flex-none px-5 pb-[max(env(safe-area-inset-bottom),12px)] lg:hidden">
        <div className="np-glass-card mx-auto max-w-xl rounded-[30px] px-5 pt-4 pb-5">
          <div className="flex items-center gap-3">
            <img src={smallThumb(track.thumbnail)} alt="" className="h-11 w-11 flex-none rounded-[12px] border border-white/15 object-cover object-center" loading="lazy" decoding="async" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-white">{track.title}</p>
              <p className="truncate text-[12px] text-white/[0.78]">{track.artist}</p>
            </div>
            <span className="flex-none text-[11px] text-white/75 tabular-nums">
              {fmt(currentTime)} / {fmt(duration)}
            </span>
          </div>
          <div className="mt-3 h-[6px] overflow-hidden rounded-full bg-white/[0.28]">
            <div className="h-full w-full origin-left bg-white transition-transform duration-1000 [transition-timing-function:linear]" style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
          <div className="mt-2 flex items-center justify-center gap-9">
            <button
              type="button"
              onClick={onPrev}
              aria-label="Previous song"
              className="np-press flex h-11 w-11 items-center justify-center text-white"
            >
              <Icon d={P.prev} size={24} filled />
            </button>
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
              aria-pressed={isPlaying}
              className="np-press flex h-12 w-12 items-center justify-center text-white"
            >
              {isPlaying ? <PauseIcon size={28} /> : <Icon d={P.play} size={28} filled />}
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label="Next song"
              className="np-press flex h-11 w-11 items-center justify-center text-white"
            >
              <Icon d={P.next} size={24} filled />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Collection card (live album / playlist) ---------------- */

type MusicCard = ApiResponse<typeof api, "getHomeFeed">["albums"][number];

function CollectionCard({ card, onOpen }: { card: MusicCard; onOpen: (c: MusicCard) => void }) {
  const tiltRef = useRef<HTMLButtonElement | null>(null);
  const onTilt = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const el = tiltRef.current;
    if (!el || e.pointerType === "touch") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
    const ny = ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1;
    el.style.transform = `perspective(800px) rotateY(${(nx * 4).toFixed(2)}deg) rotateX(${(-ny * 4).toFixed(2)}deg) translateY(-3px)`;
  };
  const resetTilt = () => {
    const el = tiltRef.current;
    if (el) el.style.transform = "";
  };
  return (
    <button
      ref={tiltRef}
      type="button"
      onClick={() => onOpen(card)}
      onPointerMove={onTilt}
      onPointerLeave={resetTilt}
      aria-label={`Open ${card.kind} ${card.title}`}
      className="spatial-card metal-flat group relative overflow-hidden rounded-[28px] border border-white/10 text-left active:scale-[0.98]"
    >
      {card.thumbnail ? (
        <img src={fillThumb(card.thumbnail)} alt="" className="aspect-[1/1.02] w-full object-cover object-center" loading="lazy" decoding="async" />
      ) : (
        <div className="metal aspect-[1/1.02] w-full" />
      )}
      <span className="cover-band absolute inset-x-0 bottom-0 px-4 pt-3 pb-3.5">
        <span className="block truncate text-[14.5px] leading-snug font-bold text-white">{card.title}</span>
        <span className="mt-0.5 block truncate text-[12px] text-white/65">
          {card.subtitle || card.kind}
        </span>
      </span>
    </button>
  );
}

/* ---------------- Album grid card (Albums / Playlist pages) ----------------
   The reference grid card: the cover art alone in a large rounded
   square, then the title in bold white BELOW it with the artist
   dimmer underneath — no band over the art on grid pages. */

function AlbumGridCard({
  card,
  onOpen,
  onLongPress,
}: {
  card: MusicCard;
  onOpen: (c: MusicCard) => void;
  // The card's on-screen rect rides along so a confirmation can be
  // anchored over the exact card that was held, not the page bottom.
  onLongPress?: (c: MusicCard, rect: DOMRect) => void;
}) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFired = useRef(false);
  const holdStart = useRef<{ x: number; y: number } | null>(null);

  const clearHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    holdStart.current = null;
  };

  useEffect(() => clearHold, []);

  const startHold = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!onLongPress) return;
    holdFired.current = false;
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    holdStart.current = { x: e.clientX, y: e.clientY };
    const heldEl = e.currentTarget;
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      holdFired.current = true;
      try {
        navigator.vibrate?.(12);
      } catch {
        /* vibration is a nicety only */
      }
      onLongPress(card, heldEl.getBoundingClientRect());
    }, 550);
  };

  const moveHold = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!holdTimer.current || !holdStart.current) return;
    if (Math.abs(e.clientX - holdStart.current.x) > 10 || Math.abs(e.clientY - holdStart.current.y) > 10) {
      clearHold();
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        if (holdFired.current) {
          holdFired.current = false;
          return;
        }
        onOpen(card);
      }}
      onPointerDown={startHold}
      onPointerMove={moveHold}
      onPointerUp={clearHold}
      onPointerLeave={clearHold}
      onPointerCancel={clearHold}
      onContextMenu={onLongPress ? (e) => e.preventDefault() : undefined}
      aria-label={`Open ${card.kind} ${card.title}`}
      className={`group text-left transition-transform duration-150 active:scale-[0.97] ${onLongPress ? "select-none [-webkit-touch-callout:none]" : ""}`}
    >
      <span className="relative block overflow-hidden rounded-[20px] border border-white/10 shadow-[0_14px_30px_rgba(0,0,0,0.45)]">
        {card.thumbnail ? (
          <img src={fillThumb(card.thumbnail)} alt="" draggable={false} className="aspect-square w-full object-cover object-center" loading="lazy" decoding="async" />
        ) : (
          <span className="metal block aspect-square w-full" aria-hidden="true" />
        )}
      </span>
      <span className="mt-2.5 block truncate text-[14.5px] leading-snug font-bold text-white">{card.title}</span>
      <span className="mt-0.5 block truncate text-[12.5px] text-[var(--dim)]">{card.subtitle || card.kind}</span>
    </button>
  );
}

/* ---------------- Stacked cover carousel (Elements sheet) ----------------
   Front card centred, sharp and full-size; the cards behind it peek
   out on both sides, smaller, turned away and dimmer. Tap a side
   card (or the arrows) to bring it to the front; tap the front card
   to open it. A "Frosted centre" toggle swaps the front card for
   the blurred-glass variant from the same reference sheet. */

function StackCarousel({ cards, onOpen }: { cards: MusicCard[]; onOpen: (c: MusicCard) => void }) {
  const [frontIdx, setFrontIdx] = useState(0);
  const [frosted, setFrosted] = useState(false);
  const n = cards.length;
  if (n === 0) return null;
  const front = cards[((frontIdx % n) + n) % n];
  if (!front) return null;
  return (
    <div>
      <div className="stack-stage relative mx-auto h-[218px] w-full max-w-[520px]" role="group" aria-label="Stacked album carousel">
        {cards.map((c, i) => {
          let off = i - frontIdx;
          if (off > n / 2) off -= n;
          if (off < -n / 2) off += n;
          const abs = Math.abs(off);
          if (abs > 2) return null;
          const isFront = off === 0;
          const style: CSSProperties = {
            transform: `translateX(calc(-50% + ${off * 62}%)) translateZ(${-abs * 70}px) rotateY(${off * -16}deg) scale(${1 - abs * 0.12})`,
            zIndex: 10 - abs,
            opacity: abs === 2 ? 0.55 : 1,
            filter: isFront ? "none" : `brightness(${1 - abs * 0.22})`,
          };
          return (
            <button
              key={`stack-${c.id}`}
              type="button"
              onClick={() => (isFront ? onOpen(c) : setFrontIdx(i))}
              aria-label={isFront ? `Open ${c.kind} ${c.title}` : `Bring ${c.title} to the front`}
              className="stack-card absolute top-1 left-1/2 block w-[168px] overflow-hidden rounded-[24px] border border-white/15 text-left shadow-[0_20px_44px_rgba(0,0,0,0.5)]"
              style={style}
            >
              {isFront && frosted ? (
                <span className="stack-frost relative block aspect-square w-full">
                  {c.thumbnail && (
                    <img src={smallThumb(c.thumbnail)} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-md" aria-hidden="true" decoding="async" />
                  )}
                  <span className="absolute inset-x-0 bottom-0 px-3.5 pt-2.5 pb-3">
                    <span className="block truncate text-[13px] leading-snug font-bold text-white">{c.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-white/65">{c.subtitle || c.kind}</span>
                  </span>
                </span>
              ) : c.thumbnail ? (
                <img src={fillThumb(c.thumbnail)} alt="" className="block aspect-square w-full object-cover object-center" loading="lazy" decoding="async" />
              ) : (
                <span className="metal block aspect-square w-full" aria-hidden="true" />
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setFrontIdx((i) => i - 1)}
          aria-label="Previous album in the stack"
          className="glass-soft absolute top-1/2 left-0 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-white transition-transform duration-150 active:scale-[0.92]"
        >
          <Icon d={P.back} size={17} />
        </button>
        <button
          type="button"
          onClick={() => setFrontIdx((i) => i + 1)}
          aria-label="Next album in the stack"
          className="glass-soft absolute top-1/2 right-0 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-white transition-transform duration-150 active:scale-[0.92]"
        >
          <Icon d={P.chevronRight} size={17} />
        </button>
      </div>
      <div className="mt-1 text-center" key={front.id}>
        <p className="truncate px-8 text-[15px] font-bold text-white">{front.title}</p>
        <p className="mt-0.5 truncate px-8 text-[12.5px] text-[var(--dim)]">{front.subtitle || front.kind}</p>
        <button
          type="button"
          onClick={() => setFrosted((f) => !f)}
          aria-pressed={frosted}
          className={`mt-2.5 rounded-full px-4 py-1.5 text-[11.5px] tracking-[0.08em] uppercase transition-colors ${frosted ? "bg-white text-[#141416] font-semibold" : "glass-soft text-white/80"}`}
        >
          {frosted ? "Frosted centre · on" : "Frosted centre"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Library sidebar (reference) ----------------
   "Library / All Music", then Artists, Albums,
   Songs, Made For You; a Playlists group with All Playlists, the
   user's real live playlist cards and Liked Songs; Add Playlist;
   and Wallpaper at the foot — the background behind these frosted
   panels is the user's to change. */

type LibSection = "artists" | "albums" | "songs" | "made" | "allplaylists" | "wallpaper";

function LibrarySidebar({
  section,
  onSection,
  playlists,
  likedCount,
  onOpenCard,
  onAddPlaylist,
  compact = false,
}: {
  section: LibSection;
  onSection: (s: LibSection) => void;
  playlists: MusicCard[];
  likedCount: number;
  onOpenCard: (c: MusicCard) => void;
  onAddPlaylist?: () => void;
  compact?: boolean;
}) {
  const item = (key: LibSection, label: string, icon: string) => (
    <button
      key={key}
      type="button"
      onClick={() => onSection(key)}
      aria-current={section === key ? "page" : undefined}
      className={`lib-item ${section === key ? "is-active" : ""}`}
    >
      <span className="lib-ic">
        <Icon d={icon} size={18} />
      </span>
      {label}
    </button>
  );
  return (
    <div className={compact ? "" : "flex h-full flex-col"}>
      <div className="flex items-start justify-between px-3">
        <div>
          <p className="text-[21px] leading-tight font-bold text-white">Library</p>
          <p className="mt-0.5 text-[12px] text-[var(--dim)]">All Music</p>
        </div>
        <button
          type="button"
          onClick={() => onSection("wallpaper")}
          aria-label="Change the wallpaper behind the app"
          className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${section === "wallpaper" ? "bg-white/16 text-white" : "glass-soft text-white/75"}`}
        >
          <Icon d={P.image} size={16} />
        </button>
      </div>
      <nav className="mt-4 space-y-0.5 px-1.5" aria-label="Library sections">
        {item("artists", "Artists", P.micStand)}
        {item("albums", "Albums", P.archive)}
        {item("songs", "Songs", P.note)}
        {item("made", "Made For You", P.sparkle)}
      </nav>
      <button
        type="button"
        onClick={() => onSection("allplaylists")}
        className="mt-5 flex w-full items-center justify-between px-3 text-left"
        aria-label="Playlists"
      >
        <span className="text-[15px] font-semibold text-white">Playlists</span>
        <span className="text-[var(--dim)]">
          <Icon d={P.chevronRight} size={16} />
        </span>
      </button>
      <div className="mt-1.5 space-y-0.5 px-1.5">
        <button
          type="button"
          onClick={() => onSection("allplaylists")}
          aria-current={section === "allplaylists" ? "page" : undefined}
          className={`lib-item ${section === "allplaylists" ? "is-active" : ""}`}
        >
          <span className="lib-ic">
            <Icon d={P.grid} size={17} />
          </span>
          All Playlists
        </button>
        {playlists.slice(0, 3).map((c) => (
          <button
            key={`lib-pl-${c.id}`}
            type="button"
            onClick={() => onOpenCard(c)}
            className="lib-item"
            aria-label={`Open playlist ${c.title}`}
          >
            {c.thumbnail ? (
              <img src={smallThumb(c.thumbnail)} alt="" className="h-6 w-6 flex-none rounded-md object-cover" loading="lazy" decoding="async" />
            ) : (
              <span className="metal h-6 w-6 flex-none rounded-md" aria-hidden="true" />
            )}
            <span className="truncate">{c.title}</span>
          </button>
        ))}
        <button type="button" onClick={() => onSection("songs")} className="lib-item" aria-label="Open Liked Songs">
          <span className="glass-soft flex h-6 w-6 flex-none items-center justify-center rounded-md text-white">
            <Icon d={P.heart} size={12} filled />
          </span>
          <span className="truncate">Liked Songs</span>
          <span className="ml-auto flex-none text-[11.5px] text-[var(--dim)] tabular-nums">{likedCount}</span>
        </button>
        <button
          type="button"
          onClick={() => (onAddPlaylist ? onAddPlaylist() : onSection("allplaylists"))}
          className="lib-item"
          aria-label="Add Playlist — create a new playlist or import one from a link"
        >
          <span className="glass-soft flex h-6 w-6 flex-none items-center justify-center rounded-md text-white">
            <Icon d={P.plus} size={13} />
          </span>
          Add Playlist
        </button>
      </div>
      <div className={`px-1.5 ${compact ? "mt-4" : "mt-auto pt-5"}`}>
        <button
          type="button"
          onClick={() => onSection("wallpaper")}
          aria-current={section === "wallpaper" ? "page" : undefined}
          className={`lib-item ${section === "wallpaper" ? "is-active" : ""}`}
        >
          <span className="lib-ic">
            <Icon d={P.image} size={18} />
          </span>
          Wallpaper
        </button>
      </div>
    </div>
  );
}

/* ---------------- Add Playlist sheet ----------------
   Opened from the Library's "Add Playlist" entry. Two modes:
   "Create New" makes a blank playlist of the user's own;
   "Import from Link" takes a public YouTube / YouTube Music /
   Spotify playlist URL — the platform is auto-detected from the
   URL and badged beside the input, a preview fetch auto-fills
   the playlist name with the real fetched title (editable), and
   Import saves the playlist with every track already matched to
   a playable YouTube Music track, then opens it. */

type PlaylistPlatformUi = "youtube" | "spotify";

function detectPlaylistPlatform(raw: string): PlaylistPlatformUi | null {
  const input = raw.trim();
  if (/^spotify:playlist:[A-Za-z0-9]{10,40}$/.test(input)) return "spotify";
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "open.spotify.com" || host === "play.spotify.com") {
    return /\/(?:embed\/)?playlist\/[A-Za-z0-9]{10,40}/.test(url.pathname) ? "spotify" : null;
  }
  if (host === "youtube.com" || host === "music.youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    const list = url.searchParams.get("list") ?? "";
    return /^[A-Za-z0-9_-]{8,90}$/.test(list) ? "youtube" : null;
  }
  return null;
}

function AddPlaylistSheet({
  onClose,
  onOpenPlaylist,
}: {
  onClose: () => void;
  onOpenPlaylist: (card: MusicCard) => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"create" | "import">("import");
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const nameEditedRef = useRef(false);
  const [preview, setPreview] = useState<{ title: string; thumbnail: string; trackCount: number } | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const previewSeq = useRef(0);

  const platform = detectPlaylistPlatform(url);
  const urlTrimmed = url.trim();

  // Debounced preview: once the pasted link parses to a platform,
  // fetch the real playlist title / cover / track count and
  // auto-fill the name field (until the user edits it themselves).
  useEffect(() => {
    if (mode !== "import" || !platform || urlTrimmed.length < 12) {
      setPreview(null);
      setPreviewState("idle");
      setPreviewError(null);
      return;
    }
    const seq = ++previewSeq.current;
    setPreviewState("loading");
    setPreviewError(null);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await api.previewPlaylistImport({ url: urlTrimmed });
          if (previewSeq.current !== seq) return;
          if (res.ok) {
            setPreview({ title: res.title, thumbnail: res.thumbnail, trackCount: res.trackCount });
            setPreviewState("idle");
            if (!nameEditedRef.current) setName(res.title);
          } else {
            setPreview(null);
            setPreviewState("error");
            setPreviewError(res.error ?? "Couldn't load this playlist. Please make sure the link is valid and the playlist is set to Public.");
          }
        } catch {
          if (previewSeq.current !== seq) return;
          setPreview(null);
          setPreviewState("error");
          setPreviewError("Couldn't load this playlist. Please make sure the link is valid and the playlist is set to Public.");
        }
      })();
    }, 650);
    return () => clearTimeout(timer);
  }, [mode, platform, urlTrimmed]);

  const toCard = (p: { id: string; title: string; subtitle: string; thumbnail: string }): MusicCard => ({
    id: p.id,
    title: p.title,
    subtitle: p.subtitle,
    kind: "playlist",
    thumbnail: p.thumbnail,
  });

  const createMutation = useMutation({
    mutationFn: async (playlistName: string) => await api.createPlaylist({ name: playlistName }),
    onSuccess: (res) => {
      if (res.ok && res.playlist) {
        void queryClient.invalidateQueries({ queryKey: ["userPlaylists"] });
        onOpenPlaylist(toCard(res.playlist));
      } else {
        setCreateError(res.error ?? "That playlist could not be created. Try again.");
      }
    },
    onError: (error) => {
      setCreateError(error instanceof Error ? error.message : "That playlist could not be created. Try again.");
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => await api.importPlaylist({ url: urlTrimmed, ...(name.trim() ? { name: name.trim() } : {}) }),
    onSuccess: (res) => {
      if (res.ok && res.playlist) {
        void queryClient.invalidateQueries({ queryKey: ["userPlaylists"] });
        onOpenPlaylist(toCard(res.playlist));
      } else {
        setImportError(res.error ?? "Couldn't load this playlist. Please make sure the link is valid and the playlist is set to Public.");
      }
    },
    onError: (error) => {
      setImportError(error instanceof Error ? error.message : "Couldn't load this playlist. Please make sure the link is valid and the playlist is set to Public.");
    },
  });

  const busy = createMutation.isPending || importMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-playlist-title"
        className="vision-panel sheet-in w-full max-w-md rounded-t-[28px] p-5 sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="add-playlist-title" className="font-display text-[24px] leading-tight text-white">
            Add Playlist
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close Add Playlist"
            className="glass-soft flex h-9 w-9 flex-none items-center justify-center rounded-full text-white/80 transition-transform duration-150 active:scale-[0.94] disabled:opacity-50"
          >
            <Icon d={P.x} size={15} />
          </button>
        </div>

        <div className="glass-soft mt-4 flex rounded-full p-1" role="tablist" aria-label="Add Playlist mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "create"}
            onClick={() => setMode("create")}
            className={`flex-1 rounded-full px-4 py-2 text-[13px] tracking-[0.04em] transition-colors ${mode === "create" ? "bg-white font-semibold text-[#141416]" : "text-white/75"}`}
          >
            Create New
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "import"}
            onClick={() => setMode("import")}
            className={`flex-1 rounded-full px-4 py-2 text-[13px] tracking-[0.04em] transition-colors ${mode === "import" ? "bg-white font-semibold text-[#141416]" : "text-white/75"}`}
          >
            Import from Link
          </button>
        </div>

        {mode === "create" && (
          <div className="mt-5">
            <label className="text-[12.5px] tracking-[0.08em] text-[var(--dim)] uppercase" htmlFor="new-playlist-name">
              Playlist name
            </label>
            <input
              id="new-playlist-name"
              type="text"
              {...FIELDS.createPlaylist.name}
              value={createName}
              onChange={(e) => {
                setCreateName(e.target.value);
                setCreateError(null);
              }}
              placeholder="My new playlist"
              className="glass-soft mt-2 w-full rounded-full px-4 py-3 text-[14.5px] text-white outline-none placeholder:text-[var(--dim)]"
            />
            {createError && (
              <p className="mt-3 text-[13px] text-red-300" role="alert">
                {createError}
              </p>
            )}
            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="glass-soft flex-1 rounded-full px-5 py-2.5 text-[13px] tracking-[0.08em] text-white uppercase transition-transform duration-150 active:scale-[0.97] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!createName.trim()) {
                    setCreateError("Give your playlist a name first.");
                    return;
                  }
                  createMutation.mutate(createName.trim());
                }}
                disabled={busy}
                className="flex-1 rounded-full bg-white px-5 py-2.5 text-[13px] font-semibold tracking-[0.08em] text-[#141416] uppercase transition-transform duration-150 active:scale-[0.97] disabled:opacity-50"
              >
                {createMutation.isPending ? "Creating…" : "Create Playlist"}
              </button>
            </div>
          </div>
        )}

        {mode === "import" && (
          <div className="mt-5">
            <label className="text-[12.5px] tracking-[0.08em] text-[var(--dim)] uppercase" htmlFor="import-playlist-url">
              Playlist link
            </label>
            <div className="glass-soft mt-2 flex items-center gap-2 rounded-full py-1 pr-2 pl-4">
              <input
                id="import-playlist-url"
                type="url"
                {...FIELDS.previewPlaylistImport.url}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setImportError(null);
                }}
                placeholder="Paste YouTube, YouTube Music, or Spotify playlist URL..."
                className="w-full min-w-0 bg-transparent py-2 text-[14px] text-white outline-none placeholder:text-[var(--dim)]"
              />
              {platform === "youtube" && (
                <span className="flex flex-none items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold text-red-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
                  YouTube
                </span>
              )}
              {platform === "spotify" && (
                <span className="flex flex-none items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                  Spotify
                </span>
              )}
            </div>

            <label className="mt-4 block text-[12.5px] tracking-[0.08em] text-[var(--dim)] uppercase" htmlFor="import-playlist-name">
              Playlist Name
            </label>
            <input
              id="import-playlist-name"
              type="text"
              {...FIELDS.importPlaylist.name}
              value={name}
              onChange={(e) => {
                nameEditedRef.current = true;
                setName(e.target.value);
              }}
              placeholder="Playlist name"
              className="glass-soft mt-2 w-full rounded-full px-4 py-3 text-[14.5px] text-white outline-none placeholder:text-[var(--dim)]"
            />

            {previewState === "loading" && <p className="mt-3 text-[13px] text-[var(--dim)]">Loading playlist…</p>}
            {previewState === "idle" && preview && (
              <div className="mt-3 flex items-center gap-3">
                {preview.thumbnail ? (
                  <img src={smallThumb(preview.thumbnail)} alt="" className="h-11 w-11 flex-none rounded-[10px] object-cover" />
                ) : (
                  <span className="metal block h-11 w-11 flex-none rounded-[10px]" aria-hidden="true" />
                )}
                <p className="min-w-0 text-[13px] text-[var(--dim)]">
                  <span className="block truncate font-semibold text-white">{preview.title}</span>
                  {preview.trackCount} {preview.trackCount === 1 ? "song" : "songs"}
                  {platform === "spotify" ? " · each song will be matched on YouTube Music" : ""}
                </p>
              </div>
            )}
            {previewState === "error" && previewError && (
              <p className="mt-3 text-[13px] text-red-300" role="alert">
                {previewError}
              </p>
            )}
            {importError && (
              <p className="mt-3 text-[13px] text-red-300" role="alert">
                {importError}
              </p>
            )}

            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="glass-soft flex-1 rounded-full px-5 py-2.5 text-[13px] tracking-[0.08em] text-white uppercase transition-transform duration-150 active:scale-[0.97] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!platform) {
                    setImportError("That doesn't look like a YouTube, YouTube Music, or Spotify playlist link.");
                    return;
                  }
                  setImportError(null);
                  importMutation.mutate();
                }}
                disabled={busy || previewState === "error"}
                aria-label="Import Playlist"
                className="flex-1 rounded-full bg-white px-5 py-2.5 text-[13px] font-semibold tracking-[0.08em] text-[#141416] uppercase transition-transform duration-150 active:scale-[0.97] disabled:opacity-50"
              >
                {importMutation.isPending ? "Importing tracks..." : "Import Playlist"}
              </button>
            </div>
            {importMutation.isPending && (
              <p className="mt-3 text-center text-[13px] text-[var(--dim)]">
                {platform === "spotify" ? "Fetching the playlist and matching every song on YouTube Music…" : "Fetching the playlist…"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Wallpaper settings ----------------
   The wallpaper behind the frosted panels is the user's choice:
   paste an image link, or upload an image from their own phone /
   system. Saved server-side (profile row / owned blob), applied
   everywhere, resettable to the default dark background anytime. */

function WallpaperSettings({
  kind,
  currentUrl,
  onApplyUrl,
  onUpload,
  onReset,
}: {
  kind: "none" | "url" | "upload";
  currentUrl: string | null;
  onApplyUrl: (url: string) => Promise<void>;
  onUpload: (file: File) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const applyUrl = async () => {
    const u = urlInput.trim();
    if (!u) {
      setError("Paste an image link first.");
      return;
    }
    try {
      new URL(u);
    } catch {
      setError("That doesn't look like a link. Paste the full image address, starting with https://");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onApplyUrl(u);
      setUrlInput("");
    } catch {
      setError("That link couldn't be saved. Check it and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 className="text-[24px] font-bold text-white">Wallpaper</h2>
      <p className="mt-1 max-w-[440px] text-[13.5px] leading-relaxed text-[var(--dim)]">
        The picture behind the frosted panels — on the Album, Playlist and Library pages. Use one of your own: paste an
        image link, or upload a photo from this device.
      </p>

      {currentUrl ? (
        <div className="mt-5 overflow-hidden rounded-[22px] border border-white/12">
          <img src={currentUrl} alt="Your current wallpaper" className="h-40 w-full object-cover" />
          <div className="flex items-center justify-between gap-3 bg-black/35 px-4 py-3">
            <p className="text-[12.5px] text-white/75">
              {kind === "upload" ? "Uploaded from this device" : "From your image link"}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                onReset()
                  .catch(() => setError("The wallpaper couldn't be reset. Try again."))
                  .finally(() => setBusy(false));
              }}
              className="flex-none rounded-full border border-white/20 px-4 py-1.5 text-[11.5px] tracking-[0.1em] text-white uppercase transition-transform duration-100 active:scale-[0.97] disabled:opacity-50"
            >
              Use default
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-5 rounded-[18px] border border-white/10 bg-black/25 px-4 py-3 text-[13px] text-white/70">
          Right now: the default dark background.
        </p>
      )}

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          void applyUrl();
        }}
      >
        <label className="block text-[11px] tracking-[0.2em] text-[var(--dim)] uppercase" htmlFor="wallpaper-url">
          Image link
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="wallpaper-url"
            type="url"
            inputMode="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://…/your-picture.jpg"
            className="min-w-0 flex-1 rounded-full border border-white/12 bg-black/30 px-4 py-2.5 text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--dim)]"
          />
          <button
            type="submit"
            disabled={busy}
            className="flex-none rounded-full bg-[#f3f3f6] px-5 py-2.5 text-[12px] font-semibold tracking-[0.1em] text-[#232329] uppercase transition-transform duration-100 active:scale-[0.97] disabled:opacity-50"
          >
            {busy ? "Saving…" : "Apply"}
          </button>
        </div>
      </form>

      <div className="mt-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-[11px] tracking-[0.2em] text-[var(--dim)] uppercase">or</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-full border border-white/16 px-5 py-3 text-[12.5px] tracking-[0.1em] text-white uppercase transition-transform duration-100 active:scale-[0.98] disabled:opacity-50"
      >
        <Icon d={P.image} size={17} />
        Upload from this device
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        aria-label="Choose a wallpaper image from this device"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          setError(null);
          onUpload(f)
            .catch(() => setError("That photo couldn't be uploaded. Try a different one."))
            .finally(() => setBusy(false));
        }}
      />
      {error && (
        <p className="mt-3 text-[13px] text-[#e8a0a0]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------------- My Profile ----------------
   Everything here is computed from the user's real listening
   history: plays recorded by recordPlay, Liked Songs, and the
   song lengths stored with each play. Small history → honestly
   small numbers. */

type ProfileData = ApiResponse<typeof api, "getProfile">;
type ProfileStats = ApiResponse<typeof api, "getProfileStats">;
type ProfileRange = "today" | "week" | "month" | "semester";

function fmtListened(totalSec: number): string {
  if (totalSec <= 0) return "0 min";
  const mins = Math.round(totalSec / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

function ProfileSection({
  profile,
  profileLoading,
  stats,
  statsLoading,
  range,
  onRangeChange,
  isCurrent,
  isPlaying,
  isLiked,
  onPlayTrack,
  onToggleLikeTrack,
  onSearchArtist,
  onSaveProfile,
  onAvatarChosen,
}: {
  profile: ProfileData | null;
  profileLoading: boolean;
  stats: ProfileStats | null;
  statsLoading: boolean;
  range: ProfileRange;
  onRangeChange: (r: ProfileRange) => void;
  isCurrent: (videoId: string) => boolean;
  isPlaying: boolean;
  isLiked: (videoId: string) => boolean;
  onPlayTrack: (track: Track, list: Track[]) => void;
  onToggleLikeTrack: (track: Track) => void;
  onSearchArtist: (name: string) => void;
  onSaveProfile: (displayName: string, bio: string) => Promise<void>;
  onAvatarChosen: (file: File) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [bioInput, setBioInput] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* Display name lives only on this device (localStorage, default
     "user") — it is never read from the server profile, so no other
     person's name can ever appear here. */
  const [localName, setLocalName] = useState<string>(() => getProfileName());
  const name = localName;
  const ranges: [ProfileRange, string][] = [
    ["today", "Today"],
    ["week", "This week"],
    ["month", "This month"],
    ["semester", "This semester"],
  ];

  const topTracks: Track[] = (stats?.topSongs ?? []).map((s) => ({
    videoId: s.videoId,
    title: s.title,
    artist: s.artist,
    album: s.album,
    duration: s.duration,
    thumbnail: s.thumbnail,
  }));

  return (
    <section className="rise pt-5" aria-label="Your profile">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[34px] leading-tight">{profileLoading ? "…" : name}</h1>
          <div className="mt-4 flex gap-6">
            <div>
              <p className="text-[19px] font-semibold text-[var(--text)] tabular-nums">
                {stats ? fmtListened(stats.totalListenedSec) : "—"}
              </p>
              <p className="text-[12px] text-[var(--dim)]">Listened</p>
            </div>
            <div>
              <p className="text-[19px] font-semibold text-[var(--text)] tabular-nums">{stats ? stats.distinctSongs : "—"}</p>
              <p className="text-[12px] text-[var(--dim)]">Songs</p>
            </div>
            <div>
              <p className="text-[19px] font-semibold text-[var(--text)] tabular-nums">{stats ? stats.distinctArtists : "—"}</p>
              <p className="text-[12px] text-[var(--dim)]">Artists</p>
            </div>
            <div>
              <p className="text-[19px] font-semibold text-[var(--text)] tabular-nums">{stats ? stats.likedCount : "—"}</p>
              <p className="text-[12px] text-[var(--dim)]">Liked</p>
            </div>
          </div>
        </div>
        <div className="flex flex-none flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Change your profile photo"
            className="silver-glow relative block h-[92px] w-[92px] overflow-hidden rounded-full border-2 border-[rgba(255,255,255,0.45)] transition-transform duration-150 active:scale-[0.96]"
          >
            {profile?.avatarUrl ? (
              <img src={profile.avatarUrl} alt="Your profile photo" className="h-full w-full object-cover" />
            ) : (
              <span className="metal flex h-full w-full items-center justify-center text-[34px] font-semibold text-[var(--accent)]">
                {name.charAt(0).toUpperCase() || "U"}
              </span>
            )}
          </button>
          <span className="text-[10px] tracking-[0.14em] text-[var(--dim)] uppercase">Tap to change</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            aria-label="Choose a new profile photo"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onAvatarChosen(f);
            }}
          />
        </div>
      </div>

      {profile?.bio && !editing && <p className="mt-3 text-[14px] leading-relaxed text-[var(--text)]">{profile.bio}</p>}

      {!editing ? (
        <button
          type="button"
          onClick={() => {
            setNameInput(name);
            setBioInput(profile?.bio ?? "");
            setSaveError(null);
            setEditing(true);
          }}
          aria-label="Edit your profile name and bio"
          className="metal-flat mt-4 rounded-full border border-white/10 px-5 py-2 text-[12px] tracking-[0.16em] text-[var(--accent)] uppercase transition-transform duration-150 active:scale-[0.97]"
        >
          Edit profile
        </button>
      ) : (
        <form
          className="metal-flat mt-4 rounded-3xl border border-white/10 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nameInput.trim()) {
              setSaveError("Your name can't be empty.");
              return;
            }
            setSaving(true);
            setSaveError(null);
            /* Name is saved only on this device; the server call
               below saves just the bio. */
            setProfileName(nameInput.trim());
            setLocalName(nameInput.trim());
            onSaveProfile(nameInput.trim(), bioInput.trim())
              .then(() => setEditing(false))
              .catch(() => setSaveError("That didn't save. Try again."))
              .finally(() => setSaving(false));
          }}
        >
          <label className="block text-[11px] tracking-[0.2em] text-[var(--dim)] uppercase" htmlFor="profile-name">
            Display name
          </label>
          <input
            id="profile-name"
            type="text"
            value={nameInput}
            maxLength={40}
            onChange={(e) => setNameInput(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-[15px] text-[var(--text)] outline-none"
          />
          <label className="mt-4 block text-[11px] tracking-[0.2em] text-[var(--dim)] uppercase" htmlFor="profile-bio">
            Bio
          </label>
          <textarea
            id="profile-bio"
            value={bioInput}
            maxLength={160}
            rows={3}
            onChange={(e) => setBioInput(e.target.value)}
            placeholder="A line or two about you and your music"
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--dim)]"
          />
          {saveError && (
            <p className="mt-2 text-[13px] text-[#e8a0a0]" role="alert">
              {saveError}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="metal silver-glow rounded-full border border-white/10 px-5 py-2 text-[12px] tracking-[0.16em] uppercase transition-transform duration-150 active:scale-[0.97] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-full border border-white/10 px-5 py-2 text-[12px] tracking-[0.16em] text-[var(--dim)] uppercase"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="shelf-fade mt-6 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Stats time range">
        {ranges.map(([r, label]) => (
          <button
            key={r}
            type="button"
            onClick={() => onRangeChange(r)}
            aria-pressed={range === r}
            className={`flex-none rounded-full px-4 py-2 text-[13px] transition-colors ${
              range === r ? "bg-[#f3f3f6] font-semibold text-[#232329]" : "metal-flat border border-white/10 text-[var(--text)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {statsLoading && <p className="pt-8 text-sm text-[var(--dim)]">Adding up your listening…</p>}

      {stats && stats.totalPlays === 0 && (
        <p className="pt-8 text-sm leading-relaxed text-[var(--dim)]">
          No plays recorded in this period yet. Play a song and your real numbers will start showing up here — nothing is
          made up.
        </p>
      )}

      {stats && stats.mostArtist && (
        <div className="metal-flat tile-shadow mt-5 flex items-center gap-4 rounded-[24px] border border-white/10 p-4">
          <img src={smallThumb(stats.mostArtist.thumbnail)} alt="" className="h-[76px] w-[76px] flex-none rounded-[18px] object-cover" loading="lazy" decoding="async" />
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.26em] text-[var(--dim)] uppercase">Most listened artist</p>
            <p className="font-display mt-1 truncate text-[21px] text-[var(--text)]">{stats.mostArtist.name}</p>
            <p className="mt-0.5 text-[13px] text-[var(--dim)]">
              {stats.mostArtist.plays} {stats.mostArtist.plays === 1 ? "time" : "times"}
            </p>
          </div>
        </div>
      )}

      {stats && stats.topSongs.length > 0 && (
        <>
          <h2 className="font-display mt-8 mb-2 text-[22px]">Most listened songs</h2>
          <div className="space-y-1">
            {stats.topSongs.map((s, i) => {
              const track = topTracks[i];
              if (!track) return null;
              return (
                <div key={s.videoId} className="relative">
                  <div className={`flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors duration-200 hover:bg-white/[0.06] ${isCurrent(s.videoId) ? "bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : ""}`}>
                    <span className="font-display w-6 flex-none text-center text-[17px] text-[var(--accent)] tabular-nums">{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => onPlayTrack(track, topTracks)}
                      aria-label={`Play ${s.title} by ${s.artist}`}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="relative block h-12 w-12 flex-none overflow-hidden rounded-xl">
                        <img src={smallThumb(s.thumbnail)} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                        {isCurrent(s.videoId) && (
                          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
                            {isPlaying ? <EqBars /> : <Icon d={P.play} size={16} filled />}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] text-[var(--text)]">{s.title}</span>
                        <span className="block truncate text-[12.5px] text-[var(--dim)]">
                          {s.artist} · {s.minutes} min
                        </span>
                      </span>
                    </button>
                    <span className="glass-soft flex-none rounded-full px-3 py-1 text-[12px] text-[var(--text)] tabular-nums">
                      {s.plays} {s.plays === 1 ? "time" : "times"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenMenuId(openMenuId === s.videoId ? null : s.videoId)}
                      aria-label={`More options for ${s.title}`}
                      aria-expanded={openMenuId === s.videoId}
                      className="flex h-9 w-7 flex-none items-center justify-center rounded-full text-[var(--dim)]"
                    >
                      <Icon d={P.dots} size={19} />
                    </button>
                  </div>
                  {openMenuId === s.videoId && (
                    <div className="glass-soft rise mx-2 mb-1 flex flex-wrap gap-2 rounded-2xl px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuId(null);
                          onToggleLikeTrack(track);
                        }}
                        className="glass-soft rounded-full px-3.5 py-1.5 text-[12px] text-[var(--text)]"
                      >
                        {isLiked(s.videoId) ? "Remove from Liked" : "Add to Liked"}
                      </button>
                      <a
                        href={`https://www.youtube.com/watch?v=${s.videoId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="glass-soft rounded-full px-3.5 py-1.5 text-[12px] text-[var(--text)]"
                      >
                        Watch on YouTube
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {stats && stats.topArtists.length > 0 && (
        <>
          <h2 className="font-display mt-8 mb-3 text-[22px]">Most listened artists</h2>
          <div className="shelf-fade flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {stats.topArtists.map((a) => (
              <button
                key={a.name}
                type="button"
                onClick={() => onSearchArtist(a.name)}
                aria-label={`Search songs by ${a.name}`}
                className="w-[76px] flex-none text-center transition-transform duration-150 active:scale-[0.96]"
              >
                <img src={smallThumb(a.thumbnail)} alt="" className="mx-auto h-[68px] w-[68px] rounded-full border border-white/15 object-cover" loading="lazy" decoding="async" />
                <span className="mt-1.5 block truncate text-[12px] text-[var(--text)]">{a.name}</span>
                <span className="block text-[11px] text-[var(--dim)] tabular-nums">
                  {a.plays} {a.plays === 1 ? "play" : "plays"}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}


/* ---------------- Voice search sheet ----------------
   Liquid-glass pop-up shown when the microphone is tapped. It only
   ever shows "Listening…" while a REAL Web Speech recognition session
   is running; the waveform bars are driven by the live transcript /
   result events (and a gentle idle pulse while waiting for speech).
   If the browser has no speech recognition, or it errors / hears
   nothing, the sheet switches to an honest unavailable state — never
   a fake listening animation with nothing behind it. Motion follows
   ux-motion + Emil: pop-in 200ms ease-out from the trigger (bottom
   centre), close 120ms ease-in, transform + opacity only, press
   scale 0.97, 44px+ targets, reduced-motion = plain fade. */

type VoiceState = "listening" | "heard" | "unavailable";

function VoiceSearchSheet({
  state,
  transcript,
  onClose,
  onRetry,
  onTypeInstead,
}: {
  state: VoiceState;
  transcript: string;
  onClose: () => void;
  onRetry: () => void;
  onTypeInstead: () => void;
}) {
  const bars = [0.5, 0.9, 0.65, 1, 0.55, 0.85, 0.45, 0.95, 0.6, 0.8, 0.5, 0.7];
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Voice search">
      <button
        type="button"
        aria-label="Close voice search"
        onClick={onClose}
        className="voice-backdrop absolute inset-0 bg-black/55"
      />
      <div className="voice-sheet glass spatial-float relative mx-4 mb-[max(env(safe-area-inset-bottom),18px)] w-full max-w-sm rounded-[28px] px-6 pt-7 pb-6 text-center text-white sm:mb-0">
        {state === "listening" && (
          <>
            <div className="voice-mic mx-auto flex h-[76px] w-[76px] items-center justify-center rounded-full bg-white/12" aria-hidden="true">
              <Icon d={P.lyrics} size={34} />
            </div>
            <div className="mt-5 flex h-9 items-end justify-center gap-[5px]" aria-hidden="true">
              {bars.map((h, i) => (
                <span
                  key={i}
                  className="voice-bar w-[5px] rounded-full bg-white/85"
                  style={{ height: `${Math.round(h * 34)}px`, animationDelay: `${i * 55}ms` }}
                />
              ))}
            </div>
            <p className="font-display mt-4 text-[22px]">Listening…</p>
            <p className="mt-1 min-h-[20px] text-[13.5px] text-white/65">
              {transcript ? `“${transcript}”` : "Say a song or artist name"}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 min-h-[44px] rounded-full border border-white/20 px-6 py-2.5 text-[12px] tracking-[0.16em] uppercase transition-transform duration-100 active:scale-[0.97]"
            >
              Cancel
            </button>
          </>
        )}
        {state === "heard" && (
          <>
            <div className="mx-auto flex h-[76px] w-[76px] items-center justify-center rounded-full bg-white/12" aria-hidden="true">
              <Icon d={P.search} size={32} />
            </div>
            <p className="font-display mt-5 text-[22px]">Searching…</p>
            <p className="mt-1 text-[13.5px] text-white/65">“{transcript}”</p>
          </>
        )}
        {state === "unavailable" && (
          <>
            <div className="mx-auto flex h-[76px] w-[76px] items-center justify-center rounded-full bg-white/10 text-white/70" aria-hidden="true">
              <Icon d={P.lyrics} size={34} />
            </div>
            <p className="font-display mt-5 text-[21px] leading-snug">Voice search isn&rsquo;t available here</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-white/65">
              Type to search instead — every song is still one search away.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={onTypeInstead}
                className="min-h-[44px] rounded-full bg-[#f3f3f6] px-5 py-2.5 text-[12px] font-semibold tracking-[0.12em] text-[#232329] uppercase transition-transform duration-100 active:scale-[0.97]"
              >
                Type to search
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="min-h-[44px] rounded-full border border-white/20 px-5 py-2.5 text-[12px] tracking-[0.12em] uppercase transition-transform duration-100 active:scale-[0.97]"
              >
                Try again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- App ---------------- */

type Tab = "home" | "search" | "liked" | "profile" | "glass" | "about";

export function App() {
  const queryClient = useQueryClient();
  const likedQuery = useQuery({ queryKey: ["liked"], queryFn: () => api.listLiked({}) });

  // Speed Dial freshness: the query is keyed by a nonce that starts at
  // a per-mount random value and increments on every Refresh tap, and
  // staleTime is 0 — so it ALWAYS fetches a fresh, server-shuffled live
  // set. Nothing about Speed Dial is cached or seeded any more.
  const [speedNonce, setSpeedNonce] = useState(() => Math.floor(Math.random() * 1000000));
  const speedDial = useQuery({
    queryKey: ["speedDial", speedNonce],
    queryFn: () => api.getSpeedDial({ nonce: speedNonce }),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const refreshSpeedDial = useCallback(() => {
    setSpeedNonce((n) => n + 1 + Math.floor(Math.random() * 997));
  }, []);
  const likedTracks = useMemo<Track[]>(
    () =>
      (likedQuery.data?.liked ?? []).map((l) => ({
        videoId: l.videoId,
        title: l.title,
        artist: l.artist,
        album: l.album,
        duration: l.duration,
        thumbnail: l.thumbnail,
      })),
    [likedQuery.data],
  );
  const likedSet = useMemo(() => new Set(likedTracks.map((t) => t.videoId)), [likedTracks]);

  const [tab, setTab] = useState<Tab>("home");
  const [showSettings, setShowSettings] = useState(false);
  const [profileRange, setProfileRange] = useState<"today" | "week" | "month" | "semester">("month");
  // Voice search sheet (null = closed)
  const [voiceState, setVoiceState] = useState<VoiceState | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const voiceRecRef = useRef<{ stop: () => void } | null>(null);
  // v1.0.2: cleanup for the native (APK) voice session — the
  // stop function returned by startNativeVoiceSearch. Null on
  // web, where the Web Speech recognizer above is used instead.
  const voiceNativeStopRef = useRef<(() => void) | null>(null);
  const voiceHeardRef = useRef(false);
  // Playlist/collection page (reference layout): in-page track filter,
  // header pill menu, desktop detection + Now Playing side panel.
  const [listFilter, setListFilter] = useState("");
  const [showListSearch, setShowListSearch] = useState(false);
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  const [desktopPanelOpen, setDesktopPanelOpen] = useState(true);
  const [libSection, setLibSection] = useState<LibSection>("albums");
  const [libQuery, setLibQuery] = useState("");
  const [libSortAz, setLibSortAz] = useState(false);
  // All Playlists: holding a playlist card arms its removal — this
  // is the playlist waiting on the in-page confirm step (null =
  // no removal pending), plus the error if a removal fails.
  const [playlistToRemove, setPlaylistToRemove] = useState<MusicCard | null>(null);
  // Where the held card sits in the viewport, so the remove confirm
  // hovers centred over that card instead of at the page bottom.
  const [removeAnchor, setRemoveAnchor] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [removePlaylistError, setRemovePlaylistError] = useState<string | null>(null);
  // Add Playlist sheet (create blank / import from a link).
  const [showAddPlaylist, setShowAddPlaylist] = useState(false);
  // The user's own playlists (created + imported), shown ahead of
  // the live feed cards in All Playlists and the Library sidebar.
  const userPlaylistsQuery = useQuery({
    queryKey: ["userPlaylists"],
    queryFn: () => api.listUserPlaylists({}),
    staleTime: 1000 * 60,
  });
  const userPlaylistCards = useMemo<MusicCard[]>(
    () =>
      (userPlaylistsQuery.data?.playlists ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        subtitle: p.subtitle,
        kind: "playlist" as const,
        thumbnail: p.thumbnail,
      })),
    [userPlaylistsQuery.data],
  );
  const openAddedPlaylist = useCallback((card: MusicCard) => {
    setShowAddPlaylist(false);
    setTab("liked");
    setLibSection("allplaylists");
    setOpenCard(card);
  }, []);
  // Wallpaper behind the frosted panels: the user's own choice
  // (pasted link or device upload), saved server-side. null = the
  // default restrained dark background.
  const wallpaperQuery = useQuery({
    queryKey: ["wallpaper"],
    queryFn: () => api.getWallpaper({}),
    staleTime: 1000 * 60 * 5,
  });
  const wallpaperUrl = wallpaperQuery.data?.url ?? null;
  const goToLibrary = useCallback((s: LibSection) => {
    setLibSection(s);
    setTab("liked");
    setOpenCard(null);
  }, []);
  const handleWallpaperUpload = async (file: File) => {
    const objUrl = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image"));
        img.src = objUrl;
      });
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const cx = canvas.getContext("2d");
      if (!cx) throw new Error("canvas");
      cx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob) throw new Error("blob");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error("read"));
        r.readAsDataURL(blob);
      });
      const base64 = dataUrl.split(",")[1] ?? "";
      if (!base64) throw new Error("base64");
      await api.setWallpaperImage({ dataBase64: base64, mimeType: "image/jpeg" });
      void queryClient.invalidateQueries({ queryKey: ["wallpaper"] });
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  };
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* ----- Spatial UI: scroll parallax (background planes + dial tilt)
     One rAF-throttled passive listener. Writes only CSS custom
     properties / transforms — no React state, no layout reads beyond
     the dial's rect once per frame. Skipped entirely for reduced
     motion (CSS also neutralises the transforms there). ----- */
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        document.documentElement.style.setProperty("--sp-slow", `${Math.min(y * 0.07, 34)}px`);
        document.documentElement.style.setProperty("--sp-fast", `${Math.max(y * -0.035, -22)}px`);
        const dial = document.querySelector<HTMLElement>("[data-spatial-dial]");
        if (dial) {
          const r = dial.getBoundingClientRect();
          const vh = window.innerHeight || 1;
          const p = Math.max(-1, Math.min(1, (r.top + r.height / 2 - vh / 2) / vh));
          dial.style.setProperty("--dial-rx", `${(p * 3.5).toFixed(2)}deg`);
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // Popular Songs chart pagination (search tab idle state): the
  // server returns the full chart; the page shows 5 at a time and
  // the pill under the list steps through it. The rendered page
  // is clamped against the live song count, so a shorter chart
  // after a refetch can never strand the user on a missing page.
  const [popularPage, setPopularPage] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Set by a double-click / double-tap on a Search nav button: the
  // search input only exists once the Search tab renders, so the
  // handler flags the intent and the effect below focuses the
  // input (keyboard up, ready to type) as soon as the tab shows.
  const searchFocusPendingRef = useRef(false);

  const openSearchAndFocus = () => {
    setTab("search");
    setOpenCard(null);
    const el = searchInputRef.current;
    if (el) {
      // Already on the Search tab: focus synchronously inside the
      // gesture so the phone keyboard opens.
      searchFocusPendingRef.current = false;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
      searchFocusPendingRef.current = true;
    }
  };

  useEffect(() => {
    if (tab !== "search" || !searchFocusPendingRef.current) return;
    searchFocusPendingRef.current = false;
    const id = window.setTimeout(() => {
      const el = searchInputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(id);
  }, [tab]);

  const search = useQuery({
    queryKey: ["search", searchQuery],
    queryFn: () => api.searchMusic({ query: searchQuery }),
    enabled: tab === "search" && searchQuery.trim().length > 0,
  });

  // Debounced live search: typing settles for 450ms before a query
  // fires, instead of one request per keystroke.
  useEffect(() => {
    if (tab !== "search") return;
    const q = searchInput.trim();
    if (q === searchQuery) return;
    const id = window.setTimeout(() => setSearchQuery(q), 450);
    return () => window.clearTimeout(id);
  }, [searchInput, searchQuery, tab]);

  /* ----- playback state ----- */
  const [queue, setQueue] = useState<Track[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<0 | 1 | 2>(0);
  const [progress, setProgress] = useState({ t: 0, d: 0 });
  const [volume, setVolume] = useState(80);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // The full player has ONE view (the reference card layout):
  // cover-tinted frosted background, art card on top, frosted
  // control card below. The old full-bleed "art" view — cover as
  // the whole background with the title drawn over it and a Card
  // view pill on the art — was removed at the user's request
  // (20 Nov). Lyrics are their own sheet on top.
  // Dominant colour of the current cover, sampled on a tiny canvas
  // (the reference player's whole background is tinted from the
  // cover). Null when the image cannot be sampled — the player
  // then falls back to the blurred cover itself as the tint.
  const [coverTint, setCoverTint] = useState<{ r: number; g: number; b: number } | null>(null);
  // Dominant colours of the OPEN playlist / album cover, sampled
  // the same way as coverTint: `dominant` is the brightness-weighted
  // average, `vibrant` the saturation-weighted average. They drive
  // the collection page's ambient gradient glow (Echo-style), which
  // fades into the page's pure-dark #0B0B0D ground toward the
  // tracklist. Both null when the cover cannot be sampled — the
  // blurred cover layer still paints the ambient on its own.
  const [collectionPalette, setCollectionPalette] = useState<{
    dominant: { r: number; g: number; b: number };
    vibrant: { r: number; g: number; b: number };
  } | null>(null);
  const [sleepMin, setSleepMin] = useState(0);
  const [showQueue, setShowQueue] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [addingSimilar, setAddingSimilar] = useState(false);
  const [addSimilarNote, setAddSimilarNote] = useState<string | null>(null);
  const [showVideo, setShowVideo] = useState(false);
  // Liquid morph bookkeeping (reference video, 21 Nov): the
  // direction of the last poster switch (Next / Video = forward,
  // Previous / Song = backward) read by LiquidArt + SlidingTitle
  // at the moment a switch starts, and the in-flight Video ⇄ Song
  // mode morph — while it runs, the poster card melts between the
  // song artwork and the official-video poster, and the actual
  // mode flip commits underneath the melt (see requestModeSwitch).
  const navDirRef = useRef<1 | -1>(1);
  const [modeMorph, setModeMorph] = useState<{ toVideo: boolean } | null>(null);
  const modeMorphTimerRef = useRef<number | null>(null);
  const commitModeMorph = (m: { toVideo: boolean }) => {
    if (modeMorphTimerRef.current) {
      window.clearTimeout(modeMorphTimerRef.current);
      modeMorphTimerRef.current = null;
    }
    setShowVideo(m.toVideo);
    setModeMorph(null);
  };
  // Official-video swap bookkeeping: when Video mode resolves a
  // music video whose ID differs from the playing track's own
  // (usually audio-only) upload, the player is reloaded with the
  // MV at the same position and this ref remembers the pairing,
  // so leaving Video mode — or a fatal-error player rebuild —
  // can restore the right video. Null = the player holds the
  // track's own upload. The pairing also carries the MV's music
  // window (start/end of the actual song inside the video) and
  // its known non-music segments, so Video mode skips spoken
  // intros / dialogue / credits and the song timeline the UI
  // shows (scrubber, times, lyrics) is the SAME in both modes:
  // every position the UI handles is a song position, converted
  // to the loaded video's timeline only at the player boundary.
  const mvRef = useRef<{
    trackId: string;
    mvId: string;
    start: number;
    end: number;
    videoDur: number;
    segments: { start: number; end: number; category: string }[];
  } | null>(null);
  // Warm standby player (Video ⇄ Song pause fix): a SECOND YouTube
  // player, created lazily the first time a song plays, which holds
  // the OTHER version of the playing song — the official MV while
  // in Song mode, the song's own upload while in Video mode —
  // muted, and kept playing in lockstep by the progress poll. A
  // mode switch then just swaps which physical player `playerRef`
  // points at: the incoming version is already loaded, buffered
  // and at the right second, so there is no reload, no re-buffer
  // and no recreated iframe. When the standby has nothing warm
  // (not created yet, lookup still pending, no MV exists), the
  // switch falls back to swapLoadedVideo's single-player reload.
  const standbyRef = useRef<YTPlayer | null>(null);
  const standbyReadyRef = useRef(false);
  const standbyHostRef = useRef<HTMLDivElement | null>(null);
  const standbyCreatingRef = useRef(false);
  const createStandbyRef = useRef<() => void>(() => {});
  // What the standby currently holds: the counterpart video for
  // `trackId`, and the offset of the song's 0:00 inside it (the
  // MV's music-window start; 0 for the song upload).
  const standbyLoadedRef = useRef<{ trackId: string; videoId: string; start: number } | null>(null);
  // Which physical player is the active one: false = the original
  // player in hostRef, true = the standby in standbyHostRef. The
  // state mirror exists only so the two host divs can swap their
  // on-screen / parked styling when the active player changes.
  const activeIsBRef = useRef(false);
  const [activeSlotB, setActiveSlotB] = useState(false);
  const syncStandbyRef = useRef<() => void>(() => {});
  // Latest official-video lookup, mirrored into a ref for the
  // standby / swap helpers that run outside render.
  const officialVideoRef = useRef<ApiResponse<typeof api, "getOfficialVideo"> | null>(null);
  // Real-time shuffle: the queue order from before shuffle was
  // switched on (track object references), restored when shuffle
  // is switched off. Plus the queue list element and the FLIP
  // position snapshot used to animate the reorder.
  const preShuffleRef = useRef<Track[] | null>(null);
  const queueListRef = useRef<HTMLDivElement | null>(null);
  const flipSnapshotRef = useRef<Map<string, number> | null>(null);
  // Transient "Skipped the intro / a non-music part" note shown
  // in the player right after an automatic skip fires.
  const [skipNote, setSkipNote] = useState<string | null>(null);
  const skipNoteTimerRef = useRef(0);
  const [showLyrics, setShowLyrics] = useState(false);
  // Refresh lyrics (Lyrics view button): bumping the nonce swaps
  // the lyrics query to a fresh key whose fetch carries
  // forceRefresh, so the client cache AND the server's cached
  // LRCLib lookup are both bypassed and the lyrics are re-fetched
  // live, then re-synced to the live playback position by the
  // lyrics view. Refresh state drives the button's spinner and
  // the brief "Lyrics refreshed" confirmation.
  const [lyricsNonce, setLyricsNonce] = useState(0);
  const [lyricsRefreshState, setLyricsRefreshState] = useState<"idle" | "refreshing" | "done">("idle");
  const refreshLyrics = useCallback(() => {
    setLyricsRefreshState("refreshing");
    setLyricsNonce((n) => n + 1);
  }, []);
  const [openCard, setOpenCard] = useState<MusicCard | null>(null);

  // The home feed is the app's most expensive load (three YouTube
  // Music browse feeds + a dozen searches server-side). Keep it
  // fresh for 5 minutes: reopening the app or switching tabs shows
  // the cached feed instantly and only refetches in the background
  // once it's stale, instead of a full cold load every time.
  const homeFeed = useQuery({
    queryKey: ["homeFeed"],
    queryFn: () => api.getHomeFeed({}),
    staleTime: 1000 * 60 * 5,
  });
  const popular = useQuery({
    queryKey: ["popular"],
    queryFn: () => api.getPopular({}),
    enabled: tab === "search",
    staleTime: 1000 * 60 * 5,
  });

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.getProfile({}),
    enabled: tab === "profile",
  });
  const statsStartMs = useMemo(() => {
    const now = new Date();
    if (profileRange === "today") {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return d.getTime();
    }
    if (profileRange === "week") {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dow = (d.getDay() + 6) % 7; // Monday start
      d.setDate(d.getDate() - dow);
      return d.getTime();
    }
    if (profileRange === "month") {
      return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    }
    return new Date(now.getFullYear(), now.getMonth() - 6, 1).getTime();
  }, [profileRange]);
  const statsQuery = useQuery({
    queryKey: ["profileStats", profileRange],
    queryFn: () => api.getProfileStats({ startMs: statsStartMs }),
    enabled: tab === "profile",
  });
  const collection = useQuery({
    queryKey: ["collection", openCard?.id],
    queryFn: () =>
      openCard?.id.startsWith("user:")
        ? api.getUserPlaylist({ playlistId: openCard.id })
        : api.getCollection({ browseId: openCard?.id ?? "" }),
    enabled: !!openCard,
  });
  const openIsUserPlaylist = !!openCard?.id.startsWith("user:");

  const currentDurationSec = useMemo(() => {
    const d = queue[qIndex]?.duration ?? "";
    const m = /^(\d+):(\d{2})$/.exec(d);
    return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
  }, [queue, qIndex]);

  const lyricsQuery = useQuery({
    queryKey: ["lyrics", queue[qIndex]?.videoId, lyricsNonce],
    queryFn: () =>
      api.getLyrics({
        title: queue[qIndex]?.title ?? "",
        artist: queue[qIndex]?.artist ?? "",
        ...(currentDurationSec !== undefined ? { durationSec: currentDurationSec } : {}),
        ...(lyricsNonce > 0 ? { forceRefresh: true } : {}),
      }),
    enabled: showLyrics && !!queue[qIndex],
    staleTime: 1000 * 60 * 60,
  });

  // Refresh-lyrics confirmation: once the forced refetch settles,
  // flip to "done" briefly so the lyrics view can show its
  // "Lyrics refreshed" note; a failed refetch just resets.
  useEffect(() => {
    if (lyricsRefreshState !== "refreshing") return;
    if (lyricsQuery.isFetching) return;
    if (lyricsQuery.isError) {
      setLyricsRefreshState("idle");
      return;
    }
    if (lyricsQuery.data) {
      setLyricsRefreshState("done");
      const id = window.setTimeout(() => setLyricsRefreshState("idle"), 2600);
      return () => window.clearTimeout(id);
    }
  }, [lyricsRefreshState, lyricsQuery.isFetching, lyricsQuery.isError, lyricsQuery.data]);

  // Desktop Now Playing panel: the current lyric line, from the same
  // real LRCLib source as the lyrics sheet. It deliberately shares
  // the lyrics sheet's query key, so the same song's lyrics are
  // fetched once, not twice.
  const panelLyrics = useQuery({
    queryKey: ["lyrics", queue[qIndex]?.videoId, lyricsNonce],
    queryFn: () =>
      api.getLyrics({
        title: queue[qIndex]?.title ?? "",
        artist: queue[qIndex]?.artist ?? "",
        ...(currentDurationSec !== undefined ? { durationSec: currentDurationSec } : {}),
        ...(lyricsNonce > 0 ? { forceRefresh: true } : {}),
      }),
    enabled: isDesktop && desktopPanelOpen && !!queue[qIndex],
    staleTime: 1000 * 60 * 60,
  });

  // Official music video for the Video view: resolved lazily the
  // first time the user asks for video on this track, then cached
  // for an hour (the server caches the lookup too). The playing
  // track's own upload is usually audio-only, so this is a
  // different video ID whenever an official MV exists.
  const officialVideo = useQuery({
    queryKey: ["officialVideo", queue[qIndex]?.videoId],
    queryFn: () =>
      api.getOfficialVideo({
        title: queue[qIndex]?.title ?? "",
        artist: queue[qIndex]?.artist ?? "",
        ...(currentDurationSec !== undefined ? { durationSec: currentDurationSec } : {}),
      }),
    // Prefetched as soon as a song is playing (not only when the
    // player opens or Video is tapped): the warm standby player
    // needs the MV's identity early so it can load and buffer it
    // in the background, making the first Video ⇄ Song switch a
    // swap instead of a load. The server caches the lookup too.
    enabled: !!queue[qIndex],
    staleTime: 1000 * 60 * 60,
  });
  officialVideoRef.current = officialVideo.data ?? null;

  const current: Track | undefined = queue[qIndex];
  // Stable queue-row keys (see queueKeysFor): rows keep their
  // identity across reorders, so a shuffle moves rows on screen
  // instead of remounting the list.
  const qKeys = queueKeysFor(queue);

  // Sample the current cover's dominant colour for the player's
  // tinted background. Brightness-weighted average over a 24×24
  // downscale, skipping near-black / near-white pixels so dark
  // covers still yield their colour. Any failure (CORS, load)
  // leaves coverTint null and the blurred-cover fallback paints.
  const currentThumb = current?.thumbnail;
  const tintVideoId = current?.videoId;
  useEffect(() => {
    if (!currentThumb) {
      setCoverTint(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 24;
        const cx = canvas.getContext("2d");
        if (!cx) return;
        cx.drawImage(img, 0, 0, 24, 24);
        const data = cx.getImageData(0, 0, 24, 24).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let wSum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i] ?? 0;
          const pg = data[i + 1] ?? 0;
          const pb = data[i + 2] ?? 0;
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          if (max < 24 || min > 238) continue;
          const w = 0.35 + (max - min) / 255 + max / 510;
          r += pr * w;
          g += pg * w;
          b += pb * w;
          wSum += w;
        }
        if (!cancelled && wSum > 0) {
          setCoverTint({
            r: Math.round(r / wSum),
            g: Math.round(g / wSum),
            b: Math.round(b / wSum),
          });
        }
      } catch {
        if (!cancelled) setCoverTint(null);
      }
    };
    img.onerror = () => {
      if (!cancelled) setCoverTint(null);
    };
    img.src = currentThumb;
    return () => {
      cancelled = true;
    };
  }, [currentThumb, tintVideoId]);

  // Sample the open collection's cover for its ambient palette.
  // Same 24×24 canvas pass as the player tint, but two averages
  // are kept: the overall dominant colour and a saturation-led
  // one, so the glow has a soft base plus a livelier hotspot.
  const collectionThumb = openCard?.thumbnail;
  const collectionCardId = openCard?.id;
  useEffect(() => {
    if (!collectionThumb) {
      setCollectionPalette(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 24;
        const cx = canvas.getContext("2d");
        if (!cx) return;
        cx.drawImage(img, 0, 0, 24, 24);
        const data = cx.getImageData(0, 0, 24, 24).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let wSum = 0;
        let vr = 0;
        let vg = 0;
        let vb = 0;
        let vwSum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i] ?? 0;
          const pg = data[i + 1] ?? 0;
          const pb = data[i + 2] ?? 0;
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          if (max < 24 || min > 238) continue;
          const sat = (max - min) / 255;
          const w = 0.35 + sat + max / 510;
          r += pr * w;
          g += pg * w;
          b += pb * w;
          wSum += w;
          const vw = 0.08 + sat * sat * 2.2;
          vr += pr * vw;
          vg += pg * vw;
          vb += pb * vw;
          vwSum += vw;
        }
        if (!cancelled && wSum > 0 && vwSum > 0) {
          setCollectionPalette({
            dominant: { r: Math.round(r / wSum), g: Math.round(g / wSum), b: Math.round(b / wSum) },
            vibrant: { r: Math.round(vr / vwSum), g: Math.round(vg / vwSum), b: Math.round(vb / vwSum) },
          });
        }
      } catch {
        if (!cancelled) setCollectionPalette(null);
      }
    };
    img.onerror = () => {
      if (!cancelled) setCollectionPalette(null);
    };
    img.src = collectionThumb;
    return () => {
      cancelled = true;
    };
  }, [collectionThumb, collectionCardId]);

  // Ambient background layers for the full player: the last two
  // sampled tints are kept stacked so a track change crossfades
  // (800ms, .np-fade-in on the top layer) instead of snapping.
  const [ambientLayers, setAmbientLayers] = useState<{ id: string; tint: { r: number; g: number; b: number } }[]>([]);
  useEffect(() => {
    if (!coverTint || !tintVideoId) return;
    setAmbientLayers((prev) => {
      const next = [...prev.filter((l) => l.id !== tintVideoId), { id: tintVideoId, tint: coverTint }];
      return next.slice(-2);
    });
  }, [coverTint, tintVideoId]);

  const playerRef = useRef<YTPlayer | null>(null);
  const playerReadyRef = useRef(false);
  const pendingRef = useRef<{ videoId: string; autoplay: boolean } | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Latest volume, mirrored into a ref so the player's onReady (which
  // fires once, asynchronously) applies the level the user actually
  // chose instead of a hardcoded 80.
  const volumeRef = useRef(80);
  // When the user last moved an in-app volume slider. The progress
  // poll reads the player's REAL volume back so the slider always
  // reflects actual playback volume — but it must not fight the
  // user's own drag, so read-backs are ignored for a moment after
  // applyVolume runs.
  const lastVolumeChangeRef = useRef(0);
  // v1.0.3: same idea for the native echo. Every setNativeVolume
  // fires Android's VOLUME_CHANGED_ACTION, so the plugin echoes
  // the new system volume back — and the phone's media volume only
  // has ~16 steps, so the echo is quantised AND arrives late. On
  // a slow slide the echo matches and the >3 guard drops it; on a
  // fast slide the echoes carry stale intermediate values, each
  // more than 1pt away from the finger, so they yanked the slider
  // backwards mid-drag and the two fought each other — the
  // aggressive back-and-forth Naman reported. While a slider drag
  // is in flight, native echoes are ignored outright (until 300ms
  // after the last slider move); hardware-key presses still land,
  // because no slider move refreshes the window then.
  const suppressNativeEchoUntilRef = useRef(0);

  const stateRef = useRef({ queue, qIndex, repeat, shuffle, playing });
  stateRef.current = { queue, qIndex, repeat, shuffle, playing };
  const progressRef = useRef(progress);
  progressRef.current = progress;

  // The music window of whatever the player currently holds.
  // In Song mode the player holds the track's own upload and the
  // window is the whole video; in Video mode (mvRef set for the
  // playing track) it is the MV's music window from the server —
  // positions inside the window are the song, positions outside
  // it are the non-music intro / outro to skip. Reads only refs,
  // so the 500ms progress poll and the seek/swap helpers can call
  // it without stale closures.
  const loadedWindow = (): {
    isMv: boolean;
    start: number;
    end: number;
    videoDur: number;
    segments: { start: number; end: number; category: string }[];
  } => {
    const { queue: q, qIndex: i } = stateRef.current;
    const cur = q[i];
    const mv = mvRef.current;
    if (cur && mv && mv.trackId === cur.videoId) {
      return {
        isMv: true,
        start: mv.start,
        end: mv.end > mv.start ? mv.end : Number.POSITIVE_INFINITY,
        videoDur: mv.videoDur,
        segments: mv.segments,
      };
    }
    return { isMv: false, start: 0, end: Number.POSITIVE_INFINITY, videoDur: 0, segments: [] };
  };
  const loadedWindowRef = useRef(loadedWindow);
  loadedWindowRef.current = loadedWindow;

  // The standby's warm copy belongs to the track that was
  // playing; a new track invalidates it. It is paused and marked
  // empty — syncStandby re-warms it for the new track as soon as
  // that track's official video resolves.
  const resetStandby = () => {
    standbyLoadedRef.current = null;
    const s = standbyRef.current;
    if (s && standbyReadyRef.current) {
      try {
        s.pauseVideo();
      } catch {
        /* standby mid-teardown */
      }
    }
  };

  const playAt = (list: Track[], index: number) => {
    const t = list[index];
    if (!t) return;
    // A fresh pick morphs the poster forward; a mode morph still
    // melting is committed instantly — the track change
    // supersedes it.
    navDirRef.current = 1;
    if (modeMorph) commitModeMorph(modeMorph);
    let playList = list;
    // Starting a NEW list while shuffle is on keeps shuffle real:
    // the tapped song and everything before it keep their places,
    // the rest of the list enters the queue already shuffled, and
    // the list's own order is remembered so switching shuffle off
    // restores it. (Taps inside the current queue pass the queue
    // itself and never re-shuffle it.)
    if (list !== stateRef.current.queue) {
      if (stateRef.current.shuffle && list.length > 1) {
        preShuffleRef.current = [...list];
        playList = [...list.slice(0, index + 1), ...shuffleArr(list.slice(index + 1))];
      } else {
        preShuffleRef.current = null;
      }
    }
    resetStandby();
    setPlaybackError(null);
    setQueue(playList);
    setQIndex(index);
    setPlaying(true);
    setProgress({ t: 0, d: 0 });
    if (playerReadyRef.current && playerRef.current) {
      try {
        playerRef.current.loadVideoById(t.videoId);
      } catch {
        // The iframe can throw while it is mid-rebuild (host swap);
        // queue the load for onReady instead of losing the tap.
        pendingRef.current = { videoId: t.videoId, autoplay: true };
      }
    } else {
      pendingRef.current = { videoId: t.videoId, autoplay: true };
    }
  };

  const step = (dir: 1 | -1, fromEnd = false) => {
    const { queue: q, qIndex: i, repeat: r } = stateRef.current;
    if (q.length === 0) return;
    // Poster morph direction for this switch, and a mode morph
    // still melting is committed instantly — the track change
    // supersedes it.
    navDirRef.current = dir;
    if (modeMorph) commitModeMorph(modeMorph);
    // Repeat-one on a natural end: restart the same song in place.
    // (Checked first — the old order let the sequential branch run
    // and the restart only happened as a side path.)
    if (fromEnd && r === 2) {
      setPlaybackError(null);
      setPlaying(true);
      setProgress((p) => ({ t: 0, d: p.d }));
      if (playerReadyRef.current && playerRef.current) {
        try {
          // In Video mode "restart the song" means the music
          // window's start, not the video's 0:00 intro.
          const win = loadedWindowRef.current();
          playerRef.current.seekTo(win.isMv ? win.start : 0, true);
          playerRef.current.playVideo();
        } catch {
          const cur = q[i];
          if (cur) pendingRef.current = { videoId: cur.videoId, autoplay: true };
        }
      } else if (q[i]) {
        pendingRef.current = { videoId: q[i].videoId, autoplay: true };
      }
      return;
    }
    // Advance walks the queue in its VISIBLE order, both ways.
    // With shuffle on, toggleShuffle already reordered the queue
    // itself the moment shuffle was tapped, so sequential advance
    // IS the shuffled order — what the queue list shows is exactly
    // what plays next. (The old random-pick branch made playback
    // silently disagree with the on-screen queue.)
    let nextIdx = i + dir;
    if (nextIdx >= q.length) {
      if (fromEnd && r === 0) {
        // End of the queue with repeat off: stop, honestly.
        setPlaying(false);
        return;
      }
      nextIdx = 0;
    }
    if (nextIdx < 0) nextIdx = q.length - 1;
    const t = q[nextIdx];
    if (!t) return;
    resetStandby();
    setPlaybackError(null);
    setQIndex(nextIdx);
    setPlaying(true);
    setProgress({ t: 0, d: 0 });
    if (playerReadyRef.current && playerRef.current) {
      try {
        playerRef.current.loadVideoById(t.videoId);
      } catch {
        pendingRef.current = { videoId: t.videoId, autoplay: true };
      }
    } else {
      pendingRef.current = { videoId: t.videoId, autoplay: true };
    }
  };
  const stepRef = useRef(step);
  stepRef.current = step;

  // Create the YouTube players. Desktop Edge notes: the player
  // uses the privacy-enhanced host (youtube-nocookie.com), which does
  // not need the third-party cookies Edge's tracking prevention
  // blocks — with the regular host an Edge player can sit dead — and
  // an explicit origin playerVar, which the embed now requires to
  // accept API commands in several desktop browsers. If the API
  // script fails to load, creation retries instead of giving up.
  //
  // TWO players are created: the active one (exactly as before)
  // and a warm standby that holds the other version of the playing
  // song for instant Video ⇄ Song switches. The standby is created
  // lazily — the first time a song plays — so first paint still
  // carries a single iframe. The two are physical equals; "active"
  // and "standby" are roles that swap (tryWarmSwap), and every
  // event handler below checks identity against playerRef, so
  // only the ACTIVE player ever drives UI state — the standby
  // plays the same song muted and must never flip the play state
  // or advance the queue.
  useEffect(() => {
    let cancelled = false;
    // Host fallback chain (the web analogue of InnerTubeX's client
    // fallback): privacy-enhanced host first; if the ACTIVE player
    // dies with a fatal error (2/5), it is rebuilt once on the
    // standard host, in whichever host div it currently lives in.
    let hostSwapped = false;
    const makePlayer = (
      role: "active" | "standby",
      hostEl: HTMLElement | null,
      attempt: number,
      host = "https://www.youtube-nocookie.com",
    ) => {
      loadYouTubeApi()
        .then((YT) => {
          if (cancelled || !hostEl) return;
          if (role === "active" && playerRef.current) return;
          if (role === "standby" && standbyRef.current) return;
          const mount = document.createElement("div");
          mount.style.width = "100%";
          mount.style.height = "100%";
          hostEl.appendChild(mount);
          // Identity box: the handlers compare their own player
          // against playerRef / standbyRef, whose targets swap at
          // switch time — a closure over `player` directly could
          // not see itself before assignment.
          const box: { p: YTPlayer | null } = { p: null };
          const player = new YT.Player(mount, {
            // No videoId: nothing is preloaded. The first song the user taps loads itself.
            host,
            playerVars: {
              playsinline: 1,
              rel: 0,
              modestbranding: 1,
              enablejsapi: 1,
              origin: window.location.origin,
            },
            events: {
              onReady: () => {
                if (!box.p) return;
                if (box.p === standbyRef.current) {
                  standbyReadyRef.current = true;
                  try {
                    box.p.setVolume(0);
                  } catch {
                    /* a standby is silent by role; the swap sets its volume when it turns active */
                  }
                  // Warm it for whatever is playing right now.
                  syncStandbyRef.current();
                  return;
                }
                if (box.p !== playerRef.current) return;
                playerReadyRef.current = true;
                try {
                  playerRef.current?.setVolume(volumeRef.current);
                } catch {
                  /* volume re-applies on the next slider move */
                }
                const pending = pendingRef.current;
                if (pending) {
                  pendingRef.current = null;
                  try {
                    if (pending.autoplay) playerRef.current?.loadVideoById(pending.videoId);
                    else playerRef.current?.cueVideoById(pending.videoId);
                  } catch {
                    /* a fresh tap will re-issue the load */
                  }
                }
              },
              onStateChange: (e) => {
                if (!box.p || box.p !== playerRef.current) return;
                const YTS = ytWindow().YT?.PlayerState;
                if (!YTS) return;
                if (e.data === YTS.PLAYING) {
                  setPlaying(true);
                  setPlaybackError(null);
                } else if (e.data === YTS.PAUSED) setPlaying(false);
                else if (e.data === YTS.ENDED) stepRef.current(1, true);
              },
              onError: (e) => {
                if (!box.p) return;
                if (box.p === standbyRef.current) {
                  // A dead standby only loses the instant switch —
                  // Video ⇄ Song swaps fall back to the reload path.
                  standbyReadyRef.current = false;
                  standbyLoadedRef.current = null;
                  return;
                }
                if (box.p !== playerRef.current) return;
                // Fatal player errors (2/5): rebuild once on the
                // standard host before giving up — the fallback-chain
                // idea borrowed from InnerTubeX's client selection.
                if ((e.data === 2 || e.data === 5) && !hostSwapped && !cancelled) {
                  hostSwapped = true;
                  const cur = stateRef.current.queue[stateRef.current.qIndex];
                  if (cur) {
                    // If Video mode had swapped in the official
                    // MV, the rebuilt player re-queues the MV, not
                    // the track's audio upload.
                    const mv = mvRef.current;
                    pendingRef.current = {
                      videoId: mv && mv.trackId === cur.videoId ? mv.mvId : cur.videoId,
                      autoplay: true,
                    };
                  }
                  try {
                    playerRef.current?.destroy();
                  } catch {
                    /* already gone */
                  }
                  playerRef.current = null;
                  playerReadyRef.current = false;
                  const activeHost = activeIsBRef.current ? standbyHostRef.current : hostRef.current;
                  if (activeHost) activeHost.innerHTML = "";
                  makePlayer("active", activeHost, 0, "https://www.youtube.com");
                  return;
                }
                // 101/150: the video's owner blocks embedding; 100: not
                // found; 5/2: player/parameter trouble. Say so honestly
                // in the player instead of sitting silent.
                setPlaying(false);
                setPlaybackError(
                  e.data === 101 || e.data === 150
                    ? "This song can't be played inside the app — its owner blocks embedding. You can watch it on YouTube instead."
                    : "This song could not be played. Try another song, or watch it on YouTube.",
                );
              },
            },
          });
          box.p = player;
          if (role === "standby") standbyRef.current = player;
          else playerRef.current = player;
        })
        .catch(() => {
          if (cancelled || attempt >= 3) return;
          window.setTimeout(() => makePlayer(role, hostEl, attempt + 1, host), 1500);
        });
    };
    makePlayer("active", hostRef.current, 0);
    createStandbyRef.current = () => {
      if (standbyRef.current || standbyCreatingRef.current) return;
      standbyCreatingRef.current = true;
      makePlayer("standby", standbyHostRef.current, 0);
    };
    return () => {
      cancelled = true;
    };
  }, []);

  // Create the warm standby the first time anything is playing —
  // from then on it shadows every song (see syncStandby).
  const firstTrackId = queue[0]?.videoId;
  useEffect(() => {
    if (firstTrackId) createStandbyRef.current();
  }, [firstTrackId]);

  // Poll progress while the player exists — twice a second, and
  // state only changes when the displayed second actually changes,
  // so the homepage no longer re-renders several times a second.
  // The poll is also the Video-mode skip engine and the sync
  // layer between the two modes: it converts the loaded video's
  // raw position into SONG position (raw minus the music
  // window's start), so the scrubber, the displayed times and
  // the lyrics follow the song identically in Video and Song
  // modes, and switching modes never moves the song.
  useEffect(() => {
    // Previous raw position + which loaded video it belonged to:
    // a skip fires only when the playhead CROSSES INTO a
    // non-music segment while playing — never when the user has
    // deliberately seeked into one or is paused inside it.
    let prevRaw: number | null = null;
    let prevKey = "";
    let endFiredKey = "";
    const id = window.setInterval(() => {
      if (!playerReadyRef.current || !playerRef.current) return;
      try {
        const rawT = playerRef.current.getCurrentTime();
        const rawD = playerRef.current.getDuration();
        // Before metadata loads the iframe reports 0 / NaN; a NaN
        // here used to poison progress (seek bar max collapsed,
        // times rendered as NaN:NaN) until the next healthy tick.
        if (!Number.isFinite(rawT) || !Number.isFinite(rawD) || rawT < 0) return;
        // Keep the in-app slider honest: if the player's actual
        // volume drifted from the slider (a fresh video loaded at a
        // different level, or the embed's own volume control was
        // used in Video mode), pull the slider to the real playback
        // volume. Skipped for a moment after the user moves a
        // slider themselves, so a drag is never fought.
        if (Date.now() - lastVolumeChangeRef.current > 1500) {
          try {
            const pv = playerRef.current.getVolume();
            if (Number.isFinite(pv) && Math.abs(pv - volumeRef.current) > 1) {
              const rv = Math.round(Math.min(100, Math.max(0, pv)));
              volumeRef.current = rv;
              setVolume(rv);
            }
          } catch {
            /* embed without getVolume; the slider keeps its value */
          }
        }
        const win = loadedWindowRef.current();
        const { queue: q, qIndex: i, playing: isPlaying } = stateRef.current;
        const cur = q[i];
        const key = `${cur?.videoId ?? ""}|${win.isMv ? "mv" : "song"}`;
        if (key !== prevKey) {
          // A new song / a mode swap: positions from the old
          // loaded video must not look like a "crossing".
          prevKey = key;
          prevRaw = null;
        }
        // Re-arm the outro-end trigger once the playhead is well
        // before the end again (repeat-one loops back to the
        // music start and must be allowed to end again).
        if (endFiredKey && Number.isFinite(win.end) && rawT < win.end - 5) endFiredKey = "";

        // After an automatic skip the playhead has already moved;
        // the poll's "previous position" memory must follow it,
        // not the pre-skip reading.
        let effectiveRaw = rawT;
        if (win.isMv && isPlaying && cur) {
          // Effective skip list: the video's known non-music
          // segments, plus the window edges themselves (the
          // duration-comparison fallback knows no segments, only
          // where the music starts / ends).
          const segs = [...win.segments];
          if (win.start > 0.5 && !segs.some((s) => s.start <= 1.5)) {
            segs.push({ start: 0, end: win.start, category: "intro" });
          }
          if (
            Number.isFinite(win.end) &&
            win.videoDur > 0 &&
            win.end < win.videoDur - 0.5 &&
            !segs.some((s) => s.end >= win.videoDur - 1.5)
          ) {
            segs.push({ start: win.end, end: win.videoDur, category: "outro" });
          }
          for (const s of segs) {
            // prevRaw === null is the first tick on this loaded
            // video: playback STARTED inside the segment (a song
            // whose own upload is the MV begins at 0:00, inside
            // its intro) — that is a skip too, not a user seek.
            const crossedIn = prevRaw === null || prevRaw < s.start - 0.05;
            if (crossedIn && rawT >= s.start - 0.05 && rawT < s.end - 0.4) {
              if (win.videoDur > 0 && s.end >= win.videoDur - 1.5) {
                // An outro that runs to the end of the video:
                // the song is over — advance exactly like a
                // natural end (repeat / shuffle honoured by step).
                const fireKey = `${cur.videoId}|mv`;
                if (endFiredKey !== fireKey) {
                  endFiredKey = fireKey;
                  prevRaw = rawT;
                  stepRef.current(1, true);
                }
              } else {
                playerRef.current.seekTo(s.end + 0.05, true);
                setSkipNote(
                  s.category === "intro"
                    ? "Skipped the intro"
                    : s.category === "outro"
                      ? "Skipped the outro"
                      : "Skipped a non-music part",
                );
                window.clearTimeout(skipNoteTimerRef.current);
                skipNoteTimerRef.current = window.setTimeout(() => setSkipNote(null), 2600);
                effectiveRaw = s.end + 0.05;
              }
              break;
            }
          }
        }
        prevRaw = effectiveRaw;

        // Raw → song coordinates. In Song mode this is the
        // identity; in Video mode the music window is subtracted
        // so both modes share one timeline.
        const d = win.isMv
          ? Math.max(0, (Number.isFinite(win.end) ? win.end : rawD) - win.start) || rawD
          : rawD;
        const t = win.isMv ? Math.min(Math.max(effectiveRaw - win.start, 0), d) : effectiveRaw;

        // Warm-standby sync: the standby player holds the OTHER
        // version of this song (official MV ⇄ song upload), muted.
        // Keep it playing in lockstep with the active player —
        // same play/pause state, same song position (compared in
        // song coordinates, corrected when drift passes 0.8s) —
        // so a Video ⇄ Song switch swaps two in-sync players
        // instead of loading anything.
        const sl = standbyLoadedRef.current;
        if (sl && cur && sl.trackId === cur.videoId && standbyRef.current && standbyReadyRef.current) {
          try {
            const sp = standbyRef.current;
            const st = sp.getPlayerState();
            if (isPlaying) {
              if (st !== 1 && st !== 3) sp.playVideo();
              const sRaw = sp.getCurrentTime();
              if (Number.isFinite(sRaw) && Math.abs(sRaw - sl.start - t) > 0.8) {
                sp.seekTo(sl.start + t, true);
              }
            } else if (st === 1 || st === 3) {
              sp.pauseVideo();
            }
          } catch {
            /* standby mid-teardown; the next tick retries */
          }
        }

        setProgress((prev) =>
          Math.floor(prev.t) !== Math.floor(t) || Math.abs(prev.d - d) > 0.5 ? { t, d } : prev,
        );
      } catch {
        // The player object throws while it is being destroyed /
        // rebuilt (host fallback swap). Skip the tick — the next
        // one lands on the new player.
      }
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  // Sleep timer (the clock icon in the player): pauses playback when
  // it runs out. Set from the player's timer button, cycles off →
  // 15 → 30 → 60 minutes.
  useEffect(() => {
    if (sleepMin <= 0) return;
    const id = window.setTimeout(
      () => {
        try {
          playerRef.current?.pauseVideo();
        } catch {
          /* player mid-rebuild; the state flip below still applies */
        }
        setPlaying(false);
        setSleepMin(0);
      },
      sleepMin * 60 * 1000,
    );
    return () => window.clearTimeout(id);
  }, [sleepMin]);

  const togglePlayPause = () => {
    if (!current) return;
    const p = playerRef.current;
    if (!p || !playerReadyRef.current) {
      if (queue.length > 0) playAt(queue, qIndex);
      return;
    }
    // Optimistic flip: the old code waited for the iframe's
    // onStateChange to update `playing`, so a quick double-tap read
    // the same stale state twice and sent the same command twice —
    // the button looked dead or out of sync with the sound. The
    // state-change event still confirms (or corrects) this.
    try {
      if (playing) {
        p.pauseVideo();
        setPlaying(false);
      } else {
        p.playVideo();
        setPlaying(true);
      }
    } catch {
      if (queue.length > 0) playAt(queue, qIndex);
    }
  };

  // Seek through one guarded path: update the displayed position
  // immediately (the 500ms poll would otherwise snap the bar back),
  // and never let a mid-rebuild iframe throw into the UI. Callers
  // always pass a SONG position (the shared timeline); in Video
  // mode it is converted into the MV's timeline by adding the
  // music window's start, so seeking behaves identically in both
  // modes.
  const safeSeek = (sec: number) => {
    const songPos = Math.max(0, sec);
    setProgress((p) => ({ ...p, t: songPos }));
    if (playerReadyRef.current && playerRef.current) {
      try {
        const win = loadedWindowRef.current();
        playerRef.current.seekTo(win.isMv ? win.start + songPos : songPos, true);
      } catch {
        /* next poll re-syncs the displayed position */
      }
    }
    // The warm standby follows the same seek (in its own
    // timeline), so a mode switch right after a seek still lands
    // on the exact same second.
    const sl = standbyLoadedRef.current;
    const curT = stateRef.current.queue[stateRef.current.qIndex];
    if (standbyRef.current && standbyReadyRef.current && sl && curT && sl.trackId === curT.videoId) {
      try {
        standbyRef.current.seekTo(sl.start + songPos, true);
      } catch {
        /* the poll's drift correction re-syncs it */
      }
    }
  };

  const applyVolume = (v: number) => {
    setVolume(v);
    volumeRef.current = v;
    lastVolumeChangeRef.current = Date.now();
    if (playerReadyRef.current && playerRef.current) {
      try {
        playerRef.current.setVolume(v);
      } catch {
        /* player mid-rebuild; onReady re-applies volumeRef */
      }
    }
    // v1.0.1 (APK only): the in-app slider also moves the phone's
    // media volume, so slider == system volume == player volume.
    // No-op on the web build. The native volumeChange listener
    // below echoes back the same value, which the >3 guard there
    // drops, so a slider drag can never loop.
    void setNativeVolume(v / 100);
  };

  // v1.0.3: the only entry point for slider drags (mini-player
  // fader, PlayfulVolume, Now Playing). Marks the drag so the
  // native echo is suppressed while the finger is moving — see
  // suppressNativeEchoUntilRef above. Every other applyVolume
  // caller (hardware-key echoes, mount sync, poll) goes through
  // applyVolume directly and does NOT suppress.
  const applySliderVolume = (v: number) => {
    suppressNativeEchoUntilRef.current = Date.now() + 300;
    applyVolume(v);
  };

  // Reload the player with a different video for the SAME song
  // (audio upload ⇄ official music video) without losing the
  // place — the seamless Video ⇄ Song switch. The position is
  // carried across in SONG coordinates: the raw position is read
  // from the player, the outgoing video's music-window start
  // (fromStart) is subtracted, and the incoming video's window
  // start (targetStart) is added, so the song continues from the
  // exact same moment — no restart, no offset by the MV's intro
  // length. A paused player is cued at that position instead of
  // being forced to play; volume, queue and every control are
  // untouched because it is the same single player throughout.
  const swapLoadedVideo = (videoId: string, autoplay: boolean, targetStart: number, fromStart: number) => {
    const p = playerRef.current;
    if (!p || !playerReadyRef.current) {
      pendingRef.current = { videoId, autoplay: true };
      return;
    }
    try {
      const at = p.getCurrentTime();
      const raw = Number.isFinite(at) && at > 0 ? at : 0;
      const songPos = Math.max(0, raw - fromStart);
      const startAt = songPos + targetStart;
      if (autoplay) p.loadVideoById({ videoId, startSeconds: startAt });
      else p.cueVideoById({ videoId, startSeconds: startAt });
    } catch {
      pendingRef.current = { videoId, autoplay: true };
    }
  };

  // The instant Video ⇄ Song switch: when the warm standby already
  // holds the version being switched TO — loaded, buffered and
  // synced to the current second by the poll — the switch is a
  // pure role swap. The standby gets the user's volume and keeps
  // playing (or stays cued when paused); the old player is paused,
  // muted and becomes the new standby, still holding the version
  // just switched away from, so switching straight back is just
  // as instant. Nothing is loaded, re-buffered or recreated.
  // Returns false when the standby has nothing warm for this
  // switch, and the caller falls back to swapLoadedVideo.
  const tryWarmSwap = (targetVideoId: string, targetStart: number): boolean => {
    const s = standbyRef.current;
    const active = playerRef.current;
    const loaded = standbyLoadedRef.current;
    const { queue: q, qIndex: i, playing: isPlaying } = stateRef.current;
    const cur = q[i];
    if (!s || !active || !loaded || !cur) return false;
    if (!standbyReadyRef.current || !playerReadyRef.current) return false;
    if (loaded.trackId !== cur.videoId || loaded.videoId !== targetVideoId) return false;
    try {
      const outWin = loadedWindowRef.current();
      const outMv = mvRef.current;
      const raw = active.getCurrentTime();
      const songPos = Number.isFinite(raw) && raw > 0 ? Math.max(0, raw - outWin.start) : 0;
      // Correct any residual drift BEFORE the standby becomes
      // audible — a seek inside its already-buffered range is
      // instant, so the switch still lands gap-free.
      const sRaw = s.getCurrentTime();
      if (!Number.isFinite(sRaw) || Math.abs(sRaw - (targetStart + songPos)) > 0.4) {
        s.seekTo(targetStart + songPos, true);
      }
      s.setVolume(volumeRef.current);
      if (isPlaying) s.playVideo();
      else s.pauseVideo();
      active.pauseVideo();
      try {
        active.setVolume(0);
      } catch {
        /* it is re-muted by syncStandby / its next onReady anyway */
      }
      // Swap the roles: every control, the poll and the skip
      // engine talk to playerRef, which now points at the player
      // holding the incoming version.
      playerRef.current = s;
      standbyRef.current = active;
      const rdy = playerReadyRef.current;
      playerReadyRef.current = standbyReadyRef.current;
      standbyReadyRef.current = rdy;
      activeIsBRef.current = !activeIsBRef.current;
      setActiveSlotB(activeIsBRef.current);
      standbyLoadedRef.current = {
        trackId: cur.videoId,
        videoId: outWin.isMv && outMv ? outMv.mvId : cur.videoId,
        start: outWin.isMv ? outWin.start : 0,
      };
      return true;
    } catch {
      // A half-finished swap must never leave the standby audible
      // off-screen: re-mute it before the fallback reload runs.
      try {
        s.setVolume(0);
      } catch {
        /* standby already gone */
      }
      return false;
    }
  };

  // Keep the standby holding the counterpart of whatever the
  // ACTIVE player holds for the playing track: the official MV
  // while the song upload plays, the song upload while the MV
  // plays. The counterpart is loaded (or cued, when paused) at
  // the current song position so it buffers the part of the song
  // the user is actually hearing; the poll then keeps it in
  // lockstep. No counterpart exists when the lookup found no MV
  // or the track's own upload IS the MV — then there is nothing
  // to swap between and the standby idles.
  const syncStandby = () => {
    const s = standbyRef.current;
    if (!s || !standbyReadyRef.current) return;
    const { queue: q, qIndex: i, playing: isPlaying } = stateRef.current;
    const cur = q[i];
    if (!cur) return;
    const data = officialVideoRef.current;
    // Only a VERIFIED official video counts — a "none" result
    // (or anything else) means there is no counterpart to warm:
    // the standby must never hold a non-official upload.
    const mvId = data?.status === "official" ? (data?.videoId ?? null) : null;
    const win = loadedWindowRef.current();
    let target: { videoId: string; start: number } | null = null;
    if (win.isMv) {
      // Active holds a DISTINCT MV → warm the song upload. (When
      // the track's own upload is the MV, both "versions" are the
      // same video — there is no counterpart to hold.)
      const mv = mvRef.current;
      if (mv && mv.mvId !== cur.videoId) target = { videoId: cur.videoId, start: 0 };
    } else if (mvId && mvId !== cur.videoId) {
      target = { videoId: mvId, start: data?.musicStartSec ?? 0 };
    }
    if (!target) {
      if (standbyLoadedRef.current) {
        standbyLoadedRef.current = null;
        try {
          s.pauseVideo();
        } catch {
          /* standby mid-teardown */
        }
      }
      return;
    }
    const loaded = standbyLoadedRef.current;
    if (loaded && loaded.trackId === cur.videoId && loaded.videoId === target.videoId) {
      return; // already warm — the poll keeps it in sync
    }
    let songPos = 0;
    try {
      const raw = playerRef.current?.getCurrentTime() ?? 0;
      if (Number.isFinite(raw)) songPos = Math.max(0, raw - win.start);
    } catch {
      /* active player mid-rebuild; 0 is a safe cue point */
    }
    standbyLoadedRef.current = { trackId: cur.videoId, videoId: target.videoId, start: target.start };
    try {
      s.setVolume(0);
      if (isPlaying) s.loadVideoById({ videoId: target.videoId, startSeconds: target.start + songPos });
      else s.cueVideoById({ videoId: target.videoId, startSeconds: target.start + songPos });
    } catch {
      standbyLoadedRef.current = null;
    }
  };
  syncStandbyRef.current = syncStandby;

  // Video-mode swap driver. Entering Video mode with a resolved
  // MV loads the MV at the current song position (all the same
  // controls keep working — it is the same player); when the MV
  // IS the track's own upload (an official-video upload playing
  // as the song) nothing reloads at all — only the music window
  // is registered, so skipping still applies. Leaving Video mode
  // restores the track's own upload at the same song position.
  // A track change clears the pairing: playAt / step already
  // loaded the new track's own upload, and this track's MV
  // resolves through the query above.
  const mvData = officialVideo.data;
  // The swap driver keys off the OFFICIAL video only: status
  // "none" yields no mvVideoId, so no swap, no music window and
  // no standby counterpart can ever be built from a
  // non-official upload.
  const mvVideoId = mvData?.status === "official" ? (mvData?.videoId ?? null) : null;
  const mvTrackId = current?.videoId;

  // No official video → no Video mode. If the player is sitting
  // in Video mode when the lookup for the playing song resolves
  // to "none" (the song changed under it, or the lookup simply
  // found nothing official — Humsafar), flip straight back to
  // Song mode; the swap driver below then restores the song's
  // own upload at the same position, and the scrubber / lyrics
  // keep following the audio track's timeline throughout.
  useEffect(() => {
    if (showVideo && officialVideo.data && officialVideo.data.status !== "official") {
      setShowVideo(false);
    }
  }, [showVideo, officialVideo.data]);
  useEffect(() => {
    if (!mvTrackId) {
      mvRef.current = null;
      return;
    }
    if (mvRef.current && mvRef.current.trackId !== mvTrackId) {
      mvRef.current = null;
    }
    if (!showVideo) {
      const mv = mvRef.current;
      if (mv && mv.trackId === mvTrackId) {
        // Warm swap first (the standby is already playing the
        // song upload in sync, muted): tryWarmSwap reads the
        // outgoing music window from mvRef, so it runs BEFORE
        // the pairing is cleared. The single-player reload is
        // only the fallback for a cold standby.
        const warm = mv.mvId !== mvTrackId ? tryWarmSwap(mvTrackId, 0) : false;
        mvRef.current = null;
        if (mv.mvId !== mvTrackId && !warm) swapLoadedVideo(mvTrackId, playing, 0, mv.start);
        syncStandbyRef.current();
      }
      return;
    }
    if (!mvVideoId) return;
    if (mvRef.current?.mvId === mvVideoId && mvRef.current?.trackId === mvTrackId) return;
    const meta = {
      trackId: mvTrackId,
      mvId: mvVideoId,
      start: mvData?.musicStartSec ?? 0,
      end: mvData?.musicEndSec ?? 0,
      videoDur: mvData?.videoDurationSec ?? 0,
      segments: mvData?.segments ?? [],
    };
    const fromStart = mvRef.current?.trackId === mvTrackId ? mvRef.current.start : 0;
    const warm = mvVideoId !== mvTrackId ? tryWarmSwap(mvVideoId, meta.start) : false;
    mvRef.current = meta;
    if (mvVideoId !== mvTrackId && !warm) swapLoadedVideo(mvVideoId, playing, meta.start, fromStart);
    syncStandbyRef.current();
    // `playing` is read for the swap's autoplay choice only; the
    // mvRef guards make re-runs on play/pause toggles no-ops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVideo, mvVideoId, mvTrackId]);

  // Keep the standby warm for the current track and mode: cue its
  // counterpart whenever the official-video lookup lands, the
  // track changes, or the mode flips. Runs after the swap driver
  // above, so mvRef already describes the active player.
  useEffect(() => {
    syncStandbyRef.current();
  }, [showVideo, mvVideoId, mvTrackId]);

  // FLIP capture for the queue list: record each visible row's
  // position (keyed by its stable queue key) BEFORE a reorder, so
  // the layout effect below can start every row from its old
  // position and glide it to the new one. Skipped under reduced
  // motion and when the queue panel isn't on screen.
  const captureQueueFlip = () => {
    const el = queueListRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      flipSnapshotRef.current = null;
      return;
    }
    const keys = queueKeysFor(stateRef.current.queue);
    const map = new Map<string, number>();
    el.querySelectorAll<HTMLElement>(":scope > *").forEach((row, j) => {
      const k = keys[j];
      if (k) map.set(k, row.getBoundingClientRect().top);
    });
    flipSnapshotRef.current = map.size > 0 ? map : null;
  };

  // FLIP playback: after a queue reorder renders, any row whose
  // key was in the snapshot starts offset by (old top − new top)
  // and transitions to zero — the list visibly shuffles in place.
  // Runs on every queue change but only acts when toggleShuffle
  // captured a snapshot, so radio fills / appends never animate.
  useLayoutEffect(() => {
    const snap = flipSnapshotRef.current;
    if (!snap) return;
    flipSnapshotRef.current = null;
    const el = queueListRef.current;
    if (!el) return;
    const keys = queueKeysFor(queue);
    const moved: HTMLElement[] = [];
    el.querySelectorAll<HTMLElement>(":scope > *").forEach((row, j) => {
      const k = keys[j];
      const oldTop = k ? snap.get(k) : undefined;
      if (oldTop === undefined) return;
      const delta = oldTop - row.getBoundingClientRect().top;
      if (Math.abs(delta) < 2) return;
      row.style.transition = "none";
      row.style.transform = `translateY(${delta}px)`;
      row.style.zIndex = "2";
      moved.push(row);
    });
    if (moved.length === 0) return;
    // Force the offset state to paint, then release into the glide.
    void el.getBoundingClientRect();
    moved.forEach((row) => {
      row.style.transition = "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)";
      row.style.transform = "";
    });
    const id = window.setTimeout(() => {
      moved.forEach((row) => {
        row.style.transition = "";
        row.style.zIndex = "";
      });
    }, 480);
    return () => window.clearTimeout(id);
  }, [queue]);

  // The Shuffle button: toggling ON reorders the REAL queue right
  // now — the songs already played and the playing song keep their
  // places, everything up next is shuffled in place, and the queue
  // list on screen glides into the new order (FLIP above). Playback
  // then simply walks that order (see step). The pre-shuffle order
  // is remembered; toggling OFF restores it, with anything added
  // while shuffled keeping its place at the end.
  const toggleShuffle = () => {
    const { queue: q, qIndex: i } = stateRef.current;
    captureQueueFlip();
    if (!shuffle) {
      setShuffle(true);
      if (q.length > i + 1) {
        if (!preShuffleRef.current) preShuffleRef.current = [...q];
        setQueue([...q.slice(0, i + 1), ...shuffleArr(q.slice(i + 1))]);
      }
      return;
    }
    setShuffle(false);
    const saved = preShuffleRef.current;
    preShuffleRef.current = null;
    if (saved && q.length > 1) {
      const cur = q[i];
      const remaining = [...q];
      const restored: Track[] = [];
      for (const t of saved) {
        const j = remaining.indexOf(t);
        if (j >= 0) {
          restored.push(t);
          remaining.splice(j, 1);
        }
      }
      restored.push(...remaining);
      setQueue(restored);
      if (cur) {
        const ni = restored.indexOf(cur);
        if (ni >= 0 && ni !== i) setQIndex(ni);
      }
    }
  };

  // "Shuffle play" for a whole list (collection pages): play it
  // shuffled from the top with shuffle ON, remembering the list's
  // own order so toggling shuffle off restores it.
  const playShuffled = (list: Track[]) => {
    if (list.length === 0) return;
    playAt(shuffleArr(list), 0);
    // playAt ran against the previous shuffle state; record the
    // true original order now, over whatever it left behind.
    preShuffleRef.current = [...list];
    setShuffle(true);
  };

  // Stable handlers (with refs to the latest queue/current) so the
  // memoized TrackRows only re-render when their own props change.
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const currentRef = useRef(current);
  currentRef.current = current;
  const togglePlayPauseRef = useRef(togglePlayPause);
  togglePlayPauseRef.current = togglePlayPause;
  const playAtRef = useRef(playAt);
  playAtRef.current = playAt;
  const safeSeekRef = useRef(safeSeek);
  safeSeekRef.current = safeSeek;

  /* ----- Media Session: the phone's own media controls -----
     Browsers expose NO API to read or set the phone's system
     volume, so on the WEB the in-app slider cannot move the
     system volume bar itself (only a native app can). What the
     web CAN do — and what this wires up — is register with the
     OS media session: the lock-screen / notification controls
     then show this song and drive play / pause / next / previous
     / seek, the phone's media volume keys act on the playing
     media stream while it plays, and the in-app slider is kept
     equal to the player's real playback volume (applyVolume sets
     it, the poll reads it back).
     v1.0.1: inside the Android APK the native FrostoraAudio
     plugin (see the effect below) removes both limits — the
     slider drives the system volume, the hardware keys drive
     the slider, and a foreground service keeps audio playing
     in the background. */
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action not supported on this browser */
      }
    };
    set("play", () => {
      if (!stateRef.current.playing) togglePlayPauseRef.current();
    });
    set("pause", () => {
      if (stateRef.current.playing) togglePlayPauseRef.current();
    });
    set("previoustrack", () => stepRef.current(-1));
    set("nexttrack", () => stepRef.current(1));
    set("seekto", (details) => {
      if (typeof details.seekTime === "number" && Number.isFinite(details.seekTime)) {
        safeSeekRef.current(details.seekTime);
      }
    });
    set("seekbackward", (details) => {
      safeSeekRef.current(progressRef.current.t - (details.seekOffset ?? 10));
    });
    set("seekforward", (details) => {
      safeSeekRef.current(progressRef.current.t + (details.seekOffset ?? 10));
    });
    return () => {
      set("play", null);
      set("pause", null);
      set("previoustrack", null);
      set("nexttrack", null);
      set("seekto", null);
      set("seekbackward", null);
      set("seekforward", null);
    };
  }, []);

  /* ----- Native audio (APK only, v1.0.1) -----
     Inside the Capacitor wrapper the web Media Session above does
     not exist (Android WebView has no Media Session API), so the
     native FrostoraAudio plugin takes over the same job — and two
     things the web can never do:
     (a) Volume, both ways: on mount, pull the phone's media
         volume into the slider once; then listen for hardware
         volume-key changes and move the slider (and the player,
         via applyVolume) to match. The slider's own drags push
         the other way via applySliderVolume → applyVolume →
         setNativeVolume. The drag-suppression window plus the >3
         guard drop the echo of our own sets, so the two can
         never chase each other.
     (b) Lock-screen transport: the notification's play / pause /
         next / previous buttons arrive as playbackAction events
         and drive the same handlers as the web session above.
     Everything here is a no-op on the web build (isNativeApp()
     is false, and every nativeAudio call guards on it). */
  useEffect(() => {
    if (!isNativeApp()) return;
    let stopVolume: (() => void) | undefined;
    let stopActions: (() => void) | undefined;
    let cancelled = false;
    void getNativeVolume().then((v) => {
      if (cancelled || v === null) return;
      const pct = Math.round(v * 100);
      if (Math.abs(pct - volumeRef.current) > 1) applyVolume(pct);
    });
    void watchNativeVolume((v) => {
      // v1.0.3: ignore echoes while a slider drag is in flight —
      // they carry stale, quantised values and yank the slider
      // back mid-drag. Guard raised 1 → 3: one system step is
      // ~6.7pts, so a real hardware-key press (≥ ~7pts) still
      // passes, while the ≤ ~3.3pt rounding of our own echo does
      // not.
      if (Date.now() < suppressNativeEchoUntilRef.current) return;
      const pct = Math.round(v * 100);
      if (Math.abs(pct - volumeRef.current) > 3) applyVolume(pct);
    }).then((stop) => {
      if (cancelled) stop();
      else stopVolume = stop;
    });
    void onNativePlaybackAction((action) => {
      if (action === "play" && !stateRef.current.playing) togglePlayPauseRef.current();
      else if (action === "pause" && stateRef.current.playing) togglePlayPauseRef.current();
      else if (action === "next") stepRef.current(1);
      else if (action === "previous") stepRef.current(-1);
    }).then((stop) => {
      if (cancelled) stop();
      else stopActions = stop;
    });
    return () => {
      cancelled = true;
      stopVolume?.();
      stopActions?.();
    };
    // applyVolume is stable by construction (only refs + setState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const msVideoId = current?.videoId;
  const msTitle = current?.title;
  const msArtist = current?.artist;
  const msAlbum = current?.album;
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!msVideoId || !msTitle) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const artwork: MediaImage[] = currentThumb
      ? [{ src: currentThumb, sizes: "480x360", type: "image/jpeg" }]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: msTitle,
      artist: msArtist ?? "",
      album: msAlbum ?? "",
      artwork,
    });
  }, [msVideoId, msTitle, msArtist, msAlbum, currentThumb]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = current ? (playing ? "playing" : "paused") : "none";
    } catch {
      /* playbackState not supported here */
    }
  }, [playing, current]);

  /* ----- Native background audio (APK only, v1.0.1) -----
     Mirror the same playing/track state into the native
     foreground service: while a track is playing the service
     (mediaPlayback type + MediaSession + notification) keeps
     the app process alive, so the YouTube audio keeps playing
     when the app is minimised or the screen locks. Pausing
     keeps the service up with a paused state, so the
     notification's Play button can resume it. No-op on web. */
  useEffect(() => {
    if (!isNativeApp()) return;
    if (!current) return;
    const meta = { title: current.title, artist: current.artist, album: current.album };
    if (playing) {
      void startBackgroundAudio(meta);
      void setNativePlaying(true);
    } else {
      void updateNativeMetadata(meta);
      void setNativePlaying(false);
    }
  }, [playing, current]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const d = progress.d;
    const t = progress.t;
    if (!current || !Number.isFinite(d) || !Number.isFinite(t) || d <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        position: Math.min(Math.max(t, 0), d),
        playbackRate: 1,
      });
    } catch {
      /* position state rejected (e.g. mid track-change) */
    }
  }, [progress.t, progress.d, current]);

  // Similar-songs radio queue: playing a song ON ITS OWN (a tap in
  // Search / Home / Speed Dial / hero / Popular, a shuffle or random
  // pick) starts that song immediately, then the queue behind it is
  // filled with songs SIMILAR to it — same artist, similar artists,
  // the user's own likes in that style — fetched live from the
  // getSimilarQueue action. It must NOT just continue with the
  // remaining search results in order (the old behaviour). If the
  // radio fetch finds nothing, the rest of the tapped list is the
  // honest fallback so the queue is never left empty. A sequence
  // token guards against a slow fetch landing after the user has
  // already tapped another song.
  const radioSeqRef = useRef(0);
  const startRadioQueue = useCallback((track: Track, fallbackList: Track[]) => {
    const seq = ++radioSeqRef.current;
    playAtRef.current([track], 0);
    const applyFallback = () => {
      if (radioSeqRef.current !== seq) return;
      const curQ = queueRef.current;
      if (curQ.length !== 1 || curQ[0]?.videoId !== track.videoId) return;
      const i = fallbackList.findIndex((t) => t.videoId === track.videoId);
      const rest = (
        i >= 0
          ? [...fallbackList.slice(i + 1), ...fallbackList.slice(0, i)]
          : fallbackList
      ).filter((t) => t.videoId !== track.videoId);
      // With shuffle on, the fallback tail enters shuffled too —
      // the queue the user sees is the order that will play.
      if (rest.length > 0) setQueue([track, ...(stateRef.current.shuffle ? shuffleArr(rest) : rest)]);
    };
    void api
      .getSimilarQueue({ track })
      .then((res) => {
        if (radioSeqRef.current !== seq) return;
        const curQ = queueRef.current;
        const curIdx = stateRef.current.qIndex;
        // The user moved on (or queued things by hand): only fill
        // the queue when the seed is still the playing song.
        if (curQ[curIdx]?.videoId !== track.videoId) return;
        const fresh = res.tracks.filter(
          (t) => t.videoId !== track.videoId && !curQ.some((q) => q.videoId === t.videoId),
        );
        if (fresh.length === 0) {
          applyFallback();
          return;
        }
        // Anything the user added by hand while the radio loaded
        // (Play next / Add to queue) stays ahead of the radio songs.
        // With shuffle on, the radio songs enter shuffled — the
        // visible queue stays the true playing order.
        setQueue([...curQ, ...(stateRef.current.shuffle ? shuffleArr(fresh) : fresh)]);
      })
      .catch(() => applyFallback());
  }, []);

  const onRowPlay = useCallback(
    (track: Track, list: Track[], mode: "radio" | "list" = "radio") => {
      const cur = currentRef.current;
      // Tapping the song that is already playing toggles pause —
      // from ANY list. The old check also required the tapped list to
      // be the very same array object as the queue; lists are rebuilt
      // on every feed refresh / filter, so the check failed and the
      // tap restarted the song from 0 instead of pausing it.
      if (cur && track.videoId === cur.videoId) {
        togglePlayPauseRef.current();
        return;
      }
      // Playlist context (an opened album/playlist, Liked Songs):
      // the list IS the queue the user chose — play it in order.
      if (mode === "list") {
        const idx = list.findIndex((t) => t.videoId === track.videoId);
        playAtRef.current(list, idx >= 0 ? idx : 0);
        return;
      }
      // Everywhere else the tap is a random pick: similar-songs
      // radio fills the queue behind it.
      startRadioQueue(track, list);
    },
    [startRadioQueue],
  );

  // Rows inside a playlist the user deliberately opened (collection
  // page, Liked Songs) keep that list as the queue.
  const onListPlay = useCallback(
    (track: Track, list: Track[]) => onRowPlay(track, list, "list"),
    [onRowPlay],
  );

  const likeMutation = useMutation({
    mutationFn: async (track: Track) => await api.toggleLike({ track }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["liked"] });
    },
  });

  // Removing a playlist from All Playlists: a live-feed playlist is
  // hidden for good (hidden_playlists, so the feed stays filtered
  // on every future load); one of the user's own playlists
  // (created / imported, id "user:…") is really deleted.
  const removePlaylistMutation = useMutation({
    mutationFn: async (card: MusicCard) =>
      card.id.startsWith("user:")
        ? await api.deleteUserPlaylist({ id: card.id })
        : await api.hidePlaylist({ id: card.id, title: card.title }),
    onSuccess: () => {
      setPlaylistToRemove(null);
      setRemoveAnchor(null);
      setRemovePlaylistError(null);
      void queryClient.invalidateQueries({ queryKey: ["homeFeed"] });
      void queryClient.invalidateQueries({ queryKey: ["userPlaylists"] });
    },
    onError: (error) => {
      setRemovePlaylistError(error instanceof Error ? error.message : "That playlist could not be removed. Try again.");
    },
  });
  const likeFnRef = useRef(likeMutation.mutate);
  likeFnRef.current = likeMutation.mutate;
  const onToggleLike = useCallback((track: Track) => {
    likeFnRef.current(track);
  }, []);

  const openSimilarArtist = useCallback((name: string) => {
    setOpenCard(null);
    setTab("search");
    setSearchInput(name);
    setSearchQuery(name);
  }, []);

  const closeVoiceSearch = useCallback(() => {
    try { voiceRecRef.current?.stop(); } catch { /* already stopped */ }
    voiceRecRef.current = null;
    // v1.0.2: stop the native session too (no-op on web / when
    // no native session is running).
    try { voiceNativeStopRef.current?.(); } catch { /* already stopped */ }
    voiceNativeStopRef.current = null;
    setVoiceState(null);
  }, []);

  // Voice search (mic in the bottom nav): opens the liquid-glass
  // voice sheet and starts a REAL recognition session.
  // "Listening…" only shows while that session is live. No support,
  // an error, or silence all land on the sheet's honest unavailable
  // state — the sheet then offers typing instead.
  //
  // v1.0.2: inside the APK the native engine goes FIRST. Android
  // WebView does not expose the Web Speech API at all, so the mic
  // used to land on "Voice search isn't available here" every
  // time — the native SpeechRecognizer (RECORD_AUDIO, asked when
  // the mic is tapped) is what actually hears the user. If the
  // native call rejects (no recognizer on the device, mic denied)
  // it falls through to Web Speech, which decides the unavailable
  // state exactly as before. On the web build the native branch
  // is never taken and Web Speech runs as it always did.
  const startVoiceSearch = useCallback(() => {
    setOpenCard(null);
    setTab("search");
    setVoiceTranscript("");
    voiceHeardRef.current = false;

    // Shared "we heard a phrase" ending for both engines: show
    // it, run the search, then close the sheet.
    const onHeard = (text: string) => {
      voiceHeardRef.current = true;
      setVoiceState("heard");
      setSearchInput(text);
      setSearchQuery(text);
      window.setTimeout(() => setVoiceState(null), 650);
    };

    const startWebSpeech = () => {
      const w = window as unknown as {
        SpeechRecognition?: new () => {
          lang: string;
          interimResults: boolean;
          start: () => void;
          stop: () => void;
          onresult: ((e: { results: { length: number; [i: number]: { isFinal: boolean; [j: number]: { transcript: string } } } }) => void) | null;
          onerror: (() => void) | null;
          onend: (() => void) | null;
        };
        webkitSpeechRecognition?: unknown;
      };
      const SR = w.SpeechRecognition ?? (w.webkitSpeechRecognition as typeof w.SpeechRecognition);
      if (!SR) {
        setVoiceState("unavailable");
        return;
      }
      try {
        const rec = new SR();
        voiceRecRef.current = rec;
        rec.lang = "en-IN";
        rec.interimResults = true;
        rec.onresult = (e) => {
          let text = "";
          let isFinal = false;
          for (let i = 0; i < e.results.length; i++) {
            const r = e.results[i];
            if (!r) continue;
            if (r.isFinal) isFinal = true;
            text += r[0]?.transcript ?? "";
          }
          text = text.trim();
          if (text) setVoiceTranscript(text);
          if (isFinal && text) onHeard(text);
        };
        rec.onerror = () => {
          if (!voiceHeardRef.current) setVoiceState("unavailable");
        };
        rec.onend = () => {
          voiceRecRef.current = null;
          if (!voiceHeardRef.current) {
            setVoiceState((s) => (s === "listening" ? "unavailable" : s));
          }
        };
        setVoiceState("listening");
        rec.start();
        // Safety: if nothing is heard within 8s, stop faking patience —
        // onend flips the sheet to the honest unavailable state.
        window.setTimeout(() => {
          if (!voiceHeardRef.current) {
            try { rec.stop(); } catch { /* already stopped */ }
          }
        }, 8000);
      } catch {
        setVoiceState("unavailable");
      }
    };

    if (isNativeApp()) {
      void startNativeVoiceSearch({
        onPartial: (text) => {
          if (text) setVoiceTranscript(text);
        },
        onResult: (matches) => {
          const text = (matches[0] ?? "").trim();
          try { voiceNativeStopRef.current?.(); } catch { /* already stopped */ }
          voiceNativeStopRef.current = null;
          if (text) onHeard(text);
          else if (!voiceHeardRef.current) setVoiceState("unavailable");
        },
        onError: () => {
          try { voiceNativeStopRef.current?.(); } catch { /* already stopped */ }
          voiceNativeStopRef.current = null;
          if (!voiceHeardRef.current) setVoiceState("unavailable");
        },
      }).then((stop) => {
        voiceNativeStopRef.current = stop;
        setVoiceState("listening");
        // Safety: if nothing is heard within 8s, stop the session
        // and say so honestly (same 8s as the Web Speech path).
        window.setTimeout(() => {
          if (!voiceHeardRef.current) {
            try { voiceNativeStopRef.current?.(); } catch { /* already stopped */ }
            voiceNativeStopRef.current = null;
            setVoiceState((s) => (s === "listening" ? "unavailable" : s));
          }
        }, 8000);
      }).catch(() => {
        // No recognizer / mic denied: Web Speech gets its chance,
        // and only it can land the sheet on "unavailable".
        startWebSpeech();
      });
      return;
    }
    startWebSpeech();
  }, []);

  // "Play next": the song plays immediately after the one playing
  // now. If the song is ALREADY in the queue it MOVES there — its
  // old position is removed, it appears exactly once, and the rest
  // of the order is untouched. (The old code blindly inserted a
  // second copy, so the song sat in the queue twice and later
  // "came back" from its stale position.) Play next on the song
  // that is playing right now, or on the song already sitting next,
  // is a no-op. With nothing queued yet, it just starts playing.
  const onPlayNext = useCallback((track: Track) => {
    const q = queueRef.current;
    if (q.length === 0) {
      // Starting playback from empty is a random pick too: the
      // similar-songs radio fills the queue behind it.
      startRadioQueue(track, [track]);
      return;
    }
    const ci = stateRef.current.qIndex;
    const cur = q[ci];
    if (!cur) {
      setQueue((prev) => [...prev, track]);
      return;
    }
    if (cur.videoId === track.videoId) {
      // Play next on the song that is playing: it stays where it
      // is, but any OTHER copies of it in the queue (Add to queue
      // allows them) are stripped, so it still appears exactly
      // once. The current index shifts left by however many
      // stripped copies sat before it — tracked arithmetically,
      // never by searching for the song's id, because with
      // duplicate copies of the playing song an id search finds
      // the wrong instance (and an unshifted index can land out
      // of bounds, leaving the player with no current song).
      let removedBefore = 0;
      const deduped = q.filter((t, idx) => {
        if (idx === ci || t.videoId !== track.videoId) return true;
        if (idx < ci) removedBefore++;
        return false;
      });
      if (deduped.length !== q.length) {
        setQueue(deduped);
        if (removedBefore > 0) setQIndex(ci - removedBefore);
      }
      return;
    }
    // Already the only copy AND already next: nothing to change.
    const copies = q.reduce((n, t) => (t.videoId === track.videoId ? n + 1 : n), 0);
    if (copies === 1 && q[ci + 1]?.videoId === track.videoId) return;
    // Drop every existing copy of the song and insert it right
    // behind the playing one — exactly one copy, in the next slot,
    // the rest of the order untouched. The playing song's new
    // index is arithmetic (old index minus the dropped copies that
    // sat before it): its own copies are never dropped here, and
    // locating it by id would find an earlier duplicate instead.
    let removedBefore = 0;
    const without = q.filter((t, idx) => {
      if (t.videoId !== track.videoId) return true;
      if (idx < ci) removedBefore++;
      return false;
    });
    const newCi = ci - removedBefore;
    const next = [...without];
    next.splice(newCi + 1, 0, track);
    setQueue(next);
    if (newCi !== ci) setQIndex(newCi);
  }, [startRadioQueue]);

  // "Add to queue": append to the END of the queue (or start it
  // playing when nothing is queued yet, like Play next does) —
  // exactly as asked: it adds up at the end, every tap.
  const onAddToQueue = useCallback((track: Track) => {
    if (queueRef.current.length === 0) {
      startRadioQueue(track, [track]);
      return;
    }
    setQueue((prev) => [...prev, track]);
  }, [startRadioQueue]);

  // "Clear queue": drop every song except the one playing now, so
  // clearing never stops playback. The queue view arms an in-page
  // confirm first (clearArmed), because there is no going back.
  const clearQueue = useCallback(() => {
    const cur = stateRef.current.queue[stateRef.current.qIndex];
    setQueue(cur ? [cur] : []);
    setQIndex(0);
    setClearArmed(false);
  }, []);

  // Closing the queue view disarms a pending Clear confirm.
  useEffect(() => {
    if (!showQueue) setClearArmed(false);
  }, [showQueue]);

  // "Add more similar songs" (Queue view header, beside Clear
  // queue): fetches 10 NEW songs similar to the song playing now —
  // same artist / similar artists / same genre-language — live from
  // the getMoreSimilarSongs action, and APPENDS them at the end of
  // the queue. The playing song and the existing order never move,
  // and the queue count in the header updates from the new length.
  // The server already excludes everything in the queue; the client
  // filters once more against the live queue so a song queued by
  // hand while the fetch was in flight can never duplicate.
  const addingSimilarRef = useRef(false);
  const addMoreSimilarSongs = useCallback(async () => {
    if (addingSimilarRef.current) return;
    const cur = currentRef.current;
    const q = queueRef.current;
    if (!cur) return;
    addingSimilarRef.current = true;
    setAddingSimilar(true);
    setAddSimilarNote(null);
    try {
      const res = await api.getMoreSimilarSongs({ track: cur, queue: q });
      const existing = new Set(queueRef.current.map((t) => t.videoId));
      const fresh = res.tracks
        .filter((t) => t.videoId !== cur.videoId && !existing.has(t.videoId))
        .slice(0, 10);
      // De-dupe within the batch itself as a final guard.
      const seen = new Set<string>();
      const unique = fresh.filter((t) => {
        if (seen.has(t.videoId)) return false;
        seen.add(t.videoId);
        return true;
      });
      if (unique.length === 0) {
        setAddSimilarNote("No new similar songs found right now — try again in a bit.");
      } else {
        setQueue((prev) => [...prev, ...unique]);
        setAddSimilarNote(
          `Added ${unique.length} similar song${unique.length === 1 ? "" : "s"} to your queue`,
        );
      }
    } catch {
      setAddSimilarNote("Couldn't add similar songs — check your connection and try again.");
    } finally {
      addingSimilarRef.current = false;
      setAddingSimilar(false);
    }
  }, []);

  // The confirmation / error note under the queue header is brief:
  // it clears itself after a few seconds.
  useEffect(() => {
    if (!addSimilarNote) return;
    const id = window.setTimeout(() => setAddSimilarNote(null), 4500);
    return () => window.clearTimeout(id);
  }, [addSimilarNote]);

  // Listening history: every track that becomes "now playing" is
  // recorded once server-side, whatever path started it (row tap,
  // next/prev, shuffle, play all). Feeds homepage recommendations.
  const recordPlayMutation = useMutation({
    mutationFn: async (track: Track) => await api.recordPlay({ track }),
  });
  const recordPlayFnRef = useRef(recordPlayMutation.mutate);
  recordPlayFnRef.current = recordPlayMutation.mutate;
  const lastRecordedRef = useRef<string | null>(null);
  const currentVideoId = current?.videoId;
  useEffect(() => {
    if (current && currentVideoId && lastRecordedRef.current !== currentVideoId) {
      lastRecordedRef.current = currentVideoId;
      recordPlayFnRef.current(current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideoId]);

  // Reset the playlist-page filter/menu whenever a different
  // playlist or collection opens.
  useEffect(() => {
    setListFilter("");
    setShowListSearch(false);
    setListMenuOpen(false);
  }, [openCard?.id]);

  // Scroll-to-top on navigation: opening a playlist / album
  // (openCard), switching tabs (Home / Search-explore / Library /
  // Profile) or switching Library sections must ALWAYS land at the
  // top of the page — never at whatever scroll position the
  // previous page was left in. The page scrolls on the window (the
  // spatial parallax reads window.scrollY), so the reset targets
  // the window, instantly (no smooth glide past the content).
  //
  // The collection reset is a LAYOUT effect, not a plain effect:
  // it runs before the browser paints the freshly opened page, so
  // the page can never be seen (or left) part-way down. It zeroes
  // the window AND both document scrollers (different webviews
  // scroll different ones), then re-asserts on the next frame —
  // scroll anchoring can nudge the position back when the tapped
  // card's list unmounts around the reset. A final re-assert
  // fires when the collection's tracks land (below), in case the
  // late layout growth moved things again; it only applies
  // within a second of opening, before the user starts reading.
  // Nothing on the collection page auto-focuses (no autoFocus,
  // no .focus() calls), so focus can never drag the view down to
  // a mid-page control either.
  const openCardId = openCard?.id;
  const collectionOpenedAtRef = useRef(0);
  useLayoutEffect(() => {
    if (!openCardId) return;
    collectionOpenedAtRef.current = Date.now();
    const resetScroll = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };
    resetScroll();
    const raf = requestAnimationFrame(resetScroll);
    return () => cancelAnimationFrame(raf);
  }, [openCardId]);
  const collectionPending = collection.isPending;
  useEffect(() => {
    if (!openCardId || collectionPending) return;
    if (Date.now() - collectionOpenedAtRef.current > 1000) return;
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [openCardId, collectionPending]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [libSection]);

  const filterTracks = (ts: Track[]): Track[] => {
    const q = listFilter.trim().toLowerCase();
    if (!q) return ts;
    return ts.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q));
  };

  // Playlist-page heart: adds every not-yet-liked song in the list
  // to Liked Songs (real likes, one mutation per song).
  const likeAllTracks = (ts: Track[]) => {
    for (const t of ts) {
      if (!likedSet.has(t.videoId)) likeMutation.mutate(t);
    }
  };

  // Library view data: the live album / playlist cards, filtered by
  // the in-section search and optionally sorted A–Z.
  const libAlbumsAll = homeFeed.data?.albums ?? [];
  const libPlaylistsAll = [...userPlaylistCards, ...(homeFeed.data?.playlists ?? [])];
  const libFilterCards = (cards: MusicCard[]): MusicCard[] => {
    const q = libQuery.trim().toLowerCase();
    const filtered = q
      ? cards.filter((c) => `${c.title} ${c.subtitle}`.toLowerCase().includes(q))
      : cards;
    return libSortAz ? [...filtered].sort((a, b) => a.title.localeCompare(b.title)) : filtered;
  };
  const libAlbums = libFilterCards(libAlbumsAll);
  const libPlaylists = libFilterCards(libPlaylistsAll);

  const pct = progress.d > 0 ? Math.min(100, (progress.t / progress.d) * 100) : 0;
  // A verified official music video exists for the playing song
  // ONLY when the lookup resolved status "official" with a video
  // ID. Every Video control in the app (side-nav button, player
  // toggles, the segmented pill's Video segment, the lyrics
  // view's video button) renders solely on this flag — a song
  // with no official video (Humsafar) shows no Video option at
  // all, and nothing ever falls back to a non-official upload.
  const hasOfficialVideo = officialVideo.data?.status === "official" && !!officialVideo.data?.videoId;
  // The video surface appears only once the official-video lookup
  // has actually resolved a video to show: while it is still
  // looking — and when it honestly found none — the artwork stays
  // on screen and the audio keeps playing.
  const videoOnScreen = showVideo && !!current && hasOfficialVideo;
  const videoVisible = expanded && videoOnScreen;

  // Liquid morph poster state (reference video, 21 Nov): what the
  // Now Playing poster card shows — the song artwork in Song mode,
  // the official video's own poster in Video mode (the standard
  // i.ytimg poster for the VERIFIED video ID the server returned;
  // never an unverified upload). During a mode morph the card
  // targets the incoming mode immediately and melts toward it;
  // requestModeSwitch times the real mode flip to land under the
  // melt: switching TO Video commits at the end of the morph (the
  // warm player then shows the video with no restart), switching
  // BACK to Song drops the video surface at once and lets the
  // card melt the video poster into the artwork in its place.
  const posterIsVideo = modeMorph ? modeMorph.toVideo : videoOnScreen;
  const posterSrc =
    posterIsVideo && mvVideoId
      ? `https://i.ytimg.com/vi/${mvVideoId}/hqdefault.jpg`
      : (current?.thumbnail ?? "");
  const posterKey = current ? `${current.videoId}|${posterIsVideo ? "v" : "s"}` : "";
  const requestModeSwitch = (toVideo: boolean) => {
    if (!current || toVideo === showVideo || modeMorph) return;
    if (!hasOfficialVideo) {
      setShowVideo(toVideo);
      return;
    }
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShowVideo(toVideo);
      return;
    }
    navDirRef.current = toVideo ? 1 : -1;
    if (!toVideo) setShowVideo(false);
    setModeMorph({ toVideo });
    modeMorphTimerRef.current = window.setTimeout(() => {
      modeMorphTimerRef.current = null;
      if (toVideo) setShowVideo(true);
      setModeMorph(null);
    }, 920);
  };

  // Speed dial pool: ONLY the dedicated Speed Dial feed
  // (getSpeedDial, keyed by the refresh nonce above): exactly 20
  // songs the user has played — their 10 most-played plus 10
  // random picks from the rest of their listening history / Liked
  // Songs. Never generic trending, never discoveries. When the
  // nonce changes this pool is replaced wholesale and the
  // carousel resets to it.
  const speedPool = useMemo(() => speedDial.data?.tracks ?? [], [speedDial.data]);

  // Popular Songs pagination: the full live chart, 5 songs per
  // page. The page index is clamped to the chart that actually
  // arrived, and the slice keeps each song's true chart rank.
  const popularAll = popular.data?.source === "live" ? popular.data.songs : [];
  const popularPageCount = Math.max(1, Math.ceil(popularAll.length / 5));
  const popularPageClamped = Math.min(popularPage, popularPageCount - 1);
  const popularPageSongs = popularAll.slice(popularPageClamped * 5, popularPageClamped * 5 + 5);

  const MOODS: { label: string; query: string }[] = [
    { label: "Romance", query: "romantic songs" },
    { label: "Relax", query: "relaxing music" },
    { label: "Feel good", query: "feel good hits" },
    { label: "Energize", query: "energizing music" },
    { label: "Commute", query: "drive songs" },
    { label: "Workout", query: "workout music" },
  ];

  return (
    <div className="spatial-scene min-h-screen text-[var(--text)]">
      <AppBackground wallpaperUrl={wallpaperUrl} />
      {current && !wallpaperUrl && <AmbientGlow thumb={current.thumbnail} videoId={current.videoId} />}
      <div className={`relative z-10 lg:pl-[316px] ${current && desktopPanelOpen ? "lg:pr-[368px]" : ""}`}>
      <div aria-hidden="true" style={{ height: "env(safe-area-inset-top)", background: "var(--bg)" }} />

      {/* ----- vertical pill nav (reference, wide screens) -----
          A slim floating capsule down the left edge: Home, Library,
          Video view, Made For You, Liked Songs, Search. */}
      <nav className="vnav fixed top-1/2 left-3 z-40 hidden -translate-y-1/2 flex-col items-center gap-1 px-1.5 py-3 lg:flex" aria-label="Quick navigation">
        <button
          type="button"
          onClick={() => { setTab("home"); setOpenCard(null); }}
          aria-label="Home"
          aria-current={tab === "home" && !openCard ? "page" : undefined}
          className={tab === "home" && !openCard ? "is-active" : ""}
        >
          <Icon d={P.play} size={19} filled />
        </button>
        <button
          type="button"
          onClick={() => goToLibrary("albums")}
          aria-label="Library — Albums"
          aria-current={tab === "liked" && !openCard ? "page" : undefined}
          className={tab === "liked" && !openCard ? "is-active" : ""}
        >
          <Icon d={P.grid} size={19} />
        </button>
        {/* Video view entry — rendered ONLY when the playing
            song has a verified official music video. No official
            video → no button at all (never a dimmed placeholder
            that would lead to a non-official upload). */}
        {current && hasOfficialVideo && (
          <button
            type="button"
            onClick={() => { setShowVideo(true); setExpanded(true); }}
            aria-label={`Watch the official video for ${current.title}`}
          >
            <Icon d={P.video} size={19} />
          </button>
        )}
        <button
          type="button"
          onClick={() => goToLibrary("made")}
          aria-label="Made For You"
        >
          <Icon d={P.radio} size={19} />
        </button>
        <button
          type="button"
          onClick={() => goToLibrary("songs")}
          aria-label={likedTracks.length > 0 ? `Liked Songs — ${likedTracks.length} songs` : "Liked Songs"}
        >
          <Icon d={P.archive} size={19} />
        </button>
        <button
          type="button"
          onClick={() => { setTab("search"); setOpenCard(null); }}
          onDoubleClick={openSearchAndFocus}
          aria-label="Search — double-click to open the search bar"
          aria-current={tab === "search" && !openCard ? "page" : undefined}
          className={tab === "search" && !openCard ? "is-active" : ""}
        >
          <Icon d={P.search} size={19} />
        </button>
        <button
          type="button"
          onClick={() => { setTab("glass"); setOpenCard(null); }}
          aria-label="Liquid Glass Hero demo"
          aria-current={tab === "glass" && !openCard ? "page" : undefined}
          className={tab === "glass" && !openCard ? "is-active" : ""}
        >
          <Icon d={P.sparkle} size={19} />
        </button>
      </nav>

      {/* ----- desktop Library sidebar (reference) -----
          The Library panel from the screenshots: frosted, large
          rounded corners, floating over the wallpaper at left:76px
          (past the vertical pill nav). */}
      <aside className="spatial-panel-left vision-panel fixed top-0 bottom-0 left-0 z-40 hidden w-[240px] overflow-y-auto px-3 py-5 lg:block" aria-label="Library sidebar">
        <LibrarySidebar
          section={(tab === "liked" && !openCard ? libSection : "none") as LibSection}
          onSection={goToLibrary}
          playlists={libPlaylistsAll}
          likedCount={likedTracks.length}
          onOpenCard={setOpenCard}
          onAddPlaylist={() => setShowAddPlaylist(true)}
        />
      </aside>

      {/* YouTube player hosts — one per physical player. The
          ACTIVE player's host is a real screen in video mode; in
          audio mode, and for the warm standby always, the host is
          a full-size frame parked far off-screen. Desktop Edge
          and Chrome can refuse to start playback in a near-zero-size
          or fully transparent iframe, so the old 3px/2%-opacity
          sliver is gone — off-screen but genuinely rendered instead.
          The standby keeps playing (muted) in its parked host so
          its video stays buffered for an instant mode switch. */}
      <div
        ref={hostRef}
        aria-hidden={!videoVisible || activeSlotB}
        className={
          videoVisible && !activeSlotB
            ? "fixed left-1/2 top-[86px] z-[70] aspect-video w-[min(92vw,560px)] -translate-x-1/2 overflow-hidden rounded-2xl bg-black shadow-2xl"
            : "pointer-events-none fixed top-0 left-[-10000px] z-0 h-[180px] w-[320px] overflow-hidden"
        }
      />
      <div
        ref={standbyHostRef}
        aria-hidden={!videoVisible || !activeSlotB}
        className={
          videoVisible && activeSlotB
            ? "fixed left-1/2 top-[86px] z-[70] aspect-video w-[min(92vw,560px)] -translate-x-1/2 overflow-hidden rounded-2xl bg-black shadow-2xl"
            : "pointer-events-none fixed top-0 left-[-10000px] z-0 h-[180px] w-[320px] overflow-hidden"
        }
      />

      {/* Sticky Liquid Glass header: a floating glass capsule that
          stays pinned while album grids and tracklists scroll —
          and blur — underneath it. */}
      <header className="sticky top-3 z-30 mx-auto w-full max-w-3xl px-5 pt-3 lg:max-w-[920px]">
        <div className="glass spatial-float flex items-center justify-between rounded-full py-2 pr-2 pl-3">
          <div className="flex items-center gap-2.5">
            {/* Crystal icon ornament: breathing icy halo, sound-wave
                ripples while a song plays (one still ring when
                paused), and drifting frost sparkles. Purely
                decorative — see .crystal-* in theme.css. */}
            <span className="relative block h-10 w-10 flex-none" aria-hidden="true">
              <span className="crystal-halo" />
              <span className={`crystal-ripple ${playing ? "is-live" : "is-still"}`} />
              <span className={`crystal-ripple ${playing ? "is-live delay-1" : ""}`} />
              <span className={`crystal-ripple ${playing ? "is-live delay-2" : ""}`} />
              <img
                src={frostoraIcon}
                alt=""
                className="silver-glow relative h-10 w-10 rounded-full border border-white/15 object-cover"
              />
              <span
                className="crystal-sparkle"
                style={{ top: "-3px", left: "6px", animationDelay: "0s", ["--drift-x" as string]: "2px", ["--drift-y" as string]: "-3px" }}
              />
              <span
                className="crystal-sparkle"
                style={{ top: "4px", right: "-4px", animationDelay: "1.6s", animationDuration: "7s", ["--drift-x" as string]: "3px", ["--drift-y" as string]: "2px" }}
              />
              <span
                className="crystal-sparkle"
                style={{ bottom: "2px", left: "-4px", animationDelay: "3.1s", animationDuration: "6.5s", ["--drift-x" as string]: "-2px", ["--drift-y" as string]: "3px" }}
              />
              <span
                className="crystal-sparkle"
                style={{ bottom: "-3px", right: "8px", animationDelay: "4.4s", animationDuration: "7.5s", ["--drift-x" as string]: "-3px", ["--drift-y" as string]: "-2px" }}
              />
              <span
                className="crystal-sparkle"
                style={{ top: "16px", left: "-5px", animationDelay: "2.3s", animationDuration: "5.6s", ["--drift-x" as string]: "2px", ["--drift-y" as string]: "-2px" }}
              />
            </span>
            <p className="font-display text-[19px] tracking-[0.03em] whitespace-nowrap">Frostora</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setTab("about");
                setOpenCard(null);
                setShowSettings(false);
              }}
              aria-label="About Frostora"
              aria-current={tab === "about" && !openCard ? "page" : undefined}
              className={`glass-soft flex h-10 w-10 items-center justify-center rounded-full transition-transform duration-150 active:scale-[0.94] ${tab === "about" && !openCard ? "text-white" : "text-[var(--dim)]"}`}
            >
              <Icon d={P.info} size={20} />
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("profile");

                setOpenCard(null);
              }}
              aria-label="Open your profile"
              aria-current={tab === "profile" ? "page" : undefined}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:text-white ${tab === "profile" ? "text-white" : "text-[var(--dim)]"}`}
            >
              <Icon d={P.person} size={21} />
            </button>
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              aria-label="Settings"
              aria-expanded={showSettings}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:text-white ${showSettings ? "text-white" : "text-[var(--dim)]"}`}
            >
              <Icon d={P.gear} size={21} />
            </button>
          </div>
        </div>
        {showSettings && (
          <div className="pop-in glass spatial-float absolute top-[80px] right-5 z-30 w-[260px] rounded-3xl p-4" style={{ transformOrigin: "top right" }}>
            <p className="text-[11px] tracking-[0.24em] text-[var(--dim)] uppercase">Settings</p>
            <button
              type="button"
              onClick={() => {
                void homeFeed.refetch();
                void popular.refetch();
                refreshSpeedDial();
              }}
              className="mt-4 w-full rounded-full border border-white/10 px-4 py-2 text-[12px] tracking-[0.14em] text-[var(--accent)] uppercase transition-transform duration-150 active:scale-[0.97]"
            >
              Refresh home feed
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSettings(false);
                goToLibrary("wallpaper");
              }}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2 text-[12px] tracking-[0.14em] text-[var(--text)] uppercase transition-transform duration-150 active:scale-[0.97]"
            >
              <Icon d={P.image} size={15} />
              Wallpaper
            </button>

          </div>
        )}
      </header>

      {tab === "glass" && !openCard && (
        <div className="relative z-10 mx-auto w-full max-w-5xl px-3 pt-4 lg:max-w-[1100px]">
          <div className="mb-3 flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => setTab("home")}
              aria-label="Back to Home from Liquid Glass Hero demo"
              className="glass-soft flex items-center gap-2 rounded-full px-4 py-2 text-[13px] text-white transition-transform duration-150 active:scale-[0.97]"
            >
              <Icon d={P.back} size={16} />
              Back to music
            </button>
            <span className="text-[11px] tracking-[0.18em] text-[var(--dim)] uppercase">Aceternity · Liquid Glass</span>
          </div>
          <div className="overflow-hidden rounded-[28px]">
            <LiquidGlassHeroDemo />
          </div>
          <div className="mt-4 overflow-hidden rounded-[28px] bg-[#101014] px-6 pt-2 pb-8">
            <p className="mt-4 text-[11px] tracking-[0.18em] text-[var(--dim)] uppercase">Aceternity · Text Generate Effect</p>
            {/* The demo's word spans are text-black in light
                scheme; this view is a dark panel, so pin them to
                the source's dark-scheme white. */}
            <div className="[&_span]:text-white">
              <TextGenerateEffectDemo />
            </div>
            <p className="mt-5 text-[13px] leading-relaxed text-[var(--dim)]">
              The same effect now generates each lyrics line word by word as it becomes the active line.
            </p>
          </div>
          <div className="mt-4 overflow-hidden rounded-[28px] bg-[#101014] px-6 pt-2 pb-6">
            <p className="mt-4 text-[11px] tracking-[0.18em] text-[var(--dim)] uppercase">Shiny Button</p>
            <DemoOne />
            <p className="text-[13px] leading-relaxed text-[var(--dim)]">
              The same shiny animated border now styles the app's pill buttons — Speed Dial Refresh, Play all, Add more similar songs, Clear queue and Refresh lyrics.
            </p>
          </div>
        </div>
      )}

      <main className={`mx-auto w-full max-w-3xl px-5 lg:max-w-[920px] ${current ? "pb-64" : "pb-32"}`}>
        {!openCard && tab === "home" && (
          <section className="pt-4">
            {/* Mood chips — each one runs a real live search for that mood */}
            <div
              className="shelf-fade flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="group"
              aria-label="Moods — tap one to search songs for it"
            >
              {MOODS.map((m) => (
                <button
                  key={m.label}
                  type="button"
                  onClick={() => openSimilarArtist(m.query)}
                  aria-label={`Search ${m.label} songs`}
                  className="glass-soft flex-none rounded-full px-4.5 py-2 text-[13.5px] text-[var(--text)] transition-transform duration-150 active:scale-[0.96]"
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="mt-5 mb-3 flex items-end justify-between">
              <h2 className="text-[15px] font-bold tracking-[0.14em] uppercase">Speed dial</h2>
              <ShinyButton
                onClick={refreshSpeedDial}
                aria-label="Refresh Speed Dial from your listening"
                className="min-h-[36px] px-4 py-1.5 text-[11px] tracking-[0.16em] uppercase"
              >
                {speedDial.isFetching ? "Refreshing…" : "Refresh"}
              </ShinyButton>
            </div>
            {speedPool.length > 0 ? (
              <SpeedDial key={speedNonce} pool={speedPool} onPlayTrack={onRowPlay} occluded={expanded || showLyrics} />
            ) : speedDial.isPending ? (
              // Skeleton at the carousel's exact height — the page
              // below must not jump when the dial pops in.
              <div aria-label="Building Speed Dial from your listening">
                <div className="relative mx-auto flex h-[320px] w-full max-w-[720px] items-center justify-center gap-4 overflow-hidden">
                  <div className="h-[132px] w-[132px] flex-none animate-pulse rounded-[26px] bg-white/[0.05]" />
                  <div className="h-[176px] w-[176px] flex-none animate-pulse rounded-[26px] bg-white/[0.07]" />
                  <div className="h-[132px] w-[132px] flex-none animate-pulse rounded-[26px] bg-white/[0.05]" />
                </div>
                <div className="mx-auto mt-1 h-5 w-44 animate-pulse rounded bg-white/[0.06]" />
                <div className="mx-auto mt-2 h-3.5 w-28 animate-pulse rounded bg-white/[0.05]" />
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="mx-auto max-w-[320px] text-sm leading-relaxed text-[var(--dim)]">
                  Speed Dial is 20 songs you&rsquo;ve played — your 10 most-played plus 10 more from your listening. Play a few songs and your personal dial will appear here.
                </p>
                <button
                  type="button"
                  onClick={refreshSpeedDial}
                  className="metal-flat mt-4 min-h-[44px] rounded-full border border-white/10 px-5 py-2 text-[12px] tracking-[0.18em] uppercase transition-transform duration-100 active:scale-[0.97]"
                >
                  Try again
                </button>
              </div>
            )}

            {homeFeed.isSuccess && homeFeed.data.source === "live" && (homeFeed.data.playlists.length > 0 || homeFeed.data.albums.length > 0) && (
              <>
                <h2 className="mt-8 text-[15px] leading-snug font-bold tracking-[0.05em] uppercase">
                  Music that&rsquo;s hot and happening!
                  <br />
                  <span className="text-[var(--dim)]">India&rsquo;s biggest hits</span>
                </h2>
                <div
                  className="shelf-fade mt-3 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  role="group"
                  aria-label="India's biggest hits — albums and playlists"
                >
                  {[...homeFeed.data.playlists, ...homeFeed.data.albums].slice(0, 10).map((c) => (
                    <button
                      key={`hot-${c.id}`}
                      type="button"
                      onClick={() => setOpenCard(c)}
                      aria-label={`Open ${c.kind} ${c.title}`}
                      className="spatial-lift w-[152px] flex-none rounded-[26px] text-left active:scale-[0.97]"
                    >
                      <span className="relative block aspect-[1/1.04] overflow-hidden rounded-[26px] border border-white/10">
                        {c.thumbnail ? (
                          <img src={fillThumb(c.thumbnail)} alt="" className="absolute inset-0 h-full w-full object-cover object-center" loading="lazy" decoding="async" />
                        ) : (
                          <span className="metal absolute inset-0 block" />
                        )}
                        <span className="cover-band absolute inset-x-0 bottom-0 px-3.5 pt-2.5 pb-3">
                          <span className="block truncate text-[13.5px] leading-snug font-bold text-white">{c.title}</span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-white/65">{c.subtitle || c.kind}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {homeFeed.isPending && (
              <div className="space-y-2 pt-10" aria-label="Loading your live home feed">
                {[0, 1, 2].map((k) => (
                  <div key={k} className="flex items-center gap-3 px-2 py-2">
                    <div className="h-12 w-12 flex-none animate-pulse rounded-xl bg-white/[0.06]" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                      <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.05]" />
                    </div>
                  </div>
                ))}
                <p className="pt-2 text-center text-sm text-[var(--dim)]">Tuning into YouTube Music…</p>
              </div>
            )}

            {homeFeed.isSuccess && homeFeed.data.source === "live" && (
              <div className="rise">
                <div className="mt-9 mb-2 flex items-end justify-between">
                  <h2 className="font-display text-[24px]">Quick picks</h2>
                  <ShinyButton
                    onClick={() => playAt(homeFeed.data.recommended.slice(0, 5), 0)}
                    aria-label="Play all Quick picks"
                    className="px-4 py-1.5 text-[12px] tracking-[0.1em] uppercase"
                  >
                    Play all
                  </ShinyButton>
                </div>
                {homeFeed.data.recommendedBasis && (
                  <p className="-mt-1 mb-2 text-[13px] text-[var(--dim)]">{homeFeed.data.recommendedBasis}</p>
                )}
                <div className="stagger space-y-0.5 lg:grid lg:grid-cols-2 lg:gap-x-6 lg:space-y-0">
                  {homeFeed.data.recommended.slice(0, 5).map((t) => (
                    <TrackRow
                      key={`rec-${t.videoId}`}
                      track={t}
                      list={homeFeed.data.recommended.slice(0, 5)}
                      isCurrent={current?.videoId === t.videoId}
                      isPlaying={playing}
                      isLiked={likedSet.has(t.videoId)}
                      onPlayTrack={onRowPlay}
                      onToggleLikeTrack={onToggleLike}
                      onPlayNextTrack={onPlayNext}
                      onAddToQueueTrack={onAddToQueue}
                    />
                  ))}
                </div>

                {homeFeed.data.similarArtists.length > 0 && (
                  <>
                    <h2 className="font-display mt-9 mb-3 text-[24px]">Similar artists</h2>
                    <div className="flex flex-wrap gap-2.5">
                      {homeFeed.data.similarArtists.map((a) => (
                        <button
                          key={a.name}
                          type="button"
                          onClick={() => openSimilarArtist(a.name)}
                          aria-label={`Search songs by similar artist ${a.name}`}
                          className="metal-flat flex items-center gap-2.5 rounded-full border border-white/10 py-1.5 pl-1.5 pr-4 transition-transform duration-150 active:scale-[0.97]"
                        >
                          {a.thumbnail ? (
                            <img src={smallThumb(a.thumbnail)} alt="" className="h-8 w-8 flex-none rounded-full object-cover" loading="lazy" decoding="async" />
                          ) : (
                            <span className="metal h-8 w-8 flex-none rounded-full" />
                          )}
                          <span className="text-[13px] text-[var(--text)]">{a.name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <h2 id="home-trending" className="font-display mt-9 mb-2 scroll-mt-6 text-[24px]">Trending now</h2>
                <div className="stagger space-y-0.5 lg:grid lg:grid-cols-2 lg:gap-x-6 lg:space-y-0">
                  {homeFeed.data.trending.slice(0, 5).map((t) => (
                    <TrackRow
                      key={`trend-${t.videoId}`}
                      track={t}
                      list={homeFeed.data.trending.slice(0, 5)}
                      isCurrent={current?.videoId === t.videoId}
                      isPlaying={playing}
                      isLiked={likedSet.has(t.videoId)}
                      onPlayTrack={onRowPlay}
                      onToggleLikeTrack={onToggleLike}
                      onPlayNextTrack={onPlayNext}
                      onAddToQueueTrack={onAddToQueue}
                    />
                  ))}
                </div>
              </div>
            )}

            {homeFeed.isSuccess && homeFeed.data.source === "fallback" && (
              <div className="rise py-10 text-center">
                <h2 className="font-display text-[24px]">Nothing live right now</h2>
                <p className="mx-auto mt-2 max-w-[340px] text-sm leading-relaxed text-[var(--dim)]">
                  YouTube Music could not be reached just now, so there is nothing honest to show here. Your Liked Songs are still in the Library.
                </p>
                <button
                  type="button"
                  onClick={() => { void homeFeed.refetch(); refreshSpeedDial(); }}
                  className="metal-flat mt-5 min-h-[44px] rounded-full border border-white/10 px-5 py-2 text-[12px] tracking-[0.18em] uppercase transition-transform duration-100 active:scale-[0.97]"
                >
                  Try again
                </button>
              </div>
            )}

            {likedTracks.length > 0 && (
              <>
                <h2 className="font-display mt-10 mb-1 text-[24px]">Forgotten favorites</h2>
                <p className="mb-3 text-[13px] text-[var(--dim)]">
                  Your liked songs, back in rotation
                </p>
                <div
                  className="shelf-fade flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  role="group"
                  aria-label="Forgotten favorites"
                >
                  {likedTracks.slice(0, 8).map((t) => (
                    <button
                      key={`fav-${t.videoId}`}
                      type="button"
                      onClick={() => onRowPlay(t, likedTracks)}
                      aria-label={`Play ${t.title} by ${t.artist}`}
                      className="spatial-lift group relative block w-[158px] flex-none overflow-hidden rounded-[26px] border border-white/10 text-left active:scale-[0.97]"
                    >
                      <img src={smallThumb(t.thumbnail)} alt="" className="aspect-[1/1.02] w-full object-cover" loading="lazy" decoding="async" />
                      <span className="cover-play cover-play-reveal absolute top-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-[12px]" aria-hidden="true">
                        {current?.videoId === t.videoId && playing ? <PauseIcon size={13} /> : <Icon d={P.play} size={13} filled />}
                      </span>
                      <span className="cover-band absolute inset-x-0 bottom-0 px-3.5 pt-2.5 pb-3">
                        <span className="block truncate text-[13.5px] leading-snug font-bold text-white">{t.title}</span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-white/65">{t.artist}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {homeFeed.isSuccess && homeFeed.data.source === "live" && homeFeed.data.releases.length > 0 && (
              <>
                <h2 className="font-display mt-9 mb-3 text-[24px]">New releases</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {homeFeed.data.releases.map((c) => (
                    <CollectionCard key={c.id} card={c} onOpen={setOpenCard} />
                  ))}
                </div>
              </>
            )}

            {homeFeed.isSuccess && homeFeed.data.source === "live" && homeFeed.data.playlists.length > 0 && (
              <>
                <h2 className="font-display mt-9 mb-3 text-[24px]">Playlists from YouTube Music</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {homeFeed.data.playlists.map((c) => (
                    <CollectionCard key={c.id} card={c} onOpen={setOpenCard} />
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {openCard && (
          <section className="collection-page rise relative -mx-5 mt-1 sm:-mx-2 sm:rounded-[32px]" aria-label={`${openCard.kind} ${openCard.title}`}>
            {/* Ambient background (Echo-style): the cover's own
                colours glow behind the top half of the page and
                fade smoothly into the pure-dark #0B0B0D ground the
                tracklist sits on. Three pure-paint layers, all
                clipped inside .collection-ambient (never on the
                section itself — an overflow clip there would break
                the sticky top bar):
                1. the cover itself, heavily blurred + saturated;
                2. two radial glows in the cover's sampled dominant
                   / vibrant colours (inline style below; absent
                   until sampling lands, the blurred cover carries
                   the ambient alone until then);
                3. a fade veil from transparent through translucent
                   dark to solid #0B0B0D at the layer's foot. */}
            <div className="collection-ambient" aria-hidden="true">
              {openCard.thumbnail && (
                <img
                  key={openCard.id}
                  src={smallThumb(openCard.thumbnail)}
                  alt=""
                  decoding="async"
                  className="collection-ambient-img np-fade-in"
                />
              )}
              {collectionPalette && (
                <div
                  className="collection-ambient-glow np-fade-in"
                  style={{
                    background: `radial-gradient(115% 68% at 18% -6%, rgba(${collectionPalette.vibrant.r}, ${collectionPalette.vibrant.g}, ${collectionPalette.vibrant.b}, 0.52) 0%, rgba(${collectionPalette.vibrant.r}, ${collectionPalette.vibrant.g}, ${collectionPalette.vibrant.b}, 0) 62%), radial-gradient(120% 78% at 88% 4%, rgba(${collectionPalette.dominant.r}, ${collectionPalette.dominant.g}, ${collectionPalette.dominant.b}, 0.46) 0%, rgba(${collectionPalette.dominant.r}, ${collectionPalette.dominant.g}, ${collectionPalette.dominant.b}, 0) 64%), radial-gradient(90% 55% at 50% 58%, rgba(${collectionPalette.dominant.r}, ${collectionPalette.dominant.g}, ${collectionPalette.dominant.b}, 0.20) 0%, rgba(${collectionPalette.dominant.r}, ${collectionPalette.dominant.g}, ${collectionPalette.dominant.b}, 0) 70%)`,
                  }}
                />
              )}
              <div className="collection-ambient-fade" />
            </div>

            {/* Sticky glass top bar: one frosted pill floating over
                the ambient glow — back on the left, the collection
                title centred, search + more on the right. It pins
                just under the app's sticky header (see
                .collection-topbar in theme.css) and stays there,
                blurred and readable, while the hero scrolls away
                and the tracklist slides underneath it. */}
            <div className="collection-topbar">
              <div className="collection-topbar-pill relative">
                <button
                  type="button"
                  onClick={() => setOpenCard(null)}
                  aria-label="Back to home"
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-white transition-colors duration-150 hover:bg-white/10 active:scale-[0.94]"
                >
                  <Icon d={P.back} size={19} />
                </button>
                <p className="min-w-0 flex-1 truncate px-1 text-center text-[13.5px] font-semibold text-white/90">
                  {collection.data?.title || openCard.title}
                  <span className="font-normal text-white/50"> · {openCard.kind === "album" ? "Album" : "Playlist"}</span>
                </p>
                <div className="flex flex-none items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowListSearch((v) => !v)}
                    aria-label="Search within this collection"
                    aria-expanded={showListSearch}
                    className={`flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors duration-150 hover:bg-white/10 active:scale-[0.94] ${showListSearch ? "bg-white/12" : ""}`}
                  >
                    <Icon d={P.search} size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setListMenuOpen((v) => !v)}
                    aria-label={`More options for ${openCard.title}`}
                    aria-expanded={listMenuOpen}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors duration-150 hover:bg-white/10 active:scale-[0.94]"
                  >
                    <Icon d={P.dotsV} size={18} />
                  </button>
                </div>
                {listMenuOpen && (
                  <div className="glass spatial-float rise absolute top-[calc(100%+8px)] right-2 z-20 flex flex-col gap-1 rounded-2xl p-2">
                    <button
                      type="button"
                      onClick={() => {
                        setListMenuOpen(false);
                        if (collection.data) playShuffled(collection.data.tracks);
                      }}
                      className="rounded-xl px-4 py-2 text-left text-[13.5px] text-[var(--text)] hover:bg-white/[0.06]"
                    >
                      Shuffle play
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setListMenuOpen(false);
                        likeAllTracks(collection.data?.tracks ?? []);
                      }}
                      className="rounded-xl px-4 py-2 text-left text-[13.5px] text-[var(--text)] hover:bg-white/[0.06]"
                    >
                      Add all to Liked Songs
                    </button>
                    {!openIsUserPlaylist && (
                      <a
                        href={
                          openCard.id.startsWith("VL")
                            ? `https://music.youtube.com/playlist?list=${openCard.id.slice(2)}`
                            : `https://music.youtube.com/browse/${openCard.id}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-xl px-4 py-2 text-left text-[13.5px] text-[var(--text)] hover:bg-white/[0.06]"
                      >
                        Open on YouTube Music
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="relative z-10 px-4 pb-6 sm:px-6">
              {/* Large square cover, centred, with the play badge at
                  its top-left (reference screenshot). Tapping the
                  badge plays the collection — or pauses it when it
                  is the one currently playing. */}
              <div className="relative mx-auto mt-4 aspect-square w-full max-w-[380px]">
                {openCard.thumbnail ? (
                  <LargeArt src={openCard.thumbnail} alt="" className="spatial-art h-full w-full rounded-[24px] object-cover object-center" />
                ) : (
                  <div className="metal spatial-art h-full w-full rounded-[24px]" />
                )}
                {collection.isSuccess && !collection.data.error && collection.data.tracks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const tracks = collection.data.tracks;
                      if (current && tracks.some((t) => t.videoId === current.videoId)) togglePlayPause();
                      else playAt(tracks, 0);
                    }}
                    aria-label={
                      current && collection.data.tracks.some((t) => t.videoId === current.videoId)
                        ? playing
                          ? `Pause ${openCard.title}`
                          : `Resume ${openCard.title}`
                        : `Play ${openCard.title}`
                    }
                    className="absolute top-3 left-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#17171a] shadow-[0_8px_20px_rgba(0,0,0,0.45)] transition-transform duration-150 active:scale-[0.92]"
                  >
                    {current && collection.data.tracks.some((t) => t.videoId === current.videoId) && playing ? (
                      <PauseIcon size={16} />
                    ) : (
                      <Icon d={P.play} size={16} filled />
                    )}
                  </button>
                )}
              </div>

              <h1 className="mt-5 text-center text-[27px] leading-tight font-bold tracking-[-0.01em]">
                {collection.data?.title || openCard.title}
              </h1>
              <p className="mt-1 text-center text-[13px] text-white/60">
                {openIsUserPlaylist ? "Your Library" : "YouTube Music"} · {openCard.kind === "album" ? "Album" : "Playlist"}
                {collection.data?.subtitle || openCard.subtitle ? ` · ${collection.data?.subtitle || openCard.subtitle}` : ""}
              </p>

              {/* Count + total duration pill: "3 songs • 9m" */}
              {collection.isSuccess && collection.data.tracks.length > 0 && (
                <div className="mt-3 flex justify-center">
                  <span className="glass-soft rounded-full px-3.5 py-1.5 text-[13px] text-[var(--text)] tabular-nums">
                    {collection.data.tracks.length} {collection.data.tracks.length === 1 ? "song" : "songs"}
                    {(() => {
                      const totalSec = collection.data.tracks.reduce((a, t) => a + parseDur(t.duration), 0);
                      if (totalSec <= 0) return "";
                      const label =
                        totalSec >= 3600
                          ? `${Math.floor(totalSec / 3600)}h ${Math.round((totalSec % 3600) / 60)}m`
                          : `${Math.max(1, Math.round(totalSec / 60))}m`;
                      return ` • ${label}`;
                    })()}
                  </span>
                </div>
              )}

              {collection.isSuccess && !collection.data.error && collection.data.tracks.length > 0 && (
                <>
                  {/* Row 1: Save (heart) · frosted-white Play · Share */}
                  <div className="mx-auto mt-3 flex max-w-[520px] items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => likeAllTracks(collection.data.tracks)}
                      aria-label={`Save all songs in ${openCard.title} to Liked Songs`}
                      aria-pressed={collection.data.tracks.every((t) => likedSet.has(t.videoId))}
                      className="glass-soft flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[14.5px] text-[var(--text)] transition-transform duration-150 active:scale-[0.96]"
                    >
                      <span className={collection.data.tracks.every((t) => likedSet.has(t.videoId)) ? "text-[var(--accent)]" : ""}>
                        <Icon d={P.heart} size={18} filled={collection.data.tracks.every((t) => likedSet.has(t.videoId))} />
                      </span>
                      {collection.data.tracks.every((t) => likedSet.has(t.videoId)) ? "Saved" : "Save"}
                    </button>
                    <MetalPlayButton
                      playing={!!(current && collection.data.tracks.some((t) => t.videoId === current.videoId) && playing)}
                      onClick={() => {
                        if (current && collection.data.tracks.some((t) => t.videoId === current.videoId)) togglePlayPause();
                        else playAt(collection.data.tracks, 0);
                      }}
                    />
                    {!openIsUserPlaylist && (
                      <button
                        type="button"
                        onClick={() => {
                          const url = openCard.id.startsWith("VL")
                            ? `https://music.youtube.com/playlist?list=${openCard.id.slice(2)}`
                            : `https://music.youtube.com/browse/${openCard.id}`;
                          if (navigator.share) {
                            void navigator.share({ title: collection.data.title || openCard.title, url }).catch(() => {});
                          } else {
                            window.open(url, "_blank", "noopener,noreferrer");
                          }
                        }}
                        aria-label={`Share ${openCard.title}`}
                        className="glass-soft flex h-12 w-12 flex-none items-center justify-center rounded-full text-[var(--text)] transition-transform duration-150 active:scale-[0.94]"
                      >
                        <Icon d={P.share} size={19} />
                      </button>
                    )}
                  </div>

                  {/* Row 2: Save on YouTube Music · Shuffle · More */}
                  <div className="mx-auto mt-2.5 flex max-w-[520px] items-center gap-2.5">
                    {!openIsUserPlaylist && (
                      <a
                        href={
                          openCard.id.startsWith("VL")
                            ? `https://music.youtube.com/playlist?list=${openCard.id.slice(2)}`
                            : `https://music.youtube.com/browse/${openCard.id}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Save ${openCard.title} on YouTube Music`}
                        className="glass-soft flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[13.5px] text-[var(--text)] transition-transform duration-150 active:scale-[0.96]"
                      >
                        <Icon d={P.download} size={17} />
                        Save
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => playShuffled(collection.data.tracks)}
                      aria-label={`Shuffle play ${collection.data.title || openCard.title}`}
                      className="glass-soft flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[13.5px] text-[var(--text)] transition-transform duration-150 active:scale-[0.96]"
                    >
                      <Icon d={P.shuffle} size={17} />
                      Shuffle
                    </button>
                    <button
                      type="button"
                      onClick={() => setListMenuOpen((v) => !v)}
                      aria-label={`More options for ${openCard.title}`}
                      aria-expanded={listMenuOpen}
                      className="glass-soft flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[13.5px] text-[var(--text)] transition-transform duration-150 active:scale-[0.96]"
                    >
                      <Icon d={P.dotsV} size={17} />
                      More
                    </button>
                  </div>
                </>
              )}

              {collection.data?.description && (
                <p className="mx-auto mt-4 max-w-[420px] text-center text-[14px] leading-relaxed text-[var(--dim)]">
                  {collection.data.description}
                </p>
              )}

              {showListSearch && collection.data && collection.data.tracks.length > 0 && (
                <div className="glass-soft mx-auto mt-4 flex max-w-[420px] items-center gap-2 rounded-full px-4">
                  <span className="text-[var(--dim)]">
                    <Icon d={P.search} size={16} />
                  </span>
                  <label className="sr-only" htmlFor="collection-filter">
                    Filter songs in this collection
                  </label>
                  <input
                    id="collection-filter"
                    type="search"
                    value={listFilter}
                    onChange={(e) => setListFilter(e.target.value)}
                    placeholder="Filter songs…"
                    className="w-full bg-transparent py-2.5 text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--dim)]"
                  />
                </div>
              )}

              {collection.isPending && <p className="pt-10 text-center text-sm text-[var(--dim)]">Opening…</p>}
              {collection.isSuccess && collection.data.error && (
                <div className="pt-10 text-center">
                  <p className="text-sm text-[var(--dim)]">{collection.data.error}</p>
                  <button
                    type="button"
                    onClick={() => void collection.refetch()}
                    className="metal-flat mt-4 rounded-full border border-white/10 px-5 py-2 text-[12px] tracking-[0.18em] uppercase"
                  >
                    Retry
                  </button>
                </div>
              )}
              {collection.isSuccess && !collection.data.error && collection.data.tracks.length === 0 && (
                <p className="pt-10 text-center text-sm text-[var(--dim)]">No playable tracks found in this {openCard.kind}.</p>
              )}
              {collection.isSuccess && collection.data.tracks.length > 0 && (
                <div className="stagger mt-5 space-y-2">
                  {filterTracks(collection.data.tracks).map((t) => (
                    <TrackRow
                      key={t.videoId}
                      track={t}
                      card
                      isCurrent={current?.videoId === t.videoId}
                      isPlaying={playing}
                      isLiked={likedSet.has(t.videoId)}
                      list={collection.data.tracks}
                      onPlayTrack={onListPlay}
                      onToggleLikeTrack={onToggleLike}
                      onPlayNextTrack={onPlayNext}
                      onAddToQueueTrack={onAddToQueue}
                    />
                  ))}
                  {listFilter.trim() && filterTracks(collection.data.tracks).length === 0 && (
                    <p className="pt-6 text-center text-sm text-[var(--dim)]">No songs here match “{listFilter}”.</p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {tab === "search" && (
          <section className="rise pt-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearchQuery(searchInput.trim());
              }}
              className="flex gap-2"
            >
              <label className="sr-only" htmlFor="song-search">
                Search any song
              </label>
              <div className="metal-flat flex flex-1 items-center gap-2 rounded-full border border-white/10 px-4">
                <span className="text-[var(--dim)]">
                  <Icon d={P.search} size={17} />
                </span>
                <input
                  ref={searchInputRef}
                  id="song-search"
                  type="search"
                  placeholder="Search YouTube Music…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  {...FIELDS.searchMusic.query}
                  className="w-full bg-transparent py-2.5 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--dim)]"
                />
                {searchInput && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearchInput("");
                      setSearchQuery("");
                    }}
                    className="text-[var(--dim)]"
                  >
                    <Icon d={P.x} size={16} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={startVoiceSearch}
                aria-label="Voice search — say a song name"
                className="metal-flat flex h-11 w-11 flex-none items-center justify-center rounded-full border border-white/10 text-[var(--accent)] transition-transform duration-100 active:scale-[0.97]"
              >
                <Icon d={P.lyrics} size={19} />
              </button>
              <button
                type="submit"
                className="metal silver-glow min-h-[44px] flex-none rounded-full border border-white/10 px-5 text-[12px] tracking-[0.18em] uppercase transition-transform duration-100 active:scale-[0.97]"
              >
                Search
              </button>
            </form>

            {searchQuery.trim() === "" && (
              <div className="pt-7">
                <h2 className="font-display text-[24px]">Popular Songs</h2>
                <p className="mt-0.5 text-[13px] text-[var(--dim)]">The latest chart, live from YouTube Music</p>

                {popular.isPending && (
                  <div className="mt-4 space-y-2.5" aria-label="Loading popular songs">
                    {[0, 1, 2, 3, 4].map((k) => (
                      <div key={k} className="metal-flat flex items-center gap-3 rounded-[20px] border border-white/10 px-3 py-2.5">
                        <div className="h-5 w-6 flex-none animate-pulse rounded bg-white/[0.06]" />
                        <div className="h-14 w-14 flex-none animate-pulse rounded-[14px] bg-white/[0.06]" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                          <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.05]" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {popular.isSuccess && popular.data.source === "live" && (
                  <>
                    <div className="stagger mt-4 space-y-2.5">
                      {popularPageSongs.map((s, i) => (
                        <PopularRow
                          key={`pop-${s.videoId}`}
                          song={s}
                          rank={popularPageClamped * 5 + i + 1}
                          list={popular.data.songs}
                          isCurrent={current?.videoId === s.videoId}
                          isPlaying={playing}
                          isLiked={likedSet.has(s.videoId)}
                          onPlayTrack={onRowPlay}
                          onToggleLikeTrack={onToggleLike}
                          onPlayNextTrack={onPlayNext}
                          onAddToQueueTrack={onAddToQueue}
                        />
                      ))}
                    </div>

                    {popularPageCount > 1 && (
                      <div className="mt-4 flex justify-center">
                        <div className="metal-flat flex items-center gap-1 rounded-full border border-white/10 px-1.5 py-1.5">
                          <button
                            type="button"
                            onClick={() => setPopularPage(popularPageClamped - 1)}
                            disabled={popularPageClamped === 0}
                            aria-label="Previous page of Popular Songs"
                            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text)] transition-transform duration-100 active:scale-[0.94] disabled:pointer-events-none disabled:opacity-35"
                          >
                            <Icon d={P.back} size={16} />
                          </button>
                          <span className="min-w-[54px] text-center text-[12.5px] text-[var(--dim)] tabular-nums" aria-live="polite">
                            {popularPageClamped + 1} of {popularPageCount}
                          </span>
                          <button
                            type="button"
                            onClick={() => setPopularPage(popularPageClamped + 1)}
                            disabled={popularPageClamped >= popularPageCount - 1}
                            aria-label="Next page of Popular Songs"
                            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text)] transition-transform duration-100 active:scale-[0.94] disabled:pointer-events-none disabled:opacity-35"
                          >
                            <Icon d={P.chevronRight} size={16} />
                          </button>
                        </div>
                      </div>
                    )}

                    {popular.data.artists.length > 0 && (
                      <>
                        <h2 className="font-display mt-9 mb-3 text-[24px]">Trending Artists</h2>
                        <div className="grid grid-cols-3 gap-3">
                          {popular.data.artists.map((a, i) => (
                            <button
                              key={a.name}
                              type="button"
                              onClick={() => openSimilarArtist(a.name)}
                              aria-label={`Open artist page for ${a.name}, trending artist number ${i + 1}`}
                              className="transition-transform duration-150 active:scale-[0.97]"
                            >
                              <span className="relative block aspect-square overflow-hidden rounded-[22px] border border-white/10">
                                {a.thumbnail ? (
                                  <img src={smallThumb(a.thumbnail)} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />
                                ) : (
                                  <span className="metal absolute inset-0 block" />
                                )}
                                <span className="cover-play absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold tabular-nums" aria-hidden="true">
                                  {i + 1}
                                </span>
                              </span>
                              <span className="mt-2 block px-0.5 text-center">
                                <span className="block truncate text-[12.5px] leading-snug font-semibold text-white">{a.name}</span>
                                <span className="mt-0.5 block truncate text-[11px] text-[var(--dim)] tabular-nums">{a.plays}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}

                {(popular.isError || (popular.isSuccess && popular.data.source === "fallback")) && (
                  <div className="pt-8 text-center">
                    <p className="text-sm text-[var(--dim)]">
                      The YouTube Music chart could not be reached just now.
                    </p>
                    <button
                      type="button"
                      onClick={() => void popular.refetch()}
                      className="metal-flat mt-4 rounded-full border border-white/10 px-5 py-2 text-[12px] tracking-[0.18em] uppercase"
                    >
                      Retry
                    </button>
                  </div>
                )}

                <p className="pt-9 text-center text-sm leading-relaxed text-[var(--dim)]">
                  Any song, any artist — searched live on YouTube
                  <br />
                  and played in full, right here.
                </p>
              </div>
            )}

            {searchQuery.trim() !== "" && search.isPending && (
              <div className="space-y-2 pt-6" aria-label="Searching">
                {[0, 1, 2, 3, 4].map((k) => (
                  <div key={k} className="flex items-center gap-3 px-2 py-2">
                    <div className="h-12 w-12 flex-none animate-pulse rounded-xl bg-white/[0.06]" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                      <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.05]" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {searchQuery.trim() !== "" && search.isSuccess && search.data.error && (
              <p className="pt-10 text-center text-sm text-[var(--dim)]">{search.data.error}</p>
            )}
            {searchQuery.trim() !== "" && search.isSuccess && !search.data.error && search.data.results.length === 0 && (
              <p className="pt-10 text-center text-sm text-[var(--dim)]">
                No songs found for “{searchQuery}”. Try another title or artist.
              </p>
            )}
            {searchQuery.trim() !== "" && search.isSuccess && search.data.results.length > 0 && (
              <div className="stagger space-y-0.5 pt-4">
                {search.data.results.map((t) => (
                  <TrackRow
                    key={t.videoId}
                    track={t}
                    isCurrent={current?.videoId === t.videoId}
                    isPlaying={playing}
                    isLiked={likedSet.has(t.videoId)}
                    list={search.data.results}
                      onPlayTrack={onRowPlay}
                      onToggleLikeTrack={onToggleLike}
                      onPlayNextTrack={onPlayNext}
                      onAddToQueueTrack={onAddToQueue}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "liked" && !openCard && (
          <section className="rise pt-4" aria-label="Library">
            <div className="vision-panel rounded-[28px] p-4 sm:p-6">
              {/* On phone the Library sidebar stacks at the top of the
                  panel; on desktop the fixed Library panel at the
                  left edge carries the same sidebar. */}
              <div className="lg:hidden">
                <LibrarySidebar
                  compact
                  section={libSection}
                  onSection={setLibSection}
                  playlists={libPlaylistsAll}
                  likedCount={likedTracks.length}
                  onOpenCard={setOpenCard}
                  onAddPlaylist={() => setShowAddPlaylist(true)}
                />
              </div>

              <div className="mt-7 lg:mt-0">
                {libSection === "albums" && (
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h1 className="text-[26px] leading-tight font-bold text-white">Albums</h1>
                        <p className="mt-0.5 text-[13px] text-[var(--dim)] tabular-nums">
                          {libAlbums.length} Albums · live from YouTube Music
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLibSortAz((v) => !v)}
                        aria-pressed={libSortAz}
                        aria-label={libSortAz ? "Albums sorted A to Z — tap for feed order" : "Sort albums A to Z"}
                        className={`glass-soft flex h-10 w-10 flex-none items-center justify-center rounded-full transition-colors ${libSortAz ? "text-white" : "text-white/70"}`}
                      >
                        <Icon d={P.list} size={17} />
                      </button>
                    </div>
                    <div className="mt-4 flex items-center gap-2.5 rounded-full bg-black/35 px-4 py-1 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]">
                      <span className="flex-none text-[var(--dim)]">
                        <Icon d={P.lyrics} size={15} />
                      </span>
                      <label className="sr-only" htmlFor="albums-search">Search in Albums</label>
                      <input
                        id="albums-search"
                        type="search"
                        value={libQuery}
                        onChange={(e) => setLibQuery(e.target.value)}
                        placeholder="Search in Albums"
                        className="w-full bg-transparent py-2 text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--dim)]"
                      />
                      {libQuery && (
                        <button type="button" aria-label="Clear album search" onClick={() => setLibQuery("")} className="flex-none text-[var(--dim)]">
                          <Icon d={P.x} size={15} />
                        </button>
                      )}
                    </div>

                    {!libQuery.trim() && libAlbums.length > 2 && (
                      <div className="mt-6">
                        <StackCarousel cards={libAlbums} onOpen={setOpenCard} />
                      </div>
                    )}

                    {homeFeed.isPending && <p className="pt-10 text-center text-sm text-[var(--dim)]">Tuning into YouTube Music…</p>}
                    {homeFeed.isSuccess && homeFeed.data.source === "fallback" && (
                      <div className="pt-10 text-center">
                        <p className="text-sm text-[var(--dim)]">YouTube Music could not be reached just now, so there are no albums to show.</p>
                        <button
                          type="button"
                          onClick={() => void homeFeed.refetch()}
                          className="metal-flat mt-4 rounded-full border border-white/10 px-5 py-2 text-[12px] tracking-[0.18em] uppercase"
                        >
                          Try again
                        </button>
                      </div>
                    )}
                    {homeFeed.isSuccess && homeFeed.data.source === "live" && libAlbums.length === 0 && (
                      <p className="pt-10 text-center text-sm text-[var(--dim)]">
                        {libQuery.trim() ? `No albums match “${libQuery}”.` : "No albums in the live feed right now."}
                      </p>
                    )}
                    {libAlbums.length > 0 && (
                      <div className="stagger mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 xl:grid-cols-4">
                        {libAlbums.map((c) => (
                          <AlbumGridCard key={`lib-al-${c.id}`} card={c} onOpen={setOpenCard} />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {libSection === "allplaylists" && (
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h1 className="text-[26px] leading-tight font-bold text-white">Playlist</h1>
                        <p className="mt-0.5 text-[13px] text-[var(--dim)] tabular-nums">
                          {libPlaylists.length} Playlists
                          {userPlaylistCards.length > 0 ? " · yours first, then live from YouTube Music" : " · live from YouTube Music"}
                        </p>
                      </div>
                      <div className="flex flex-none items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowAddPlaylist(true)}
                          aria-label="Add Playlist — create a new playlist or import one from a link"
                          className="glass-soft flex h-10 w-10 items-center justify-center rounded-full text-white/85 transition-colors"
                        >
                          <Icon d={P.plus} size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setLibSortAz((v) => !v)}
                          aria-pressed={libSortAz}
                          aria-label={libSortAz ? "Playlists sorted A to Z — tap for feed order" : "Sort playlists A to Z"}
                          className={`glass-soft flex h-10 w-10 items-center justify-center rounded-full transition-colors ${libSortAz ? "text-white" : "text-white/70"}`}
                        >
                          <Icon d={P.list} size={17} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2.5 rounded-full bg-black/35 px-4 py-1 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]">
                      <span className="flex-none text-[var(--dim)]">
                        <Icon d={P.lyrics} size={15} />
                      </span>
                      <label className="sr-only" htmlFor="playlists-search">Search in Playlists</label>
                      <input
                        id="playlists-search"
                        type="search"
                        value={libQuery}
                        onChange={(e) => setLibQuery(e.target.value)}
                        placeholder="Search in Playlists"
                        className="w-full bg-transparent py-2 text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--dim)]"
                      />
                      {libQuery && (
                        <button type="button" aria-label="Clear playlist search" onClick={() => setLibQuery("")} className="flex-none text-[var(--dim)]">
                          <Icon d={P.x} size={15} />
                        </button>
                      )}
                    </div>
                    {homeFeed.isPending && libPlaylists.length === 0 && <p className="pt-10 text-center text-sm text-[var(--dim)]">Tuning into YouTube Music…</p>}
                    {homeFeed.isSuccess && homeFeed.data.source === "live" && libPlaylists.length === 0 && (
                      <p className="pt-10 text-center text-sm text-[var(--dim)]">
                        {libQuery.trim() ? `No playlists match “${libQuery}”.` : "No playlists in the live feed right now."}
                      </p>
                    )}
                    {libPlaylists.length > 0 && (
                      <>
                        <p className="mt-4 text-[12.5px] text-[var(--dim)]">Hold a playlist to remove it from your library.</p>
                        <div className="stagger mt-4 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 xl:grid-cols-4">
                          {libPlaylists.map((c) => (
                            <AlbumGridCard
                              key={`lib-pl2-${c.id}`}
                              card={c}
                              onOpen={setOpenCard}
                              onLongPress={(card, rect) => {
                                setRemovePlaylistError(null);
                                setRemoveAnchor({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
                                setPlaylistToRemove(card);
                              }}
                            />
                          ))}
                        </div>
                      </>
                    )}

                    {playlistToRemove &&
                      createPortal(
                      <div
                        className="fixed inset-0 z-[90] bg-black/60"
                        role="presentation"
                        onClick={() => {
                          if (!removePlaylistMutation.isPending) {
                            setPlaylistToRemove(null);
                            setRemovePlaylistError(null);
                          }
                        }}
                      >
                        <div
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="remove-playlist-title"
                          className="vision-panel absolute w-[calc(100%-2rem)] max-w-sm rounded-[28px] p-5"
                          style={(() => {
                            // Centre the panel over the held card,
                            // clamped so it always stays fully on
                            // screen (12px margins, ~130px half-height
                            // allowance for the panel itself). The
                            // anchor is the card's viewport rect, and
                            // this dialog is portalled to <body> —
                            // inside the page's .vision-panel the
                            // backdrop-filter would make THAT panel
                            // the containing block for position:fixed,
                            // so the overlay stretched over the whole
                            // page and the card coordinates landed
                            // mid-screen instead of over the card.
                            const vw = typeof window !== "undefined" ? window.innerWidth : 390;
                            const vh = typeof window !== "undefined" ? window.innerHeight : 844;
                            const panelHalfW = Math.min(384, vw - 32) / 2;
                            const cx = removeAnchor ? removeAnchor.left + removeAnchor.width / 2 : vw / 2;
                            const cy = removeAnchor ? removeAnchor.top + removeAnchor.height / 2 : vh / 2;
                            const left = Math.max(panelHalfW + 12, Math.min(cx, vw - panelHalfW - 12));
                            const top = Math.max(142, Math.min(cy, vh - 142));
                            return { left, top, transform: "translate(-50%, -50%)", transformOrigin: "center" };
                          })()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-start gap-3.5">
                            {playlistToRemove.thumbnail ? (
                              <img src={smallThumb(playlistToRemove.thumbnail)} alt="" className="h-14 w-14 flex-none rounded-[14px] object-cover" />
                            ) : (
                              <span className="metal block h-14 w-14 flex-none rounded-[14px]" aria-hidden="true" />
                            )}
                            <div className="min-w-0">
                              <h2 id="remove-playlist-title" className="text-[17px] leading-snug font-bold text-white">
                                Remove this playlist?
                              </h2>
                              <p className="mt-1 truncate text-[13.5px] text-[var(--dim)]">{playlistToRemove.title}</p>
                              <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
                                {playlistToRemove.id.startsWith("user:")
                                  ? "This is your own playlist — it will be deleted from your Library."
                                  : "It will be removed from All Playlists and won't come back on refresh."}
                              </p>
                            </div>
                          </div>
                          {removePlaylistError && (
                            <p className="mt-3 text-[13px] text-red-300" role="alert">
                              {removePlaylistError}
                            </p>
                          )}
                          <div className="mt-5 flex gap-2.5">
                            <button
                              type="button"
                              onClick={() => {
                                setPlaylistToRemove(null);
                                setRemovePlaylistError(null);
                              }}
                              disabled={removePlaylistMutation.isPending}
                              className="glass-soft flex-1 rounded-full px-5 py-2.5 text-[13px] tracking-[0.08em] text-white uppercase transition-transform duration-150 active:scale-[0.97] disabled:opacity-50"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => removePlaylistMutation.mutate(playlistToRemove)}
                              disabled={removePlaylistMutation.isPending}
                              aria-label={`Remove playlist ${playlistToRemove.title}`}
                              className="flex-1 rounded-full bg-red-500/90 px-5 py-2.5 text-[13px] font-semibold tracking-[0.08em] text-white uppercase transition-transform duration-150 active:scale-[0.97] disabled:opacity-50"
                            >
                              {removePlaylistMutation.isPending ? "Removing…" : "Remove"}
                            </button>
                          </div>
                        </div>
                      </div>,
                      document.body,
                    )}
                  </div>
                )}

                {libSection === "artists" && (
                  <div>
                    <h1 className="text-[26px] leading-tight font-bold text-white">Artists</h1>
                    <p className="mt-0.5 text-[13px] text-[var(--dim)]">Artists similar to what you play — tap one to hear them.</p>
                    {(homeFeed.data?.similarArtists ?? []).length === 0 && (
                      <p className="pt-10 text-center text-sm text-[var(--dim)]">
                        {homeFeed.isPending ? "Tuning into YouTube Music…" : "No artists yet — play a few songs and this fills up from your listening."}
                      </p>
                    )}
                    <div className="stagger mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 xl:grid-cols-4">
                      {(homeFeed.data?.similarArtists ?? []).map((a) => (
                        <button
                          key={`lib-art-${a.name}`}
                          type="button"
                          onClick={() => openSimilarArtist(a.name)}
                          aria-label={`Search songs by ${a.name}`}
                          className="text-left transition-transform duration-150 active:scale-[0.97]"
                        >
                          <span className="relative block overflow-hidden rounded-[20px] border border-white/10 shadow-[0_14px_30px_rgba(0,0,0,0.45)]">
                            {a.thumbnail ? (
                              <img src={fillThumb(a.thumbnail)} alt="" className="aspect-square w-full object-cover object-center" loading="lazy" decoding="async" />
                            ) : (
                              <span className="metal block aspect-square w-full" aria-hidden="true" />
                            )}
                          </span>
                          <span className="mt-2.5 block truncate text-[14.5px] leading-snug font-bold text-white">{a.name}</span>
                          <span className="mt-0.5 block text-[12.5px] text-[var(--dim)]">Artist</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {libSection === "songs" && (
                  <div>
                    <h1 className="text-[26px] leading-tight font-bold text-white">Songs</h1>
                    <p className="mt-0.5 text-[13px] text-[var(--dim)]">Your Liked Songs — only songs you have liked yourself live here.</p>
                    {likedQuery.isPending && <p className="pt-8 text-sm text-[var(--dim)]">Loading…</p>}
                    {likedQuery.isSuccess && likedTracks.length === 0 && (
                      <div className="pt-10 text-center">
                        <p className="text-sm leading-relaxed text-[var(--dim)]">
                          Nothing here yet. Tap the heart on any song
                          <br />
                          and it will live on this page.
                        </p>
                        <button
                          type="button"
                          onClick={() => setTab("search")}
                          className="metal-flat mt-5 rounded-full border border-white/10 px-5 py-2 text-[12px] tracking-[0.18em] uppercase"
                        >
                          Find a song
                        </button>
                      </div>
                    )}
                    {likedTracks.length > 0 && (
                      <>
                        <ShinyButton
                          onClick={() => playAt(likedTracks, 0)}
                          aria-label="Play all Liked Songs"
                          className="mt-4 px-6 py-2.5 text-[13px] tracking-[0.16em] uppercase [&>span]:flex [&>span]:items-center [&>span]:gap-2"
                        >
                          <Icon d={P.play} size={15} filled /> Play all
                        </ShinyButton>
                        <div className="stagger mt-4 space-y-0.5">
                          {likedTracks.map((t) => (
                            <TrackRow
                              key={t.videoId}
                              track={t}
                              isCurrent={current?.videoId === t.videoId}
                              isPlaying={playing}
                              isLiked={true}
                              list={likedTracks}
                              onPlayTrack={onListPlay}
                              onToggleLikeTrack={onToggleLike}
                              onPlayNextTrack={onPlayNext}
                              onAddToQueueTrack={onAddToQueue}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {libSection === "made" && (
                  <div>
                    <h1 className="text-[26px] leading-tight font-bold text-white">Made For You</h1>
                    <p className="mt-0.5 text-[13px] text-[var(--dim)]">
                      {homeFeed.data?.recommendedBasis ?? "Built from your listening, live from YouTube Music."}
                    </p>
                    {(homeFeed.data?.recommended ?? []).length === 0 && (
                      <p className="pt-10 text-center text-sm text-[var(--dim)]">
                        {homeFeed.isPending ? "Tuning into YouTube Music…" : "Play a few songs and your mix builds itself here."}
                      </p>
                    )}
                    <div className="stagger mt-4 space-y-0.5">
                      {(homeFeed.data?.recommended ?? []).map((t) => (
                        <TrackRow
                          key={`made-${t.videoId}`}
                          track={t}
                          isCurrent={current?.videoId === t.videoId}
                          isPlaying={playing}
                          isLiked={likedSet.has(t.videoId)}
                          list={homeFeed.data?.recommended ?? []}
                          onPlayTrack={onRowPlay}
                          onToggleLikeTrack={onToggleLike}
                          onPlayNextTrack={onPlayNext}
                          onAddToQueueTrack={onAddToQueue}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {libSection === "wallpaper" && (
                  <WallpaperSettings
                    kind={wallpaperQuery.data?.kind ?? "none"}
                    currentUrl={wallpaperUrl}
                    onApplyUrl={async (u) => {
                      await api.setWallpaperUrl({ url: u });
                      void queryClient.invalidateQueries({ queryKey: ["wallpaper"] });
                    }}
                    onUpload={handleWallpaperUpload}
                    onReset={async () => {
                      await api.resetWallpaper({});
                      void queryClient.invalidateQueries({ queryKey: ["wallpaper"] });
                    }}
                  />
                )}
              </div>
            </div>
          </section>
        )}

        {showAddPlaylist && (
          <AddPlaylistSheet onClose={() => setShowAddPlaylist(false)} onOpenPlaylist={openAddedPlaylist} />
        )}

        {tab === "profile" && (
          <ProfileSection
            profile={profileQuery.data ?? null}
            profileLoading={profileQuery.isPending}
            stats={statsQuery.data ?? null}
            statsLoading={statsQuery.isPending}
            range={profileRange}
            onRangeChange={setProfileRange}
            isCurrent={(id) => current?.videoId === id}
            isPlaying={playing}
            isLiked={(id) => likedSet.has(id)}
            onPlayTrack={onRowPlay}
            onToggleLikeTrack={onToggleLike}
            onSearchArtist={openSimilarArtist}
            onSaveProfile={async (displayName, bio) => {
              await api.updateProfile({ displayName, bio });
              void queryClient.invalidateQueries({ queryKey: ["profile"] });
            }}
            onAvatarChosen={async (file) => {
              const url = URL.createObjectURL(file);
              try {
                const img = new Image();
                await new Promise<void>((resolve, reject) => {
                  img.onload = () => resolve();
                  img.onerror = () => reject(new Error("image"));
                  img.src = url;
                });
                const size = 256;
                const canvas = document.createElement("canvas");
                canvas.width = size;
                canvas.height = size;
                const cx = canvas.getContext("2d");
                if (!cx) return;
                const side = Math.min(img.naturalWidth, img.naturalHeight);
                cx.drawImage(
                  img,
                  (img.naturalWidth - side) / 2,
                  (img.naturalHeight - side) / 2,
                  side,
                  side,
                  0,
                  0,
                  size,
                  size,
                );
                const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
                if (!blob) return;
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  const r = new FileReader();
                  r.onload = () => resolve(r.result as string);
                  r.onerror = () => reject(new Error("read"));
                  r.readAsDataURL(blob);
                });
                const base64 = dataUrl.split(",")[1] ?? "";
                if (!base64) return;
                await api.setAvatar({ dataBase64: base64, mimeType: "image/jpeg" });
                void queryClient.invalidateQueries({ queryKey: ["profile"] });
              } finally {
                URL.revokeObjectURL(url);
              }
            }}
          />
        )}

        {tab === "about" && !openCard && (
          <section className="pt-4" aria-label="About Frostora">
            <button
              type="button"
              onClick={() => setTab("home")}
              aria-label="Back to Home from About"
              className="glass-soft flex items-center gap-2 rounded-full px-4 py-2 text-[13px] text-white transition-transform duration-150 active:scale-[0.97]"
            >
              <Icon d={P.back} size={16} />
              Back to music
            </button>

            <div className="mt-6 flex flex-col items-center text-center">
              <span className="relative block h-24 w-24" aria-hidden="true">
                <span className="crystal-halo" />
                <span className="crystal-ripple is-still" />
                <img
                  src={frostoraIcon}
                  alt=""
                  className="silver-glow relative h-24 w-24 rounded-full border border-white/15 object-cover"
                />
                <span
                  className="crystal-sparkle"
                  style={{ top: "-3px", left: "14px", animationDelay: "0s", ["--drift-x" as string]: "2px", ["--drift-y" as string]: "-3px" }}
                />
                <span
                  className="crystal-sparkle"
                  style={{ top: "10px", right: "-4px", animationDelay: "1.6s", animationDuration: "7s", ["--drift-x" as string]: "3px", ["--drift-y" as string]: "2px" }}
                />
                <span
                  className="crystal-sparkle"
                  style={{ bottom: "4px", left: "-4px", animationDelay: "3.1s", animationDuration: "6.5s", ["--drift-x" as string]: "-2px", ["--drift-y" as string]: "3px" }}
                />
                <span
                  className="crystal-sparkle"
                  style={{ bottom: "-3px", right: "18px", animationDelay: "4.4s", animationDuration: "7.5s", ["--drift-x" as string]: "-3px", ["--drift-y" as string]: "-2px" }}
                />
              </span>
              <h2 className="font-display mt-5 text-[30px] tracking-[0.03em]">Frostora</h2>
              <p className="mt-1 text-[13px] tracking-[0.14em] text-[var(--dim)] uppercase">Frost + Aura</p>
            </div>

            <div className="glass mt-7 rounded-[28px] p-6">
              <h3 className="font-display text-[20px]">About the app</h3>
              <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--text)]">
                Frostora is a phone-first music app that streams live from YouTube Music — search any song and play it in full, right
                here. No songs are stored in the app; everything plays live.
              </p>
              <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--text)]">
                The name blends <em>frost</em> and <em>aura</em> — the faceted ice crystal with a sound wave inside is its mark, and the
                frosted-glass look runs through every screen.
              </p>
            </div>

            <div className="glass mt-4 rounded-[28px] p-6">
              <h3 className="font-display text-[20px]">About the creator</h3>
              <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--text)]">
                &ldquo;Kya kroge jaan kr&rdquo; ~ <strong>Naman</strong>
              </p>
            </div>

            <div className="mt-7 flex justify-center">
              <FeedbackPill />
            </div>
          </section>
        )}
      </main>

      {/* ----- desktop Now Playing panel (right column) ----- */}
      {current && desktopPanelOpen && (
        <aside className="spatial-panel-right fixed top-0 right-0 bottom-0 z-40 hidden w-[360px] overflow-hidden lg:block" aria-label="Now Playing panel">
          <img src={smallThumb(current.thumbnail)} alt="" aria-hidden="true" decoding="async" className="pointer-events-none absolute inset-0 h-full w-full scale-150 object-cover opacity-40 blur-2xl" />
          <div className="pointer-events-none absolute inset-0 bg-[#101013]/65" aria-hidden="true" />
          <div className="relative z-10 flex h-full flex-col overflow-y-auto px-6 py-6">
            <div className="flex items-center justify-between">
              <p className="text-[11px] tracking-[0.24em] text-white/60 uppercase">Now Playing</p>
              <button
                type="button"
                onClick={() => setDesktopPanelOpen(false)}
                aria-label="Hide Now Playing panel"
                className="glass-soft flex h-9 w-9 items-center justify-center rounded-full text-white transition-transform duration-150 active:scale-[0.94]"
              >
                <Icon d={P.x} size={15} />
              </button>
            </div>
            <div className="mt-5 flex-none">
              <LiquidArt
                src={current.thumbnail}
                visualKey={`${current.videoId}|s`}
                dirRef={navDirRef}
                alt={`Cover art for ${current.title}`}
                playing={playing}
                roundedClass="rounded-[18px]"
              />
            </div>
            <p className="mt-5 truncate text-[19px] font-bold text-white">{current.title}</p>
            <p className="truncate text-[13.5px] text-white/65">{current.artist}</p>
            {(() => {
              const d = panelLyrics.data;
              if (!d || (d.kind !== "synced" && d.kind !== "karaoke")) return null;
              let txt = "";
              for (const l of d.lines) {
                if (l.time !== null && l.time <= progress.t + 0.15) txt = l.text;
                else break;
              }
              return txt ? (
                <p className="mt-3 line-clamp-2 text-[14px] leading-relaxed font-medium text-white/85" aria-label="Current lyric line">
                  {txt}
                </p>
              ) : null;
            })()}
            <div className="mt-5 h-[4px] overflow-hidden rounded-full bg-white/15">
              <div className="h-full w-full origin-left bg-white transition-transform duration-300" style={{ transform: `scaleX(${pct / 100})` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[11.5px] text-white/60 tabular-nums">
              <span>{fmt(progress.t)}</span>
              <span>{fmt(progress.d)}</span>
            </div>
            <div className="mt-4 flex items-center justify-center gap-5">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous song"
                className="glass-soft flex h-11 w-11 items-center justify-center rounded-full text-white transition-transform duration-150 active:scale-[0.92]"
              >
                <Icon d={P.prev} size={19} filled />
              </button>
              <BurstButton playing={playing} onClick={togglePlayPause} label={playing ? `Pause ${current.title}` : `Play ${current.title}`} size={58} />
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next song"
                className="glass-soft flex h-11 w-11 items-center justify-center rounded-full text-white transition-transform duration-150 active:scale-[0.92]"
              >
                <Icon d={P.next} size={19} filled />
              </button>
              <button
                type="button"
                onClick={() => likeMutation.mutate(current)}
                aria-label={likedSet.has(current.videoId) ? `Remove ${current.title} from Liked Songs` : `Add ${current.title} to Liked Songs`}
                aria-pressed={likedSet.has(current.videoId)}
                className={`glass-soft flex h-11 w-11 items-center justify-center rounded-full transition-colors ${likedSet.has(current.videoId) ? "text-white" : "text-white/60"}`}
              >
                <Icon d={P.heart} size={18} filled={likedSet.has(current.videoId)} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="glass mt-auto w-full rounded-full py-2.5 text-[12px] tracking-[0.16em] text-white uppercase transition-transform duration-150 active:scale-[0.98]"
            >
              Open full player
            </button>
          </div>
        </aside>
      )}
      {current && !desktopPanelOpen && (
        <button
          type="button"
          onClick={() => setDesktopPanelOpen(true)}
          aria-label="Show Now Playing panel"
          className="glass fixed right-5 bottom-24 z-40 hidden h-12 w-12 items-center justify-center rounded-full text-white lg:flex"
        >
          <Icon d={P.note} size={20} />
        </button>
      )}

      {/* ----- floating bottom nav (Echo-style pill) ----- */}
      {!expanded && (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(env(safe-area-inset-bottom),10px)] lg:hidden"
          aria-label="Main navigation"
        >
          <div className="glass spatial-float-nav mx-auto flex max-w-md items-center justify-between rounded-full px-2 py-1.5">
            <button
              type="button"
              aria-current={tab === "home" && !openCard ? "page" : undefined}
              aria-label="Home"
              onClick={() => {
                setTab("home");
                
                setOpenCard(null);
              }}
              className={`flex items-center gap-2 rounded-full px-4 py-2 transition-colors ${tab === "home" && !openCard ? "bg-white/12 text-white" : "text-[var(--dim)]"}`}
            >
              <Icon d={P.home} size={20} />
              <span className="text-[12.5px] font-medium">Home</span>
            </button>
            <button
              type="button"
              aria-label="Voice search — tap and say a song"
              onClick={startVoiceSearch}
              className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--dim)] transition-colors hover:text-white"
            >
              <Icon d={P.lyrics} size={20} />
            </button>
            <button
              type="button"
              aria-current={tab === "liked" && !openCard ? "page" : undefined}
              aria-label={likedTracks.length > 0 ? `Library — ${likedTracks.length} liked songs` : "Library"}
              onClick={() => {
                setTab("liked");
                
                setOpenCard(null);
              }}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${tab === "liked" && !openCard ? "bg-white/12 text-white" : "text-[var(--dim)]"}`}
            >
              <Icon d={P.library} size={20} />
            </button>
            <button
              type="button"
              aria-current={tab === "search" && !openCard ? "page" : undefined}
              aria-label="Search — double-tap to open the search bar"
              onClick={() => {
                setTab("search");

                setOpenCard(null);
              }}
              onDoubleClick={openSearchAndFocus}
              className={`flex h-11 w-11 touch-manipulation items-center justify-center rounded-full transition-colors ${tab === "search" && !openCard ? "bg-white/12 text-white" : "metal-flat border border-white/12 text-[var(--text)]"}`}
            >
              <Icon d={P.search} size={20} />
            </button>
          </div>
        </nav>
      )}

      {/* ----- floating pill mini-player (reference) -----
          A full capsule floating above the nav: prev / pause / next,
          an inset darker capsule with cover + song + artist (tap to
          open the full player), then lyrics, queue and volume. The
          seek position rides as a thin line under the inset capsule. */}
      {current && !expanded && (
        <div className={`fixed inset-x-0 z-40 px-3 lg:left-[328px] ${desktopPanelOpen ? "lg:right-[380px]" : "lg:right-3"}`} style={{ bottom: "calc(76px + env(safe-area-inset-bottom))" }}>
          <div className="pill-player relative mx-auto flex max-w-3xl items-center gap-1.5 py-2 pr-3 pl-2.5 sm:gap-2.5">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous song"
              className="lg-press flex h-11 w-10 flex-none items-center justify-center text-white"
            >
              <Icon d={P.prev} size={21} filled />
            </button>
            <button
              type="button"
              onClick={togglePlayPause}
              aria-label={playing ? `Pause ${current.title}` : `Play ${current.title}`}
              className="lg-press flex h-11 w-10 flex-none items-center justify-center text-white"
            >
              {playing ? <PauseIcon size={21} /> : <Icon d={P.play} size={21} filled />}
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next song"
              className="lg-press flex h-11 w-10 flex-none items-center justify-center text-white"
            >
              <Icon d={P.next} size={21} filled />
            </button>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={`Open full player for ${current.title} by ${current.artist}`}
              className="pill-player-inset relative mx-0.5 flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-full py-1.5 pr-3.5 pl-1.5 text-left"
            >
              <img src={smallThumb(current.thumbnail)} alt="" className="h-9 w-9 flex-none rounded-full object-cover object-center" />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] leading-tight font-semibold text-white">{current.title}</span>
                <span className="block truncate text-[11.5px] text-white/60">{current.artist}</span>
              </span>
              <span className="pointer-events-none absolute right-3 bottom-[3px] left-12 h-[2px] overflow-hidden rounded-full bg-white/12" aria-hidden="true">
                <span className="block h-full w-full origin-left bg-[var(--accent)] transition-transform duration-300" style={{ transform: `scaleX(${pct / 100})` }} />
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setExpanded(true);
                setShowLyrics(true);
              }}
              aria-label={`Show lyrics for ${current.title}`}
              className="hidden h-11 w-10 flex-none items-center justify-center text-white/80 transition-transform duration-150 active:scale-[0.92] min-[420px]:flex"
            >
              <Icon d={P.comment} size={19} />
            </button>
            <button
              type="button"
              onClick={() => {
                setExpanded(true);
                setShowQueue(true);
              }}
              aria-label="Show queue"
              className="hidden h-11 w-10 flex-none items-center justify-center text-white/80 transition-transform duration-150 active:scale-[0.92] min-[420px]:flex"
            >
              <Icon d={P.list} size={19} />
            </button>
            <span className="hidden items-center gap-1.5 text-white/80 md:flex" aria-hidden="true">
              <Icon d={P.volume} size={18} />
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => applySliderVolume(Number(e.target.value))}
              aria-label="Volume"
              className="fader hidden w-16 flex-none md:block"
              style={{ "--fill": `${volume}%` } as CSSProperties}
            />
          </div>
        </div>
      )}

      {/* ----- expanded player (Now Playing redesign, 20 Nov):
          ONE layout only. Full-bleed ambient gradient sampled
          from the current cover — deep muted tone at the top,
          richer luminous tint toward the bottom — crossfading
          over 800ms on track change (ambientLayers); never the
          cover itself as a full-bleed photo, and the app's own
          charcoal when no tint has been sampled yet. Large art
          card on top (living-art: scale 1.0 playing / 0.94
          paused), then ONE Liquid Glass hero card (.np-glass-card:
          white 12% glass, 36px blur, specular rim) holding title /
          artist / heart, the white pill scrubber and the white
          transport controls; the white volume slider sits on the
          ambient background below the card, and the bottom row is
          lyrics · shuffle · segmented glass pill (repeat | video)
          · timer · queue. If the cover colour cannot be sampled,
          a heavily blurred, darkened wash of the cover is the
          tint — a colour wash, not a recognisable photo. */}
      {current && expanded && (
        <div className="player-in fixed inset-0 z-[60] overflow-hidden bg-[#0a0a0c] text-white">
          {ambientLayers.length > 0 ? (
            ambientLayers.map((layer, i) => (
              <div
                key={`tint-${layer.id}`}
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 ${i === ambientLayers.length - 1 ? "np-fade-in" : ""}`}
                style={{
                  background: `linear-gradient(180deg, rgb(${Math.round(layer.tint.r * 0.3)}, ${Math.round(layer.tint.g * 0.3)}, ${Math.round(layer.tint.b * 0.3)}) 0%, rgb(${Math.round(layer.tint.r * 0.68)}, ${Math.round(layer.tint.g * 0.68)}, ${Math.round(layer.tint.b * 0.68)}) 42%, rgb(${Math.round(layer.tint.r + (255 - layer.tint.r) * 0.16)}, ${Math.round(layer.tint.g + (255 - layer.tint.g) * 0.16)}, ${Math.round(layer.tint.b + (255 - layer.tint.b) * 0.16)}) 78%, rgb(${Math.round(layer.tint.r * 0.82)}, ${Math.round(layer.tint.g * 0.82)}, ${Math.round(layer.tint.b * 0.82)}) 100%)`,
                }}
              />
            ))
          ) : (
            <>
              <img
                key={`blur-${current.videoId}`}
                src={smallThumb(current.thumbnail)}
                alt=""
                aria-hidden="true"
                decoding="async"
                className="np-fade-in pointer-events-none absolute inset-0 h-full w-full scale-[1.5] object-cover blur-3xl brightness-[0.55] saturate-[1.3]"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-black/20 to-[#0a0a0c]/80" aria-hidden="true" />
            </>
          )}

          <div className="relative z-10 mx-auto flex h-full w-full max-w-xl flex-col overflow-y-auto px-6 pb-[max(env(safe-area-inset-bottom),18px)] pt-[max(env(safe-area-inset-top),14px)]">
            <div className="flex flex-none items-start justify-between">
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  setShowLyrics(false);
                }}
                aria-label="Close full player"
                className="glass-soft flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform duration-150 active:scale-[0.94]"
              >
                <Icon d={P.chevronDown} size={21} />
              </button>
              {/* No centre title (reference): the song's title
                  lives only in the frosted card below the art —
                  never over the cover. */}
              <span aria-hidden="true" />
              {hasOfficialVideo ? (
                <button
                  type="button"
                  onClick={() => requestModeSwitch(!showVideo)}
                  aria-label={showVideo ? "Switch to song only — keeps your place in the song" : "Switch to video — keeps your place in the song"}
                  aria-pressed={showVideo}
                  className={`glass-soft flex h-10 w-10 items-center justify-center rounded-full transition-colors ${showVideo ? "text-white" : "text-white/60"}`}
                >
                  <Icon d={P.cast} size={20} />
                </button>
              ) : (
                <span className="h-10 w-10" aria-hidden="true" />
              )}
            </div>

            <div className={videoOnScreen ? "mt-[calc(min(92vw,560px)*0.5625+26px)]" : "mt-5"}>
              {/* Video-mode status lines: while the official
                  video is being looked up, and the brief notice
                  when a song the player was watching the video of
                  turns out to have no official video — Video mode
                  switches itself back to the song (see the
                  auto-switch effect) and this line says why. The
                  artwork below stays visible throughout; a video
                  replaces it only for a verified official one. */}
              {showVideo && officialVideo.isFetching && !officialVideo.data && (
                <p className="rise mx-auto mb-4 w-fit rounded-full bg-black/45 px-4 py-2 text-center text-[12.5px] text-white/85" role="status">
                  Finding the official video…
                </p>
              )}
              {showVideo && officialVideo.data?.status === "none" && (
                <p className="rise mx-auto mb-4 w-fit rounded-full bg-black/45 px-4 py-2 text-center text-[12.5px] text-white/85" role="status">
                  {officialVideo.data.error
                    ? "Couldn't check for an official video right now — playing the audio."
                    : "No official video for this song — playing the audio."}
                </p>
              )}
              {videoOnScreen && officialVideo.data?.skipSource === "segments" && (
                <p className="rise mx-auto mb-4 w-fit rounded-full bg-black/45 px-4 py-2 text-center text-[12.5px] text-white/85" role="status">
                  Music only — non-music intro &amp; outro will be skipped.
                </p>
              )}
              {videoOnScreen && officialVideo.data?.skipSource === "duration" && (
                <p className="rise mx-auto mb-4 w-fit rounded-full bg-black/45 px-4 py-2 text-center text-[12.5px] text-white/85" role="status">
                  Music only — the non-music intro will be skipped.
                </p>
              )}
              {skipNote && (
                <p className="rise mx-auto mb-4 w-fit rounded-full bg-black/55 px-4 py-2 text-center text-[12.5px] font-medium text-white" role="status" aria-live="polite">
                  {skipNote}
                </p>
              )}
              {/* Poster card — LiquidArt, the liquid morph from
                  the reference video. It stays MOUNTED (hidden)
                  while the video is on screen so its settled
                  poster is remembered: switching back to Song
                  melts the video poster into the artwork, and a
                  Next / Previous melts one poster's melt into
                  the next, wave front running with the switch
                  direction. */}
              <div className={videoOnScreen ? "hidden" : "mx-auto w-[min(84vw,380px)]"}>
                <LiquidArt
                  src={posterSrc}
                  visualKey={posterKey}
                  dirRef={navDirRef}
                  alt={`Artwork for ${current.title}`}
                  playing={playing}
                />
              </div>

              {/* Liquid Glass hero card (redesign spec): the exact
                  .np-glass-card material — white glass over the
                  ambient gradient, so the cover tint refracts
                  through the blur instead of being painted on.
                  Title bold white, artist at 78% white, heart on
                  the right (white fill + spring pop when liked);
                  white pill scrubber inside the card with elapsed
                  left / total right in tabular-nums;
                  prev / pause / next centred. Shuffle and repeat
                  live in the bottom row, like the reference. */}
              <div className="np-glass-card mx-auto mt-6 w-full max-w-[430px] rounded-[30px] px-6 pt-6 pb-7">
                  <div className="flex items-start justify-between gap-3">
                    <SlidingTitle title={current.title} artist={current.artist} dirRef={navDirRef} />
                    <button
                      key={likedSet.has(current.videoId) ? "liked" : "unliked"}
                      type="button"
                      onClick={() => likeMutation.mutate(current)}
                      aria-label={likedSet.has(current.videoId) ? `Remove ${current.title} from Liked Songs` : `Add ${current.title} to Liked Songs`}
                      aria-pressed={likedSet.has(current.videoId)}
                      className={`flex h-11 w-11 flex-none items-center justify-center rounded-full ${likedSet.has(current.videoId) ? "np-heart-pop text-[var(--silver)]" : "np-press text-white/85"}`}
                    >
                      <Icon d={P.heart} size={22} filled={likedSet.has(current.videoId)} />
                    </button>
                  </div>

                  <div className="mt-5 flex items-center gap-3">
                    <span className="w-9 flex-none text-[12px] text-white/80 tabular-nums">{fmt(progress.t)}</span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(1, Math.floor(progress.d))}
                      value={Math.floor(progress.t)}
                      onChange={(e) => safeSeek(Number(e.target.value))}
                      aria-label={`Seek in ${current.title}`}
                      className="np-fader min-w-0 flex-1"
                      style={{ "--fill": `${pct}%` } as CSSProperties}
                    />
                    <span className="w-9 flex-none text-right text-[12px] text-white/80 tabular-nums">{fmt(progress.d)}</span>
                  </div>

                  <div className="mt-2 flex items-center justify-center gap-5">
                    <button
                      type="button"
                      onClick={() => step(-1)}
                      aria-label="Previous song"
                      className="np-press flex h-12 w-12 items-center justify-center text-white"
                    >
                      <Icon d={P.prev} size={32} filled />
                    </button>
                    <MetalPlayButton playing={playing} onClick={togglePlayPause} />
                    <button
                      type="button"
                      onClick={() => step(1)}
                      aria-label="Next song"
                      className="np-press flex h-12 w-12 items-center justify-center text-white"
                    >
                      <Icon d={P.next} size={32} filled />
                    </button>
                  </div>
                </div>

                {/* Volume below the card, directly on the ambient
                    background: low-volume icon, the playful pill
                    slider (tick marks, cover-art avatar over the
                    thumb, level label, blue fill at the top end),
                    high-volume icon. The icons align with the track,
                    below the avatar's float space. */}
                <div className="mx-auto mt-6 flex w-full max-w-[430px] items-start gap-3 px-2 text-white/90">
                  <span className="mt-[42px] flex-none">
                    <Icon d={P.speakerLow} size={19} />
                  </span>
                  <PlayfulVolume value={volume} onChange={applySliderVolume} avatarSrc={smallThumb(current.thumbnail)} />
                  <span className="mt-[41px] flex-none">
                    <Icon d={P.volume} size={20} />
                  </span>
                </div>
              </div>

            {/* Bottom utility row (redesign spec): lyrics toggle
                on the left, the Liquid Glass segmented pill in the
                centre (repeat / loop on the left segment, video
                mode on the right, split by a hairline), queue on
                the right. Shuffle and the sleep timer — features
                this player already had — stay as compact icon
                buttons flanking the pill so nothing is lost. */}
            <div className="mx-auto mt-7 flex w-full max-w-[430px] flex-none items-center justify-between px-1">
              <button
                type="button"
                onClick={() => setShowLyrics(true)}
                aria-label={`Show lyrics for ${current.title}`}
                className="np-press flex h-11 w-11 items-center justify-center text-white/80"
              >
                <Icon d={P.comment} size={21} />
              </button>
              <button
                type="button"
                onClick={toggleShuffle}
                aria-label={shuffle ? "Turn shuffle off" : "Turn shuffle on"}
                aria-pressed={shuffle}
                className={`np-press flex h-11 w-11 items-center justify-center ${shuffle ? "text-white" : "text-white/60"}`}
              >
                <Icon d={P.shuffle} size={20} />
              </button>
              <div className="np-seg-pill flex items-center rounded-full">
                <button
                  type="button"
                  onClick={() => setRepeat((r) => ((r + 1) % 3) as 0 | 1 | 2)}
                  aria-label={repeat === 0 ? "Repeat off — tap to repeat all" : repeat === 1 ? "Repeat all — tap to repeat one" : "Repeat one — tap to turn repeat off"}
                  aria-pressed={repeat !== 0}
                  className={`np-press flex h-11 w-14 items-center justify-center rounded-l-full ${hasOfficialVideo ? "" : "rounded-r-full"} ${repeat !== 0 ? "text-white" : "text-white/60"}`}
                >
                  <Icon d={repeat === 2 ? P.repeatOne : P.repeat} size={20} />
                </button>
                {/* The Video ⇄ Song segment exists ONLY for a
                    verified official music video — no official
                    video, no segment (and no divider), so the
                    pill is just Repeat for songs like Humsafar. */}
                {hasOfficialVideo && (
                  <>
                    <span aria-hidden="true" className="h-6 w-px flex-none bg-white/25" />
                    <button
                      type="button"
                      onClick={() => requestModeSwitch(!showVideo)}
                      aria-label={showVideo ? "Switch to song only — keeps your place in the song" : `Switch to the official video for ${current.title} — keeps your place in the song`}
                      aria-pressed={showVideo}
                      className={`np-press flex h-11 w-[76px] items-center justify-center gap-1.5 rounded-r-full ${showVideo ? "text-white" : "text-white/60"}`}
                    >
                      <Icon d={showVideo ? P.note : P.video} size={18} />
                      <span className="text-[11px] font-semibold">{showVideo ? "Song" : "Video"}</span>
                    </button>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSleepMin(sleepMin === 0 ? 15 : sleepMin === 15 ? 30 : sleepMin === 30 ? 60 : 0)}
                aria-label={sleepMin > 0 ? `Sleep timer set to ${sleepMin} minutes — tap to change` : "Set a sleep timer"}
                aria-pressed={sleepMin > 0}
                className={`np-press relative flex h-11 w-11 items-center justify-center ${sleepMin > 0 ? "text-white" : "text-white/60"}`}
              >
                <Icon d={P.clock} size={20} />
                {sleepMin > 0 && <span className="absolute -top-0.5 -right-1 rounded-full bg-white px-1 text-[9px] font-bold text-black tabular-nums">{sleepMin}m</span>}
              </button>
              <button
                type="button"
                onClick={() => setShowQueue((s) => !s)}
                aria-label={showQueue ? "Hide queue" : "Show queue"}
                aria-pressed={showQueue}
                className={`np-press flex h-11 w-11 items-center justify-center ${showQueue ? "text-white" : "text-white/80"}`}
              >
                <Icon d={P.list} size={21} />
              </button>
            </div>

            {playbackError && (
              <p className="mt-4 flex-none rounded-2xl bg-black/45 px-4 py-3 text-center text-[13px] leading-relaxed text-white/85" role="alert">
                {playbackError}
              </p>
            )}

            {showQueue && (
              <div className="glass rise mt-4 flex-none rounded-[28px] p-2">
                <div className="flex flex-wrap items-center gap-2 px-2 pt-1 pb-2">
                  <p className="text-[11px] tracking-[0.24em] text-white/55 uppercase tabular-nums">
                    Queue{queue.length > 1 ? ` · ${queue.length - qIndex - 1} up next` : ""}
                  </p>
                  <ShinyButton
                    onClick={() => void addMoreSimilarSongs()}
                    disabled={addingSimilar || !current}
                    aria-label="Add more similar songs"
                    aria-busy={addingSimilar}
                    className="px-3 py-1 text-[11px] font-medium whitespace-nowrap disabled:opacity-60"
                  >
                    {addingSimilar ? "Adding similar songs…" : "Add more similar songs"}
                  </ShinyButton>
                  {queue.length > 1 && (
                    <span className="ml-auto flex items-center">
                      {clearArmed ? (
                        <span className="flex items-center gap-2">
                          <span className="text-[11px] text-white/70">Clear everything but the playing song?</span>
                          <button
                            type="button"
                            onClick={clearQueue}
                            className="rounded-full bg-[#f3f3f6] px-3 py-1 text-[11px] font-semibold text-[#232329] transition-transform duration-100 active:scale-[0.97]"
                          >
                            Clear
                          </button>
                          <button
                            type="button"
                            onClick={() => setClearArmed(false)}
                            className="glass-soft rounded-full px-3 py-1 text-[11px] text-white"
                          >
                            Keep
                          </button>
                        </span>
                      ) : (
                        <ShinyButton
                          onClick={() => setClearArmed(true)}
                          aria-label="Clear queue, keeping the song playing now"
                          className="px-3 py-1 text-[11px] whitespace-nowrap"
                        >
                          Clear queue
                        </ShinyButton>
                      )}
                    </span>
                  )}
                </div>
                {addSimilarNote && (
                  <p className="px-3 pb-2 text-[12px] text-[#e9e9ed]" role="status" aria-live="polite">
                    {addSimilarNote}
                  </p>
                )}
                <div ref={queueListRef} className="space-y-0.5">
                  {queue.map((t, i) => (
                    <TrackRow
                      key={qKeys[i] ?? `${t.videoId}-${i}`}
                      track={t}
                      isCurrent={i === qIndex}
                      isPlaying={playing}
                      isLiked={likedSet.has(t.videoId)}
                      list={queue}
                      onPlayTrack={(track) => {
                        const i2 = queue.findIndex((x) => x.videoId === track.videoId);
                        // Tapping the playing song in its own queue
                        // toggles pause; the old handler reloaded it
                        // from 0:00 every time.
                        if (i2 === qIndex) togglePlayPause();
                        else if (i2 >= 0) playAt(queue, i2);
                      }}
                      onToggleLikeTrack={onToggleLike}
                      onPlayNextTrack={onPlayNext}
                      onAddToQueueTrack={onAddToQueue}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----- lyrics sheet ----- */}
      {current && expanded && showLyrics && (
        <LyricsView
          key={current.videoId}
          track={current}
          tint={coverTint}
          currentTime={progress.t}
          duration={progress.d}
          isPlaying={playing}
          loading={lyricsQuery.isPending}
          kind={lyricsQuery.data?.kind ?? null}
          lines={lyricsQuery.data?.lines ?? []}
          loadError={lyricsQuery.data?.error ?? (lyricsQuery.isError ? "Lyrics could not be loaded." : null)}
          onRetry={() => void lyricsQuery.refetch()}
          onClose={() => setShowLyrics(false)}
          onSeek={(sec) => {
            safeSeek(sec);
            if (!playing) {
              try {
                playerRef.current?.playVideo();
                setPlaying(true);
              } catch {
                /* state-change event will settle it */
              }
            }
          }}
          onTogglePlay={togglePlayPause}
          onNext={() => step(1)}
          onPrev={() => step(-1)}
          volume={volume}
          onVolumeChange={applySliderVolume}
          shuffle={shuffle}
          repeat={repeat}
          onToggleShuffle={toggleShuffle}
          onCycleRepeat={() => setRepeat((r) => ((r + 1) % 3) as 0 | 1 | 2)}
          onShowVideo={() => {
            setShowLyrics(false);
            setShowVideo(true);
          }}
          canShowVideo={hasOfficialVideo}
          onRefreshLyrics={refreshLyrics}
          lyricsRefreshing={lyricsRefreshState === "refreshing"}
          lyricsRefreshed={lyricsRefreshState === "done"}
        />
      )}
      {voiceState && (
        <VoiceSearchSheet
          state={voiceState}
          transcript={voiceTranscript}
          onClose={closeVoiceSearch}
          onRetry={startVoiceSearch}
          onTypeInstead={() => {
            closeVoiceSearch();
            window.setTimeout(() => document.getElementById("song-search")?.focus(), 60);
          }}
        />
      )}
      </div>
    </div>
  );
}
