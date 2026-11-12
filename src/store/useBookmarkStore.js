import { create } from 'zustand';
import { coreApi } from '../services/coreApi';
import useAppStore from './useAppStore';
import {
  DEFAULT_BOOKMARK_PREFERENCES,
  clampYRatio,
  isValidBookmarkTemplate,
  newBookmarkId,
  sanitizeBookmark,
} from '../components/reader/bookmarkTemplates';

// مرحله ۱۸ — معماریِ ۳ لایه‌ایِ ضدگلولهٔ ذخیرهٔ تمپلیت‌ها:
// لایهٔ ۱: localStorage (همگام، فوری) — هر تغییری، پیش از هر IPC،
// همین‌جا نوشته می‌شود؛ پس حتی اگر ورکر یا IPC در همان ثانیه
// بمیرد، ساختهٔ کاربر هرگز ریست نمی‌شود. لایهٔ ۲: db.json (ورکر).
// لایهٔ ۳: bookmark-backgrounds/bookmark-presets.json (آینهٔ
// ipcHandlers رویِ هر SAVE). در بارگذاری، اتحادِ هر سه لایه بر
// اساسِ id ساخته می‌شود و localStorage — که همیشه تازه‌ترین لایه
// است، چون هر تغییر اولِ اول همان‌جا می‌نشیند — برندهٔ تعارض‌هاست؛
// و هرچه در دیتابیس نبود، با سینکِ برگشتی به آن برمی‌گردد.
const LS_PREFS_KEY = 'comicReader.bookmarkPreferences.v2';

function cleanPreset(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    id: typeof p.id === 'string' && p.id ? p.id : ('preset_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)),
    name: typeof p.name === 'string' ? p.name.slice(0, 60) : '',
    template: isValidBookmarkTemplate(p.template) ? p.template : 'MARGIN',
    image: typeof p.image === 'string' ? p.image : null,
    focalPoint: p.focalPoint === 'top' || p.focalPoint === 'bottom' ? p.focalPoint : 'center',
    side: p.side === 'left' ? 'left' : 'right',
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
  };
}

function readPrefsLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(LS_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const out = { ...DEFAULT_BOOKMARK_PREFERENCES, savedPresets: [] };
    if (isValidBookmarkTemplate(parsed.defaultTemplate)) out.defaultTemplate = parsed.defaultTemplate;
    if (typeof parsed.globalImage === 'string') out.globalImage = parsed.globalImage;
    else if (parsed.globalImage === null) out.globalImage = null;
    if (parsed.templateImages && typeof parsed.templateImages === 'object') {
      const templateImages = {};
      Object.entries(parsed.templateImages).forEach(([id, url]) => {
        if (isValidBookmarkTemplate(id) && typeof url === 'string' && url) templateImages[id] = url;
      });
      out.templateImages = templateImages;
    }
    if (parsed.defaultSide === 'left' || parsed.defaultSide === 'right') out.defaultSide = parsed.defaultSide;
    if (Array.isArray(parsed.savedPresets)) {
      parsed.savedPresets.forEach((p) => {
        const c = cleanPreset(p);
        if (c && out.savedPresets.length < 100) out.savedPresets.push(c);
      });
    }
    return out;
  } catch (_) {
    return null;
  }
}

// مرحلهٔ ۵۹، مأموریت ۱ — بازگشتِ بولین: فراخواننده باید بداند
// آینهٔ محلی واقعاً نوشته شد یا نه، چون توستِ خطا فقط وقتی می‌آید
// که هم دیتابیس و هم همین آینه ناموفق بوده باشند.
function writePrefsLocalStorage(prefs) {
  try {
    if (typeof window === 'undefined' || !window.localStorage || !prefs) return false;
    window.localStorage.setItem(LS_PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch (_) { return false; }
}

// مرحله ۱۹ — آینهٔ همگامِ بوک‌مارک‌ها در localStorage
// (comicReader.bookmarksByFile.v2): هر ساخت، تغییرِ نام یا جابه‌جایی،
// پیش از IPC در همین‌جا نوشته می‌شود تا حتی اگر نوشتن در دیتابیس
// ناموفق باشد یا برنامه بسته شود، هیچ بوک‌مارکی هرگز گم نشود.
// کلیدها همان کلیدهایِ نرمال‌شدهٔ bookmarksByFile هستند؛ هر رکورد،
// کوچک (چند صد بایت) است و سقفِ localStorage بسیار بالاتر از مصرفِ
// واقعیِ صدها بوک‌مارک است.
const LS_BOOKMARKS_KEY = 'comicReader.bookmarksByFile.v2';
function readBookmarksLocalStorage(filePath) {
  try {
    if (typeof window === 'undefined' || !window.localStorage || !filePath) return [];
    const raw = window.localStorage.getItem(LS_BOOKMARKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = parsed && Array.isArray(parsed[filePath]) ? parsed[filePath] : [];
    return list.map(sanitizeBookmarkWithExtras).filter(Boolean);
  } catch (_) { return []; }
}
function writeBookmarksLocalStorage(filePath, list) {
  try {
    if (typeof window === 'undefined' || !window.localStorage || !filePath) return false;
    let parsed = {};
    try { parsed = JSON.parse(window.localStorage.getItem(LS_BOOKMARKS_KEY) || '{}') || {}; } catch (_) { parsed = {}; }
    if (!list || list.length === 0) delete parsed[filePath];
    else parsed[filePath] = list;
    window.localStorage.setItem(LS_BOOKMARKS_KEY, JSON.stringify(parsed));
    return true;
  } catch (_) { return false; }
}
// مرحلهٔ ۵۲ §۱: حذفِ آینهٔ localStorage برایِ چند فایل، با تطابقِ
// کلیدِ نرمال‌شده (کلیدهایِ آینه، مسیرِ خام‌اند و ممکن است با
// بزرگی/کوچکیِ حروف یا جداکننده فرق کنند؛ پس همهٔ کلیدها با
// normalizeBookKey مقایسه می‌شوند، نه با برابریِ رشته‌ای).
function removeFileBookmarksFromLocalStorage(filePaths) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 0;
    const norms = new Set(
      (Array.isArray(filePaths) ? filePaths : []).map((p) => normalizeBookKey(p)).filter(Boolean)
    );
    if (norms.size === 0) return 0;
    let parsed = {};
    try { parsed = JSON.parse(window.localStorage.getItem(LS_BOOKMARKS_KEY) || '{}') || {}; } catch (_) { parsed = {}; }
    let removed = 0;
    Object.keys(parsed).forEach((key) => {
      if (norms.has(normalizeBookKey(key))) {
        delete parsed[key];
        removed += 1;
      }
    });
    if (removed > 0) window.localStorage.setItem(LS_BOOKMARKS_KEY, JSON.stringify(parsed));
    return removed;
  } catch (_) {
    return 0;
  }
}

// اتحادِ دو فهرست بر اساسِ id: فهرستِ override در تعارض برنده است و
// آیتم‌هایِ فقطِ base هم حفظ می‌شوند (ترتیبِ base اول، سپس فقطِ override).
function mergeBookmarkLists(base, override) {
  const byId = new Map();
  (Array.isArray(base) ? base : []).forEach((b) => { if (b && b.id) byId.set(b.id, b); });
  (Array.isArray(override) ? override : []).forEach((b) => { if (b && b.id) byId.set(b.id, b); });
  return [...byId.values()];
}

// مرحلهٔ ۵۷، مأموریت ۱ — نامِ فایل از رویِ کلیدِ نرمال‌شده، برایِ
// ورودیِ کشِ سراسری (کش، همیشه شکلِ { fileName, bookmarks } دارد).
function fileBaseName(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || String(filePath || '');
}

// مرحلهٔ ۵۷، مأموریت ۱ — خواندنِ کلِ آینهٔ محلیِ بوک‌مارک‌ها
// (نه فقط یک فایل)، برایِ ساختنِ کشِ سراسری بدونِ IPC.
function readAllBookmarksLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(LS_BOOKMARKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) || {};
    const out = {};
    Object.entries(parsed).forEach(([key, list]) => {
      const clean = (Array.isArray(list) ? list : []).map(sanitizeBookmarkWithExtras).filter(Boolean);
      if (clean.length > 0) out[key] = clean;
    });
    return out;
  } catch (_) {
    return {};
  }
}

