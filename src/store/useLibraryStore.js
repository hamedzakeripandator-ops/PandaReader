import { create } from 'zustand';
import { useState, useRef, useEffect, useCallback } from 'react';
import { coreApi } from '../services/coreApi';
import annotationLocalBackup from '../services/annotationLocalBackup';

const STORAGE_KEYS = {
  LIBRARY: 'comic_reader_library_v4',
  FOLDERS: 'comic_reader_folders_v4',
  FAVORITE_FOLDERS: 'comicReader.favoriteFolders.v1',
  FAVORITES: 'comic_reader_favorites_v4',
  RECENTS: 'comic_reader_recents_v4',
  DOWNLOADS: 'comic_reader_downloads_v4',
  DOWNLOADS_DIR: 'comic_reader_downloads_dir_v4',
  RECENT_LIMIT: 'comicReader.recentLimit.v1',
  // مرحلهٔ ۵۰ §۵: پیکربندیِ منبعِ اسلایدرِ هیرو — یک کلیدِ واحد
  // در localStorage؛ همان آبجکت در دیتابیس هم زیرِ کلیدِ تنظیمیِ
  // 'heroSliderConfig' با مسیرِ موجودِ SAVE_SETTING / kv_store
  // ('setting:heroSliderConfig') ذخیره می‌شود؛ جدولِ تازه ساخته
  // نشد چون SAVE_SETTING عمومی است و هر کلیدِ دلخواه را می‌پذیرد.
  HERO_SLIDER_CONFIG: 'comicReader.heroSliderConfig.v1',
};

// متغیرهای مدیریت تایمر دی‌بانس و ذخیره اضطراری پیشرفت مطالعه
let progressDebounceTimer = null;
let pendingProgressPayload = null;

// مرحلهٔ ۵۲ §۱: نگهبان‌هایِ همگام‌سازیِ فایل‌هایِ رفته — یک فراخوانِ
// در حالِ اجرا، بینِ همهٔ فراخواننده‌ها مشترک است و فراخوانِ تازهٔ
// بدونِ مسیرِ مشخص، تا ۵ ثانیه پس از آخرین اجرایِ موفق، همان خلاصهٔ
// قبلی را برمی‌گرداند (بدونِ پیامِ IPC تازه)؛ پس ورودِ هم‌زمان به
// تب و مونتِ نما، هرگز حلقهٔ IPC نمی‌سازد.
let missingSyncInflight = null;
let missingSyncLastRunAt = 0;
let missingSyncLastSummary = null;
const MISSING_SYNC_DEDUPE_MS = 5000;

// استانداردسازی مسیر فایل برای سیستم‌عامل‌های مختلف
const normalizePath = (p) => {
  if (!p || typeof p !== 'string') return '';
  return p.trim().replace(/[\\/]+/g, '\\').toLowerCase();
};

// مرحلهٔ ۵۴ — مأموریت ۱: ثابت‌هایِ جابه‌جاییِ فوریِ کارت‌ها
// (گرفتن و کشیدن، بدونِ نگه‌داشتن). نگه‌داشتنِ ۲۰۰۰ میلی‌ثانیه‌ایِ
// مرحلهٔ ۵۳ و حلقهٔ پیشرفتِ ۲۲۰ میلی‌ثانیه‌ای، کاملاً حذف شدند؛
// هیچ تایمری برایِ فعال‌سازی نیست. تنها آستانه، جابه‌جاییِ ۶
// پیکسلیِ نشانگر است: کمتر از آن، کلیکِ عادی است و کتاب بی‌درنگ
// باز می‌شود؛ از ۶ پیکسل به بالا، درگ بی‌درنگ و بدونِ هیچ تأخیرِ
// زمانی شروع می‌شود.
export const REORDER_GRAB_MOVE_PX = 6;
export const REORDER_REPULSION_RADIUS = 280;
export const REORDER_REPEL_MAX = 22;
export const REORDER_REPEL_EXPONENT = 1.6;
export const REORDER_SLOT_CORE_RATIO = 0.42;
export const REORDER_SLOT_HYSTERESIS_PX = 15;
export const REORDER_EDGE_SCROLL_PX = 60;
export const REORDER_MIN_MOVE_PX = 2;
export const REORDER_CLICK_BLOCK_MS = 400;

// مرحلهٔ ۵۳ — مأموریت ۳: نرمال‌سازیِ customOrder — فقط عددِ صحیحِ
// متناهی معتبر است؛ بقیه (رشته، NaN، undefined) یعنی «بدونِ ترتیبِ
// دستی» و null برمی‌گردانند.
export function normalizeCustomOrder(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// مرحلهٔ ۵۳ — مأموریت ۳: دافعهٔ کشسانِ مغناطیسی — تابعِ خالص تا
// تست‌ها از همان ریاضی بخوانند. d فاصلهٔ اقلیدسیِ مرکزِ کارتِ
// گرفته‌شده تا مرکزِ کارتِ دیگر است؛ بیرون از شعاعِ ۲۸۰ پیکسل،
// دافعه صفر است. در d=0 جهت تعریف‌نشده است و فشار، مستقیم به بالا
// می‌رود تا تقسیم بر صفر پیش نیاید.
export function computeRepelOffset(dx, dy, dist) {
  if (!(dist < REORDER_REPULSION_RADIUS)) {
    return { pushX: 0, pushY: 0, strength: 0 };
  }
  // شدت از فاصلهٔ خام حساب می‌شود (در d=0 دقیقاً ۲۲) و فقط جهت،
  // با فاصلهٔ حداقلیِ ۰٫۰۰۱ از تقسیم بر صفر در امان می‌ماند.
  const d = Math.max(dist, 0.001);
  const strength =
    Math.pow(1 - dist / REORDER_REPULSION_RADIUS, REORDER_REPEL_EXPONENT) *
    REORDER_REPEL_MAX;
  let ux = dx / d;
  let uy = dy / d;
  if (dist < 0.001) {
    ux = 0;
    uy = -1;
  }
  return { pushX: ux * strength, pushY: uy * strength, strength };
}

// مرحلهٔ ۵۳ — مأموریت ۳: ادغامِ امنِ ترتیبِ نمایِ فیلترشده در
// فهرستِ کامل (گاردِ باگِ ۲). فقط ترتیبِ نسبیِ مسیرهایِ دیده‌شده
// عوض می‌شود و هر آیتمِ دیده‌شده، دقیقاً در همان جایِ (اسلاتِ)
// قبلیِ خودش در فهرستِ کامل می‌نشیند؛ بقیهٔ آیتم‌ها، بیت‌به‌بیت
// سرِ جایِ خود می‌مانند. مسیرهایِ ناشناخته نادیده گرفته می‌شوند و
// آیتم‌هایِ دیده‌نشدهٔ فهرستِ کامل، هرگز حذف یا جابه‌جا نمی‌شوند.
export function applyReorderToFullList(fullList, visibleOrderedPaths) {
  const full = Array.isArray(fullList) ? fullList : [];
  const orderedPaths = Array.isArray(visibleOrderedPaths) ? visibleOrderedPaths : [];
  const byNorm = new Map();
  full.forEach((item) => {
    const n = normalizePath(item?.path || item?.filePath);
    if (n && !byNorm.has(n)) byNorm.set(n, item);
  });
  const orderedVisible = [];
  const visibleNorms = new Set();
  orderedPaths.forEach((rawPath) => {
    const n = normalizePath(rawPath);
    if (!n || visibleNorms.has(n)) return;
    const found = byNorm.get(n);
    if (!found) return;
    visibleNorms.add(n);
    orderedVisible.push(found);
  });
  let vi = 0;
  return full.map((item) => {
    const n = normalizePath(item?.path || item?.filePath);
    if (n && visibleNorms.has(n)) {
      const next = orderedVisible[vi];
      vi += 1;
      return next || item;
    }
    return item;
  });
}

// فیلتر اصالت کاور جهت مسدودسازی فایل‌های موقت
const isPermanentCover = (str) => {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (
    s.startsWith('data:image/') ||
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('blob:') ||
    // مرحله ۲ ـ بخش الف: مرجعِ کاورِ روی دیسک هم دائمی است.
    s.startsWith('comic://')
  ) {
    return true;
  }
  if (
    s.includes('ComicReaderCache') ||
    s.includes('Temp') ||
    s.includes('AppData') ||
    s.startsWith('file:')
  ) {
    return false;
  }
  return false;
};

// مرتب‌سازی هوشمند کتابخانه: آیتم‌های پین‌شده همیشه در صدر قرار می‌گیرند
// مرحلهٔ ۵۳ — مأموریت ۳ (گاردِ باگِ ۴): ترتیبِ دستی (customOrder)
// بر پین و تاریخِ افزودن می‌چربد — وگرنه کارتی که کاربر بینِ
// پین‌شده‌ها انداخته، پس از ری‌لود یا پین/آن‌پین، سرِ جایِ
// انداخته‌شده نمی‌ماند. پس از هر جابه‌جایی، همهٔ آیتم‌ها customOrder
// دارند؛ کتابِ تازه‌افزوده‌شده (بدونِ customOrder) پس از بلوکِ دستی
// می‌آید و در آن بلوک، قانونِ قبلی (پین، بعد addedAt) می‌ماند.
const sortLibraryItems = (list) => {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    const aOrder = Number.isFinite(a?.customOrder) ? a.customOrder : Infinity;
    const bOrder = Number.isFinite(b?.customOrder) ? b.customOrder : Infinity;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aPinned = a?.isPinned ? 1 : 0;
    const bPinned = b?.isPinned ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    if (aPinned && bPinned) {
      const pA = a?.pinnedAt || '';
      const pB = b?.pinnedAt || '';
      if (pA !== pB) return pB.localeCompare(pA);
    }
    const addA = a?.addedAt || '';
    const addB = b?.addedAt || '';
    return addB.localeCompare(addA);
  });
};

// خواندن ایمن از لوکال‌استوریج
const readLocal = (key, fallback = []) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
};

// نگارش ایمن در لوکال‌استوریج بدون Base64 جهت جلوگیری از قفل شدن ترد اصلی
const writeLocal = (key, data) => {
  try {
    const lightweightData = Array.isArray(data)
      ? data.map(({ cover, ...rest }) => rest)
      : data;

    localStorage.setItem(key, JSON.stringify(lightweightData));
  } catch (e) {
    console.warn('LocalStorage quota or write warning:', e?.message);
  }
};

// مرحلهٔ ۳۰ — اعتبارسنجیِ حدِ نمایشِ Recent: عددِ صحیحِ ۱ تا ۵۰۰
// یا رشتهٔ 'all'؛ هر مقدارِ دیگری، پیش‌فرضِ ۱۰۰ برمی‌گرداند.
function normalizeRecentLimit(value) {
  if (value === 'all') return 'all';
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 500) return n;
  return 100;
}
function readRecentLimit() {
  try {
    const raw = localStorage.getItem('comicReader.recentLimit.v1');
    if (raw === null || raw === undefined || raw === '') return 100;
    return normalizeRecentLimit(JSON.parse(raw));
  } catch (_) {
    return 100;
  }
}

// مرحلهٔ ۵۰ §۵ — مدلِ دادهٔ منبعِ اسلایدرِ هیرو.
// heroSliderSource: 'auto' (پیش‌فرض: پین‌شده‌ها و آخرین مطالعه‌ها)
//   | 'custom' (فقط کتاب‌هایِ دستی) | 'library-folder' | 'favorite-folder'
// heroSliderFolderId: شناسهٔ پوشهٔ انتخاب‌شده (فقط برایِ دو حالتِ پوشه)
// customSliderBookPaths: مسیرهایِ نرمال‌شدهٔ کتاب‌هایِ دستی.
const HERO_SLIDER_SOURCES = ['auto', 'custom', 'library-folder', 'favorite-folder'];

function normalizeHeroSliderConfig(value) {
  const fallback = { heroSliderSource: 'auto', heroSliderFolderId: null, customSliderBookPaths: [] };
  if (!value || typeof value !== 'object') return fallback;
  const source = HERO_SLIDER_SOURCES.includes(value.heroSliderSource)
    ? value.heroSliderSource
    : 'auto';
  const folderId =
    (source === 'library-folder' || source === 'favorite-folder') &&
    typeof value.heroSliderFolderId === 'string' &&
    value.heroSliderFolderId.trim()
      ? value.heroSliderFolderId.trim()
      : null;
  const seen = new Set();
  const paths = [];
  (Array.isArray(value.customSliderBookPaths) ? value.customSliderBookPaths : []).forEach((p) => {
    const norm = normalizePath(p);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      paths.push(norm);
    }
  });
  return { heroSliderSource: source, heroSliderFolderId: folderId, customSliderBookPaths: paths };
}

function readHeroSliderConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HERO_SLIDER_CONFIG);
    if (!raw) return normalizeHeroSliderConfig(null);
    return normalizeHeroSliderConfig(JSON.parse(raw));
  } catch (_) {
    return normalizeHeroSliderConfig(null);
  }
}

// ذخیرهٔ دوگانه: localStorage (فوری و آفلاین) + دیتابیس از مسیرِ
// موجودِ تنظیمات (SAVE_SETTING با کلیدِ 'heroSliderConfig' که در
// ورکرِ دیتابیس به kv_store با کلیدِ 'setting:heroSliderConfig'
// می‌رسد و در آینهٔ JSON هم همگام می‌شود). خطایِ دیتابیس، ذخیرهٔ
// محلی را خراب نمی‌کند.
function persistHeroSliderConfig(config) {
  const clean = normalizeHeroSliderConfig(config);
  writeLocal(STORAGE_KEYS.HERO_SLIDER_CONFIG, clean);
  try {
    if (coreApi.isAvailable()) {
      coreApi
        .dbAction({ action: 'SAVE_SETTING', key: 'heroSliderConfig', value: clean })
        .catch(() => {});
    }
  } catch (_) {}
  return clean;
}

// مرحلهٔ ۵۰ §۵ — حلِ خالصِ آیتم‌هایِ اسلایدر از رویِ منبع (تابعِ
// خالص؛ LibraryView و تست‌ها از همین‌جا می‌خوانند). حالتِ auto
// رفتارِ قبلی است (پین‌شده‌ها، بعد اخیر، بعد کتابخانه — سقفِ ۷).
// حالت‌هایِ پوشه و دستی هیچ سقفی ندارند. مرحلهٔ ۵۲ §۱: کتابِ
// حذف‌شده از اسلایدر کنار نمی‌رود؛ با پرچمِ isMissing:true
// می‌ماند تا کاربر هشدار را ببیند. 
export function resolveHeroSliderItems({ source, folderId, customPaths, library, recentItems, favorites }) {
  const normOf = (item) => {
    const rawP = item?.path || item?.filePath;
    if (!rawP) return '';
    return rawP.trim().replace(/[\\/]+/g, '\\').toLowerCase();
  };
  const byNorm = new Map();
  [...(library || []), ...(Array.isArray(recentItems) ? recentItems : [])].forEach((item) => {
    const norm = normOf(item);
    if (norm && !byNorm.has(norm)) byNorm.set(norm, item);
  });
  if (source === 'custom') {
    // مرحلهٔ ۵۲ §۱: کتابِ رفته حذف نمی‌شود — اگر در کتابخانه/اخیر
    // هست، با همان پرچمِ isMissing برمی‌گردد؛ اگر فقط در فهرستِ
    // دستی مانده و ردیفی ندارد، کارتِ حداقلی با پرچمِ هشدار ساخته
    // می‌شود تا اسلایدر، بی‌صدا خالی نشود.
    return (customPaths || [])
      .map((p) => {
        const item = byNorm.get(p);
        if (item) return item;
        const raw = String(p || '');
        if (!raw) return null;
        return {
          path: raw,
          filePath: raw,
          name: raw.split(/[\\/]/).pop() || raw,
          isMissing: true,
        };
      })
      .filter(Boolean);
  }
  if (source === 'library-folder' && folderId) {
    return (library || []).filter((i) => i.folderId === folderId);
  }
  if (source === 'favorite-folder' && folderId) {
    const favByNorm = new Map();
    [...(favorites || []), ...(library || [])].forEach((item) => {
      const norm = normOf(item);
      if (norm && !favByNorm.has(norm)) favByNorm.set(norm, item);
    });
    return (favorites || [])
      .filter((f) => f.favoriteFolderId === folderId)
      .map((f) => favByNorm.get(normOf(f)))
      .filter(Boolean);
  }
  const pinnedList = (library || []).filter((i) => Boolean(i.isPinned));
  const combinedMap = new Map();
  [...pinnedList, ...(Array.isArray(recentItems) ? recentItems : []), ...(library || [])].forEach(
    (item) => {
      const norm = normOf(item);
      if (norm && !combinedMap.has(norm)) combinedMap.set(norm, item);
    }
  );
  return Array.from(combinedMap.values()).slice(0, 7);
}

