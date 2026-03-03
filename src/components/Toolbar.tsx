import { useStore } from '../stores/useStore';

export default function Toolbar() {
  const {
    searchQuery,
    setSearchQuery,
    selectedTracks,
    clearSelection,
    sortKey,
    setSortKey,
    sortOrder,
    toggleSortOrder,
    viewMode,
    library,
    activeDevice,
    setTransferJob,
  } = useStore();

  const hasSelection = selectedTracks.size > 0;

  const handleCopyToDevice = () => {
    if (!activeDevice || selectedTracks.size === 0) return;
    handleTransfer(activeDevice.musicPath);
  };

  const handleCopyToLibrary = () => {
    if (!library || selectedTracks.size === 0) return;
    handleTransfer(library.rootPath);
  };

  const handleTransfer = async (destinationDir: string) => {
    if (!window.stune) return;
    const sourcePaths = Array.from(selectedTracks);

    setTransferJob({
      id: Date.now().toString(),
      source: sourcePaths[0],
      destination: destinationDir,
      tracks: [],
      progress: 0,
      currentFile: '',
      status: 'pending',
    });

    try {
      const result = await window.stune.copyTracks(sourcePaths, destinationDir);
      setTransferJob({
        id: Date.now().toString(),
        source: '',
        destination: destinationDir,
        tracks: [],
        progress: 100,
        currentFile: '',
        status: result.success ? 'completed' : 'error',
        error: result.errors.join('\n'),
      });
    } catch (err: any) {
      setTransferJob({
        id: Date.now().toString(),
        source: '',
        destination: destinationDir,
        tracks: [],
        progress: 0,
        currentFile: '',
        status: 'error',
        error: err.message,
      });
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="search-box">
          <span className="search-icon">&#128269;</span>
          <input
            type="text"
            placeholder="Search tracks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="search-clear"
              onClick={() => setSearchQuery('')}
            >
              x
            </button>
          )}
        </div>
      </div>

      <div className="toolbar-center">
        {hasSelection && (
          <div className="selection-actions">
            <span className="selection-count">
              {selectedTracks.size} selected
            </span>

            {viewMode === 'library' && activeDevice && (
              <button
                className="btn btn-primary"
                onClick={handleCopyToDevice}
                title="Copy to Walkman"
              >
                &#8594; Walkman
              </button>
            )}

            {viewMode === 'device' && library && (
              <button
                className="btn btn-primary"
                onClick={handleCopyToLibrary}
                title="Copy to Library"
              >
                &#8592; Library
              </button>
            )}

            <button className="btn btn-ghost" onClick={clearSelection}>
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="toolbar-right">
        <select
          className="sort-select"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as any)}
        >
          <option value="title">Title</option>
          <option value="artist">Artist</option>
          <option value="album">Album</option>
          <option value="duration">Duration</option>
          <option value="year">Year</option>
        </select>
        <button className="btn-icon" onClick={toggleSortOrder}>
          {sortOrder === 'asc' ? '\u2191' : '\u2193'}
        </button>
      </div>
    </div>
  );
}
