import { useState, useEffect, useCallback, useMemo } from 'react';
import { useStore } from '../stores/useStore';
import DiskUsageBar from './DiskUsageBar';
import type { Album } from '../types';

// ---------------------------------------------------------------------------
// MTP types
// ---------------------------------------------------------------------------

interface MtpFileEntry {
  objectId: number;
  name: string;
  fullPath: string;
  size: number;
  isDir: boolean;
}

interface MtpStorageInfo {
  storageId: string;
  description: string;
  maxCapacity: number;
  freeSpaceInBytes: number;
}

interface MtpDeviceDetail {
  name: string;
  storages: MtpStorageInfo[];
  storageId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.wav', '.aac', '.m4a', '.alac', '.aiff', '.aif',
  '.ogg', '.wma', '.dsf', '.dff', '.opus',
]);

function isAudioFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

function getTrackNumber(name: string): number {
  const match = name.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 9999;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function isMtpDevice(mountPath: string): boolean {
  return mountPath.startsWith('mtp://');
}

// ---------------------------------------------------------------------------
// Group tracks by Artist > Album for the USB tree view
// ---------------------------------------------------------------------------

interface ArtistGroup {
  artist: string;
  albums: Album[];
  trackCount: number;
}

function groupByArtist(albums: Album[]): ArtistGroup[] {
  const map = new Map<string, Album[]>();
  for (const album of albums) {
    const key = album.artist || 'Unknown Artist';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(album);
  }
  return Array.from(map.entries())
    .map(([artist, artistAlbums]) => ({
      artist,
      albums: artistAlbums.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.name.localeCompare(b.name)),
      trackCount: artistAlbums.reduce((sum, al) => sum + al.tracks.length, 0),
    }))
    .sort((a, b) => a.artist.localeCompare(b.artist));
}

// ===========================================================================
// Component
// ===========================================================================

