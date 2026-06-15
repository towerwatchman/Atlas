import f95Logo from '../../../assets/images/f95_full.png'
import atlasLogo from '../../../assets/images/atlas_logo.svg'

export default function MappingsTab({ game, showModal, searchResults, onFindGame, onSelectGame, onCloseModal }) {
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
            {!game.f95_id && !game.atlas_id && (
              <tr><td colSpan="3" className="p-2 text-center">No mappings available</td></tr>
            )}
          </tbody>
        </table>
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
