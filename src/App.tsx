import { useEffect } from 'react';
import { useStore } from './stores/useStore';
import Sidebar from './components/Sidebar';
import LibraryView from './components/LibraryView';
import DeviceView from './components/DeviceView';
import AlbumView from './components/AlbumView';
import TransferDialog from './components/TransferDialog';
import Toolbar from './components/Toolbar';

export default function App() {
  const { viewMode, setDevices, transferJob } = useStore();

  useEffect(() => {
    // Listen for device changes from Electron
    if (window.stune) {
      const cleanup = window.stune.onDevicesChanged((devices) => {
        setDevices(devices);
      });

      // Initial device check
      window.stune.getDevices().then((devices) => {
        setDevices(devices);
      });

      return cleanup;
    }
  }, [setDevices]);

  return (
    <div className="app">
      <div className="titlebar-drag" />
      <div className="app-layout">
        <Sidebar />
        <div className="main-content">
          <Toolbar />
          <div className="content-area">
            {viewMode === 'library' && <LibraryView />}
            {viewMode === 'device' && <DeviceView />}
            {viewMode === 'albums' && <AlbumView />}
          </div>
        </div>
      </div>
      {transferJob && <TransferDialog />}
    </div>
  );
}
