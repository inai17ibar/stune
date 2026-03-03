import { useStore } from '../stores/useStore';
import TrackList from './TrackList';
import type { Album } from '../types';

export default function AlbumView() {
  const { library, selectedAlbum, setSelectedAlbum } = useStore();

  if (!library) {
    return (
      <div className="empty-state center">
        <p>No library loaded</p>
      </div>
    );
  }

  // Show album track list
  if (selectedAlbum) {
    return (
      <div className="album-detail-view">
        <div className="album-detail-header">
          <button
            className="btn btn-ghost back-btn"
            onClick={() => setSelectedAlbum(null)}
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
            </div>
          </div>
        </div>
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
            onClick={() => setSelectedAlbum(album)}
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
