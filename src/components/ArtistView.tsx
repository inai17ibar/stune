import { useMemo, useState } from 'react';
import { useStore } from '../stores/useStore';
import TrackList from './TrackList';
import type { Album } from '../types';

export default function ArtistView() {
  const {
    library,
    setLibrary,
    searchQuery,
    devices,
    selectedTracks,
    clearSelection,
    setTransferJob,
  } = useStore();
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedAlbumInArtist, setSelectedAlbumInArtist] = useState<Album | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferTarget, setTransferTarget] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  const artists = useMemo(() => {
    if (!library) return [];
    const map = new Map<string, { albums: Album[]; trackCount: number }>();
    for (const album of library.albums) {
      const artist = album.artist || 'Unknown Artist';
      if (!map.has(artist)) map.set(artist, { albums: [], trackCount: 0 });
      const entry = map.get(artist)!;
      entry.albums.push(album);
      entry.trackCount += album.tracks.length;
    }
    let entries = Array.from(map.entries()).map(([name, data]) => ({
      name,
      ...data,
      coverArt: data.albums.find((a) => a.coverArt)?.coverArt || null,
    }));

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      entries = entries.filter((a) => a.name.toLowerCase().includes(q));
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries;
  }, [library, searchQuery]);

  if (!library) {
    return (
      <div className="empty-state center">
        <p>ライブラリが読み込まれていません</p>
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
        if (selectedAlbumInArtist) {
          const remaining = selectedAlbumInArtist.tracks.filter(
            (t) => !filePaths.includes(t.filePath)
          );
          if (remaining.length === 0) {
            setSelectedAlbumInArtist(null);
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
    if (!selectedAlbumInArtist) return;
    doTransfer(selectedAlbumInArtist.tracks.map((t) => t.filePath));
  };

  const handleTransferArtist = () => {
    const artist = artists.find((a) => a.name === selectedArtist);
    if (!artist) return;
    const paths = artist.albums.flatMap((a) => a.tracks.map((t) => t.filePath));
    doTransfer(paths);
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
    if (!selectedAlbumInArtist) return;
    const paths = selectedAlbumInArtist.tracks.map((t) => t.filePath);
    const msg = fromDisk
      ? `アルバム「${selectedAlbumInArtist.name}」(${paths.length} 曲) をライブラリとディスクから完全に削除しますか？`
      : `アルバム「${selectedAlbumInArtist.name}」(${paths.length} 曲) をライブラリから削除しますか？`;
    if (!confirm(msg)) return;
    doDelete(paths, fromDisk);
  };

  const handleDeleteArtist = (fromDisk: boolean) => {
    const artist = artists.find((a) => a.name === selectedArtist);
    if (!artist) return;
    const paths = artist.albums.flatMap((a) => a.tracks.map((t) => t.filePath));
    const msg = fromDisk
      ? `アーティスト「${artist.name}」(${paths.length} 曲) をライブラリとディスクから完全に削除しますか？`
      : `アーティスト「${artist.name}」(${paths.length} 曲) をライブラリから削除しますか？`;
    if (!confirm(msg)) return;
    doDelete(paths, fromDisk);
  };

  // Artist > Album > Tracks
  if (selectedArtist && selectedAlbumInArtist) {
    return (
      <div className="album-detail-view">
        <div className="album-detail-header">
          <button
            className="btn btn-ghost back-btn"
            onClick={() => { setSelectedAlbumInArtist(null); clearSelection(); }}
          >
            &#8592; {selectedArtist}
          </button>
          <div className="album-detail-info">
            {selectedAlbumInArtist.coverArt ? (
              <img
                className="album-detail-cover"
                src={selectedAlbumInArtist.coverArt}
                alt={selectedAlbumInArtist.name}
              />
            ) : (
              <div className="album-detail-cover placeholder">&#9835;</div>
            )}
            <div className="album-detail-text">
              <h2>{selectedAlbumInArtist.name}</h2>
              <p className="album-detail-artist">{selectedAlbumInArtist.artist}</p>
              <p className="album-detail-meta">
                {selectedAlbumInArtist.year && `${selectedAlbumInArtist.year} · `}
                {selectedAlbumInArtist.tracks.length} tracks
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

        <TrackList tracks={selectedAlbumInArtist.tracks} />
      </div>
    );
  }

  // Artist > Albums list
  if (selectedArtist) {
    const artist = artists.find((a) => a.name === selectedArtist);
    if (!artist) return null;

    return (
      <div className="artist-detail-view">
        <div className="view-header">
          <button
            className="btn btn-ghost back-btn"
            onClick={() => { setSelectedArtist(null); clearSelection(); }}
          >
            &#8592; Artists
          </button>
          <h2>{artist.name}</h2>
          <span className="view-subtitle">
            {artist.albums.length} albums / {artist.trackCount} tracks
          </span>
          <div className="artist-detail-actions">
            {devices.length > 0 && (
              <button
                type="button"
                className="btn btn-small btn-primary"
                onClick={handleTransferArtist}
                disabled={isTransferring}
              >
                &#x27A1; 全曲をWalkmanに転送
              </button>
            )}
            <button
              type="button"
              className="btn btn-small btn-ghost album-delete-btn"
              onClick={() => handleDeleteArtist(false)}
              disabled={isDeleting}
            >
              ライブラリから削除
            </button>
            <button
              type="button"
              className="btn btn-small btn-ghost album-delete-btn btn-danger"
              onClick={() => handleDeleteArtist(true)}
              disabled={isDeleting}
            >
              ディスクから削除
            </button>
          </div>
        </div>
        <div className="album-grid">
          {artist.albums.map((album) => (
            <div
              key={album.name}
              className="album-card"
              onClick={() => { setSelectedAlbumInArtist(album); clearSelection(); }}
            >
              {album.coverArt ? (
                <img className="album-cover" src={album.coverArt} alt={album.name} />
              ) : (
                <div className="album-cover placeholder">&#9835;</div>
              )}
              <div className="album-info">
                <p className="album-name">{album.name}</p>
                <p className="album-artist">
                  {album.year || ''}
                  {album.year && ' \u00B7 '}
                  {album.tracks.length} tracks
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="artist-view">
      <div className="view-header">
        <h2>Artists</h2>
        <span className="view-subtitle">{artists.length} artists</span>
      </div>
      <div className="artist-grid">
        {artists.map((artist) => (
          <div
            key={artist.name}
            className="artist-card"
            onClick={() => setSelectedArtist(artist.name)}
          >
            <div className="artist-card-avatar">
              {artist.coverArt ? (
                <img src={artist.coverArt} alt={artist.name} />
              ) : (
                <div className="artist-card-placeholder">&#9834;</div>
              )}
            </div>
            <div className="artist-card-info">
              <p className="artist-card-name">{artist.name}</p>
              <p className="artist-card-meta">
                {artist.albums.length} albums / {artist.trackCount} tracks
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
