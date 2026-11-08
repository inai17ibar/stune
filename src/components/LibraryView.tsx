import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../stores/useStore';
import type { TrackMetadata, Album } from '../types';

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Returns `value` once it has stopped changing for `delayMs`.
 * An empty string is applied immediately so clearing the search feels instant.
 */
function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === '') {
      setDebounced('');
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export default function LibraryView() {
  // Granular selector subscriptions: this component re-renders only when one
  // of these values changes, not on unrelated store updates.
  const library = useStore((s) => s.library);
  const isScanning = useStore((s) => s.isScanning);
  const searchQuery = useStore((s) => s.searchQuery);
  const sortKey = useStore((s) => s.sortKey);
  const sortOrder = useStore((s) => s.sortOrder);
  const selectedCount = useStore((s) => s.selectedTracks.size);
  const nowPlayingPath = useStore((s) => s.nowPlaying?.filePath ?? null);
  const devices = useStore((s) => s.devices);
  const { setLibrary, clearSelection, playAlbum, setNowPlaying, setTransferJob } = useStore(
    useShallow((s) => ({
      setLibrary: s.setLibrary,
      clearSelection: s.clearSelection,
      playAlbum: s.playAlbum,
      setNowPlaying: s.setNowPlaying,
      setTransferJob: s.setTransferJob,
    }))
  );
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferTarget, setTransferTarget] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const debouncedQuery = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);

  const albumGroups = useMemo(() => {
    if (!library) return [];
    let albums = [...library.albums];

    if (debouncedQuery) {
      const q = debouncedQuery.toLowerCase();
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
  }, [library, debouncedQuery, sortKey, sortOrder]);

  const doTransfer = useCallback(
    async (sourcePaths: string[]) => {
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
    },
    [devices, transferTarget, setTransferJob]
  );

  const doDelete = useCallback(
    async (filePaths: string[], fromDisk: boolean) => {
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
    },
    [setLibrary, clearSelection]
  );

  // Stable per-album handlers: they take the album/track as arguments so the
  // same function instance is passed to every memoized AlbumSection.
  const handleTransferAlbum = useCallback(
    (album: Album) => doTransfer(album.tracks.map((t) => t.filePath)),
    [doTransfer]
  );

  const handleDeleteAlbum = useCallback(
    (album: Album, fromDisk: boolean) => {
      const paths = album.tracks.map((t) => t.filePath);
      const msg = fromDisk
        ? `アルバム「${album.name}」(${paths.length} 曲) をライブラリとディスクから完全に削除しますか？`
        : `アルバム「${album.name}」(${paths.length} 曲) をライブラリから削除しますか？`;
      if (!confirm(msg)) return;
      doDelete(paths, fromDisk);
    },
    [doDelete]
  );

  const handlePlayTrack = useCallback(
    (album: Album, track: TrackMetadata, index: number) => {
      // Read nowPlaying at call time so this callback doesn't depend on it
      // (otherwise every track change would give it a new identity).
      if (useStore.getState().nowPlaying?.filePath === track.filePath) {
        setNowPlaying(null);
      } else {
        playAlbum(album.tracks, index);
      }
    },
    [playAlbum, setNowPlaying]
  );

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
        <p>{debouncedQuery ? '該当するトラックがありません' : 'トラックがありません'}</p>
      </div>
    );
  }

  // Selection-bar handlers read the Set at click time; LibraryView itself only
  // subscribes to the selection count.
  const handleTransferSelected = () =>
    doTransfer(Array.from(useStore.getState().selectedTracks));

  const handleDeleteSelected = (fromDisk: boolean) => {
    const paths = Array.from(useStore.getState().selectedTracks);
    const msg = fromDisk
      ? `${paths.length} 曲をライブラリとディスクから完全に削除しますか？この操作は取り消せません。`
      : `${paths.length} 曲をライブラリから削除しますか？ファイルはディスクに残ります。`;
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
          {selectedCount > 0 && (
            <>
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={handleTransferSelected}
                disabled={isTransferring}
              >
                選択中の {selectedCount} 曲を転送
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
      {selectedCount > 0 && devices.length === 0 && (
        <div className="selection-action-bar">
          <span className="selection-count">{selectedCount} 曲を選択中</span>
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
            nowPlayingPath={nowPlayingPath}
            onPlayTrack={handlePlayTrack}
            showTransfer={devices.length > 0}
            isTransferring={isTransferring}
            onTransferAlbum={handleTransferAlbum}
            isDeleting={isDeleting}
            onDeleteAlbum={handleDeleteAlbum}
          />
        ))}
      </div>
    </div>
  );
}

const AlbumSection = memo(function AlbumSection({
  album,
  nowPlayingPath,
  onPlayTrack,
  showTransfer,
  isTransferring,
  onTransferAlbum,
  isDeleting,
  onDeleteAlbum,
}: {
  album: Album;
  nowPlayingPath: string | null;
  onPlayTrack: (album: Album, track: TrackMetadata, index: number) => void;
  showTransfer?: boolean;
  isTransferring?: boolean;
  onTransferAlbum?: (album: Album) => void;
  isDeleting?: boolean;
  onDeleteAlbum?: (album: Album, fromDisk: boolean) => void;
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
            {album.year && ' · '}
            {album.tracks.length} tracks
            {totalDuration > 0 && ` · ${formatDuration(totalDuration)}`}
          </p>
          <div className="album-section-actions">
            {showTransfer && onTransferAlbum && (
              <button
                type="button"
                className="btn btn-small btn-transfer-album"
                onClick={() => onTransferAlbum(album)}
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
                  onClick={() => onDeleteAlbum(album, false)}
                  disabled={isDeleting}
                  title="このアルバムをライブラリから削除（ファイルは残る）"
                >
                  &#x1F5D1; ライブラリから削除
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-ghost album-delete-btn btn-danger"
                  onClick={() => onDeleteAlbum(album, true)}
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
            album={album}
            track={track}
            index={i}
            isPlaying={nowPlayingPath === track.filePath}
            onPlayTrack={onPlayTrack}
          />
        ))}
      </div>
    </div>
  );
});

const AlbumTrackRow = memo(function AlbumTrackRow({
  album,
  track,
  index,
  isPlaying,
  onPlayTrack,
}: {
  album: Album;
  track: TrackMetadata;
  index: number;
  isPlaying: boolean;
  onPlayTrack: (album: Album, track: TrackMetadata, index: number) => void;
}) {
  // Boolean selector: this row re-renders only when its own selection flips,
  // not whenever the selectedTracks Set is replaced.
  const isSelected = useStore((s) => s.selectedTracks.has(track.filePath));
  const toggleTrackSelection = useStore((s) => s.toggleTrackSelection);
  const onToggle = () => toggleTrackSelection(track.filePath);
  const onPlay = () => onPlayTrack(album, track, index);

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
        {isPlaying ? '⏸' : '▶'}
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
});

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
