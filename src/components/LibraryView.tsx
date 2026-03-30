import { useMemo, useState } from 'react';
import { useStore } from '../stores/useStore';
import type { TrackMetadata, Album } from '../types';

export default function LibraryView() {
  const {
    library,
    setLibrary,
    isScanning,
    searchQuery,
    sortKey,
    sortOrder,
    selectedTracks,
    toggleTrackSelection,
    clearSelection,
    nowPlaying,
    playAlbum,
    setNowPlaying,
    devices,
    setTransferJob,
  } = useStore();
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferTarget, setTransferTarget] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  const albumGroups = useMemo(() => {
    if (!library) return [];
    let albums = [...library.albums];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      albums = albums
        .map((album) => ({
          ...album,
          tracks: album.tracks.filter(
            (t) =>
              t.title.toLowerCase().includes(q) ||
              t.artist.toLowerCase().includes(q) ||
              t.album.toLowerCase().includes(q)
          ),
        }))
        .filter((a) => a.tracks.length > 0);
    }

    albums.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'artist':
          cmp = a.artist.localeCompare(b.artist);
          break;
        case 'album':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'year':
          cmp = (a.year || 0) - (b.year || 0);
          break;
        default:
          cmp = a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    albums.forEach((album) => {
      album.tracks.sort((a, b) => {
        const discA = a.discNumber || 1;
        const discB = b.discNumber || 1;
        if (discA !== discB) return discA - discB;
        return (a.trackNumber || 0) - (b.trackNumber || 0);
      });
    });

    return albums;
  }, [library, searchQuery, sortKey, sortOrder]);

  if (!library) {
    return (
      <div className="empty-state center">
        <div className="empty-icon">&#9835;</div>
        <h2>Welcome to sTunes</h2>
        <p>サイドバーから音楽フォルダを追加してください</p>
      </div>
    );
  }

  if (isScanning) {
    return (
      <div className="empty-state center">
        <div className="spinner large" />
        <p>ライブラリをスキャン中...</p>
      </div>
    );
  }

  if (albumGroups.length === 0) {
    return (
      <div className="empty-state center">
        <p>{searchQuery ? '該当するトラックがありません' : 'トラックがありません'}</p>
      </div>
    );
  }

  const doTransfer = async (sourcePaths: string[]) => {
    if (!window.stune || sourcePaths.length === 0 || devices.length === 0) return;
    const device = devices[transferTarget] || devices[0];

    setIsTransferring(true);
    setTransferJob({
      id: Date.now().toString(),
      source: 'library',
      destination: device.mountPath,
      tracks: [],
      progress: 0,
      currentFile: 'Preparing...',
      status: 'transferring',
    });

    try {
      await window.stune.copyTracksStructured(sourcePaths, device.mountPath);
    } catch (err: any) {
      console.error('Transfer failed:', err);
    } finally {
      setIsTransferring(false);
    }
  };

  const handleTransferSelected = () => doTransfer(Array.from(selectedTracks));
  const handleTransferAlbum = (album: Album) => doTransfer(album.tracks.map((t) => t.filePath));

  const doDelete = async (filePaths: string[], fromDisk: boolean) => {
    if (!window.stune || filePaths.length === 0) return;
    setIsDeleting(true);
    try {
      const result = await window.stune.deleteLibraryTracks(filePaths, fromDisk);
      if (result.library) setLibrary(result.library);
      clearSelection();
      if (result.errors.length > 0) {
        console.error('Delete errors:', result.errors);
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteSelected = (fromDisk: boolean) => {
    const paths = Array.from(selectedTracks);
    const msg = fromDisk
      ? `${paths.length} 曲をライブラリとディスクから完全に削除しますか？この操作は取り消せません。`
      : `${paths.length} 曲をライブラリから削除しますか？ファイルはディスクに残ります。`;
    if (!confirm(msg)) return;
    doDelete(paths, fromDisk);
  };

  const handleDeleteAlbum = (album: Album, fromDisk: boolean) => {
    const paths = album.tracks.map((t) => t.filePath);
    const msg = fromDisk
      ? `アルバム「${album.name}」(${paths.length} 曲) をライブラリとディスクから完全に削除しますか？`
      : `アルバム「${album.name}」(${paths.length} 曲) をライブラリから削除しますか？`;
    if (!confirm(msg)) return;
    doDelete(paths, fromDisk);
  };

  return (
    <div className="library-view">
      <div className="view-header">
        <h2>ライブラリ</h2>
        <span className="view-subtitle">
          {library.albums.length} albums / {library.tracks.length} tracks
        </span>
      </div>

      {/* Transfer bar - always visible when device connected */}
      {devices.length > 0 && (
        <div className="transfer-dest-bar">
          <span className="transfer-dest-label">転送先:</span>
          <select
            className="transfer-target-select"
            value={transferTarget}
            onChange={(e) => setTransferTarget(Number(e.target.value))}
            aria-label="Transfer destination"
          >
            {devices.map((d, i) => (
              <option key={d.mountPath} value={i}>{d.name}</option>
            ))}
          </select>
          {selectedTracks.size > 0 && (
            <>
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={handleTransferSelected}
                disabled={isTransferring}
              >
                選択中の {selectedTracks.size} 曲を転送
              </button>
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={() => handleDeleteSelected(false)}
                disabled={isDeleting}
              >
                ライブラリから削除
              </button>
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={() => handleDeleteSelected(true)}
                disabled={isDeleting}
              >
                ディスクから削除
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={clearSelection}
              >
                選択解除
              </button>
            </>
          )}
        </div>
      )}

      {/* Selection bar - when tracks selected and no device */}
      {selectedTracks.size > 0 && devices.length === 0 && (
        <div className="selection-action-bar">
          <span className="selection-count">{selectedTracks.size} 曲を選択中</span>
          <div className="selection-actions">
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={clearSelection}
            >
              選択解除
            </button>
            <button
              type="button"
              className="btn btn-small btn-danger"
              onClick={() => handleDeleteSelected(false)}
              disabled={isDeleting}
            >
              ライブラリから削除
            </button>
            <button
              type="button"
              className="btn btn-small btn-danger"
              onClick={() => handleDeleteSelected(true)}
              disabled={isDeleting}
            >
              ディスクから削除
            </button>
          </div>
        </div>
      )}

      <div className="album-track-list">
        {albumGroups.map((album) => (
          <AlbumSection
            key={`${album.artist}:::${album.name}`}
            album={album}
            selectedTracks={selectedTracks}
            onToggleTrack={toggleTrackSelection}
            nowPlayingPath={nowPlaying?.filePath || null}
            onPlayTrack={(track, index) => {
              if (nowPlaying?.filePath === track.filePath) {
                setNowPlaying(null);
              } else {
                playAlbum(album.tracks, index);
              }
            }}
            showTransfer={devices.length > 0}
            isTransferring={isTransferring}
            onTransferAlbum={() => handleTransferAlbum(album)}
            isDeleting={isDeleting}
            onDeleteAlbum={(fromDisk) => handleDeleteAlbum(album, fromDisk)}
          />
        ))}
      </div>
    </div>
  );
}

function AlbumSection({
  album,
  selectedTracks,
  onToggleTrack,
  nowPlayingPath,
  onPlayTrack,
  showTransfer,
  isTransferring,
  onTransferAlbum,
  isDeleting,
  onDeleteAlbum,
}: {
  album: Album;
  selectedTracks: Set<string>;
  onToggleTrack: (filePath: string) => void;
  nowPlayingPath: string | null;
  onPlayTrack: (track: TrackMetadata, index: number) => void;
  showTransfer?: boolean;
  isTransferring?: boolean;
  onTransferAlbum?: () => void;
  isDeleting?: boolean;
  onDeleteAlbum?: (fromDisk: boolean) => void;
}) {
  const totalDuration = album.tracks.reduce((sum, t) => sum + t.duration, 0);

  return (
    <div className="album-section">
      <div className="album-section-header">
        <div className="album-section-art">
          {album.coverArt ? (
            <img src={album.coverArt} alt={album.name} />
          ) : (
            <div className="album-section-art-placeholder">&#9835;</div>
          )}
        </div>
        <div className="album-section-info">
          <h3 className="album-section-title">{album.name}</h3>
          <p className="album-section-artist">{album.artist}</p>
          <p className="album-section-meta">
            {album.year && <span>{album.year}</span>}
            {album.year && ' \u00B7 '}
            {album.tracks.length} tracks
            {totalDuration > 0 && ` \u00B7 ${formatDuration(totalDuration)}`}
          </p>
          <div className="album-section-actions">
            {showTransfer && onTransferAlbum && (
              <button
                type="button"
                className="btn btn-small btn-transfer-album"
                onClick={onTransferAlbum}
                disabled={isTransferring}
                title="このアルバムをWalkmanに転送"
              >
                &#x27A1; Walkmanに転送
              </button>
            )}
            {onDeleteAlbum && (
              <>
                <button
                  type="button"
                  className="btn btn-small btn-ghost album-delete-btn"
                  onClick={() => onDeleteAlbum(false)}
                  disabled={isDeleting}
                  title="このアルバムをライブラリから削除（ファイルは残る）"
                >
                  &#x1F5D1; ライブラリから削除
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-ghost album-delete-btn btn-danger"
                  onClick={() => onDeleteAlbum(true)}
                  disabled={isDeleting}
                  title="このアルバムをライブラリとディスクから完全に削除"
                >
                  &#x1F5D1; ディスクから削除
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="album-section-tracks">
        {album.tracks.map((track, i) => (
          <AlbumTrackRow
            key={track.filePath}
            track={track}
            isSelected={selectedTracks.has(track.filePath)}
            isPlaying={nowPlayingPath === track.filePath}
            onToggle={() => onToggleTrack(track.filePath)}
            onPlay={() => onPlayTrack(track, i)}
          />
        ))}
      </div>
    </div>
  );
}

function AlbumTrackRow({
  track,
  isSelected,
  isPlaying,
  onToggle,
  onPlay,
}: {
  track: TrackMetadata;
  isSelected: boolean;
  isPlaying: boolean;
  onToggle: () => void;
  onPlay: () => void;
}) {
  return (
    <div
      className={`album-track-row ${isSelected ? 'selected' : ''} ${isPlaying ? 'playing' : ''}`}
      onDoubleClick={onPlay}
    >
      <input
        type="checkbox"
        className="track-checkbox"
        checked={isSelected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${track.title}`}
      />
      <button
        type="button"
        className="track-play-btn"
        onClick={(e) => { e.stopPropagation(); onPlay(); }}
        title="Play"
      >
        {isPlaying ? '\u23F8' : '\u25B6'}
      </button>
      <span className="album-track-num">
        {track.trackNumber || '-'}
      </span>
      <span className="album-track-title">{track.title}</span>
      <span className="album-track-artist">{track.artist}</span>
      <span className="album-track-duration">
        {formatDuration(track.duration)}
      </span>
      <span className="album-track-format">
        <span className="format-badge">{track.format}</span>
      </span>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!seconds) return '--:--';
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