// مرحلهٔ ۵۷، مأموریت ۱ — برابریِ محتوایی (برایِ اینکه شمارندهٔ
// نسخه، فقط وقتی بالا برود که داده واقعاً عوض شده باشد).
function jsonEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (_) {
    return false;
  }
}

// مرحلهٔ ۵۷، مأموریت ۱ — شمارندهٔ کلِ کشِ سراسری؛ هر دو شکلِ
// ورودی (شیءِ { bookmarks } و آرایهٔ خامِ قدیمی) را می‌فهمد.
function countAllBookmarkEntries(map) {
  return Object.values(map || {}).reduce(
    (sum, entry) => sum + (Array.isArray(entry && entry.bookmarks) ? entry.bookmarks.length : Array.isArray(entry) ? entry.length : 0),
    0
  );
}

// مرحلهٔ ۵۷، مأموریت ۱ — نقشهٔ سراسری از حافظه و آینهٔ محلی:
// کشِ درونِ حافظه اول، بعد آینهٔ localStorage (تازه‌ترین لایه،
// برندهٔ تعارض — همان قانونِ مرحلهٔ ۱۹ در loadBookmarksForFile).
function buildLocalAllBookmarksMap(bookmarksByFile) {
  const map = {};
  Object.entries(bookmarksByFile || {}).forEach(([key, list]) => {
    const norm = normalizeBookKey(key);
    const clean = (Array.isArray(list) ? list : []).map(sanitizeBookmarkWithExtras).filter(Boolean);
    if (clean.length > 0) map[norm] = { fileName: fileBaseName(norm), bookmarks: clean };
  });
  Object.entries(readAllBookmarksLocalStorage()).forEach(([key, list]) => {
    const norm = normalizeBookKey(key);
    const prev = map[norm] ? map[norm].bookmarks : [];
    const merged = mergeBookmarkLists(prev, list);
    if (merged.length > 0) {
      map[norm] = { fileName: (map[norm] && map[norm].fileName) || fileBaseName(norm), bookmarks: merged };
    }
  });
  return map;
}

// مرحله ۱۸ — صفِ ترتیبیِ تغییرهایِ تمپلیت: دو ساختِ پشتِ سرِ هم،
// هرگز از رویِ یک snapshotِ کهنهٔ state خوانده نمی‌شوند؛ هر تغییر،
// پس از اتمامِ کاملِ تغییرِ قبلی (state + IPC) اجرا می‌شود.
let presetWriteChain = Promise.resolve();
function queuePresetWrite(fn) {
  const run = presetWriteChain.then(fn, fn);
  presetWriteChain = run.catch(() => {});
  return run;
}

// مرحله ۱۶، بخش ب: کلیدِ یکتایِ کتاب برایِ بوک‌مارک — همهٔ حالت‌ها
// (PDF، آرشیوِ کمیک، پوشهٔ تصاویر، فایلِ تکیِ وب‌پ/jpg/png) پوشش
// داده می‌شوند؛ ورودی‌ها trim می‌شوند.
export function resolveActiveBookKey(comicData, currentComic) {
  const raw =
    comicData?.filePath ||
    comicData?.path ||
    currentComic?.filePath ||
    currentComic?.path ||
    comicData?.items?.[0]?.filePath ||
    comicData?.items?.[0]?.path ||
    '';
  return typeof raw === 'string' ? raw.trim() : '';
}

// مرحله ۱۶، بخش ب: نرمال‌سازِ یکنواختِ کلیدِ بوک‌مارک — اسلشِ
// ویندوزی و اسلشِ وب، هر دو به بک‌اسلش نگاشت می‌شوند و حروف کوچک
// می‌شوند؛ دقیقاً همان نگاشتی که ورکرِ دیتابیس (normalizePath) رویِ
// کلیدهایِ ذخیره‌شده در db.json اعمال می‌کند، تا بوک‌مارک‌هایِ قبلی
// هم با کلیدِ تازه دیده شوند. رویِ همهٔ ورودی‌ها و خروجی‌هایِ
// bookmarksByFile اعمال می‌شود تا خواندن و نوشتن، همیشه یک کلید
// ببینند (تکرارِ نرمال‌سازی بی‌اثر است).
export function normalizeBookKey(filePath) {
  if (typeof filePath !== 'string') return '';
  return filePath.trim().replace(/[\\/]+/g, '\\').toLowerCase();
}

// مرحلهٔ ۵۹، مأموریت ۱ — پاک‌سازیِ بوک‌مارک با حفظِ فیلدهایِ
// ظاهریِ اختیاری (رنگ، استایلِ سفارشی، شناسهٔ پریست): پاک‌سازِ
// bookmarkTemplates این فیلدها را نمی‌شناسد و می‌اندازد؛ پس پس از
// پاک‌سازی، همان‌ها از رکوردِ خامِ ورودی برگردانده می‌شوند تا
// دورِ کاملِ ذخیره و خواندن، ظاهرِ استودیو را پس از ری‌استارت
// حفظ کند. نبودنشان، هیچ فیلدی اضافه نمی‌کند.
function attachBookmarkExtras(clean, raw) {
  if (!clean || !raw || typeof raw !== 'object') return clean;
  if (typeof raw.color === 'string' && raw.color) clean.color = raw.color.slice(0, 40);
  if (typeof raw.presetId === 'string' && raw.presetId) clean.presetId = raw.presetId.slice(0, 80);
  if (raw.customStyle && typeof raw.customStyle === 'object' && !Array.isArray(raw.customStyle)) {
    try {
      const styleJson = JSON.stringify(raw.customStyle);
      if (styleJson && styleJson.length <= 2000) clean.customStyle = JSON.parse(styleJson);
    } catch (_) {}
  }
  return clean;
}

function sanitizeBookmarkWithExtras(raw) {
  const clean = sanitizeBookmark(raw);
  return clean ? attachBookmarkExtras(clean, raw) : null;
}

