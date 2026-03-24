# sTunes - Development Guide

## Overview
sTunes is a music manager for Mac and Sony Walkman (NW-A300 series etc.), built with Electron + React + TypeScript.

## Architecture

### Tech Stack
- **Renderer**: React 19 + Zustand (state) + Vite 7 (bundler)
- **Main Process**: Electron 33 + TypeScript (compiled separately)
- **MTP Support**: Custom Go CLI (`native/mtp-cli/`) for non-mountable Walkman models
- **Audio Playback**: Custom `stune-audio://` protocol serving local files

### Directory Structure
```
electron/           # Electron main process code
  main.ts           # Entry point, IPC handlers, window management
  preload.ts        # Context bridge (renderer <-> main IPC)
  services/
    library.ts      # Folder scanning
    libraryDb.ts    # Persistent JSON library DB (~/.config/sTunes/sTuneLibrary.json)
    device.ts       # Walkman USB volume detection + polling
    mtp.ts          # MTP device communication via mtp-cli binary
    metadata.ts     # Audio metadata reading (music-metadata)
    transfer.ts     # File copy with progress
src/                # React renderer
  App.tsx           # Root component
  components/
    Sidebar.tsx     # Navigation, folder management, drag & drop
    LibraryView.tsx # Album-grouped track list (main view)
    AlbumView.tsx   # Album grid → album detail with TrackList
    ArtistView.tsx  # Artist grid → albums → TrackList
    DeviceView.tsx  # Connected Walkman browser
    TrackList.tsx   # Reusable track table with play/select
    PlayerBar.tsx   # Global audio player bar
    Toolbar.tsx     # Search and sort controls
    TransferDialog.tsx
  stores/useStore.ts  # Zustand global state
  types/index.ts      # TypeScript interfaces
  global.d.ts         # Window.stune API types
  styles/global.css   # All styles (single file)
native/mtp-cli/     # Go MTP CLI tool
scripts/
  dev.sh            # Launch dev mode from Terminal.app
  setup.sh          # Build mtp-cli and install dependencies
```

### IPC Communication
All renderer ↔ main process communication goes through `contextBridge` in `preload.ts`.
- Add new IPC: (1) handler in `main.ts`, (2) bridge in `preload.ts`, (3) type in `global.d.ts`

### State Management
Single Zustand store (`useStore.ts`) with sections: View, Library, Device, Selection, Sort, Search, Transfer, Player.

## Critical Rules

### React Hooks — DO NOT violate hook ordering
**Every `useState`, `useMemo`, `useCallback`, `useEffect` must be called BEFORE any early return.**
Placing a hook after an `if (...) return` causes "Rendered more hooks than during the previous render" which crashes the renderer and shows a BLACK SCREEN with no useful error.

Pattern to follow:
```tsx
function MyComponent() {
  // ALL hooks first
  const [state, setState] = useState(initialValue);
  const memoized = useMemo(() => ..., [deps]);

  // THEN early returns
  if (!data) return <Empty />;

  // THEN regular logic and JSX
  return <div>...</div>;
}
```

### ELECTRON_RUN_AS_NODE
Claude Code / VSCode sets `ELECTRON_RUN_AS_NODE=1` in the shell environment. This makes `electron` behave as Node.js instead of a GUI app. **It must be fully removed (not just set to empty string):**
- Use `env -u ELECTRON_RUN_AS_NODE electron .`
- Or `unset ELECTRON_RUN_AS_NODE` before running
- Setting to empty string (`ELECTRON_RUN_AS_NODE=`) does NOT work — Electron checks existence, not value

### music-metadata ESM Import
`music-metadata` v11+ is ESM-only. Since Electron main process is compiled as CJS, use the dynamic import workaround:
```typescript
const dynamicImport = new Function('specifier', 'return import(specifier)');
const mm = await dynamicImport('music-metadata');
```

## Development

### Running in dev mode
From **Terminal.app** (not VSCode terminal):
```bash
cd ~/src/stunes && bash scripts/dev.sh
```
Or use the npm script (also needs Terminal.app for GUI):
```bash
npm run electron:dev
```

### Build
```bash
npm run electron:build
```

### Type Checking
```bash
# Renderer (React)
npx tsc --noEmit

# Electron main process
npx tsc -p tsconfig.electron.json
```

## Library Database
- Persistent JSON file at `{userData}/sTuneLibrary.json`
- Tracks keyed by absolute file path
- Incremental scan: skips files with unchanged mtime (unless metadata is all defaults)
- Custom metadata (rating, tags, playCount) preserved across rescans

## Device Detection
- USB: Polls `/Volumes` every 3 seconds for Walkman-named or MUSIC-folder volumes
- MTP: Uses `mtp-cli` binary (Go) for non-mountable devices
- SD cards detected by volume name patterns (SD_CARD, SDCARD, etc.)

## Transfer
- Structured copy: `MUSIC/Artist/Album/filename` directory hierarchy
- Supports both USB-mounted and MTP devices
- Progress events sent via IPC to renderer
