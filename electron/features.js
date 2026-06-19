'use strict'

// Browse Mode is gated per-install behind the user's NSFW opt-in (see
// electron/ipc/settings.js's get-nsfw-status/set-nsfw-enabled, and
// App.jsx's browseAvailable = BROWSE_MODE_ENABLED && nsfwEnabled). This
// flag now just controls whether the feature exists in the build at all.
const BROWSE_MODE_ENABLED = true

module.exports = { BROWSE_MODE_ENABLED }
