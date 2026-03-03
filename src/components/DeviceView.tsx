import { useStore } from '../stores/useStore';
import TrackList from './TrackList';
import DiskUsageBar from './DiskUsageBar';

export default function DeviceView() {
  const { activeDevice, isScanning } = useStore();

  if (!activeDevice) {
    return (
      <div className="empty-state center">
        <div className="empty-icon">&#9654;</div>
        <h2>No Device Selected</h2>
        <p>Connect your Walkman and select it from the sidebar.</p>
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

  return (
    <div className="device-view">
      <div className="view-header">
        <h2>{activeDevice.name}</h2>
        <span className="view-subtitle">{activeDevice.mountPath}</span>
      </div>

      <DiskUsageBar device={activeDevice} />

      <div className="device-stats">
        <div className="stat">
          <span className="stat-value">{activeDevice.tracks.length}</span>
          <span className="stat-label">Tracks</span>
        </div>
        <div className="stat">
          <span className="stat-value">{activeDevice.albums.length}</span>
          <span className="stat-label">Albums</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {formatSize(activeDevice.freeSpace)}
          </span>
          <span className="stat-label">Free Space</span>
        </div>
      </div>

      <TrackList tracks={activeDevice.tracks} />
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
