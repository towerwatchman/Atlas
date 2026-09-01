// The project's outbound URLs, in one place.
//
// These live in utils rather than beside the About modal that renders them.
// The modal is one consumer; releaseUrl.js is another, and a util importing a
// React component to reach a string would drag the component and its whole
// import tree into everything downstream. Components depend on utils, not the
// other way round.
export const LINKS = {
  steamCurator:
    'https://store.steampowered.com/curator/44473903-Atlas-Game-Manager/',
  github: 'https://github.com/towerwatchman/Atlas',
  discord: 'https://discord.gg/3rQhnq65U',
  // Stub: the GitHub wiki hasn't been created yet. Kept here as the single
  // place to update once the real help/docs destination exists.
  helpWiki: 'https://github.com/towerwatchman/Atlas/wiki',
  issues: 'https://github.com/towerwatchman/Atlas/issues',
}

export default LINKS
