import { useMemo } from 'react';
import { useStore } from '../stores/useStore';
import type { TrackMetadata, SortKey, SortOrder } from '../types';

interface TrackListProps {
  tracks: TrackMetadata[];
}

export default function TrackList({ tracks }: TrackListProps) {
  const {
    selectedTracks,
    toggleTrackSelection,
    selectAllTracks,
    clearSelection,
    sortKey,
    sortOrder,
    searchQuery,
  } = useStore();

  const filteredAndSorted = useMemo(() => {
    let result = tracks;

    // Filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      const cmp = compareByKey(a, b, sortKey);
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [tracks, searchQuery, sortKey, sortOrder]);

  const allSelected =
    filteredAndSorted.length > 0 &&
    filteredAndSorted.every((t) => selectedTracks.has(t.filePath));

  const handleSelectAll = () => {
    if (allSelected) {
      clearSelection();
    } else {
      selectAllTracks(filteredAndSorted.map((t) => t.filePath));
    }
  };

  const handleContextMenu = (track: TrackMetadata) => {
    if (window.stune) {
      window.stune.showInFinder(track.filePath);
    }
  };

  if (filteredAndSorted.length === 0) {
    return (
      <div className="empty-state">
        <p>{searchQuery ? 'No matching tracks found' : 'No tracks'}</p>
      </div>
    );
  }

  return (
    <div className="track-list">
      <div className="track-list-header">
        <div className="track-col track-col-check">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={handleSelectAll}
          />
        </div>
        <div className="track-col track-col-title">Title</div>
        <div className="track-col track-col-artist">Artist</div>
        <div className="track-col track-col-album">Album</div>
        <div className="track-col track-col-duration">Duration</div>
        <div className="track-col track-col-format">Format</div>
      </div>

      <div className="track-list-body">
        {filteredAndSorted.map((track) => (
          <div
            key={track.filePath}
            className={`track-row ${selectedTracks.has(track.filePath) ? 'selected' : ''}`}
            onClick={() => toggleTrackSelection(track.filePath)}
            onDoubleClick={() => handleContextMenu(track)}
          >
            <div className="track-col track-col-check">
              <input
                type="checkbox"
                checked={selectedTracks.has(track.filePath)}
                onChange={() => toggleTrackSelection(track.filePath)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className="track-col track-col-title">
              <div className="track-title-cell">
                {track.coverArt && (
                  <img
                    className="track-thumb"
                    src={track.coverArt}
                    alt=""
                  />
                )}
                <span className="track-title-text">{track.title}</span>
              </div>
            </div>
            <div className="track-col track-col-artist">{track.artist}</div>
            <div className="track-col track-col-album">{track.album}</div>
            <div className="track-col track-col-duration">
              {formatDuration(track.duration)}
            </div>
            <div className="track-col track-col-format">
              <span className="format-badge">{track.format}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function compareByKey(
  a: TrackMetadata,
  b: TrackMetadata,
  key: SortKey
): number {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title);
    case 'artist':
      return a.artist.localeCompare(b.artist);
    case 'album':
      return a.album.localeCompare(b.album);
    case 'duration':
      return a.duration - b.duration;
    case 'year':
      return (a.year || 0) - (b.year || 0);
    default:
      return 0;
  }
}

function formatDuration(seconds: number): string {
  if (!seconds) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
