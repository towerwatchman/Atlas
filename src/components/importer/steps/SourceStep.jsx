import atlasLogo from '../../../assets/icons/atlas_logo.svg'
import GogIcon from '../../ui/GogIcon.jsx'

export default function SourceStep({ onSelect, onStartSteam, onStartGog, onStartRenpy, onStartManualAdd }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col space-y-4 max-w-md w-full">
        <h2 className="text-xl text-center">Select Import Source</h2>
        <button
          onClick={() => onSelect('settings')}
          className="bg-secondary hover:bg-selected text-text p-2 rounded-buttonTheme flex items-center justify-center gap-2"
        >
          <img src={atlasLogo} alt="" className="h-5 w-5 object-contain" />
          Atlas Game Importer
        </button>
        <button
          onClick={() => onStartSteam?.()}
          className="bg-secondary hover:bg-selected text-text p-2 rounded-buttonTheme flex items-center justify-center gap-2"
        >
          <i className="fab fa-steam"></i>
          Steam Library
        </button>
        <button
          onClick={() => onStartGog?.()}
          className="bg-secondary hover:bg-selected text-text p-2 rounded-buttonTheme flex items-center justify-center gap-2"
        >
          <GogIcon size={18} />
          GOG Library
        </button>
        {/* Escape hatch for games no automatic path can reach: Steam omits free
            titles from its owned-games list, and the disk scan only sees games
            that are installed. */}
        <button
          onClick={() => onStartManualAdd?.()}
          className="bg-secondary hover:bg-selected text-text p-2 rounded-buttonTheme flex items-center justify-center gap-2"
        >
          <i className="fas fa-plus"></i>
          Add Game Manually
        </button>
        <button
          onClick={() => onStartRenpy?.()}
          className="bg-secondary hover:bg-selected text-text p-2 rounded-buttonTheme flex items-center justify-center gap-2"
        >
          <i className="fas fa-save"></i>
          Ren'Py Save Importer
        </button>
      </div>
    </div>
  )
}
