import f95Logo from '../../../assets/images/f95_full.png'
import atlasLogo from '../../../assets/images/atlas_logo.svg'
import { parseExternalIds, buildExternalLinks } from '../externalLinks.js'

export default function MappingsTab({ game, showModal, searchResults, onFindGame, onSelectGame, onCloseModal }) {
  const externalIds = parseExternalIds(game.external_ids)
  const steamAppId = game.steam_id || game.steam_appid || externalIds.steam_appid || externalIds.steam_id || null

  // Steam is the only external source that carries a real id, so it is shown in
  // the mappings table alongside Atlas/F95. Everything else in external_ids is a
  // plain link (patreon, twitter, itch, …).
  const otherLinks = buildExternalLinks(externalIds).filter(
    (link) => link.key.toLowerCase() !== 'steam_appid' && link.key.toLowerCase() !== 'steam_id',
  )

  const hasAnyMapping = game.f95_id || game.atlas_id || steamAppId

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">
          <button onClick={onFindGame} className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded">
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
            {game.f95_id && (
              <tr className="border-b border-border">
                <td className="p-2"><img src={f95Logo} alt="F95Zone Logo" className="h-10 w-20 object-contain" /></td>
                <td className="p-2">F95Zone</td>
                <td className="p-2">{game.f95_id}</td>
              </tr>
            )}
            {game.atlas_id && (
              <tr className="border-b border-border">
                <td className="p-2"><img src={atlasLogo} alt="Atlas Logo" className="h-10 w-20 object-contain" /></td>
                <td className="p-2">Atlas</td>
                <td className="p-2">{game.atlas_id}</td>
              </tr>
            )}
            {steamAppId && (
              <tr className="border-b border-border">
                <td className="p-2">
                  <i className="fab fa-steam" style={{ fontSize: 28 }} aria-hidden="true"></i>
                </td>
                <td className="p-2">Steam</td>
                <td className="p-2">{steamAppId}</td>
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
                    className="p-2 bg-tertiary hover:bg-button_hover rounded cursor-pointer"
                    onClick={() => onSelectGame(result.atlas_id)}
                  >
                    <div>{result.title}</div>
                    <div className="text-sm text-gray-400">
                      Atlas ID: {result.atlas_id} | F95 ID: {result.f95_id || 'N/A'} | Creator: {result.creator || 'N/A'}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No matches found</p>
            )}
            <div className="flex justify-end space-x-2 mt-4">
              <button onClick={onCloseModal} className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
