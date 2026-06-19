// Browse Mode is gated per-install behind the user's NSFW opt-in (see
// electron/ipc/settings.js's get-nsfw-status/set-nsfw-enabled, and
// App.jsx's browseAvailable = BROWSE_MODE_ENABLED && nsfwEnabled). This
// flag now just controls whether the feature exists in the build at all.
export const BROWSE_MODE_ENABLED = true
