import { useEffect } from 'react';
import { useStore } from '../stores/useStore';

export default function TransferDialog() {
  const { transferJob, setTransferJob } = useStore();

  useEffect(() => {
    if (!window.stune) return;
    const cleanup = window.stune.onTransferProgress((progress) => {
      setTransferJob({
        id: transferJob?.id || '',
        source: '',
        destination: '',
        tracks: [],
        progress: progress.percentage,
        currentFile: progress.currentFile,
        status: progress.status,
        error: progress.error,
      });
    });
    return cleanup;
  }, [transferJob?.id, setTransferJob]);

  if (!transferJob) return null;

  const isComplete =
    transferJob.status === 'completed' || transferJob.status === 'error';

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <h3 className="dialog-title">
          {transferJob.status === 'completed'
            ? 'Transfer Complete'
            : transferJob.status === 'error'
              ? 'Transfer Error'
              : 'Transferring...'}
        </h3>

        {!isComplete && (
          <>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${transferJob.progress}%` }}
              />
            </div>
            <p className="progress-text">
              {transferJob.currentFile || 'Preparing...'}
            </p>
            <p className="progress-percent">{transferJob.progress}%</p>
          </>
        )}

        {transferJob.status === 'completed' && (
          <p className="dialog-message success">
            All files transferred successfully.
          </p>
        )}

        {transferJob.status === 'error' && (
          <p className="dialog-message error">{transferJob.error}</p>
        )}

        {isComplete && (
          <button
            className="btn btn-primary"
            onClick={() => setTransferJob(null)}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
