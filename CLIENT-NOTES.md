# Frostora client port — notes (22 Nov 2026)

Standalone Vite + React client ported from the Muse fullstack artifact
`liquid-metal-music` (v52). Source (read-only, never edited):
`~/workspace/ts-spaces/liquid-metal-music/client/`. Output:
`~/workspace/frostora-github/client/`. No redesign, retheme or behaviour
change: App.tsx (8,326 lines), theme.css (1,497 lines) and all components
are verbatim except the SDK replacements listed below. Theme stays
frosted white/grey, no gold.

## Files copied (verbatim)

- `src/App.tsx` (8,326 lines — see "Changed" for the 3 allowed edits)
- `src/theme.css` (1,497 lines), `src/globals.d.ts`, `src/lib/utils.ts`
- `src/components/**` — `demo.tsx`, `liquid-glass-hero-demo.tsx`,
  `text-generate-effect-demo.tsx`, `ui/liquid-glass.tsx`,
  `ui/shiny-button.tsx`, `ui/text-generate-effect.tsx`
- `src/shaders/**` — `liquid-metal-button/` (component + `.html`),
  `neuform-isolated/` (component, nebula `.html`, vendored three/gsap/
  ScrollTrigger `.txt`), `threeui.css` (vendored, not imported by the
  app bundle — same as the original)
- `src/threeui/index.tsx`
- `src/assets/frostora-icon.webp` (crystal icon)
- NOT copied: `client/dist/`, `client/dist-cvm/`, `client/build.mjs`
  (SDK build script), `.tsbuildinfo.client`, `app.db`, `blobs/`.

## Files changed / new

| File | Change |
| --- | --- |
| `src/api.ts` | Rewritten: fetch client (see below). |
| `src/main.tsx` | Fresh `new QueryClient()`; root falls back to `#root`. |
| `src/App.tsx` | Only the 3 briefed edits (see below). |
| `src/fields.ts` | NEW: static `FIELDS` (replaces `actionFields` macro). |
| `src/actions.ts` | NEW: typed mirror of the 29 server actions (see "Typing"). |
| `src/vite-env.d.ts` | NEW: `*?raw` module declaration for the shader text imports. |
| `index.html` | Vite entry: `<div id="root">` + `/src/main.tsx`, title Frostora, viewport meta, `data:,` favicon link (main.tsx points it at the bundled icon). |
| `vite.config.ts` | NEW: react plugin, Tailwind 4 via `@tailwindcss/vite`, dev proxy `/api` → `http://localhost:3000`, `build.outDir: "dist"`. |
| `tsconfig.json` | NEW standalone config mirroring the original base (`strict`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `moduleResolution: bundler`, `jsx: react-jsx`, `target/lib: ES2022/DOM`). No `extends` (the Muse base file is not part of the port). |
| `package.json` | NEW: scripts `dev` / `build` (`tsc -b && vite build`) / `preview` / `typecheck`. No `@hatch/space-sdk` anywhere. |

## Exact SDK replacements