// مرحله ۱۳: استورِ بوک‌مارک‌هایِ دیجیتال. کلیدِ bookmarksByFile،
// همان filePathای است که comicData می‌دهد (ورکرِ دیتابیس، خودش
// آن را نرمال می‌کند). ذخیره‌سازی، همیشه از راهِ dbAction است تا
// db.json تنها مرجعِ حقیقت بماند.

function toast(message, type = 'info') {
  try {
    const showToast = useAppStore.getState().showToast;
    if (typeof showToast === 'function') showToast(message, { type });
  } catch (_) {}
}

// مرحلهٔ ۵۸، مأموریت ۱ — یک‌شکل‌سازیِ پاسخِ دیتابیس: ورکر، موفقیت را
// با { type: 'done', success: true } و شکست را با { type: 'error', message }
// برمی‌گرداند (پاسخِ خطا، هیچ فیلدِ success ندارد)؛ بررسیِ قدیمیِ
// res.success === false، شکستِ واقعیِ ورکر را نمی‌دید و موفقیتِ کاذب
// نشان می‌داد. این تابع، هر سه شکل (type و success و ok) را به یک
// قراردادِ { ok, error, data } برمی‌گرداند تا فراخواننده، فقط ok را ببیند.
// پاسخی که هیچ‌کدام از نشانه‌هایِ موفقیت را ندارد، شکست حساب می‌شود تا
// هیچ‌وقت، موفقیتِ کاذب ساخته نشود.
function normalizeDbResult(res) {
  if (res === null || res === undefined) return { ok: false, error: 'پاسخی از دیتابیس نرسید.' };
  // مرحلهٔ ۵۹، مأموریت ۱ — آرایهٔ خام، خودش یک پاسخِ موفق است
  // (فهرستِ بوک‌مارک‌ها، بدونِ هیچ پوششی).
  if (Array.isArray(res)) return { ok: true, data: res };
  if (typeof res !== 'object') return { ok: false, error: 'پاسخی از دیتابیس نرسید.' };
  if (res.type === 'error') {
    return { ok: false, error: typeof res.message === 'string' && res.message ? res.message : 'خطا در عملیات دیتابیس' };
  }
  if (res.ok === false || res.success === false) {
    const msg = typeof res.error === 'string' && res.error
      ? res.error
      : (typeof res.message === 'string' && res.message ? res.message : 'عملیاتِ دیتابیس ناموفق بود.');
    return { ok: false, error: msg };
  }
  if (res.type === 'done' || res.ok === true || res.success === true) return { ok: true, data: res };
  // مرحلهٔ ۵۹، مأموریت ۱ — خطایِ صریحِ بدونِ نشانه، پیش از
  // موفقیتِ بدونِ نشانه بررسی می‌شود؛ پاسخِ موفق، هرگز فیلدِ
  // error ِ رشته‌ای ندارد.
  if (typeof res.error === 'string' && res.error) return { ok: false, error: res.error };
  // مرحلهٔ ۵۹، مأموریت ۱ — شکل‌هایِ موفقِ بدونِ نشانه (منبعِ
  // خطایِ کاذبِ مرحلهٔ ۵۸): شیءِ { bookmarks: [...] } یا
  // { preferences: {...} } یا { files: [...] } بدونِ type:done و
  // بدونِ ok/success، دادهٔ سالم‌اند، نه خطا.
  if (Array.isArray(res.bookmarks) || Array.isArray(res.files)) return { ok: true, data: res };
  if (res.preferences && typeof res.preferences === 'object') return { ok: true, data: res };
  if (typeof res.message === 'string' && res.message) return { ok: false, error: res.message };
  return { ok: false, error: 'پاسخِ دیتابیس به شکلِ موردِ انتظار نبود.' };
}

