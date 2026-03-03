import { useStore } from '../stores/useStore';
import TrackList from './TrackList';

export default function LibraryView() {
  const { library, isScanning } = useStore();

  if (!library) {
    return (
      <div className="empty-state center">
        <div className="empty-icon">&#9835;</div>
        <h2>Welcome to sTune</h2>
        <p>Select a music folder from the sidebar to get started.</p>
      </div>
    );
  }

  if (isScanning) {
    return (
      <div className="empty-state center">
        <div className="spinner large" />
        <p>Scanning music library...</p>
      </div>
    );
  }

  return (
    <div className="library-view">
      <div className="view-header">
        <h2>Music Library</h2>
        <span className="view-subtitle">{library.rootPath}</span>
      </div>
      <TrackList tracks={library.tracks} />
    </div>
  );
}
