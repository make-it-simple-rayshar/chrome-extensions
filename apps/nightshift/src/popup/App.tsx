import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { MSG } from '../shared/messages';
import { resolveState } from '../shared/state-resolver';
import type {
  ColorProfile,
  DarkDetection,
  DarkMode,
  FilterOptions,
  ScheduleConfig,
  SiteMode,
} from '../shared/types';
import { CTABanner } from './cta-banner';
import { SitesManager } from './sites-manager';

type PopupView = 'main' | 'sites';

interface FilterValues {
  brightness: number;
  contrast: number;
  sepia: number;
}

const DEFAULT_FILTERS: FilterValues = { brightness: 100, contrast: 100, sepia: 0 };

const SLIDER_THROTTLE_MS = 100;

function isRestricted(url: string | undefined): boolean {
  if (!url) return true;
  return /^(chrome|chrome-extension|about|file):/.test(url);
}

export function App() {
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [siteMode, setSiteMode] = useState<SiteMode>('auto');
  const [domain, setDomain] = useState<string | null>(null);
  const [darkDetection, setDarkDetection] = useState<DarkDetection | null>(null);
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTERS);
  const [darkMode, setDarkMode] = useState<DarkMode>('filter');
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [view, setView] = useState<PopupView>('main');
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
  const [scheduleOverride, setScheduleOverride] = useState<number | null>(null);
  const [nextEvent, setNextEvent] = useState<{ type: 'on' | 'off'; time: number } | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ColorProfile>>({});
  const [activeProfile, setActiveProfile] = useState<string>('default');

  const tabIdRef = useRef<number | undefined>(undefined);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef<FilterValues>(DEFAULT_FILTERS);
  const siteModeRef = useRef<SiteMode>('auto');

  const applyStateResponse = useCallback((response: Record<string, unknown>) => {
    setGlobalEnabled((response?.globalEnabled as boolean) ?? false);
    const siteConfig = response?.siteConfig as { enabled?: SiteMode } | undefined;
    const mode: SiteMode = siteConfig?.enabled ?? 'auto';
    setSiteMode(mode);
    siteModeRef.current = mode;
    if (response?.darkDetection) {
      setDarkDetection(response.darkDetection as DarkDetection);
    }
    setDarkMode((response?.darkMode as DarkMode) ?? 'filter');
    const opts = (response?.filterOptions ?? {}) as FilterOptions;
    const loaded: FilterValues = {
      brightness: opts.brightness ?? 100,
      contrast: opts.contrast ?? 100,
      sepia: opts.sepia ?? 0,
    };
    setFilters(loaded);
    filtersRef.current = loaded;
    if (response?.schedule !== undefined) {
      setSchedule((response.schedule as ScheduleConfig) ?? null);
    }
    if (response?.scheduleOverrideUntil !== undefined) {
      setScheduleOverride((response.scheduleOverrideUntil as number) ?? null);
    }
    if (response?.profiles) {
      setProfiles(response.profiles as Record<string, ColorProfile>);
    }
    if (response?.activeProfile) {
      setActiveProfile(response.activeProfile as string);
    }
  }, []);

  const refreshState = useCallback(() => {
    chrome.runtime.sendMessage(
      { action: MSG.GET_STATE, domain, tabId: tabIdRef.current },
      (response) => {
        if (chrome.runtime.lastError) return;
        applyStateResponse(response);
      },
    );
  }, [domain, applyStateResponse]);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];

      if (isRestricted(tab?.url)) {
        setRestricted(true);
        setLoading(false);
        return;
      }

      let tabDomain: string | null = null;
      if (tab?.url) {
        try {
          tabDomain = new URL(tab.url).hostname;
        } catch {
          // special URLs
        }
      }

      tabIdRef.current = tab?.id;
      setDomain(tabDomain);

      chrome.runtime.sendMessage(
        { action: MSG.GET_STATE, domain: tabDomain, tabId: tab?.id },
        (response) => {
          if (chrome.runtime.lastError) {
            setLoading(false);
            return;
          }
          applyStateResponse(response);
          // Fetch schedule info
          chrome.runtime.sendMessage({ action: MSG.GET_SCHEDULE }, (schedResp) => {
            if (!chrome.runtime.lastError && schedResp) {
              setSchedule((schedResp.schedule as ScheduleConfig) ?? null);
              setScheduleOverride((schedResp.scheduleOverrideUntil as number) ?? null);
              setNextEvent((schedResp.nextEvent as { type: 'on' | 'off'; time: number }) ?? null);
            }
            setLoading(false);
          });
        },
      );
    });
  }, [applyStateResponse]);

  const handleGlobalToggle = useCallback((checked: boolean) => {
    setGlobalEnabled(checked);
    chrome.runtime.sendMessage({ action: MSG.SET_ENABLED, enabled: checked }, () => {
      if (chrome.runtime.lastError) {
        console.error('[NightShift] Toggle failed:', chrome.runtime.lastError.message);
        setGlobalEnabled(!checked);
      }
    });
  }, []);

  const handleSiteSwitch = useCallback(
    (checked: boolean) => {
      if (!domain) return;
      const prev = siteModeRef.current;
      setSiteMode(checked);
      siteModeRef.current = checked;
      chrome.runtime.sendMessage({ action: MSG.SET_SITE_ENABLED, domain, enabled: checked }, () => {
        if (chrome.runtime.lastError) {
          console.error('[NightShift] Site toggle failed:', chrome.runtime.lastError.message);
          setSiteMode(prev);
          siteModeRef.current = prev;
        }
      });
    },
    [domain],
  );

  const sendFilterUpdate = useCallback((key: keyof FilterValues, value: number) => {
    const newFilters = { ...filtersRef.current, [key]: value };
    setFilters(newFilters);
    filtersRef.current = newFilters;

    // Throttled single-hop: popup → content script (no background relay)
    if (throttleRef.current) return;
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null;
      if (tabIdRef.current !== undefined) {
        chrome.tabs.sendMessage(
          tabIdRef.current,
          { action: MSG.UPDATE_FILTER, options: filtersRef.current },
          { frameId: 0 },
        );
      }
    }, SLIDER_THROTTLE_MS);
  }, []);

  const persistFilters = useCallback(() => {
    // Flush pending throttle to sync content script with final value
    if (throttleRef.current) {
      clearTimeout(throttleRef.current);
      throttleRef.current = null;
      if (tabIdRef.current !== undefined) {
        chrome.tabs.sendMessage(
          tabIdRef.current,
          { action: MSG.UPDATE_FILTER, options: filtersRef.current },
          { frameId: 0 },
        );
      }
    }
    chrome.runtime.sendMessage({
      action: MSG.SET_FILTER_OPTIONS,
      options: filtersRef.current,
    });
  }, []);

  const handleScheduleChange = useCallback((newSchedule: ScheduleConfig | null) => {
    setSchedule(newSchedule);
    chrome.runtime.sendMessage({ action: MSG.SET_SCHEDULE, schedule: newSchedule }, () => {
      if (chrome.runtime.lastError) {
        console.error('[NightShift] Schedule update failed:', chrome.runtime.lastError.message);
        return;
      }
      // Refresh next event info
      chrome.runtime.sendMessage({ action: MSG.GET_SCHEDULE }, (resp) => {
        if (!chrome.runtime.lastError && resp) {
          setNextEvent((resp.nextEvent as { type: 'on' | 'off'; time: number }) ?? null);
          setScheduleOverride((resp.scheduleOverrideUntil as number) ?? null);
        }
      });
    });
  }, []);

  const handleProfileSelect = useCallback(
    (profileId: string) => {
      setActiveProfile(profileId);
      chrome.runtime.sendMessage({ action: MSG.SET_PROFILE, profileId }, (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) {
          console.error('[NightShift] Profile switch failed');
          return;
        }
        refreshState();
      });
    },
    [refreshState],
  );

  const handleCreateProfile = useCallback(
    (name: string) => {
      const id = name.toLowerCase().replace(/\s+/g, '-');
      const reserved = ['default', 'night-reading', 'oled'];
      if (reserved.includes(id)) {
        console.warn(`[NightShift] Cannot overwrite built-in profile: ${id}`);
        return;
      }
      const profile: ColorProfile = {
        id,
        name,
        darkMode,
        brightness: filters.brightness,
        contrast: filters.contrast,
        sepia: filters.sepia,
      };
      chrome.runtime.sendMessage({ action: MSG.CREATE_PROFILE, profile }, (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) {
          console.error('[NightShift] Create profile failed');
          return;
        }
        setProfiles((prev) => ({ ...prev, [id]: profile }));
        setActiveProfile(id);
      });
    },
    [darkMode, filters],
  );

  const handleDeleteProfile = useCallback(
    (profileId: string) => {
      chrome.runtime.sendMessage({ action: MSG.DELETE_PROFILE, profileId }, (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) {
          console.error('[NightShift] Delete profile failed');
          return;
        }
        setProfiles((prev) => {
          const next = { ...prev };
          delete next[profileId];
          return next;
        });
        if (activeProfile === profileId) {
          setActiveProfile('default');
          refreshState();
        }
      });
    },
    [activeProfile, refreshState],
  );

  const { effectiveEnabled, detectionNotice } = resolveState({
    globalEnabled,
    siteMode,
    darkDetection,
    darkMode,
  });

  if (restricted) {
    return (
      <div className="w-80 p-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">NightShift</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Dark mode unavailable on this page</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (view === 'sites') {
    return (
      <div className="w-80 p-3">
        <Card>
          <CardContent className="pt-4">
            <SitesManager
              onBack={() => {
                refreshState();
                setView('main');
              }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-80 p-3">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">NightShift</CardTitle>
            <Switch
              checked={globalEnabled}
              onCheckedChange={handleGlobalToggle}
              disabled={loading}
              aria-label="Global dark mode"
            />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Per-site toggle — only when global is ON */}
          {domain && globalEnabled && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground truncate" title={domain}>
                  {domain}
                </span>
                <Switch
                  checked={effectiveEnabled}
                  onCheckedChange={handleSiteSwitch}
                  disabled={loading}
                  aria-label={`Dark mode for ${domain}`}
                />
              </div>

              {/* Native dark mode detected — auto-skipped or overridden */}
              {detectionNotice && (
                <div className="rounded-md border border-yellow-600/30 bg-yellow-950/20 p-2">
                  <p className="text-xs text-yellow-400">{detectionNotice}</p>
                </div>
              )}
            </>
          )}

          {/* Profile selector */}
          {globalEnabled && (
            <ProfileSelector
              profiles={profiles}
              activeProfile={activeProfile}
              onSelect={handleProfileSelect}
              onCreate={handleCreateProfile}
              onDelete={handleDeleteProfile}
            />
          )}

          {/* Schedule section */}
          {globalEnabled && (
            <ScheduleSection
              schedule={schedule}
              scheduleOverride={scheduleOverride}
              nextEvent={nextEvent}
              onChange={handleScheduleChange}
            />
          )}

          {/* Filter sliders — only when dark mode active AND filter mode */}
          {effectiveEnabled && darkMode === 'filter' && (
            <div className="flex flex-col gap-2.5 pt-2 border-t border-border">
              <SliderRow
                label="Brightness"
                value={filters.brightness}
                min={50}
                max={150}
                onChange={(v) => sendFilterUpdate('brightness', v)}
                onCommit={persistFilters}
              />
              <SliderRow
                label="Contrast"
                value={filters.contrast}
                min={50}
                max={150}
                onChange={(v) => sendFilterUpdate('contrast', v)}
                onCommit={persistFilters}
              />
              <SliderRow
                label="Sepia"
                value={filters.sepia}
                min={0}
                max={100}
                onChange={(v) => sendFilterUpdate('sepia', v)}
                onCommit={persistFilters}
              />
            </div>
          )}

          {/* Manage Sites */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setView('sites')}
          >
            Manage Sites
          </Button>

          {/* Freemium CTA */}
          <CTABanner />
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileSelector({
  profiles,
  activeProfile,
  onSelect,
  onCreate,
  onDelete,
}: {
  profiles: Record<string, ColorProfile>;
  activeProfile: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const profileList = Object.values(profiles);

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setNewName('');
    setShowCreate(false);
  };

  return (
    <div className="flex flex-col gap-2 pt-2 border-t border-border">
      <span className="text-xs text-muted-foreground">Profile</span>
      <div className="flex flex-wrap gap-1.5">
        {profileList.map((p) => (
          <div key={p.id} className="relative group">
            <Button
              size="sm"
              variant={activeProfile === p.id ? 'default' : 'outline'}
              className="text-xs h-7 px-2.5"
              onClick={() => onSelect(p.id)}
              aria-pressed={activeProfile === p.id}
            >
              {p.name}
            </Button>
            {p.id !== 'default' && activeProfile === p.id && (
              <button
                type="button"
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-destructive text-destructive-foreground text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                onClick={() => setConfirmDelete(p.id)}
                aria-label={`Delete ${p.name}`}
              >
                x
              </button>
            )}
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="text-xs h-7 px-2"
          onClick={() => setShowCreate(true)}
        >
          + Save as...
        </Button>
      </div>

      {/* Create profile dialog */}
      {showCreate && (
        <div className="flex gap-1.5">
          <input
            type="text"
            className="flex-1 h-7 rounded-md border border-input bg-background px-2 text-xs"
            placeholder="Profile name"
            aria-label="New profile name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <Button size="sm" className="h-7 text-xs px-2" onClick={handleCreate}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs px-2"
            onClick={() => {
              setShowCreate(false);
              setNewName('');
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={`Confirm deletion of ${profiles[confirmDelete]?.name}`}
          className="flex items-center justify-between rounded-md border border-destructive/50 bg-destructive/10 p-2"
        >
          <span className="text-xs">Delete "{profiles[confirmDelete]?.name}"?</span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="destructive"
              className="h-6 text-xs px-2"
              onClick={() => {
                onDelete(confirmDelete);
                setConfirmDelete(null);
              }}
            >
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs px-2"
              onClick={() => setConfirmDelete(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const DEFAULT_SCHEDULE: ScheduleConfig = {
  enabled: false,
  mode: 'manual',
  manualStart: '20:00',
  manualEnd: '07:00',
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ScheduleSection({
  schedule,
  scheduleOverride,
  nextEvent,
  onChange,
}: {
  schedule: ScheduleConfig | null;
  scheduleOverride: number | null;
  nextEvent: { type: 'on' | 'off'; time: number } | null;
  onChange: (schedule: ScheduleConfig | null) => void;
}) {
  const current = schedule ?? DEFAULT_SCHEDULE;

  const handleToggle = (checked: boolean) => {
    onChange({ ...current, enabled: checked });
  };

  const handleModeChange = (mode: 'manual' | 'sun') => {
    onChange({ ...current, mode });
  };

  const handleTimeChange = (field: 'manualStart' | 'manualEnd', value: string) => {
    onChange({ ...current, [field]: value });
  };

  const cities: Record<string, { lat: number; lng: number }> = {
    warsaw: { lat: 52.2297, lng: 21.0122 },
    'new york': { lat: 40.7128, lng: -74.006 },
    london: { lat: 51.5074, lng: -0.1278 },
    tokyo: { lat: 35.6762, lng: 139.6503 },
    berlin: { lat: 52.52, lng: 13.405 },
    paris: { lat: 48.8566, lng: 2.3522 },
  };

  const [cityInput, setCityInput] = useState(current.cityName ?? '');

  const commitCity = (cityName: string) => {
    const match = cities[cityName.toLowerCase()];
    onChange({
      ...current,
      cityName,
      latitude: match?.lat ?? current.latitude,
      longitude: match?.lng ?? current.longitude,
    });
  };

  return (
    <div className="flex flex-col gap-2 pt-2 border-t border-border">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Auto schedule</span>
        <Switch
          checked={current.enabled}
          onCheckedChange={handleToggle}
          aria-label="Auto schedule"
        />
      </div>

      {current.enabled && (
        <>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={current.mode === 'sun' ? 'default' : 'outline'}
              className="flex-1 text-xs"
              onClick={() => handleModeChange('sun')}
              aria-pressed={current.mode === 'sun'}
            >
              Sunset/sunrise
            </Button>
            <Button
              size="sm"
              variant={current.mode === 'manual' ? 'default' : 'outline'}
              className="flex-1 text-xs"
              onClick={() => handleModeChange('manual')}
              aria-pressed={current.mode === 'manual'}
            >
              Custom times
            </Button>
          </div>

          {current.mode === 'sun' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="schedule-city" className="text-xs text-muted-foreground">
                City
              </label>
              <input
                id="schedule-city"
                type="text"
                className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                placeholder="Warsaw"
                value={cityInput}
                onChange={(e) => {
                  setCityInput(e.target.value);
                  // Auto-commit when a known city is matched
                  if (cities[e.target.value.toLowerCase()]) {
                    commitCity(e.target.value);
                  }
                }}
                onBlur={() => commitCity(cityInput)}
              />
              {!current.latitude && (
                <p className="text-xs text-yellow-400">Enter a city to calculate sunrise/sunset</p>
              )}
            </div>
          )}

          {current.mode === 'manual' && (
            <div className="flex gap-2">
              <div className="flex flex-col gap-1 flex-1">
                <label htmlFor="schedule-start" className="text-xs text-muted-foreground">
                  Start
                </label>
                <input
                  id="schedule-start"
                  type="time"
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                  value={current.manualStart}
                  onChange={(e) => handleTimeChange('manualStart', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <label htmlFor="schedule-end" className="text-xs text-muted-foreground">
                  End
                </label>
                <input
                  id="schedule-end"
                  type="time"
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                  value={current.manualEnd}
                  onChange={(e) => handleTimeChange('manualEnd', e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Status line */}
          {scheduleOverride ? (
            <p className="text-xs text-yellow-400">
              Schedule paused (manual override) — resumes at {formatTime(scheduleOverride)}
            </p>
          ) : nextEvent ? (
            <p className="text-xs text-muted-foreground">
              Dark mode turns {nextEvent.type === 'on' ? 'ON' : 'OFF'} at{' '}
              {formatTime(nextEvent.time)}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  const labelId = `slider-${label.toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span id={labelId} className="text-xs text-muted-foreground">
          {label}
        </span>
        <span className="text-xs tabular-nums">{value}%</span>
      </div>
      <Slider
        aria-labelledby={labelId}
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={() => onCommit()}
      />
    </div>
  );
}
