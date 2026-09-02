import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../useStore';
import type { WalkmanDevice } from '../../types';

function device(mountPath: string): WalkmanDevice {
  return { name: mountPath, mountPath } as WalkmanDevice;
}

beforeEach(() => {
  useStore.setState({
    devices: [],
    activeDevice: null,
    viewMode: 'library',
  });
});

describe('removeDevice', () => {
  it('removes the ejected device from the list', () => {
    useStore.getState().setDevices([
      device('/Volumes/WALKMAN'),
      device('mtp://65537'),
    ]);

    useStore.getState().removeDevice('/Volumes/WALKMAN');

    expect(useStore.getState().devices.map((d) => d.mountPath)).toEqual([
      'mtp://65537',
    ]);
  });

  it('returns to the library view when the ejected device was open', () => {
    const walkman = device('/Volumes/WALKMAN');
    useStore.getState().setDevices([walkman]);
    useStore.getState().setActiveDevice(walkman);
    expect(useStore.getState().viewMode).toBe('device');

    useStore.getState().removeDevice('/Volumes/WALKMAN');

    expect(useStore.getState().activeDevice).toBeNull();
    expect(useStore.getState().viewMode).toBe('library');
  });

  it('keeps the current view when another device is ejected', () => {
    const walkman = device('/Volumes/WALKMAN');
    useStore.getState().setDevices([walkman, device('/Volumes/SD_CARD')]);
    useStore.getState().setActiveDevice(walkman);

    useStore.getState().removeDevice('/Volumes/SD_CARD');

    expect(useStore.getState().activeDevice?.mountPath).toBe('/Volumes/WALKMAN');
    expect(useStore.getState().viewMode).toBe('device');
  });

  it('is a no-op for an unknown mount path', () => {
    useStore.getState().setDevices([device('/Volumes/WALKMAN')]);

    useStore.getState().removeDevice('/Volumes/GONE');

    expect(useStore.getState().devices).toHaveLength(1);
  });
});
