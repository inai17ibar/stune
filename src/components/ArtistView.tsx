import { useMemo, useState } from 'react';
import { useStore } from '../stores/useStore';
import TrackList from './TrackList';
import type { Album } from '../types';

export default function ArtistView() {
  const { library, searchQuery } = useStore();
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedAlbumInArtist, setSelectedAlbumInArtist] = useState<Album | null>(null);

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

  // Artist > Album > Tracks
  if (selectedArtist && selectedAlbumInArtist) {
    return (
      <div className="album-detail-view">
        <div className="album-detail-header">
          <button
            className="btn btn-ghost back-btn"
            onClick={() => setSelectedAlbumInArtist(null)}
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
            </div>
          </div>
        </div>
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
            onClick={() => setSelectedArtist(null)}
          >
            &#8592; Artists
          </button>
          <h2>{artist.name}</h2>
          <span className="view-subtitle">
            {artist.albums.length} albums / {artist.trackCount} tracks
          </span>
        </div>
        <div className="album-grid">
          {artist.albums.map((album) => (
            <div
              key={album.name}
              className="album-card"
              onClick={() => setSelectedAlbumInArtist(album)}
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
