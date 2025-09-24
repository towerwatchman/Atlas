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
  const [previewUrls, setPreviewUrls] = useState([]);
  const [bannerUrl, setBannerUrl] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);
  const [previewHeight, setPreviewHeight] = useState(250);
  const [searchResults, setSearchResults] = useState([]);
  const [showModal, setShowModal] = useState(false);

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
      setBannerUrl(fetchedGame.banner_url || '');
      window.electronAPI.getPreviews(fetchedGame.record_id).then(urls => {
        setPreviewUrls(urls || []);
      }).catch(err => {
        console.error('Failed to load previews:', err);
      });
    };

    window.electronAPI.onGameData(handleGameData);

    const timeout = setTimeout(() => {
      if (!dataReceived) {
        console.warn('No game data received after 3 seconds, requesting manually');
        window.electronAPI.getGame(1).then(fetchedGame => {
          console.log('Received fallback game data:', fetchedGame);
          handleGameData(null, fetchedGame);
        }).catch(err => {
          console.error('Failed to fetch fallback game data:', err);
        });
      }
    }, 3000);

    window.electronAPI.onWindowStateChanged((state) => {
      setIsMaximized(state === 'maximized');
    });

    return () => {
      console.log('Cleaning up onGameData listener');
      clearTimeout(timeout);
    };
  }, [dataReceived]);

  useEffect(() => {
    const updatePreviewHeight = () => {
      const windowHeight = window.innerHeight;
      const topBannerHeight = 32;
      const altHeight = 170;
      const stickyButtonsHeight = 48;
      const mediaBannerHeight = 414;
      const availableHeight = windowHeight - topBannerHeight - altHeight - stickyButtonsHeight - mediaBannerHeight;
      console.log('Updating preview height:', availableHeight);
      setPreviewHeight(Math.max(availableHeight, 100));
    };

    updatePreviewHeight();
    window.addEventListener('resize', updatePreviewHeight);
    return () => window.removeEventListener('resize', updatePreviewHeight);
  }, []);

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
      date_added: version.date_added?.toString() || '',
    });
  };

  const handleSetPath = () => {
    window.electronAPI.selectDirectory().then(path => {
      if (path) {
        setVersionData({ ...versionData, game_path: path });
      }
    }).catch(err => {
      console.error('Failed to select directory:', err);
    });
  };

  const handleChangeExecutable = () => {
    window.electronAPI.selectFile().then(path => {
      if (path) {
        setVersionData({ ...versionData, executable: path });
      }
    }).catch(err => {
      console.error('Failed to select file:', err);
    });
  };

  const handleDownloadBanner = () => {
    window.electronAPI.updateBanners(game.record_id).then(newUrl => {
      setBannerUrl(newUrl);
    }).catch(err => {
      console.error('Failed to download banner:', err);
    });
  };

  const handleSelectCustomBanner = () => {
    window.electronAPI.selectFile().then(filePath => {
      if (filePath) {
        window.electronAPI.convertAndSaveBanner(game.record_id, filePath).then(newUrl => {
          setBannerUrl(newUrl);
        }).catch(err => {
          console.error('Failed to convert and save banner:', err);
        });
      }
    }).catch(err => {
      console.error('Failed to select custom banner:', err);
    });
  };

  const handleDownloadPreviews = () => {
    window.electronAPI.updatePreviews(game.record_id).then(newUrls => {
      console.log('Received previewUrls:', newUrls);
      setPreviewUrls(newUrls);
    }).catch(err => {
      console.error('Failed to download previews:', err);
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

  const handleSave = async () => {
    console.log('Saving changes', formData, versionData);
    const updatedGame = {
      ...game,
      title: formData.title,
      shortName: formData.short_name,
      OS: formData.platform,
      engine: formData.engine,
      creator: formData.developer,
      publisher: formData.publisher,
      release_date: formData.release_date ? new Date(formData.release_date).getTime() / 1000 : '',
      status: formData.status,
      f95_tags: formData.tags ? formData.tags.replace(/ , /g, ',') : '',
      overview: formData.description,
      category: formData.category,
      latestVersion: formData.latest_version,
      censored: formData.censored,
      language: formData.language,
      translations: formData.translations,
      genre: formData.genre,
      voice: formData.voice,
      rating: formData.rating,
    };
    await window.electronAPI.updateGame(updatedGame);

    if (selectedVersion) {
      const updatedVersion = {
        ...selectedVersion,
        gamePath: versionData.game_path,
        exePath: versionData.executable,
      };
      await window.electronAPI.updateVersion(updatedVersion);
    }
  };

  const handleCancel = () => {
    console.log('Closing window');
    window.electronAPI.closeWindow();
  };

  const minimize = () => window.electronAPI.minimizeWindow();
  const maximize = () => window.electronAPI.maximizeWindow();
  const close = () => window.electronAPI.closeWindow();

const handleFindGame = async () => {
  try {
    console.log('Searching for game:', formData.title, formData.developer);
    const results = await window.electronAPI.searchAtlas(formData.title, formData.developer );
    console.log('Search results:', results);
    setSearchResults(results || []);
    setShowModal(true);
  } catch (err) {
    console.error('Failed to search Atlas:', err);
  }
};

  const handleSelectGame = async (atlasId) => {
    try {
      console.log('Selected Atlas ID:', atlasId);
      await window.electronAPI.addAtlasMapping(game.record_id, atlasId);
      const updatedGame = await window.electronAPI.getGame(game.record_id);
      console.log('Reloaded game data:', updatedGame);
      setGame(updatedGame);
      setFormData({
        title: updatedGame.title || '',
        short_name: updatedGame.shortName || '',
        platform: updatedGame.os || '',
        engine: updatedGame.engine || '',
        developer: updatedGame.creator || '',
        publisher: updatedGame.publisher || '',
        release_date: updatedGame.release_date
          ? new Date(parseInt(updatedGame.release_date) * 1000).toISOString().split('T')[0]
          : '',
        status: updatedGame.status || '',
        tags: updatedGame.f95_tags ? updatedGame.f95_tags.replace(/,/g, ' , ') : '',
        description: updatedGame.overview || '',
        category: updatedGame.category || '',
        latest_version: updatedGame.latestVersion || '',
        censored: updatedGame.censored || '',
        language: updatedGame.language || '',
        translations: updatedGame.translations || '',
        genre: updatedGame.genre || '',
        voice: updatedGame.voice || '',
        rating: updatedGame.rating || '',
      });
      setVersions(updatedGame.versions || []);
      setBannerUrl(updatedGame.banner_url || '');
      window.electronAPI.getPreviews(updatedGame.record_id).then(urls => {
        setPreviewUrls(urls || []);
      }).catch(err => {
        console.error('Failed to load previews:', err);
      });
      setShowModal(false);
    } catch (err) {
      console.error('Failed to update Atlas mapping:', err);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setSearchResults([]);
  };

  const [activeTab, setActiveTab] = useState('Record');

  if (!game) {
    return (
      <div className="flex flex-col h-screen bg-canvas text-text border border-accent rounded-md overflow-hidden">
        <div className="flex justify-between items-center h-8 bg-primary px-2 -webkit-app-region-drag">
          <div className="bg-primary h-8 flex justify-end items-center pr-2 -webkit-app-region-drag">
            <p className="text-sm absolute left-2 top-1">Edit Game Details</p>
            <div className="flex absolute top-1 right-2 h-[70px] -webkit-app-region-no-drag">
              <button
                onClick={minimize}
                className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
                style={{ pointerEvents: 'auto', zIndex: 1000 }}
              >
                <i className="fas fa-minus fa-xs text-text"></i>
              </button>
              <button
                onClick={maximize}
                className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
                style={{ pointerEvents: 'auto', zIndex: 1000 }}
              >
                <i className={isMaximized ? "fas fa-window-restore fa-xs text-text" : "fas fa-window-maximize fa-xs text-text"}></i>
              </button>
              <button
                onClick={close}
                className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-[DarkRed] transition-colors duration-200"
                style={{ pointerEvents: 'auto', zIndex: 1000 }}
              >
                <i className="fas fa-times fa-xs text-text"></i>
              </button>
            </div>
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
    <div className="flex justify-between items-center h-8 bg-primary px-2 -webkit-app-region-drag">
      <div className="bg-primary h-8 flex justify-end items-center pr-2 -webkit-app-region-drag">
        <p className="text-sm absolute left-2 top-1">Edit Game Details</p>
        <div className="flex absolute top-1 right-2 h-[70px] -webkit-app-region-no-drag">
          <button
            onClick={minimize}
            className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
            style={{ pointerEvents: 'auto', zIndex: 1000 }}
          >
            <i className="fas fa-minus fa-xs text-text"></i>
          </button>
          <button
            onClick={maximize}
            className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
            style={{ pointerEvents: 'auto', zIndex: 1000 }}
          >
            <i className={isMaximized ? "fas fa-window-restore fa-xs text-text" : "fas fa-window-maximize fa-xs text-text"}></i>
          </button>
          <button
            onClick={close}
            className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-[DarkRed] transition-colors duration-200"
            style={{ pointerEvents: 'auto', zIndex: 1000 }}
          >
            <i className="fas fa-times fa-xs text-text"></i>
          </button>
        </div>
      </div>
    </div>

    <div className="flex flex-col flex-grow bg-primary">
      <div className="flex border-b border-border">
        {['Record', 'Versions', 'Media', 'Mappings'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 ${activeTab === tab ? 'bg-secondary border-t border-l border-r border-border' : 'bg-primary'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex flex-col flex-grow">
        <div className="flex-grow overflow-y-auto p-4 bg-secondary pb-4">
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
                <div className="flex justify-end">
                  <button
                    onClick={handleFindGame}
                    className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded"
                  >
                    Find Game
                  </button>
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
                  <button onClick={handleSetPath} className="ml-2 px-2 py-1 bg-tertiary hover:bg-button_hover rounded">Set Path</button>
                </div>
                <div className="flex items-center">
                  <label className="w-24">Executable</label>
                  <input name="executable" value={versionData.executable} onChange={handleVersionInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
                  <button onClick={handleChangeExecutable} className="ml-2 px-2 py-1 bg-tertiary hover:bg-button_hover rounded">Change</button>
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

          {activeTab === 'Media' && (
            <div className="flex flex-col flex-grow gap-4">
              <div className="flex flex-col h-[414px]">
                <label>Banner Image</label>
                {bannerUrl ? (
                  <div className="flex flex-col flex-grow">
                    <img
                      src={bannerUrl}
                      alt="Banner"
                      className="w-full max-h-[350px] object-contain rounded"
                      onError={(e) => console.error('Failed to load banner:', bannerUrl)}
                    />
                    <div className="flex space-x-2 mt-2">
                      <button
                        onClick={handleDownloadBanner}
                        className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded"
                      >
                        Download Banner
                      </button>
                      <button
                        onClick={handleSelectCustomBanner}
                        className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded"
                      >
                        Select Custom Banner
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await window.electronAPI.deleteBanner(game.record_id);
                            console.log('Banner deleted for recordId:', game.record_id);
                            setBannerUrl('');
                          } catch (err) {
                            console.error('Error deleting banner:', err);
                          }
                        }}
                        className="px-4 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                      >
                        Delete Banner
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex space-x-2">
                    <button
                      onClick={handleDownloadBanner}
                      className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded"
                      style={{ marginTop: '350px' }}
                    >
                      Download Banner
                    </button>
                    <button
                      onClick={handleSelectCustomBanner}
                      className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded"
                      style={{ marginTop: '350px' }}
                    >
                      Select Custom Banner
                    </button>
                  </div>
                )}
              </div>
              <div className="flex flex-col flex-grow">
                <label>Preview Images</label>
                <div style={{ height: `${previewHeight}px`, overflowY: 'auto' }}>
                  <div className="grid grid-cols-3 gap-2 p-2">
                    {Array.isArray(previewUrls) && previewUrls.length > 0 ? (
                      previewUrls.map((url, index) => (
                        <img
                          key={index}
                          src={url}
                          alt={`Preview ${index + 1}`}
                          className="w-full max-w-[300px] h-auto rounded cursor-pointer"
                          onClick={() => {
                            console.log('Opening preview:', url);
                            window.electronAPI.openExternalUrl(url);
                          }}
                          onError={(e) => console.error(`Failed to load preview ${index + 1}:`, url)}
                        />
                      ))
                    ) : (
                      <p>No previews available</p>
                    )}
                  </div>
                </div>
                <div className="flex space-x-2 mt-2">
                  <button
                    onClick={handleDownloadPreviews}
                    className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded"
                  >
                    Download Previews
                  </button>
                  {Array.isArray(previewUrls) && previewUrls.length > 0 && (
                    <button
                      onClick={async () => {
                        try {
                          await window.electronAPI.deletePreviews(game.record_id);
                          console.log('Previews deleted for recordId:', game.record_id);
                          setPreviewUrls([]);
                        } catch (err) {
                          console.error('Error deleting previews:', err);
                        }
                      }}
                      className="px-4 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      Delete Previews
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Mappings' && (
            <div className="flex flex-col gap-4">
              <div className="flex justify-end">
                <button
                  onClick={handleFindGame}
                  className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded"
                >
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
                      <td className="p-2">
                        <img
                          src="assets/images/f95_full.png"
                          alt="F95Zone Logo"
                          className="h-10 w-20 object-contain"
                        />
                      </td>
                      <td className="p-2">F95Zone</td>
                      <td className="p-2">{game.f95_id}</td>
                    </tr>
                  )}
                  {game.atlas_id && (
                    <tr className="border-b border-border">
                      <td className="p-2">
                        <img
                          src="assets/images/atlas_logo.svg"
                          alt="Atlas Logo"
                          className="h-10 w-20 object-contain"
                        />
                      </td>
                      <td className="p-2">Atlas</td>
                      <td className="p-2">{game.atlas_id}</td>
                    </tr>
                  )}
                  {!game.f95_id && !game.atlas_id && (
                    <tr>
                      <td colSpan="3" className="p-2 text-center">No mappings available</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
                    onClick={() => handleSelectGame(result.atlas_id)}
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
              <button
                onClick={handleCloseModal}
                className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 p-4 bg-primary flex justify-end space-x-2 z-10">
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