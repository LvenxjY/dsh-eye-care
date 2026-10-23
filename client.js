/**
 * Browser half of the eye-care reminder bundle.
 *
 * Three surfaces share one timer store:
 * - `shell.overlay` shows the break card when a break is due (top-center, never
 *   blocking the composer).
 * - `conversation.composer.dock` shows a compact countdown / pause pill.
 * - `settings.general.item` adds one preference row (enable, interval, accent).
 *
 * Preferences live in `localStorage`, so each browser keeps its own choice.
 * Countdown time advances only while the page is visible, so backgrounded time
 * is not counted as screen time.
 */
window.__ModuleLoader__.load({
  id: 'dsh-eye-care',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-eye-care';
    const STORAGE_KEY = 'dsh-eye-care.settings.v1';
    const MIN_INTERVAL = 1;
    const MAX_INTERVAL = 240;
    const DEFAULT_SETTINGS = Object.freeze({
      enabled: true,
      intervalMinutes: 20,
      breakSeconds: 20,
      snoozeMinutes: 5,
      accent: 'default',
    });

    /** Accent choices; `value` is a CSS color, `default` follows the host theme. */
    const ACCENTS = [
      { id: 'default', zh: '跟随主题', en: 'Match theme', value: 'var(--dsw-alias-brand-primary)' },
      { id: 'green', zh: '护眼浅绿', en: 'Soft green', value: '#57a773' },
      { id: 'blue', zh: '天蓝色', en: 'Sky blue', value: '#4aa3df' },
      { id: 'red', zh: '红色', en: 'Red', value: '#e0685f' },
    ];

    const TEXTS = {
      zh: {
        reminderTitle: '让眼睛休息一下',
        reminderBody: '抬起头看 6 米外（20 英尺）的地方 20 秒，让睫状肌松弛下来。',
        done: '完成休息',
        snooze: '稍后 5 分钟',
        pillLabel: '护眼',
        pillPaused: '护眼已暂停',
        pillTipPause: '暂停护眼提醒',
        pillTipResume: '恢复护眼提醒',
        settingsTitle: '护眼提醒',
        settingsDesc: '每隔一段时间提醒你看远处 20 秒，缓解长时间盯屏造成的眼部疲劳。',
        intervalLabel: '提醒间隔',
        intervalRange: '1 – 240 分钟',
        accentLabel: '提示颜色',
        enableLabel: '启用护眼提醒',
        minuteUnit: '分钟',
      },
      en: {
        reminderTitle: 'Give your eyes a break',
        reminderBody: 'Look at something 20 feet away for 20 seconds to relax your focusing muscles.',
        done: 'Finish break',
        snooze: 'Snooze 5 min',
        pillLabel: 'Eyes',
        pillPaused: 'Eyes paused',
        pillTipPause: 'Pause eye-care reminders',
        pillTipResume: 'Resume eye-care reminders',
        settingsTitle: 'Eye care reminders',
        settingsDesc: 'Reminds you to look into the distance for 20 seconds, easing eye strain from long screen sessions.',
        intervalLabel: 'Reminder interval',
        intervalRange: '1 – 240 min',
        accentLabel: 'Accent color',
        enableLabel: 'Enable eye-care reminders',
        minuteUnit: 'min',
      },
    };

    let store = null;
    let localeFace = null;
    let translate = null;

    function prefersChinese() {
      try {
        return String(navigator.language || '').toLowerCase().indexOf('zh') === 0;
      } catch {
        return false;
      }
    }

    function isChinese() {
      if (localeFace) {
        try {
          if (String(localeFace.getSnapshot().active).toLowerCase().indexOf('zh') === 0) return true;
        } catch {
          /* fall through to the browser language */
        }
      }
      return prefersChinese();
    }

    function t(key) {
      if (translate) {
        try {
          const value = translate(key);
          if (typeof value === 'string' && value !== '' && value !== key) return value;
        } catch {
          /* fall back to the built-in dictionary */
        }
      }
      const dict = prefersChinese() ? TEXTS.zh : TEXTS.en;
      return dict[key] || TEXTS.en[key] || key;
    }

    function accentById(id) {
      return ACCENTS.find((accent) => accent.id === id) || ACCENTS[0];
    }

    function accentLabel(accent) {
      return isChinese() ? accent.zh : accent.en;
    }

    function readSettings() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        const next = { ...DEFAULT_SETTINGS };
        if (typeof parsed === 'object' && parsed !== null) {
          if (typeof parsed.enabled === 'boolean') next.enabled = parsed.enabled;
          if (Number.isFinite(parsed.intervalMinutes) && parsed.intervalMinutes >= MIN_INTERVAL && parsed.intervalMinutes <= MAX_INTERVAL) {
            next.intervalMinutes = Math.round(parsed.intervalMinutes);
          }
          if (Number.isFinite(parsed.breakSeconds) && parsed.breakSeconds >= 5 && parsed.breakSeconds <= 300) {
            next.breakSeconds = Math.round(parsed.breakSeconds);
          }
          if (Number.isFinite(parsed.snoozeMinutes) && parsed.snoozeMinutes >= 1 && parsed.snoozeMinutes <= 120) {
            next.snoozeMinutes = Math.round(parsed.snoozeMinutes);
          }
          if (ACCENTS.some((accent) => accent.id === parsed.accent)) next.accent = parsed.accent;
        }
        return next;
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    }

    function writeSettings(settings) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        /* storage may be unavailable; the page keeps the in-memory value */
      }
    }

    function formatClock(ms) {
      const total = Math.max(0, Math.ceil(ms / 1000));
      return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
    }

    function clampInterval(value) {
      const rounded = Math.round(value);
      if (!Number.isFinite(rounded)) return DEFAULT_SETTINGS.intervalMinutes;
      return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, rounded));
    }

    function createStore() {
      const listeners = new Set();
      let settings = readSettings();
      let phase = settings.enabled ? 'waiting' : 'paused';
      let remainingMs = settings.intervalMinutes * 60000;
      let restRemainingMs = 0;
      let lastTick = Date.now();
      let timer = null;
      let publishedKey = '';
      let snapshot = { phase, remainingMs, restRemainingMs, settings };

      const publish = () => {
        const key = [
          phase,
          Math.ceil(remainingMs / 1000),
          Math.ceil(restRemainingMs / 1000),
          settings.enabled ? 1 : 0,
          settings.intervalMinutes,
          settings.breakSeconds,
          settings.snoozeMinutes,
          settings.accent,
        ].join('|');
        if (key === publishedKey) return;
        publishedKey = key;
        snapshot = { phase, remainingMs, restRemainingMs, settings };
        listeners.forEach((listener) => {
          try {
            listener();
          } catch {
            /* one broken consumer must not stop the timer */
          }
        });
      };

      const tick = () => {
        const now = Date.now();
        const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
        const elapsed = Math.max(0, Math.min(now - lastTick, 5000));
        lastTick = now;

        if (!settings.enabled) {
          phase = 'paused';
          restRemainingMs = 0;
        } else {
          if (phase === 'paused') {
            phase = 'waiting';
            remainingMs = settings.intervalMinutes * 60000;
          }
          if (visible) {
            if (phase === 'waiting') {
              remainingMs -= elapsed;
              if (remainingMs <= 0) {
                phase = 'resting';
                remainingMs = 0;
                restRemainingMs = settings.breakSeconds * 1000;
              }
            } else if (phase === 'resting') {
              restRemainingMs -= elapsed;
              if (restRemainingMs <= 0) {
                phase = 'waiting';
                restRemainingMs = 0;
                remainingMs = settings.intervalMinutes * 60000;
              }
            }
          }
        }
        publish();
      };

      const restart = () => {
        phase = settings.enabled ? 'waiting' : 'paused';
        restRemainingMs = 0;
        remainingMs = settings.intervalMinutes * 60000;
        lastTick = Date.now();
        if (timer !== null) tick();
        else publish();
      };

      return {
        getSnapshot: () => snapshot,
        /**
         * Live break countdown for frame-driven rendering.
         *
         * `snapshot.restRemainingMs` is quantised to whole seconds because the
         * store only publishes when the rendered key changes; an animation that
         * reads it would step once per second. This getter interpolates from the
         * last tick instead, so a `requestAnimationFrame` loop sees sub-frame
         * progress while the published snapshot stays cheap to diff.
         */
        liveRestRemainingMs: () => {
          if (phase !== 'resting') return 0;
          const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
          if (!visible) return Math.max(0, restRemainingMs);
          return Math.max(0, restRemainingMs - (Date.now() - lastTick));
        },
        breakSeconds: () => settings.breakSeconds,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        start: () => {
          if (timer !== null) return;
          lastTick = Date.now();
          timer = window.setInterval(tick, 250);
          tick();
        },
        stop: () => {
          if (timer === null) return;
          window.clearInterval(timer);
          timer = null;
        },
        update: (patch) => {
          settings = { ...settings, ...patch };
          if (patch.intervalMinutes !== undefined) settings.intervalMinutes = clampInterval(patch.intervalMinutes);
          writeSettings(settings);
          restart();
        },
        toggleEnabled: () => {
          settings = { ...settings, enabled: !settings.enabled };
          writeSettings(settings);
          restart();
        },
        snooze: () => {
          phase = settings.enabled ? 'waiting' : 'paused';
          restRemainingMs = 0;
          remainingMs = settings.snoozeMinutes * 60000;
          lastTick = Date.now();
          if (timer !== null) tick();
          else publish();
        },
        finish: () => {
          restart();
        },
      };
    }

    const IDLE_SNAPSHOT = Object.freeze({
      phase: 'paused',
      remainingMs: 0,
      restRemainingMs: 0,
      settings: DEFAULT_SETTINGS,
    });

    function useEyeCare() {
      const [state, setState] = React.useState(() => (store ? store.getSnapshot() : IDLE_SNAPSHOT));
      React.useEffect(() => {
        if (!store) return undefined;
        const sync = () => setState(store ? store.getSnapshot() : IDLE_SNAPSHOT);
        const unsubscribe = store.subscribe(sync);
        sync();
        return unsubscribe;
      }, []);
      return state;
    }

    /** Settings-only subscription: the row must not repaint once per countdown second. */
    function useSettings() {
      const [settings, setSettings] = React.useState(() =>
        store ? store.getSnapshot().settings : DEFAULT_SETTINGS,
      );
      React.useEffect(() => {
        if (!store) return undefined;
        const sync = () => {
          const next = store ? store.getSnapshot().settings : DEFAULT_SETTINGS;
          setSettings((current) => (current === next ? current : next));
        };
        const unsubscribe = store.subscribe(sync);
        sync();
        return unsubscribe;
      }, []);
      return settings;
    }

    function useLocaleRevision() {
      const face = localeFace;
      const [revision, setRevision] = React.useState(() => (face ? face.getSnapshot().revision : 0));
      React.useEffect(() => {
        if (!face) return undefined;
        const publish = () => setRevision(face.getSnapshot().revision);
        const unsubscribe = face.subscribe(publish);
        publish();
        return unsubscribe;
      }, [face]);
      return revision;
    }

    const CSS = `
.dsh-eye-care-anchor{position:fixed;left:50%;z-index:40;
  top:calc(var(--dsh-frame-chrome-top, 0px) + 56px);
  transform:translateX(-50%);display:flex;justify-content:center;
  width:min(480px,calc(100vw - 32px));box-sizing:border-box;
  pointer-events:none;-webkit-app-region:no-drag}
@keyframes dsh-eye-care-rise{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.dsh-eye-care-card{display:flex;gap:16px;align-items:center;box-sizing:border-box;width:100%;
  pointer-events:auto;padding:18px 20px;border-radius:16px;
  border:1px solid color-mix(in srgb, var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary)) 32%,
    var(--dsw-alias-border-l1));
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
  box-shadow:0 18px 48px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);
  font-size:13px;line-height:1.5;animation:dsh-eye-care-rise .22s ease-out}
.dsh-eye-care-ring{flex:none;width:64px;height:64px}
.dsh-eye-care-ring-num{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;
  fill:var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary))}
.dsh-eye-care-ring-track{stroke:var(--dsw-alias-border-l2)}
.dsh-eye-care-ring-value{stroke:var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary));
  transition:stroke .15s ease}
.dsh-eye-care-body{min-width:0;display:flex;flex-direction:column;gap:6px}
.dsh-eye-care-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-eye-care-desc{font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.dsh-eye-care-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
.dsh-eye-care-btn{appearance:none;font:inherit;font-size:12.5px;line-height:1;cursor:pointer;
  padding:7px 14px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);
  background:transparent;color:var(--dsw-alias-label-primary);
  transition:background .15s ease,border-color .15s ease}
.dsh-eye-care-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-eye-care-btn:focus-visible{outline:2px solid var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary));
  outline-offset:2px}
.dsh-eye-care-btn-primary{border-color:var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary));
  color:var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary));
  background:color-mix(in srgb, var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary)) 12%, transparent)}
.dsh-eye-care-btn-primary:hover{background:color-mix(in srgb,
  var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary)) 22%, transparent)}
.dsh-eye-care-pill{appearance:none;display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12px;
  line-height:1;padding:5px 10px;border-radius:999px;cursor:pointer;border:1px solid transparent;
  background:transparent;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;
  transition:color .15s ease,background .15s ease,border-color .15s ease}
.dsh-eye-care-pill:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-border-l1)}
.dsh-eye-care-pill:focus-visible{outline:2px solid var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary));
  outline-offset:2px}
.dsh-eye-care-pill[data-paused="true"]{color:var(--dsw-alias-state-idle-primary)}
.dsh-eye-care-pill-icon{flex:none;display:block;
  color:var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary))}
.dsh-eye-care-pill[data-paused="true"] .dsh-eye-care-pill-icon{color:var(--dsw-alias-state-idle-primary)}
.dsh-eye-care-row{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;
  padding:10px 0;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-eye-care-row-text{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsh-eye-care-row-title{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-eye-care-row-desc{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-eye-care-row-controls{display:flex;align-items:center;gap:14px;flex:none;flex-wrap:wrap;
  justify-content:flex-end}
.dsh-eye-care-field{display:inline-flex;align-items:center;gap:6px}
.dsh-eye-care-number{appearance:textfield;-moz-appearance:textfield;font:inherit;font-size:12.5px;
  height:28px;width:56px;padding:0 8px;text-align:center;box-sizing:border-box;
  border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dsh-eye-care-number::-webkit-outer-spin-button,.dsh-eye-care-number::-webkit-inner-spin-button{
  -webkit-appearance:none;margin:0}
.dsh-eye-care-number:focus-visible{outline:2px solid var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary));
  outline-offset:2px;border-color:transparent}
.dsh-eye-care-unit{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsh-eye-care-swatches{display:inline-flex;align-items:center;gap:6px}
.dsh-eye-care-swatch{position:relative;appearance:none;width:20px;height:20px;padding:0;border-radius:50%;
  cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:transparent;
  display:inline-flex;align-items:center;justify-content:center;transition:box-shadow .15s ease}
.dsh-eye-care-swatch:hover{box-shadow:0 0 0 3px color-mix(in srgb, var(--dsh-eye-care-accent,
  var(--dsw-alias-brand-primary)) 16%, transparent)}
.dsh-eye-care-swatch:focus-visible{outline:2px solid var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary));
  outline-offset:2px}
.dsh-eye-care-swatch-dot{display:block;width:14px;height:14px;border-radius:50%;
  background:var(--dsh-eye-care-swatch, var(--dsw-alias-brand-primary))}
.dsh-eye-care-swatch-on{border-color:var(--dsh-eye-care-swatch, var(--dsw-alias-brand-primary));
  box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1),0 0 0 3.5px var(--dsh-eye-care-swatch,
  var(--dsw-alias-brand-primary))}
.dsh-eye-care-swatch-tick{position:absolute;font-size:10px;line-height:1;color:var(--dsw-alias-bg-base);
  font-weight:700;pointer-events:none}
.dsh-eye-care-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;
  transition:background .15s ease,border-color .15s ease}
.dsh-eye-care-switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;
  border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s ease}
.dsh-eye-care-switch[aria-checked="true"]{background:var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary));
  border-color:var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary))}
.dsh-eye-care-switch[aria-checked="true"]::after{transform:translateX(16px)}
.dsh-eye-care-switch:focus-visible{outline:2px solid var(--dsh-eye-care-accent, var(--dsw-alias-brand-primary));
  outline-offset:2px}
@media (max-width:620px){
  .dsh-eye-care-row{flex-direction:column;align-items:flex-start}
  .dsh-eye-care-row-controls{width:100%;justify-content:flex-end}
}
@media (prefers-reduced-motion:reduce){
  .dsh-eye-care-card{animation:none}
  .dsh-eye-care-btn,.dsh-eye-care-pill,.dsh-eye-care-switch,.dsh-eye-care-swatch{transition:none}
}
`;

    function EyeIcon() {
      return h(
        'svg',
        { className: 'dsh-eye-care-pill-icon', viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': 'true' },
        h('path', {
          d: 'M1 8s2.6-4.2 7-4.2S15 8 15 8s-2.6 4.2-7 4.2S1 8 1 8Z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: 8, cy: 8, r: 2.1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
      );
    }

    function usePrefersReducedMotion() {
      const query = '(prefers-reduced-motion: reduce)';
      const [reduced, setReduced] = React.useState(() => {
        try {
          return window.matchMedia(query).matches;
        } catch {
          return false;
        }
      });
      React.useEffect(() => {
        let media;
        try {
          media = window.matchMedia(query);
        } catch {
          return undefined;
        }
        const publish = () => setReduced(media.matches);
        publish();
        if (media.addEventListener) media.addEventListener('change', publish);
        else if (media.addListener) media.addListener(publish);
        return () => {
          if (media.removeEventListener) media.removeEventListener('change', publish);
          else if (media.removeListener) media.removeListener(publish);
        };
      }, []);
      return reduced;
    }

    /**
     * Break ring driven by `requestAnimationFrame`.
     *
     * The store publishes once per second, so a ring drawn from its snapshot
     * would step instead of sweep. This component reads the store's live value
     * every frame and writes the arc and the seconds straight into the DOM,
     * which keeps the sweep smooth without re-rendering the card 60 times a
     * second. Reduced-motion users get one update per second instead.
     */
    function CountdownRing() {
      const arcRef = React.useRef(null);
      const numberRef = React.useRef(null);
      const reduced = usePrefersReducedMotion();
      const radius = 20;
      const circumference = 2 * Math.PI * radius;

      React.useEffect(() => {
        if (!store) return undefined;
        let frame = 0;
        let shownSeconds = -1;

        const paint = () => {
          const current = store;
          if (!current) return;
          const remaining = current.liveRestRemainingMs();
          const total = Math.max(1000, current.breakSeconds() * 1000);
          const fraction = Math.max(0, Math.min(1, remaining / total));
          if (arcRef.current) {
            arcRef.current.setAttribute('stroke-dashoffset', String(circumference * (1 - fraction)));
          }
          const seconds = Math.max(1, Math.ceil(remaining / 1000));
          if (seconds !== shownSeconds && numberRef.current) {
            shownSeconds = seconds;
            numberRef.current.textContent = String(seconds);
          }
        };

        paint();
        if (reduced) {
          const interval = window.setInterval(paint, 1000);
          return () => window.clearInterval(interval);
        }
        const loop = () => {
          paint();
          frame = window.requestAnimationFrame(loop);
        };
        frame = window.requestAnimationFrame(loop);
        return () => window.cancelAnimationFrame(frame);
      }, [reduced, circumference]);

      return h(
        'svg',
        { className: 'dsh-eye-care-ring', viewBox: '0 0 48 48', 'aria-hidden': 'true' },
        h('circle', {
          cx: 24,
          cy: 24,
          r: radius,
          fill: 'none',
          strokeWidth: 4,
          className: 'dsh-eye-care-ring-track',
        }),
        h('circle', {
          ref: arcRef,
          cx: 24,
          cy: 24,
          r: radius,
          fill: 'none',
          strokeWidth: 4,
          strokeLinecap: 'round',
          strokeDasharray: circumference,
          strokeDashoffset: 0,
          transform: 'rotate(-90 24 24)',
          className: 'dsh-eye-care-ring-value',
        }),
        h(
          'text',
          {
            ref: numberRef,
            x: 24,
            y: 24,
            textAnchor: 'middle',
            dominantBaseline: 'central',
            className: 'dsh-eye-care-ring-num',
          },
          '',
        ),
      );
    }

    function ReminderCard() {
      useLocaleRevision();
      const state = useEyeCare();
      const resting = state.phase === 'resting';

      React.useEffect(() => {
        if (!resting) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            if (store) store.snooze();
          }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [resting]);

      if (!resting) return null;

      const accent = accentById(state.settings.accent);

      return h(
        'div',
        { className: 'dsh-eye-care-anchor', style: { '--dsh-eye-care-accent': accent.value } },
        h(
          'div',
          { className: 'dsh-eye-care-card', role: 'status', 'aria-live': 'polite' },
          h(CountdownRing, null),
          h(
            'div',
            { className: 'dsh-eye-care-body' },
            h('div', { className: 'dsh-eye-care-title' }, t('reminderTitle')),
            h('div', { className: 'dsh-eye-care-desc' }, t('reminderBody')),
            h(
              'div',
              { className: 'dsh-eye-care-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-eye-care-btn dsh-eye-care-btn-primary',
                  onClick: () => store && store.finish(),
                },
                t('done'),
              ),
              h(
                'button',
                { type: 'button', className: 'dsh-eye-care-btn', onClick: () => store && store.snooze() },
                t('snooze'),
              ),
            ),
          ),
        ),
      );
    }

    function CountdownPill() {
      useLocaleRevision();
      const state = useEyeCare();
      const paused = state.phase === 'paused';
      const label = paused ? t('pillPaused') : t('pillLabel') + ' ' + formatClock(state.remainingMs);
      const title = paused ? t('pillTipResume') : t('pillTipPause');
      const accent = accentById(state.settings.accent);

      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-eye-care-pill',
          'data-paused': paused ? 'true' : 'false',
          'aria-pressed': paused ? 'true' : 'false',
          title,
          'aria-label': title + ' — ' + label,
          style: { '--dsh-eye-care-accent': accent.value },
          onClick: () => {
            if (store) store.toggleEnabled();
          },
        },
        h(EyeIcon, null),
        h('span', null, label),
      );
    }

    /** Free-form minute input: commits on blur or Enter, clamped into range. */
    function IntervalField({ value, disabled }) {
      const [draft, setDraft] = React.useState(String(value));
      React.useEffect(() => {
        setDraft(String(value));
      }, [value]);

      const commit = () => {
        const trimmed = draft.trim();
        if (trimmed === '') {
          setDraft(String(value));
          return;
        }
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) {
          setDraft(String(value));
          return;
        }
        const next = clampInterval(parsed);
        setDraft(String(next));
        if (next !== value && store) store.update({ intervalMinutes: next });
      };

      return h('input', {
        type: 'number',
        className: 'dsh-eye-care-number',
        inputMode: 'numeric',
        min: MIN_INTERVAL,
        max: MAX_INTERVAL,
        step: 1,
        value: draft,
        disabled,
        'aria-label': t('intervalLabel'),
        title: t('intervalRange'),
        onChange: (event) => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        },
      });
    }

    function AccentPicker({ value, disabled }) {
      return h(
        'div',
        { className: 'dsh-eye-care-swatches', role: 'radiogroup', 'aria-label': t('accentLabel') },
        ACCENTS.map((accent) =>
          h(
            'button',
            {
              key: accent.id,
              type: 'button',
              role: 'radio',
              'aria-checked': value === accent.id ? 'true' : 'false',
              'aria-label': accentLabel(accent),
              title: accentLabel(accent),
              className:
                'dsh-eye-care-swatch' + (value === accent.id ? ' dsh-eye-care-swatch-on' : ''),
              style: { '--dsh-eye-care-swatch': accent.value },
              disabled,
              onClick: () => {
                if (store) store.update({ accent: accent.id });
              },
            },
            h('span', { className: 'dsh-eye-care-swatch-dot' }),
            value === accent.id
              ? h('span', { className: 'dsh-eye-care-swatch-tick', 'aria-hidden': 'true' }, '✓')
              : null,
          ),
        ),
      );
    }

    function SettingsRow() {
      useLocaleRevision();
      const settings = useSettings();
      const accent = accentById(settings.accent);

      return h(
        'div',
        { className: 'dsh-eye-care-row', style: { '--dsh-eye-care-accent': accent.value } },
        h(
          'div',
          { className: 'dsh-eye-care-row-text' },
          h('div', { className: 'dsh-eye-care-row-title' }, t('settingsTitle')),
          h('div', { className: 'dsh-eye-care-row-desc' }, t('settingsDesc')),
        ),
        h(
          'div',
          { className: 'dsh-eye-care-row-controls' },
          h(
            'div',
            { className: 'dsh-eye-care-field' },
            h(IntervalField, { value: settings.intervalMinutes, disabled: !settings.enabled }),
            h('span', { className: 'dsh-eye-care-unit' }, t('minuteUnit')),
          ),
          h(AccentPicker, { value: settings.accent, disabled: !settings.enabled }),
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': settings.enabled ? 'true' : 'false',
            'aria-label': t('enableLabel'),
            title: t('enableLabel'),
            className: 'dsh-eye-care-switch',
            onClick: () => {
              if (store) store.toggleEnabled();
            },
          }),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        store = createStore();

        const locale = ctx.get('locale');
        if (locale) {
          ctx.effect(() => {
            const disposers = [];
            for (const id of ['zh', 'en']) {
              try {
                disposers.push(locale.register(NS, id, TEXTS[id]));
              } catch {
                /* another owner already registered this namespace */
              }
            }
            try {
              translate = locale.bind(NS);
              localeFace = locale;
            } catch {
              translate = null;
              localeFace = null;
            }
            return () => {
              translate = null;
              localeFace = null;
              disposers.forEach((dispose) => {
                try {
                  dispose();
                } catch {
                  /* already removed */
                }
              });
            };
          }, 'eye-care: dictionaries');
        }

        ctx.effect(() => {
          const style = document.createElement('style');
          style.setAttribute('data-dsh-eye-care', '');
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => {
            if (style.parentNode) style.parentNode.removeChild(style);
          };
        }, 'eye-care: styles');

        ctx.effect(() => {
          store.start();
          return () => store.stop();
        }, 'eye-care: timer');

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'eye-care-reminder', order: 30 }, ReminderCard),
        );

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({ name: 'conversation.composer.dock', id: 'eye-care-pill', order: 6 }, CountdownPill),
        );

        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register({ name: 'settings.general.item', id: 'eye-care', order: 22 }, SettingsRow),
        );
      },
    };
  },
});