export default function DeviceView() {
  const {
    activeDevice,
    isScanning,
    setActiveDevice,
    selectedTracks,
    toggleTrackSelection,
    selectAllTracks,
    clearSelection,
  } = useStore();

  // ---- Shared state -------------------------------------------------------
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ---- USB state ----------------------------------------------------------
  const [expandedArtists, setExpandedArtists] = useState<Set<string>>(new Set());
  const [expandedAlbums, setExpandedAlbums] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState('');

  // ---- MTP state ----------------------------------------------------------
  const [mtpDevice, setMtpDevice] = useState<MtpDeviceDetail | null>(null);
  const [activeStorageId, setActiveStorageId] = useState<string>('');
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<MtpFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [playingFile, setPlayingFile] = useState<string | null>(null);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string>('');

  // ---- Derived values (must be before early returns) ----------------------
  const isUsb = activeDevice ? !isMtpDevice(activeDevice.mountPath) : false;

  const artistGroups = useMemo(() => {
    if (!activeDevice || !isUsb) return [];
    return groupByArtist(activeDevice.albums);
  }, [activeDevice, isUsb]);

  const allUsbTracks = useMemo(() => {
    if (!activeDevice || !isUsb) return [];
    return activeDevice.tracks;
  }, [activeDevice, isUsb]);

  const filteredArtistGroups = useMemo(() => {
    if (!searchFilter) return artistGroups;
    const q = searchFilter.toLowerCase();
    return artistGroups
      .map((ag) => {
        const matchedAlbums = ag.albums
          .map((album) => {
            const tracks = album.tracks.filter(
              (t) =>
                t.title.toLowerCase().includes(q) ||
                t.artist.toLowerCase().includes(q) ||
                t.album.toLowerCase().includes(q)
            );
            if (tracks.length === 0) return null;
            return { ...album, tracks };
          })
          .filter(Boolean) as Album[];
        if (matchedAlbums.length === 0) return null;
        return {
          ...ag,
          albums: matchedAlbums,
          trackCount: matchedAlbums.reduce((s, a) => s + a.tracks.length, 0),
        };
      })
      .filter(Boolean) as ArtistGroup[];
  }, [artistGroups, searchFilter]);

  const selectedCount = selectedTracks.size;

  // ---- MTP effects (always declared, guarded internally) ------------------

  useEffect(() => {
    if (!activeDevice || isUsb || !window.stune) return;
    window.stune.mtpGetDevices().then((devices: MtpDeviceDetail[]) => {
      if (devices.length > 0) {
        // Extract storageId from activeDevice.mountPath (e.g. "mtp://1" -> "1")
        const activeStorageFromPath = activeDevice.mountPath.replace('mtp://', '').split('/')[0];
        // Find the matching device entry, or fall back to first
        const matchedDev = devices.find(
          (d: MtpDeviceDetail) => d.storageId === activeStorageFromPath
        ) || devices[0];
        setMtpDevice(matchedDev);
        setActiveStorageId(activeStorageFromPath || matchedDev.storageId);
      }
    });
  }, [activeDevice, isUsb]);

  const browse = useCallback(
    async (storageId: string, dirPath: string) => {
      if (!window.stune) return;
      setLoading(true);
      try {
        const result = await window.stune.mtpBrowse(storageId, dirPath);
        setFiles(result || []);
      } catch (err) {
        console.error('Browse failed:', err);
        setFiles([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (activeStorageId && !isUsb) {
      browse(activeStorageId, currentPath);
    }
  }, [activeStorageId, currentPath, browse, isUsb]);

  // Clear selection when device changes
  useEffect(() => {
    clearSelection();
    setSearchFilter('');
    setExpandedArtists(new Set());
    setExpandedAlbums(new Set());
    setDeleteError(null);
  }, [activeDevice, clearSelection]);

  // ---- MTP selection state -------------------------------------------------
  const [mtpSelectedFiles, setMtpSelectedFiles] = useState<Set<string>>(new Set());

  const toggleMtpFileSelection = (fullPath: string) => {
    setMtpSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
  };

  const handleMtpDeleteSelected_paths = async (paths: string[]) => {
    if (!window.stune || paths.length === 0 || !activeDevice) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await window.stune.deleteDeviceTracks(activeDevice.mountPath, paths);
      if (!result.success) {
        setDeleteError(`削除に失敗: ${result.errors.join(', ')}`);
      }
      setMtpSelectedFiles(new Set());
      // Refresh the current directory
      if (activeStorageId) {
        await browse(activeStorageId, currentPath);
      }
      // Rescan device
      if (result.device) {
        setActiveDevice({ ...activeDevice, ...result.device });
      }
    } catch (err) {
      setDeleteError(`削除に失敗: ${err}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleMtpDeleteSelected = async () => {
    if (mtpSelectedFiles.size === 0) return;
    const paths = Array.from(mtpSelectedFiles);
    const confirmMsg = `${paths.length} 曲をデバイスから削除しますか？この操作は取り消せません。`;
    if (!confirm(confirmMsg)) return;
    await handleMtpDeleteSelected_paths(paths);
  };

  // ---- MTP navigation helpers ---------------------------------------------

  const navigateTo = (dirPath: string) => setCurrentPath(dirPath);

  const navigateToBreadcrumb = (index: number) => {
    const parts = currentPath.split('/').filter(Boolean);
    const newPath = '/' + parts.slice(0, index + 1).join('/');
    setCurrentPath(newPath);
  };

  const navigateToRoot = () => setCurrentPath('/');

  const switchStorage = (storageId: string) => {
    setActiveStorageId(storageId);
    setCurrentPath('/');
    setFiles([]);
    setMtpSelectedFiles(new Set());
  };

  const stopMtpPlayback = () => {
    setAudioSrc(null);
    setPlayingFile(null);
    setAudioName('');
  };

  const handleMtpPlay = async (file: MtpFileEntry) => {
    if (!window.stune || downloadingFile) return;

    // Toggle: stop if already playing this file
    if (playingFile === file.fullPath) {
      stopMtpPlayback();
      return;
    }

    setDownloadingFile(file.fullPath);
    try {
      const localPath = await window.stune.mtpDownloadFile(
        activeStorageId,
        file.fullPath
      );
      if (localPath) {
        setAudioSrc(`stune-audio://${localPath}`);
        setAudioName(file.name.replace(/\.[^.]+$/, ''));
        setPlayingFile(file.fullPath);
      }
    } catch (err) {
      console.error('Download for playback failed:', err);
    } finally {
      setDownloadingFile(null);
    }
  };

  // ---- USB toggle helpers -------------------------------------------------

  const toggleArtist = (artist: string) => {
    setExpandedArtists((prev) => {
      const next = new Set(prev);
      if (next.has(artist)) next.delete(artist);
      else next.add(artist);
      return next;
    });
  };

  const toggleAlbum = (key: string) => {
    setExpandedAlbums((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ---- USB select helpers -------------------------------------------------

  const toggleAlbumSelection = (album: Album) => {
    const paths = album.tracks.map((t) => t.filePath);
    const allSelected = paths.every((p) => selectedTracks.has(p));
    if (allSelected) {
      // Deselect all in this album
      for (const p of paths) {
        if (selectedTracks.has(p)) toggleTrackSelection(p);
      }
    } else {
      // Select all in this album
      for (const p of paths) {
        if (!selectedTracks.has(p)) toggleTrackSelection(p);
      }
    }
  };

  const handleSelectAll = () => {
    if (selectedCount === allUsbTracks.length) {
      clearSelection();
    } else {
      selectAllTracks(allUsbTracks.map((t) => t.filePath));
    }
  };

  // ---- USB delete ---------------------------------------------------------

  const handleDeleteSelected = async () => {
    if (!window.stune || selectedCount === 0 || !activeDevice) return;
    const paths = Array.from(selectedTracks);
    const confirmMsg = `Delete ${paths.length} track${paths.length > 1 ? 's' : ''} from the device? This cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await window.stune.deleteDeviceTracks(activeDevice.mountPath, paths);
      if (!result.success) {
        setDeleteError(
          `Failed to delete ${result.errors.length} file(s): ${result.errors.join(', ')}`
        );
      }
      clearSelection();
      // Update device with rescanned data from the backend
      if (result.device) {
        setActiveDevice({ ...activeDevice, ...result.device });
      }
    } catch (err) {
      setDeleteError(`Delete failed: ${err}`);
    } finally {
      setDeleting(false);
    }
  };

  // ---- Early returns ------------------------------------------------------

  if (!activeDevice) {
    return (
      <div className="empty-state center">
        <div className="empty-icon">&#9654;</div>
        <h2>No device selected</h2>
        <p>
          Connect your Walkman via USB in data-transfer mode, then select it
          from the sidebar.
        </p>
      </div>
    );
  }

  if (isScanning) {
    return (
      <div className="empty-state center">
        <div className="spinner large" />
        <p>Scanning device...</p>
      </div>
    );
  }

  // ========================================================================
  // USB-mounted Walkman view
  // ========================================================================

  if (isUsb) {
    return (
      <div className="device-view">
        <div className="view-header">
          <h2>{activeDevice.name}</h2>
          <span className="view-header-meta">
            {allUsbTracks.length} tracks &middot; {formatSize(allUsbTracks.reduce((s, t) => s + t.fileSize, 0))}
          </span>
        </div>

        <DiskUsageBar device={activeDevice} />

        {/* Toolbar */}
        <div className="device-toolbar">
          <input
            type="text"
            className="device-search"
            placeholder="曲名・アーティスト名で検索..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />

          <div className="device-toolbar-actions">
            <button
              className="btn btn-small"
              onClick={handleSelectAll}
            >
              {selectedCount === allUsbTracks.length && allUsbTracks.length > 0
                ? '選択解除'
                : 'すべて選択'}
            </button>
          </div>
        </div>

        {/* Delete action bar - visible when tracks selected */}
        {selectedCount > 0 && (
          <div className="device-delete-bar">
            <span className="device-delete-info">
              {selectedCount} 曲を選択中
            </span>
            <div className="device-delete-actions">
              <button
                className="btn btn-small"
                onClick={clearSelection}
              >
                選択解除
              </button>
              <button
                className="btn btn-small btn-danger"
                onClick={handleDeleteSelected}
                disabled={deleting}
              >
                {deleting
                  ? '削除中...'
                  : `🗑 選択した ${selectedCount} 曲を削除`}
              </button>
            </div>
          </div>
        )}

        {deleteError && (
          <div className="error-banner">{deleteError}</div>
        )}

        {/* Artist > Album > Track tree */}
        <div className="device-browser">
          {filteredArtistGroups.length === 0 && (
            <div className="empty-state">
              <p>
                {searchFilter
                  ? 'No tracks match your filter.'
                  : 'No music found on this device.'}
              </p>
            </div>
          )}

          {filteredArtistGroups.map((ag) => {
            const artistExpanded = expandedArtists.has(ag.artist);
            return (
              <div key={ag.artist} className="usb-artist-group">
                <button
                  className="usb-artist-header"
                  onClick={() => toggleArtist(ag.artist)}
                >
                  <span className="usb-expand-icon">
                    {artistExpanded ? '\u25BC' : '\u25B6'}
                  </span>
                  <span className="usb-artist-name">{ag.artist}</span>
                  <span className="usb-artist-count">
                    {ag.albums.length} album{ag.albums.length > 1 ? 's' : ''} &middot; {ag.trackCount} track{ag.trackCount > 1 ? 's' : ''}
                  </span>
                </button>

                {artistExpanded &&
                  ag.albums.map((album) => {
                    const albumKey = `${ag.artist}::${album.name}`;
                    const albumExpanded = expandedAlbums.has(albumKey);
                    const albumAllSelected =
                      album.tracks.length > 0 &&
                      album.tracks.every((t) =>
                        selectedTracks.has(t.filePath)
                      );
                    const albumSomeSelected =
                      !albumAllSelected &&
                      album.tracks.some((t) =>
                        selectedTracks.has(t.filePath)
                      );

                    return (
                      <div key={albumKey} className="usb-album-group">
                        <div className="usb-album-header">
                          <input
                            type="checkbox"
                            className="usb-checkbox"
                            checked={albumAllSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = albumSomeSelected;
                            }}
                            onChange={() => toggleAlbumSelection(album)}
                            title="Select all tracks in this album"
                          />
                          <button
                            className="usb-album-toggle"
                            onClick={() => toggleAlbum(albumKey)}
                          >
                            <span className="usb-expand-icon">
                              {albumExpanded ? '\u25BC' : '\u25B6'}
                            </span>
                            {album.coverArt && (
                              <img
                                className="usb-album-cover"
                                src={album.coverArt}
                                alt=""
                              />
                            )}
                            <span className="usb-album-name">
                              {album.name || 'Unknown Album'}
                            </span>
                            {album.year && (
                              <span className="usb-album-year">
                                ({album.year})
                              </span>
                            )}
                            <span className="usb-album-count">
                              {album.tracks.length} track{album.tracks.length > 1 ? 's' : ''}
                            </span>
                          </button>
                        </div>

                        {albumExpanded && (
                          <div className="track-list usb-track-list">
                            <div className="track-list-header">
                              <div className="track-col track-col-checkbox">&nbsp;</div>
                              <div className="track-col track-col-num">#</div>
                              <div className="track-col track-col-title">Title</div>
                              <div className="track-col track-col-duration">Time</div>
                              <div className="track-col track-col-size">Size</div>
                              <div className="track-col track-col-format">Format</div>
                            </div>
                            <div className="track-list-body">
                              {album.tracks
                                .slice()
                                .sort(
                                  (a, b) =>
                                    (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
                                    (a.trackNumber ?? 9999) -
                                      (b.trackNumber ?? 9999)
                                )
                                .map((track, idx) => {
                                  const isSelected = selectedTracks.has(
                                    track.filePath
                                  );
                                  return (
                                    <div
                                      key={track.filePath}
                                      className={`track-row ${isSelected ? 'selected' : ''}`}
                                    >
                                      <div className="track-col track-col-checkbox">
                                        <input
                                          type="checkbox"
                                          className="usb-checkbox"
                                          checked={isSelected}
                                          onChange={() =>
                                            toggleTrackSelection(
                                              track.filePath
                                            )
                                          }
                                        />
                                      </div>
                                      <div className="track-col track-col-num">
                                        {track.trackNumber ?? idx + 1}
                                      </div>
                                      <div className="track-col track-col-title">
                                        <span className="track-title-text">
                                          {track.title || track.fileName}
                                        </span>
                                      </div>
                                      <div className="track-col track-col-duration">
                                        {track.duration
                                          ? formatDuration(track.duration)
                                          : '--:--'}
                                      </div>
                                      <div className="track-col track-col-size">
                                        {formatSize(track.fileSize)}
                                      </div>
                                      <div className="track-col track-col-format">
                                        <span className="format-badge">
                                          {track.format?.toUpperCase() || ''}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ========================================================================
  // MTP Walkman view (original browse-based approach)
  // ========================================================================

  const pathParts = currentPath.split('/').filter(Boolean);
  const folders = files
    .filter((f) => f.isDir)
    .sort((a, b) => a.name.localeCompare(b.name));
  const audioFiles = files
    .filter((f) => !f.isDir && isAudioFile(f.name))
    .sort((a, b) => getTrackNumber(a.name) - getTrackNumber(b.name));
  const currentStorage = mtpDevice?.storages.find(
    (s) => s.storageId === activeStorageId
  );
  const currentStorageIndex = mtpDevice?.storages.findIndex(
    (s) => s.storageId === activeStorageId
  ) ?? 0;
  const breadcrumbName = mtpDevice
    ? mtpDevice.storages.length > 1
      ? `${mtpDevice.name?.replace(/ \(.*\)$/, '')} (${currentStorageIndex === 0 ? 'Internal' : 'SD Card'})`
      : (mtpDevice.name || 'Device')
    : 'Device';

  return (
    <div className="device-view">
      <div className="view-header">
        <h2>{activeDevice.name}</h2>
        <span className="view-header-badge">MTP</span>
      </div>

      <DiskUsageBar device={activeDevice} />

      {/* Storage tabs */}
      {mtpDevice && mtpDevice.storages.length > 1 && (
        <div className="storage-tabs">
          {mtpDevice.storages.map((s, i) => (
            <button
              key={s.storageId}
              className={`storage-tab ${s.storageId === activeStorageId ? 'active' : ''}`}
              onClick={() => switchStorage(s.storageId)}
            >
              {i === 0 ? 'Internal Storage' : 'SD Card'}
              <span className="storage-tab-size">
                {formatSize(s.maxCapacity)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <button className="breadcrumb-item" onClick={navigateToRoot}>
          {breadcrumbName}
        </button>
        {pathParts.map((part, i) => (
          <span key={i}>
            <span className="breadcrumb-sep">/</span>
            <button
              className={`breadcrumb-item ${i === pathParts.length - 1 ? 'current' : ''}`}
              onClick={() => navigateToBreadcrumb(i)}
            >
              {part}
            </button>
          </span>
        ))}
        {currentStorage && (
          <span className="breadcrumb-free">
            Free: {formatSize(currentStorage.freeSpaceInBytes)}
          </span>
        )}
      </div>

      {/* MTP delete action bar */}
      {mtpSelectedFiles.size > 0 && (
        <div className="device-delete-bar">
          <span className="device-delete-info">
            {mtpSelectedFiles.size} 曲を選択中
          </span>
          <div className="device-delete-actions">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setMtpSelectedFiles(new Set())}
            >
              選択解除
            </button>
            <button
              type="button"
              className="btn btn-small btn-danger"
              onClick={handleMtpDeleteSelected}
              disabled={deleting}
            >
              {deleting ? '削除中...' : `🗑 選択した ${mtpSelectedFiles.size} 曲を削除`}
            </button>
          </div>
        </div>
      )}

      {deleteError && (
        <div className="error-banner">{deleteError}</div>
      )}

      {loading ? (
        <div className="empty-state center">
          <div className="spinner large" />
          <p>Loading...</p>
        </div>
      ) : (
        <div className="device-browser">
          {/* Toolbar */}
          {audioFiles.length > 0 && (
            <div className="device-toolbar">
              <div className="device-toolbar-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    if (mtpSelectedFiles.size === audioFiles.length) {
                      setMtpSelectedFiles(new Set());
                    } else {
                      setMtpSelectedFiles(new Set(audioFiles.map((f) => f.fullPath)));
                    }
                  }}
                >
                  {mtpSelectedFiles.size === audioFiles.length && audioFiles.length > 0
                    ? '選択解除'
                    : `すべて選択 (${audioFiles.length})`}
                </button>
              </div>
            </div>
          )}

          {/* Folders */}
          {folders.length > 0 && (
            <div className="folder-grid">
              {folders.map((f) => (
                <div key={f.objectId} className="folder-card-wrapper">
                  <button
                    type="button"
                    className="folder-card"
                    onClick={() => navigateTo(f.fullPath)}
                  >
                    <span className="folder-card-icon">&#128193;</span>
                    <span className="folder-card-name">{f.name}</span>
                  </button>
                  <button
                    type="button"
                    className="folder-delete-btn"
                    onClick={() => {
                      if (!confirm(`フォルダ「${f.name}」を削除しますか？中のファイルもすべて削除されます。`)) return;
                      handleMtpDeleteSelected_paths([f.fullPath]);
                    }}
                    title={`${f.name} を削除`}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Audio files */}
          {audioFiles.length > 0 && (
            <div className="track-list">
              <div className="track-list-header">
                <div className="track-col track-col-checkbox">&nbsp;</div>
                <div className="track-col track-col-play-btn">&nbsp;</div>
                <div className="track-col track-col-num">#</div>
                <div className="track-col track-col-title">Title</div>
                <div className="track-col track-col-size">Size</div>
                <div className="track-col track-col-format">Format</div>
              </div>
              <div className="track-list-body">
                {audioFiles.map((file, index) => {
                  const trackNum = getTrackNumber(file.name);
                  const displayName = file.name
                    .replace(/\.[^.]+$/, '')
                    .replace(/^\d+[-\s]*/, '');
                  const ext =
                    file.name.split('.').pop()?.toUpperCase() || '';
                  const isPlaying = playingFile === file.fullPath;
                  const isDownloading = downloadingFile === file.fullPath;
                  const isFileSelected = mtpSelectedFiles.has(file.fullPath);

                  return (
                    <div
                      key={file.objectId}
                      className={`track-row ${isPlaying ? 'playing' : ''} ${isFileSelected ? 'selected' : ''}`}
                      onDoubleClick={() => handleMtpPlay(file)}
                    >
                      <div className="track-col track-col-checkbox">
                        <input
                          type="checkbox"
                          className="usb-checkbox"
                          checked={isFileSelected}
                          onChange={() => toggleMtpFileSelection(file.fullPath)}
                        />
                      </div>
                      <div className="track-col track-col-play-btn">
                        {isDownloading ? (
                          <div className="spinner" />
                        ) : (
                          <button
                            type="button"
                            className="play-btn"
                            onClick={() => handleMtpPlay(file)}
                            title="Play"
                          >
                            {isPlaying ? '\u23F8' : '\u25B6'}
                          </button>
                        )}
                      </div>
                      <div className="track-col track-col-num">
                        {trackNum < 9999 ? trackNum : index + 1}
                      </div>
                      <div className="track-col track-col-title">
                        <span className="track-title-text">
                          {displayName || file.name}
                        </span>
                      </div>
                      <div className="track-col track-col-size">
                        {formatSize(file.size)}
                      </div>
                      <div className="track-col track-col-format">
                        <span className="format-badge">{ext}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {folders.length === 0 && audioFiles.length === 0 && (
            <div className="empty-state">
              <p>このフォルダは空です</p>
            </div>
          )}
        </div>
      )}

      {/* Audio player (MTP) */}
      {audioSrc && (
        <div className="player-bar">
          <div className="player-info">
            <span className="player-now-playing">&#9835;</span>
            <span className="player-track-name">{audioName}</span>
          </div>
          <audio
            src={audioSrc}
            autoPlay
            controls
            title={audioName || 'Audio player'}
            onEnded={() => {
              const currentIndex = audioFiles.findIndex(
                (f) => f.fullPath === playingFile
              );
              if (
                currentIndex >= 0 &&
                currentIndex < audioFiles.length - 1
              ) {
                handleMtpPlay(audioFiles[currentIndex + 1]);
              } else {
                setPlayingFile(null);
                setAudioSrc(null);
                setAudioName('');
              }
            }}
          />
          <button
            type="button"
            className="player-close"
            onClick={stopMtpPlayback}
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
