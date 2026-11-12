import React, { useState, useEffect, useRef } from 'react';
import useSettingsStore, { SCROLLBAR_PRESETS } from '../../store/useSettingsStore';
import useReaderStore from '../../store/useReaderStore';
import useAppStore from '../../store/useAppStore';
import KeybindRecorder from './KeybindRecorder';
import Icons from '../../components/common/Icons';
import StorageSection from '../../components/common/StorageSection';
import SliderControls from '../../components/library/SliderControls';
import { coreApi } from '../../services/coreApi';
import annotationLocalBackup from '../../services/annotationLocalBackup';

// مرحله ۷ ـ بخش الف: دیگر هیچ نگاشتِ موازیِ عنوان/دسته در این
// فایل نیست. ردیف‌های میانبر، مستقیماً از ورودی‌های استور
// (shortcuts) رندر می‌شوند؛ پس هر ورودیِ جدیدِ استور (مثلِ
// undoAnnotation یا toggleLeftSidebar) خودبه‌خود این‌جا هم دیده
// می‌شود و عنوان/دسته، فقط در یک جا تعریف شده است.


// مرحلهٔ ۵۵ §۳: مرکزِ بروزرسانی (PandaReader Update Center) —
// قراردادِ IPC (سمتِ main/preload، کارِ m2):
//   کانال‌ها: 'get-app-version' ،'check-for-updates' ،'download-update' ،
//   'quit-and-install-update' ،'app-update-status'.
//   رپرهایِ موردِ انتظارِ coreApi: getAppVersion ،checkForUpdates ،
//   downloadUpdate ،quitAndInstallUpdate ،onUpdateStatus.
//   اگر رپرِ تازه هنوز در coreApi نباشد، این فایل از window.api یا
//   getAppInfoِ موجود (کانالِ 'get-app-info') استفاده می‌کند و هرگز
//   کرش نمی‌کند؛ پس ترتیبِ قرارگیریِ استیج‌ها مهم نیست.
//   سه تابعِ زیر خالص‌اند (بدونِ وابستگی به React) تا ماشینِ وضعیت،
//   در Node هم با coreApiِ ساختگی تست شود.
// مرحلهٔ ۵۷ §۳ (m3): بررسیِ دوموتوره — REST عمومیِ گیت‌هاب
// (بدونِ توکن) + electron-updater در نسخهٔ نصبی؛ دانلودِ مستقیمِ
// .exe در حالتِ Portable/توسعه؛ مودالِ هوشمندِ یادآوری در App و
// سوییچِ «بررسی و یادآوریِ خودکارِ آپدیت‌ها» این‌جا و در مودال.

// مرحلهٔ ۵۵ §۳: نرمال‌سازیِ پاسخِ نسخه — رشتهٔ خالی، آبجکتِ
// { version, isPackaged } یا { success, version, isPackaged }، همه به
// یک شکل برمی‌گردند. isPackaged فقط وقتی معتبر است که main آن را
// واقعاً گفته باشد (envKnown)؛ وگرنه محیط «نامشخص» است و دکمه‌ها
// غیرفعال نمی‌شوند.
export function normalizeAppVersionInfo(raw) {
  if (typeof raw === 'string') {
    return { version: raw.trim(), isPackaged: false, envKnown: false };
  }
  if (raw && typeof raw === 'object') {
    const version = typeof raw.version === 'string' ? raw.version.trim() : '';
    const packaged = typeof raw.isPackaged === 'boolean'
      ? raw.isPackaged
      : (typeof raw.packaged === 'boolean' ? raw.packaged : null);
    return {
      version,
      isPackaged: packaged === true,
      envKnown: packaged !== null,
    };
  }
  return { version: '', isPackaged: false, envKnown: false };
}

// مرحلهٔ ۵۵ §۳: برداشتنِ رپرهایِ آپدیت از coreApi؛ اگر رپری نبود،
// window.apiِ مستقیم هم دیده می‌شود. هر رپرِ پیدا نشده، null است و
// فراخواننده باید مسیرِ جایگزین (fallback) را برود، نه این‌که کرش کند.
export function resolveUpdateApi(api) {
  const winApi = (typeof window !== 'undefined' && window.api) || null;
  const pick = (...fns) => {
    for (let i = 0; i < fns.length; i++) {
      if (typeof fns[i] === 'function') return fns[i];
    }
    return null;
  };
  return {
    getAppVersion: pick(api && api.getAppVersion, winApi && winApi.getAppVersion),
    getAppInfo: pick(api && api.getAppInfo, winApi && winApi.getAppInfo),
    checkForUpdates: pick(api && api.checkForUpdates, winApi && winApi.checkForUpdates),
    downloadUpdate: pick(api && api.downloadUpdate, winApi && winApi.downloadUpdate),
    quitAndInstallUpdate: pick(api && api.quitAndInstallUpdate, winApi && winApi.quitAndInstallUpdate),
    downloadUpdateDirect: pick(api && api.downloadUpdateDirect, winApi && winApi.downloadUpdateDirect),
    installDownloadedUpdate: pick(api && api.installDownloadedUpdate, winApi && winApi.installDownloadedUpdate),
    onUpdateStatus: pick(api && api.onUpdateStatus, winApi && winApi.onUpdateStatus),
  };
}

// مرحلهٔ ۵۵ §۳: رویدادِ خامِ کانالِ 'app-update-status' را به یک شکلِ
// واحد برمی‌گرداند: { kind, version, percent, message }.
// kindها: 'checking' | 'available' | 'not-available' |
// 'downloading' | 'downloaded' | 'error' | 'unknown'.
// هم رشته ('update-available') و هم آبجکت ({ type/status/event })
// قبول است، چون شکلِ دقیقِ payload دستِ main است (m2).
export function normalizeUpdateEvent(raw) {
  const empty = { kind: 'unknown', version: '', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, message: '' };
  if (typeof raw === 'string') {
    const key = raw.trim().toLowerCase().replace(/_/g, '-');
    if (key === 'checking' || key === 'checking-for-update') return { ...empty, kind: 'checking' };
    if (key === 'update-available' || key === 'available') return { ...empty, kind: 'available' };
    if (key === 'update-not-available' || key === 'not-available' || key === 'up-to-date') return { ...empty, kind: 'not-available' };
    if (key === 'download-progress' || key === 'downloading') return { ...empty, kind: 'downloading', percent: 0 };
    if (key === 'update-downloaded' || key === 'downloaded') return { ...empty, kind: 'downloaded', percent: 100 };
    if (key === 'error') return { ...empty, kind: 'error' };
    return empty;
  }
  if (raw && typeof raw === 'object') {
    const keyRaw = raw.type || raw.status || raw.event || raw.kind || '';
    const key = String(keyRaw).trim().toLowerCase().replace(/_/g, '-');
    const version = typeof raw.version === 'string'
      ? raw.version
      : (raw.info && typeof raw.info.version === 'string'
        ? raw.info.version
        : (raw.updateInfo && typeof raw.updateInfo.version === 'string' ? raw.updateInfo.version : ''));
    let percent = 0;
    if (typeof raw.percent === 'number') percent = raw.percent;
    else if (typeof raw.progress === 'number') percent = raw.progress;
    else if (typeof raw.percentComplete === 'number') percent = raw.percentComplete;
    else if (typeof raw.transferred === 'number' && typeof raw.total === 'number' && raw.total > 0) {
      percent = (raw.transferred / raw.total) * 100;
    }
    const transferred = typeof raw.transferred === 'number' ? raw.transferred : 0;
    const total = typeof raw.total === 'number' ? raw.total : 0;
    const bytesPerSecond = typeof raw.bytesPerSecond === 'number' ? raw.bytesPerSecond : 0;
    const message = typeof raw.message === 'string'
      ? raw.message
      : (typeof raw.error === 'string' ? raw.error : '');
    if (key === 'checking' || key === 'checking-for-update') return { kind: 'checking', version, percent: 0, message };
    if (key === 'update-available' || key === 'available') return { kind: 'available', version, percent: 0, message };
    if (key === 'update-not-available' || key === 'not-available' || key === 'up-to-date') return { kind: 'not-available', version, percent: 0, message };
    if (key === 'download-progress' || key === 'downloading') return { kind: 'downloading', version, percent, transferred, total, bytesPerSecond, message };
    if (key === 'update-downloaded' || key === 'downloaded') return { kind: 'downloaded', version, percent: 100, transferred, total, bytesPerSecond, message };
    if (key === 'error') return { kind: 'error', version, percent: 0, message };
    return empty;
  }
  return empty;
}

// مرحلهٔ ۵۵ §۳: نرمال‌سازیِ نتیجهٔ مستقیمِ checkForUpdates —
// main ممکن است { updateAvailable, version } برگرداند یا فقط رویداد
// بفرستد. updateAvailable === null یعنی «نتیجهٔ مستقیم نیست؛ منتظرِ
// رویداد بمان».
export function normalizeUpdateResult(result) {
  if (typeof result === 'boolean') return { updateAvailable: result, version: '' };
  if (result && typeof result === 'object') {
    const flag = (typeof result.updateAvailable === 'boolean')
      ? result.updateAvailable
      : (typeof result.available === 'boolean'
        ? result.available
        : (typeof result.hasUpdate === 'boolean' ? result.hasUpdate : null));
    const version = typeof result.version === 'string'
      ? result.version
      : (result.info && typeof result.info.version === 'string'
        ? result.info.version
        : (result.updateInfo && typeof result.updateInfo.version === 'string' ? result.updateInfo.version : ''));
    return { updateAvailable: flag, version };
  }
  return { updateAvailable: null, version: '' };
}

// مرحلهٔ ۵۵ §۳: ماشینِ وضعیتِ کارتِ بروزرسانی — تابعِ خالص.
// وضعیت‌ها: 'idle' | 'checking' | 'up-to-date' | 'available' |
// 'downloading' | 'downloaded' | 'error'.
// رشته‌هایِ دقیقِ پرامپت، فقط این‌جا تعریف شده‌اند:
//   checking: «در حال بررسی ارتباط با گیت‌هاب...»
//   up-to-date: «نرم‌افزار شما به آخرین نسخه بروز است.»
export function mapUpdateEventToState(prev, event) {
  const base = prev || { status: 'idle', version: '', progress: 0, message: '' };
  const ev = normalizeUpdateEvent(event);
  if (ev.kind === 'checking') {
    return { ...base, status: 'checking', progress: 0, message: 'در حال بررسی ارتباط با گیت‌هاب...' };
  }
  if (ev.kind === 'available') {
    return { ...base, status: 'available', version: ev.version || base.version, progress: 0, message: '' };
  }
  if (ev.kind === 'not-available') {
    return { ...base, status: 'up-to-date', progress: 0, message: 'نرم‌افزار شما به آخرین نسخه بروز است.' };
  }
  if (ev.kind === 'downloading') {
    const pct = Number.isFinite(ev.percent) ? Math.max(0, Math.min(100, ev.percent)) : 0;
    return { ...base, status: 'downloading', progress: pct, transferred: ev.transferred || 0, total: ev.total || 0, bytesPerSecond: ev.bytesPerSecond || 0, message: '' };
  }
  if (ev.kind === 'downloaded') {
    return { ...base, status: 'downloaded', progress: 100, transferred: ev.transferred || base.transferred || 0, total: ev.total || base.total || 0, bytesPerSecond: 0, message: '' };
  }
  if (ev.kind === 'error') {
    return { ...base, status: 'error', message: ev.message || 'بررسی بروزرسانی انجام نشد؛ اتصال اینترنت را بررسی کنید.' };
  }
  return base;
}

