import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../stores/useStore';

export default function Sidebar() {
  const [mtpCliAvailable, setMtpCliAvailable] = useState<boolean | null>(null);
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
    connectionToast,
    setConnectionToast,
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

  const handleImportFiles = async () => {
    if (!window.stune) return;
    setIsScanning(true);
    try {
      const result = await window.stune.importToLibrary();
      if (result) {
        setLibrary(result.library);
        if (result.errors.length > 0) {
          showError(`${result.imported} files imported, ${result.errors.length} errors`);
        }
      }
    } catch (err: any) {
      console.error('Failed to import files:', err);
      showError(`インポートに失敗しました: ${err?.message || err}`);
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

  // Drag & Drop
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (!window.stune) return;

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i] as File & { path?: string };
      if (f.path) paths.push(f.path);
    }
    if (paths.length === 0) return;

    setIsScanning(true);
    try {
      const result = await window.stune.importFilesByPath(paths);
      setLibrary(result.library);
      setViewMode('library');
      if (result.errors.length > 0) {
        showError(`${result.imported} imported, ${result.errors.length} errors`);
      }
    } catch (err: any) {
      console.error('Drop import failed:', err);
      showError(`インポートに失敗しました: ${err?.message || err}`);
    } finally {
      setIsScanning(false);
    }
  }, [setIsScanning, setLibrary, setViewMode]);

  const libraryPaths = library?.libraryPaths || [];

  useEffect(() => {
    if (!window.stune) return;
    window.stune.isMtpCliAvailable().then(setMtpCliAvailable);
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="app-title">sTunes</h1>
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
              <button
                className={`nav-item ${viewMode === 'artists' ? 'active' : ''}`}
                onClick={() => setViewMode('artists')}
              >
                <span className="nav-icon">&#9834;</span>
                Artists
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

          <div
            className={`drop-zone ${isDragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <button className="nav-item add-library" onClick={handleAddFolder}>
              <span className="nav-icon">+</span>
              Add Music Folder
            </button>

            <button className="nav-item add-library" onClick={handleImportFiles}>
              <span className="nav-icon">&#9834;</span>
              Import Files
            </button>

            <p className="drop-hint">
              {isDragOver ? 'ドロップして追加' : 'ドラッグ&ドロップでも追加できます'}
            </p>
          </div>

          {library && library.tracks.length > 0 && (
            <button className="nav-item subtle" onClick={handleRescan}>
              <span className="nav-icon">&#8635;</span>
              Rescan
            </button>
          )}
        </div>

        <div className="nav-section">
          <div className="nav-section-header">
            <h3 className="nav-section-title">WALKMAN</h3>
            {devices.length > 0 && (
              <span className="device-connected-badge" title="データ転送用に認識されています">
                <span className="device-connected-dot" />
                {devices.length === 1 ? '接続中' : `${devices.length}台接続中`}
              </span>
            )}
          </div>

          {devices.length === 0 ? (
            <div className="nav-empty-block">
              <p className="nav-empty nav-empty-hint">
                Walkman を USB で接続し、<br />
                データ転送モードにしてください
              </p>
              {mtpCliAvailable === true && (
                <>
                  <p className="nav-mtp-status nav-mtp-ok">MTP: mtp-cli 利用可能</p>
                  <p className="nav-mtp-hint">
                    接続されていません。USB で繋いだあと、Walkman の「USBの接続用途」で「<strong>ファイル転送</strong>」を選んでください。
                  </p>
                </>
              )}
              {mtpCliAvailable === false && (
                <p className="nav-mtp-status nav-mtp-missing">
                  MTP: 未対応 — <code>./scripts/setup.sh</code> 実行後、アプリを再起動
                </p>
              )}
              <details className="walkman-help">
                <summary>Finder に表示されない場合</summary>
                <ul className="walkman-help-list">
                  <li>Walkman の「USBの接続用途」で「<strong>ファイル転送</strong>」を選んでください（充電のみだと認識されません）</li>
                  <li><strong>M1/M2/M3 Mac</strong> では、NW-A100・NW-ZX507 など一部機種は非対応です。NW-A300 系・NW-ZX707・NW-WM1 系は対応</li>
                  <li>Mac は <strong>MTP</strong> を標準でドライブとしてマウントしないため、機種によっては Finder のサイドバーに一切出ないことがあります。その場合は別の転送ソフトが必要です</li>
                </ul>
                <a
                  href="https://knowledge.support.sony.jp/electronics/support/articles/00234112"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="walkman-help-link"
                >
                  ソニー公式：Mac がウォークマンを認識しない場合 →
                </a>
                <p className="walkman-help-openmtp">
                  sTunes で MTP が使えない Mac では、転送だけ <a href="https://openmtp.ganeshrvel.com/" target="_blank" rel="noopener noreferrer">OpenMTP</a> を使う運用がおすすめです。
                </p>
              </details>
            </div>
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

      {connectionToast && (
        <div
          className="connection-toast"
          onClick={() => setConnectionToast(null)}
          role="status"
        >
          <span className="connection-toast-icon">&#10003;</span>
          <span>{connectionToast}</span>
        </div>
      )}

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
