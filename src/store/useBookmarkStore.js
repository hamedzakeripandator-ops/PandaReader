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

function writePrefsLocalStorage(prefs) {
  try {
    if (typeof window === 'undefined' || !window.localStorage || !prefs) return;
    window.localStorage.setItem(LS_PREFS_KEY, JSON.stringify(prefs));
  } catch (_) {}
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
    return list.map(sanitizeBookmark).filter(Boolean);
  } catch (_) { return []; }
}
function writeBookmarksLocalStorage(filePath, list) {
  try {
    if (typeof window === 'undefined' || !window.localStorage || !filePath) return;
    let parsed = {};
    try { parsed = JSON.parse(window.localStorage.getItem(LS_BOOKMARKS_KEY) || '{}') || {}; } catch (_) { parsed = {}; }
    if (!list || list.length === 0) delete parsed[filePath];
    else parsed[filePath] = list;
    window.localStorage.setItem(LS_BOOKMARKS_KEY, JSON.stringify(parsed));
  } catch (_) {}
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

const useBookmarkStore = create((set, get) => ({
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
      const res = await coreApi.dbAction({ action: 'GET_BOOKMARK_PREFERENCES' });
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
    set({
      preferences: nextPrefs,
      preferencesLoaded: true,
      isHydrated: true,
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
      set((state) => ({
        bookmarksByFile: { ...(state.bookmarksByFile || {}), [filePath]: readBookmarksLocalStorage(filePath) },
        loadedFilePath: filePath,
      }));
      return;
    }
    try {
      const res = await coreApi.dbAction({ action: 'GET_BOOKMARKS', filePath });
      const dbList = Array.isArray(res && res.bookmarks)
        ? res.bookmarks.map(sanitizeBookmark).filter(Boolean)
        : [];
      // مرحله ۱۹ — اتحادِ دیتابیس با آینهٔ محلی (محلی برندهٔ تعارض
      // است، چون هر تغییر اولِ اول همان‌جا نوشته می‌شود)؛ هرگز یک
      // فهرستِ خالی از دیتابیس، بوک‌مارک‌هایِ محلی را پاک نمی‌کند.
      const merged = mergeBookmarkLists(dbList, readBookmarksLocalStorage(filePath));
      set((state) => ({
        bookmarksByFile: { ...(state.bookmarksByFile || {}), [filePath]: merged },
        loadedFilePath: filePath,
      }));
      writeBookmarksLocalStorage(filePath, merged);
      // سینکِ برگشتی: اگر اتحاد چیزی داشت که دیتابیس نداشت، به
      // دیتابیس برگردد تا دفعهٔ بعد، همان‌جا هم کامل باشد.
      if (JSON.stringify(merged) !== JSON.stringify(dbList)) {
        try { await get().persistBookmarks(filePath, merged); } catch (_) {}
      }
    } catch (_) {
      set((state) => ({
        bookmarksByFile: { ...(state.bookmarksByFile || {}), [filePath]: readBookmarksLocalStorage(filePath) },
        loadedFilePath: filePath,
      }));
    }
  },

  persistBookmarks: async (filePath, list) => {
    filePath = normalizeBookKey(filePath);
    if (!coreApi.isAvailable() || !filePath) return { success: false };
    try {
      const res = await coreApi.dbAction({ action: 'SAVE_BOOKMARKS', filePath, bookmarks: list });
      return res || { success: false };
    } catch (err) {
      return { success: false, error: String((err && err.message) || err) };
    }
  },

  addBookmark: async (draft) => {
    const filePath = normalizeBookKey(draft && draft.filePath);
    if (!filePath) return null;
    const prefs = get().preferences || {};
    const bm = sanitizeBookmark({
      ...draft,
      id: newBookmarkId(),
      template: draft.template || prefs.defaultTemplate || 'MARGIN',
      side: draft.side || prefs.defaultSide || 'right',
      yRatio: clampYRatio(draft.yRatio),
    });
    if (!bm) return null;
    const prev = get().bookmarksByFile?.[filePath] || [];
    const next = [...prev, bm];
    set((state) => ({ bookmarksByFile: { ...(state.bookmarksByFile || {}), [filePath]: next } }));
    get().syncAllCacheForFile(filePath, next);
    // مرحله ۱۹ — آینهٔ همگام، پیش از IPC: حتی اگر ذخیره در دیتابیس
    // ناموفق باشد، بوک‌مارک در حافظهٔ محلی امن است و در بارگذاریِ
    // بعدی با اتحاد و سینکِ برگشتی به دیتابیس برمی‌گردد؛ پس state
    // دیگر به prev برنمی‌گردد (برگرداندن، با نوشتنِ بعدیِ آینه،
    // بوک‌مارک را از آینه هم پاک می‌کرد). فقط مقدارِ برگشتی null
    // می‌شود تا فراخواننده (مودال/منو) موفقیتِ کاذب نشان ندهد.
    writeBookmarksLocalStorage(filePath, next);
    const res = await get().persistBookmarks(filePath, next);
    if (!res || res.success === false) {
      toast('ذخیره در دیتابیس ناموفق بود؛ بوک‌مارک در حافظهٔ محلی نگه داشته شد.', 'error');
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
    const updated = sanitizeBookmark({ ...prev[idx], ...patch, id });
    if (!updated) return null;
    const next = [...prev];
    next[idx] = updated;
    set((state) => ({ bookmarksByFile: { ...(state.bookmarksByFile || {}), [filePath]: next } }));
    get().syncAllCacheForFile(filePath, next);
    // مرحله ۱۹ — آینهٔ همگام، پیش از IPC (مانندِ addBookmark): تغییر،
    // حتی با شکستِ IPC، در حافظهٔ محلی امن می‌ماند و در بارگذاریِ
    // بعدی به دیتابیس برمی‌گردد؛ state به prev برنمی‌گردد.
    writeBookmarksLocalStorage(filePath, next);
    const res = await get().persistBookmarks(filePath, next);
    if (!res || res.success === false) {
      toast('ذخیرهٔ تغییر در دیتابیس ناموفق بود؛ تغییر در حافظهٔ محلی نگه داشته شد.', 'error');
      return null;
    }
    return updated;
  },

  deleteBookmark: async (filePath, id) => {
    filePath = normalizeBookKey(filePath);
    if (!filePath || !id) return;
    const prev = get().bookmarksByFile?.[filePath] || [];
    const next = prev.filter((b) => b.id !== id);
    if (next.length === prev.length) return;
    set((state) => ({ bookmarksByFile: { ...(state.bookmarksByFile || {}), [filePath]: next } }));
    get().syncAllCacheForFile(filePath, next);
    // مرحله ۱۹ — آینهٔ همگام، پیش از IPC. اگر IPC ناموفق باشد،
    // دیتابیس هنوز بوک‌مارک را دارد و اتحادِ بارگذاریِ بعدی آن را
    // برمی‌گرداند؛ توستِ خطا هم همین را می‌گوید.
    writeBookmarksLocalStorage(filePath, next);
    const res = await get().persistBookmarks(filePath, next);
    if (!res || res.success === false) {
      toast('حذف در دیتابیس ناموفق بود؛ بوک‌مارک در باز شدنِ بعدی بازمی‌گردد.', 'error');
      return;
    }
    toast('بوک‌مارک حذف شد.', 'info');
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
      return get().preferences;
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
    writePrefsLocalStorage(next);
    set({ preferences: next });
    if (!coreApi.isAvailable()) return next;
    try {
      await coreApi.dbAction({ action: 'SAVE_BOOKMARK_PREFERENCES', preferences: next });
    } catch (_) {
      toast('ذخیرهٔ تنظیماتِ بوک‌مارک انجام نشد.', 'error');
    }
    return next;
  },

  // مرحله ۱۴: همگام‌سازیِ کشِ سراسری با تغییرِ یک کتاب، وقتی
  // کش بارگذاری شده است؛ شمارندهٔ کل هم از رویِ کش حساب می‌شود.
  syncAllCacheForFile: (filePath, list) => {
    filePath = normalizeBookKey(filePath);
    if (!get().allBookmarksLoaded || !filePath) return;
    const next = { ...get().allBookmarkFiles };
    if (!list || list.length === 0) delete next[filePath];
    else next[filePath] = list;
    const total = Object.values(next).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    set({ allBookmarkFiles: next, totalBookmarkCount: total });
  },

  loadAllBookmarks: async (force = false) => {
    if (get().allBookmarksLoaded && !force) return get().allBookmarkFiles;
    if (!coreApi.isAvailable()) {
      set({ allBookmarksLoaded: true });
      return {};
    }
    try {
      const res = await coreApi.dbAction({ action: 'GET_ALL_BOOKMARKS' });
      const files = Array.isArray(res && res.files) ? res.files : [];
      const map = {};
      let total = 0;
      files.forEach((f) => {
        const list = Array.isArray(f.bookmarks) ? f.bookmarks.map(sanitizeBookmark).filter(Boolean) : [];
        if (list.length === 0) return;
        map[normalizeBookKey(f.filePath)] = { fileName: f.fileName || String(f.filePath).split(/[\\/]/).pop() || f.filePath, bookmarks: list };
        total += list.length;
      });
      set({ allBookmarkFiles: map, allBookmarksLoaded: true, totalBookmarkCount: total });
      return map;
    } catch (_) {
      set({ allBookmarksLoaded: true });
      return {};
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
      };
    });
    removeFileBookmarksFromLocalStorage(paths);
    return removed;
  },

  // مرحله ۱۴: ساخت‌هایِ سفارشیِ کاربر — در تنظیماتِ سراسری
  // ذخیره می‌شوند تا در همهٔ کتاب‌ها در دسترس باشند.
  savePreset: async (preset) => queuePresetWrite(async () => {
    if (!get().isHydrated) {
      try { await get().loadPreferences(); } catch (_) {}
    }
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
    // مرحله ۱۸ — لایهٔ ۱، پیش از هر IPC: اگر savePreferences به
    // هر دلیلی (مثلاً هیدراتِ ناموفق) نوشتن را رد کرد، ساخته همین‌جا
    // زنده می‌ماند و در بارگذاریِ بعدی، با سینکِ برگشتی به دیتابیس
    // برمی‌گردد.
    writePrefsLocalStorage({ ...(get().preferences || {}), savedPresets: next });
    await get().savePreferences({ savedPresets: next });
    return clean;
  }),

  deletePreset: async (id) => queuePresetWrite(async () => {
    if (!get().isHydrated) {
      try { await get().loadPreferences(); } catch (_) {}
    }
    const prev = get().preferences?.savedPresets || [];
    const next = prev.filter((p) => p.id !== id);
    if (next.length === prev.length) return;
    writePrefsLocalStorage({ ...(get().preferences || {}), savedPresets: next });
    await get().savePreferences({ savedPresets: next });
  }),

  // مرحله ۱۵: ویرایشِ یک ساختِ ذخیره‌شده — همان رکورد (همان id و
  // createdAt) به‌روز می‌شود تا کارت‌هایِ ساخته‌شده با آن، هویتشان
  // را از دست ندهند.
  updatePreset: async (id, patch) => queuePresetWrite(async () => {
    if (!get().isHydrated) {
      try { await get().loadPreferences(); } catch (_) {}
    }
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
    writePrefsLocalStorage({ ...(get().preferences || {}), savedPresets: next });
    await get().savePreferences({ savedPresets: next });
    return merged;
  }),

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
