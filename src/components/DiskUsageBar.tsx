import type { WalkmanDevice } from '../types';

interface DiskUsageBarProps {
  device: WalkmanDevice;
}

export default function DiskUsageBar({ device }: DiskUsageBarProps) {
  const { totalSpace, usedSpace, freeSpace } = device;

  if (totalSpace === 0) return null;

  // Calculate music size from tracks
  const musicSize = device.tracks.reduce((sum, t) => sum + t.fileSize, 0);
  const otherSize = usedSpace - musicSize;

  const musicPercent = (musicSize / totalSpace) * 100;
  const otherPercent = (Math.max(0, otherSize) / totalSpace) * 100;
  const freePercent = (freeSpace / totalSpace) * 100;

  return (
    <div className="disk-usage">
      <div className="disk-bar">
        <div
          className="disk-segment music"
          style={{ width: `${musicPercent}%` }}
          title={`Music: ${formatSize(musicSize)}`}
        />
        <div
          className="disk-segment other"
          style={{ width: `${otherPercent}%` }}
          title={`Other: ${formatSize(Math.max(0, otherSize))}`}
        />
        <div
          className="disk-segment free"
          style={{ width: `${freePercent}%` }}
          title={`Free: ${formatSize(freeSpace)}`}
        />
      </div>
      <div className="disk-legend">
        <div className="legend-item">
          <span className="legend-dot music" />
          <span>Music ({formatSize(musicSize)})</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot other" />
          <span>Other ({formatSize(Math.max(0, otherSize))})</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot free" />
          <span>Free ({formatSize(freeSpace)})</span>
        </div>
        <div className="legend-item total">
          <span>Total: {formatSize(totalSpace)}</span>
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
