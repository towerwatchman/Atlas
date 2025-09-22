const { useState, useEffect } = window.React;
const ReactDOM = window.ReactDOM || {};
const { createRoot } = window.ReactDOM;

const GameDetailWindow = () => {
  const [game, setGame] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [versions, setVersions] = useState([]);
  const [dataReceived, setDataReceived] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    short_name: '',
    platform: '',
    engine: '',
    developer: '',
    publisher: '',
    release_date: '',
    status: '',
    tags: '',
    description: '',
    category: '',
    latest_version: '',
    censored: '',
    language: '',
    translations: '',
    genre: '',
    voice: '',
    rating: '',
  });
  const [versionData, setVersionData] = useState({
    game_version: '',
    game_path: '',
    executable: '',
    last_played: '',
    playtime: '',
    version_size: '',
    date_added: '',
  });

  useEffect(() => {
    console.log('Setting up onGameData listener');
    const handleGameData = (event, fetchedGame) => {
      console.log('Received game data:', fetchedGame);
      setDataReceived(true);
      if (!fetchedGame) {
        console.error('No game data received');
        return;
      }
      setGame(fetchedGame);
      setVersions(fetchedGame.versions || []);
      setFormData({
        title: fetchedGame.title || '',
        short_name: fetchedGame.shortName || '',
        platform: fetchedGame.os || '',
        engine: fetchedGame.engine || '',
        developer: fetchedGame.creator || '',
        publisher: fetchedGame.publisher || '',
        release_date: fetchedGame.release_date
          ? new Date(parseInt(fetchedGame.release_date) * 1000).toISOString().split('T')[0]
          : '',
        status: fetchedGame.status || '',
        tags: fetchedGame.f95_tags ? fetchedGame.f95_tags.replace(/,/g, ' , ') : '',
        description: fetchedGame.overview || '',
        category: fetchedGame.category || '',
        latest_version: fetchedGame.latestVersion || '',
        censored: fetchedGame.censored || '',
        language: fetchedGame.language || '',
        translations: fetchedGame.translations || '',
        genre: fetchedGame.genre || '',
        voice: fetchedGame.voice || '',
        rating: fetchedGame.rating || '',
      });
      if (fetchedGame.versions?.length > 0) {
        console.log('Selecting first version:', fetchedGame.versions[0]);
        handleVersionSelect(fetchedGame.versions[0]);
      } else {
        console.log('No versions available');
      }
    };

    window.electronAPI.onGameData(handleGameData);

    // Fallback to request data if not received
    const timeout = setTimeout(() => {
      if (!dataReceived) {
        console.warn('No game data received after 3 seconds, requesting manually');
        // Placeholder: Use recordId 1 as fallback; ideally, this should be passed
        window.electronAPI.getGame(1).then(fetchedGame => {
          console.log('Received fallback game data:', fetchedGame);
          handleGameData(null, fetchedGame);
        }).catch(err => {
          console.error('Failed to fetch fallback game data:', err);
        });
      }
    }, 3000);

    return () => {
      console.log('Cleaning up onGameData listener');
      clearTimeout(timeout);
    };
  }, [dataReceived]);

  useEffect(() => {
    console.log('formData updated:', formData);
  }, [formData]);

  useEffect(() => {
    console.log('versions updated:', versions);
  }, [versions]);

  useEffect(() => {
    console.log('versionData updated:', versionData);
  }, [versionData]);

  const handleInputChange = (e) => {
    console.log(`Input changed: ${e.target.name} = ${e.target.value}`);
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleVersionInputChange = (e) => {
    console.log(`Version input changed: ${e.target.name} = ${e.target.value}`);
    setVersionData({ ...versionData, [e.target.name]: e.target.value });
  };

  const handleVersionSelect = (version) => {
    console.log('Selected version:', version);
    setSelectedVersion(version);
    setVersionData({
      game_version: version.version || '',
      game_path: version.game_path || '',
      executable: version.exec_path || '',
      last_played: version.last_played?.toString() || '',
      playtime: version.version_playtime?.toString() || '',
      version_size: version.folder_size?.toString() || '',
      date_added: version.date_added
          ? new Date(parseInt(version.date_added) * 1000).toISOString().split('T')[0]
          : '',
    });
  };

  const handleRemoveVersion = async () => {
    if (!selectedVersion) {
      console.log('No version selected for removal');
      return;
    }

    const confirm = window.confirm('This will also remove the game folder. Do you want to continue?');
    if (!confirm) return;

    try {
      console.log('Removing version for recordId:', selectedVersion.recordId);
      const isDeleted = await window.electronAPI.removeGame(selectedVersion.recordId);
      if (isDeleted) {
        console.log('Version deleted, updating UI');
        console.log('TODO: Delete game folder at', selectedVersion.gamePath);

        const updatedVersions = versions.filter(v => v.version !== selectedVersion.version);
        setVersions(updatedVersions);
        if (updatedVersions.length > 0) {
          handleVersionSelect(updatedVersions[0]);
        } else {
          setSelectedVersion(null);
          setVersionData({});
        }

        console.log('TODO: Update ModelData.GameCollection');
      }
    } catch (err) {
      console.error('Error removing version:', err);
    }
  };

  const handleAddVersion = () => {
    console.log('TODO: Add new version');
  };

  const handleSave = () => {
    console.log('TODO: Save changes', formData, versionData);
  };

  const handleCancel = () => {
    console.log('Closing window');
    window.electronAPI.closeWindow();
  };

  const minimize = () => window.electronAPI.minimizeWindow();
  const maximize = () => window.electronAPI.maximizeWindow();
  const close = () => window.electronAPI.closeWindow();

  const [activeTab, setActiveTab] = useState('Record');

  if (!game) {
    return (
      <div className="flex flex-col h-screen bg-canvas text-text border border-accent rounded-md overflow-hidden">
        <div className="flex justify-between items-center h-8 bg-primary px-2">
          <span className="ml-2">Edit Game Details</span>
          <div className="flex space-x-1">
            <button onClick={minimize} className="w-6 h-6 bg-transparent hover:bg-button_hover">
              <span>-</span>
            </button>
            <button onClick={maximize} className="w-6 h-6 bg-transparent hover:bg-button_hover">
              <span>□</span>
            </button>
            <button onClick={close} className="w-6 h-6 bg-transparent hover:bg-red-500">
              <span>×</span>
            </button>
          </div>
        </div>
        <div className="flex-grow flex items-center justify-center bg-secondary">
          <span>Loading game data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-canvas text-text border border-accent rounded-md overflow-hidden">
      <div className="flex justify-between items-center h-8 bg-primary px-2">
        <span className="ml-2">Edit Game Details</span>
        <div className="flex space-x-1">
          <button onClick={minimize} className="w-6 h-6 bg-transparent hover:bg-button_hover">
            <span>-</span>
          </button>
          <button onClick={maximize} className="w-6 h-6 bg-transparent hover:bg-button_hover">
            <span>□</span>
          </button>
          <button onClick={close} className="w-6 h-6 bg-transparent hover:bg-red-500">
            <span>×</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col flex-grow bg-primary">
        <div className="flex border-b border-border">
          {['Record', 'Versions', 'Advanced', 'Media', 'Mappings', 'Installation'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 ${activeTab === tab ? 'bg-secondary border-t border-l border-r border-border' : 'bg-primary'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex-grow overflow-auto p-4 bg-secondary">
          {activeTab === 'Record' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center">
                  <label className="w-24">Title</label>
                  <input name="title" value={formData.title} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Short Name</label>
                  <input name="short_name" value={formData.short_name} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Platform</label>
                  <input name="platform" value={formData.platform} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Engine</label>
                  <input name="engine" value={formData.engine} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Developer</label>
                  <input name="developer" value={formData.developer} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Publisher</label>
                  <input name="publisher" value={formData.publisher} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Release Date</label>
                  <input name="release_date" value={formData.release_date} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" type="date" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Status</label>
                  <input name="status" value={formData.status} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center">
                  <label className="w-24">Category</label>
                  <input name="category" value={formData.category} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Last Update</label>
                  <input name="latest_version" value={formData.latest_version} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Censored</label>
                  <input name="censored" value={formData.censored} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Language</label>
                  <input name="language" value={formData.language} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Translations</label>
                  <input name="translations" value={formData.translations} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Genre</label>
                  <input name="genre" value={formData.genre} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Voice</label>
                  <input name="voice" value={formData.voice} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Rating</label>
                  <input name="rating" value={formData.rating} onChange={handleInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
              </div>

              <div className="col-span-2 space-y-2 mt-4">
                <div className="flex">
                  <label className="w-24">Tags</label>
                  <textarea name="tags" value={formData.tags} onChange={handleInputChange} className="flex-grow h-24 bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex">
                  <label className="w-24">Description</label>
                  <textarea name="description" value={formData.description} onChange={handleInputChange} className="flex-grow h-48 bg-tertiary border border-border p-1 rounded" />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Versions' && (
            <div className="flex h-full">
              <div className="w-40 bg-primary border-r border-border">
                <ul className="space-y-1">
                  {versions.map((version, index) => (
                    <li
                      key={index}
                      onClick={() => handleVersionSelect(version)}
                      className={`p-2 cursor-pointer ${selectedVersion?.version === version.version ? 'bg-selected' : 'hover:bg-button_hover'}`}
                    >
                      {version.version}
                    </li>
                  ))}
                </ul>
                <div className="flex justify-center space-x-2 mt-2">
                  <button onClick={handleAddVersion} className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded">Add</button>
                  <button onClick={handleRemoveVersion} className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded">Remove</button>
                </div>
              </div>

              <div className="flex-grow p-4 space-y-2">
                <div className="flex items-center">
                  <label className="w-24">Version</label>
                  <input name="game_version" value={versionData.game_version} onChange={handleVersionInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                </div>
                <div className="flex items-center">
                  <label className="w-24">Game Path</label>
                  <input name="game_path" value={versionData.game_path} onChange={handleVersionInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                  <button className="ml-2 px-2 py-1 bg-tertiary hover:bg-button_hover rounded">Set Path</button>
                </div>
                <div className="flex items-center">
                  <label className="w-24">Executable</label>
                  <input name="executable" value={versionData.executable} onChange={handleVersionInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                  <button className="ml-2 px-2 py-1 bg-tertiary hover:bg-button_hover rounded">Change</button>
                </div>
                <div className="flex items-center opacity-75">
                  <label className="w-24">Last Played</label>
                  <input name="last_played" value={versionData.last_played} disabled className="flex-grow bg-tertiary border border-border p-1 rounded cursor-not-allowed" />
                </div>
                <div className="flex items-center opacity-75">
                  <label className="w-24">Playtime</label>
                  <input name="playtime" value={versionData.playtime} disabled className="flex-grow bg-tertiary border border-border p-1 rounded cursor-not-allowed" />
                </div>
                <div className="flex items-center opacity-75">
                  <label className="w-24">Version Size</label>
                  <input name="version_size" value={versionData.version_size} disabled className="flex-grow bg-tertiary border border-border p-1 rounded cursor-not-allowed" />
                </div>
                <div className="flex items-center opacity-75">
                  <label className="w-24">Date Added</label>
                  <input name="date_added" value={versionData.date_added} disabled className="flex-grow bg-tertiary border border-border p-1 rounded cursor-not-allowed" />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Advanced' && <div>Advanced content (TODO)</div>}
          {activeTab === 'Media' && <div>Media content (TODO)</div>}
          {activeTab === 'Mappings' && <div>Mappings content (TODO)</div>}
          {activeTab === 'Installation' && <div>Installation content (TODO)</div>}
        </div>

        <div className="flex justify-end p-4 bg-primary space-x-2">
          <button onClick={handleSave} className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded">Save</button>
          <button onClick={handleCancel} className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded">Cancel</button>
        </div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')) || {
  render: (component) => ReactDOM.render(component, document.getElementById('root'))
};
root.render(<GameDetailWindow />);