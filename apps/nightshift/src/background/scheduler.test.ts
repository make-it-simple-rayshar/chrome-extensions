import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ScheduleConfig } from '../shared/types';
import {
  type SchedulerCallbacks,
  applyCorrectStateForCurrentTime,
  computeNextEvent,
  isInActiveWindow,
} from './scheduler';

// Minimal chrome.alarms mock for applyCorrectStateForCurrentTime tests
beforeAll(() => {
  if (typeof globalThis.chrome === 'undefined') {
    (globalThis as Record<string, unknown>).chrome = {
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        get: vi.fn((_name: string, cb: (alarm: unknown) => void) => cb(null)),
      },
    };
  }
});

describe('scheduler', () => {
  describe('computeNextEvent (manual mode)', () => {
    it('returns "on" event when before start time', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'manual',
        manualStart: '20:00',
        manualEnd: '07:00',
      };
      // 15:00 UTC — before 20:00 start
      const now = new Date('2026-03-02T15:00:00Z');
      const result = computeNextEvent(config, now);
      expect(result.type).toBe('on');
      // Should be today at 20:00
      const eventDate = new Date(result.time);
      expect(eventDate.getHours()).toBe(20);
      expect(eventDate.getMinutes()).toBe(0);
    });

    it('returns "off" event when inside active window (after start, before midnight)', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'manual',
        manualStart: '20:00',
        manualEnd: '07:00',
      };
      // 22:00 UTC — inside active window (20:00-07:00)
      const now = new Date('2026-03-02T22:00:00Z');
      const result = computeNextEvent(config, now);
      expect(result.type).toBe('off');
      // Should be tomorrow at 07:00
      const eventDate = new Date(result.time);
      expect(eventDate.getDate()).toBe(3);
      expect(eventDate.getHours()).toBe(7);
    });

    it('returns "off" event when inside active window (after midnight, before end)', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'manual',
        manualStart: '20:00',
        manualEnd: '07:00',
      };
      // 03:00 UTC — inside active window (past midnight)
      const now = new Date('2026-03-03T03:00:00Z');
      const result = computeNextEvent(config, now);
      expect(result.type).toBe('off');
      // Should be today at 07:00
      const eventDate = new Date(result.time);
      expect(eventDate.getDate()).toBe(3);
      expect(eventDate.getHours()).toBe(7);
    });

    it('returns "on" event when after end time but before next start', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'manual',
        manualStart: '20:00',
        manualEnd: '07:00',
      };
      // 10:00 UTC — after 07:00 end, before 20:00 start
      const now = new Date('2026-03-03T10:00:00Z');
      const result = computeNextEvent(config, now);
      expect(result.type).toBe('on');
      const eventDate = new Date(result.time);
      expect(eventDate.getHours()).toBe(20);
    });

    it('handles same-day schedule (start < end)', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'manual',
        manualStart: '09:00',
        manualEnd: '17:00',
      };
      // 12:00 — inside window
      const now = new Date('2026-03-02T12:00:00Z');
      const result = computeNextEvent(config, now);
      expect(result.type).toBe('off');
      const eventDate = new Date(result.time);
      expect(eventDate.getHours()).toBe(17);
    });
  });

  describe('isInActiveWindow', () => {
    it('returns true when inside overnight window (after start)', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'manual',
        manualStart: '20:00',
        manualEnd: '07:00',
      };
      const now = new Date('2026-03-02T22:00:00Z');
      expect(isInActiveWindow(config, now)).toBe(true);
    });

    it('returns true when inside overnight window (before end, past midnight)', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'manual',
        manualStart: '20:00',
        manualEnd: '07:00',
      };
      const now = new Date('2026-03-03T05:00:00Z');
      expect(isInActiveWindow(config, now)).toBe(true);
    });

    it('returns false when outside overnight window', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'manual',
        manualStart: '20:00',
        manualEnd: '07:00',
      };
      const now = new Date('2026-03-02T15:00:00Z');
      expect(isInActiveWindow(config, now)).toBe(false);
    });

    it('returns true inside same-day window', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'manual',
        manualStart: '09:00',
        manualEnd: '17:00',
      };
      const now = new Date('2026-03-02T12:00:00Z');
      expect(isInActiveWindow(config, now)).toBe(true);
    });

    it('returns false outside same-day window', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'manual',
        manualStart: '09:00',
        manualEnd: '17:00',
      };
      const now = new Date('2026-03-02T20:00:00Z');
      expect(isInActiveWindow(config, now)).toBe(false);
    });

    it('handles sun mode using suncalc', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'sun',
        manualStart: '20:00',
        manualEnd: '07:00',
        latitude: 52.2297,
        longitude: 21.0122,
        cityName: 'Warsaw',
      };
      // Mid-day — should not be in active window (sun is up)
      const now = new Date('2026-06-15T12:00:00Z');
      expect(isInActiveWindow(config, now)).toBe(false);
    });
  });

  describe('applyCorrectStateForCurrentTime', () => {
    const manualConfig: ScheduleConfig = {
      enabled: true,
      mode: 'manual',
      manualStart: '20:00',
      manualEnd: '07:00',
    };

    function makeCallbacks(overrides: {
      schedule?: ScheduleConfig | null;
      globalEnabled?: boolean;
      scheduleOverrideUntil?: number | null;
    }): SchedulerCallbacks & {
      setEnabledCalls: boolean[];
      clearOverrideCalled: boolean;
      saveStateCalled: boolean;
    } {
      const state = {
        schedule: overrides.schedule ?? null,
        globalEnabled: overrides.globalEnabled ?? false,
        scheduleOverrideUntil: overrides.scheduleOverrideUntil ?? null,
      };
      const cb = {
        getState: () => state,
        setEnabled: vi.fn((enabled: boolean) => {
          state.globalEnabled = enabled;
          cb.setEnabledCalls.push(enabled);
        }),
        clearOverride: vi.fn(() => {
          state.scheduleOverrideUntil = null;
          cb.clearOverrideCalled = true;
        }),
        saveState: vi.fn(() => {
          cb.saveStateCalled = true;
        }),
        setEnabledCalls: [] as boolean[],
        clearOverrideCalled: false,
        saveStateCalled: false,
      };
      return cb;
    }

    it('does nothing when schedule is null', () => {
      const cb = makeCallbacks({ schedule: null });
      applyCorrectStateForCurrentTime(cb);
      expect(cb.setEnabled).not.toHaveBeenCalled();
      expect(cb.saveState).not.toHaveBeenCalled();
    });

    it('does nothing when schedule is disabled', () => {
      const cb = makeCallbacks({
        schedule: { ...manualConfig, enabled: false },
      });
      applyCorrectStateForCurrentTime(cb);
      expect(cb.setEnabled).not.toHaveBeenCalled();
    });

    it('respects active manual override', () => {
      const cb = makeCallbacks({
        schedule: manualConfig,
        globalEnabled: false,
        scheduleOverrideUntil: Date.now() + 3600000, // 1h from now
      });
      applyCorrectStateForCurrentTime(cb);
      expect(cb.setEnabled).not.toHaveBeenCalled();
      expect(cb.clearOverrideCalled).toBe(false);
    });

    it('clears expired override and applies correct state', () => {
      const cb = makeCallbacks({
        schedule: manualConfig,
        globalEnabled: false,
        scheduleOverrideUntil: Date.now() - 1000, // expired
      });
      applyCorrectStateForCurrentTime(cb);
      expect(cb.clearOverrideCalled).toBe(true);
      expect(cb.saveState).toHaveBeenCalled();
    });

    it('calls setEnabled when globalEnabled mismatches active window', () => {
      // We can't mock Date inside isInActiveWindow, so we test that
      // setEnabled IS called when the state doesn't match the window.
      // Use a same-day config where we know the current time's position.
      const now = new Date();
      const h = now.getHours();

      // Create a window that we know the current time is inside/outside
      const insideConfig: ScheduleConfig = {
        enabled: true,
        mode: 'manual',
        manualStart: `${String(h).padStart(2, '0')}:00`,
        manualEnd: `${String((h + 2) % 24).padStart(2, '0')}:00`,
      };

      // globalEnabled=false but we ARE in the window → should call setEnabled(true)
      const cb = makeCallbacks({
        schedule: insideConfig,
        globalEnabled: false,
      });

      applyCorrectStateForCurrentTime(cb);
      expect(cb.setEnabledCalls).toContain(true);
    });
  });

  describe('computeNextEvent (sun mode)', () => {
    it('computes sunset event when sun is up', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'sun',
        manualStart: '20:00',
        manualEnd: '07:00',
        latitude: 52.2297,
        longitude: 21.0122,
        cityName: 'Warsaw',
      };
      // Noon — sun is up, next event should be sunset (type: 'on')
      const now = new Date('2026-06-15T12:00:00Z');
      const result = computeNextEvent(config, now);
      expect(result.type).toBe('on');
      // Warsaw sunset in June is around 21:00 UTC+2 = 19:00 UTC
      const eventDate = new Date(result.time);
      expect(eventDate.getHours()).toBeGreaterThanOrEqual(17);
      expect(eventDate.getHours()).toBeLessThanOrEqual(22);
    });

    it('returns fallback event when lat/lng missing', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'sun',
        manualStart: '20:00',
        manualEnd: '07:00',
        // No latitude/longitude
      };
      const now = new Date('2026-06-15T12:00:00Z');
      const result = computeNextEvent(config, now);
      expect(result.type).toBe('on');
      expect(result.time).toBe(now.getTime() + 3600000);
    });

    it('computes sunrise event when sun is down', () => {
      const config: ScheduleConfig = {
        enabled: true,
        mode: 'sun',
        manualStart: '20:00',
        manualEnd: '07:00',
        latitude: 52.2297,
        longitude: 21.0122,
        cityName: 'Warsaw',
      };
      // 23:00 UTC — sun is down, next event should be sunrise (type: 'off')
      const now = new Date('2026-06-15T23:00:00Z');
      const result = computeNextEvent(config, now);
      expect(result.type).toBe('off');
      // Warsaw sunrise in June is around 04:15 UTC+2 = 02:15 UTC
      const eventDate = new Date(result.time);
      expect(eventDate.getHours()).toBeGreaterThanOrEqual(1);
      expect(eventDate.getHours()).toBeLessThanOrEqual(6);
    });
  });
});