export const useBookmarkStore = create((set, get) => ({
  bookmarksByFile: {},
  loadedFilePath: null,
  // مرحله ۱۸ — حالتِ اولیه، مستقیماً و همگام از localStorage خوانده
  // می‌شود؛ پس حتی پیش از اولین IPC، ساخته‌هایِ نشستِ قبل سرِ جایشان‌اند.
  preferences: readPrefsLocalStorage() || { ...DEFAULT_BOOKMARK_PREFERENCES, savedPresets: [] },
  preferencesLoaded: false,
  isHydrated: false,
  // مرحله ۱۴: کشِ سراسریِ همهٔ کتاب‌ها (برای سایدبار و نمایِ
  // بوک‌مارک‌ها) + شمارندهٔ کل، تا بجِ سایدبار بدونِ خواندنِ
  // دوبارهٔ دیتابیس به‌روز بماند.
  allBookmarkFiles: {},
  allBookmarksLoaded: false,
  totalBookmarkCount: 0,
  // مرحلهٔ ۵۷، مأموریت ۱ — شمارندهٔ واکنش‌گرِ جهش‌ها: با هر
  // ساخت/ویرایش/حذفِ بوک‌مارک یا پریست، یک واحد بالا می‌رود تا
  // مصرف‌کننده‌ها بی‌درنگ بازرندر شوند.
  bookmarkVersion: 0,

  studioOpen: false,
  studioTarget: null, // { filePath, page, yRatio, bookmarkId? }
  jumpTarget: null, // { filePath, page, yRatio, nonce }

  backgrounds: [],
  backgroundsDir: null,
  backgroundsLoaded: false,

  loadPreferences: async () => {
    if (get().isHydrated) return;
    if (!coreApi.isAvailable()) {
      // مرحله ۱۶: ناکامی، «بارگذاری‌شده» حساب نمی‌شود؛ حالتِ
      // اولیه (که از localStorage خوانده شده) سرِ جایش می‌ماند و
      // هیچ چیزی با [] شسته نمی‌شود.
      return;
    }
    const lsPrefs = readPrefsLocalStorage();
    const lsPresets = lsPrefs ? lsPrefs.savedPresets : [];
    let dbRaw = null;
    try {
      const res = await coreApi.dbAction({ action: 'GET_BOOKMARK_PREFERENCES', payload: {} });
      if (res && res.preferences && typeof res.preferences === 'object') dbRaw = res.preferences;
    } catch (_) {}
    if (!dbRaw) {
      // دیتابیس در دسترس نیست: هیدرات ناتمام می‌ماند تا تلاشِ بعدی؛
      // ساخته‌هایِ localStorage، در stateِ اولیه زنده‌اند.
      return;
    }
    const dbTemplateImages = {};
    if (dbRaw.templateImages && typeof dbRaw.templateImages === 'object') {
      Object.entries(dbRaw.templateImages).forEach(([id, url]) => {
        if (isValidBookmarkTemplate(id) && typeof url === 'string' && url) {
          dbTemplateImages[id] = url;
        }
      });
    }
    const dbPresets = [];
    if (Array.isArray(dbRaw.savedPresets)) {
      dbRaw.savedPresets.forEach((p) => {
        const c = cleanPreset(p);
        if (c && dbPresets.length < 100) dbPresets.push(c);
      });
    }
    // مرحله ۱۵ — ادغامِ bookmark-presets.jsonِ همراهِ نرم‌افزار:
    // فقط شناسه‌هایی که در دیتابیس نیستند اضافه می‌شوند.
    const filePresets = [];
    if (typeof coreApi.getAppBookmarkPresets === 'function') {
      try {
        const fp = await coreApi.getAppBookmarkPresets();
        if (fp && fp.success && Array.isArray(fp.presets)) {
          fp.presets.forEach((p) => {
            const c = cleanPreset(p);
            if (c && filePresets.length < 100) filePresets.push(c);
          });
        }
      } catch (_) {}
    }
    // مرحله ۱۸ — اتحادِ سه‌لایه، با قانونِ «هرگز []، چیزی را پاک
    // نمی‌کند»: دیتابیس ← فایل (فقط تازه‌ها) ← localStorage (برندهٔ
    // تعارض + تازه‌ها). localStorage تازه‌ترین است، چون هر تغییر
    // اولِ اول همان‌جا (همگام) نوشته می‌شود.
    const byId = new Map();
    dbPresets.forEach((p) => byId.set(p.id, p));
    filePresets.forEach((p) => { if (!byId.has(p.id)) byId.set(p.id, p); });
    lsPresets.forEach((p) => byId.set(p.id, p));
    const savedPresets = [...byId.values()].slice(0, 100);
    const nextPrefs = {
      defaultTemplate: lsPrefs
        ? lsPrefs.defaultTemplate
        : (isValidBookmarkTemplate(dbRaw.defaultTemplate) ? dbRaw.defaultTemplate : DEFAULT_BOOKMARK_PREFERENCES.defaultTemplate),
      globalImage: lsPrefs
        ? lsPrefs.globalImage
        : (typeof dbRaw.globalImage === 'string' ? dbRaw.globalImage : null),
      templateImages: lsPrefs ? lsPrefs.templateImages : dbTemplateImages,
      defaultSide: lsPrefs
        ? lsPrefs.defaultSide
        : (dbRaw.defaultSide === 'left' ? 'left' : 'right'),
      savedPresets,
    };
    const prefsChanged = !jsonEqual(get().preferences, nextPrefs);
    set({
      preferences: nextPrefs,
      preferencesLoaded: true,
      isHydrated: true,
      bookmarkVersion: prefsChanged ? (get().bookmarkVersion || 0) + 1 : (get().bookmarkVersion || 0),
    });
    writePrefsLocalStorage(nextPrefs);
    // سینکِ برگشتی: هر پریستی که در دیتابیس نبود، یا محتوایش با
    // اتحاد فرق داشت، به دیتابیس (و از راهِ آینهٔ ipcHandlers، به
    // bookmark-presets.json) برگردانده می‌شود تا دیتابیس هم درمان شود.
    const dbById = new Map(dbPresets.map((p) => [p.id, p]));
    const needsSyncBack = savedPresets.some((p) => {
      const d = dbById.get(p.id);
      return !d || JSON.stringify(d) !== JSON.stringify(p);
    });
    if (needsSyncBack) {
      try { await get().savePreferences({ savedPresets }); } catch (_) {}
    }
  },

  loadBookmarksForFile: async (filePath) => {
    filePath = normalizeBookKey(filePath);
    if (!filePath) return;
    if (get().loadedFilePath === filePath && get().bookmarksByFile?.[filePath]) return;
    if (!coreApi.isAvailable()) {
      // مرحله ۱۹ — بدونِ IPC هم، آینهٔ محلی نشان داده می‌شود تا
      // بوک‌مارک‌ها هرگز خالی به نظر نرسند.
      const lsList = readBookmarksLocalStorage(filePath);
      const listChanged = !jsonEqual(get().bookmarksByFile && get().bookmarksByFile[filePath], lsList);
      set((state) => ({
        bookmarksByFile: { ...(state.bookmarksByFile || {}), [filePath]: lsList },
        loadedFilePath: filePath,
        bookmarkVersion: listChanged ? (state.bookmarkVersion || 0) + 1 : (state.bookmarkVersion || 0),
      }));
      return;
    }
    try {
      const res = await coreApi.dbAction({ action: 'GET_BOOKMARKS', payload: { filePath } });
      const dbList = Array.isArray(res && res.bookmarks)
        ? res.bookmarks.map(sanitizeBookmarkWithExtras).filter(Boolean)
        : [];
      // مرحله ۱۹ — اتحادِ دیتابیس با آینهٔ محلی (محلی برندهٔ تعارض
      // است، چون هر تغییر اولِ اول همان‌جا نوشته می‌شود)؛ هرگز یک
      // فهرستِ خالی از دیتابیس، بوک‌مارک‌هایِ محلی را پاک نمی‌کند.
      const merged = mergeBookmarkLists(dbList, readBookmarksLocalStorage(filePath));
      const listChanged = !jsonEqual(get().bookmarksByFile && get().bookmarksByFile[filePath], merged);
      set((state) => ({
        bookmarksByFile: { ...(state.bookmarksByFile || {}), [filePath]: merged },
        loadedFilePath: filePath,
        bookmarkVersion: listChanged ? (state.bookmarkVersion || 0) + 1 : (state.bookmarkVersion || 0),
      }));
      writeBookmarksLocalStorage(filePath, merged);
      // سینکِ برگشتی: اگر اتحاد چیزی داشت که دیتابیس نداشت، به
      // دیتابیس برگردد تا دفعهٔ بعد، همان‌جا هم کامل باشد.
      if (JSON.stringify(merged) !== JSON.stringify(dbList)) {
        try { await get().persistBookmarks(filePath, merged); } catch (_) {}
      }
    } catch (_) {
      const lsList = readBookmarksLocalStorage(filePath);
      const listChanged = !jsonEqual(get().bookmarksByFile && get().bookmarksByFile[filePath], lsList);
      set((state) => ({
        bookmarksByFile: { ...(state.bookmarksByFile || {}), [filePath]: lsList },
        loadedFilePath: filePath,
        bookmarkVersion: listChanged ? (state.bookmarkVersion || 0) + 1 : (state.bookmarkVersion || 0),
      }));
    }
  },

  // مرحلهٔ ۵۸، مأموریت ۱ — قراردادِ بازگشت، { ok, error, data } است
  // (normalizeDbResult)؛ مقدارِ خامِ ورکر، دیگر برنمی‌گردد تا هیچ
  // فراخواننده‌ای، { type: 'error' } را با موفقیت اشتباه نگیرد.
  // فیلدها هم در payload فرستاده می‌شوند (قراردادِ همهٔ فراخواننده‌ها).
  persistBookmarks: async (filePath, list) => {
    filePath = normalizeBookKey(filePath);
    if (!coreApi.isAvailable() || !filePath) return { ok: false, error: 'ارتباط با دیتابیس برقرار نیست.' };
    try {
      const res = await coreApi.dbAction({ action: 'SAVE_BOOKMARKS', payload: { filePath, bookmarks: list } });
      return normalizeDbResult(res);
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  },

  addBookmark: async (draft) => {
    const filePath = normalizeBookKey(draft && draft.filePath);
    if (!filePath) return null;
    const prefs = get().preferences || {};
    const bm = sanitizeBookmarkWithExtras({
      ...draft,
      id: newBookmarkId(),
      template: draft.template || prefs.defaultTemplate || 'MARGIN',
      side: draft.side || prefs.defaultSide || 'right',
      yRatio: clampYRatio(draft.yRatio),
    });
    if (!bm) return null;
    // مرحلهٔ ۵۷، مأموریت ۱ — جهشِ خوش‌بینانه و همگام: فهرستِ تازه،
    // با ارجاعِ آرایهٔ تازه، از خودِ state ساخته می‌شود (نه از
    // snapshot) و شمارندهٔ bookmarkVersion هم در همان set بالا
    // می‌رود تا همهٔ مصرف‌کننده‌ها بی‌درنگ بازرندر شوند.
    let next = null;
    set((state) => {
      const prev = state.bookmarksByFile?.[filePath] || [];
      next = [...prev, bm];
      return {
        bookmarksByFile: { ...(state.bookmarksByFile || {}), [filePath]: next },
        bookmarkVersion: (state.bookmarkVersion || 0) + 1,
      };
    });
    get().syncAllCacheForFile(filePath, next);
    // مرحله ۱۹ — آینهٔ همگام، پیش از IPC: حتی اگر ذخیره در دیتابیس
    // ناموفق باشد، بوک‌مارک در حافظهٔ محلی امن است و در بارگذاریِ
    // بعدی با اتحاد و سینکِ برگشتی به دیتابیس برمی‌گردد؛ پس state
    // دیگر به prev برنمی‌گردد (برگرداندن، با نوشتنِ بعدیِ آینه،
    // بوک‌مارک را از آینه هم پاک می‌کرد). فقط مقدارِ برگشتی null
    // می‌شود تا فراخواننده (مودال/منو) موفقیتِ کاذب نشان ندهد.
    // مرحلهٔ ۵۹، مأموریت ۱ — آینهٔ محلی، همین بالا همگام نوشته شد؛
    // اگر فقط دیتابیس ناموفق بود، بوک‌مارک در حافظهٔ محلی امن است و
    // در بارگذاریِ بعدی با سینکِ برگشتی به دیتابیس برمی‌گردد؛ پس
    // توستِ خطا فقط وقتی می‌آید که آینهٔ محلی هم ننوشته باشد.
    const lsOk = writeBookmarksLocalStorage(filePath, next);
    // مرحلهٔ ۵۸، مأموریت ۱ — فقط شکستِ واقعیِ هر دو لایه، توستِ خطا
    // می‌گیرد و null برمی‌گرداند؛ در موفقیت، هیچ توستِ خطایی نیست.
    // توستِ سبزِ موفقیت، در مودال است تا توست، دوتایی نشود.
    const saved = await get().persistBookmarks(filePath, next);
    if ((!saved || !saved.ok) && !lsOk) {
      toast('ذخیرهٔ بوک‌مارک ناموفق بود؛ نه در دیتابیس و نه در حافظهٔ محلی ذخیره نشد.', 'error');
      return null;
    }
    return bm;
  },

  updateBookmark: async (filePath, id, patch) => {
    filePath = normalizeBookKey(filePath);
    if (!filePath || !id) return null;
    const prev = get().bookmarksByFile?.[filePath] || [];
    const idx = prev.findIndex((b) => b.id === id);
    if (idx < 0) return null;
    const updated = sanitizeBookmarkWithExtras({ ...prev[idx], ...patch, id });
    if (!updated) return null;
    // مرحلهٔ ۵۷، مأموریت ۱ — جهشِ خوش‌بینانه و همگام (مانندِ addBookmark).
    let next = null;
    set((state) => {
      const base = state.bookmarksByFile?.[filePath] || [];
      const at = base.findIndex((b) => b.id === id);
      if (at < 0) return {};
      next = [...base];
      next[at] = updated;
      return {
        bookmarksByFile: { ...(state.bookmarksByFile || {}), [filePath]: next },
        bookmarkVersion: (state.bookmarkVersion || 0) + 1,
      };
    });
    if (!next) return null;
    get().syncAllCacheForFile(filePath, next);
    // مرحله ۱۹ — آینهٔ همگام، پیش از IPC (مانندِ addBookmark): تغییر،
    // حتی با شکستِ IPC، در حافظهٔ محلی امن می‌ماند و در بارگذاریِ
    // بعدی به دیتابیس برمی‌گردد؛ state به prev برنمی‌گردد.
    // مرحلهٔ ۵۹، مأموریت ۱ — مانندِ addBookmark: توستِ خطا فقط
    // وقتی می‌آید که هم دیتابیس و هم آینهٔ محلی ناموفق بوده باشند.
    const lsOk = writeBookmarksLocalStorage(filePath, next);
    // مرحلهٔ ۵۸، مأموریت ۱ — فقط شکستِ واقعیِ هر دو لایه، توستِ خطا
    // می‌گیرد و null برمی‌گرداند؛ توستِ سبزِ موفقیت، در مودال است.
    const saved = await get().persistBookmarks(filePath, next);
    if ((!saved || !saved.ok) && !lsOk) {
      toast('ذخیرهٔ تغییرِ بوک‌مارک ناموفق بود؛ نه در دیتابیس و نه در حافظهٔ محلی ذخیره نشد.', 'error');
      return null;
    }
    return updated;
  },

  deleteBookmark: async (filePath, id) => {
    filePath = normalizeBookKey(filePath);
    if (!filePath || !id) return;
    // مرحلهٔ ۵۷، مأموریت ۱ — جهشِ خوش‌بینانه و همگام (مانندِ addBookmark).
    let next = null;
    set((state) => {
      const base = state.bookmarksByFile?.[filePath] || [];
      const filtered = base.filter((b) => b.id !== id);
      if (filtered.length === base.length) return {};
      next = filtered;
      return {
        bookmarksByFile: { ...(state.bookmarksByFile || {}), [filePath]: next },
        bookmarkVersion: (state.bookmarkVersion || 0) + 1,
      };
    });
    if (!next) return;
    get().syncAllCacheForFile(filePath, next);
    // مرحله ۱۹ — آینهٔ همگام، پیش از IPC. اگر IPC ناموفق باشد،
    // دیتابیس هنوز بوک‌مارک را دارد و اتحادِ بارگذاریِ بعدی آن را
    // برمی‌گرداند؛ توستِ خطا هم همین را می‌گوید.
    writeBookmarksLocalStorage(filePath, next);
    // مرحلهٔ ۵۹، مأموریت ۱ — انحرافِ آگاهانه از قانونِ «هر دو لایه»:
    // آینهٔ محلی نمی‌تواند حذف را حفظ کند، چون loadBookmarksForFile
    // در بارگذاریِ بعدی، نسخهٔ دیتابیس را (که هنوز رکورد را دارد) با
    // آینه اتحاد می‌کند و بوک‌مارکِ حذف‌شده بازمی‌گردد؛ پس شکستِ
    // دیتابیس در حذف، خطایِ واقعی است و توستِ خطا می‌ماند. (نگه‌داشتنِ
    // حذف بدونِ دیتابیس، سنگِ قبر می‌خواهد و در حوزهٔ این مأموریت نیست.)
    // مرحلهٔ ۵۸، مأموریت ۱ — فقط شکستِ واقعیِ دیتابیس، توستِ خطا
    // می‌گیرد؛ موفقیت، true برمی‌گرداند تا مودال/نما بدانند حذف
    // واقعاً تأیید شده است.
    const saved = await get().persistBookmarks(filePath, next);
    if (!saved || !saved.ok) {
      toast('حذف در دیتابیس ناموفق بود؛ بوک‌مارک در باز شدنِ بعدی بازمی‌گردد.', 'error');
      return false;
    }
    // توستِ موفقیت، سبز است (پیش از این info بود)؛ هیچ نما، برایِ
    // حذف توست نمی‌دهد، پس همین‌جا تنها توستِ موفقیت است.
    toast('بوک‌مارک حذف شد.', 'success');
    return true;
  },

  savePreferences: async (patch) => {
    // مرحله ۱۶: هرگز با حالتِ پیش‌فرضِ بارگذاری‌نشده ننویس؛ اول
    // هیدرات کن و اگر باز هم نشد، نوشتن را رد کن تا ساخته‌هایِ
    // قبلیِ کاربر با [] شسته نشوند.
    if (!get().isHydrated) {
      try { await get().loadPreferences(); } catch (_) {}
    }
    if (!get().isHydrated) {
      toast('تنظیماتِ بوک‌مارک هنوز بارگذاری نشده؛ ذخیره انجام نشد.', 'error');
      return { ok: false, preferences: get().preferences, error: 'تنظیماتِ بوک‌مارک هنوز بارگذاری نشده است.' };
    }
    const prev = get().preferences || { ...DEFAULT_BOOKMARK_PREFERENCES, savedPresets: [] };
    const raw = { ...prev, ...(patch || {}) };
    const templateImages = {};
    if (raw.templateImages && typeof raw.templateImages === 'object') {
      Object.entries(raw.templateImages).forEach(([id, url]) => {
        if (isValidBookmarkTemplate(id) && typeof url === 'string' && url) {
          templateImages[id] = url;
        }
      });
    }
    const savedPresets = [];
    if (Array.isArray(raw.savedPresets)) {
      raw.savedPresets.forEach((p) => {
        if (!p || typeof p !== 'object') return;
        if (savedPresets.length >= 100) return;
        savedPresets.push({
          id: typeof p.id === 'string' && p.id ? p.id : ('preset_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)),
          name: typeof p.name === 'string' ? p.name.slice(0, 60) : '',
          template: isValidBookmarkTemplate(p.template) ? p.template : 'MARGIN',
          image: typeof p.image === 'string' ? p.image : null,
          focalPoint: p.focalPoint === 'top' || p.focalPoint === 'bottom' ? p.focalPoint : 'center',
          side: p.side === 'left' ? 'left' : 'right',
          createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
        });
      });
    }
    const next = {
      defaultTemplate: isValidBookmarkTemplate(raw.defaultTemplate)
        ? raw.defaultTemplate
        : prev.defaultTemplate,
      globalImage: typeof raw.globalImage === 'string' ? raw.globalImage : null,
      templateImages,
      defaultSide: raw.defaultSide === 'left' ? 'left' : 'right',
      savedPresets,
    };
    // مرحله ۱۸ — لایهٔ ۱، پیش از هر IPC: همین‌جا، همگام.
    // مرحلهٔ ۵۹، مأموریت ۱ — نتیجهٔ lsOk، گیتِ توستِ خطاست: وقتی
    // آینهٔ محلی نوشته شده، تنظیمات امن‌اند و در بارگذاریِ بعدی با
    // سینکِ برگشتی به دیتابیس برمی‌گردند؛ پس شکستِ تنها دیتابیس،
    // توستِ خطا نمی‌گیرد و ok:true با dbError برمی‌گردد تا
    // فراخواننده (ساخت/حذفِ پریست) رفتارِ درست را ادامه دهد.
    const lsOk = writePrefsLocalStorage(next);
    // مرحلهٔ ۵۷، مأموریت ۱ — شمارنده، فقط وقتی بالا می‌رود که
    // محتوا واقعاً عوض شده باشد؛ پس تأییدِ پس‌زمینهٔ یک پریستِ
    // خوش‌بینانه، شمارنده را دو بار بالا نمی‌برد.
    const prefsChanged = !jsonEqual(get().preferences, next);
    set({
      preferences: next,
      bookmarkVersion: prefsChanged ? (get().bookmarkVersion || 0) + 1 : (get().bookmarkVersion || 0),
    });
    // مرحلهٔ ۵۸، مأموریت ۱ — نتیجهٔ ورکر خوانده می‌شود (پیش از این،
    // نتیجه نادیده گرفته می‌شد و شکستِ واقعی، بی‌صدا می‌ماند)؛ فقط
    // شکستِ واقعی توستِ خطا می‌گیرد. بازگشت: { ok, preferences, error }.
    if (!coreApi.isAvailable()) {
      if (lsOk) return { ok: true, preferences: next, dbError: 'ارتباط با دیتابیس برقرار نیست.' };
      return { ok: false, preferences: next, error: 'ارتباط با دیتابیس برقرار نیست.' };
    }
    try {
      const res = await coreApi.dbAction({ action: 'SAVE_BOOKMARK_PREFERENCES', payload: { preferences: next } });
      const saved = normalizeDbResult(res);
      if (!saved.ok) {
        if (lsOk) return { ok: true, preferences: next, dbError: saved.error };
        toast('ذخیرهٔ تنظیماتِ بوک‌مارک انجام نشد؛ نه در دیتابیس و نه در حافظهٔ محلی ذخیره نشد.', 'error');
        return { ok: false, preferences: next, error: saved.error };
      }
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (lsOk) return { ok: true, preferences: next, dbError: msg };
      toast('ذخیرهٔ تنظیماتِ بوک‌مارک انجام نشد؛ نه در دیتابیس و نه در حافظهٔ محلی ذخیره نشد.', 'error');
      return { ok: false, preferences: next, error: msg };
    }
    return { ok: true, preferences: next };
  },

  // مرحله ۱۴: همگام‌سازیِ کشِ سراسری با تغییرِ یک کتاب؛ شمارندهٔ
  // کل هم از رویِ کش حساب می‌شود.
  // مرحلهٔ ۵۷، مأموریت ۱ — علتِ اصلیِ گزارشِ کاربر («بوک‌مارک تا
  // ری‌استارت دیده نمی‌شود») همین‌جا بود: loadAllBookmarks ورودیِ
  // کش را به شکلِ { fileName, bookmarks } می‌سازد، ولی این تابع،
  // آرایهٔ خام را جایِ آن می‌گذاشت (next[filePath] = list)؛ پس
  // BookmarksView که فقط entry.bookmarks را می‌خواند، ورودی را
  // خالی می‌دید و با فیلترِ length > 0 حذفش می‌کرد، در حالی که
  // totalBookmarkCount (که آرایه را هم می‌فهمید) بالا می‌رفت.
  // ری‌استارت، کش را از دیتابیس با شکلِ درست بازمی‌ساخت و بوک‌مارک
  // «ظاهر» می‌شد. اصلاح: همیشه شکلِ { fileName, bookmarks } با
  // آرایهٔ تازه نوشته می‌شود و fileNameِ قبلی حفظ می‌شود. همچنین
  // دیگر به allBookmarksLoaded وابسته نیست — کش، حتی پیش از اولین
  // بارگذاریِ نما، بذر می‌خورد؛ loadAllBookmarks به‌جایِ شستن،
  // با کشِ تازه اتحاد می‌کند. این تابع، بخشی از همان جهش است و
  // شمارنده را جداگانه بالا نمی‌برد (جهشِ اصلی، یک بار بالا برده است).
  syncAllCacheForFile: (filePath, list) => {
    filePath = normalizeBookKey(filePath);
    if (!filePath) return;
    set((state) => {
      const prevAll = state.allBookmarkFiles || {};
      const prevEntry = prevAll[filePath];
      const prevFileName = prevEntry && typeof prevEntry === 'object' && !Array.isArray(prevEntry)
        ? prevEntry.fileName
        : null;
      const next = { ...prevAll };
      if (!list || list.length === 0) delete next[filePath];
      else next[filePath] = { fileName: prevFileName || fileBaseName(filePath), bookmarks: [...list] };
      return { allBookmarkFiles: next, totalBookmarkCount: countAllBookmarkEntries(next) };
    });
  },

  loadAllBookmarks: async (force = false) => {
    if (get().allBookmarksLoaded && !force) return get().allBookmarkFiles;
    if (!coreApi.isAvailable()) {
      // مرحلهٔ ۵۷، مأموریت ۱ — بدونِ IPC هم، کشِ سراسری از حافظه و
      // آینهٔ محلی ساخته می‌شود تا نما خالی نماند (پایه، {} برمی‌گرداند
      // و بوک‌مارکِ محلی را تا بارگذاریِ بعدی پنهان می‌کرد).
      const localMap = buildLocalAllBookmarksMap(get().bookmarksByFile);
      const changed = !jsonEqual(get().allBookmarkFiles, localMap);
      set({
        allBookmarkFiles: localMap,
        allBookmarksLoaded: true,
        totalBookmarkCount: countAllBookmarkEntries(localMap),
        bookmarkVersion: changed ? (get().bookmarkVersion || 0) + 1 : (get().bookmarkVersion || 0),
      });
      return localMap;
    }
    try {
      const res = await coreApi.dbAction({ action: 'GET_ALL_BOOKMARKS', payload: {} });
      const files = Array.isArray(res && res.files) ? res.files : [];
      const map = {};
      files.forEach((f) => {
        const list = Array.isArray(f.bookmarks) ? f.bookmarks.map(sanitizeBookmarkWithExtras).filter(Boolean) : [];
        if (list.length === 0) return;
        map[normalizeBookKey(f.filePath)] = { fileName: f.fileName || String(f.filePath).split(/[\\/]/).pop() || f.filePath, bookmarks: list };
      });
      // مرحلهٔ ۵۷، مأموریت ۱ — اتحاد با کشِ تازهٔ حافظه و آینهٔ
      // محلی (دقیقاً همان قانونِ loadBookmarksForFile: محلی برندهٔ
      // تعارض است)؛ خواندنِ کش، پس از await انجام می‌شود تا
      // بوک‌مارکی که در حینِ IPC ساخته شده، با نقشهٔ کهنه شسته نشود.
      const localMap = buildLocalAllBookmarksMap(get().bookmarksByFile);
      Object.entries(localMap).forEach(([key, entry]) => {
        const dbList = map[key] ? map[key].bookmarks : [];
        const merged = mergeBookmarkLists(dbList, entry.bookmarks);
        if (merged.length > 0) {
          map[key] = { fileName: (map[key] && map[key].fileName) || entry.fileName, bookmarks: merged };
        }
      });
      const changed = !jsonEqual(get().allBookmarkFiles, map);
      set({
        allBookmarkFiles: map,
        allBookmarksLoaded: true,
        totalBookmarkCount: countAllBookmarkEntries(map),
        bookmarkVersion: changed ? (get().bookmarkVersion || 0) + 1 : (get().bookmarkVersion || 0),
      });
      return map;
    } catch (_) {
      // مرحلهٔ ۵۷، مأموریت ۱ — شکستِ IPC، نما را خالی نمی‌کند؛
      // کشِ محلی نشان داده می‌شود.
      const localMap = buildLocalAllBookmarksMap(get().bookmarksByFile);
      const changed = !jsonEqual(get().allBookmarkFiles, localMap);
      set({
        allBookmarkFiles: localMap,
        allBookmarksLoaded: true,
        totalBookmarkCount: countAllBookmarkEntries(localMap),
        bookmarkVersion: changed ? (get().bookmarkVersion || 0) + 1 : (get().bookmarkVersion || 0),
      });
      return localMap;
    }
  },

  // مرحلهٔ ۵۲ §۱: حذفِ بوک‌مارک‌هایِ فایل‌هایِ رفته از استور و
  // آینهٔ localStorage. ورکر در همان همگام‌سازیِ دسته‌ای، ردیف‌هایِ
  // دیتابیس را پاک کرده است؛ اینجا فقط آینه‌هایِ رندرر خالی
  // می‌شوند تا با ری‌لود، بوک‌مارکِ کتابِ حذف‌شده زنده نشود.
  // هیچ IPC تازه‌ای ندارد.
  removeFileBookmarks: (filePaths) => {
    const paths = Array.isArray(filePaths) ? filePaths : [];
    if (paths.length === 0) return 0;
    const norms = new Set(paths.map((p) => normalizeBookKey(p)).filter(Boolean));
    if (norms.size === 0) return 0;
    let removed = 0;
    set((state) => {
      const nextByFile = { ...(state.bookmarksByFile || {}) };
      Object.keys(nextByFile).forEach((key) => {
        if (norms.has(normalizeBookKey(key))) {
          delete nextByFile[key];
          removed += 1;
        }
      });
      const nextAll = { ...(state.allBookmarkFiles || {}) };
      Object.keys(nextAll).forEach((key) => {
        if (norms.has(normalizeBookKey(key))) delete nextAll[key];
      });
      const total = Object.values(nextAll).reduce(
        (sum, entry) => sum + (Array.isArray(entry?.bookmarks) ? entry.bookmarks.length : Array.isArray(entry) ? entry.length : 0),
        0
      );
      return {
        bookmarksByFile: nextByFile,
        allBookmarkFiles: nextAll,
        totalBookmarkCount: total,
        loadedFilePath: norms.has(normalizeBookKey(state.loadedFilePath)) ? null : state.loadedFilePath,
        // مرحلهٔ ۵۷، مأموریت ۱ — شمارنده، فقط وقتی چیزی واقعاً حذف شد.
        bookmarkVersion: removed > 0 ? (state.bookmarkVersion || 0) + 1 : (state.bookmarkVersion || 0),
      };
    });
    removeFileBookmarksFromLocalStorage(paths);
    return removed;
  },

  // مرحله ۱۴: ساخت‌هایِ سفارشیِ کاربر — در تنظیماتِ سراسری
  // ذخیره می‌شوند تا در همهٔ کتاب‌ها در دسترس باشند.
  // مرحلهٔ ۵۷، مأموریت ۱ — ذخیرهٔ پریست هم، مثلِ بوک‌مارک، اول
  // همگام در استور می‌نشیند (پیش از صف و پیش از IPC) و فقط سینکِ
  // دیتابیس، نوبتی و در پس‌زمینه می‌ماند؛ پیش از این، set فقط
  // درونِ savePreferences و پس از انتظارِ صف (یعنی پس از IPCِ
  // پریستِ قبلی) و فقط در صورتِ هیدراتِ موفق انجام می‌شد و با
  // شکستِ هیدرات، ساخته تا ری‌استارت از نما پنهان می‌ماند.
  savePreset: async (preset) => {
    const prev = get().preferences?.savedPresets || [];
    if (prev.length >= 100) {
      toast('سقفِ ۱۰۰ ساختِ سفارشی پر شده است.', 'info');
      return null;
    }
    const base = cleanPreset(preset) || cleanPreset({});
    const clean = {
      ...base,
      createdAt: new Date().toISOString(),
    };
    const next = [...prev, clean];
    writePrefsLocalStorage({ ...(get().preferences || {}), savedPresets: next });
    set((state) => ({
      preferences: {
        ...(state.preferences || { ...DEFAULT_BOOKMARK_PREFERENCES, savedPresets: [] }),
        savedPresets: next,
      },
      bookmarkVersion: (state.bookmarkVersion || 0) + 1,
    }));
    // مرحلهٔ ۵۸، مأموریت ۱ — دیده‌شدنِ فوری، همچنان همگام است (set
    // بالا)، ولی بازگشت، پس از تأییدِ واقعیِ دیتابیس است؛ پس توستِ
    // سبزِ نما، فقط برایِ ذخیرهٔ تأییدشده می‌آید و شکستِ واقعی،
    // null برمی‌گرداند (توستِ خطا را savePreferences می‌دهد).
    let writeOk = false;
    try {
      const result = await queuePresetWrite(async () => get().savePreferences({ savedPresets: get().preferences?.savedPresets || next }));
      writeOk = Boolean(result && result.ok);
    } catch (_) {
      writeOk = false;
    }
    if (!writeOk) return null;
    return clean;
  },

  deletePreset: async (id) => {
    const prev = get().preferences?.savedPresets || [];
    const next = prev.filter((p) => p.id !== id);
    if (next.length === prev.length) return false;
    // مرحلهٔ ۵۷، مأموریت ۱ — حذفِ همگام و فوری (مانندِ savePreset).
    writePrefsLocalStorage({ ...(get().preferences || {}), savedPresets: next });
    set((state) => ({
      preferences: {
        ...(state.preferences || { ...DEFAULT_BOOKMARK_PREFERENCES, savedPresets: [] }),
        savedPresets: next,
      },
      bookmarkVersion: (state.bookmarkVersion || 0) + 1,
    }));
    // مرحلهٔ ۵۸، مأموریت ۱ — دیده‌شدنِ فوری، همچنان همگام است؛
    // بازگشت، پس از تأییدِ واقعیِ دیتابیس است (true یعنی حذف تأیید شد).
    let writeOk = false;
    try {
      const result = await queuePresetWrite(async () => get().savePreferences({ savedPresets: get().preferences?.savedPresets || next }));
      writeOk = Boolean(result && result.ok);
    } catch (_) {
      writeOk = false;
    }
    return writeOk;
  },

  // مرحله ۱۵: ویرایشِ یک ساختِ ذخیره‌شده — همان رکورد (همان id و
  // createdAt) به‌روز می‌شود تا کارت‌هایِ ساخته‌شده با آن، هویتشان
  // را از دست ندهند.
  updatePreset: async (id, patch) => {
    const prev = get().preferences?.savedPresets || [];
    const idx = prev.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const merged = {
      ...prev[idx],
      ...(patch || {}),
      id,
      name: typeof (patch && patch.name) === 'string' ? patch.name.slice(0, 60) : (prev[idx].name || ''),
      template: isValidBookmarkTemplate(patch && patch.template) ? patch.template : prev[idx].template,
      image: typeof (patch && patch.image) === 'string' || (patch && patch.image) === null ? patch.image : prev[idx].image,
      focalPoint: patch && (patch.focalPoint === 'top' || patch.focalPoint === 'bottom') ? patch.focalPoint : prev[idx].focalPoint,
      side: patch && patch.side === 'left' ? 'left' : 'right',
    };
    const next = [...prev];
    next[idx] = merged;
    // مرحلهٔ ۵۷، مأموریت ۱ — ویرایشِ همگام و فوری (مانندِ savePreset).
    writePrefsLocalStorage({ ...(get().preferences || {}), savedPresets: next });
    set((state) => ({
      preferences: {
        ...(state.preferences || { ...DEFAULT_BOOKMARK_PREFERENCES, savedPresets: [] }),
        savedPresets: next,
      },
      bookmarkVersion: (state.bookmarkVersion || 0) + 1,
    }));
    // مرحلهٔ ۵۸، مأموریت ۱ — دیده‌شدنِ فوری، همچنان همگام است؛
    // بازگشت، پس از تأییدِ واقعیِ دیتابیس است (در شکست، null برمی‌گردد).
    let writeOk = false;
    try {
      const result = await queuePresetWrite(async () => get().savePreferences({ savedPresets: get().preferences?.savedPresets || next }));
      writeOk = Boolean(result && result.ok);
    } catch (_) {
      writeOk = false;
    }
    if (!writeOk) return null;
    return merged;
  },

  openStudio: (target) => set({ studioOpen: true, studioTarget: target || null }),
  closeStudio: () => set({ studioOpen: false, studioTarget: null }),

  requestJump: (filePath, page, yRatio) => {
    set({
      jumpTarget: {
        filePath,
        page: Math.max(1, Math.floor(Number(page) || 1)),
        yRatio: clampYRatio(yRatio),
        nonce: Date.now(),
      },
    });
  },
  clearJumpTarget: () => set({ jumpTarget: null }),

  loadBackgrounds: async (force = false) => {
    if (get().backgroundsLoaded && !force) return get().backgrounds;
    let folderFiles = [];
    let dirs = null;
    if (coreApi.isAvailable()) {
      try {
        const res = await coreApi.listBookmarkBackgrounds();
        if (res && res.success) {
          folderFiles = Array.isArray(res.files) ? res.files : [];
          dirs = res.dirs || null;
        }
      } catch (_) {}
    }
    // مرحله ۱۵: والپیپرهایِ داخلی حذف شده‌اند؛ گالری، فقط
    // فایل‌هایِ واقعیِ پوشهٔ bookmark-backgrounds را نشان می‌دهد.
    const merged = [
      ...folderFiles.map((f) => ({
        id: 'folder:' + f.name,
        name: f.name,
        url: f.url,
        size: f.size || 0,
        source: 'folder',
      })),
    ];
    set({ backgrounds: merged, backgroundsDir: dirs, backgroundsLoaded: true });
    return merged;
  },

  // مرحله ۱۵: حذفِ یک عکس از پوشهٔ بوک‌مارک و تازه‌سازیِ گالری.
  deleteBookmarkBackground: async (name) => {
    if (!name || !coreApi.isAvailable()) return false;
    try {
      const res = await coreApi.deleteBookmarkBackground(name);
      if (res && res.success) {
        await get().loadBackgrounds(true);
        return true;
      }
      if (res && res.error) toast(res.error, 'error');
      return false;
    } catch (_) {
      return false;
    }
  },
}));

export default useBookmarkStore;
