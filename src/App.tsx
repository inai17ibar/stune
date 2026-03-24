import { useEffect } from 'react';
import { useStore } from './stores/useStore';
import Sidebar from './components/Sidebar';
import LibraryView from './components/LibraryView';
import DeviceView from './components/DeviceView';
import AlbumView from './components/AlbumView';
import ArtistView from './components/ArtistView';
import TransferDialog from './components/TransferDialog';
import PlayerBar from './components/PlayerBar';
import Toolbar from './components/Toolbar';

export default function App() {
  const { viewMode, setDevices, setConnectionToast, transferJob } = useStore();
  const { setLibrary } = useStore();

  useEffect(() => {
    if (!window.stune) return;

    // Load persisted library on startup
    window.stune.loadLibraryDb().then((lib: any) => {
      if (lib) {
        setLibrary(lib);
      }
    });

    // Listen for device changes（接続検出時にトースト表示）
    const cleanup = window.stune.onDevicesChanged((devices: any[]) => {
      const prevCount = useStore.getState().devices.length;
      setDevices(devices);
      if (prevCount === 0 && devices.length >= 1) {
        const names = devices.map((d: { name: string }) => d.name).join('、');
        setConnectionToast(
          devices.length === 1
            ? `Walkman が接続されました（${names}）`
            : `Walkman が ${devices.length} 台接続されました`
        );
        setTimeout(() => setConnectionToast(null), 5000);
      }
    });

    // Initial device check
    window.stune.getDevices().then((devices: any[]) => {
      setDevices(devices);
    });

    return cleanup;
  }, [setDevices, setConnectionToast, setLibrary]);

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
            {viewMode === 'artists' && <ArtistView />}
          </div>
        </div>
      </div>
      <PlayerBar />
      {transferJob && <TransferDialog />}
    </div>
  );
}