export default function SettingsView() {
  // مرحلهٔ ۴۴ §۵ (OPT-02): اشتراکِ هدفمندِ استورها — هر کلید با
  // سلکتورِ جدا خوانده می‌شود تا تغییرِ کلیدهایِ نامربوط، این پنل را
  // ری‌رندر نکند. مقدارهایِ پیش‌فرض (مرحلهٔ ۴۱) همان قراردادِ
  // پیشین‌اند و با ?? حفظ شده‌اند تا اگر استور هنوز کلیدی را
  // نداشت، رفتار عوض نشود.
  const shortcuts = useSettingsStore((s) => s.shortcuts);
  const preferences = useSettingsStore((s) => s.preferences);
  const updateShortcut = useSettingsStore((s) => s.updateShortcut);
  const resetShortcutsToDefault = useSettingsStore((s) => s.resetShortcutsToDefault);
  const updatePreference = useSettingsStore((s) => s.updatePreference);
  const resetPreferences = useSettingsStore((s) => s.resetPreferences);
  const setHeroSliderVariant = useSettingsStore((s) => s.setHeroSliderVariant);
  const cbzDefaultZoom = useSettingsStore((s) => s.cbzDefaultZoom ?? 165);
  const cbzDefaultViewMode = useSettingsStore((s) => s.cbzDefaultViewMode ?? 'horizontal-paged');
  const epubDefaultZoom = useSettingsStore((s) => s.epubDefaultZoom ?? 100);
  const epubDefaultViewMode = useSettingsStore((s) => s.epubDefaultViewMode ?? 'vertical');
  const readerBackdropColor = useSettingsStore((s) => s.readerBackdropColor ?? '#2b3038');
  // مرحلهٔ ۵۲ §۳: گرادیانِ اسکرول‌بارِ صفحات (آینهٔ سطحِ استور؛
  // پیش‌فرض‌ها همان قراردادِ مرحلهٔ ۴۱ با ?? حفظ شده‌اند).
  const scrollbarPresetId = useSettingsStore((s) => s.scrollbarPresetId ?? 'neon-cyan-purple');
  const scrollbarColorStart = useSettingsStore((s) => s.scrollbarColorStart ?? '#22d3ee');
  const scrollbarColorEnd = useSettingsStore((s) => s.scrollbarColorEnd ?? '#a78bfa');
  const setScrollbarGradient = useSettingsStore((s) => s.setScrollbarGradient);
  const setCbzDefaultZoom = useSettingsStore((s) => s.setCbzDefaultZoom);
  const setCbzDefaultViewMode = useSettingsStore((s) => s.setCbzDefaultViewMode);
  const setEpubDefaultZoom = useSettingsStore((s) => s.setEpubDefaultZoom);
  const setEpubDefaultViewMode = useSettingsStore((s) => s.setEpubDefaultViewMode);
  const setReaderBackdropColor = useSettingsStore((s) => s.setReaderBackdropColor);

  const setZoomLevel = useReaderStore((s) => s.setZoomLevel);
  const showToast = useAppStore((state) => state.showToast);

  // مرحلهٔ ۵۷ §۳ (m3): خواندنِ امنِ انتخاب‌هایِ بروزرسانی از coreApi؛
  // اگر coreApiِ قدیمی آن‌ها را نداشت، مقدارِ پیش‌فرض برمی‌گردد و
  // کارت کرش نمی‌کند.
  const readSkippedVersionSafe = () => {
    try {
      if (coreApi && typeof coreApi.readSkippedUpdateVersion === 'function') return coreApi.readSkippedUpdateVersion() || '';
    } catch (_) {}
    return '';
  };
  const readAutoCheckSafe = () => {
    try {
      if (coreApi && typeof coreApi.readAutoCheckUpdatesEnabled === 'function') return coreApi.readAutoCheckUpdatesEnabled();
    } catch (_) {}
    return true;
  };

  // مرحلهٔ ۵۷ §۳ (m3): نرمال‌سازیِ نتیجهٔ مستقیمِ checkForUpdates؛
  // اگر coreApiِ قدیمی آن را نداشت، شکلِ خامِ هندلر مستقیم خوانده
  // می‌شود تا کارت کرش نکند.
  const normalizeCheckResult = (result) => {
    try {
      if (coreApi && typeof coreApi.normalizeCheckForUpdatesResult === 'function') {
        return coreApi.normalizeCheckForUpdatesResult(result, updateInfo.version || '');
      }
    } catch (_) {}
    if (!result || typeof result !== 'object') return null;
    return {
      updateAvailable: typeof result.updateAvailable === 'boolean' ? result.updateAvailable : null,
      latestVersion: typeof result.latestVersion === 'string' ? result.latestVersion : '',
      releaseNotes: typeof result.releaseNotes === 'string' ? result.releaseNotes : '',
      publishedAt: typeof result.publishedAt === 'string' ? result.publishedAt : '',
      downloadUrl: typeof result.downloadUrl === 'string' ? result.downloadUrl : '',
      htmlUrl: typeof result.htmlUrl === 'string' ? result.htmlUrl : '',
      currentVersion: typeof result.version === 'string' ? result.version : '',
      status: typeof result.status === 'string' ? result.status : 'checked',
      message: typeof result.message === 'string' ? result.message : '',
    };
  };

  // مرحلهٔ ۵۷ §۳ (m3): تاریخِ انتشارِ ISO به تاریخِ فارسی؛ ورودیِ
  // نامعتبر، رشتهٔ خالی می‌دهد و کارت کرش نمی‌کند.
  const formatReleaseDate = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleDateString('fa-IR');
    } catch (_) { return ''; }
  };

  // مرحلهٔ ۵۷ §۳ (m3): برچسبِ پیشرفتِ دانلود با درصد، حجم و سرعت.
  const formatDownloadProgressLabel = (state) => {
    const pct = Math.max(0, Math.min(100, Math.round(state.progress || 0)));
    let label = `در حال دانلود… ${pct}٪`;
    try {
      if (coreApi && typeof coreApi.formatBytes === 'function' && state.total > 0) {
        label += ` • ${coreApi.formatBytes(state.transferred || 0)} از ${coreApi.formatBytes(state.total)}`;
      }
      if (coreApi && typeof coreApi.formatDownloadSpeed === 'function' && state.bytesPerSecond > 0) {
        label += ` • ${coreApi.formatDownloadSpeed(state.bytesPerSecond)}`;
      }
    } catch (_) {}
    return label;
  };

  const [activeTab, setActiveTab] = useState('shortcuts'); // 'shortcuts' | 'reader' | 'formats' | 'storage'

  // مرحله ۵ ـ بخش الف: پشتیبان‌گیری و بازیابیِ یک‌کلیکی.
  const [backupBusy, setBackupBusy] = useState(null); // null | 'export' | 'import'
  const [backupStatus, setBackupStatus] = useState('');
  // مرحله 41: پیش‌نویس‌های محلی ورودی‌های عددی و متنی؛ کاربر
  // می‌تواند مقدار میانی (مثلاً خالی یا ناقص) را تایپ کند و مقدار
  // نهایی فقط هنگام blur یا Enter در استور ذخیره می‌شود.
  const [cbzZoomDraft, setCbzZoomDraft] = useState(null);
  const [epubZoomDraft, setEpubZoomDraft] = useState(null);
  const [hexDraft, setHexDraft] = useState(null);
  const [hexError, setHexError] = useState('');
  // مرحلهٔ ۵۲ §۳: پیش‌نویس‌هایِ محلیِ دو ورودیِ HEX گرادیانِ
  // اسکرول‌بار؛ مثلِ hexDraft مرحلهٔ ۴۱، مقدارِ میانیِ ناقص فقط
  // در پیش‌نویس می‌ماند و استور فقط مقدارِ معتبر می‌گیرد.
  const [sbStartHexDraft, setSbStartHexDraft] = useState(null);
  const [sbEndHexDraft, setSbEndHexDraft] = useState(null);
  const [sbHexError, setSbHexError] = useState('');
  const [lastBackup, setLastBackup] = useState(() => {
    try {
      const raw = window.localStorage.getItem('comicReader.lastBackup');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.at) return parsed;
    } catch (_) {}
    return null;
  });

  // مرحلهٔ ۵۵ §۳: مرکزِ بروزرسانی — نسخهٔ فعلی + وضعیتِ بررسی/
  // دانلود/نصب. همهٔ هوک‌هایِ این کارت این‌جا، بالایِ کامپوننت و
  // پیش از هر returnِ شرطی‌اند (در این کامپوننت، returnِ شرطیِ
  // زودهنگام نیست؛ ترتیبِ هوک‌ها همیشه ثابت است).
  const [updateInfo, setUpdateInfo] = useState({ version: '', isPackaged: false, envKnown: false, loaded: false });
  const [updateState, setUpdateState] = useState({ status: 'idle', version: '', latestVersion: '', releaseNotes: '', publishedAt: '', downloadUrl: '', htmlUrl: '', directFilePath: '', progress: 0, transferred: 0, total: 0, bytesPerSecond: 0, message: '' });
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(() => readAutoCheckSafe());
  const [skippedVersion, setSkippedVersion] = useState(() => readSkippedVersionSafe());
  const updateUnsubscribeRef = useRef(null);
  const updateCheckTimeoutRef = useRef(null);
  const updateMountedRef = useRef(true);

  // مرحلهٔ ۵۵ §۳: پاک‌کردنِ نگهبانِ ۳۰ ثانیه‌ای (اگر تایمری نباشد،
  // هیچ کاری نمی‌کند).
  const clearUpdateCheckTimeout = () => {
    if (updateCheckTimeoutRef.current) {
      clearTimeout(updateCheckTimeoutRef.current);
      updateCheckTimeoutRef.current = null;
    }
  };

  // مرحلهٔ ۵۷ §۳ (m3): خواندنِ نسخهٔ فعلی + محیط، جدا از افکتِ
  // مونت شد تا دکمهٔ «بررسی» هم بتواند همان را تازه کند (هر کلیک،
  // هم اطلاعاتِ محلی را تازه می‌کند و هم گیت‌هاب را چک می‌کند).
  const loadLocalVersion = async () => {
    const api = resolveUpdateApi(coreApi);
    let info = { version: '', isPackaged: false, envKnown: false };
    try {
      if (api.getAppVersion) info = normalizeAppVersionInfo(await api.getAppVersion());
    } catch (_) {
      info = { version: '', isPackaged: false, envKnown: false };
    }
    if (!info.version && !info.envKnown && api.getAppInfo) {
      try {
        info = normalizeAppVersionInfo(await api.getAppInfo());
      } catch (_) {}
    }
    if (updateMountedRef.current) {
      setUpdateInfo({
        version: info.version || '',
        isPackaged: Boolean(info.isPackaged),
        envKnown: Boolean(info.envKnown),
        loaded: true,
      });
    }
    return info;
  };

  useEffect(() => {
    updateMountedRef.current = true;
    const api = resolveUpdateApi(coreApi);
    let cancelled = false;
    // ۱) خواندنِ نسخهٔ فعلی + محیط (نصبی/توسعه) — اول از کانالِ
    // تازهٔ 'get-app-version'، و اگر نبود یا خطا داد، از getAppInfoِ
    // موجود (کانالِ 'get-app-info' که version و isPackaged می‌دهد).
    // هر دو مسیر که نباشند، کارت با نسخهٔ خالی و محیطِ «نامشخص»
    // رندر می‌شود و کرش نمی‌کند.
    loadLocalVersion();
    setSkippedVersion(readSkippedVersionSafe());
    // ۲) اشتراکِ رویدادهایِ زندهٔ آپدیت (کانالِ 'app-update-status').
    // onUpdateStatus تابعِ لغوِ اشتراک برمی‌گرداند؛ در cleanup صدا
    // زده می‌شود تا شنونده نشت نکند (الگویِ onPdfCopyProgress).
    try {
      if (api.onUpdateStatus) {
        const off = api.onUpdateStatus((rawEvent) => {
          if (!updateMountedRef.current) return;
          clearUpdateCheckTimeout();
          setUpdateState((prev) => mapUpdateEventToState(prev, rawEvent));
        });
        updateUnsubscribeRef.current = typeof off === 'function' ? off : null;
      }
    } catch (_) {
      updateUnsubscribeRef.current = null;
    }
    return () => {
      cancelled = true;
      updateMountedRef.current = false;
      clearUpdateCheckTimeout();
      try {
        if (updateUnsubscribeRef.current) updateUnsubscribeRef.current();
      } catch (_) {}
      updateUnsubscribeRef.current = null;
    };
  }, []);

  // مرحلهٔ ۵۷ §۳ (m3): هم‌گام‌ماندنِ سوییچِ بررسیِ خودکار با مودالِ
  // یادآوری؛ هر تغییر (از هر جا) با رویداد می‌رسد و نگهبانِ برابری،
  // setStateِ تکراری را نمی‌گذارد.
  useEffect(() => {
    let off = null;
    try {
      if (coreApi && typeof coreApi.onAutoCheckUpdatesChanged === 'function') {
        off = coreApi.onAutoCheckUpdatesChanged((enabled) => {
          if (!updateMountedRef.current) return;
          setAutoCheckEnabled((prev) => (prev === enabled ? prev : enabled));
        });
      }
    } catch (_) { off = null; }
    return () => {
      try { if (typeof off === 'function') off(); } catch (_) {}
    };
  }, []);

  const handleExportBackup = async () => {
    if (backupBusy) return;
    setBackupBusy('export');
    setBackupStatus('در حال ساختِ فایل پشتیبان…');
    try {
      const result = await coreApi.exportBackup();
      if (result && result.canceled) {
        setBackupStatus('ذخیرهٔ فایل پشتیبان لغو شد.');
        return;
      }
      if (result && result.success) {
        const info = { at: new Date().toISOString(), name: (result.filePath || '').split(/[\\/]/).pop() || '', coverCount: result.coverCount || 0 };
        setLastBackup(info);
        try { window.localStorage.setItem('comicReader.lastBackup', JSON.stringify(info)); } catch (_) {}
        setBackupStatus(`فایل پشتیبان ذخیره شد (${result.coverCount || 0} کاور).`);
        showToast('فایل پشتیبان با موفقیت ذخیره شد.', { type: 'success' });
      } else {
        setBackupStatus((result && result.error) || 'ساختِ فایل پشتیبان انجام نشد.');
        showToast((result && result.error) || 'ساختِ فایل پشتیبان انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      const msg = 'خطا در ساختِ فایل پشتیبان: ' + (err && err.message ? err.message : String(err));
      setBackupStatus(msg);
      showToast(msg, { type: 'error' });
    } finally {
      setBackupBusy(null);
    }
  };

  const handleImportBackup = async () => {
    if (backupBusy) return;
    setBackupBusy('import');
    setBackupStatus('در حال بررسی و بازیابیِ فایل پشتیبان…');
    try {
      const result = await coreApi.importBackup();
      if (result && result.canceled) {
        setBackupStatus('بازیابی لغو شد؛ هیچ تغییری انجام نشد.');
        return;
      }
      if (result && result.success) {
        // مرحله ۵ ـ بخش ب: پیش از reload، آینهٔ localStorageِ
        // حاشیه‌نویسی‌ها پاک می‌شود تا کلیدهای قدیمیِ قبل از Restore،
        // دوباره واردِ دیتابیسِ بازیابی‌شده نشوند (دیتابیس، مرجعِ
        // مطلق است). فقط کلیدهای `comicReader.annotations.v1:` پاک
        // می‌شوند؛ `comicReader.lastBackup` و بقیه دست نمی‌خورند.
        try { annotationLocalBackup.clearAllAnnotationBackups(); } catch (_) {}
        setBackupStatus(`بازیابی انجام شد (${result.coverCount || 0} کاور) — برنامه دوباره بارگذاری می‌شود…`);
        showToast('بازیابی انجام شد؛ برنامه دوباره بارگذاری می‌شود.', { type: 'success' });
        setTimeout(() => { window.location.reload(); }, 1200);
      } else {
        setBackupStatus((result && result.error) || 'بازیابیِ فایل پشتیبان انجام نشد؛ اطلاعات فعلی دست‌نخورده باقی ماند.');
        showToast((result && result.error) || 'بازیابی انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      const msg = 'خطا در بازیابیِ فایل پشتیبان: ' + (err && err.message ? err.message : String(err));
      setBackupStatus(msg);
      showToast(msg, { type: 'error' });
    } finally {
      // در حالتِ موفق، reload پس از ۱۲۰۰ میلی‌ثانیه می‌آید؛ finally
      // زودتر اجرا می‌شود و دکمه را آزاد می‌کند تا کاربر، وضعیتِ
      // موفقیت را ببیند.
      setBackupBusy(null);
    }
  };

  // مرحلهٔ ۵۵ §۳: نگهبانِ ۳۰ ثانیه‌ای — اگر main نه رویداد فرستاد و
  // نه جواب داد، کارت در «در حال بررسی…» گیر نمی‌کند و خطایِ
  // اتصال نشان می‌دهد.
  const armUpdateCheckTimeout = () => {
    clearUpdateCheckTimeout();
    updateCheckTimeoutRef.current = setTimeout(() => {
      if (!updateMountedRef.current) return;
      setUpdateState((prev) => (prev.status === 'checking'
        ? { ...prev, status: 'error', message: 'پاسخی از گیت‌هاب نرسید؛ اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.' }
        : prev));
    }, 30000);
  };

  // مرحلهٔ ۵۵ §۳: حالتِ توسعه فقط وقتی قطعی است که main، isPackaged
  // را واقعاً گفته باشد (envKnown). اگر محیط نامشخص باشد، دکمه‌ها
  // فعال می‌مانند تا main جواب بدهد؛ در نسخهٔ نصبی، هرگز به‌اشتباه
  // غیرفعال نمی‌شوند.
  const isDevUpdateMode = updateInfo.loaded && updateInfo.envKnown && !updateInfo.isPackaged;

  // مرحلهٔ ۵۷ §۳ (m3): بررسیِ دستیِ بروزرسانی جدید از گیت‌هاب —
  // هم اطلاعاتِ محلیِ نسخه تازه می‌شود و هم آخرین انتشارِ گیت‌هاب
  // خوانده می‌شود (دکمهٔ بررسی، هر دو را با هم انجام می‌دهد).
  // نتیجهٔ مستقیمِ هندلر (نسخهٔ دقیق + یادداشتِ کامل + لینکِ .exe)
  // مبناست؛ رویدادهایِ موتور فقط پیشرفت را تکمیل می‌کنند. بررسیِ
  // دستی، «manual» است: اگر نسخهٔ تازه پیدا شد، مودالِ یادآوری حتی
  // برایِ نسخهٔ نادیده‌گرفته‌شده هم باز می‌شود.
  const handleCheckForUpdates = async () => {
    const api = resolveUpdateApi(coreApi);
    if (!api.checkForUpdates) {
      setUpdateState((prev) => ({ ...prev, status: 'error', version: '', progress: 0, message: 'سرویسِ بروزرسانی در این نسخه در دسترس نیست.' }));
      return;
    }
    setUpdateState((prev) => ({ ...prev, status: 'checking', progress: 0, message: 'در حال بررسی ارتباط با گیت‌هاب...' }));
    armUpdateCheckTimeout();
    try {
      const results = await Promise.all([api.checkForUpdates(), loadLocalVersion()]);
      if (!updateMountedRef.current) return;
      const norm = normalizeCheckResult(results[0]);
      clearUpdateCheckTimeout();
      setSkippedVersion(readSkippedVersionSafe());
      if (!norm) {
        setUpdateState((prev) => ({ ...prev, status: 'error', message: 'بررسی بروزرسانی انجام نشد.' }));
        return;
      }
      if (norm.updateAvailable === true && norm.latestVersion) {
        setUpdateState((prev) => ({ ...prev, status: 'available', version: norm.latestVersion, latestVersion: norm.latestVersion, releaseNotes: norm.releaseNotes, publishedAt: norm.publishedAt, downloadUrl: norm.downloadUrl, htmlUrl: norm.htmlUrl, directFilePath: '', progress: 0, message: '' }));
        try {
          if (coreApi && typeof coreApi.emitUpdateAvailable === 'function') {
            coreApi.emitUpdateAvailable({ updateAvailable: true, latestVersion: norm.latestVersion, releaseNotes: norm.releaseNotes, publishedAt: norm.publishedAt, downloadUrl: norm.downloadUrl, htmlUrl: norm.htmlUrl, currentVersion: norm.currentVersion || updateInfo.version || '', manual: true });
          }
        } catch (_) {}
      } else if (norm.updateAvailable === false) {
        setUpdateState((prev) => ({ ...prev, status: 'up-to-date', latestVersion: norm.latestVersion, releaseNotes: norm.releaseNotes, publishedAt: norm.publishedAt, downloadUrl: norm.downloadUrl, htmlUrl: norm.htmlUrl, progress: 0, message: 'نرم‌افزار شما به آخرین نسخه بروز است.' }));
      } else if (norm.latestVersion) {
        // نسخهٔ فعلی خوانده نشد؛ فقط آخرین نسخهٔ گیت‌هاب نشان داده
        // می‌شود و مودال هم با نسخهٔ فعلیِ نامشخص باز می‌شود.
        setUpdateState((prev) => ({ ...prev, status: 'available', version: norm.latestVersion, latestVersion: norm.latestVersion, releaseNotes: norm.releaseNotes, publishedAt: norm.publishedAt, downloadUrl: norm.downloadUrl, htmlUrl: norm.htmlUrl, directFilePath: '', progress: 0, message: '' }));
        try {
          if (coreApi && typeof coreApi.emitUpdateAvailable === 'function') {
            coreApi.emitUpdateAvailable({ updateAvailable: true, latestVersion: norm.latestVersion, releaseNotes: norm.releaseNotes, publishedAt: norm.publishedAt, downloadUrl: norm.downloadUrl, htmlUrl: norm.htmlUrl, currentVersion: norm.currentVersion || updateInfo.version || '', manual: true });
          }
        } catch (_) {}
      } else {
        setUpdateState((prev) => ({ ...prev, status: 'error', message: norm.message || 'بررسی بروزرسانی انجام نشد.' }));
      }
    } catch (err) {
      if (!updateMountedRef.current) return;
      clearUpdateCheckTimeout();
      setUpdateState((prev) => ({ ...prev, status: 'error', message: 'بررسی بروزرسانی انجام نشد: ' + (err && err.message ? err.message : 'خطای نامشخص') }));
    }
  };

  // مرحلهٔ ۵۷ §۳ (m3): سوییچِ «بررسی و یادآوریِ خودکارِ آپدیت‌ها» —
  // همان کلیدِ مودالِ یادآوری؛ نوشتن در coreApi، رویدادِ هم‌گام‌سازی
  // می‌فرستد تا مودال هم همان لحظه عوض شود.
  const handleAutoCheckToggle = (next) => {
    const value = next === true;
    setAutoCheckEnabled(value);
    try {
      if (coreApi && typeof coreApi.writeAutoCheckUpdatesEnabled === 'function') {
        coreApi.writeAutoCheckUpdatesEnabled(value);
      }
    } catch (_) {}
  };

  // مرحلهٔ ۵۷ §۳ (m3): دانلودِ نسخهٔ جدید. در نسخهٔ نصبی، موتورِ
  // electron-updater؛ در حالتِ Portable/توسعه، دانلودِ مستقیمِ
  // فایلِ .exe از گیت‌هاب (همان لینکی که REST برگردانده است).
  // تکمیلِ دانلود با رویدادِ 'update-downloaded' یا با نتیجهٔ
  // مستقیمِ invoke می‌رسد و دکمهٔ «نصب و راه‌اندازی مجدد» را روشن
  // می‌کند؛ پیشرفت با رویدادِ 'download-progress' می‌رسد.
  const handleDownloadUpdate = async () => {
    const api = resolveUpdateApi(coreApi);
    const latestVersion = updateState.latestVersion || updateState.version || '';
    const isDirect = !updateInfo.isPackaged;
    if (isDirect) {
      if (!api.downloadUpdateDirect) {
        setUpdateState((prev) => ({ ...prev, status: 'error', message: 'سرویسِ دانلودِ مستقیم در این نسخه در دسترس نیست.' }));
        return;
      }
      if (!updateState.downloadUrl) {
        setUpdateState((prev) => ({ ...prev, status: 'error', message: 'لینکِ دانلودِ نسخهٔ جدید پیدا نشد.' }));
        return;
      }
      setUpdateState((prev) => ({ ...prev, status: 'downloading', progress: 0, transferred: 0, total: 0, bytesPerSecond: 0, message: '' }));
      try {
        const result = await api.downloadUpdateDirect({ downloadUrl: updateState.downloadUrl, version: latestVersion });
        if (!updateMountedRef.current) return;
        if (result && result.success) {
          setUpdateState((prev) => ({ ...prev, status: 'downloaded', progress: 100, directFilePath: result.filePath || '', message: '' }));
        } else {
          setUpdateState((prev) => ({ ...prev, status: 'error', message: (result && result.message) || 'دانلودِ نسخهٔ جدید انجام نشد.' }));
        }
      } catch (err) {
        if (!updateMountedRef.current) return;
        setUpdateState((prev) => ({ ...prev, status: 'error', message: 'دانلودِ بروزرسانی انجام نشد: ' + (err && err.message ? err.message : 'خطای نامشخص') }));
      }
      return;
    }
    if (!api.downloadUpdate) {
      setUpdateState((prev) => ({ ...prev, status: 'error', message: 'سرویسِ دانلودِ بروزرسانی در این نسخه در دسترس نیست.' }));
      return;
    }
    setUpdateState((prev) => ({ ...prev, status: 'downloading', progress: 0, transferred: 0, total: 0, bytesPerSecond: 0, message: '' }));
    try {
      await api.downloadUpdate();
    } catch (err) {
      if (!updateMountedRef.current) return;
      setUpdateState((prev) => ({ ...prev, status: 'error', message: 'دانلودِ بروزرسانی انجام نشد: ' + (err && err.message ? err.message : 'خطای نامشخص') }));
    }
  };

  // مرحلهٔ ۵۷ §۳ (m3): نصبِ نسخهٔ دانلودشده و راه‌اندازیِ مجددِ
  // برنامه. اگر فایلِ .exe مستقیم دانلود شده باشد، نصب‌کنندهٔ همان
  // فایل اجرا می‌شود (فلاشِ دیتابیس، داخلِ هندلر و پیش از اجراست)؛
  // وگرنه مسیرِ electron-updater (quitAndInstall) می‌رود.
  const handleQuitAndInstallUpdate = async () => {
    const api = resolveUpdateApi(coreApi);
    if (updateState.directFilePath) {
      if (!api.installDownloadedUpdate) {
        showToast('سرویسِ نصبِ نسخهٔ دانلودشده در این نسخه در دسترس نیست.', { type: 'error' });
        return;
      }
      try {
        await api.installDownloadedUpdate({ filePath: updateState.directFilePath });
      } catch (err) {
        showToast('نصب و راه‌اندازیِ مجدد انجام نشد: ' + (err && err.message ? err.message : 'خطای نامشخص'), { type: 'error' });
      }
      return;
    }
    if (!api.quitAndInstallUpdate) {
      showToast('سرویسِ نصبِ بروزرسانی در این نسخه در دسترس نیست.', { type: 'error' });
      return;
    }
    try {
      await api.quitAndInstallUpdate();
    } catch (err) {
      showToast('نصب و راه‌اندازیِ مجدد انجام نشد: ' + (err && err.message ? err.message : 'خطای نامشخص'), { type: 'error' });
    }
  };

  // مرحله ۷ ـ بخش الف: نتیجهٔ updateShortcut، حکمِ نهایی است.
  // پیش از این، این تابع، برگشتیِ استور را نادیده می‌گرفت و حتی
  // وقتی استور، میانبر را به‌خاطرِ تداخل رد می‌کرد، پیامِ موفقیت
  // نشان می‌داد و کاربر فکر می‌کرد تغییر، اعمال شده است؛ در
  // حالی که کلیدِ قبلی، همچنان زنده بود. حالا رد شدن، با پیامِ
  // خطا و بدونِ پیامِ موفقیت گزارش می‌شود.
  const handleSaveShortcut = (actionId, newBind) => {
    const result = updateShortcut(actionId, newBind);
    if (result && result.success === false) {
      if (result.conflict) {
        showToast(`این میانبر، قبلاً به «${result.conflictWith || 'اقدامی دیگر'}» اختصاص دارد؛ تغییر انجام نشد.`, { type: 'error' });
      } else {
        showToast('ذخیرهٔ میانبر انجام نشد.', { type: 'error' });
      }
      return;
    }
    showToast(`میانبر جدید (${newBind.label}) در دیتابیس ذخیره شد`, { type: 'success' });
  };

  const handleResetAllShortcuts = () => {
    resetShortcutsToDefault();
    showToast('تمام کلیدهای میانبر به حالت پیش‌فرض بازنشانی شدند', { type: 'info' });
  };

  // مرحلهٔ ۵۳ مأموریت ۱: بازنشانیِ تنظیماتِ ظاهر به پیش‌فرض —
  // resetPreferences همهٔ کلیدهایِ preferences را به
  // DEFAULT_PREFERENCES برمی‌گرداند (میانبرها دست نمی‌خورند).
  const handleResetAppearance = () => {
    resetPreferences();
    showToast('تنظیمات ظاهر به حالت پیش‌فرض بازنشانی شد', { type: 'info' });
  };

  // مرحلهٔ ۵۳ مأموریت ۱: تأخیرِ ورودِ خودکار به حالتِ تمرکز،
  // به ثانیه (۱ تا ۱۰)؛ در استور به میلی‌ثانیه نگه داشته می‌شود.
  const handleAutoZenDelayChange = (seconds) => {
    const sec = Math.min(10, Math.max(1, parseFloat(seconds) || 3.2));
    updatePreference('autoZenDelay', Math.round(sec * 1000));
  };

  const handleDefaultZoomChange = (val) => {
    const num = parseFloat(val);
    updatePreference('defaultZoom', num);
    setZoomLevel(num);
  };

  // مرحله 41 §4: 8 پالت پیشنهادی رنگ پس‌زمینهٔ اطراف صفحه.
  const BACKDROP_PALETTES = [
    { name: 'خاکستری استودیویی ملایم (پیشنهادی)', hex: '#2b3038' },
    { name: 'خاکستری کاغذی خنثی', hex: '#3a404a' },
    { name: 'بژ گرم کتابخانه (سپیا)', hex: '#3d3832' },
    { name: 'سرمهٔای مات آرامش‌بخش', hex: '#1e2633' },
    { name: 'سبز مریم‌گلی تیره', hex: '#232d2b' },
    { name: 'دودی ملایم شب', hex: '#181c22' },
    { name: 'روشن کرمی روز', hex: '#dcd9d0' },
    { name: 'تاریک عمیق کلاسیک', hex: '#0a0f13' },
  ];

  // مرحله 41: محدودسازی درصد زوم به بازهٔ مجاز و ذخیره در استور.
  const clampZoomPercent = (raw, min, max, fallback) => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const commitCbzZoom = (raw) => {
    const v = clampZoomPercent(raw, 50, 300, 165);
    if (setCbzDefaultZoom) setCbzDefaultZoom(v);
    setCbzZoomDraft(null);
  };
  const commitEpubZoom = (raw) => {
    const v = clampZoomPercent(raw, 50, 250, 100);
    if (setEpubDefaultZoom) setEpubDefaultZoom(v);
    setEpubZoomDraft(null);
  };

  // مرحله 41 §4: اعتبارسنجی کد HEX (فقط # + 6 رقم hex).
  const isValidHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v || '');
  // مقدار نمایشی ورودی رنگ؛ اگر مقدار استور معتبر نباشد، به
  // پیش‌فرض قرارداد برمی‌گردد تا <input type="color"> خراب نشود.
  const backdropColorValue = isValidHex(readerBackdropColor) ? readerBackdropColor : '#2b3038';
  // مرحلهٔ ۵۳ مأموریت ۱: مقدارِ نمایشیِ تأخیرِ تمرکز، به ثانیه
  // و در بازهٔ ۱ تا ۱۰؛ مقدارِ ذخیره‌شدهٔ قدیمیِ خارج از بازه،
  // فقط در نمایش محدود می‌شود و با نخستین تغییر، اصلاح می‌شود.
  const autoZenDelaySeconds = Math.min(10, Math.max(1, (preferences?.autoZenDelay ?? 3200) / 1000));
  const handleBackdropSelect = (hex) => {
    setHexDraft(null);
    setHexError('');
    if (setReaderBackdropColor) setReaderBackdropColor(hex);
  };
  const handleHexChange = (raw) => {
    setHexDraft(raw);
    if (isValidHex(raw)) {
      setHexError('');
      if (setReaderBackdropColor) setReaderBackdropColor(raw.toLowerCase());
    } else if (raw.length >= 7) {
      setHexError('کد HEX معتبر نیست؛ باید به شکل #RRGGBB با 6 رقم باشد.');
    } else {
      setHexError('');
    }
  };
  const handleHexBlur = () => {
    if (hexDraft != null && !isValidHex(hexDraft)) {
      setHexDraft(null);
      setHexError('کد HEX معتبر نیست؛ مقدار قبلی برگردانده شد.');
    }
  };

  // مرحلهٔ ۵۲ §۳: نرمال‌سازیِ کد HEX ورودیِ گرادیانِ اسکرول‌بار:
  // اگر # ندارد، اضافه می‌شود؛ حروفِ بزرگ، کوچک می‌شوند؛ مقدارِ
  // نامعتبر، null برمی‌گرداند و مقدارِ جاری دست نمی‌خورد.
  const normalizeScrollbarHex = (raw) => {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const withHash = trimmed.startsWith('#') ? trimmed : '#' + trimmed;
    return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null;
  };
  // مقدارهایِ نمایشیِ ورودی‌هایِ رنگ؛ اگر مقدارِ استور معتبر نباشد،
  // به پیش‌فرضِ قرارداد برمی‌گردد تا <input type="color"> خراب نشود.
  const sbStartValue = isValidHex(scrollbarColorStart) ? scrollbarColorStart : '#22d3ee';
  const sbEndValue = isValidHex(scrollbarColorEnd) ? scrollbarColorEnd : '#a78bfa';
  const sbGradient = (start, end) => 'linear-gradient(180deg, ' + start + ' 0%, ' + end + ' 100%)';
  const handleScrollbarPresetSelect = (preset) => {
    if (!preset) return;
    setSbStartHexDraft(null);
    setSbEndHexDraft(null);
    setSbHexError('');
    if (setScrollbarGradient) setScrollbarGradient(preset.id, preset.start, preset.end);
  };
  const handleScrollbarColorPicker = (which, raw) => {
    // input[type="color"] همیشه مقدارِ معتبرِ #rrggbb می‌دهد؛
    // ویرایشِ رنگ، پریست را 'custom' می‌کند.
    const normalized = normalizeScrollbarHex(raw);
    if (!normalized) return;
    if (which === 'start') setSbStartHexDraft(null);
    else setSbEndHexDraft(null);
    setSbHexError('');
    if (setScrollbarGradient) {
      if (which === 'start') setScrollbarGradient('custom', normalized, sbEndValue);
      else setScrollbarGradient('custom', sbStartValue, normalized);
    }
  };
  const handleScrollbarHexChange = (which, raw) => {
    if (which === 'start') setSbStartHexDraft(raw);
    else setSbEndHexDraft(raw);
    const normalized = normalizeScrollbarHex(raw);
    if (normalized) {
      setSbHexError('');
      if (which === 'start') setSbStartHexDraft(null);
      else setSbEndHexDraft(null);
      if (setScrollbarGradient) {
        if (which === 'start') setScrollbarGradient('custom', normalized, sbEndValue);
        else setScrollbarGradient('custom', sbStartValue, normalized);
      }
    } else if (raw.trim().length >= 7) {
      setSbHexError('کد HEX معتبر نیست؛ باید به شکل #RRGGBB با 6 رقم باشد.');
    } else {
      setSbHexError('');
    }
    // مقدارِ نامعتبر: فقط پیش‌نویسِ محلی نگه داشته می‌شود تا کاربر
    // تایپش را کامل کند؛ استور و مقدارِ جاری دست نمی‌خورند.
  };
  const handleScrollbarHexBlur = (which) => {
    const draft = which === 'start' ? sbStartHexDraft : sbEndHexDraft;
    if (draft != null && !normalizeScrollbarHex(draft)) {
      if (which === 'start') setSbStartHexDraft(null);
      else setSbEndHexDraft(null);
      setSbHexError('کد HEX معتبر نیست؛ مقدار قبلی برگردانده شد.');
    }
  };

  // مرحله 41: گزینهٔ رادیویی شکیل برای حالت خواندن پیش‌فرض
  // (CBZ و EPUB) — همان الگوی کارت‌های انتخاب سبک اسلایدر در
  // مرحلهٔ 35: دایرهٔ تیک‌دار برای گزینهٔ فعال.
  const renderViewModeOption = (value, currentValue, onSelect, title, desc) => {
    const isActive = currentValue === value;
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
        style={{ ...styles.radioOption, ...(isActive ? styles.radioOptionActive : {}) }}
      >
        {isActive ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
            <circle cx="12" cy="12" r="9" />
            <polyline points="20 6 9 17 4 12" strokeWidth="2.5" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
            <circle cx="12" cy="12" r="9" />
          </svg>
        )}
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <strong style={{ fontSize: 13, color: isActive ? '#67e8f9' : 'var(--text)' }}>{title}</strong>
            {isActive && (<span style={{ fontSize: 11, color: '#67e8f9' }}>فعال</span>)}
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>{desc}</p>
        </div>
      </div>
    );
  };

  // مرحله 41: دکمه‌های سریع درصد زوم (CBZ و EPUB).
  const renderQuickZoomButtons = (values, currentValue, onSelect) => (
    <div style={styles.quickRow}>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onSelect(v)}
          style={{ ...styles.quickBtn, ...(currentValue === v ? styles.quickBtnActive : {}) }}
        >
          {v}%
        </button>
      ))}
    </div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.containerInner}>
      {/* هدر بالای تنظیمات */}
      <div style={styles.header}>
        <div style={styles.titleWrap}>
          <div style={styles.headerIcon}>
            <Icons.Settings size={22} />
          </div>
          <div>
            <h2 style={styles.title}>تنظیمات و شخصی‌سازی برنامه</h2>
            <span style={styles.subtitle}>
              مدیریت کلیدهای میانبر کیبورد، بزرگ‌نمایی پیش‌فرض و ترجیحات محیط مطالعه
            </span>
          </div>
        </div>

        {/* تب‌های تنظیمات */}
        <div style={styles.tabsRow}>
          <button
            type="button"
            onClick={() => setActiveTab('shortcuts')}
            style={{
              ...styles.tabBtn,
              ...(activeTab === 'shortcuts' ? styles.tabBtnActive : {}),
            }}
          >
            <Icons.Keyboard size={15} />
            <span>میانبرهای کیبورد</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reader')}
            style={{
              ...styles.tabBtn,
              ...(activeTab === 'reader' ? styles.tabBtnActive : {}),
            }}
          >
            <Icons.BookOpen size={15} />
            <span>تنظیمات ریدر و ظاهر</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('formats')}
            style={{
              ...styles.tabBtn,
              ...(activeTab === 'formats' ? styles.tabBtnActive : {}),
            }}
          >
            <Icons.Library size={15} />
            <span>فرمت‌های CBZ و EPUB</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('storage')}
            style={{
              ...styles.tabBtn,
              ...(activeTab === 'storage' ? styles.tabBtnActive : {}),
            }}
          >
            <Icons.FolderOpen size={15} />
            <span>مدیریت حافظه و پاک‌سازی</span>
          </button>

        </div>
      </div>

      {/* تب اول: مدیریت شورت‌کات‌های کیبورد */}
      {activeTab === 'shortcuts' && (
        <div style={styles.sectionCard}>
          <div style={styles.cardTopRow}>
            <div>
              <h3 style={styles.cardTitle}>ضبط زنده کلیدهای میانبر (تکی و ترکیبی)</h3>
              <p style={styles.cardDesc}>
                روی هر دکمه کلیک کرده و ترکیب دلخواه (مانند Ctrl + Shift + S یا کلید تکی) را فشار دهید.
              </p>
            </div>

            <button
              type="button"
              onClick={handleResetAllShortcuts}
              style={styles.resetBtn}
            >
              <Icons.RefreshCw size={14} />
              <span>بازنشانی به پیش‌فرض</span>
            </button>
          </div>

          <div style={styles.shortcutsList}>
            {Object.values(shortcuts || {}).map((entry) => {
              const actionId = entry.id;
              const currentBinding = entry;

              return (
                <div key={actionId} style={styles.shortcutRow}>
                  <div style={styles.shortcutInfo}>
                    <span style={styles.shortcutTitle}>{entry.title}</span>
                    <span style={styles.shortcutCategory}>{entry.category}</span>
                  </div>

                  <KeybindRecorder
                    actionId={actionId}
                    currentBinding={currentBinding}
                    onSave={handleSaveShortcut}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* تب دوم: تنظیمات ریدر و ظاهر */}
      {activeTab === 'reader' && (
        <>
        <div style={styles.sectionCard}>
          <h3 style={styles.cardTitle}>تنظیمات بزرگ‌نمایی و محیط مطالعه</h3>

          <div style={styles.prefGrid}>
            {/* بزرگ‌نمایی پیش‌فرض */}
            <div style={styles.prefItem}>
              <div style={styles.prefLabelRow}>
                <span style={styles.prefTitle}>بزرگ‌نمایی پیش‌فرض صفحات (Default Zoom)</span>
                <span style={styles.monoValue}>
                  {Math.round((preferences?.defaultZoom || 1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.4"
                max="2.0"
                step="0.05"
                value={preferences?.defaultZoom || 1}
                onChange={(e) => handleDefaultZoomChange(e.target.value)}
                style={styles.slider}
              />
            </div>

            {/* گام تغییر زوم */}
            <div style={styles.prefItem}>
              <div style={styles.prefLabelRow}>
                <span style={styles.prefTitle}>گام تغییر بزرگ‌نمایی با کلیدها (Zoom Step)</span>
                <span style={styles.monoValue}>
                  {Math.round((preferences?.zoomStep || 0.1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.3"
                step="0.05"
                value={preferences?.zoomStep || 0.1}
                onChange={(e) => updatePreference('zoomStep', parseFloat(e.target.value))}
                style={styles.slider}
              />
            </div>

            {/* حالت تمرکز خودکار */}
            <div style={styles.prefSwitchRow}>
              <div>
                <div style={styles.prefTitle}>پنهان‌سازی خودکار نوارها در حین مطالعه (Zen Mode)</div>
                <div style={styles.prefSub}>
                  نوارهای بالا و پایین چند ثانیه پس از باز شدن کمیک مخفی می‌شوند تا فضا کاملاً باز شود.
                </div>
              </div>
              <input
                type="checkbox"
                checked={preferences?.autoZenOnOpen !== false}
                onChange={(e) => updatePreference('autoZenOnOpen', e.target.checked)}
                style={styles.checkbox}
              />
            </div>

            {/* مرحلهٔ ۵۳ مأموریت ۱: تأخیرِ ورودِ خودکار به حالتِ تمرکز */}
            <div style={styles.prefItem}>
              <div style={styles.prefLabelRow}>
                <span style={styles.prefTitle}>تأخیر ورود خودکار به حالت تمرکز (Auto Zen Delay)</span>
                <span style={styles.monoValue}>
                  {autoZenDelaySeconds.toFixed(1)} ثانیه
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                step="0.5"
                value={autoZenDelaySeconds}
                onChange={(e) => handleAutoZenDelayChange(e.target.value)}
                style={styles.slider}
                aria-label="تأخیر ورود خودکار به حالت تمرکز"
              />
              <div style={styles.prefSub}>
                پس از باز شدن کمیک، نوارها پس از این مدت مخفی می‌شوند.
              </div>
            </div>

            {/* نمایش شمارنده آیتم‌ها در سایدبار */}
            <div style={styles.prefSwitchRow}>
              <div>
                <div style={styles.prefTitle}>نمایش شمارنده تعداد کمیک‌ها در سایدبار</div>
                <div style={styles.prefSub}>
                  نمایش تعداد آیتم‌های کتابخانه، علاقه‌مندی‌ها و تاریخچه در کنار منو.
                </div>
              </div>
              <input
                type="checkbox"
                checked={preferences?.showSidebarCounts !== false}
                onChange={(e) => updatePreference('showSidebarCounts', e.target.checked)}
                style={styles.checkbox}
              />
            </div>

            {/* مرحلهٔ ۵۳ مأموریت ۱: مدت‌زمانِ نمایشِ اعلان‌ها —
                همان گزینه‌هایِ مودالِ تنظیماتِ سریع؛ با
                updatePreferences ذخیره می‌شود. مصرف‌کنندهٔ این
                مقدار، تایمرِ showToast در useAppStore است که
                بیرون از محدودهٔ این مأموریت است و سیم‌کشیِ آن
                جداگانه انجام می‌شود؛ این کنترل، مقدار را آماده
                می‌کند و مسیرِ مودال را دست نمی‌زند. */}
            <div style={styles.prefItem}>
              <div style={styles.prefLabelRow}>
                <span style={styles.prefTitle}>مدت‌زمان نمایش اعلان‌ها (HUD Toast)</span>
                <span style={styles.monoValue}>
                  {((preferences?.hudDuration ?? 2200) / 1000).toFixed(1)} ثانیه
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { label: 'سریع (۱.۵ ثانیه)', val: 1500 },
                  { label: 'استاندارد (۲.۲ ثانیه)', val: 2200 },
                  { label: 'آهسته (۳.۵ ثانیه)', val: 3500 },
                ].map((item) => {
                  const isActive = (preferences?.hudDuration ?? 2200) === item.val;
                  return (
                    <button
                      key={item.val}
                      type="button"
                      onClick={() => updatePreference('hudDuration', item.val)}
                      style={{
                        border: isActive ? '2px solid #22d3ee' : '1px solid var(--border)',
                        background: isActive ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.03)',
                        color: isActive ? '#67e8f9' : 'var(--text)',
                        borderRadius: 20,
                        padding: '6px 14px',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* مرحلهٔ ۳۵ §۶: انتخابِ سبکِ کنترلِ اسلایدرِ کتابخانه (موج صوتی) */}
        {/* مرحله 41 §4: رنگ پس‌زمینهٔ اطراف صفحهٔ مطالعه */}
        <div style={styles.sectionCard}>
          <h3 style={styles.cardTitle}>رنگ پس‌زمینهٔ اطراف صفحهٔ مطالعه (کاهش کنتراست با صفحهٔ سفید)</h3>
          <p style={styles.cardDesc}>
            رنگ تیرهٔ اطراف صفحه، خستگی چشم هنگام خواندن صفحات سفید را کم می‌کند. یک پالت آماده انتخاب کن یا رنگ دلخواه خودت را بساز؛ تغییر در لحظه در استور ذخیره می‌شود.
          </p>

          <div style={styles.paletteGrid}>
            {BACKDROP_PALETTES.map((p) => {
              const isActive = (readerBackdropColor || '').toLowerCase() === p.hex;
              return (
                <div key={p.hex} style={styles.paletteItem}>
                  <button
                    type="button"
                    onClick={() => handleBackdropSelect(p.hex)}
                    title={p.name}
                    aria-label={p.name}
                    style={{ ...styles.paletteSwatch, backgroundColor: p.hex, ...(isActive ? styles.paletteSwatchActive : {}) }}
                  >
                    <span style={styles.palettePage} />
                    {isActive && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="#0a0f13" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', position: 'absolute', top: 6, right: 6 }}>
                        <circle cx="12" cy="12" r="9" />
                        <polyline points="20 6 9 17 4 12" strokeWidth="2.5" />
                      </svg>
                    )}
                  </button>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={styles.paletteName}>{p.name}</span>
                    {isActive && (<span style={{ fontSize: 11, color: '#67e8f9' }}>فعال</span>)}
                  </div>
                  <span style={styles.monoValue} dir="ltr">{p.hex}</span>
                </div>
              );
            })}
          </div>

          <div style={styles.colorRow}>
            <span style={styles.prefTitle}>رنگ دلخواه</span>
            <input
              type="color"
              value={backdropColorValue}
              onChange={(e) => handleBackdropSelect(e.target.value)}
              style={styles.colorInput}
              aria-label="انتخاب رنگ دلخواه پس‌زمینه"
            />
            <input
              type="text"
              value={hexDraft ?? readerBackdropColor}
              onChange={(e) => handleHexChange(e.target.value)}
              onBlur={handleHexBlur}
              style={styles.hexInput}
              dir="ltr"
              placeholder="#2b3038"
              aria-label="کد HEX رنگ پس‌زمینه"
            />
            {hexError && (<span style={styles.hexError}>{hexError}</span>)}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ ...styles.paletteSwatch, backgroundColor: backdropColorValue, width: 96, height: 64, cursor: 'default' }}>
              <span style={styles.palettePage} />
            </span>
            <span style={styles.prefSub}>پیش‌نمایش: برگهٔ سفید روی رنگ انتخاب‌شدهٔ فعلی</span>
          </div>
        </div>

        {/* مرحلهٔ ۵۲ §۳: رنگ و گرادیانِ اسکرول‌بارِ صفحات — در تبِ
            «تنظیمات ریدر و ظاهر» است، چون اسکرول‌بار مثلِ رنگِ
            پس‌زمینهٔ اطرافِ صفحه، ظاهرِ محیطِ مطالعه است. */}
        <div style={styles.sectionCard}>
          <h3 style={styles.cardTitle}>رنگ و گرادیان اسکرول‌بار صفحات</h3>
          <p style={styles.cardDesc}>
            رنگِ شستیِ اسکرول‌بار در همهٔ صفحاتِ برنامه را عوض کن؛ یک گرادیانِ آماده انتخاب کن یا گرادیانِ خودت را بساز. تغییر، در لحظه در همهٔ اسکرول‌بارها اعمال و ذخیره می‌شود.
          </p>

          <div style={styles.sbPresetGrid}>
            {SCROLLBAR_PRESETS.map((preset) => {
              const isActive = scrollbarPresetId === preset.id;
              return (
                <div
                  key={preset.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleScrollbarPresetSelect(preset)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleScrollbarPresetSelect(preset); } }}
                  style={{ ...styles.sbPresetCard, ...(isActive ? styles.sbPresetCardActive : {}) }}
                  aria-label={preset.name}
                >
                  <span style={styles.sbTrack}>
                    <span style={{ ...styles.sbThumb, background: sbGradient(preset.start, preset.end) }} />
                  </span>
                  <span style={styles.sbPresetName}>{preset.name}</span>
                  <span style={styles.monoValue} dir="ltr">{preset.start}</span>
                  <span style={styles.monoValue} dir="ltr">{preset.end}</span>
                  {isActive && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="9" />
                        <polyline points="20 6 9 17 4 12" strokeWidth="2.5" />
                      </svg>
                      <span style={{ fontSize: 11, color: '#67e8f9' }}>فعال</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div style={styles.sbCustomBox}>
            <div>
              <div style={styles.prefTitle}>ساخت گرادیان سفارشیِ من</div>
              <div style={styles.prefSub}>
                دو رنگ را انتخاب کن؛ پیش‌نمایشِ بزرگ، همان شستیِ واقعی را نشان می‌دهد. با ساختنِ گرادیانِ سفارشی، پریستِ فعال «سفارشی» می‌شود.
              </div>
            </div>

            <div style={styles.sbColorRow}>
              <span style={styles.prefTitle}>رنگ بالای اسکرول‌بار</span>
              <input
                type="color"
                value={sbStartValue}
                onChange={(e) => handleScrollbarColorPicker('start', e.target.value)}
                style={styles.colorInput}
                aria-label="انتخاب رنگ بالای اسکرول‌بار"
              />
              <input
                type="text"
                value={sbStartHexDraft ?? scrollbarColorStart}
                onChange={(e) => handleScrollbarHexChange('start', e.target.value)}
                onBlur={() => handleScrollbarHexBlur('start')}
                style={styles.hexInput}
                dir="ltr"
                placeholder="#22d3ee"
                aria-label="کد HEX رنگ بالای اسکرول‌بار"
              />
            </div>

            <div style={styles.sbColorRow}>
              <span style={styles.prefTitle}>رنگ پایین اسکرول‌بار</span>
              <input
                type="color"
                value={sbEndValue}
                onChange={(e) => handleScrollbarColorPicker('end', e.target.value)}
                style={styles.colorInput}
                aria-label="انتخاب رنگ پایین اسکرول‌بار"
              />
              <input
                type="text"
                value={sbEndHexDraft ?? scrollbarColorEnd}
                onChange={(e) => handleScrollbarHexChange('end', e.target.value)}
                onBlur={() => handleScrollbarHexBlur('end')}
                style={styles.hexInput}
                dir="ltr"
                placeholder="#a78bfa"
                aria-label="کد HEX رنگ پایین اسکرول‌بار"
              />
            </div>

            {sbHexError && (<span style={styles.hexError}>{sbHexError}</span>)}

            <div style={styles.sbPreviewRow}>
              <span style={styles.sbTrackLarge}>
                <span style={{ ...styles.sbThumbLarge, background: sbGradient(sbStartValue, sbEndValue) }} />
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={styles.prefSub}>پیش‌نمایشِ زنده: شستیِ اسکرول‌بار با گرادیانِ فعلی</span>
                <span style={styles.monoValue} dir="ltr">{sbStartValue}</span>
                <span style={styles.monoValue} dir="ltr">{sbEndValue}</span>
                {scrollbarPresetId === 'custom' && (<span style={{ fontSize: 11, color: '#67e8f9' }}>گرادیانِ سفارشی فعال است</span>)}
              </div>
            </div>
          </div>
        </div>

        <div style={styles.sectionCard}>
          <h3 style={styles.cardTitle}>سبک کنترل اسلایدر کتابخانه (موج صوتی)</h3>
          <p style={styles.cardDesc}>
            شکلِ دکمه‌هایِ اسلایدرِ هیرو در صفحهٔ کتابخانه را از بینِ ۵ تمپلیتِ موجِ صوتی انتخاب کن؛ تغییر، در لحظه اعمال می‌شود. پیش‌نمایشِ هر کارت، همان انیمیشنِ زندهٔ اسلایدر است.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
            {[
              { id: 'led', name: 'ال‌ای‌دی متر', desc: 'ستون‌هایی از نقطه‌هایِ ریز' },
              { id: 'mirror', name: 'آینه', desc: 'میله‌هایِ گردِ متقارن (پیش‌فرض)' },
              { id: 'matrix', name: 'ماتریس پیکسلی', desc: 'مربع‌هایِ سوسوزنِ پیکسلی' },
              { id: 'pendulum', name: 'آونگ‌ها', desc: 'وزنه‌هایِ آویزانِ نوسانی' },
              { id: 'firefly', name: 'کرم شب‌تاب', desc: 'ذره‌هایِ شناورِ نورانی' },
            ].map((v) => {
              const isActive = (preferences?.heroSliderVariant || 'mirror') === v.id;
              return (
                <div
                  key={v.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setHeroSliderVariant && setHeroSliderVariant(v.id)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && setHeroSliderVariant) {
                      e.preventDefault();
                      setHeroSliderVariant(v.id);
                    }
                  }}
                  style={{
                    border: isActive ? '2px solid #22d3ee' : '1px solid var(--border)',
                    background: isActive ? 'rgba(34,211,238,0.08)' : 'rgba(255,255,255,0.03)',
                    borderRadius: 14,
                    padding: '16px 20px',
                    cursor: 'pointer',
                    width: '100%',
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 200px', minWidth: 200 }}>
                    {isActive ? (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="9" />
                        <polyline points="20 6 9 17 4 12" strokeWidth="2.5" />
                      </svg>
                    ) : (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="9" />
                      </svg>
                    )}
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <strong style={{ fontSize: 13, color: isActive ? '#67e8f9' : 'var(--text)' }}>{v.name}</strong>
                        {isActive && (<span style={{ fontSize: 11, color: '#67e8f9' }}>فعال</span>)}
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>{v.desc}</p>
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, maxWidth: '100%', overflow: 'hidden', borderRadius: 10, padding: '4px 2px' }}>
                    <SliderControls
                      currentIndex={2}
                      total={7}
                      onPrev={() => {}}
                      onNext={() => {}}
                      onSelect={() => {}}
                      variant={v.id}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* مرحلهٔ ۵۳ مأموریت ۱: بازنشانیِ تنظیماتِ ظاهر به پیش‌فرض */}
        <div style={styles.sectionCard}>
          <h3 style={styles.cardTitle}>بازنشانی تنظیمات ظاهر</h3>
          <p style={styles.cardDesc}>
            همهٔ تنظیماتِ برنامه — از جمله بزرگ‌نمایی، حالت تمرکز، رنگ پس‌زمینه، گرادیان اسکرول‌بار و سبک اسلایدر — به مقدارهای پیش‌فرض برمی‌گردند. کلیدهای میانبر دست نمی‌خورند.
          </p>
          <button
            type="button"
            onClick={handleResetAppearance}
            style={styles.resetBtn}
          >
            <Icons.RefreshCw size={14} />
            <span>بازنشانی تنظیمات ظاهر به پیش‌فرض</span>
          </button>
        </div>
        </>
      )}

      {/* مرحله 41 §3: تب «فرمت‌های CBZ و EPUB» — همهٔ تنظیمات
          اختصاصی این دو فرمت این‌جا متمرکز است؛ در تب‌های دیگر
          هیچ تنظیم CBZ/EPUB نیست. */}
      {activeTab === 'formats' && (
        <>
        {/* کارت اول: تنظیمات اختصاصی مانگا و کمیک (CBZ) */}
        <div style={styles.sectionCard}>
          <h3 style={styles.cardTitle}>تنظیمات اختصاصی مانگا و کمیک (CBZ)</h3>
          <p style={styles.cardDesc}>
            حالت خواندن و زوم پیش‌فرض فقط برای فایل‌های CBZ؛ هنگام باز شدن هر کمیک تازه، همین مقدارها اعمال می‌شوند.
          </p>

          <div style={styles.prefGrid}>
            <div style={styles.prefItem}>
              <div style={styles.prefLabelRow}>
                <span style={styles.prefTitle}>حالت خواندن پیش‌فرض</span>
              </div>
              <div style={styles.radioGroup}>
                {renderViewModeOption('horizontal-paged', cbzDefaultViewMode, () => { if (setCbzDefaultViewMode) setCbzDefaultViewMode('horizontal-paged'); }, 'افقی (صفحه‌ای - مخصوص مانگا)', 'ورق زدن صفحه‌به‌صفحه؛ مناسب مانگا و کمیک')}
                {renderViewModeOption('vertical', cbzDefaultViewMode, () => { if (setCbzDefaultViewMode) setCbzDefaultViewMode('vertical'); }, 'عمودی (اسکرول پیوسته)', 'همهٔ صفحات پشت سر هم با اسکرول')}
              </div>
            </div>

            <div style={styles.prefItem}>
              <div style={styles.prefLabelRow}>
                <span style={styles.prefTitle}>درصد زوم نرمال (پیش‌فرض) هنگام باز شدن CBZ</span>
                <span style={styles.monoValue}>{cbzDefaultZoom}%</span>
              </div>
              <input
                type="range"
                min="50"
                max="300"
                step="5"
                value={cbzDefaultZoom}
                onChange={(e) => { if (setCbzDefaultZoom) setCbzDefaultZoom(parseInt(e.target.value, 10)); }}
                style={styles.slider}
              />
              <div style={styles.zoomRow}>
                <input
                  type="number"
                  min="50"
                  max="300"
                  step="5"
                  value={cbzZoomDraft ?? cbzDefaultZoom}
                  onChange={(e) => setCbzZoomDraft(e.target.value)}
                  onBlur={(e) => commitCbzZoom(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                  style={styles.numberInput}
                  aria-label="درصد زوم پیش‌فرض CBZ"
                />
                <span style={styles.prefSub}>٪ — بین 50 تا 300</span>
                {renderQuickZoomButtons([100, 135, 165, 200], cbzDefaultZoom, (v) => { setCbzZoomDraft(null); if (setCbzDefaultZoom) setCbzDefaultZoom(v); })}
              </div>
            </div>
          </div>
        </div>

        {/* کارت دوم: تنظیمات اختصاصی کتاب‌های الکترونیکی (EPUB) */}
        <div style={styles.sectionCard}>
          <h3 style={styles.cardTitle}>تنظیمات اختصاصی کتاب‌های الکترونیکی (EPUB)</h3>
          <p style={styles.cardDesc}>
            حالت خواندن و زوم پیش‌فرض فقط برای فایل‌های EPUB؛ هنگام باز شدن هر کتاب تازه، همین مقدارها اعمال می‌شوند.
          </p>

          <div style={styles.prefGrid}>
            <div style={styles.prefItem}>
              <div style={styles.prefLabelRow}>
                <span style={styles.prefTitle}>حالت خواندن پیش‌فرض</span>
              </div>
              <div style={styles.radioGroup}>
                {renderViewModeOption('vertical', epubDefaultViewMode, () => { if (setEpubDefaultViewMode) setEpubDefaultViewMode('vertical'); }, 'عمودی (اسکرول پیوسته با رفتن خودکار به فصل بعد)', 'خواندن پیوستهٔ فصل‌ها بدون توقف در پایان هر فصل')}
                {renderViewModeOption('horizontal-paged', epubDefaultViewMode, () => { if (setEpubDefaultViewMode) setEpubDefaultViewMode('horizontal-paged'); }, 'افقی (ورق زدن صفحه‌ای)', 'ورق زدن صفحه‌به‌صفحه مثل کتاب چاپی')}
              </div>
            </div>

            <div style={styles.prefItem}>
              <div style={styles.prefLabelRow}>
                <span style={styles.prefTitle}>درصد زوم نرمال (پیش‌فرض) هنگام باز شدن EPUB</span>
                <span style={styles.monoValue}>{epubDefaultZoom}%</span>
              </div>
              <input
                type="range"
                min="50"
                max="250"
                step="5"
                value={epubDefaultZoom}
                onChange={(e) => { if (setEpubDefaultZoom) setEpubDefaultZoom(parseInt(e.target.value, 10)); }}
                style={styles.slider}
              />
              <div style={styles.zoomRow}>
                <input
                  type="number"
                  min="50"
                  max="250"
                  step="5"
                  value={epubZoomDraft ?? epubDefaultZoom}
                  onChange={(e) => setEpubZoomDraft(e.target.value)}
                  onBlur={(e) => commitEpubZoom(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                  style={styles.numberInput}
                  aria-label="درصد زوم پیش‌فرض EPUB"
                />
                <span style={styles.prefSub}>٪ — بین 50 تا 250</span>
                {renderQuickZoomButtons([85, 100, 125, 150], epubDefaultZoom, (v) => { setEpubZoomDraft(null); if (setEpubDefaultZoom) setEpubDefaultZoom(v); })}
              </div>
            </div>
          </div>
        </div>
        </>
      )}

      {/* مرحله ۱۰: تبِ «حافظه» — آمارِ دقیقِ حجم، پاک‌سازیِ کشِ کاورها و فایل‌هایِ حذف‌شده و انتخابِ درایوِ محلِ ذخیره. */}
      {activeTab === 'storage' && (
        <StorageSection />
      )}

      {/* مرحله ۵ ـ بخش الف: کارتِ پشتیبان‌گیری و بازیابی — همیشه زیرِ
          تب‌ها دیده می‌شود (مستقل از تبِ فعال)، چون به هیچ تبِ خاصی
          تعلق ندارد. */}
      <div style={styles.sectionCard}>
        <div style={styles.cardTopRow}>
          <div>
            <h3 style={styles.cardTitle}>پشتیبان‌گیری و بازیابی اطلاعات</h3>
            <p style={styles.cardDesc}>
              یک فایلِ واحد شاملِ دیتابیس (کتابخانه، تاریخچه، علاقه‌مندی‌ها، پوشه‌ها، تنظیمات و همهٔ حاشیه‌نویسی‌ها) به همراهِ همهٔ فایل‌های کاور. بازیابی، پیش از جایگزینی، سلامتِ فایل را بررسی می‌کند و نسخهٔ فعلی را در db.json.pre-restore.bak نگه می‌دارد.
            </p>
          </div>
          <div style={styles.headerIcon}>
            <Icons.FileArchive size={22} />
          </div>
        </div>

        <div style={styles.backupBtnRow}>
          <button
            type="button"
            onClick={handleExportBackup}
            disabled={Boolean(backupBusy)}
            style={{ ...styles.backupBtn, ...(backupBusy ? styles.backupBtnDisabled : {}) }}
          >
            <Icons.Download size={15} />
            <span>{backupBusy === 'export' ? 'در حال ساخت…' : 'دریافت فایل پشتیبان (Export)'}</span>
          </button>

          <button
            type="button"
            onClick={handleImportBackup}
            disabled={Boolean(backupBusy)}
            style={{ ...styles.backupBtn, ...styles.backupBtnGhost, ...(backupBusy ? styles.backupBtnDisabled : {}) }}
          >
            <Icons.FolderOpen size={15} />
            <span>{backupBusy === 'import' ? 'در حال بازیابی…' : 'بازیابی از فایل پشتیبان (Import)'}</span>
          </button>
        </div>

        {(backupStatus || lastBackup) && (
          <div style={styles.backupStatusRow}>
            {backupStatus && <span style={styles.backupStatus}>{backupStatus}</span>}
            {lastBackup && (
              <span style={styles.backupMeta}>
                آخرین پشتیبان: {lastBackup.name || '—'}
                {' — '}
                {new Date(lastBackup.at).toLocaleString('fa-IR')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* مرحلهٔ ۵۵ §۳: کارتِ «نسخه و بروزرسانی نرم‌افزار» — همیشه زیرِ
          تب‌ها دیده می‌شود (مثلِ کارتِ پشتیبان‌گیری)، چون به هیچ تبِ
          خاصی تعلق ندارد. در حالتِ توسعه، دکمهٔ بررسی غیرفعال است و
          کارت هرگز کرش نمی‌کند. آیکون‌ها از Iconsِ موجودِ پروژه‌اند
          (RefreshCw/Download)؛ هیچ ایموجی نیست. */}
      <div style={styles.sectionCard}>
        <div style={styles.cardTopRow}>
          <div>
            <h3 style={styles.cardTitle}>نسخه و بروزرسانی نرم‌افزار (PandaReader Update Center)</h3>
            <p style={styles.cardDesc}>
              نسخهٔ جدید را مستقیم از گیت‌هاب بررسی و دانلود کنید؛ نصبِ نسخهٔ جدید، برنامه را بسته و دوباره باز می‌کند.
            </p>
          </div>
          <div style={styles.headerIcon}>
            <Icons.Download size={22} />
          </div>
        </div>

        <div style={styles.updateMetaRow}>
          <span style={styles.updateVersionText}>
            {updateInfo.loaded ? `PandaReader v${updateInfo.version || '1.0.0'}` : 'PandaReader'}
          </span>
          <span style={{ ...styles.updateEnvChip, ...(isDevUpdateMode ? styles.updateEnvChipDev : {}) }}>
            {updateInfo.loaded ? (updateInfo.envKnown ? (updateInfo.isPackaged ? 'نسخهٔ نصبی' : 'نسخهٔ توسعه') : 'محیط نامشخص') : 'در حال خواندنِ نسخه…'}
          </span>
        </div>

        {isDevUpdateMode && (
          <p style={styles.cardDesc}>
            در این حالت، بررسیِ نسخهٔ جدید مستقیم از گیت‌هاب انجام می‌شود و فایلِ نصب (.exe) دانلود می‌شود؛ نصبِ خودکارِ درون‌برنامه‌ای فقط در نسخهٔ نصبی کار می‌کند.
          </p>
        )}

        <div style={styles.backupBtnRow}>
          <button
            type="button"
            onClick={handleCheckForUpdates}
            disabled={updateState.status === 'checking' || updateState.status === 'downloading'}
            style={{ ...styles.backupBtn, ...((updateState.status === 'checking' || updateState.status === 'downloading') ? styles.backupBtnDisabled : {}) }}
          >
            <Icons.RefreshCw size={15} />
            <span>{updateState.status === 'checking' ? 'در حال بررسی…' : 'بررسی بروزرسانی جدید از گیت‌هاب'}</span>
          </button>

          {updateState.status === 'available' && (
            <button
              type="button"
              onClick={handleDownloadUpdate}
              disabled={!updateInfo.isPackaged && !updateState.downloadUrl}
              style={styles.backupBtn}
            >
              <Icons.Download size={15} />
              <span>{updateInfo.isPackaged ? 'دانلود بروزرسانی' : 'دانلود فایل نصب (.exe)'}</span>
            </button>
          )}

          {updateState.status === 'downloaded' && (
            <button
              type="button"
              onClick={handleQuitAndInstallUpdate}
              style={{ ...styles.backupBtn, ...styles.updateBtnPrimary }}
            >
              <Icons.RefreshCw size={15} />
              <span>نصب و راه‌اندازی مجدد (Install & Restart)</span>
            </button>
          )}
        </div>

        {updateState.latestVersion && (
          <div style={styles.backupStatusRow}>
            <span style={styles.backupStatus}>
              {`آخرین نسخه در گیت‌هاب: v${updateState.latestVersion}`}
              {updateState.publishedAt ? ` — منتشرشده در ${formatReleaseDate(updateState.publishedAt)}` : ''}
            </span>
          </div>
        )}

        {updateState.status === 'available' && skippedVersion && updateState.latestVersion === skippedVersion && (
          <div style={styles.backupStatusRow}>
            <span style={styles.backupStatus}>
              این نسخه را نادیده گرفته‌اید؛ پنجرهٔ یادآوری برای آن باز نمی‌شود، مگر با زدنِ دوبارهٔ «بررسی بروزرسانی جدید از گیت‌هاب».
            </span>
          </div>
        )}

        {/* مرحلهٔ ۵۷ §۳ (m3): سوییچِ «بررسی و یادآوریِ خودکارِ آپدیت‌ها» — همان کلیدِ مودالِ یادآوری؛ با localStorage هم‌گام می‌ماند. */}
        <div style={styles.prefSwitchRow}>
          <div>
            <div style={styles.prefTitle}>بررسی و یادآوریِ خودکارِ آپدیت‌ها</div>
            <div style={styles.prefSub}>
              بررسی خودکار بروزرسانی در شروع برنامه؛ ۵ ثانیه پس از باز شدن، آخرین نسخه در گیت‌هاب بررسی می‌شود.
            </div>
          </div>
          <input
            type="checkbox"
            checked={autoCheckEnabled}
            onChange={(e) => handleAutoCheckToggle(e.target.checked)}
            style={styles.checkbox}
            aria-label="بررسی و یادآوری خودکار آپدیت‌ها"
          />
        </div>

        {updateState.status === 'downloading' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={styles.updateProgressTrack}>
              <div style={{ ...styles.updateProgressFill, width: `${Math.max(0, Math.min(100, updateState.progress || 0))}%` }} />
            </div>
            <span style={styles.updateProgressLabel}>{formatDownloadProgressLabel(updateState)}</span>
          </div>
        )}

        {updateState.status !== 'idle' && updateState.status !== 'downloading' && (
          <div style={styles.backupStatusRow}>
            <span style={styles.backupStatus}>
              {updateState.status === 'checking' && 'در حال بررسی ارتباط با گیت‌هاب...'}
              {updateState.status === 'up-to-date' && 'نرم‌افزار شما به آخرین نسخه بروز است.'}
              {updateState.status === 'available' && `نسخهٔ جدید ${updateState.version || ''} منتشر شده است؛ برای دریافت، «دانلود بروزرسانی» را بزنید.`}
              {updateState.status === 'downloaded' && 'دانلود کامل شد؛ با «نصب و راه‌اندازی مجدد»، نسخهٔ جدید نصب می‌شود.'}
              {updateState.status === 'error' && (updateState.message || 'بررسی بروزرسانی انجام نشد.')}
            </span>
          </div>
        )}

        {updateState.status === 'idle' && (
          <div style={styles.backupStatusRow}>
            <span style={styles.backupStatus}>برای بررسی نسخهٔ جدید، روی «بررسی بروزرسانی جدید از گیت‌هاب» بزنید.</span>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    padding: '18px 22px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    overflowY: 'auto',
    direction: 'ltr',
    userSelect: 'none',
  },  // مرحله ۱۲: محتوای درونیِ اسکرول‌خور — جهتِ راست‌به‌چپِ
  // فارسی، دقیقاً با همان فاصله‌ها (gap) حفظ می‌شود؛ فقط
  // خودِ کانتینرِ اسکرول‌خور، چپ‌به‌راست است تا کرومیوم،
  // نوارِ اسکرول را در لبهٔ سمتِ راست رندر کند.
  containerInner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    direction: 'rtl',
    flex: 1,
    minWidth: 0,
  },

  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '14px',
    paddingBottom: '14px',
    borderBottom: '1px solid var(--border)',
  },
  titleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  headerIcon: {
    color: 'var(--accent)',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    padding: '10px',
    borderRadius: '12px',
    border: '1px solid rgba(34, 211, 238, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'var(--font-fa)',
    fontSize: '20px',
    fontWeight: 800,
    color: 'var(--text)',
    margin: 0,
  },
  subtitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 400,
    color: 'var(--muted)',
  },
  tabsRow: {
    display: 'flex',
    gap: '8px',
    backgroundColor: 'var(--panel)',
    padding: '5px',
    borderRadius: '12px',
    border: '1px solid var(--border)',
  },
  tabBtn: {
    padding: '7px 14px',
    borderRadius: '9px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--muted)',
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    transition: 'all 0.18s ease',
  },
  tabBtnActive: {
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    fontWeight: 700,
  },
  sectionCard: {
    backgroundColor: 'var(--panel)',
    borderRadius: '18px',
    border: '1px solid var(--border)',
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  cardTopRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '12px',
    paddingBottom: '12px',
    borderBottom: '1px solid var(--border)',
  },
  cardTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '16px',
    fontWeight: 800,
    color: 'var(--text)',
    margin: 0,
  },
  cardDesc: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    color: 'var(--muted)',
    margin: '4px 0 0 0',
  },
  resetBtn: {
    padding: '8px 14px',
    borderRadius: '10px',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  shortcutsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  shortcutRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderRadius: '12px',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
  },
  shortcutInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  shortcutTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13.5px',
    fontWeight: 600,
    color: 'var(--text)',
  },
  shortcutCategory: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    color: 'var(--muted)',
  },
  prefGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  prefItem: {
    padding: '14px 16px',
    borderRadius: '12px',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  prefLabelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  prefTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13.5px',
    fontWeight: 700,
    color: 'var(--text)',
  },
  prefSub: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    color: 'var(--muted)',
    marginTop: '3px',
  },
  monoValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--accent)',
    direction: 'ltr',
  },
  slider: {
    accentColor: 'var(--accent)',
    cursor: 'pointer',
    width: '100%',
  },
  prefSwitchRow: {
    padding: '14px 16px',
    borderRadius: '12px',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
  },
  checkbox: {
    width: '18px',
    height: '18px',
    accentColor: 'var(--accent)',
    cursor: 'pointer',
  },
  // مرحله ۵ ـ بخش الف: استایل‌های کارتِ پشتیبان‌گیری (همان توکن‌های
  // بقیهٔ کارت‌ها: panel/panel2/border/text/muted/accent).
  backupBtnRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  backupBtn: {
    padding: '10px 16px',
    borderRadius: '11px',
    backgroundColor: 'var(--accent)',
    border: '1px solid var(--accent)',
    color: '#0a0f13',
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    transition: 'all 0.18s ease',
  },
  backupBtnGhost: {
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
  },
  backupBtnDisabled: {
    opacity: 0.55,
    cursor: 'default',
  },
  backupStatusRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  backupStatus: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    color: 'var(--text)',
  },
  backupMeta: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    color: 'var(--muted)',
  },
  // مرحله 41: استایل‌های تب فرمت‌ها و کارت رنگ پس‌زمینه.
  radioGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  radioOption: {
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: '14px 16px',
    cursor: 'pointer',
    width: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  radioOptionActive: {
    border: '2px solid #22d3ee',
    background: 'rgba(34,211,238,0.08)',
  },
  zoomRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  numberInput: {
    width: '76px',
    padding: '8px 10px',
    borderRadius: '10px',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 700,
    textAlign: 'center',
    direction: 'ltr',
  },
  quickRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  quickBtn: {
    padding: '6px 12px',
    borderRadius: '9px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--panel2)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
    direction: 'ltr',
  },
  quickBtnActive: {
    backgroundColor: 'var(--accent)',
    border: '1px solid var(--accent)',
    color: '#0a0f13',
  },
  paletteGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '14px',
  },
  paletteItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    flex: '1 1 104px',
    maxWidth: '128px',
  },
  paletteSwatch: {
    position: 'relative',
    width: '100%',
    height: '64px',
    borderRadius: '12px',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  },
  paletteSwatchActive: {
    border: '2px solid #22d3ee',
    boxShadow: '0 0 0 2px rgba(34,211,238,0.25)',
  },
  palettePage: {
    width: '26px',
    height: '38px',
    backgroundColor: '#ffffff',
    borderRadius: '2px',
    boxShadow: '0 1px 5px rgba(0,0,0,0.45)',
    display: 'block',
  },
  paletteName: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    color: 'var(--text)',
    textAlign: 'center',
  },
  colorRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  colorInput: {
    width: '48px',
    height: '38px',
    padding: '3px',
    borderRadius: '10px',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    cursor: 'pointer',
  },
  hexInput: {
    width: '110px',
    padding: '8px 10px',
    borderRadius: '10px',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 700,
    textAlign: 'center',
    direction: 'ltr',
  },
  hexError: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    color: '#f87171',
  },
  // مرحلهٔ ۵۲ §۳: استایل‌های کارتِ گرادیانِ اسکرول‌بار (همان توکن‌های
  // بقیهٔ کارت‌ها: panel/panel2/border/text/muted/accent). پیش‌نمایشِ
  // کپسولی، شکلِ شستیِ واقعی را دارد: ریلِ تیرهٔ گرد با شستیِ
  // گرادیانیِ باریک در وسط.
  sbPresetGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '14px',
  },
  sbPresetCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    flex: '1 1 120px',
    maxWidth: '148px',
    padding: '12px 10px',
    borderRadius: '14px',
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.03)',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  sbPresetCardActive: {
    border: '2px solid #22d3ee',
    background: 'rgba(34,211,238,0.08)',
    boxShadow: '0 0 0 2px rgba(34,211,238,0.25)',
  },
  sbPresetName: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    color: 'var(--text)',
    textAlign: 'center',
  },
  sbTrack: {
    width: 28,
    height: 72,
    borderRadius: 999,
    background: 'rgba(10, 14, 20, 0.55)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sbThumb: {
    width: 12,
    height: 48,
    borderRadius: 999,
    flexShrink: 0,
  },
  sbTrackLarge: {
    width: 36,
    height: 120,
    borderRadius: 999,
    background: 'rgba(10, 14, 20, 0.55)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sbThumbLarge: {
    width: 16,
    height: 84,
    borderRadius: 999,
    flexShrink: 0,
  },
  sbCustomBox: {
    padding: '14px 16px',
    borderRadius: '12px',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sbColorRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  sbPreviewRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    flexWrap: 'wrap',
  },
  // مرحلهٔ ۵۵ §۳: استایل‌هایِ کارتِ بروزرسانی.
  updateMetaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  updateVersionText: {
    fontFamily: 'var(--font-fa)',
    fontSize: '15px',
    fontWeight: 800,
    color: 'var(--text)',
  },
  updateEnvChip: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    fontWeight: 700,
    color: '#0a0f13',
    backgroundColor: 'var(--accent)',
    padding: '3px 10px',
    borderRadius: '999px',
  },
  updateEnvChipDev: {
    color: 'var(--text)',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
  },
  updateProgressTrack: {
    height: '10px',
    borderRadius: '999px',
    backgroundColor: 'rgba(255,255,255,0.08)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  updateProgressFill: {
    height: '100%',
    borderRadius: '999px',
    backgroundColor: 'var(--accent)',
    transition: 'width 0.2s ease',
  },
  updateProgressLabel: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    color: 'var(--muted)',
  },
  updateBtnPrimary: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
    color: '#06110a',
  },
};