1. **`src/api.ts`** — `createActionClient` removed. `api` is a `Proxy`
   that POSTs `{ action, args, deviceId }` as JSON to `/api/actions`
   and returns the parsed response JSON; throws on non-OK HTTP status
   or on a `{ error }` payload. Device ID: `crypto.randomUUID()`
   (with a `Math.random` fallback), generated once, persisted in
   `localStorage` under `frostora-device-id`, sent with every call.
   Same `api.<actionName>(args)` shape for all 29 actions.
   `ApiResponse<C, K>` / `ApiRequest<C, K>` are defined locally
   (conditional-type form, matching the SDK's definitions).
2. **`src/main.tsx`** — `spaceQueryClient` replaced with a fresh
   `new QueryClient()` from `@tanstack/react-query`. StrictMode,
   favicon logic and the `hatch-space-root` class + `data-hatch-space-root`
   attribute kept (CSS hooks only now). Root: `[data-generated-space-root]`
   with fallback to `#root`.
3. **`src/App.tsx`** — (a) `SafeAreaTopScrim` import deleted; usage
   replaced with `<div aria-hidden="true" style={{ height:
   "env(safe-area-inset-top)", background: "var(--bg)" }} />`;
   (b) `actionFields` macro import and
   `const FIELDS = actionFields<typeof Actions>();` deleted; `FIELDS`
   imported from `./fields.ts` (static props: submitFeedback.message
   1–2000 required; createPlaylist.name 1–120 required;
   previewPlaylistImport.url 8–2000 required; importPlaylist.name
   max 120; searchMusic.query 1–120 required); (c) `import type
   { Actions } from "../../server/src/actions"` deleted — the ported
   server file (see "Typing" below); `Track` and
   the other `ApiResponse<typeof api, …>` aliases are unchanged;
   (d) all `queryClient.invalidateQueries(...)` calls unchanged (plain
   React Query now).
4. **Bun text imports → Vite `?raw`** (required for the Vite build;
   not in the brief but unavoidable — the Muse build used Bun-only
   `with { type: "text" }` imports): `src/shaders/liquid-metal-button/
   LiquidMetalButton.tsx` (`liquid-metal-button.html?raw`) and
   `src/shaders/neuform-isolated/NeuformCraftEffects.tsx`
   (`julian-vance-nebula.html?raw`, `three.min.js.txt?raw`,
   `gsap.min.js.txt?raw`, `ScrollTrigger.min.js.txt?raw`). Header
   comments updated to say so; no rendering/shader logic touched.
   Typed via the new `src/vite-env.d.ts` (`*?raw` → string).

## Typing — read this before touching `api.ts`

The brief's fallback (`api` as `Record<string, (args: any) =>
Promise<any>>`) was tried first and **failed typecheck with 67
errors**: under `noUncheckedIndexedAccess` every `api.<action>` is
possibly-undefined, and `any` responses drop all contextual types in
App.tsx (implicit-`any` callback params, plus a `mvRef.current`
narrowing error). So instead, `api` is typed from the local mirror
`src/actions.ts`: the 29 actions as a map of action name → handler
function, with request/response interfaces transcribed field-for-field
from the original server's zod schemas (`server/src/actions.ts`:
`trackSchema`, `libraryResponse`, `searchResponse`, `likedResponse`,
`toggleResponse`, `officialVideoResponse`, `lyricsResponse`,
`cardSchema`, `homeFeedResponse`, `collectionResponse`,
`popularResponse`, `feedbackResponse`, `similarQueueResponse`,
`moreSimilarResponse`, `playlistImportPreviewResponse`,
`userPlaylistCardSchema`, `listUserPlaylistsResponse`,
`importPlaylistResponse`, plus the inline `request:`/`response:`
objects of each `defineAction`). Nothing invented.

**Restore path — tried 22 Nov 2026, REJECTED for now:** the server
port has since landed (`~/workspace/frostora-github/server/src/
actions.ts`, `export type Actions` at line 4052), so a direct
`import type { Actions } from "../../server/src/actions"` was tried.
It does NOT typecheck against the ported server file, for two reasons:
(1) the server's `Actions` type maps to the raw handlers, which are
`(args, ctx)` (2 arguments) — every `api.<action>(args)` call in
App.tsx then errors TS2554 (109 errors total); a mapped type stripping
the `ctx` parameter fixed the call shape but (2) importing the server
file pulls its whole dependency graph (zod, drizzle-orm, @types/node)
into the client's typecheck, and those modules do not resolve from the
client directory, so the server file itself reports errors under the
client config (80 errors total, incl. TS2307 for zod/drizzle-orm).
Per the brief ("keep it ONLY if it typechecks, otherwise delete it"),
the import was deleted and the local mirror kept. To restore the
direct import later, the server needs a client-facing 1-argument
`Actions` type (or a shared types package) AND the client needs the
server's modules resolvable from its directory — then delete
`src/actions.ts` and swap the import in `src/api.ts`. App.tsx needs
no change either way. The local mirror must not be kept alongside a
restored import — two Actions types will drift.

## Dependencies (versions copied from the original `package.json` where they exist)

- deps: `react` 19.2.5, `react-dom` 19.2.5,
  `@tanstack/react-query` 5.100.10, `motion` ^14.14.0, `clsx` ^2.1.1,
  `tailwind-merge` ^3.7.1, `@tabler/icons-react` ^3.52.0,
  `recharts` 2.15.3, `zod` 4.4.3
  (`recharts`/`zod` are not imported by the client source today;
  kept because the brief lists them — `recharts` install warns it is
  deprecated in favour of v3, see build log).
- devDeps: `tailwindcss` 4.1.13, `@tailwindcss/vite` ^4.1.13,
  `tailwindcss-safe-area` 1.3.0 (imported by `theme.css`),
  `@vitejs/plugin-react` ^5.0.0, `vite` ^7.1.0, `typescript` 5.6.3,
  `@types/react` 19.2.14, `@types/react-dom` 19.2.3.
- `npm install` completed with network access: 135 packages, no errors.

## Build result — PASS

`npm run build` (`tsc -b && vite build`) in
`~/workspace/frostora-github/client/`, exit 0, 22 Nov 2026.
`npx tsc --noEmit`: 0 errors. (The original source was verified to
typecheck clean too, so the port introduces no new type errors.)

Log excerpt:

```text
vite v7.3.8 building client environment for production...
transforming...
✓ 7070 modules transformed.
rendering chunks...
dist/index.html                            0.67 kB │ gzip:   0.39 kB
dist/assets/frostora-icon-CnlRBxGW.webp  149.77 kB
dist/assets/index-DrEhoZ0c.css            88.28 kB │ gzip:  16.21 kB
dist/assets/index-D40BUmTc.js            646.62 kB │ gzip: 198.19 kB
✓ built in 13.27s
```

One non-fatal warning: single JS chunk > 500 kB after minification
(code-split suggestion). Same single-bundle shape as the Muse build;
left as-is per the no-redesign rule.

Smoke test: `vite preview` served `dist/index.html` (HTTP 200,
`<div id="root">`, asset refs) and the JS asset (HTTP 200).

## Verification greps

- `grep -rn "@hatch" src index.html vite.config.ts tsconfig.json package.json` → **0 hits**
- `grep -rl "@hatch|space-sdk" dist/` → **0 hits**
- Built JS contains `/api/actions` and `frostora-device-id` (1 hit each).
- No secret in the client bundle: the Web3Forms access key is
  server-only and does not appear in `dist/` (0 hits).
- No `app.db` / `blobs/` copied.
- `dist/` and `node_modules/` exist locally from the verification
  build/install; the scaffold `.gitignore` should exclude them
  (integrator to confirm — not touched by this port).

## Unverified / open issues

- **No API server yet.** `POST /api/actions` has nothing to answer
  (server port in parallel; dev proxy points at `http://localhost:3000`).
  Home feed, search, library, likes, lyrics, playlist import, player
  data and Feedback all depend on it — none exercised here.
- **YouTube playback cannot be exercised here** (no server, no
  browser playback in this environment). The YouTube IFrame plumbing
  in App.tsx is verbatim, but first real playback must be confirmed
  on Naman's phone against the deployed server.
- **Auth / multi-user:** unchanged from the original — no auth; once
  deployed publicly, anyone with the URL shares one library unless
  the server adds per-device scoping (the client already sends
  `deviceId` with every call for exactly that).
- **Typed `Actions` import not restored** — direct import from the
  ported server file was tried and rejected (server handlers are
  2-arg `(args, ctx)`; server deps don't resolve from the client
  dir) — see "Typing" above; the `src/actions.ts` mirror is the
  current typing source.
- `theme.css` still `@import`s Google Fonts (Marcellus, Inter) from
  fonts.googleapis.com at runtime — same as the original; needs
  network at first load, unchanged behaviour.
- Demo components (`liquid-glass-hero-demo`, `text-generate-effect-demo`,
  `demo`) are copied and bundled as in the original, even though the
  Settings entry that opened them was removed earlier.
