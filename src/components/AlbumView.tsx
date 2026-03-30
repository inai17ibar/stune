import { useState } from 'react';
import { useStore } from '../stores/useStore';
import TrackList from './TrackList';
import type { Album } from '../types';

export default function AlbumView() {
  const {
    library,
    setLibrary,
    selectedAlbum,
    setSelectedAlbum,
    devices,
    selectedTracks,
    clearSelection,
    setTransferJob,
  } = useStore();
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferTarget, setTransferTarget] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  if (!library) {
    return (
      <div className="empty-state center">
        <p>No library loaded</p>
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

  const doDelete = async (filePaths: string[], fromDisk: boolean) => {
    if (!window.stune || filePaths.length === 0) return;
    setIsDeleting(true);
    try {
      const result = await window.stune.deleteLibraryTracks(filePaths, fromDisk);
      if (result.library) {
        setLibrary(result.library);
        // If we deleted the entire selected album, go back to grid
        if (selectedAlbum) {
          const remaining = selectedAlbum.tracks.filter(
            (t) => !filePaths.includes(t.filePath)
          );
          if (remaining.length === 0) {
            setSelectedAlbum(null);
          }
        }
      }
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

  const handleTransferSelected = () => doTransfer(Array.from(selectedTracks));
  const handleTransferAlbum = () => {
    if (!selectedAlbum) return;
    doTransfer(selectedAlbum.tracks.map((t) => t.filePath));
  };

  const handleDeleteSelected = (fromDisk: boolean) => {
    const paths = Array.from(selectedTracks);
    const msg = fromDisk
      ? `${paths.length} 曲をライブラリとディスクから完全に削除しますか？この操作は取り消せません。`
      : `${paths.length} 曲をライブラリから削除しますか？ファイルはディスクに残ります。`;
    if (!confirm(msg)) return;
    doDelete(paths, fromDisk);
  };

  const handleDeleteAlbum = (fromDisk: boolean) => {
    if (!selectedAlbum) return;
    const paths = selectedAlbum.tracks.map((t) => t.filePath);
    const msg = fromDisk
      ? `アルバム「${selectedAlbum.name}」(${paths.length} 曲) をライブラリとディスクから完全に削除しますか？`
      : `アルバム「${selectedAlbum.name}」(${paths.length} 曲) をライブラリから削除しますか？`;
    if (!confirm(msg)) return;
    doDelete(paths, fromDisk);
  };

  // Show album track list
  if (selectedAlbum) {
    return (
      <div className="album-detail-view">
        <div className="album-detail-header">
          <button
            className="btn btn-ghost back-btn"
            onClick={() => { setSelectedAlbum(null); clearSelection(); }}
          >
            &#8592; Albums
          </button>
          <div className="album-detail-info">
            {selectedAlbum.coverArt ? (
              <img
                className="album-detail-cover"
                src={selectedAlbum.coverArt}
                alt={selectedAlbum.name}
              />
            ) : (
              <div className="album-detail-cover placeholder">&#9835;</div>
            )}
            <div className="album-detail-text">
              <h2>{selectedAlbum.name}</h2>
              <p className="album-detail-artist">{selectedAlbum.artist}</p>
              <p className="album-detail-meta">
                {selectedAlbum.year && `${selectedAlbum.year} · `}
                {selectedAlbum.tracks.length} tracks
              </p>
              <div className="album-detail-actions">
                {devices.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-small btn-primary"
                    onClick={handleTransferAlbum}
                    disabled={isTransferring}
                  >
                    &#x27A1; Walkmanに転送
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-small btn-ghost album-delete-btn"
                  onClick={() => handleDeleteAlbum(false)}
                  disabled={isDeleting}
                >
                  ライブラリから削除
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-ghost album-delete-btn btn-danger"
                  onClick={() => handleDeleteAlbum(true)}
                  disabled={isDeleting}
                >
                  ディスクから削除
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Selection action bar */}
        {selectedTracks.size > 0 && (
          <div className="selection-action-bar">
            <span className="selection-count">{selectedTracks.size} 曲を選択中</span>
            <div className="selection-actions">
              {devices.length > 0 && (
                <>
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
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={handleTransferSelected}
                    disabled={isTransferring}
                  >
                    選択中の {selectedTracks.size} 曲を転送
                  </button>
                </>
              )}
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
            </div>
          </div>
        )}

        <TrackList tracks={selectedAlbum.tracks} />
      </div>
    );
  }

  // Show album grid
  return (
    <div className="album-view">
      <div className="view-header">
        <h2>Albums</h2>
        <span className="view-subtitle">
          {library.albums.length} albums
        </span>
      </div>
      <div className="album-grid">
        {library.albums.map((album) => (
          <AlbumCard
            key={`${album.artist}-${album.name}`}
            album={album}
            onClick={() => { setSelectedAlbum(album); clearSelection(); }}
          />
        ))}
      </div>
    </div>
  );
}

function AlbumCard({
  album,
  onClick,
}: {
  album: Album;
  onClick: () => void;
}) {
  return (
    <div className="album-card" onClick={onClick}>
      {album.coverArt ? (
        <img className="album-cover" src={album.coverArt} alt={album.name} />
      ) : (
        <div className="album-cover placeholder">&#9835;</div>
      )}
      <div className="album-info">
        <p className="album-name">{album.name}</p>
        <p className="album-artist">{album.artist}</p>
      </div>
    </div>
  );
}
