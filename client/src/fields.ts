// Static form-field props (standalone port).
//
// In the Muse original these came from the `actionFields` macro
// (the space SDK's fields module), which generated `{ name, minLength,
// maxLength, required }` props from each action's zod request schema.
// The macro is gone, so the fields App.tsx actually spreads are listed
// here verbatim — same names, same validation caps — and spread onto
// the same inputs. Keep these in sync with the server's request
// validation if the caps ever change.
export const FIELDS = {
  submitFeedback: {
    message: { name: "message", minLength: 1, maxLength: 2000, required: true },
  },
  createPlaylist: {
    name: { name: "name", minLength: 1, maxLength: 120, required: true },
  },
  previewPlaylistImport: {
    url: { name: "url", minLength: 8, maxLength: 2000, required: true },
  },
  importPlaylist: {
    name: { name: "name", maxLength: 120 },
  },
  searchMusic: {
    query: { name: "query", minLength: 1, maxLength: 120, required: true },
  },
} as const;
