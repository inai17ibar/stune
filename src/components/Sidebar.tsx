import { useStore } from '../stores/useStore';

export default function Sidebar() {
  const {
    viewMode,
    setViewMode,
    library,
    devices,
    activeDevice,
    setActiveDevice,
    isScanning,
    setIsScanning,
    setLibrary,
    errorMessage,
    setErrorMessage,
  } = useStore();

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 5000);
  };

  const handleAddFolder = async () => {
    if (!window.stune) return;
    const folder = await window.stune.selectLibraryFolder();
    if (!folder) return;

    setIsScanning(true);
    try {
      const lib = await window.stune.addLibraryFolder(folder);
      if (lib.tracks.length === 0) {
        showError('音楽ファイルが見つかりませんでした。フォルダを確認してください。');
      }
      setLibrary(lib);
      setViewMode('library');
    } catch (err: any) {
      console.error('Failed to add library folder:', err);
      showError(`ライブラリの追加に失敗しました: ${err?.message || err}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleRescan = async () => {
    if (!window.stune) return;
    setIsScanning(true);
    try {
      const lib = await window.stune.rescanLibrary();
      setLibrary(lib);
    } catch (err: any) {
      console.error('Failed to rescan library:', err);
      showError(`再スキャンに失敗しました: ${err?.message || err}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleRemoveFolder = async (folderPath: string) => {
    if (!window.stune) return;
    try {
      const lib = await window.stune.removeLibraryFolder(folderPath);
      setLibrary(lib);
    } catch (err: any) {
      console.error('Failed to remove folder:', err);
      showError(`フォルダの削除に失敗しました: ${err?.message || err}`);
    }
  };

  const handleDeviceClick = async (device: any) => {
    if (!window.stune) return;
    setIsScanning(true);
    try {
      const fullDevice = await window.stune.scanDevice(device.mountPath);
      setActiveDevice(fullDevice);
    } catch (err: any) {
      console.error('Failed to scan device:', err);
      showError(`デバイスのスキャンに失敗しました: ${err?.message || err}`);
    } finally {
      setIsScanning(false);
    }
  };

  const libraryPaths = library?.libraryPaths || [];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="app-title">sTune</h1>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">
          <h3 className="nav-section-title">LIBRARY</h3>

          {library && library.tracks.length > 0 && (
            <>
              <button
                className={`nav-item ${viewMode === 'library' ? 'active' : ''}`}
                onClick={() => setViewMode('library')}
              >
                <span className="nav-icon">&#9835;</span>
                All Tracks
                <span className="nav-badge">{library.tracks.length}</span>
              </button>
              <button
                className={`nav-item ${viewMode === 'albums' ? 'active' : ''}`}
                onClick={() => setViewMode('albums')}
              >
                <span className="nav-icon">&#9827;</span>
                Albums
                <span className="nav-badge">{library.albums.length}</span>
              </button>
            </>
          )}

          {libraryPaths.length > 0 && (
            <div className="library-folders">
              {libraryPaths.map((fp) => (
                <div key={fp} className="library-folder-item">
                  <span className="folder-path" title={fp}>
                    {fp.split('/').pop()}
                  </span>
                  <button
                    className="folder-remove"
                    onClick={() => handleRemoveFolder(fp)}
                    title="Remove folder"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}

          <button className="nav-item add-library" onClick={handleAddFolder}>
            <span className="nav-icon">+</span>
            Add Music Folder
          </button>

          {library && library.tracks.length > 0 && (
            <button className="nav-item subtle" onClick={handleRescan}>
              <span className="nav-icon">&#8635;</span>
              Rescan
            </button>
          )}
        </div>

        <div className="nav-section">
          <h3 className="nav-section-title">WALKMAN</h3>

          {devices.length === 0 ? (
            <p className="nav-empty">No device connected</p>
          ) : (
            devices.map((device) => (
              <button
                key={device.mountPath}
                className={`nav-item ${
                  viewMode === 'device' &&
                  activeDevice?.mountPath === device.mountPath
                    ? 'active'
                    : ''
                }`}
                onClick={() => handleDeviceClick(device)}
              >
                <span className="nav-icon">&#9654;</span>
                {device.name}
              </button>
            ))
          )}
        </div>
      </nav>

      {errorMessage && (
        <div className="error-toast" onClick={() => setErrorMessage(null)}>
          <span>{errorMessage}</span>
        </div>
      )}

      {isScanning && (
        <div className="scanning-indicator">
          <div className="spinner" />
          <span>Scanning...</span>
        </div>
      )}

      {library && (
        <div className="sidebar-footer">
          <div className="library-info">
            <span>{library.tracks.length} tracks</span>
            <span>{formatSize(library.totalSize)}</span>
          </div>
        </div>
      )}
    </aside>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
