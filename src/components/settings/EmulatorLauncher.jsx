import { useState, useEffect } from 'react'

// Two ways to point a launcher at a game, because ".sh" and "game.sh" are
// different questions. The extension mapping is the broad rule — run every
// shell script through this. The file-name mapping is the exception to it —
// this one particular file needs something else. Before, only the first
// existed, so a title that needed its own wrapper could not be expressed
// without breaking every other game sharing its extension.
const MATCH_TYPES = [
  {
    id: 'extension',
    label: 'File extension',
    hint: 'Applies to every file with this extension.',
    fieldLabel: 'File extension',
    placeholder: 'e.g. sh, exe, py (no dot)',
    example: '.sh',
  },
  {
    id: 'filename',
    label: 'File name',
    hint: 'Applies only to files with this exact name.',
    fieldLabel: 'File name',
    placeholder: 'e.g. game.sh, start.bat',
    example: 'game.sh',
  },
]

const matchTypeMeta = (id) => MATCH_TYPES.find((type) => type.id === id) || MATCH_TYPES[0]

// Mirrors the normalisation in electron/db/settings.js so the row a user just
// added is labelled the same way the launcher will look it up. The stored value
// is authoritative — the list is re-read after every write rather than patched
// locally — but a mapping key is not obvious enough to leave unlabelled.
const describeKey = (emulator) =>
  emulator.match_type === 'filename' ? emulator.extension : `.${emulator.extension}`

const emulatorRowKey = (emulator) =>
  `${emulator.match_type || 'extension'}:${emulator.extension}`

const EmulatorLauncher = () => {
  const [emulators, setEmulators] = useState([]);
  const [matchType, setMatchType] = useState("extension");
  const [matchValue, setMatchValue] = useState("");
  const [programPath, setProgramPath] = useState("");
  const [parameters, setParameters] = useState("");

  // Re-read rather than patch local state. The main process normalises the key
  // (lowercases it, strips a leading dot, reduces a pasted path to its base
  // name), so anything reconstructed here would drift from what actually got
  // stored — and a mapping that looks different from the one being matched
  // against is exactly the confusion this settings page has to avoid.
  const reload = async () => {
    try {
      setEmulators(await window.electronAPI.getEmulatorConfig());
    } catch (err) {
      console.error("Error loading emulator config:", err);
    }
  };

  // Load existing emulator configurations from database
  useEffect(() => {
    reload();
  }, []);

  // Handle adding a new emulator configuration
  const handleAddEmulator = async (e) => {
    e.preventDefault();
    const meta = matchTypeMeta(matchType);
    if (!matchValue.trim() || !programPath) {
      alert(`Please provide both a ${meta.fieldLabel.toLowerCase()} and a program path.`);
      return;
    }

    try {
      await window.electronAPI.saveEmulatorConfig({
        extension: matchValue,
        match_type: matchType,
        program_path: programPath,
        parameters,
      });
      await reload();
      setMatchValue("");
      setProgramPath("");
      setParameters("");
    } catch (err) {
      console.error("Error saving emulator config:", err);
      alert("Failed to save emulator configuration.");
    }
  };

  // Handle selecting a program file
  const handleSelectProgram = async () => {
    try {
      const filePath = await window.electronAPI.selectFile();
      if (filePath) {
        setProgramPath(filePath);
      }
    } catch (err) {
      console.error("Error selecting program:", err);
    }
  };

  // Browsing to the game's launcher is easier than remembering how it is spelt,
  // and only the base name is kept: a mapping tied to one install path would
  // stop working the moment the game moved.
  const handleSelectMatchFile = async () => {
    try {
      const filePath = await window.electronAPI.selectFile();
      if (filePath) {
        setMatchValue(String(filePath).split(/[\\/]/).pop() || "");
      }
    } catch (err) {
      console.error("Error selecting file:", err);
    }
  };

  // Handle removing an emulator configuration
  const handleRemoveEmulator = async (emulator) => {
    try {
      await window.electronAPI.removeEmulatorConfig(
        emulator.extension,
        emulator.match_type || "extension",
      );
      await reload();
    } catch (err) {
      console.error("Error removing emulator config:", err);
      alert("Failed to remove emulator configuration.");
    }
  };

  const meta = matchTypeMeta(matchType);

  return (
    <div className="p-5 text-text">
      <h2 className="text-xl font-bold mb-4 text-aliceblue">
        Emulator/Launcher Settings
      </h2>
      <form onSubmit={handleAddEmulator} className="mb-6">
        <div className="flex flex-col space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              Match by
            </label>
            {/* Radios rather than a select: there are exactly two and the
                difference between them is the whole point of this control, so
                both labels stay on screen. Wraps on a narrow window. */}
            <div className="flex flex-col sm:flex-row gap-2">
              {MATCH_TYPES.map((type) => (
                <label
                  key={type.id}
                  className={`flex-1 flex items-start gap-2 p-2 rounded border cursor-pointer ${
                    matchType === type.id
                      ? "border-accent bg-primary"
                      : "border-border bg-primary hover:border-accent"
                  }`}
                >
                  <input
                    type="radio"
                    name="emulator-match-type"
                    value={type.id}
                    checked={matchType === type.id}
                    onChange={() => setMatchType(type.id)}
                    className="mt-1 accent-accent"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-text">{type.label}</span>
                    <span className="block text-xs text-text opacity-70">
                      {type.hint} ({type.example})
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              {meta.fieldLabel}
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={matchValue}
                onChange={(e) => setMatchValue(e.target.value)}
                placeholder={meta.placeholder}
                className="w-full p-2 bg-primary border border-border text-text rounded focus:outline-none focus:ring-2 focus:ring-accent"
              />
              {matchType === "filename" && (
                <button
                  type="button"
                  onClick={handleSelectMatchFile}
                  className="p-2 bg-accent text-text rounded hover:bg-accentHover whitespace-nowrap"
                >
                  Pick file
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              Program Path
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={programPath}
                readOnly
                placeholder="Select a program"
                className="w-full p-2 bg-primary border border-border text-text rounded focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSelectProgram}
                className="p-2 bg-accent text-text rounded hover:bg-accentHover whitespace-nowrap"
              >
                Browse
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              Parameters (optional)
            </label>
            <input
              type="text"
              value={parameters}
              onChange={(e) => setParameters(e.target.value)}
              placeholder="Enter parameters (e.g., --fullscreen)"
              className="w-full p-2 bg-primary border border-border text-text rounded focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <button
            type="submit"
            className="p-2 bg-accent text-text rounded hover:bg-accentHover"
          >
            Add Emulator/Launcher
          </button>
        </div>
      </form>
      <h3 className="text-lg font-semibold mb-2 text-text">
        Configured Emulators/Launchers
      </h3>
      {emulators.length === 0 ? (
        <p className="text-text">No emulators or launchers configured.</p>
      ) : (
        <ul className="space-y-2">
          {emulators.map((emu) => (
            <li
              key={emulatorRowKey(emu)}
              className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 p-2 bg-primary border border-border rounded"
            >
              <div className="min-w-0 break-words">
                <span className="font-medium">{describeKey(emu)}</span>
                <span className="ml-2 text-[11px] uppercase tracking-wide border border-border rounded px-1 py-0.5">
                  {matchTypeMeta(emu.match_type).label}
                </span>
                <span>: {emu.program_path}</span>
                {emu.parameters && <span> (Parameters: {emu.parameters})</span>}
              </div>
              <button
                onClick={() => handleRemoveEmulator(emu)}
                className="p-1 bg-danger text-text rounded hover:bg-dangerHover shrink-0 self-start sm:self-auto"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default EmulatorLauncher
