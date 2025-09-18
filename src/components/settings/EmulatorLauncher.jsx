const { useState, useEffect } = window.React;

const EmulatorLauncher = () => {
  const [emulators, setEmulators] = useState([]);
  const [extension, setExtension] = useState('');
  const [programPath, setProgramPath] = useState('');
  const [parameters, setParameters] = useState('');

  // Load existing emulator configurations from database
  useEffect(() => {
    window.electronAPI.getEmulatorConfig().then((emulators) => {
      setEmulators(emulators);
    }).catch((err) => {
      console.error('Error loading emulator config:', err);
    });
  }, []);

  // Handle adding a new emulator configuration
  const handleAddEmulator = async (e) => {
    e.preventDefault();
    if (!extension || !programPath) {
      alert('Please provide both an extension and a program path.');
      return;
    }

    const newEmulator = { extension: extension.toLowerCase(), program_path: programPath, parameters };
    const updatedEmulators = [...emulators.filter(emu => emu.extension !== newEmulator.extension), newEmulator];
    setEmulators(updatedEmulators);

    // Save to database
    try {
      await window.electronAPI.saveEmulatorConfig(newEmulator);
      setExtension('');
      setProgramPath('');
      setParameters('');
    } catch (err) {
      console.error('Error saving emulator config:', err);
      alert('Failed to save emulator configuration.');
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
      console.error('Error selecting program:', err);
    }
  };

  // Handle removing an emulator configuration
  const handleRemoveEmulator = async (ext) => {
    const updatedEmulators = emulators.filter((emu) => emu.extension !== ext);
    setEmulators(updatedEmulators);

    try {
      await window.electronAPI.removeEmulatorConfig(ext);
    } catch (err) {
      console.error('Error removing emulator config:', err);
      alert('Failed to remove emulator configuration.');
    }
  };

  return (
    <div className="p-5 text-text">
      <h2 className="text-xl font-bold mb-4 text-aliceblue">Emulator/Launcher Settings</h2>
      <form onSubmit={handleAddEmulator} className="mb-6">
        <div className="flex flex-col space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">File Extension (e.g., exe, py)</label>
            <input
              type="text"
              value={extension}
              onChange={(e) => setExtension(e.target.value.toLowerCase())}
              placeholder="Enter file extension without dot"
              className="w-full p-2 bg-primary border border-border text-text rounded focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Program Path</label>
            <div className="flex space-x-2">
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
                className="p-2 bg-accent text-text rounded hover:bg-highlight"
              >
                Browse
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Parameters (optional)</label>
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
            className="p-2 bg-accent text-text rounded hover:bg-highlight"
          >
            Add Emulator/Launcher
          </button>
        </div>
      </form>
      <h3 className="text-lg font-semibold mb-2 text-text">Configured Emulators/Launchers</h3>
      {emulators.length === 0 ? (
        <p className="text-text">No emulators or launchers configured.</p>
      ) : (
        <ul className="space-y-2">
          {emulators.map((emu) => (
            <li
              key={emu.extension}
              className="flex justify-between items-center p-2 bg-primary border border-border rounded"
            >
              <div>
                <span className="font-medium">.{emu.extension}</span>: {emu.program_path}
                {emu.parameters && <span> (Parameters: {emu.parameters})</span>}
              </div>
              <button
                onClick={() => handleRemoveEmulator(emu.extension)}
                className="p-1 bg-red-600 text-text rounded hover:bg-red-700"
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

window.EmulatorLauncher = EmulatorLauncher;