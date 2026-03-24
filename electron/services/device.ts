import * as fs from 'fs';
import * as path from 'path';
import { getMtpDevices, isMtpCliAvailable } from './mtp';

// Known Walkman identifiers to detect
const WALKMAN_INDICATORS = ['WALKMAN', 'NW-A', 'NW-ZX', 'NW-WM', 'SONY'];
// SD card volume names commonly used with Walkman
const SD_CARD_INDICATORS = ['SD_CARD', 'SDCARD', 'SD CARD', 'MICROSD'];

export interface DetectedDevice {
  name: string;
  mountPath: string;
  isWalkman: boolean;
  /** true の場合は MTP デバイス（転送時は mtp サービスを使用） */
  isMtp?: boolean;
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
      const upperName = entry.name.toUpperCase();
      const nameMatch = WALKMAN_INDICATORS.some((indicator) =>
        upperName.includes(indicator)
      );
      const isSdCard = SD_CARD_INDICATORS.some((indicator) =>
        upperName.includes(indicator)
      );

      if (nameMatch || hasMusicFolder || isSdCard) {
        const displayName = isSdCard && !nameMatch
          ? `${entry.name} (SD Card)`
          : entry.name;
        devices.push({
          name: displayName,
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

/** USB マウント + MTP デバイスをまとめて返す */
export async function getConnectedWalkman(): Promise<DetectedDevice[]> {
  const usb = await detectWalkmanVolumes();
  if (!isMtpCliAvailable()) return usb;
  try {
    const mtpList = await getMtpDevices();
    const mtpDevices: DetectedDevice[] = mtpList.map((d) => ({
      name: d.name,
      mountPath: d.mountPath,
      isWalkman: d.isWalkman,
      isMtp: true,
    }));
    return [...usb, ...mtpDevices];
  } catch {
    return usb;
  }
}

export function watchDevices(
  callback: (devices: DetectedDevice[]) => void
): void {
  // Poll /Volumes every 3 seconds for device changes
  let previousDevices: string[] = [];

  const check = async () => {
    const devices = await getConnectedWalkman();
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
