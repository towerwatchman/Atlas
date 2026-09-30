import { useState } from 'react'
import GogIcon from '../ui/GogIcon.jsx'

// External links for the details page, with DLC folded under the game they
// belong to and COLLAPSED by default.
//
// The server lets an admin mark a store link as a game or a DLC and tie a DLC
// to its base game (atlas_manual_links.entry_type / parent_*). Before that
// reached the client, a game with several Steam appids listed them as a flat
// run of identical-looking "Steam" rows with no indication that most were
// add-ons -- one title with a dozen season passes buried its own store page.
//
// A DLC whose parent is not in this list -- parented to an F95/LewdCorner
// mapping, to a link since removed, or never parented -- stays a top-level row.
// Hiding it would lose a real store page, and an admin who typed it as DLC
// still told us something worth showing, so it keeps its badge.

const iconFor = (link) => (link.iconImage
  ? <GogIcon size={16} style={{ width: 18, color: 'var(--color-muted)' }} />
  : <i className={link.icon} style={{ width: 18, textAlign: 'center', color: 'var(--color-muted)' }} aria-hidden="true"></i>)

// key/value collide across rows -- several Steam appids all carry the key
// "steam_appid" -- so the value is part of the React key. With only one appid
// per game this never showed; it does now that DLC are listed.
const rowKey = (link) => `${link.key}:${link.value}`

const openUrl = (url) => (event) => {
  event.preventDefault()
  window.electronAPI?.openExternalUrl?.(url)
}

const LinkRow = ({ link, indented = false }) => (
  <div
    data-testid={indented ? 'dlc-link-row' : 'link-row'}
    style={{
      display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
      paddingLeft: indented ? 28 : 0,
    }}
  >
    {iconFor(link)}
    <span style={{ color: 'var(--color-muted)', minWidth: 92 }}>{link.label}</span>
    {link.url ? (
      <a
        href={link.url}
        onClick={openUrl(link.url)}
        className="text-accent hover:underline"
        style={{ cursor: 'pointer', wordBreak: 'break-all' }}
      >
        {link.value}
      </a>
    ) : (
      <span style={{ wordBreak: 'break-all' }}>{link.value}</span>
    )}
    {/* Only shown for a DLC that could not be nested; a nested one is already
        under its parent and the indent says so. */}
    {link.isDlc && !indented ? (
      <span
        style={{
          fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
          color: 'var(--color-muted)', border: '1px solid var(--color-border)',
          borderRadius: 3, padding: '0 4px',
        }}
      >
        DLC
      </span>
    ) : null}
  </div>
)

const LinkGroup = ({ group }) => {
  // Collapsed on every mount, deliberately: the base game is the thing being
  // looked at, and a game with a dozen add-ons would otherwise push its own
  // metadata off the screen. Local state, so expanding one group does not
  // expand the others and nothing persists between visits.
  const [expanded, setExpanded] = useState(false)
  const count = group.dlc.length
  if (count === 0) return <LinkRow link={group} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <LinkRow link={group} />
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="hover:underline"
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 12, color: 'var(--color-muted)',
          }}
        >
          <i
            className={expanded ? 'fas fa-chevron-down' : 'fas fa-chevron-right'}
            style={{ marginRight: 5 }}
            aria-hidden="true"
          ></i>
          {count} DLC
        </button>
      </div>
      {expanded ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {group.dlc.map((child) => <LinkRow key={rowKey(child)} link={child} indented />)}
        </div>
      ) : null}
    </div>
  )
}

const ExternalLinksSection = ({ groups = [] }) => {
  if (groups.length === 0) return null
  return (
    <section className="bg-secondary border border-border p-2">
      <h2 className="text-lg font-semibold mb-3">External Links</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {groups.map((group) => <LinkGroup key={rowKey(group)} group={group} />)}
      </div>
    </section>
  )
}

export default ExternalLinksSection
