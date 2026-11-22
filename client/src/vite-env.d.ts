/// <reference types="vite/client" />
// Vite `?raw` text imports (the shader documents in src/shaders are
// imported as raw strings). Asset types (*.css, *.webp, *.txt) are
// declared in ./globals.d.ts, copied from the Muse original.
declare module "*?raw" {
  const content: string;
  export default content;
}
