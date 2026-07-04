import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../stores/useStore';
import type { SyncPlanResult, SyncPlanTrack } from '../types';

interface SyncDialogProps {
  mountPath: string;
  deviceName: string;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function trackLabel(t: SyncPlanTrack): string {
  const title = t.title || t.fileName;
  return t.artist ? `${t.artist} — ${title}` : title;
}

export default function SyncDialog({ mountPath, deviceName, onClose }: SyncDialogProps) {
  const { activeDevice, setActiveDevice, setTransferJob } = useStore();

  const [plan, setPlan] = useState<SyncPlanResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteChecked, setDeleteChecked] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadPlan = useCallback(async () => {
    if (!window.stune) return;
    setPlan(null);
    setLoadError(null);
    setDeleteChecked(new Set());
    try {
      const result = await window.stune.computeSyncPlan(mountPath);
      setPlan(result);
    } catch (err: any) {
      setLoadError(`差分の計算に失敗しました: ${err?.message || err}`);
    }
  }, [mountPath]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  const transferSize = plan
    ? plan.toTransfer.reduce((sum, t) => sum + t.fileSize, 0)
    : 0;

  const handleTransfer = async () => {
    if (!window.stune || !plan || plan.toTransfer.length === 0) return;
    const paths = plan.toTransfer.map((t) => t.filePath);
    // Hand progress display over to the global TransferDialog
    setTransferJob({
      id: Date.now().toString(),
      source: 'library',
      destination: mountPath,
      tracks: [],
      progress: 0,
      currentFile: 'Preparing...',
      status: 'transferring',
    });
    onClose();
    try {
      await window.stune.copyTracksStructured(paths, mountPath);
    } catch (err) {
      console.error('Sync transfer failed:', err);
    }
  };

  const toggleDeleteChecked = (filePath: string) => {
    setDeleteChecked((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const toggleDeleteAll = () => {
    if (!plan) return;
    if (deleteChecked.size === plan.toDelete.length) {
      setDeleteChecked(new Set());
    } else {
      setDeleteChecked(new Set(plan.toDelete.map((t) => t.filePath)));
    }
  };

  const handleDelete = async () => {
    if (!window.stune || deleteChecked.size === 0) return;
    const paths = Array.from(deleteChecked);
    if (!confirm(`${paths.length} 曲を端末から削除しますか？この操作は取り消せません。`)) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await window.stune.deleteDeviceTracks(mountPath, paths);
      if (!result.success) {
        setDeleteError(`削除に失敗: ${result.errors.join(', ')}`);
      }
      if (result.device && activeDevice) {
        setActiveDevice({ ...activeDevice, ...result.device });
      }
      await loadPlan();
    } catch (err: any) {
      setDeleteError(`削除に失敗: ${err?.message || err}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog sync-dialog">
        <h3 className="dialog-title">同期プレビュー — {deviceName}</h3>

        {loadError && <p className="dialog-message error">{loadError}</p>}

        {!plan && !loadError && (
          <div className="sync-loading">
            <div className="spinner large" />
            <p>ライブラリと端末を比較しています...</p>
          </div>
        )}

        {plan && (
          <>
            <div className="sync-summary">
              <div className="sync-stat">
                <div className="sync-stat-value accent">{plan.toTransfer.length}</div>
                <div className="sync-stat-label">転送する曲</div>
              </div>
              <div className="sync-stat">
                <div className="sync-stat-value warning">{plan.toDelete.length}</div>
                <div className="sync-stat-label">削除候補</div>
              </div>
              <div className="sync-stat">
                <div className="sync-stat-value">{plan.matchedCount}</div>
                <div className="sync-stat-label">同期済み</div>
              </div>
            </div>

            {plan.toTransfer.length === 0 && plan.toDelete.length === 0 && (
              <p className="dialog-message success">
                ライブラリと端末は同期されています。
              </p>
            )}

            {plan.toTransfer.length > 0 && (
              <div className="sync-section">
                <div className="sync-section-title">
                  ライブラリ → 端末（{plan.toTransfer.length} 曲・{formatSize(transferSize)}）
                </div>
                <div className="sync-list">
                  {plan.toTransfer.map((t) => (
                    <div key={t.filePath} className="sync-row">
                      <span className="sync-row-title" title={trackLabel(t)}>
                        {trackLabel(t)}
                      </span>
                      <span className="sync-row-meta">{t.album}</span>
                      <span className="sync-row-meta">{formatSize(t.fileSize)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {plan.toDelete.length > 0 && (
              <div className="sync-section">
                <div className="sync-section-title">
                  ライブラリに無い曲（端末上・{plan.toDelete.length} 曲）
                  <button className="btn btn-small sync-select-all" onClick={toggleDeleteAll}>
                    {deleteChecked.size === plan.toDelete.length ? '選択解除' : 'すべて選択'}
                  </button>
                </div>
                <div className="sync-list">
                  {plan.toDelete.map((t) => (
                    <div key={t.filePath} className="sync-row">
                      <input
                        type="checkbox"
                        className="usb-checkbox"
                        checked={deleteChecked.has(t.filePath)}
                        onChange={() => toggleDeleteChecked(t.filePath)}
                      />
                      <span className="sync-row-title" title={trackLabel(t)}>
                        {trackLabel(t)}
                      </span>
                      <span className="sync-row-meta">{formatSize(t.fileSize)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {deleteError && <p className="dialog-message error">{deleteError}</p>}

            <div className="sync-dialog-actions">
              <button className="btn" onClick={onClose}>
                閉じる
              </button>
              {deleteChecked.size > 0 && (
                <button
                  className="btn btn-danger"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? '削除中...' : `🗑 ${deleteChecked.size} 曲を端末から削除`}
                </button>
              )}
              {plan.toTransfer.length > 0 && (
                <button className="btn btn-primary" onClick={handleTransfer}>
                  {plan.toTransfer.length} 曲を転送
                </button>
              )}
            </div>
          </>
        )}

        {!plan && loadError && (
          <div className="sync-dialog-actions">
            <button className="btn" onClick={onClose}>
              閉じる
            </button>
            <button className="btn btn-primary" onClick={loadPlan}>
              再試行
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
