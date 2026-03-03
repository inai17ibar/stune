import * as fs from 'fs';
import * as path from 'path';

// Known Walkman identifiers to detect
const WALKMAN_INDICATORS = ['WALKMAN', 'NW-A', 'NW-ZX', 'NW-WM', 'SONY'];

interface DetectedDevice {
  name: string;
  mountPath: string;
  isWalkman: boolean;
}

async function detectWalkmanVolumes(): Promise<DetectedDevice[]> {
  const volumesPath = '/Volumes';
  const devices: DetectedDevice[] = [];

  try {
    const entries = await fs.promises.readdir(volumesPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const mountPath = path.join(volumesPath, entry.name);

      // Check if it has a MUSIC folder (common Walkman indicator)
      const hasMusicFolder = await checkMusicFolder(mountPath);

      // Check if the volume name contains Walkman identifiers
      const nameMatch = WALKMAN_INDICATORS.some((indicator) =>
        entry.name.toUpperCase().includes(indicator)
      );

      if (nameMatch || hasMusicFolder) {
        devices.push({
          name: entry.name,
          mountPath,
          isWalkman: true,
        });
      }
    }
  } catch {
    // /Volumes not accessible (not on macOS or permission issue)
  }

  return devices;
}

async function checkMusicFolder(mountPath: string): Promise<boolean> {
  const musicPaths = ['MUSIC', 'Music'];
  for (const mp of musicPaths) {
    try {
      const fullPath = path.join(mountPath, mp);
      const stat = await fs.promises.stat(fullPath);
      if (stat.isDirectory()) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function getConnectedWalkman(): Promise<DetectedDevice[]> {
  return await detectWalkmanVolumes();
}

export function watchDevices(
  callback: (devices: DetectedDevice[]) => void
): void {
  // Poll /Volumes every 3 seconds for device changes
  let previousDevices: string[] = [];

  const check = async () => {
    const devices = await detectWalkmanVolumes();
    const currentPaths = devices.map((d) => d.mountPath).sort();

    if (JSON.stringify(currentPaths) !== JSON.stringify(previousDevices)) {
      previousDevices = currentPaths;
      callback(devices);
    }
  };

  // Initial check
  check();

  // Periodic polling
  setInterval(check, 3000);
}
