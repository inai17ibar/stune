import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../stores/useStore';
import DiskUsageBar from './DiskUsageBar';

interface MtpFileEntry {
  objectId: number;
  name: string;
  fullPath: string;
  size: number;
  isDir: boolean;
}

interface MtpStorageInfo {
  storageId: string;
  description: string;
  maxCapacity: number;
  freeSpaceInBytes: number;
}

interface MtpDeviceDetail {
  name: string;
  storages: MtpStorageInfo[];
  storageId: string;
}

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.wav', '.aac', '.m4a', '.alac', '.aiff', '.aif',
  '.ogg', '.wma', '.dsf', '.dff', '.opus',
]);

function isAudioFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

function getTrackNumber(name: string): number {
  const match = name.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 9999;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function DeviceView() {
  const { activeDevice, isScanning } = useStore();

  const [mtpDevice, setMtpDevice] = useState<MtpDeviceDetail | null>(null);
  const [activeStorageId, setActiveStorageId] = useState<string>('');
  const [currentPath, setCurrentPath] = useState('/Music');
  const [files, setFiles] = useState<MtpFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [playingFile, setPlayingFile] = useState<string | null>(null);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string>('');

  // MTP デバイス情報を取得
  useEffect(() => {
    if (!activeDevice || !window.stune) return;
    window.stune.mtpGetDevices().then((devices: MtpDeviceDetail[]) => {
      if (devices.length > 0) {
        const dev = devices[0];
        setMtpDevice(dev);
        // SD カード（2番目のストレージ）があればそちらをデフォルトに
        const defaultStorage = dev.storages.length > 1
          ? dev.storages[1].storageId
          : dev.storages[0].storageId;
        setActiveStorageId(defaultStorage);
      }
    });
  }, [activeDevice]);

  // ディレクトリ内容をフェッチ
  const browse = useCallback(async (storageId: string, dirPath: string) => {
    if (!window.stune) return;
    setLoading(true);
    try {
      const result = await window.stune.mtpBrowse(storageId, dirPath);
      setFiles(result || []);
    } catch (err) {
      console.error('Browse failed:', err);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeStorageId) {
      browse(activeStorageId, currentPath);
    }
  }, [activeStorageId, currentPath, browse]);

  // フォルダに入る
  const navigateTo = (dirPath: string) => {
    setCurrentPath(dirPath);
  };

  // パンくずリストのクリック
  const navigateToBreadcrumb = (index: number) => {
    const parts = currentPath.split('/').filter(Boolean);
    const newPath = '/' + parts.slice(0, index + 1).join('/');
    setCurrentPath(newPath);
  };

  // ルートに戻る
  const navigateToRoot = () => {
    setCurrentPath('/');
  };

  // ストレージ切り替え
  const switchStorage = (storageId: string) => {
    setActiveStorageId(storageId);
    setCurrentPath('/Music');
    setFiles([]);
  };

  // 再生
  const handlePlay = async (file: MtpFileEntry) => {
    if (!window.stune || downloadingFile) return;
    setDownloadingFile(file.fullPath);
    try {
      const localPath = await window.stune.mtpDownloadFile(activeStorageId, file.fullPath);
      if (localPath) {
        setAudioSrc(`stune-audio://${localPath}`);
        setAudioName(file.name.replace(/\.[^.]+$/, ''));
        setPlayingFile(file.fullPath);
      }
    } catch (err) {
      console.error('Download for playback failed:', err);
    } finally {
      setDownloadingFile(null);
    }
  };

  if (!activeDevice) {
    return (
      <div className="empty-state center">
        <div className="empty-icon">&#9654;</div>
        <h2>デバイスが選択されていません</h2>
        <p>
          Walkman を USB で接続し、データ転送モードにしたうえで
          <br />
          サイドバーの「WALKMAN」からデバイスを選んでください。
        </p>
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

  // パンくずリスト
  const pathParts = currentPath.split('/').filter(Boolean);

  // フォルダとファイルを分離
  const folders = files.filter((f) => f.isDir).sort((a, b) => a.name.localeCompare(b.name));
  const audioFiles = files
    .filter((f) => !f.isDir && isAudioFile(f.name))
    .sort((a, b) => getTrackNumber(a.name) - getTrackNumber(b.name));

  // 現在のストレージ情報
  const currentStorage = mtpDevice?.storages.find((s) => s.storageId === activeStorageId);

  return (
    <div className="device-view">
      <div className="view-header">
        <h2>{activeDevice.name}</h2>
      </div>

      <DiskUsageBar device={activeDevice} />

      {/* ストレージ選択タブ */}
      {mtpDevice && mtpDevice.storages.length > 1 && (
        <div className="storage-tabs">
          {mtpDevice.storages.map((s, i) => (
            <button
              key={s.storageId}
              className={`storage-tab ${s.storageId === activeStorageId ? 'active' : ''}`}
              onClick={() => switchStorage(s.storageId)}
            >
              {i === 0 ? '内蔵ストレージ' : 'SD カード'}
              <span className="storage-tab-size">{formatSize(s.maxCapacity)}</span>
            </button>
          ))}
        </div>
      )}

      {/* パンくずナビゲーション */}
      <div className="breadcrumb">
        <button className="breadcrumb-item" onClick={navigateToRoot}>
          {mtpDevice?.name || 'Device'}
        </button>
        {pathParts.map((part, i) => (
          <span key={i}>
            <span className="breadcrumb-sep">/</span>
            <button
              className={`breadcrumb-item ${i === pathParts.length - 1 ? 'current' : ''}`}
              onClick={() => navigateToBreadcrumb(i)}
            >
              {part}
            </button>
          </span>
        ))}
        {currentStorage && (
          <span className="breadcrumb-free">
            空き {formatSize(currentStorage.freeSpaceInBytes)}
          </span>
        )}
      </div>

      {loading ? (
        <div className="empty-state center">
          <div className="spinner large" />
          <p>読み込み中...</p>
        </div>
      ) : (
        <div className="device-browser">
          {/* フォルダ一覧 */}
          {folders.length > 0 && (
            <div className="folder-grid">
              {folders.map((f) => (
                <button
                  key={f.objectId}
                  className="folder-card"
                  onClick={() => navigateTo(f.fullPath)}
                >
                  <span className="folder-card-icon">&#128193;</span>
                  <span className="folder-card-name">{f.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* トラック一覧（iTunes風） */}
          {audioFiles.length > 0 && (
            <div className="track-list">
              <div className="track-list-header">
                <div className="track-col track-col-play-btn">&nbsp;</div>
                <div className="track-col track-col-num">#</div>
                <div className="track-col track-col-title">Title</div>
                <div className="track-col track-col-size">Size</div>
                <div className="track-col track-col-format">Format</div>
              </div>
              <div className="track-list-body">
                {audioFiles.map((file, index) => {
                  const trackNum = getTrackNumber(file.name);
                  const displayName = file.name
                    .replace(/\.[^.]+$/, '')
                    .replace(/^\d+[-\s]*/, '');
                  const ext = file.name.split('.').pop()?.toUpperCase() || '';
                  const isPlaying = playingFile === file.fullPath;
                  const isDownloading = downloadingFile === file.fullPath;

                  return (
                    <div
                      key={file.objectId}
                      className={`track-row ${isPlaying ? 'playing' : ''}`}
                      onDoubleClick={() => handlePlay(file)}
                    >
                      <div className="track-col track-col-play-btn">
                        {isDownloading ? (
                          <div className="spinner" />
                        ) : (
                          <button
                            className="play-btn"
                            onClick={() => handlePlay(file)}
                            title="再生"
                          >
                            {isPlaying ? '\u23F8' : '\u25B6'}
                          </button>
                        )}
                      </div>
                      <div className="track-col track-col-num">
                        {trackNum < 9999 ? trackNum : index + 1}
                      </div>
                      <div className="track-col track-col-title">
                        <span className="track-title-text">{displayName || file.name}</span>
                      </div>
                      <div className="track-col track-col-size">
                        {formatSize(file.size)}
                      </div>
                      <div className="track-col track-col-format">
                        <span className="format-badge">{ext}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {folders.length === 0 && audioFiles.length === 0 && (
            <div className="empty-state">
              <p>このフォルダは空です</p>
            </div>
          )}
        </div>
      )}

      {/* オーディオプレイヤー */}
      {audioSrc && (
        <div className="player-bar">
          <div className="player-info">
            <span className="player-now-playing">&#9835;</span>
            <span className="player-track-name">{audioName}</span>
          </div>
          <audio
            src={audioSrc}
            autoPlay
            controls
            onEnded={() => {
              // 次の曲を自動再生
              const currentIndex = audioFiles.findIndex((f) => f.fullPath === playingFile);
              if (currentIndex >= 0 && currentIndex < audioFiles.length - 1) {
                handlePlay(audioFiles[currentIndex + 1]);
              } else {
                setPlayingFile(null);
                setAudioSrc(null);
                setAudioName('');
              }
            }}
          />
          <button
            className="player-close"
            onClick={() => {
              setAudioSrc(null);
              setPlayingFile(null);
              setAudioName('');
            }}
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
