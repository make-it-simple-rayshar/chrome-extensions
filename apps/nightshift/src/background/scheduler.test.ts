import { describe, expect, it } from 'vitest';
import type { ScheduleConfig } from '../shared/types';
import { computeNextEvent, isInActiveWindow } from './scheduler';

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
      expect(eventDate.getUTCHours()).toBe(20);
      expect(eventDate.getUTCMinutes()).toBe(0);
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
      expect(eventDate.getUTCDate()).toBe(3);
      expect(eventDate.getUTCHours()).toBe(7);
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
      expect(eventDate.getUTCDate()).toBe(3);
      expect(eventDate.getUTCHours()).toBe(7);
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
      expect(eventDate.getUTCHours()).toBe(20);
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
      expect(eventDate.getUTCHours()).toBe(17);
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
      expect(eventDate.getUTCHours()).toBeGreaterThanOrEqual(17);
      expect(eventDate.getUTCHours()).toBeLessThanOrEqual(22);
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
      expect(eventDate.getUTCHours()).toBeGreaterThanOrEqual(1);
      expect(eventDate.getUTCHours()).toBeLessThanOrEqual(6);
    });
  });
});
