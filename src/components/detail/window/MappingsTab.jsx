import f95Logo from '../../../assets/images/f95_full.png'
import atlasLogo from '../../../assets/images/atlas_logo.svg'
import { parseExternalIds, buildExternalLinks } from '../externalLinks.js'
import { getMappedSteamAppId } from '../page/gameDetailUtils.js'

const normalizeF95DisplayId = (value) => {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  if (/^\d+$/.test(normalized)) return normalized

  const threadMatch = normalized.match(/\/threads\/(?:[^/\s.]+\.)?(\d+)(?:[/?#]|$)/i)
  return threadMatch ? threadMatch[1] : normalized
}

export default function MappingsTab({ game, showModal, searchResults, onFindGame, onSelectGame, onCloseModal }) {
  const externalIds = parseExternalIds(game.external_ids)
  const steamAppId = getMappedSteamAppId(game)
  const f95DisplayId = normalizeF95DisplayId(game.f95_id)
  const lewdCornerId = game.lc_id || game.lcId || game.lewdCornerId || externalIds.lc_id || externalIds.lewdcorner_id || null
  const iconCellClass = 'p-2 w-24 align-middle'
  const iconFrameClass = 'flex h-10 w-20 items-center justify-center'

  // Steam is the only external source that carries a real id, so it is shown in
  // the mappings table alongside Atlas/F95. Everything else in external_ids is a
  // plain link (patreon, twitter, itch, …).
  const otherLinks = buildExternalLinks(externalIds).filter(
    (link) => !['steam_appid', 'steam_id', 'lc_id', 'lewdcorner_id'].includes(link.key.toLowerCase()),
  )

  const hasAnyMapping = f95DisplayId || game.atlas_id || steamAppId || lewdCornerId

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">
          <button onClick={onFindGame} className="px-4 py-1 bg-tertiary hover:bg-buttonHover rounded">
            Add Mapping
          </button>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-primary">
              <th className="p-2 text-left"></th>
              <th className="p-2 text-left">Mapper</th>
              <th className="p-2 text-left">ID</th>
            </tr>
          </thead>
          <tbody>
            {f95DisplayId && (
              <tr className="border-b border-border">
                <td className={iconCellClass}>
                  <div className={iconFrameClass}>
                    <img src={f95Logo} alt="F95Zone Logo" className="block h-10 w-20 object-contain" />
                  </div>
                </td>
                <td className="p-2">F95Zone</td>
                <td className="p-2">{f95DisplayId}</td>
              </tr>
            )}
            {game.atlas_id && (
              <tr className="border-b border-border">
                <td className={iconCellClass}>
                  <div className={iconFrameClass}>
                    <img src={atlasLogo} alt="Atlas Logo" className="block h-10 w-20 object-contain" />
                  </div>
                </td>
                <td className="p-2">Atlas</td>
                <td className="p-2">{game.atlas_id}</td>
              </tr>
            )}
            {steamAppId && (
              <tr className="border-b border-border">
                <td className={iconCellClass}>
                  <div className={iconFrameClass}>
                    <i className="fab fa-steam block text-[28px] leading-none" aria-hidden="true"></i>
                  </div>
                </td>
                <td className="p-2">Steam</td>
                <td className="p-2">{steamAppId}</td>
              </tr>
            )}
            {lewdCornerId && (
              <tr className="border-b border-border">
                <td className={iconCellClass}>
                  <div className={iconFrameClass}>
                    <i className="fas fa-link block text-[24px] leading-none" aria-hidden="true"></i>
                  </div>
                </td>
                <td className="p-2">LewdCorner</td>
                <td className="p-2">{lewdCornerId}</td>
              </tr>
            )}
            {!hasAnyMapping && (
              <tr><td colSpan="3" className="p-2 text-center">No mappings available</td></tr>
            )}
          </tbody>
        </table>

        {otherLinks.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2 opacity-80">External Links</h3>
            <table className="w-full border-collapse">
              <tbody>
                {otherLinks.map((link) => (
                  <tr key={link.key} className="border-b border-border">
                    <td className="p-2 w-10 text-center">
                      <i className={link.icon} aria-hidden="true"></i>
                    </td>
                    <td className="p-2">{link.label}</td>
                    <td className="p-2">
                      {link.url ? (
                        <a
                          href={link.url}
                          onClick={(e) => {
                            e.preventDefault()
                            window.electronAPI.openExternalUrl(link.url)
                          }}
                          className="text-accent hover:underline cursor-pointer break-all"
                        >
                          {link.value}
                        </a>
                      ) : (
                        <span className="break-all">{link.value}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-secondary p-4 rounded-md max-w-lg w-full">
            <h2 className="text-lg mb-4">Select Game Match</h2>
            {searchResults.length > 0 ? (
              <ul className="space-y-2 max-h-[300px] overflow-y-auto">
                {searchResults.map((result, index) => (
                  <li
                    key={index}
                    className="p-2 bg-tertiary hover:bg-buttonHover rounded cursor-pointer"
                    onClick={() => onSelectGame(result.atlas_id)}
                  >
                    <div>{result.title}</div>
                    <div className="text-sm text-muted">
                      Atlas ID: {result.atlas_id} | F95 ID: {normalizeF95DisplayId(result.f95_id) || 'N/A'} | Creator: {result.creator || 'N/A'}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No matches found</p>
            )}
            <div className="flex justify-end space-x-2 mt-4">
              <button onClick={onCloseModal} className="px-4 py-1 bg-tertiary hover:bg-buttonHover rounded">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