export const useLibraryStore = create((set, get) => ({
  library: sortLibraryItems(readLocal(STORAGE_KEYS.LIBRARY, [])),
  libraryItems: sortLibraryItems(readLocal(STORAGE_KEYS.LIBRARY, [])),
  libraryFolders: readLocal(STORAGE_KEYS.FOLDERS, []),
  // مرحله ۴۹ (C): پوشه‌هایِ مستقلِ علاقه‌مندی‌ها — فهرستی جدا از
  // libraryFolders با کلیدِ لوکال‌استوریجِ خودش؛ کارگرِ B فقط از
  // همین فیلد می‌خواند.
  favoriteFolders: readLocal(STORAGE_KEYS.FAVORITE_FOLDERS, []),
  // مرحلهٔ ۵۰ §۵: پیکربندیِ منبعِ اسلایدرِ هیرو (خوانده‌شده از
  // localStorage؛ initLibrary نسخهٔ دیتابیس را هم رویِ آن سوار می‌کند).
  ...readHeroSliderConfig(),
  activeFolderId: 'ALL', // 'ALL' | 'PINNED' | 'UNFOLDERED' | folder.id
  activeFavoriteFolderId: 'ALL', // 'ALL' | 'PINNED' | 'UNFOLDERED' | folder.id — پوشه فعال نمای علاقه‌مندی‌ها، جدا از کتابخانه
  favorites: readLocal(STORAGE_KEYS.FAVORITES, []),
  recentItems: readLocal(STORAGE_KEYS.RECENTS, []),
  // مرحلهٔ ۳۰ — حدِ نمایشِ مواردِ اخیر در نمایِ Recent (پیش‌فرض
  // ۱۰۰؛ 'all' یعنی همهٔ مواردِ نگه‌داشته‌شده تا سقفِ ۵۰۰).
  // این، فقط حدِ نمایش است و چیزی را از نگهداری پاک نمی‌کند.
  recentLimit: readRecentLimit(),
  downloads: readLocal(STORAGE_KEYS.DOWNLOADS, []),
  downloadsFolderPath: readLocal(STORAGE_KEYS.DOWNLOADS_DIR, ''),
  cachedCovers: {},
  customCoverPaths: {},

  // ۱. راه‌اندازی و ادغام کامل استور با تمام جداول دیتابیس لوکال
  initLibrary: async () => {
    try {
      const localLib = sortLibraryItems(readLocal(STORAGE_KEYS.LIBRARY, []));
      const localFolders = readLocal(STORAGE_KEYS.FOLDERS, []);
      const localFavFolders = readLocal(STORAGE_KEYS.FAVORITE_FOLDERS, []);
      const localFavs = readLocal(STORAGE_KEYS.FAVORITES, []);
      const localRecents = readLocal(STORAGE_KEYS.RECENTS, []);
      const localDownloads = readLocal(STORAGE_KEYS.DOWNLOADS, []);
      const localDlDir = readLocal(STORAGE_KEYS.DOWNLOADS_DIR, '');

      set({
        library: localLib,
        libraryItems: localLib,
        libraryFolders: localFolders,
        favoriteFolders: localFavFolders,
        favorites: localFavs,
        recentItems: localRecents,
        downloads: localDownloads,
        downloadsFolderPath: localDlDir,
      });

      if (coreApi.isAvailable()) {
        let dbCovers = {};
        try {
          const coversRes = await coreApi.dbAction({ action: 'GET_ALL_COVER_CACHES' });
          if (coversRes?.covers && typeof coversRes.covers === 'object') {
            dbCovers = coversRes.covers;
            set({ cachedCovers: dbCovers });
          }
        } catch (_) {}

        const libRes = await coreApi.dbAction({ action: 'GET_LIBRARY' });
        if (Array.isArray(libRes?.folders)) {
          set({ libraryFolders: libRes.folders });
          writeLocal(STORAGE_KEYS.FOLDERS, libRes.folders);
        }

        // مرحله ۴۹ (C): پوشه‌هایِ علاقه‌مندی‌ها جدا از پوشه‌هایِ
        // کتابخانه خوانده می‌شوند (اکشنِ جدا، مثلِ GET_LIBRARY برایِ
        // libraryFolders).
        try {
          const favFoldersRes = await coreApi.dbAction({ action: 'GET_FAVORITE_FOLDERS' });
          if (Array.isArray(favFoldersRes?.favoriteFolders)) {
            set({ favoriteFolders: favFoldersRes.favoriteFolders });
            writeLocal(STORAGE_KEYS.FAVORITE_FOLDERS, favFoldersRes.favoriteFolders);
          }
        } catch (_) {}

        // مرحلهٔ ۵۰ §۵: پیکربندیِ اسلایدر از دیتابیس (GET_SETTINGS؛
        // کلیدِ 'heroSliderConfig' از kv_store). وقتی دیتابیس نسخه‌ای
        // دارد، مرجع است و رویِ آینهٔ محلی نوشته می‌شود؛ اگر ندارد،
        // همان مقدارِ محلی می‌ماند و با اولین تغییر، ذخیره می‌شود.
        try {
          const settingsRes = await coreApi.dbAction({ action: 'GET_SETTINGS' });
          if (settingsRes?.settings && 'heroSliderConfig' in settingsRes.settings) {
            const dbConfig = normalizeHeroSliderConfig(settingsRes.settings.heroSliderConfig);
            set(dbConfig);
            writeLocal(STORAGE_KEYS.HERO_SLIDER_CONFIG, dbConfig);
          }
        } catch (_) {}

        if (Array.isArray(libRes?.library)) {
          const mergedMap = new Map();
          const customMap = {};

          [...libRes.library, ...localLib].forEach((item) => {
            const rawP = item.path || item.filePath;
            const norm = normalizePath(rawP);
            if (norm && !mergedMap.has(norm)) {
              const validCover = isPermanentCover(item.cover)
                ? item.cover
                : dbCovers[norm] || null;
              const isCustom = Boolean(item.hasCustomCover);
              if (isCustom) customMap[norm] = true;

              mergedMap.set(norm, {
                ...item,
                path: rawP,
                cover: validCover,
                hasCustomCover: isCustom,
                isPinned: Boolean(item.isPinned),
                pinnedAt: item.pinnedAt || null,
                folderId: item.folderId || null,
              });
            }
          });

          const mergedLib = sortLibraryItems(Array.from(mergedMap.values()));
          set({
            library: mergedLib,
            libraryItems: mergedLib,
            customCoverPaths: customMap,
          });
          writeLocal(STORAGE_KEYS.LIBRARY, mergedLib);
        }

        const recentRes = await coreApi.dbAction({ action: 'GET_RECENTS' });
        if (Array.isArray(recentRes?.recents)) {
          const mergedRecentsMap = new Map();
          [...recentRes.recents, ...localRecents].forEach((item) => {
            const rawP = item.filePath || item.path;
            const norm = normalizePath(rawP);
            if (norm && !mergedRecentsMap.has(norm)) {
              const validCover = isPermanentCover(item.cover)
                ? item.cover
                : dbCovers[norm] || null;
              const totalP = Math.max(1, Number(item.totalPages) || 1);
              const lastP = Math.max(1, Number(item.currentPage || item.lastPage) || 1);
              mergedRecentsMap.set(norm, {
                ...item,
                path: rawP,
                name: item.fileName || item.name,
                cover: validCover,
                totalPages: totalP,
                lastPage: lastP,
                progress:
                  item.percentage ||
                  item.progress ||
                  Math.min(100, Math.round((lastP / totalP) * 100)),
                lastReadAt: item.updatedAt || item.lastReadAt,
              });
            }
          });
          // مرحلهٔ ۳۰ — سقفِ نگهداری، ۱۰۰→۵۰۰ (حدِ نمایش، جداست).
          const mergedRecents = Array.from(mergedRecentsMap.values()).slice(0, 500);
          set({ recentItems: mergedRecents });
          writeLocal(STORAGE_KEYS.RECENTS, mergedRecents);
        }

        const favRes = await coreApi.dbAction({ action: 'GET_FAVORITES' });
        if (Array.isArray(favRes?.favorites)) {
          // مرحله ۴۹ (C): پوشهٔ هر علاقه‌مندی فقط از favoriteFolderIdِ
          // خودِ ردیفِ علاقه‌مندی خوانده می‌شود؛ پوشهٔ کتابخانه
          // (folderIdِ ردیفِ کتاب) دیگر هیچ اثری رویِ علاقه‌مندی‌ها
          // ندارد. فیلدِ قدیمیِ folderId رویِ ردیفِ علاقه‌مندی،
          // دست‌نخورده می‌ماند (حفظ‌شده ولی نادیده‌گرفته‌شده) تا
          // بازگشت به مرحلهٔ ۴۸، سازمان‌دهیِ قبلی را از دست ندهد.
          // مهاجرتِ یک‌باره (گزینهٔ الف) در ورکرِ دیتابیس انجام شده
          // است؛ اینجا فقط برایِ آیتم‌هایِ فقط-محلی (که در دیتابیس
          // نیستند) همان نگاشتِ folderId به پوشهٔ علاقه‌مندیِ هم‌نام
          // اعمال می‌شود تا پس از ری‌لود، بی‌پوشه نشوند.
          if (Array.isArray(favRes?.favoriteFolders)) {
            set({ favoriteFolders: favRes.favoriteFolders });
            writeLocal(STORAGE_KEYS.FAVORITE_FOLDERS, favRes.favoriteFolders);
          }
          const mergedFavsMap = new Map();
          const validFavFolderIds = new Set((get().favoriteFolders || []).map((f) => f.id));
          const libFolderById = new Map((get().libraryFolders || []).map((f) => [f.id, f]));
          const favFolderByLibId = new Map();
          const favFolderByNameColor = new Map();
          (get().favoriteFolders || []).forEach((f) => {
            if (f.migratedFromLibraryFolderId) favFolderByLibId.set(f.migratedFromLibraryFolderId, f);
            favFolderByNameColor.set(`${(f.name || '').trim()}|${f.color || ''}`, f);
          });
          const resolveMigratedFavFolderId = (legacyFolderId) => {
            if (!legacyFolderId) return null;
            const byLibId = favFolderByLibId.get(legacyFolderId);
            if (byLibId) return byLibId.id;
            const libFolder = libFolderById.get(legacyFolderId);
            if (!libFolder) return null;
            const byNameColor = favFolderByNameColor.get(`${(libFolder.name || '').trim()}|${libFolder.color || ''}`);
            return byNameColor ? byNameColor.id : null;
          };
          [...favRes.favorites, ...localFavs].forEach((item) => {
            const rawP = item.path || item.filePath;
            const norm = normalizePath(rawP);
            if (norm && !mergedFavsMap.has(norm)) {
              const validCover = isPermanentCover(item.cover)
                ? item.cover
                : dbCovers[norm] || null;
              const ownFavFolderId =
                item.favoriteFolderId && validFavFolderIds.has(item.favoriteFolderId)
                  ? item.favoriteFolderId
                  : null;
              mergedFavsMap.set(norm, {
                ...item,
                path: rawP,
                cover: validCover,
                favoriteFolderId: ownFavFolderId || resolveMigratedFavFolderId(item.folderId),
              });
            }
          });
          const mergedFavs = Array.from(mergedFavsMap.values());
          set({ favorites: mergedFavs });
          writeLocal(STORAGE_KEYS.FAVORITES, mergedFavs);
        }

        // مرحلهٔ ۵۲ §۱: پس از ادغامِ کامل، یک بار همگام‌سازیِ
        // فایل‌هایِ رفته (یک پیامِ دسته‌ای)؛ خطا، بوت را خراب
        // نمی‌کند و بهترین تلاش است.
        try { await get().syncMissingFiles(); } catch (_) {}
      }
    } catch (e) {
      console.error('Failed to init library store with native DB:', e);
    }
  },

  // مرحلهٔ ۵۲ §۱: همگام‌سازیِ دسته‌ایِ فایل‌هایِ حذف‌شده با ورکر.
  // فقط یک پیامِ IPC در هر اجرا (بدونِ حلقهٔ per-file). onlyPaths
  // اختیاری است: اگر داده شد، فقط همان مسیرها بررسی می‌شوند
  // (مثلاً وقتی فایلی رویِ دیسک پیدا نشد)؛ وگرنه همهٔ مسیرهایِ
  // شناخته‌شده. نتیجهٔ ورکر رویِ استیت اعمال می‌شود: فایلِ رفته از
  // recentItems می‌رود و در library/favorites با isMissing:true
  // می‌ماند؛ فایلِ برگشته، پرچمش برداشته می‌شود؛ کاورهایِ آزادشده
  // از cachedCovers می‌روند؛ بوک‌مارک‌ها و آینهٔ حاشیه‌نویسیِ
  // محلیِ همان فایل‌ها هم پاک می‌شوند (ردیف‌هایِ دیتابیس را ورکر
  // در همان پیام پاک کرده است). خطا یا نبودِ coreApi، null
  // برمی‌گرداند و هرگز throw نمی‌کند.
  syncMissingFiles: async (onlyPaths) => {
    const paths = Array.isArray(onlyPaths)
      ? onlyPaths.filter((p) => typeof p === 'string' && p)
      : [];
    const scoped = paths.length > 0;
    if (missingSyncInflight) return missingSyncInflight;
    if (
      !scoped &&
      missingSyncLastSummary &&
      Date.now() - missingSyncLastRunAt < MISSING_SYNC_DEDUPE_MS
    ) {
      return missingSyncLastSummary;
    }
    const run = (async () => {
      let result = null;
      try {
        if (!coreApi.isAvailable()) return null;
        // مسیرِ ترجیحی، کانالِ تازهٔ 'sync-missing-files' است
        // (۶۰ ثانیه)؛ اگر پری‌لودِ زنده هنوز آن را نداشت، کانالِ
        // قدیمیِ 'prune-missing-files' — که در ورکر، همان
        // همگام‌سازیِ امنِ §۱ است و همان ۶۰ ثانیه را دارد — و در
        // آخر، مسیرِ عمومیِ db-action.
        if (typeof coreApi.syncMissingFiles === 'function') {
          result = await coreApi.syncMissingFiles(scoped ? { paths } : undefined);
        } else if (!scoped && typeof coreApi.pruneMissingFiles === 'function') {
          result = await coreApi.pruneMissingFiles();
        } else {
          const res = await coreApi.dbAction({
            action: 'SYNC_AND_CLEAN_MISSING_FILES',
            payload: scoped ? { paths } : {},
          });
          result =
            res && res.type === 'done'
              ? { success: true, ...res }
              : { success: false, error: (res && res.message) || 'همگام‌سازی انجام نشد.' };
        }
      } catch (_) {
        return null;
      }
      if (!result || !result.success) return null;
      const missing = Array.isArray(result.missingPaths) ? result.missingPaths : [];
      const returned = Array.isArray(result.returnedPaths) ? result.returnedPaths : [];
      const freed = Array.isArray(result.coversFreedPaths) ? result.coversFreedPaths : [];
      const summary = {
        checked: result.checked || 0,
        purgedFromRecent: result.purgedFromRecent || 0,
        keptWithWarning: result.keptWithWarning || 0,
        coversFreed: result.coversFreed || 0,
        missingPaths: missing,
        returnedPaths: returned,
      };
      if (missing.length === 0 && returned.length === 0 && freed.length === 0) {
        missingSyncLastSummary = summary;
        missingSyncLastRunAt = Date.now();
        return summary;
      }
      const missingNorms = new Set(missing.map((p) => normalizePath(p)).filter(Boolean));
      const returnedNorms = new Set(returned.map((p) => normalizePath(p)).filter(Boolean));
      const freedNorms = new Set(freed.map((n) => normalizePath(n)).filter(Boolean));
      // آینهٔ حاشیه‌نویسیِ محلیِ فایل‌هایِ رفته (کلیدهایِ
      // comicReader.annotations.v1:<hash>:<page>)؛ دیتابیس را ورکر
      // در همان پیام پاک کرده است.
      try {
        missing.forEach((p) => {
          try { annotationLocalBackup.clearFileBackups(p); } catch (_) {}
        });
      } catch (_) {}
      // بوک‌مارک‌هایِ رندرر برایِ همان فایل‌ها؛ import پویا تا
      // چرخهٔ import با useBookmarkStore ساخته نشود.
      try {
        const bmModule = await import('./useBookmarkStore');
        const removeFn =
          bmModule && bmModule.default && typeof bmModule.default.getState === 'function'
            ? bmModule.default.getState().removeFileBookmarks
            : null;
        if (typeof removeFn === 'function') {
          try { removeFn(missing); } catch (_) {}
        }
      } catch (_) {}
      const flagList = (list) =>
        (Array.isArray(list) ? list : []).map((item) => {
          const norm = normalizePath(item.path || item.filePath);
          if (missingNorms.has(norm)) return { ...item, isMissing: true };
          if (returnedNorms.has(norm) && item.isMissing) return { ...item, isMissing: false };
          return item;
        });
      const nextLib = flagList(get().library);
      const nextLibItems = flagList(get().libraryItems);
      const nextFavs = flagList(get().favorites);
      const nextRecents = (Array.isArray(get().recentItems) ? get().recentItems : []).filter(
        (item) => !missingNorms.has(normalizePath(item.path || item.filePath))
      );
      const nextCachedCovers = { ...(get().cachedCovers || {}) };
      const nextCustomCoverPaths = { ...(get().customCoverPaths || {}) };
      freedNorms.forEach((norm) => {
        delete nextCachedCovers[norm];
        delete nextCustomCoverPaths[norm];
      });
      const sortedLib = sortLibraryItems(nextLib);
      const sortedLibItems = sortLibraryItems(nextLibItems);
      set({
        library: sortedLib,
        libraryItems: sortedLibItems,
        favorites: nextFavs,
        recentItems: nextRecents,
        cachedCovers: nextCachedCovers,
        customCoverPaths: nextCustomCoverPaths,
      });
      writeLocal(STORAGE_KEYS.LIBRARY, sortedLib);
      writeLocal(STORAGE_KEYS.FAVORITES, nextFavs);
      writeLocal(STORAGE_KEYS.RECENTS, nextRecents);
      missingSyncLastSummary = summary;
      missingSyncLastRunAt = Date.now();
      return summary;
    })();
    missingSyncInflight = run;
    try {
      return await run;
    } finally {
      missingSyncInflight = null;
    }
  },

  // ۲. کش کردن کاور با محافظت از کاورهای سفارشی انتخاب‌شده توسط کاربر
  // مرحله ۱۰: حذفِ آینه‌هایِ لوکال‌استوریج برای مسیرهایِ داده‌شده —
  // بدونِ این، initLibrary آیتم‌هایِ حذف‌شده از دیتابیس را از آینهٔ
  // محلی بازمی‌گرداند (ادغامِ DB-first + local).
  removeLocalEntries: (filePaths) => {
    const paths = Array.isArray(filePaths) ? filePaths : [];
    if (paths.length === 0) return;
    const norms = new Set(paths.map((x) => normalizePath(x)).filter(Boolean));
    if (norms.size === 0) return;
    const drop = (list) => (Array.isArray(list) ? list.filter((item) => !norms.has(normalizePath(item.path || item.filePath))) : list);
    const library = drop(get().library);
    const libraryItems = drop(get().libraryItems);
    const favorites = drop(get().favorites);
    const recentItems = drop(get().recentItems);
    set({ library, libraryItems, favorites, recentItems });
    writeLocal(STORAGE_KEYS.LIBRARY, library);
    writeLocal(STORAGE_KEYS.FAVORITES, favorites);
    writeLocal(STORAGE_KEYS.RECENTS, recentItems);
  },

  // مرحله ۱۰: اعمالِ نتیجهٔ پاک‌سازیِ بک‌اند — ابتدا آینه‌هایِ محلی
  // را پاک می‌کند، بعد initLibrary را صدا می‌زند تا وضعیتِ تازهٔ
  // دیتابیس (بدونِ آیتم‌هایِ حذف‌شده) در استور بنشیند.
  applyPruneResult: async (removedPaths) => {
    get().removeLocalEntries(removedPaths);
    try { await get().initLibrary(); } catch (_) {}
  },

  cacheCover: (filePath, dataUrl, isCustom = false) => {
    if (!filePath || !isPermanentCover(dataUrl)) return;
    const norm = normalizePath(filePath);

    // اگر کاربر قبلاً کاور سفارشی تنظیم کرده باشد، اجازه نده تامبنیل خودکار آن را بازنویسی کند
    if (get().customCoverPaths[norm] && !isCustom) {
      return;
    }

    const updateCoverInList = (list) =>
      list.map((item) =>
        normalizePath(item.path || item.filePath) === norm
          ? { ...item, cover: dataUrl, ...(isCustom ? { hasCustomCover: true } : {}) }
          : item
      );

    set((state) => {
      const nextLib = updateCoverInList(state.library);
      const nextFavs = updateCoverInList(state.favorites);
      const nextRecents = updateCoverInList(state.recentItems);
      return {
        cachedCovers: { ...state.cachedCovers, [norm]: dataUrl },
        customCoverPaths: isCustom
          ? { ...state.customCoverPaths, [norm]: true }
          : state.customCoverPaths,
        library: nextLib,
        libraryItems: nextLib,
        favorites: nextFavs,
        recentItems: nextRecents,
      };
    });

    coreApi
      .dbAction({
        action: isCustom ? 'SET_CUSTOM_COVER' : 'CACHE_COVER',
        payload: { filePath, dataUrl, isCustom: Boolean(isCustom) },
      })
      .catch(() => {});
  },

  // تنظیم مستقیم کاور سفارشی
  setCustomCover: async (filePath, dataUrl) => {
    if (!filePath || !isPermanentCover(dataUrl)) return false;
    get().cacheCover(filePath, dataUrl, true);
    return true;
  },

  // باز کردن دیالوگ انتخاب عکس از سیستم و اعمال فوری به عنوان کاور کتاب/کمیک
  selectAndSetCustomCover: async (comicOrPath) => {
    const rawPath =
      typeof comicOrPath === 'string'
        ? comicOrPath
        : comicOrPath?.path || comicOrPath?.filePath;
    if (!rawPath) return { success: false, error: 'مسیر فایل مشخص نیست.' };

    const res = await coreApi.selectCustomCover(rawPath);
    if (res && res.success && isPermanentCover(res.cover)) {
      get().cacheCover(rawPath, res.cover, true);
      return { success: true, cover: res.cover };
    }
    return res || { success: false };
  },

  getCover: (filePath) => {
    if (!filePath) return null;
    const norm = normalizePath(filePath);

    const inCache = get().cachedCovers[norm];
    if (isPermanentCover(inCache)) return inCache;

    const inLib = get().library.find((i) => normalizePath(i.path || i.filePath) === norm);
    if (isPermanentCover(inLib?.cover)) return inLib.cover;

    const inFav = get().favorites.find((i) => normalizePath(i.path || i.filePath) === norm);
    if (isPermanentCover(inFav?.cover)) return inFav.cover;

    const inRec = get().recentItems.find((i) => normalizePath(i.path || i.filePath) === norm);
    if (isPermanentCover(inRec?.cover)) return inRec.cover;

    return null;
  },

  // =========================================================================
  // ۳. مدیریت کتابخانه، پین کردن (Pin) و پوشه‌بندی (Folders)
  // =========================================================================
  addToLibrary: async (comic) => {
    if (!comic) return;
    const rawPath = comic.path || comic.filePath;
    const norm = normalizePath(rawPath);
    if (!norm) return;

    const list = get().library;
    if (list.some((item) => normalizePath(item.path || item.filePath) === norm)) return;

    const validCover = isPermanentCover(comic.cover)
      ? comic.cover
      : get().cachedCovers[norm] || null;

    const activeFolder = get().activeFolderId;
    const defaultFolderId =
      comic.folderId !== undefined
        ? comic.folderId
        : activeFolder && !['ALL', 'PINNED', 'UNFOLDERED'].includes(activeFolder)
        ? activeFolder
        : null;

    const newItem = {
      path: rawPath,
      name: comic.name || comic.fileName || rawPath.split(/[\\/]/).pop() || 'بدون نام',
      cover: validCover,
      fileSize: comic.fileSize || '',
      totalPages: comic.totalPages || comic.items?.length || 1,
      lastPage: comic.lastPage || 1,
      folderId: defaultFolderId,
      isPinned: Boolean(comic.isPinned),
      pinnedAt: comic.isPinned ? new Date().toISOString() : null,
      addedAt: new Date().toISOString(),
    };

    const updated = sortLibraryItems([newItem, ...list]);
    set({ library: updated, libraryItems: updated });
    writeLocal(STORAGE_KEYS.LIBRARY, updated);

    await coreApi.dbAction({
      action: 'ADD_TO_LIBRARY',
      payload: {
        filePath: rawPath,
        name: newItem.name,
        coverPath: newItem.cover,
        folderId: newItem.folderId,
        isPinned: newItem.isPinned,
      },
    });
  },

  removeFromLibrary: async (filePath) => {
    const norm = normalizePath(filePath);
    if (!norm) return;

    const updated = get().library.filter(
      (item) => normalizePath(item.path || item.filePath) !== norm
    );
    set({ library: updated, libraryItems: updated });
    writeLocal(STORAGE_KEYS.LIBRARY, updated);

    await coreApi.dbAction({
      action: 'REMOVE_FROM_LIBRARY',
      payload: { filePath },
    });
  },

  clearLibrary: () => {
    set({ library: [], libraryItems: [] });
    writeLocal(STORAGE_KEYS.LIBRARY, []);
  },

  // بررسی وضعیت پین بودن آیتم در کتابخانه
  isPinned: (filePath) => {
    const norm = normalizePath(filePath);
    if (!norm) return false;
    return get().library.some(
      (item) => normalizePath(item.path || item.filePath) === norm && Boolean(item.isPinned)
    );
  },

  // پین / آن‌پین کردن آیتم در صدر کتابخانه و ذخیره در دیتابیس
  // مرحله ۴۷ §۲: ورودی هم رشتهٔ مسیر و هم آبجکت کامل کتاب را
  // می‌پذیرد؛ هرگز آیتمِ بدونِ مسیر یا بدونِ نام ساخته نمی‌شود.
  // به‌روزرسانیِ خوش‌بینانه فقط isPinned و pinnedAt را عوض می‌کند و
  // همهٔ فیلدهایِ دیگر (کاور، نام، مسیر، پیشرفت، نوع فایل و...)
  // دست‌نخورده می‌مانند؛ recentItems هم با همان تغییرِ حداقلی
  // همگام می‌شود. پاسخِ ورکر هیچ‌وقت جایگزینِ کورکورانهٔ استیت
  // نمی‌شود و فقط با حفظِ کاورهایِ درون‌حافظه ادغام می‌شود.
  togglePin: async (comicOrPath) => {
    if (!comicOrPath) return false;
    const isObj = typeof comicOrPath === 'object';
    const rawPath = isObj ? comicOrPath.path || comicOrPath.filePath : comicOrPath;
    const norm = normalizePath(rawPath);
    if (!norm) return false;

    const now = new Date().toISOString();
    const currentLib = get().library;
    const existingIdx = currentLib.findIndex(
      (item) => normalizePath(item.path || item.filePath) === norm
    );

    let nextPinned = true;
    let nextList = [];

    if (existingIdx >= 0) {
      nextPinned = !currentLib[existingIdx].isPinned;
      nextList = currentLib.map((item, idx) =>
        idx === existingIdx
          ? {
              ...item,
              isPinned: nextPinned,
              pinnedAt: nextPinned ? now : null,
            }
          : item
      );
    } else {
      // آبجکت ورودی ممکن است از Recent یا اسلایدر آمده باشد؛ فیلدهایِ
      // غنیِ آن (پیشرفت، نوع فایل، صفحهٔ جاری، کاور) حفظ می‌شوند تا
      // ورودیِ تازهٔ کتابخانه، نسخهٔ فقیرانهٔ کتاب نشود.
      const source = isObj ? comicOrPath : {};
      const recentMatch = get().recentItems.find(
        (item) => normalizePath(item.path || item.filePath) === norm
      );
      const favMatch = get().favorites.find(
        (item) => normalizePath(item.path || item.filePath) === norm
      );
      const validCover =
        (isPermanentCover(source.cover) ? source.cover : null) ||
        (isPermanentCover(recentMatch?.cover) ? recentMatch.cover : null) ||
        (isPermanentCover(favMatch?.cover) ? favMatch.cover : null) ||
        get().cachedCovers[norm] ||
        null;

      const totalPages =
        Number(source.totalPages || source.items?.length) ||
        Number(recentMatch?.totalPages) ||
        1;
      const lastPage = Math.max(
        1,
        Math.min(
          totalPages,
          Number(source.lastPage || source.currentPage) ||
            Number(recentMatch?.lastPage || recentMatch?.currentPage) ||
            1
        )
      );
      const progressValue =
        typeof source.percentage === 'number'
          ? source.percentage
          : typeof source.progress === 'number'
          ? source.progress
          : typeof recentMatch?.percentage === 'number'
          ? recentMatch.percentage
          : typeof recentMatch?.progress === 'number'
          ? recentMatch.progress
          : Math.min(100, Math.round((lastPage / Math.max(1, totalPages)) * 100));

      const newEntry = {
        path: rawPath,
        name:
          source.name ||
          source.fileName ||
          recentMatch?.name ||
          recentMatch?.fileName ||
          favMatch?.name ||
          favMatch?.fileName ||
          rawPath.split(/[\\/]/).pop() ||
          'بدون نام',
        cover: validCover,
        type:
          source.type ||
          recentMatch?.type ||
          favMatch?.type ||
          (norm.endsWith('.pdf') ? 'pdf' : 'zip'),
        fileSize: source.fileSize || recentMatch?.fileSize || favMatch?.fileSize || '',
        totalPages,
        lastPage,
        currentPage: lastPage,
        percentage: progressValue,
        progress: progressValue,
        // مرحله ۴۹ (C): folderIdِ ردیفِ علاقه‌مندی (favMatch) دیگر
        // مرجع نیست؛ ورودیِ تازهٔ کتابخانه، پوشه‌اش را فقط از منبعِ
        // کتابخانه‌ای (source/recent) می‌گیرد.
        folderId: source.folderId ?? recentMatch?.folderId ?? null,
        hasCustomCover: Boolean(
          source.hasCustomCover || recentMatch?.hasCustomCover
        ),
        lastReadAt: recentMatch?.lastReadAt || favMatch?.lastReadAt || null,
        isPinned: true,
        pinnedAt: now,
        addedAt: now,
      };
      nextList = [newEntry, ...currentLib];
    }

    const sorted = sortLibraryItems(nextList);
    // همگام‌سازیِ recentItems با همان تغییرِ حداقلی: فقط پین.
    const hadRecent = get().recentItems.some(
      (item) => normalizePath(item.path || item.filePath) === norm
    );
    const nextRecents = hadRecent
      ? get().recentItems.map((item) =>
          normalizePath(item.path || item.filePath) === norm
            ? { ...item, isPinned: nextPinned, pinnedAt: nextPinned ? now : null }
            : item
        )
      : null;

    set({
      library: sorted,
      libraryItems: sorted,
      ...(nextRecents ? { recentItems: nextRecents } : {}),
    });
    writeLocal(STORAGE_KEYS.LIBRARY, sorted);
    if (nextRecents) writeLocal(STORAGE_KEYS.RECENTS, nextRecents);

    coreApi
      .dbAction({
        action: 'TOGGLE_PIN_LIBRARY',
        payload: {
          filePath: rawPath,
          comic: isObj ? comicOrPath : { path: rawPath },
        },
      })
      .then((res) => {
        if (Array.isArray(res?.library)) {
          get().mergeLibraryFromDb(res.library);
        }
      })
      .catch(() => {});

    return nextPinned;
  },

  // ادغامِ امنِ پاسخِ ورکر با استیتِ رندرر (مرحله ۴۷ §۲): ردیف‌هایِ
  // خامِ ورکر، کاورِ درون‌حافظه را ندارند؛ پس جایگزینیِ کورکورانهٔ
  // library با آن‌ها، کارت‌ها را خالی می‌کرد. اینجا فقط وضعیتِ پین
  // از ورکر گرفته می‌شود و کاور و فیلدهایِ غنیِ رندرر همیشه می‌مانند؛
  // آیتمِ فقط-ورکری اضافه و آیتمِ فقط-رندرری نگه داشته می‌شود.
  // مرحلهٔ ۵۳ — مأموریت ۳: ثبتِ ترتیبِ دستیِ کتابخانه.
  // orderedPaths، فهرستِ کاملِ مسیرها به ترتیبِ تازه است (نما، با
  // applyReorderToFullList آن را از ترتیبِ نمایِ فیلترشده ساخته
  // است). به‌روزرسانیِ خوش‌بینانه: customOrder = اندیس در فهرستِ
  // کامل به همهٔ آیتم‌ها داده می‌شود؛ مسیری که در استیت نیست
  // (هم‌زمان اضافه شده) نادیده گرفته می‌شود و آیتمی که در
  // orderedPaths نیست، با حفظِ ترتیبِ نسبی، به انتها می‌رود.
  // پاسخِ ورکر فقط customOrder را همگام می‌کند (mergeLibraryFromDb).
  reorderLibraryItems: async (orderedPaths) => {
    if (!Array.isArray(orderedPaths) || orderedPaths.length === 0) return false;
    const current = get().library || [];
    const byNorm = new Map();
    current.forEach((item) => {
      const n = normalizePath(item?.path || item?.filePath);
      if (n && !byNorm.has(n)) byNorm.set(n, item);
    });
    const ordered = [];
    orderedPaths.forEach((rawPath) => {
      const n = normalizePath(rawPath);
      const found = n ? byNorm.get(n) : null;
      if (!found) return;
      byNorm.delete(n);
      ordered.push(found);
    });
    byNorm.forEach((item) => ordered.push(item));
    const next = ordered.map((item, idx) => ({ ...item, customOrder: idx }));
    const sorted = sortLibraryItems(next);
    set({ library: sorted, libraryItems: sorted });
    writeLocal(STORAGE_KEYS.LIBRARY, sorted);
    try {
      const res = await coreApi.dbAction({
        action: 'REORDER_LIBRARY_ITEMS',
        payload: {
          orderedPaths: next.map((item) => item.path || item.filePath).filter(Boolean),
        },
      });
      if (Array.isArray(res?.library)) {
        get().mergeLibraryFromDb(res.library);
      }
    } catch (_) {}
    return true;
  },

  // مرحلهٔ ۵۳ — مأموریت ۳: ثبتِ ترتیبِ دستیِ علاقه‌مندی‌ها؛ همان
  // قراردادِ کتابخانه، ولی رویِ state.favorites و اکشنِ
  // REORDER_FAVORITE_ITEMS. علاقه‌مندی‌ها sort سراسری ندارند، پس
  // ترتیبِ آرایه دقیقاً ترتیبِ دستی است و پاسخِ ورکر فقط
  // customOrder را همگام می‌کند.
  reorderFavoriteItems: async (orderedPaths) => {
    if (!Array.isArray(orderedPaths) || orderedPaths.length === 0) return false;
    const current = get().favorites || [];
    const byNorm = new Map();
    current.forEach((item) => {
      const n = normalizePath(item?.path || item?.filePath);
      if (n && !byNorm.has(n)) byNorm.set(n, item);
    });
    const ordered = [];
    orderedPaths.forEach((rawPath) => {
      const n = normalizePath(rawPath);
      const found = n ? byNorm.get(n) : null;
      if (!found) return;
      byNorm.delete(n);
      ordered.push(found);
    });
    byNorm.forEach((item) => ordered.push(item));
    const next = ordered.map((item, idx) => ({ ...item, customOrder: idx }));
    set({ favorites: next });
    writeLocal(STORAGE_KEYS.FAVORITES, next);
    try {
      const res = await coreApi.dbAction({
        action: 'REORDER_FAVORITE_ITEMS',
        payload: {
          orderedPaths: next.map((item) => item.path || item.filePath).filter(Boolean),
        },
      });
      if (Array.isArray(res?.favorites)) {
        const orderByNorm = new Map();
        res.favorites.forEach((dbItem) => {
          const n = normalizePath(dbItem?.path || dbItem?.filePath);
          if (n && Number.isFinite(dbItem.customOrder)) orderByNorm.set(n, dbItem.customOrder);
        });
        const merged = get().favorites.map((item) => {
          const n = normalizePath(item?.path || item?.filePath);
          if (!n || !orderByNorm.has(n)) return item;
          return { ...item, customOrder: orderByNorm.get(n) };
        });
        set({ favorites: merged });
        writeLocal(STORAGE_KEYS.FAVORITES, merged);
      }
    } catch (_) {}
    return true;
  },

  mergeLibraryFromDb: (dbLibrary) => {
    if (!Array.isArray(dbLibrary)) return;
    const current = get().library;
    const byNorm = new Map();
    current.forEach((item) => {
      const n = normalizePath(item.path || item.filePath);
      if (n && !byNorm.has(n)) byNorm.set(n, item);
    });

    const merged = [];
    dbLibrary.forEach((dbItem) => {
      const n = normalizePath(dbItem?.path || dbItem?.filePath);
      if (!n) return;
      const existing = byNorm.get(n);
      if (existing) {
        byNorm.delete(n);
        merged.push({
          ...existing,
          // مرحلهٔ ۵۳ — مأموریت ۳: ترتیبِ دستی از ورکر گرفته
          // می‌شود؛ اگر ورکر customOrder نداشت، مقدارِ رندرر می‌ماند.
          customOrder: Number.isFinite(dbItem.customOrder)
            ? dbItem.customOrder
            : existing.customOrder ?? null,
          isPinned: Boolean(dbItem.isPinned),
          pinnedAt: dbItem.isPinned
            ? dbItem.pinnedAt || existing.pinnedAt || null
            : null,
          cover:
            existing.cover ||
            (isPermanentCover(dbItem.cover) ? dbItem.cover : null) ||
            get().cachedCovers[n] ||
            null,
        });
        return;
      }
      merged.push({
        ...dbItem,
        path: dbItem.path || dbItem.filePath,
        cover: isPermanentCover(dbItem.cover)
          ? dbItem.cover
          : get().cachedCovers[n] || null,
        isPinned: Boolean(dbItem.isPinned),
        pinnedAt: dbItem.pinnedAt || null,
      });
    });
    // آیتم‌هایِ فقط-رندرر (مثلاً تازه اضافه‌شده و هنوز نرسیده به
    // ورکر) حذف نمی‌شوند.
    byNorm.forEach((item) => merged.push(item));

    const sorted = sortLibraryItems(merged);
    set({ library: sorted, libraryItems: sorted });
    writeLocal(STORAGE_KEYS.LIBRARY, sorted);
    // مرحله ۴۹ (C): این ادغام عمداً پوشه را دست نمی‌زند — قراردادِ
    // مرحله ۴۷ §۲ فقط وضعیتِ پین را از ورکر می‌گیرد. پاسخِ پین ممکن
    // است پیش از یک انتسابِ پوشهٔ جدیدتر ساخته شده باشد؛ گرفتنِ
    // folderId از آن، انتسابِ تازه را برمی‌گرداند. پوشهٔ کتابخانه فقط
    // در assignToFolder و deleteFolder، و پوشهٔ علاقه‌مندی‌ها فقط در
    // assignToFavoriteFolder و deleteFavoriteFolder و toggleFavorite
    // و initLibrary همگام می‌شود؛ هیچ‌کدام، دیگری را دست نمی‌زند.
  },

  // تغییر پوشه فعال در نمای کتابخانه
  setActiveFolder: (folderId) => {
    set({ activeFolderId: folderId || 'ALL' });
  },

  // تغییر پوشه فعال در نمای علاقه‌مندی‌ها (جدا از پوشه فعال
  // کتابخانه، تا انتخابِ پوشه در یک نما، تبِ نمایِ دیگر را عوض نکند)
  setActiveFavoriteFolder: (folderId) => {
    set({ activeFavoriteFolderId: folderId || 'ALL' });
  },

  // ساخت پوشه جدید در کتابخانه و ذخیره در دیتابیس
  createFolder: async (name, color = '#22d3ee', icon = 'Folder') => {
    const cleanName = (name || '').trim();
    if (!cleanName) return null;

    const tempFolder = {
      id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName,
      color,
      icon,
      createdAt: new Date().toISOString(),
    };

    const nextFolders = [...get().libraryFolders, tempFolder];
    set({ libraryFolders: nextFolders });
    writeLocal(STORAGE_KEYS.FOLDERS, nextFolders);

    try {
      const res = await coreApi.dbAction({
        action: 'CREATE_LIBRARY_FOLDER',
        payload: { name: cleanName, color, icon },
      });
      if (Array.isArray(res?.folders)) {
        set({ libraryFolders: res.folders });
        writeLocal(STORAGE_KEYS.FOLDERS, res.folders);
        return res.folder || tempFolder;
      }
    } catch (_) {}

    return tempFolder;
  },

  // ویرایش نام و رنگ پوشه
  renameFolder: async (folderId, name, color) => {
    if (!folderId) return false;
    const cleanName = (name || '').trim();

    const updatedFolders = get().libraryFolders.map((f) =>
      f.id === folderId
        ? {
            ...f,
            ...(cleanName ? { name: cleanName } : {}),
            ...(color ? { color } : {}),
          }
        : f
    );

    set({ libraryFolders: updatedFolders });
    writeLocal(STORAGE_KEYS.FOLDERS, updatedFolders);

    await coreApi
      .dbAction({
        action: 'RENAME_LIBRARY_FOLDER',
        payload: { folderId, name: cleanName, color },
      })
      .catch(() => {});

    return true;
  },

  // حذف پوشه از کتابخانه (آیتم‌های داخل آن حذف نمی‌شوند و به حالت بدون پوشه برمی‌گردند؛
  // کتابِ هیچ‌کدام پاک نمی‌شود). مرحله ۴۹ (C): حذفِ پوشهٔ کتابخانه،
  // پوشه‌هایِ علاقه‌مندی‌ها و favoriteFolderId را دست نمی‌زند.
  deleteFolder: async (folderId) => {
    if (!folderId) return;
    const updatedFolders = get().libraryFolders.filter((f) => f.id !== folderId);
    const updatedLib = get().library.map((item) =>
      item.folderId === folderId ? { ...item, folderId: null } : item
    );

    set((state) => ({
      libraryFolders: updatedFolders,
      library: updatedLib,
      libraryItems: updatedLib,
      activeFolderId: state.activeFolderId === folderId ? 'ALL' : state.activeFolderId,
    }));

    writeLocal(STORAGE_KEYS.FOLDERS, updatedFolders);
    writeLocal(STORAGE_KEYS.LIBRARY, updatedLib);

    await coreApi
      .dbAction({
        action: 'DELETE_LIBRARY_FOLDER',
        payload: { folderId },
      })
      .catch(() => {});
  },

  // اختصاص دادن یا انتقال کمیک/کتاب به یک پوشه خاص
  assignToFolder: async (comicOrPath, folderId = null) => {
    if (!comicOrPath) return false;
    const isObj = typeof comicOrPath === 'object';
    const rawPath = isObj ? comicOrPath.path || comicOrPath.filePath : comicOrPath;
    const norm = normalizePath(rawPath);
    if (!norm) return false;

    const currentLib = get().library;
    const exists = currentLib.some(
      (item) => normalizePath(item.path || item.filePath) === norm
    );

    let nextLib;
    if (exists) {
      nextLib = currentLib.map((item) =>
        normalizePath(item.path || item.filePath) === norm
          ? { ...item, folderId: folderId || null }
          : item
      );
    } else {
      const validCover =
        (isObj && isPermanentCover(comicOrPath.cover) ? comicOrPath.cover : null) ||
        get().cachedCovers[norm] ||
        null;

      const newItem = {
        path: rawPath,
        name:
          (isObj && (comicOrPath.name || comicOrPath.fileName)) ||
          rawPath.split(/[\\/]/).pop() ||
          'بدون نام',
        cover: validCover,
        fileSize: (isObj && comicOrPath.fileSize) || '',
        totalPages: (isObj && (comicOrPath.totalPages || comicOrPath.items?.length)) || 1,
        lastPage: (isObj && comicOrPath.lastPage) || 1,
        folderId: folderId || null,
        isPinned: false,
        pinnedAt: null,
        addedAt: new Date().toISOString(),
      };
      nextLib = [newItem, ...currentLib];
    }

    const sorted = sortLibraryItems(nextLib);
    set({ library: sorted, libraryItems: sorted });
    writeLocal(STORAGE_KEYS.LIBRARY, sorted);

    // مرحله ۴۹ (C): انتسابِ پوشهٔ کتابخانه، علاقه‌مندی‌ها را دست
    // نمی‌زند؛ favoriteFolderIdِ همان کتاب، مستقل می‌ماند.

    await coreApi
      .dbAction({
        action: 'ASSIGN_TO_LIBRARY_FOLDER',
        payload: {
          filePath: rawPath,
          folderId: folderId || null,
          comic: isObj ? comicOrPath : { path: rawPath },
        },
      })
      .catch(() => {});

    return true;
  },

  // =========================================================================
  // مرحله ۴۹ (C): پوشه‌بندیِ مستقلِ علاقه‌مندی‌ها — دقیقاً هم‌ارزِ
  // پوشه‌هایِ کتابخانه در شکل و رفتار، ولی با فهرست، فیلد و اکشن‌هایِ
  // کاملاً جدا؛ هیچ‌کدام از این چهار اکشن، libraryFolders یا folderId
  // را نمی‌خواند و نمی‌نویسد.
  // =========================================================================
  // ساخت پوشه جدید در علاقه‌مندی‌ها و ذخیره در دیتابیس
  createFavoriteFolder: async (name, color = '#22d3ee', icon = 'Folder') => {
    const cleanName = (name || '').trim();
    if (!cleanName) return null;

    const tempFolder = {
      id: `favfolder_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName,
      color,
      icon,
      createdAt: new Date().toISOString(),
    };

    const nextFolders = [...get().favoriteFolders, tempFolder];
    set({ favoriteFolders: nextFolders });
    writeLocal(STORAGE_KEYS.FAVORITE_FOLDERS, nextFolders);

    try {
      const res = await coreApi.dbAction({
        action: 'CREATE_FAVORITE_FOLDER',
        payload: { name: cleanName, color, icon },
      });
      if (Array.isArray(res?.favoriteFolders)) {
        set({ favoriteFolders: res.favoriteFolders });
        writeLocal(STORAGE_KEYS.FAVORITE_FOLDERS, res.favoriteFolders);
        return res.folder || tempFolder;
      }
    } catch (_) {}

    return tempFolder;
  },

  // ویرایش نام و رنگ پوشه علاقه‌مندی‌ها
  renameFavoriteFolder: async (folderId, name, color) => {
    if (!folderId) return false;
    const cleanName = (name || '').trim();

    const updatedFolders = get().favoriteFolders.map((f) =>
      f.id === folderId
        ? {
            ...f,
            ...(cleanName ? { name: cleanName } : {}),
            ...(color ? { color } : {}),
          }
        : f
    );

    set({ favoriteFolders: updatedFolders });
    writeLocal(STORAGE_KEYS.FAVORITE_FOLDERS, updatedFolders);

    await coreApi
      .dbAction({
        action: 'RENAME_FAVORITE_FOLDER',
        payload: { folderId, name: cleanName, color },
      })
      .catch(() => {});

    return true;
  },

  // حذف پوشه از علاقه‌مندی‌ها (آیتم‌های داخل آن حذف نمی‌شوند و به حالت بدون پوشه برمی‌گردند؛
  // کتابِ هیچ‌کدام پاک نمی‌شود و پوشه‌هایِ کتابخانه دست نمی‌خورند)
  deleteFavoriteFolder: async (folderId) => {
    if (!folderId) return;
    const updatedFolders = get().favoriteFolders.filter((f) => f.id !== folderId);
    const updatedFavs = get().favorites.map((item) =>
      item.favoriteFolderId === folderId ? { ...item, favoriteFolderId: null } : item
    );

    set((state) => ({
      favoriteFolders: updatedFolders,
      favorites: updatedFavs,
      activeFavoriteFolderId:
        state.activeFavoriteFolderId === folderId ? 'ALL' : state.activeFavoriteFolderId,
    }));

    writeLocal(STORAGE_KEYS.FAVORITE_FOLDERS, updatedFolders);
    writeLocal(STORAGE_KEYS.FAVORITES, updatedFavs);

    await coreApi
      .dbAction({
        action: 'DELETE_FAVORITE_FOLDER',
        payload: { folderId },
      })
      .catch(() => {});
  },

  // اختصاص دادن یا انتقال علاقه‌مندی به یک پوشه خاصِ علاقه‌مندی‌ها
  assignToFavoriteFolder: async (comicOrPath, folderId = null) => {
    if (!comicOrPath) return false;
    const isObj = typeof comicOrPath === 'object';
    const rawPath = isObj ? comicOrPath.path || comicOrPath.filePath : comicOrPath;
    const norm = normalizePath(rawPath);
    if (!norm) return false;

    const currentFavs = get().favorites;
    const exists = currentFavs.some(
      (item) => normalizePath(item.path || item.filePath) === norm
    );

    let nextFavs;
    if (exists) {
      nextFavs = currentFavs.map((item) =>
        normalizePath(item.path || item.filePath) === norm
          ? { ...item, favoriteFolderId: folderId || null }
          : item
      );
    } else {
      const validCover =
        (isObj && isPermanentCover(comicOrPath.cover) ? comicOrPath.cover : null) ||
        get().cachedCovers[norm] ||
        null;

      const newItem = {
        path: rawPath,
        name:
          (isObj && (comicOrPath.name || comicOrPath.fileName)) ||
          rawPath.split(/[\/]/).pop() ||
          'بدون نام',
        cover: validCover,
        fileSize: (isObj && comicOrPath.fileSize) || '',
        totalPages: (isObj && (comicOrPath.totalPages || comicOrPath.items?.length)) || 1,
        lastPage: (isObj && comicOrPath.lastPage) || 1,
        favoriteFolderId: folderId || null,
        favoritedAt: new Date().toISOString(),
      };
      nextFavs = [newItem, ...currentFavs];
    }

    set({ favorites: nextFavs });
    writeLocal(STORAGE_KEYS.FAVORITES, nextFavs);

    await coreApi
      .dbAction({
        action: 'ASSIGN_TO_FAVORITE_FOLDER',
        payload: {
          filePath: rawPath,
          folderId: folderId || null,
          comic: isObj ? comicOrPath : { path: rawPath },
        },
      })
      .catch(() => {});

    return true;
  },

  // مرحلهٔ ۵۰ §۵ — اکشن‌هایِ منبعِ اسلایدرِ هیرو.
  // نکته: مسیرهایِ دستی فقط نرمال و یکتا می‌شوند؛ کتابِ حذف‌شده
  // از کتابخانه، هنگامِ حلِ منبع (LibraryView) از اسلایدها کنار
  // می‌رود، پس مسیرِ کهنه هرگز اسلایدِ خالی یا کرش نمی‌سازد.
  isBookInHeroSlider: (comicOrPath) => {
    if (!comicOrPath) return false;
    const rawPath =
      typeof comicOrPath === 'object' ? comicOrPath.path || comicOrPath.filePath : comicOrPath;
    const norm = normalizePath(rawPath);
    if (!norm) return false;
    return (get().customSliderBookPaths || []).includes(norm);
  },

  toggleBookInHeroSlider: (comicOrPath) => {
    if (!comicOrPath) return false;
    const rawPath =
      typeof comicOrPath === 'object' ? comicOrPath.path || comicOrPath.filePath : comicOrPath;
    const norm = normalizePath(rawPath);
    if (!norm) return false;
    const current = get().customSliderBookPaths || [];
    const exists = current.includes(norm);
    const next = exists ? current.filter((p) => p !== norm) : [...current, norm];
    const clean = persistHeroSliderConfig({
      heroSliderSource: get().heroSliderSource || 'auto',
      heroSliderFolderId: get().heroSliderFolderId || null,
      customSliderBookPaths: next,
    });
    set({ customSliderBookPaths: clean.customSliderBookPaths });
    return !exists;
  },

  setHeroSliderSource: (sourceType, folderId = null) => {
    const source = HERO_SLIDER_SOURCES.includes(sourceType) ? sourceType : 'auto';
    const clean = persistHeroSliderConfig({
      heroSliderSource: source,
      heroSliderFolderId:
        (source === 'library-folder' || source === 'favorite-folder') &&
        typeof folderId === 'string' &&
        folderId.trim()
          ? folderId.trim()
          : null,
      customSliderBookPaths: get().customSliderBookPaths || [],
    });
    set({
      heroSliderSource: clean.heroSliderSource,
      heroSliderFolderId: clean.heroSliderFolderId,
    });
    return clean.heroSliderSource;
  },

  setCustomSliderBookPaths: (paths) => {
    const clean = persistHeroSliderConfig({
      heroSliderSource: get().heroSliderSource || 'auto',
      heroSliderFolderId: get().heroSliderFolderId || null,
      customSliderBookPaths: Array.isArray(paths) ? paths : [],
    });
    set({ customSliderBookPaths: clean.customSliderBookPaths });
    return clean.customSliderBookPaths;
  },

  // ۴. مدیریت علاقه‌مندی‌ها (Favorites)
  isFavorite: (filePath) => {
    const norm = normalizePath(filePath);
    if (!norm) return false;
    return get().favorites.some((item) => normalizePath(item.path || item.filePath) === norm);
  },

  toggleFavorite: (comic) => {
    if (!comic) return false;
    const rawPath = comic.path || comic.filePath;
    const norm = normalizePath(rawPath);
    if (!norm) return false;

    const currentFavs = get().favorites;
    const exists = currentFavs.some((item) => normalizePath(item.path || item.filePath) === norm);
    let updated;

    if (exists) {
      updated = currentFavs.filter((item) => normalizePath(item.path || item.filePath) !== norm);
    } else {
      const validCover = isPermanentCover(comic.cover)
        ? comic.cover
        : get().cachedCovers[norm] || null;

      // مرحله ۴۹ (C): علاقه‌مندیِ تازه، در پوشه‌بندیِ علاقه‌مندی‌ها
      // بدونِ پوشه شروع می‌شود؛ پوشهٔ کتاب در کتابخانه ارث برده
      // نمی‌شود. فقط وقتی فراخوان، favoriteFolderId داده باشد (مثلاً
      // از منویِ پوشه در نمایِ علاقه‌مندی‌ها) همان گرفته می‌شود.
      const favItem = {
        path: rawPath,
        name: comic.name || comic.fileName || rawPath.split(/[\\/]/).pop() || 'بدون نام',
        cover: validCover,
        fileSize: comic.fileSize || '',
        totalPages: comic.totalPages || comic.items?.length || 1,
        lastPage: comic.lastPage || 1,
        favoriteFolderId: comic.favoriteFolderId || null,
        favoritedAt: new Date().toISOString(),
      };
      updated = [favItem, ...currentFavs];
    }

    set({ favorites: updated });
    writeLocal(STORAGE_KEYS.FAVORITES, updated);

    coreApi
      .dbAction({
        action: 'TOGGLE_FAVORITE',
        payload: { comic: { ...comic, path: rawPath } },
      })
      .catch((err) => console.error('DB toggle favorite error:', err));

    return !exists;
  },

  removeFromFavorites: (filePath) => {
    const norm = normalizePath(filePath);
    const updated = get().favorites.filter(
      (item) => normalizePath(item.path || item.filePath) !== norm
    );
    set({ favorites: updated });
    writeLocal(STORAGE_KEYS.FAVORITES, updated);

    coreApi
      .dbAction({
        action: 'REMOVE_FROM_FAVORITES',
        payload: { filePath },
      })
      .catch(() => {});
  },

  // ۵. مدیریت تاریخچه مطالعه و موقعیت صفحه (با محافظت ویژه از ادامه مطالعه در PDFهای چانک‌بندی‌شده)
  addToRecent: async (comic) => {
    if (!comic) return;
    const rawPath = comic.path || comic.filePath;
    const norm = normalizePath(rawPath);
    if (!norm) return;

    const currentRecents = get().recentItems;
    const existing = currentRecents.find(
      (item) => normalizePath(item.path || item.filePath) === norm
    );

    const incomingTotal = Number(comic.totalPages || comic.items?.length) || 0;
    const totalPages =
      incomingTotal <= 1 && existing?.totalPages > 1
        ? existing.totalPages
        : Math.max(1, incomingTotal || existing?.totalPages || 1);

    const incomingLast = Number(comic.lastPage) || 0;
    const lastPage = Math.max(
      1,
      Math.min(
        totalPages,
        incomingLast > 1 ? incomingLast : existing?.lastPage || 1
      )
    );

    const validCover = isPermanentCover(comic.cover)
      ? comic.cover
      : get().cachedCovers[norm] || existing?.cover || null;

    const recentEntry = {
      path: rawPath,
      name:
        comic.name ||
        comic.fileName ||
        existing?.name ||
        rawPath.split(/[\\/]/).pop(),
      type: comic.type || existing?.type || (norm.endsWith('.pdf') ? 'pdf' : 'zip'),
      fileSize: comic.fileSize || existing?.fileSize || '',
      cover: validCover,
      totalPages,
      lastPage,
      progress: Math.min(100, Math.round((lastPage / Math.max(1, totalPages)) * 100)),
      lastReadAt: new Date().toISOString(),
    };

    const filtered = currentRecents.filter(
      (item) => normalizePath(item.path || item.filePath) !== norm
    );
    // مرحلهٔ ۳۰ — سقفِ نگهداری، ۱۰۰→۵۰۰ (حدِ نمایش، جداست).
    const updated = [recentEntry, ...filtered].slice(0, 500);

    set({ recentItems: updated });
    writeLocal(STORAGE_KEYS.RECENTS, updated);

    await coreApi.dbAction({
      action: 'SAVE_PROGRESS',
      payload: {
        filePath: rawPath,
        currentPage: lastPage,
        totalPages,
        fileName: recentEntry.name,
        cover: validCover,
      },
    });
  },

  // دی‌بانس کامل و ایزوله پیشرفت مطالعه (ثبت دقیق شماره صفحه و کل صفحات برای کمیک و PDF)
  updateReadingProgress: (filePath, currentPage, totalPagesCount) => {
    const norm = normalizePath(filePath);
    if (!norm || !currentPage) return;

    pendingProgressPayload = { filePath, norm, currentPage, totalPagesCount };
    if (progressDebounceTimer) clearTimeout(progressDebounceTimer);

    progressDebounceTimer = setTimeout(() => {
      if (!pendingProgressPayload) return;
      const {
        filePath: targetPath,
        norm: targetNorm,
        currentPage: targetPage,
        totalPagesCount: targetTotal,
      } = pendingProgressPayload;

      const updateItemProgress = (item) => {
        if (normalizePath(item.path || item.filePath) !== targetNorm) return item;
        const total =
          targetTotal && targetTotal > 1 ? targetTotal : item.totalPages || 1;
        const safePage = Math.max(1, Math.min(targetPage, total));
        return {
          ...item,
          lastPage: safePage,
          totalPages: total,
          progress: Math.min(100, Math.round((safePage / Math.max(1, total)) * 100)),
          lastReadAt: new Date().toISOString(),
        };
      };

      const updatedRecents = get().recentItems.map(updateItemProgress);
      const updatedLib = get().library.map(updateItemProgress);

      set({
        recentItems: updatedRecents,
        library: updatedLib,
        libraryItems: updatedLib,
      });
      writeLocal(STORAGE_KEYS.RECENTS, updatedRecents);
      writeLocal(STORAGE_KEYS.LIBRARY, updatedLib);

      coreApi
        .dbAction({
          action: 'SAVE_PROGRESS',
          payload: {
            filePath: targetPath,
            currentPage: targetPage,
            totalPages: targetTotal || 1,
          },
        })
        .catch(() => {});

      pendingProgressPayload = null;
      progressDebounceTimer = null;
    }, 450);
  },

  // متد ذخیره فوری در صورت بستن ناگهانی یا جابه‌جایی کمیک/PDF
  flushPendingProgress: () => {
    if (progressDebounceTimer) {
      clearTimeout(progressDebounceTimer);
      progressDebounceTimer = null;
    }
    if (!pendingProgressPayload) return;

    const { filePath, norm, currentPage, totalPagesCount } = pendingProgressPayload;

    const updateItemProgress = (item) => {
      if (normalizePath(item.path || item.filePath) !== norm) return item;
      const total =
        totalPagesCount && totalPagesCount > 1 ? totalPagesCount : item.totalPages || 1;
      const safePage = Math.max(1, Math.min(currentPage, total));
      return {
        ...item,
        lastPage: safePage,
        totalPages: total,
        progress: Math.min(100, Math.round((safePage / Math.max(1, total)) * 100)),
        lastReadAt: new Date().toISOString(),
      };
    };

    const updatedRecents = get().recentItems.map(updateItemProgress);
    const updatedLib = get().library.map(updateItemProgress);

    set({
      recentItems: updatedRecents,
      library: updatedLib,
      libraryItems: updatedLib,
    });
    writeLocal(STORAGE_KEYS.RECENTS, updatedRecents);
    writeLocal(STORAGE_KEYS.LIBRARY, updatedLib);

    coreApi
      .dbAction({
        action: 'SAVE_PROGRESS',
        payload: {
          filePath,
          currentPage,
          totalPages: totalPagesCount || 1,
        },
      })
      .catch(() => {});

    pendingProgressPayload = null;
  },

  removeFromRecent: (filePath) => {
    const norm = normalizePath(filePath);
    const updated = get().recentItems.filter(
      (item) => normalizePath(item.path || item.filePath) !== norm
    );
    set({ recentItems: updated });
    writeLocal(STORAGE_KEYS.RECENTS, updated);

    coreApi
      .dbAction({
        action: 'REMOVE_FROM_RECENTS',
        payload: { filePath },
      })
      .catch(() => {});
  },

  clearRecents: () => {
    set({ recentItems: [] });
    writeLocal(STORAGE_KEYS.RECENTS, []);
    coreApi.dbAction({ action: 'CLEAR_RECENTS' }).catch(() => {});
  },

  // مرحلهٔ ۳۰ — تغییرِ حدِ نمایشِ Recent + ذخیره در localStorage.
  setRecentLimit: (value) => {
    const limit = normalizeRecentLimit(value);
    set({ recentLimit: limit });
    writeLocal(STORAGE_KEYS.RECENT_LIMIT, limit);
  },

  // ۶. مدیریت دانلودها
  setDownloadsFolder: (folderPath) => {
    const norm = normalizePath(folderPath);
    set({ downloadsFolderPath: norm });
    writeLocal(STORAGE_KEYS.DOWNLOADS_DIR, norm);
  },

  setDownloadsList: (items) => {
    const safe = Array.isArray(items) ? items : [];
    set({ downloads: safe });
    writeLocal(STORAGE_KEYS.DOWNLOADS, safe);
  },
}));

export default useLibraryStore;

// ============================================================================
// مرحلهٔ ۵۴ — مأموریت ۱: هوکِ مشترکِ جابه‌جاییِ فوریِ کارت‌ها با
// گرفتن و کشیدن (بدونِ نگه‌داشتن) و دافعهٔ مغناطیسی (LibraryView و
// FavoritesView، هر دو از همین یک پیاده‌سازی استفاده می‌کنند تا منطق
// دو نسخه نشود). فعال‌سازی فقط با جابه‌جاییِ ۶ پیکسلیِ نشانگر است؛
// نگه‌داشتنِ ۲۰۰۰ میلی‌ثانیه‌ایِ مرحلهٔ ۵۳ کاملاً حذف شد.
//
// قرارداد با نما:
// - نما، gridRef را رویِ گریدِ کارت‌ها و scrollRef را رویِ کانتینرِ
//   اسکرول‌خور می‌گذارد؛ هر کارت در گرید، یک پوشش با
//   data-cr-card-slot="<مسیرِ نرمال‌شده>" و کلاسِ cr-repel-card دارد.
// - نما، onReorderActivate را به ComicCard می‌دهد و وقتی کارتِ
//   گرفته‌شده را رندر می‌کند، floatingItem/floatingRect/floatingElRef
//   را همان‌طور که هوک برمی‌گرداند، به کار می‌برد.
// - نما، onCommit را می‌دهد: با ترتیبِ تازهٔ مسیرهایِ دیده‌شده صدا
//   زده می‌شود و نما، آن را با applyReorderToFullList در فهرستِ
//   کامل ادغام و اکشنِ reorder* استور و سوییچ به sort سفارشی را
//   انجام می‌دهد.
// - نما، onFolderDrop را هم می‌دهد: وقتی کارت رویِ تبِ پوشه رها
//   شود، به‌جایِ onCommit، با (مسیرِ نرمال‌شدهٔ کارت، شناسهٔ تبِ
//   پوشه) صدا زده می‌شود تا نما، assignToFolder یا
//   assignToFavoriteFolder را صدا بزند. تب‌ها با
//   data-folder-drop-id نشانه‌گذاری شده‌اند و هوک، در هر حرکتِ
//   نشانگر، با elementFromPoint تبِ زیرِ نشانگر را پیدا می‌کند.
// - نما، onOpenComic را با wasReorderingRef گارد می‌کند تا رها کردن
//   پس از درگ، هرگز کتاب را باز نکند (گاردِ باگِ ۱).
//
// تضمین‌هایِ کارایی و ایمنی:
// - مرکزِ همهٔ کارت‌ها فقط یک‌بار در شروعِ درگ اندازه‌گیری و در
//   gridRectsRef کش می‌شود؛ در mousemove هیچ getBoundingClientRect
//   تازه‌ای نیست (بدونِ layout thrashing).
// - دافعه فقط در یک حلقهٔ requestAnimationFrame و فقط وقتی نشانگر
//   دست‌کم ۲ پیکسل جابه‌جا شده باشد، محاسبه می‌شود و با دستکاریِ
//   مستقیمِ style.transform رویِ گرهٔ DOM اعمال می‌شود (بدونِ
//   رندرِ دوبارهٔ ری‌اکت در هر فریم).
// - خروج از جیگل همیشه ممکن است: pointerup و pointercancel و blur
//   پنجره و Escape و resize، همه شنوندهٔ پنجره‌اند و حالت را
//   پاک می‌کنند؛ پس کارت هرگز در جیگل گیر نمی‌کند (گاردِ باگِ ۵).
// ============================================================================
export function useCardReorderGrid(options) {
  const enabled = Boolean(options && options.enabled);
  const gridRef = options ? options.gridRef : null;
  const scrollRef = options ? options.scrollRef : null;

  const visibleItemsRef = useRef(Array.isArray(options?.visibleItems) ? options.visibleItems : []);
  visibleItemsRef.current = Array.isArray(options?.visibleItems) ? options.visibleItems : [];
  const onCommitRef = useRef(options ? options.onCommit : null);
  onCommitRef.current = options ? options.onCommit : null;

  const [dragState, setDragState] = useState(null);
  const dragStateRef = useRef(null);
  const gridRectsRef = useRef([]);
  const previewPathsRef = useRef([]);
  const pointerRef = useRef({ x: 0, y: 0 });
  const lastProcessedRef = useRef({ x: 0, y: 0 });
  const lastSwapPointerRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef(null);
  const floatingElRef = useRef(null);
  const wasReorderingRef = useRef(false);
  const clickBlockTimerRef = useRef(null);
  const onFolderDropRef = useRef(options ? options.onFolderDrop : null);
  onFolderDropRef.current = options ? options.onFolderDrop : null;
  // مرحلهٔ ۵۴ — مأموریت ۱: تبِ پوشهٔ زیرِ نشانگر هنگامِ درگ؛ هم
  // ref (برایِ تصمیمِ لحظهٔ رها کردن) و هم state (برایِ هایلایتِ
  // تب در نما) نگه داشته می‌شود و فقط هنگامِ عوض شدن، setState
  // می‌شود تا رندرِ اضافه نسازد.
  const folderDropTargetRef = useRef(null);
  const [folderDropTargetId, setFolderDropTargetId] = useState(null);

  const updateDragState = useCallback((next) => {
    dragStateRef.current = next;
    setDragState(next);
  }, []);

  const clearAllTransforms = useCallback(() => {
    gridRectsRef.current.forEach((entry) => {
      if (entry && entry.el) entry.el.style.transform = '';
    });
    if (floatingElRef.current) floatingElRef.current.style.transform = '';
  }, []);

  const detachWindowListeners = useCallback(() => {
    window.removeEventListener('pointermove', handleWindowPointerMove);
    window.removeEventListener('pointerup', handleWindowPointerUp);
    window.removeEventListener('pointercancel', handleWindowPointerCancel);
    window.removeEventListener('blur', handleWindowBlur);
    window.removeEventListener('keydown', handleWindowKeyDown);
    window.removeEventListener('resize', handleWindowResize);
  }, []);

  const markClickBlocked = useCallback(() => {
    wasReorderingRef.current = true;
    if (clickBlockTimerRef.current) clearTimeout(clickBlockTimerRef.current);
    clickBlockTimerRef.current = setTimeout(() => {
      wasReorderingRef.current = false;
      clickBlockTimerRef.current = null;
    }, REORDER_CLICK_BLOCK_MS);
  }, []);

  const finishReorder = useCallback(
    (commit) => {
      const st = dragStateRef.current;
      if (!st) return;
      // مرحلهٔ ۵۴ — مأموریت ۱: اگر رها کردن رویِ تبِ پوشه بود،
      // به‌جایِ ذخیرهٔ ترتیب، کارت به آن پوشه منتقل می‌شود.
      const folderTarget = folderDropTargetRef.current;
      folderDropTargetRef.current = null;
      setFolderDropTargetId(null);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      detachWindowListeners();
      clearAllTransforms();
      let orderedVisiblePaths = null;
      if (commit) {
        const preview = previewPathsRef.current;
        const insertAt = Math.max(0, Math.min(st.targetIndex, preview.length));
        orderedVisiblePaths = [...preview];
        orderedVisiblePaths.splice(insertAt, 0, st.path);
      }
      gridRectsRef.current = [];
      previewPathsRef.current = [];
      updateDragState(null);
      // رها کردنِ پس از درگ (یا لغو با Escape) هرگز نباید کلیکِ
      // بازکنندهٔ کتاب شود؛ پرچم، کلیکِ همان ژست را می‌بلعد و پس
      // از ۴۰۰ میلی‌ثانیه خودبه‌خود برمی‌گردد تا کلیکِ بعدیِ واقعی
      // مسدود نماند (گاردِ باگِ ۱).
      markClickBlocked();
      if (commit && folderTarget && typeof onFolderDropRef.current === 'function') {
        onFolderDropRef.current(st.path, folderTarget);
      } else if (
        commit &&
        orderedVisiblePaths &&
        typeof onCommitRef.current === 'function'
      ) {
        onCommitRef.current(orderedVisiblePaths);
      }
    },
    [clearAllTransforms, detachWindowListeners, markClickBlocked, updateDragState]
  );

  const finishReorderRef = useRef(finishReorder);
  finishReorderRef.current = finishReorder;

  const processFrame = useCallback(() => {
    rafRef.current = null;
    const st = dragStateRef.current;
    if (!st) return;
    const p = pointerRef.current;
    const last = lastProcessedRef.current;
    // گاردِ باگِ ۶: بدونِ حرکتِ دست‌کم ۲ پیکسلی، هیچ محاسبه‌ای نیست.
    if (Math.hypot(p.x - last.x, p.y - last.y) < REORDER_MIN_MOVE_PX) return;
    lastProcessedRef.current = { x: p.x, y: p.y };

    const deltaX = p.x - st.startX;
    const deltaY = p.y - st.startY;
    if (floatingElRef.current) {
      floatingElRef.current.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
    }
    const draggedCx = st.rect.left + st.rect.width / 2 + deltaX;
    const draggedCy = st.rect.top + st.rect.height / 2 + deltaY;

    // دافعهٔ مغناطیسیِ کارت‌هایِ دیگر (گاردِ باگِ ۶: مستقیم رویِ DOM).
    gridRectsRef.current.forEach((entry) => {
      if (!entry || !entry.el || entry.path === st.path) return;
      const d = Math.hypot(draggedCx - entry.cx, draggedCy - entry.cy);
      if (d < REORDER_REPULSION_RADIUS) {
        const repelled = computeRepelOffset(draggedCx - entry.cx, draggedCy - entry.cy, d);
        entry.el.style.transform = `translate3d(${repelled.pushX.toFixed(1)}px, ${repelled.pushY.toFixed(1)}px, 0) scale(0.97)`;
      } else {
        entry.el.style.transform = '';
      }
    });

    // تعویضِ زندهٔ اسلات با هیسترزیس: کارتِ هدف، کارتِ همسایه‌ای
    // است که مرکزِ کارتِ گرفته‌شده در هستهٔ ۴۲٪ ابعادش باشد؛
    // جابه‌جاییِ اسلات فقط وقتی پذیرفته می‌شود که نشانگر دست‌کم
    // ۱۵ پیکسل از نقطهٔ آخرین تعویض دور شده باشد تا در مرز،
    // سوسو نزند.
    let candidate = null;
    let candidateDist = Infinity;
    gridRectsRef.current.forEach((entry) => {
      if (!entry || entry.path === st.path) return;
      const inCore =
        Math.abs(draggedCx - entry.cx) <= REORDER_SLOT_CORE_RATIO * entry.w &&
        Math.abs(draggedCy - entry.cy) <= REORDER_SLOT_CORE_RATIO * entry.h;
      if (!inCore) return;
      const d = Math.hypot(draggedCx - entry.cx, draggedCy - entry.cy);
      if (d < candidateDist) {
        candidateDist = d;
        candidate = entry;
      }
    });
    if (candidate) {
      const preview = previewPathsRef.current;
      const idxInPreview = preview.indexOf(candidate.path);
      if (idxInPreview >= 0) {
        let insertAt = idxInPreview;
        // جهتِ جریانِ خواندن در گریدِ راست‌به‌چپ: پایین‌تر از هدف
        // یعنی ردیفِ بعد، و در همان ردیف، چپِ هدف یعنی بعد از آن.
        const sameRow = Math.abs(draggedCy - candidate.cy) <= candidate.h * 0.25;
        if (!sameRow && draggedCy > candidate.cy) insertAt = idxInPreview + 1;
        else if (sameRow && draggedCx < candidate.cx) insertAt = idxInPreview + 1;
        insertAt = Math.max(0, Math.min(insertAt, preview.length));
        if (insertAt !== st.targetIndex) {
          const swapPoint = lastSwapPointerRef.current;
          if (Math.hypot(p.x - swapPoint.x, p.y - swapPoint.y) >= REORDER_SLOT_HYSTERESIS_PX) {
            lastSwapPointerRef.current = { x: p.x, y: p.y };
            updateDragState({ ...st, targetIndex: insertAt });
          }
        }
      }
    }

    // اسکرولِ خودکارِ لبه: نزدیکِ ۶۰ پیکسلِ بالا/پایینِ کانتینر،
    // کانتینر نرم اسکرول می‌خورد و مرکزهایِ کش‌شده به‌اندازهٔ همان
    // جابه‌جایی، اصلاح می‌شوند تا دافعه و هدف‌گیری درست بمانند.
    const scrollEl = scrollRef ? scrollRef.current : null;
    if (scrollEl) {
      const box = scrollEl.getBoundingClientRect();
      let delta = 0;
      if (p.y < box.top + REORDER_EDGE_SCROLL_PX && scrollEl.scrollTop > 0) {
        const closeness = (box.top + REORDER_EDGE_SCROLL_PX - p.y) / REORDER_EDGE_SCROLL_PX;
        delta = -Math.max(2, closeness * 14);
      } else if (
        p.y > box.bottom - REORDER_EDGE_SCROLL_PX &&
        scrollEl.scrollTop < scrollEl.scrollHeight - scrollEl.clientHeight
      ) {
        const closeness = (p.y - (box.bottom - REORDER_EDGE_SCROLL_PX)) / REORDER_EDGE_SCROLL_PX;
        delta = Math.max(2, closeness * 14);
      }
      if (delta !== 0) {
        const before = scrollEl.scrollTop;
        scrollEl.scrollTop = before + delta;
        const applied = scrollEl.scrollTop - before;
        if (applied !== 0) {
          gridRectsRef.current.forEach((entry) => {
            if (entry) entry.cy -= applied;
          });
        }
      }
    }
  }, [scrollRef, updateDragState]);

  const handleWindowPointerMove = useCallback(
    (e) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      // مرحلهٔ ۵۴ — مأموریت ۱: تشخیصِ تبِ پوشهٔ زیرِ نشانگر با
      // elementFromPoint؛ کارتِ شناور pointer-events ندارد، پس
      // تبِ زیر دیده می‌شود. فقط هنگامِ عوض شدن، state عوض
      // می‌شود تا هایلایتِ تب، رندرِ اضافه نسازد.
      let folderId = null;
      try {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const tab =
          el && typeof el.closest === 'function'
            ? el.closest('[data-folder-drop-id]')
            : null;
        folderId = tab ? tab.getAttribute('data-folder-drop-id') : null;
      } catch (_) {
        folderId = null;
      }
      if (folderId !== folderDropTargetRef.current) {
        folderDropTargetRef.current = folderId;
        setFolderDropTargetId(folderId);
      }
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(processFrame);
      }
    },
    [processFrame]
  );

  const handleWindowPointerUp = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    finishReorderRef.current(true);
  }, []);

  const handleWindowPointerCancel = useCallback(() => {
    finishReorderRef.current(false);
  }, []);

  const handleWindowBlur = useCallback(() => {
    finishReorderRef.current(false);
  }, []);

  const handleWindowKeyDown = useCallback((e) => {
    if (e.key === 'Escape') finishReorderRef.current(false);
  }, []);

  const handleWindowResize = useCallback(() => {
    finishReorderRef.current(false);
  }, []);

  const onReorderActivate = useCallback(
    (item, clientX, clientY) => {
      if (!enabled || dragStateRef.current) return;
      const gridEl = gridRef ? gridRef.current : null;
      if (!gridEl) return;
      const rawPath = item?.path || item?.filePath || '';
      const draggedNorm = normalizePath(rawPath);
      if (!draggedNorm) return;
      // اندازه‌گیریِ یک‌بارهٔ مرکزِ همهٔ کارت‌ها در شروعِ درگ؛
      // در mousemove هیچ getBoundingClientRect تازه‌ای نیست.
      const slots = gridEl.querySelectorAll('[data-cr-card-slot]');
      const rects = [];
      slots.forEach((el) => {
        const slotPath = el.getAttribute('data-cr-card-slot') || '';
        if (!slotPath) return;
        const r = el.getBoundingClientRect();
        if (!r || r.width <= 0 || r.height <= 0) return;
        rects.push({
          path: slotPath,
          el,
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
          w: r.width,
          h: r.height,
        });
      });
      const draggedRect = rects.find((entry) => entry.path === draggedNorm);
      if (!draggedRect) return;
      const visible = visibleItemsRef.current;
      const fromIndex = visible.findIndex(
        (entry) => normalizePath(entry?.path || entry?.filePath) === draggedNorm
      );
      if (fromIndex < 0) return;
      const previewPaths = visible
        .map((entry) => normalizePath(entry?.path || entry?.filePath))
        .filter((norm, idx) => idx !== fromIndex && norm);
      gridRectsRef.current = rects;
      previewPathsRef.current = previewPaths;
      pointerRef.current = { x: clientX, y: clientY };
      lastProcessedRef.current = { x: clientX, y: clientY };
      lastSwapPointerRef.current = { x: clientX, y: clientY };
      updateDragState({
        path: draggedNorm,
        item,
        rect: {
          left: draggedRect.cx - draggedRect.w / 2,
          top: draggedRect.cy - draggedRect.h / 2,
          width: draggedRect.w,
          height: draggedRect.h,
        },
        startX: clientX,
        startY: clientY,
        fromIndex,
        targetIndex: fromIndex,
      });
      window.addEventListener('pointermove', handleWindowPointerMove);
      window.addEventListener('pointerup', handleWindowPointerUp);
      window.addEventListener('pointercancel', handleWindowPointerCancel);
      window.addEventListener('blur', handleWindowBlur);
      window.addEventListener('keydown', handleWindowKeyDown);
      window.addEventListener('resize', handleWindowResize);
    },
    [
      enabled,
      gridRef,
      handleWindowBlur,
      handleWindowKeyDown,
      handleWindowPointerCancel,
      handleWindowPointerMove,
      handleWindowPointerUp,
      handleWindowResize,
      updateDragState,
    ]
  );

  // پاک‌سازیِ نهایی هنگامِ آنمانتِ نما.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (clickBlockTimerRef.current) clearTimeout(clickBlockTimerRef.current);
      folderDropTargetRef.current = null;
      detachWindowListeners();
      clearAllTransforms();
    },
    [clearAllTransforms, detachWindowListeners]
  );

  const grabbedPath = dragState ? dragState.path : null;
  const previewItems = dragState
    ? visibleItemsRef.current.filter(
        (entry) => normalizePath(entry?.path || entry?.filePath) !== dragState.path
      )
    : visibleItemsRef.current;
  const floatingItem = dragState ? dragState.item : null;
  const floatingRect = dragState ? dragState.rect : null;
  const placeholderIndex = dragState ? dragState.targetIndex : -1;

  return {
    grabbedPath,
    previewItems,
    placeholderIndex,
    floatingItem,
    floatingRect,
    floatingElRef,
    folderDropTargetId,
    onReorderActivate,
    wasReorderingRef,
    cancelReorder: () => finishReorder(false),
  };
}
