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
  /** 接続検出時に表示するトースト（例: "Walkman が接続されました"） */
  connectionToast: string | null;
  setConnectionToast: (msg: string | null) => void;

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

  // Player
  nowPlaying: {
    filePath: string;
    title: string;
    artist: string;
    album: string;
    coverArt: string | null;
    duration: number;
  } | null;
  playlist: TrackMetadata[];
  setNowPlaying: (track: TrackMetadata | null) => void;
  playAlbum: (tracks: TrackMetadata[], startIndex?: number) => void;
  playNext: () => void;
  playPrev: () => void;
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
  connectionToast: null,
  setConnectionToast: (connectionToast) => set({ connectionToast }),

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

  // Player
  nowPlaying: null,
  playlist: [],
  setNowPlaying: (track) =>
    set({
      nowPlaying: track
        ? {
            filePath: track.filePath,
            title: track.title,
            artist: track.artist,
            album: track.album,
            coverArt: track.coverArt,
            duration: track.duration,
          }
        : null,
    }),
  playAlbum: (tracks, startIndex = 0) =>
    set({
      playlist: tracks,
      nowPlaying: tracks[startIndex]
        ? {
            filePath: tracks[startIndex].filePath,
            title: tracks[startIndex].title,
            artist: tracks[startIndex].artist,
            album: tracks[startIndex].album,
            coverArt: tracks[startIndex].coverArt,
            duration: tracks[startIndex].duration,
          }
        : null,
    }),
  playNext: () =>
    set((state) => {
      if (!state.nowPlaying || state.playlist.length === 0) return {};
      const idx = state.playlist.findIndex(
        (t) => t.filePath === state.nowPlaying!.filePath
      );
      const next = state.playlist[idx + 1];
      if (!next) return { nowPlaying: null };
      return {
        nowPlaying: {
          filePath: next.filePath,
          title: next.title,
          artist: next.artist,
          album: next.album,
          coverArt: next.coverArt,
          duration: next.duration,
        },
      };
    }),
  playPrev: () =>
    set((state) => {
      if (!state.nowPlaying || state.playlist.length === 0) return {};
      const idx = state.playlist.findIndex(
        (t) => t.filePath === state.nowPlaying!.filePath
      );
      const prev = state.playlist[idx - 1];
      if (!prev) return {};
      return {
        nowPlaying: {
          filePath: prev.filePath,
          title: prev.title,
          artist: prev.artist,
          album: prev.album,
          coverArt: prev.coverArt,
          duration: prev.duration,
        },
      };
    }),
}));
