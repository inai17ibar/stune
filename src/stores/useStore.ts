import { create } from 'zustand';
import type {
  TrackMetadata,
  Album,
  Library,
  WalkmanDevice,
  ViewMode,
  SortKey,
  SortOrder,
  TransferJob,
} from '../types';

interface AppState {
  // View
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // Library
  library: Library | null;
  isScanning: boolean;
  errorMessage: string | null;
  setLibrary: (library: Library | null) => void;
  setIsScanning: (scanning: boolean) => void;
  setErrorMessage: (msg: string | null) => void;

  // Device
  devices: WalkmanDevice[];
  activeDevice: WalkmanDevice | null;
  setDevices: (devices: WalkmanDevice[]) => void;
  setActiveDevice: (device: WalkmanDevice | null) => void;

  // Selection
  selectedTracks: Set<string>;
  toggleTrackSelection: (filePath: string) => void;
  selectAllTracks: (filePaths: string[]) => void;
  clearSelection: () => void;

  // Sort
  sortKey: SortKey;
  sortOrder: SortOrder;
  setSortKey: (key: SortKey) => void;
  toggleSortOrder: () => void;

  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Transfer
  transferJob: TransferJob | null;
  setTransferJob: (job: TransferJob | null) => void;

  // Album filter
  selectedAlbum: Album | null;
  setSelectedAlbum: (album: Album | null) => void;
}

export const useStore = create<AppState>((set) => ({
  // View
  viewMode: 'library',
  setViewMode: (mode) => set({ viewMode: mode, selectedAlbum: null }),

  // Library
  library: null,
  isScanning: false,
  errorMessage: null,
  setLibrary: (library) => set({ library }),
  setIsScanning: (isScanning) => set({ isScanning }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),

  // Device
  devices: [],
  activeDevice: null,
  setDevices: (devices) => set({ devices }),
  setActiveDevice: (activeDevice) =>
    set({ activeDevice, viewMode: 'device' }),

  // Selection
  selectedTracks: new Set(),
  toggleTrackSelection: (filePath) =>
    set((state) => {
      const next = new Set(state.selectedTracks);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return { selectedTracks: next };
    }),
  selectAllTracks: (filePaths) =>
    set({ selectedTracks: new Set(filePaths) }),
  clearSelection: () => set({ selectedTracks: new Set() }),

  // Sort
  sortKey: 'title',
  sortOrder: 'asc',
  setSortKey: (sortKey) => set({ sortKey }),
  toggleSortOrder: () =>
    set((state) => ({
      sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc',
    })),

  // Search
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  // Transfer
  transferJob: null,
  setTransferJob: (transferJob) => set({ transferJob }),

  // Album filter
  selectedAlbum: null,
  setSelectedAlbum: (selectedAlbum) => set({ selectedAlbum }),
}));
