export default function SourceStep({ onSelect }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col space-y-4 max-w-md w-full">
        <h2 className="text-xl text-center">Select Import Source</h2>
        <button
          onClick={() => onSelect('settings')}
          className="bg-secondary hover:bg-selected text-text p-2 rounded"
        >
          Atlas Game Importer
        </button>
      </div>
    </div>
  )
}
