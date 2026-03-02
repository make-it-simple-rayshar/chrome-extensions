import SunCalc from 'suncalc';
import type { ScheduleConfig } from '../shared/types';

interface ScheduleEvent {
  type: 'on' | 'off';
  time: number;
}

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number);
  return { hours: h, minutes: m };
}

function setTimeOnDate(date: Date, hours: number, minutes: number): Date {
  const d = new Date(date);
  d.setUTCHours(hours, minutes, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function getSunTimes(date: Date, lat: number, lng: number): { sunset: Date; sunrise: Date } {
  const times = SunCalc.getTimes(date, lat, lng);
  return { sunset: times.sunset, sunrise: times.sunrise };
}

export function isInActiveWindow(config: ScheduleConfig, now: Date = new Date()): boolean {
  if (config.mode === 'sun') {
    if (config.latitude === undefined || config.longitude === undefined) return false;
    const { sunset, sunrise } = getSunTimes(now, config.latitude, config.longitude);
    // Also check yesterday's sunset → today's sunrise window
    const yesterdaySun = getSunTimes(addDays(now, -1), config.latitude, config.longitude);

    // Active if: after today's sunset OR between yesterday's sunset and today's sunrise
    if (now >= sunset) return true;
    if (now >= yesterdaySun.sunset && now < sunrise) return true;
    return false;
  }

  // Manual mode
  const { hours: startH, minutes: startM } = parseTime(config.manualStart);
  const { hours: endH, minutes: endM } = parseTime(config.manualEnd);
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes < endMinutes) {
    // Same-day window: 09:00-17:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // Overnight window: 20:00-07:00
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function computeNextEvent(config: ScheduleConfig, now: Date = new Date()): ScheduleEvent {
  if (config.mode === 'sun') {
    if (config.latitude === undefined || config.longitude === undefined) {
      // Fallback: 1 hour from now
      return { type: 'on', time: now.getTime() + 3600000 };
    }

    const todaySun = getSunTimes(now, config.latitude, config.longitude);
    const tomorrowSun = getSunTimes(addDays(now, 1), config.latitude, config.longitude);

    if (isInActiveWindow(config, now)) {
      // Currently dark → next event is sunrise (turn off)
      if (now < todaySun.sunrise) {
        return { type: 'off', time: todaySun.sunrise.getTime() };
      }
      return { type: 'off', time: tomorrowSun.sunrise.getTime() };
    }
    // Currently light → next event is sunset (turn on)
    if (now < todaySun.sunset) {
      return { type: 'on', time: todaySun.sunset.getTime() };
    }
    // After today's sunset but not in active window (shouldn't happen, but safe)
    const dayAfterSun = getSunTimes(addDays(now, 2), config.latitude, config.longitude);
    return { type: 'on', time: dayAfterSun.sunset.getTime() };
  }

  // Manual mode
  const { hours: startH, minutes: startM } = parseTime(config.manualStart);
  const { hours: endH, minutes: endM } = parseTime(config.manualEnd);

  if (isInActiveWindow(config, now)) {
    // Currently in active window → next event is "off" at end time
    let offTime = setTimeOnDate(now, endH, endM);
    if (offTime.getTime() <= now.getTime()) {
      offTime = setTimeOnDate(addDays(now, 1), endH, endM);
    }
    return { type: 'off', time: offTime.getTime() };
  }

  // Not in active window → next event is "on" at start time
  let onTime = setTimeOnDate(now, startH, startM);
  if (onTime.getTime() <= now.getTime()) {
    onTime = setTimeOnDate(addDays(now, 1), startH, startM);
  }
  return { type: 'on', time: onTime.getTime() };
}

export const ALARM_NEXT_EVENT = 'nightshift-next-event';
export const ALARM_SAFETY_CHECK = 'nightshift-safety-check';

export function createScheduleAlarms(config: ScheduleConfig | null): void {
  if (!config || !config.enabled) {
    chrome.alarms.clear(ALARM_NEXT_EVENT);
    chrome.alarms.clear(ALARM_SAFETY_CHECK);
    return;
  }

  const next = computeNextEvent(config);
  chrome.alarms.create(ALARM_NEXT_EVENT, { when: next.time });
  chrome.alarms.get(ALARM_SAFETY_CHECK, (existing) => {
    if (!existing) {
      chrome.alarms.create(ALARM_SAFETY_CHECK, { periodInMinutes: 60 });
    }
  });
}

export interface SchedulerCallbacks {
  getState: () => {
    schedule: ScheduleConfig | null;
    globalEnabled: boolean;
    scheduleOverrideUntil: number | null;
  };
  setEnabled: (enabled: boolean) => void;
  clearOverride: () => void;
  saveState: () => void;
}

export function applyCorrectStateForCurrentTime(callbacks: SchedulerCallbacks): void {
  const state = callbacks.getState();
  if (!state.schedule || !state.schedule.enabled) return;

  const now = Date.now();
  if (state.scheduleOverrideUntil && now < state.scheduleOverrideUntil) {
    return; // Respect manual override
  }

  if (state.scheduleOverrideUntil) {
    callbacks.clearOverride();
    callbacks.saveState();
  }

  const shouldBeActive = isInActiveWindow(state.schedule);
  if (shouldBeActive !== state.globalEnabled) {
    callbacks.setEnabled(shouldBeActive);
    callbacks.saveState();
  }

  // Recreate next event alarm
  createScheduleAlarms(state.schedule);
}

export function handleAlarm(alarm: chrome.alarms.Alarm, callbacks: SchedulerCallbacks): void {
  if (alarm.name === ALARM_NEXT_EVENT || alarm.name === ALARM_SAFETY_CHECK) {
    applyCorrectStateForCurrentTime(callbacks);
  }
}

export function getNextEventInfo(
  config: ScheduleConfig | null,
): { type: 'on' | 'off'; time: number } | null {
  if (!config || !config.enabled) return null;
  return computeNextEvent(config);
}
