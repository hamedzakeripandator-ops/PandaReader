const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const JSZip = require('jszip');
// مرحله ۵ ـ بخش الف: لودِ تنبلِ backupFormat تا نبودِ آن (مثلاً اگر
// کاربر فایل را سرِ جایش نگذاشته باشد) فقط پشتیبان‌گیری/بازیابی را
// از کار بیندازد، نه کلِ ورکرِ دیتابیس را.
let backupFormatCache = null;
function getBackupFormat() {
  if (backupFormatCache) return backupFormatCache;
  try {
    backupFormatCache = require('./backupFormat');
    return backupFormatCache;
  } catch (_) {
    throw new Error('ماژولِ قالبِ پشتیبان (backupFormat.js) پیدا نشد؛ فایل را در پوشهٔ electron/workers قرار دهید.');
  }
}

// مرحله ۷ ـ بخش الف: محلِ دیتابیس از متغیرِ محیطیِ
// COMIC_READER_DATA_DIR خوانده می‌شود که main.js، پیش از اسپاونِ
// ورکر، آن را از روی حالتِ Portable/عادی تنظیم می‌کند. اگر متغیر،
// غایب یا نسبی یا خالی باشد، دقیقاً همان مسیرِ قبلیِ
// ~/.comic-reader به کار می‌رود. بقیهٔ مسیرهای مشتق‌شده (db.json،
// db.json.bak، covers و مسیرهای بازیابی) دقیقاً مثلِ قبل، از
// DB_DIR ساخته می‌شوند؛ هیچ‌کدام، دست نخورده‌اند.
const ENV_DATA_DIR = process.env.COMIC_READER_DATA_DIR;
const DB_DIR = (typeof ENV_DATA_DIR === 'string' && ENV_DATA_DIR.length > 0 && path.isAbsolute(ENV_DATA_DIR))
  ? ENV_DATA_DIR
  : path.join(os.homedir(), '.comic-reader');
const DB_FILE = path.join(DB_DIR, 'db.json');
const DB_BAK_FILE = path.join(DB_DIR, 'db.json.bak');
// مرحله ۲ ـ بخش الف: پوشهٔ کاورهای روی دیسک + پیشوندِ URL آن‌ها.
// کاورها دیگر به‌صورت Base64 در db.json نمی‌مانند؛ هر کاور یک فایل
// در covers/ است و در db.json فقط همین مرجعِ سبک نگه داشته می‌شود.
const COVERS_DIR = path.join(DB_DIR, 'covers');
const COVER_URL_PREFIX = 'comic://covers/';
// مرحله ۱ ـ بخش الف: فایلِ موقتِ نوشتنِ اتمیک (همیشه در همان دایرکتوری،
// تا rename اتمیک بماند).
const DB_TMP_FILE = DB_FILE + '.tmp';
// مرحله ۵ ـ بخش الف: مسیرهای ایمنیِ بازیابی — نسخهٔ دیتابیسِ پیش از
// Restore (تک‌نسلی، مثلِ .bak) و پوشهٔ کاورهای پیش از Restore.
const DB_PRE_RESTORE_FILE = DB_FILE + '.pre-restore.bak';
const COVERS_PRE_RESTORE_DIR = path.join(DB_DIR, 'covers.pre-restore');
const COVERS_STAGING_DIR = path.join(DB_DIR, 'covers.restore-staging');
const SQLITE_FILE = path.join(DB_DIR, 'library.sqlite');
const SQLITE_MIGRATED_BAK = DB_FILE + '.migrated.bak';
const SQLITE_MIGRATION_KEY = 'migration_from_json_v1_done';
// مرحلهٔ ۴۰ §۱: بارگذاریِ ایمنِ better-sqlite3 — اگر نصب نباشد،
let BetterSqlite3 = null;
try { BetterSqlite3 = require('better-sqlite3'); } catch (_) { BetterSqlite3 = null; }
let sqliteDb = null;
let sqliteReady = false;
let sqliteStmts = {};

const MAX_COVER_CACHE_ENTRIES = 300;

const defaultDB = {
  history: {},
  library: [],
  libraryFolders: [],
  favoriteFolders: [],
  // مرحله ۴۹ (C): پرچمِ مهاجرتِ یک‌بارهٔ پوشه‌هایِ علاقه‌مندی از
  // folderIdِ قدیمی (گزینهٔ الف)؛ پس از یک بار اجرا، true می‌ماند تا
  // پوشهٔ مهاجرت‌شدهٔ حذف‌شده، در بوتِ بعدی دوباره ساخته نشود.
  favoriteFolderMigrationDone: false,
  favorites: [],
  annotations: {},
  bookmarks: {},
  bookmarkPreferences: {
    defaultTemplate: 'MARGIN',
    globalImage: null,
    templateImages: {},
    defaultSide: 'right',
    savedPresets: []
  },
  readingStats: { days: {}, byBook: {}, totalAppSeconds: 0 },
  customStatViews: [],
  epubHighlights: {},
  customColorSystem: { favoriteColors: [], customColorTemplates: [], toolColors: {} },
  profile: {
    username: 'Haamed',
    subtitle: 'توسعه‌دهنده و کمیک‌خوان حرفه‌ای',
    avatar: null,
    avatarGradient: 'linear-gradient(135deg, #22d3ee 0%, #0f171c 100%)',
    dailyGoalPages: 50,
    updatedAt: new Date().toISOString()
  },
  coverCache: {},
  shortcuts: {},
  settings: {
    defaultZoom: 1,
    zoomStep: 0.1,
    comicPageGap: 0,
    pdfPageGap: 12,
    autoZenOnOpen: true,
    screenshotFormat: 'png',
    jpgQuality: 0.94,
    showSidebarCounts: true
  }
};

function normalizePath(p) {
  if (!p || typeof p !== 'string') return '';
  return p.trim().replace(/[\\/]+/g, '\\').toLowerCase();
}

function isPermanentCover(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (
    s.startsWith('data:image/') ||
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('blob:') ||
    // مرحله ۲ ـ بخش الف: مرجعِ کاورِ روی دیسک هم دائمی است؛ بدونِ
    // این خط، migrateSchema کاورهای comic:// را در بوتِ بعدی null
    // می‌کرد.
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
}

// ترتيب عناصر المكتبة بحيث تظهر العناصر المثبتة في الأعلى دائمًا
function sortLibraryItems(list) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    const aPinned = a?.isPinned ? 1 : 0;
    const bPinned = b?.isPinned ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    if (aPinned && bPinned) {
      const pTimeA = a?.pinnedAt || '';
      const pTimeB = b?.pinnedAt || '';
      if (pTimeA !== pTimeB) return pTimeB.localeCompare(pTimeA);
    }
    const addedA = a?.addedAt || '';
    const addedB = b?.addedAt || '';
    return addedB.localeCompare(addedA);
  });
}

// مرحله ۱۳: فهرستِ ۱۵ تمپلیت — باید پیش از migrateSchema باشد، چون
// migrateSchema در readDB صدا زده می‌شود و readDB در ارزیابیِ ماژول
// (initDB()/readDB() در پایینِ فایل) اجرا می‌شود.
const BOOKMARK_TEMPLATE_IDS = ['MARGIN', 'SLANT', 'ARROW', 'MIRROR', 'FLIP', 'ZOOM', 'SWAY', 'GLOW', 'FLOAT', 'SLIDE', 'SPLIT', 'TILT', 'WAVE', 'DIAGONAL', 'OFFSET'];
function migrateSchema(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return JSON.parse(JSON.stringify(defaultDB));
  }

  const rawCoverCache =
    parsed.coverCache && typeof parsed.coverCache === 'object' ? parsed.coverCache : {};
  const cleanCoverCache = {};

  Object.entries(rawCoverCache).forEach(([k, v]) => {
    const normKey = normalizePath(k) || k;
    // هر دو شکل پذیرفته می‌شود: شکلِ قدیمی (رشته یا {dataUrl}) و
    // شکلِ جدید ({cover, file}). مقادیرِ data: قدیمی اینجا نگه
    // داشته می‌شوند تا migrateCoversToDisk در readDB آن‌ها را به
    // فایل تبدیل کند.
    const rawCover = typeof v === 'string' ? v : v?.cover ?? v?.dataUrl;
    const rawFile = typeof v === 'object' && v !== null ? v.file || null : null;
    if (isPermanentCover(rawCover)) {
      cleanCoverCache[normKey] = {
        cover: rawCover,
        file: rawFile,
        isCustom: Boolean(v?.isCustom),
        updatedAt: v?.updatedAt || new Date().toISOString()
      };
    }
  });

  const libraryFolders = Array.isArray(parsed.libraryFolders)
    ? parsed.libraryFolders.filter((f) => f && f.id && f.name)
    : [];
  const validFolderIds = new Set(libraryFolders.map((f) => f.id));
  // مرحله ۴۹ (C): فهرستِ مستقلِ پوشه‌هایِ علاقه‌مندی‌ها.
  const favoriteFolders = Array.isArray(parsed.favoriteFolders)
    ? parsed.favoriteFolders.filter((f) => f && f.id && f.name)
    : [];
  const validFavoriteFolderIds = new Set(favoriteFolders.map((f) => f.id));

  const library = Array.isArray(parsed.library) ? parsed.library : [];
  const favorites = Array.isArray(parsed.favorites) ? parsed.favorites : [];
  const history = parsed.history && typeof parsed.history === 'object' ? parsed.history : {};
  const annotations =
    parsed.annotations && typeof parsed.annotations === 'object' ? parsed.annotations : {};

  library.forEach((item) => {
    const norm = normalizePath(item.path || item.filePath);
    item.normPath = norm;
    item.isPinned = Boolean(item.isPinned);
    item.pinnedAt = item.isPinned ? item.pinnedAt || item.addedAt || new Date().toISOString() : null;
    item.folderId = item.folderId && validFolderIds.has(item.folderId) ? item.folderId : null;
    if (cleanCoverCache[norm]?.isCustom && isPermanentCover(cleanCoverCache[norm]?.cover)) {
      item.cover = cleanCoverCache[norm].cover;
      item.hasCustomCover = true;
    } else if (!isPermanentCover(item.cover)) {
      item.cover = cleanCoverCache[norm]?.cover || null;
    }
  });

  favorites.forEach((item) => {
    const norm = normalizePath(item.path || item.filePath);
    // مرحله ۴۹ (C): پوشهٔ علاقه‌مندی، فقط با شناسهٔ پوشهٔ
    // علاقه‌مندیِ موجود معتبر است؛ پوشهٔ حذف‌شده، بی‌پوشه می‌شود.
    // فیلدِ قدیمیِ folderId فقط اعتبارسنجی می‌شود و نگه داشته
    // می‌شود (حفظ‌شده ولی نادیده‌گرفته‌شده) تا بازگشت به مرحلهٔ ۴۸
    // ممکن بماند؛ مهاجرتِ آن به favoriteFolderId، در بلوکِ یک‌بارهٔ
    // پایین انجام می‌شود.
    item.favoriteFolderId =
      item.favoriteFolderId && validFavoriteFolderIds.has(item.favoriteFolderId)
        ? item.favoriteFolderId
        : null;
    item.folderId = item.folderId && validFolderIds.has(item.folderId) ? item.folderId : null;
    if (cleanCoverCache[norm]?.isCustom && isPermanentCover(cleanCoverCache[norm]?.cover)) {
      item.cover = cleanCoverCache[norm].cover;
    } else if (!isPermanentCover(item.cover)) {
      item.cover = cleanCoverCache[norm]?.cover || null;
    }
  });

  // مرحله ۴۹ (C): مهاجرتِ یک‌بارهٔ پوشه‌بندیِ علاقه‌مندی‌ها (گزینهٔ
  // الف — امن‌تر): علاقه‌مندی‌هایی که هنوز favoriteFolderId ندارند
  // ولی folderIdِ قدیمی‌شان به یک پوشهٔ موجودِ کتابخانه اشاره می‌کند،
  // همان پوشه را در سیستمِ مستقلِ علاقه‌مندی‌ها می‌گیرند. برایِ هر
  // پوشهٔ کتابخانه، حداکثر یک پوشهٔ علاقه‌مندیِ هم‌نام/هم‌رنگ ساخته
  // می‌شود (شناسهٔ قطعیِ مشتق‌شده، تا اجرایِ دوباره، تکراری نسازد) و
  // پوشه‌هایِ دستیِ هم‌نامِ موجود، دوباره ساخته نمی‌شوند. پس از این
  // اجرا، پرچمِ favoriteFolderMigrationDone در db.json می‌ماند تا
  // حذفِ بعدیِ پوشهٔ مهاجرت‌شده، در بوتِ بعد بازسازی نشود. پوشهٔ
  // کتابخانهٔ حذف‌شده (folderIdِ نامعتبر)، مهاجرتی ندارد و کتاب،
  // بی‌پوشه می‌ماند؛ folderIdِ قدیمی هم دست نمی‌خورد.
  let favoriteFolderMigrationDone = parsed.favoriteFolderMigrationDone === true;
  if (!favoriteFolderMigrationDone) {
    const libFolderById = new Map(libraryFolders.map((f) => [f.id, f]));
    const favByLibId = new Map();
    const favByNameColor = new Map();
    favoriteFolders.forEach((f) => {
      if (f.migratedFromLibraryFolderId) favByLibId.set(f.migratedFromLibraryFolderId, f);
      favByNameColor.set(`${(f.name || '').trim()}|${f.color || ''}`, f);
    });
    favorites.forEach((item) => {
      if (item.favoriteFolderId) return;
      const legacyId = item.folderId;
      if (!legacyId || !libFolderById.has(legacyId)) return;
      const libFolder = libFolderById.get(legacyId);
      const nameColorKey = `${(libFolder.name || '').trim()}|${libFolder.color || ''}`;
      let target = favByLibId.get(legacyId) || favByNameColor.get(nameColorKey);
      if (!target) {
        target = {
          id: `favfolder_migrated_${legacyId}`,
          name: libFolder.name,
          color: libFolder.color || '#22d3ee',
          icon: libFolder.icon || 'Folder',
          createdAt: new Date().toISOString(),
          migratedFromLibraryFolderId: legacyId,
        };
        favoriteFolders.push(target);
        validFavoriteFolderIds.add(target.id);
        favByLibId.set(legacyId, target);
        favByNameColor.set(nameColorKey, target);
      }
      item.favoriteFolderId = target.id;
    });
    favoriteFolderMigrationDone = true;
  }

  Object.keys(history).forEach((normKey) => {
    if (cleanCoverCache[normKey]?.isCustom && isPermanentCover(cleanCoverCache[normKey]?.cover)) {
      history[normKey].cover = cleanCoverCache[normKey].cover;
    } else if (!isPermanentCover(history[normKey].cover)) {
      history[normKey].cover = cleanCoverCache[normKey]?.cover || null;
    }
  });

  // مرحله ۶ ـ بخش الف: جدولِ آمارِ مطالعه. دیتابیس‌های قدیمی این
  // کلید را ندارند (مقدارِ پیش‌فرضِ خالی) و ورودی‌های خراب، بی‌صدا
  // به صفر برمی‌گردند؛ سقفِ ۱۰۹۵ روز (۳ سال) جلوی رشدِ بی‌نهایت را
  // می‌گیرد. این جدول در پشتیبان (.crbackup) هم هست، چون بخشی از
  // db.json است؛ اعتبارسنجِ پشتیبان آن را اختیاری می‌داند تا
  // پشتیبان‌های قدیمی همچنان بازیابی شوند.
  const readingStatsDays = {};
  {
    const rawDays =
      parsed.readingStats && typeof parsed.readingStats === 'object' && parsed.readingStats.days && typeof parsed.readingStats.days === 'object'
        ? parsed.readingStats.days
        : {};
    const dayKeys = Object.keys(rawDays)
      .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
      .sort()
      .slice(-1095);
    for (const key of dayKeys) {
      const entry = rawDays[key] || {};
      readingStatsDays[key] = {
        pages: Math.max(0, Math.min(100000, Math.floor(Number(entry.pages) || 0))),
        seconds: Math.max(0, Math.min(86400, Math.floor(Number(entry.seconds) || 0))),
        appSeconds: Math.max(0, Math.min(86400, Math.floor(Number(entry.appSeconds) || 0))),
      };
    }
  }
  // مرحلهٔ ۳۵ §۱: آمار به تفکیکِ کتاب — فقط ورودی‌هایِ معتبر نگه
  // داشته می‌شوند؛ اگر byBook خالی است و history کتاب دارد، از
  // پیشرفتِ صفحاتِ history مقدارِ اولیه ساخته می‌شود (ثانیهٔ
  // مطالعهٔ گذشته نامعلوم است و صفر می‌ماند — عددِ جعلی ساخته
  // نمی‌شود). سقفِ ۱۰۹۵ روز، مثلِ روزهایِ کلی، اعمال می‌شود.
  const readingStatsByBook = {};
  {
    const rawByBook =
      parsed.readingStats && typeof parsed.readingStats === 'object' && parsed.readingStats.byBook && typeof parsed.readingStats.byBook === 'object'
        ? parsed.readingStats.byBook
        : {};
    for (const [key, val] of Object.entries(rawByBook)) {
      if (!key || !val || typeof val !== 'object') continue;
      const days = {};
      const rawDays = val.days && typeof val.days === 'object' ? val.days : {};
      for (const dk of Object.keys(rawDays).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-1095)) {
        const e = rawDays[dk] || {};
        days[dk] = {
          seconds: Math.max(0, Math.min(86400, Math.floor(Number(e.seconds) || 0))),
          pages: Math.max(0, Math.min(10000, Math.floor(Number(e.pages) || 0))),
        };
      }
      readingStatsByBook[key] = {
        totalSeconds: Math.max(0, Math.floor(Number(val.totalSeconds) || 0)),
        totalPages: Math.max(0, Math.floor(Number(val.totalPages) || 0)),
        days,
      };
    }
    if (Object.keys(readingStatsByBook).length === 0 && parsed.history && typeof parsed.history === 'object') {
      for (const [normKey, h] of Object.entries(parsed.history)) {
        if (!h) continue;
        const cp = Math.max(0, Math.floor(Number(h.currentPage) || 0));
        if (cp > 0) readingStatsByBook[normKey] = { totalSeconds: 0, totalPages: cp, days: {} };
      }
    }
  }
  // مرحلهٔ ۳۵ §۱/§۲: آماربندی‌هایِ سفارشی + هایلایت‌هایِ EPUB — فقط
  // ورودی‌هایِ معتبر نگه داشته می‌شوند (سقف: ۵۰ آماربندی، ۵۰۰۰
  // هایلایت برای هر کتاب).
  const customStatViews = Array.isArray(parsed.customStatViews)
    ? parsed.customStatViews
        .filter((v) => v && typeof v === 'object' && typeof v.name === 'string' && v.name.trim())
        .slice(0, 50)
        .map((v) => ({
          id: String(v.id || ''),
          name: String(v.name).slice(0, 60),
          color: typeof v.color === 'string' ? v.color : '#22d3ee',
          bookKeys: Array.isArray(v.bookKeys) ? v.bookKeys.filter((k) => typeof k === 'string').slice(0, 500) : [],
          metrics: Array.isArray(v.metrics) ? v.metrics.filter((m) => typeof m === 'string').slice(0, 10) : [],
          goalHours: Math.max(0, Number(v.goalHours) || 0),
          goalPages: Math.max(0, Number(v.goalPages) || 0),
        }))
    : [];
  const epubHighlights = {};
  {
    const rawHl = parsed.epubHighlights && typeof parsed.epubHighlights === 'object' ? parsed.epubHighlights : {};
    for (const [normKey, list] of Object.entries(rawHl)) {
      if (!normKey || !Array.isArray(list)) continue;
      epubHighlights[normKey] = list
        .filter((h) => h && typeof h === 'object' && Number.isFinite(Number(h.chapterIndex)))
        .slice(0, 5000)
        .map((h) => ({
          id: String(h.id || ''),
          chapterIndex: Math.floor(Number(h.chapterIndex)),
          color: typeof h.color === 'string' ? h.color : '#facc15',
          text: String(h.text || '').slice(0, 2000),
          note: String(h.note || '').slice(0, 2000),
          startOffset: Math.max(0, Math.floor(Number(h.startOffset) || 0)),
          endOffset: Math.max(0, Math.floor(Number(h.endOffset) || 0)),
          createdAt: Number(h.createdAt) || Date.now(),
        }));
    }
  }
  const readingStats = {
    days: readingStatsDays,
    byBook: readingStatsByBook,
    totalAppSeconds: Math.max(0, Math.floor(Number((parsed.readingStats && parsed.readingStats.totalAppSeconds) || 0))),
  };

  // مرحله ۱۳: بوک‌مارک‌هایِ دیجیتال — فقط رکوردهایِ معتبر نگه
  // داشته می‌شوند؛ ورودیِ خراب، به‌جایِ شکستنِ رندر، حذف می‌شود.
  const rawBookmarks = parsed.bookmarks && typeof parsed.bookmarks === 'object' ? parsed.bookmarks : {};
  const bookmarks = {};
  Object.entries(rawBookmarks).forEach(([normKey, list]) => {
    if (!Array.isArray(list)) return;
    const norm = normalizePath(normKey) || normKey;
    const clean = [];
    list.forEach((item) => {
      const b = sanitizeBookmarkRecord(item);
      if (b) clean.push(b);
    });
    if (clean.length > 0) bookmarks[norm] = clean;
  });
  const rawPrefs = parsed.bookmarkPreferences && typeof parsed.bookmarkPreferences === 'object' ? parsed.bookmarkPreferences : {};
  const bookmarkPreferences = {
    defaultTemplate: BOOKMARK_TEMPLATE_IDS.includes(rawPrefs.defaultTemplate) ? rawPrefs.defaultTemplate : 'MARGIN',
    globalImage: typeof rawPrefs.globalImage === 'string' ? rawPrefs.globalImage : null,
    templateImages: {},
    defaultSide: rawPrefs.defaultSide === 'left' ? 'left' : 'right',
    savedPresets: [],
  };
  if (Array.isArray(rawPrefs.savedPresets)) {
    rawPrefs.savedPresets.forEach((p) => {
      const clean = sanitizeBookmarkPreset(p);
      if (clean && bookmarkPreferences.savedPresets.length < 100) bookmarkPreferences.savedPresets.push(clean);
    });
  }
  if (rawPrefs.templateImages && typeof rawPrefs.templateImages === 'object') {
    Object.entries(rawPrefs.templateImages).forEach(([id, url]) => {
      if (BOOKMARK_TEMPLATE_IDS.includes(id) && typeof url === 'string' && url) bookmarkPreferences.templateImages[id] = url;
    });
  }

  const rawColors = parsed.customColorSystem && typeof parsed.customColorSystem === 'object' ? parsed.customColorSystem : {};
  const customColorSystem = {
    favoriteColors: Array.isArray(rawColors.favoriteColors) ? rawColors.favoriteColors.filter((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 48) : [],
    customColorTemplates: Array.isArray(rawColors.customColorTemplates) ? rawColors.customColorTemplates.filter((t) => t && typeof t === 'object' && typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.colors)).map((t) => ({ id: t.id, name: String(t.name).slice(0, 40), colors: t.colors.filter((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 12) })).slice(0, 24) : [],
    toolColors: {},
  };
  if (rawColors.toolColors && typeof rawColors.toolColors === 'object') {
    for (const k of ['pen', 'highlighter', 'box', 'arrow', 'text', 'sticky']) {
      if (typeof rawColors.toolColors[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(rawColors.toolColors[k])) customColorSystem.toolColors[k] = rawColors.toolColors[k];
    }
  }

  return {
    history,
    library: sortLibraryItems(library),
    libraryFolders,
    favoriteFolders,
    favoriteFolderMigrationDone,
    favorites,
    annotations,
    bookmarks,
    bookmarkPreferences,
    readingStats,
    customStatViews,
    epubHighlights,
    customColorSystem,
    profile: {
      ...defaultDB.profile,
      ...(parsed.profile && typeof parsed.profile === 'object' ? parsed.profile : {})
    },
    coverCache: cleanCoverCache,
    shortcuts: parsed.shortcuts && typeof parsed.shortcuts === 'object' ? parsed.shortcuts : {},
    settings: {
      ...defaultDB.settings,
      ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {})
    }
  };
}

function pruneCoverCache(db) {
  if (!db.coverCache) return;
  const entries = Object.entries(db.coverCache);
  if (entries.length <= MAX_COVER_CACHE_ENTRIES) return;

  const pinnedPaths = new Set([
    ...(db.library || []).map((i) => normalizePath(i.path || i.filePath)),
    ...(db.favorites || []).map((i) => normalizePath(i.path || i.filePath))
  ]);

  entries.sort((a, b) => {
    const aCustom = a[1]?.isCustom ? 1 : 0;
    const bCustom = b[1]?.isCustom ? 1 : 0;
    if (aCustom !== bCustom) return bCustom - aCustom;

    const aPinned = pinnedPaths.has(a[0]) ? 1 : 0;
    const bPinned = pinnedPaths.has(b[0]) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;

    const strA = a[1]?.updatedAt || '';
    const strB = b[1]?.updatedAt || '';
    return strB.localeCompare(strA);
  });

  const pruned = {};
  entries.slice(0, MAX_COVER_CACHE_ENTRIES).forEach(([key, val]) => {
    pruned[key] = val;
  });
  const dropped = entries.slice(MAX_COVER_CACHE_ENTRIES);
  db.coverCache = pruned;
  // مرحله ۲ ـ بخش الف/ب: فایلِ ورودیِ هرس‌شده فقط وقتی پاک می‌شود که
  // هیچ جدولِ کاربری به آن ارجاع ندهد؛ چون history/library معمولاً
  // هنوز به همان فایل ارجاع می‌دهند، در عمل بیشترِ فایل‌ها می‌مانند
  // و فقط یتیم‌های واقعی پاک می‌شوند. (ارجاعِ خودِ کش شمرده نمی‌شود.)
  dropped.forEach(([, val]) => {
    const file = val?.file || coverFileFromUrl(coverEntryToUrl(val));
    if (file) deleteCoverFileIfUnreferenced(db, file);
  });
}

let cachedDbInstance = null;
let diskWriteTimer = null;
let isWritingDisk = false;
let needsAnotherWrite = false;
// مرحله ۱ ـ بخش الف: پرچمِ کثیفی — هر فراخوانیِ writeDB آن را true
// می‌کند و هر نوشتنِ موفقِ روی دیسک، false؛ تا FLUSH_SYNC بداند آیا
// چیزی برای نوشتن هست یا نه.
let dbDirty = false;
// مرحله ۱ ـ بخش ب: شمارندهٔ نسلِ نوشتن — باگِ پیدا‌شده در ممیزیِ
// عمیق: در بخش الف، performAsyncDiskWrite در انتها بی‌قیدوشرط
// dbDirty=false می‌کرد؛ اگر حینِ نوشتنِ ناهمگام، تغییری از رندرر
// می‌رسید (که writeDB را صدا می‌زد و dbDirty را true می‌کرد)،
// تمام‌شدنِ نوشتنِ اول، پرچمِ تغییرِ جدید را پاک می‌کرد و اگر خروج
// پیش از تایمرِ ۹۰۰ میلی‌ثانیه‌ای می‌رسید، FLUSH_SYNC که تایمر را
// لغو می‌کند، تغییرِ جدید را گم می‌کرد. حالا هر writeDB نسل را یکی
// زیاد می‌کند و dbDirty فقط وقتی false می‌شود که نسلِ نوشته‌شده روی
// دیسک، برابرِ آخرین نسلِ تغییرِ حافظه باشد.
let writeGeneration = 0;
// مرحله ۲ ـ بخش الف: مهاجرتِ کاورها فقط یک بار در هر عمرِ ورکر اجرا
// می‌شود (در اولینِ readDB)؛ چون readDB در ابتدای هر پیام هم صدا
// زده می‌شود، بدونِ این نگهبان، هر پیام مهاجرت را تکرار می‌کرد.
let coverMigrationDone = false;

function runCoverMigrationOnce(db) {
  if (coverMigrationDone || !db) return;
  coverMigrationDone = true;
  try {
    const changed = migrateCoversToDisk(db);
    // مرحله ۲ ـ بخش ب: پاک‌سازیِ ورودی‌های کشِ کتاب‌های کهنه (کتابی
    // که در هیچ جدولِ کاربری نیست) پیش از جارو؛ وگرنه فایلِ آن‌ها
    // یتیم شناخته نمی‌شد، و اگر فقط فایل جارو می‌شد، ورودیِ کش به
    // URL مرده اشاره می‌کرد. ترتیب مهم است: اول ورودی، بعد فایل.
    let purged = false;
    Object.keys(db.coverCache || {}).forEach((normKey) => {
      if (!isBookInUserTables(db, normKey)) {
        delete db.coverCache[normKey];
        purged = true;
      }
    });
    sweepOrphanCoverFiles(db);
    if (changed || purged) {
      writeDB(db, true);
    }
  } catch (error) {
    console.warn('Cover migration non-fatal error:', error?.message || error);
  }
}

function initDB() {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    // مرحله ۲ ـ بخش الف: پوشهٔ کاورها همیشه وجود دارد (حتی پیش از
    // اولین کاور)، تا saveCoverFile و سروِ comic://covers هرگز به
    //‌خاطرِ نبودِ پوشه شکست نخورند.
    try {
      if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });
    } catch (_) {}
    // پاک‌سازیِ فایل‌های موقتِ به‌جامانده از کرشِ قبلی: نوشتنِ اتمیکِ
    // ناتمام، فقط tmp را جا می‌گذارد و فایلِ اصلی سالم می‌ماند.
    // مرحله ۱ ـ بخش ب: هر دو tmp پاک می‌شوند — چون هم db.json و هم
    // db.json.bak اتمیک نوشته می‌شوند، کرش می‌تواند هر دو tmp را جا
    // بگذارد (در بخش الف فقط tmpِ اصلی پاک می‌شد).
    try {
      if (fs.existsSync(DB_TMP_FILE)) fs.unlinkSync(DB_TMP_FILE);
      if (fs.existsSync(DB_BAK_FILE + '.tmp')) fs.unlinkSync(DB_BAK_FILE + '.tmp');
    } catch (_) {}
    if (!fs.existsSync(DB_FILE)) {
      const initialJson = JSON.stringify(defaultDB, null, 2);
      writeDbFilesSync(initialJson);
      cachedDbInstance = JSON.parse(initialJson);
    } else if (!fs.existsSync(DB_BAK_FILE)) {
      // .bak فقط وقتی از روی db.json ساخته می‌شود که db.json سالم و
      // قابلِ parse باشد. کپیِ کورکورانهٔ db.json روی .bak (رفتارِ
      // قبلی) اگر db.json خراب بود، پشتیبانِ سالم را هم نابود می‌کرد
      // و بازیابیِ readDB را بی‌اثر می‌کرد.
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        JSON.parse(raw);
        atomicWriteFileSync(DB_BAK_FILE, raw);
      } catch (_) {}
    }
  } catch (error) {
    console.error('Database Init Critical Error:', error);
  }
}

function readDB() {
  if (cachedDbInstance) {
    return cachedDbInstance;
  }

  try {
    if (!fs.existsSync(DB_FILE)) {
      cachedDbInstance = JSON.parse(JSON.stringify(defaultDB));
      return cachedDbInstance;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    if (!raw || raw.trim().length === 0) throw new Error('Empty DB file');
    const parsed = JSON.parse(raw);
    const hadFavMigrationFlag = parsed.favoriteFolderMigrationDone === true;
    cachedDbInstance = migrateSchema(parsed);
    // مرحله ۴۹ (C): اگر مهاجرتِ یک‌بارهٔ پوشه‌هایِ علاقه‌مندی همین‌جا
    // اجرا شد، همان لحظه رویِ دیسک نوشته می‌شود تا بوتِ بعدی، پوشهٔ
    // مهاجرت‌شدهٔ حذف‌شده را دوباره نسازد.
    if (!hadFavMigrationFlag && cachedDbInstance.favoriteFolderMigrationDone) {
      writeDB(cachedDbInstance, true);
    }
    runCoverMigrationOnce(cachedDbInstance);
    return cachedDbInstance;
  } catch (primaryError) {
    console.warn('Primary DB read failed, attempting backup recovery...', primaryError.message);
    try {
      if (fs.existsSync(DB_BAK_FILE)) {
        const rawBak = fs.readFileSync(DB_BAK_FILE, 'utf8');
        const parsedBak = JSON.parse(rawBak);
        cachedDbInstance = migrateSchema(parsedBak);
        runCoverMigrationOnce(cachedDbInstance);
        writeDB(cachedDbInstance, true);
        return cachedDbInstance;
      }
    } catch (_) {}
    cachedDbInstance = JSON.parse(JSON.stringify(defaultDB));
    return cachedDbInstance;
  }
}

// مرحله ۱ ـ بخش ب: خوابِ همگامِ کوتاه برای فاصلهٔ بینِ تلاش‌های
// مجددِ rename (در ورکر، Atomics.wait مجاز است؛ اگر در دسترس نبود،
// حلقهٔ چرخشیِ کوتاه جایگزین می‌شود تا وابستگی به محیط نباشد).
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_) {
    const end = Date.now() + ms;
    while (Date.now() < end) {}
  }
}

function sleepAsync(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// مرحله ۱ ـ بخش ب: rename مقاوم در برابر قفلِ موقتِ ویندوز.
// در NTFS، آنتی‌ویروس یا ایندکسر ممکن است برای چند میلی‌ثانیه روی
// فایلِ مقصد قفل بگذارد و rename با EPERM/EBUSY/EACCES شکست بخورد.
// پس تا ۳ بار تلاش می‌شود (با فاصلهٔ ۵۰ و ۱۰۰ میلی‌ثانیه) و اگر هر ۳
// بار شکست خورد، Fallback امن اجرا می‌شود: کپیِ tmp روی مقصد + حذفِ
// tmp. توجهٔ صادقانه: Fallback دیگر اتمیک نیست (کرش وسطِ کپی، مقصد
// را نیمه‌کاره می‌گذارد) ولی فقط وقتی فعال می‌شود که rename در هر ۳
// تلاش ناممکن بوده باشد؛ یعنی انتخاب بین «نوشتنِ غیراتمیک» و
// «اصلاً ننوشتن» است، و اولی بهتر است. خطاهای دیگر (مثل ENOENT)
// بی‌درنگ و بدونِ تلاشِ مجدد، پرتاب می‌شوند.
function isRetryableRenameError(error) {
  return error && (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES');
}

function renameWithRetrySync(tmpPath, targetPath) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.renameSync(tmpPath, targetPath);
      return;
    } catch (error) {
      // خطای غیرِ قابلِ تلاشِ مجدد (مثل ENOENT)، بی‌درنگ و بدونِ
      // Fallback پرتاب می‌شود؛ Fallback فقط بعد از ۳ تلاشِ ناموفقِ
      // قابلِ تلاشِ مجدد اجرا می‌شود.
      if (!isRetryableRenameError(error)) throw error;
      if (attempt === 2) break;
      sleepSync(50 * (attempt + 1));
    }
  }
  // Fallback: کپی + حذفِ tmp. اگر کپی هم شکست خورد، خطا بالا می‌رود
  // تا لایهٔ بالاتر (dbDirty / تایمرِ دوباره / گزارشِ فلاش) آن را
  // مدیریت کند؛ هرگز بی‌صدا قورت داده نمی‌شود.
  fs.copyFileSync(tmpPath, targetPath);
  try { fs.unlinkSync(tmpPath); } catch (_) {}
}

async function renameWithRetryAsync(tmpPath, targetPath) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.promises.rename(tmpPath, targetPath);
      return;
    } catch (error) {
      if (!isRetryableRenameError(error)) throw error;
      if (attempt === 2) break;
      await sleepAsync(50 * (attempt + 1));
    }
  }
  await fs.promises.copyFile(tmpPath, targetPath);
  try { await fs.promises.unlink(tmpPath); } catch (_) {}
}

// مرحله ۱ ـ بخش الف: نوشتنِ اتمیک (Write-to-Temp + Atomic Rename).
// محتوا اول کامل در یک فایلِ tmp (در همان دایرکتوری) نوشته و fsync
// می‌شود و بعد با rename — که در یک فایل‌سیستم اتمیک است — جای فایلِ
// هدف را می‌گیرد؛ پس در هر لحظه، فایلِ هدف یا نسخهٔ کاملِ قبلی است یا
// نسخهٔ کاملِ جدید، هرگز نیمه‌کاره نیست.
function atomicWriteFileSync(targetPath, content) {
  const tmpPath = targetPath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf8');
  // مرحله ۱ ـ بخش ب: فایل‌دیسکریپتور حتماً در finally بسته می‌شود و
  // rename فقط بعد از بسته‌شدنِ قطعیِ هندل صدا زده می‌شود؛ در ویندوز،
  // rename کردنِ فایلی که هندلِ باز دارد قطعاً EPERM می‌دهد. در نسخهٔ
  // بخش الف، اگر closeSync خطا می‌داد، catch بیرونی آن را قورت می‌داد
  // و rename با هندلِ باز انجام می‌شد.
  let fd = null;
  try {
    fd = fs.openSync(tmpPath, 'r');
    try { fs.fsyncSync(fd); } catch (_) {}
  } catch (_) {
    // خطای بازکردن/fsync، مانعِ rename نمی‌شود؛ محتوای tmp کامل است.
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
  renameWithRetrySync(tmpPath, targetPath);
}

async function atomicWriteFileAsync(targetPath, content) {
  const tmpPath = targetPath + '.tmp';
  await fs.promises.writeFile(tmpPath, content, 'utf8');
  // مرحله ۱ ـ بخش ب: مثلِ نسخهٔ همگام — بستنِ هندل در finally، و
  // rename فقط بعد از بسته‌شدنِ قطعیِ آن (در نسخهٔ بخش الف، اگر
  // close خطا می‌داد، rename با هندلِ باز انجام می‌شد).
  let handle = null;
  try {
    handle = await fs.promises.open(tmpPath, 'r');
    try { await handle.sync(); } catch (_) {}
  } catch (_) {
  } finally {
    if (handle) {
      try { await handle.close(); } catch (_) {}
    }
  }
  await renameWithRetryAsync(tmpPath, targetPath);
}

// نوشتنِ هر دو فایل (اصلی + پشتیبان) با یک محتوا؛ ترتیب عمداً همین
// است: اول db.json، بعد .bak — پس .bak همیشه با «آخرین وضعیتِ موفقِ
// دیسک» همگام است و دیگر فقط در نوشتن‌های فوری به‌روز نمی‌شود.
function writeDbFilesSync(jsonString) {
  atomicWriteFileSync(DB_FILE, jsonString);
  atomicWriteFileSync(DB_BAK_FILE, jsonString);
  return true;
}

async function writeDbFilesAsync(jsonString) {
  await atomicWriteFileAsync(DB_FILE, jsonString);
  await atomicWriteFileAsync(DB_BAK_FILE, jsonString);
}

async function performAsyncDiskWrite() {
  if (isWritingDisk || !cachedDbInstance) {
    needsAnotherWrite = true;
    return;
  }

  isWritingDisk = true;
  needsAnotherWrite = false;
  // نسلِ لحظهٔ شروعِ نوشتن؛ فقط اگر در حینِ await هیچ تغییری
  // نیامده باشد (نسل عوض نشده باشد)، پاک‌کردنِ dbDirty امن است.
  const writtenGeneration = writeGeneration;

  try {
    pruneCoverCache(cachedDbInstance);
    const jsonString = JSON.stringify(cachedDbInstance, null, 2);
    await writeDbFilesAsync(jsonString);
    if (writeGeneration === writtenGeneration) {
      dbDirty = false;
    }
  } catch (error) {
    needsAnotherWrite = true;
  } finally {
    isWritingDisk = false;
    if (needsAnotherWrite) {
      writeDB(cachedDbInstance);
    }
  }
}

function writeDB(data, immediate = false) {
  cachedDbInstance = data;
  dbDirty = true;
  writeGeneration += 1;

  if (immediate) {
    if (diskWriteTimer) {
      clearTimeout(diskWriteTimer);
      diskWriteTimer = null;
    }
    // اگر نوشتنِ ناهمگام در حالِ انجام است، نوشتنِ همگامِ مستقیم با
    // آن روی یک tmp مسابقه می‌دهد؛ پس به‌جای نوشتن، پرچمِ «یک بارِ
    // دیگر بنویس» را می‌گذاریم تا finallyیِ نوشتنِ در حالِ انجام،
    // تازه‌ترین داده را بنویسد (و پرچمِ کثیفی هم تا آن موقع true
    // می‌ماند تا FLUSH_SYNC آن را بگیرد).
    if (isWritingDisk) {
      needsAnotherWrite = true;
      return false;
    }
    const writtenGeneration = writeGeneration;
    try {
      pruneCoverCache(cachedDbInstance);
      const jsonString = JSON.stringify(cachedDbInstance, null, 2);
      writeDbFilesSync(jsonString);
      // نوشتنِ همگام، هیچ await ندارد، پس نسل نمی‌تواند وسطِ آن عوض
      // شده باشد؛ ولی برای یکپارچگیِ انضباطِ نسل، همان شرط چک می‌شود.
      if (writeGeneration === writtenGeneration) {
        dbDirty = false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  if (diskWriteTimer) clearTimeout(diskWriteTimer);
  diskWriteTimer = setTimeout(() => {
    diskWriteTimer = null;
    performAsyncDiskWrite();
  }, 900);

  return true;
}

// مرحله ۱ ـ بخش الف: فلاشِ نهاییِ خروج (همگام، اتمیک).
// تایمرِ debounce را لغو می‌کند، تا حدِ ۲۴۰۰ میلی‌ثانیه منتظرِ تمام
// شدنِ نوشتنِ ناهمگامِ در حالِ انجام می‌ماند (چون main حداکثر ۲۵۰۰
// میلی‌ثانیه صبر می‌کند)، و اگر دادهٔ نوشته‌نشده هست، آن را همگام و
// اتمیک می‌نویسد. اگر نوشتنِ قبلی هنوز تمام نشده بود، flushed:false
// برمی‌گردد تا main با تایم‌اوت، خروج را قفل نکند؛ در آن حالت،
// db.json همان نسخهٔ کاملِ قبلی است و tmpِ نیمه‌کاره در بوتِ بعدی
// پاک می‌شود.
async function handleFlushSync() {
  if (diskWriteTimer) {
    clearTimeout(diskWriteTimer);
    diskWriteTimer = null;
  }
  const start = Date.now();
  while (isWritingDisk && Date.now() - start < 2400) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (isWritingDisk) {
    return { ok: false, flushed: false };
  }
  if (!dbDirty || !cachedDbInstance) {
    return { ok: true, flushed: false };
  }
  try {
    pruneCoverCache(cachedDbInstance);
    const jsonString = JSON.stringify(cachedDbInstance, null, 2);
    writeDbFilesSync(jsonString);
    // بینِ stringify و نوشتن، هیچ await نیست، پس هیچ تغییری
    // نمی‌تواند وسطِ آن برسد؛ پاک‌کردنِ بی‌قیدِ پرچم اینجا امن است
    // (برخلافِ مسیرِ ناهمگام که به نسل نیاز دارد).
    dbDirty = false;
    return { ok: true, flushed: true };
  } catch (_) {
    return { ok: false, flushed: false };
  }
}


// مرحله ۲ ـ بخش الف: ابزارهای کاورِ روی دیسک.
const COVER_MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg'
};

// نامِ فایلِ کاور از هشِ مسیرِ نرمال‌شدهٔ کتاب: برای یک کتاب همیشه
// یکسان است (پس مهاجرت و ذخیرهٔ دوباره، idempotent اند) و برای
// کتاب‌های مختلف، عملاً یکتا.
function coverFileNameFor(normPath, ext) {
  const hash = crypto.createHash('sha256').update(normPath).digest('hex').slice(0, 32);
  return `${hash}.${ext}`;
}

// نوشتنِ اتمیکِ باینری (همان الگوی مرحله ۱، ولی برای Buffer نه
// رشته): tmp + fsync + rename با تلاشِ مجددِ ویندوز.
function atomicWriteBinaryFileSync(targetPath, buffer) {
  const tmpPath = targetPath + '.tmp';
  fs.writeFileSync(tmpPath, buffer);
  let fd = null;
  try {
    fd = fs.openSync(tmpPath, 'r');
    try { fs.fsyncSync(fd); } catch (_) {}
  } catch (_) {
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
  renameWithRetrySync(tmpPath, targetPath);
}

// تبدیل یک Data URL تصویری به فایلِ روی دیسک؛ در صورتِ هر خطا null
// برمی‌گردد تا فراخواننده، کاورِ قبلی را نگه دارد (نه اینکه کاور را
// با هیچ‌چیز جایگزین کند).
function saveCoverFile(normPath, dataUrl) {
  try {
    if (!normPath || typeof dataUrl !== 'string') return null;
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+)(?:;charset=[^;]+)?;base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) return null;
    const ext = COVER_MIME_TO_EXT[match[1].toLowerCase()] || 'png';
    const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (buffer.length === 0) return null;
    if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });
    const file = coverFileNameFor(normPath, ext);
    atomicWriteBinaryFileSync(path.join(COVERS_DIR, file), buffer);
    return { file, cover: COVER_URL_PREFIX + file };
  } catch (_) {
    return null;
  }
}

// خواندنِ URL کاور از یک ورودیِ coverCache با پذیرشِ هر دو شکلِ
// قدیمی ({dataUrl} یا رشته) و جدید ({cover, file}).
function coverEntryToUrl(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return entry.cover ?? entry.dataUrl ?? null;
}

// مرحله ۲ ـ بخش ب: Query String کش‌باست (?v=...) پیش از استخراجِ
// نامِ فایل جدا می‌شود؛ وگرنه 'abc.jpg?v=123' به‌عنوانِ نامِ فایل
// برمی‌گشت و هیچ‌وقت با فایلِ واقعیِ روی دیسک جور نمی‌شد.
function coverFileFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.startsWith(COVER_URL_PREFIX)) return null;
  const withoutQuery = url.slice(COVER_URL_PREFIX.length).split('?')[0];
  const file = withoutQuery.split('/').pop();
  return file || null;
}

// نسخهٔ عددیِ کش‌باست از روی URL (برای یکنواخت و صعودی نگه داشتنِ
// نسخه در syncCoverAcrossTables).
function coverVersionFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/[?&]v=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// مرحله ۲ ـ بخش ب: ارجاع‌ها فقط از جدول‌های کاربری (history/library/
// favorites) شمرده می‌شوند، نه از coverCache. coverCache یک کش است،
// نه مالک؛ اگر خودش جزو مراجع باشد، هیچ کاوری با حذفِ کتاب هرگز
// پاک نمی‌شود (باگِ بخش الف که تستِ بخش الف هم به‌اشتباه آن را
// «امنیت» خوانده بود). بعد از این تغییر، حذفِ کتاب + حذفِ ورودیِ
// کش (در اکشن‌های حذف) فایل را واقعاً یتیم می‌کند.
function collectReferencedCoverFiles(db) {
  const referenced = new Set();
  const addFromCover = (cover) => {
    const file = coverFileFromUrl(cover);
    if (file) referenced.add(file);
  };
  Object.values(db.history || {}).forEach((h) => addFromCover(h?.cover));
  (db.library || []).forEach((item) => addFromCover(item?.cover));
  (db.favorites || []).forEach((item) => addFromCover(item?.cover));
  return referenced;
}

// آیا کتاب هنوز در حداقل یکی از جدول‌های کاربری هست؟
function isBookInUserTables(db, normPath) {
  if (!normPath) return false;
  if (db.history && db.history[normPath]) return true;
  if ((db.library || []).some((item) => normalizePath(item.path || item.filePath) === normPath)) return true;
  if ((db.favorites || []).some((item) => normalizePath(item.path || item.filePath) === normPath)) return true;
  return false;
}

// اگر کتاب از هر سه جدولِ کاربری رفته باشد، ورودیِ کشِ آن را هم حذف
// کن (وگرنه کشِ کهنه هم اسلاتِ ۳۰۰تایی را اشغال می‌کند و هم با
// GET_CACHED_COVER کاورِ کتابِ حذف‌شده را زنده نگه می‌دارد).
function purgeCoverCacheEntryIfBookGone(db, normPath) {
  if (!normPath || !db.coverCache) return;
  if (!isBookInUserTables(db, normPath)) {
    delete db.coverCache[normPath];
  }
}

// حذفِ فایلِ کاور فقط وقتی که هیچ جدولِ کاربری به آن ارجاع نمی‌دهد؛
// این همان چیزی است که هرسِ کش و حذفِ کتاب را امن می‌کند (فایلِ
// کاوری که هنوز در library/history/favorites هست، هرگز پاک نمی‌شود).
function deleteCoverFileIfUnreferenced(db, file) {
  if (!file) return;
  try {
    if (collectReferencedCoverFiles(db).has(file)) return;
    const target = path.join(COVERS_DIR, path.basename(file));
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch (_) {}
}

// مهاجرتِ خودکارِ کاورهای Base64 قدیمی به فایل؛ در صورتِ شکستِ یک
// ورودی، همان Data URL نگه داشته می‌شود (بدونِ از دست رفتن) تا بوتِ
// بعدی دوباره تلاش کند. true یعنی چیزی عوض شد و باید ذخیره شود.
function migrateCoversToDisk(db) {
  let changed = false;
  const convertCover = (normPath, currentCover) => {
    if (!currentCover || typeof currentCover !== 'string') return currentCover;
    if (!currentCover.startsWith('data:image/')) return currentCover;
    const saved = saveCoverFile(normPath, currentCover);
    if (!saved) return currentCover;
    changed = true;
    return saved.cover;
  };
  Object.entries(db.coverCache || {}).forEach(([normKey, entry]) => {
    const current = coverEntryToUrl(entry);
    const next = convertCover(normKey, current);
    if (next !== current) {
      db.coverCache[normKey] = {
        cover: next,
        file: coverFileFromUrl(next),
        isCustom: Boolean(entry?.isCustom),
        updatedAt: entry?.updatedAt || new Date().toISOString()
      };
    }
  });
  Object.entries(db.history || {}).forEach(([normKey, h]) => {
    if (h) h.cover = convertCover(normKey, h.cover);
  });
  (db.library || []).forEach((item) => {
    const norm = normalizePath(item.path || item.filePath);
    if (norm) item.cover = convertCover(norm, item.cover);
  });
  (db.favorites || []).forEach((item) => {
    const norm = normalizePath(item.path || item.filePath);
    if (norm) item.cover = convertCover(norm, item.cover);
  });
  return changed;
}

// جاروی فایل‌های یتیمِ پوشهٔ covers (فایل‌هایی که هیچ جدولی به آن‌ها
// ارجاع نمی‌دهد)؛ پشتیبانِ امنِ هرس و حذفِ کتاب.
function sweepOrphanCoverFiles(db) {
  try {
    if (!fs.existsSync(COVERS_DIR)) return;
    const referenced = collectReferencedCoverFiles(db);
    fs.readdirSync(COVERS_DIR).forEach((file) => {
      if (!referenced.has(file)) {
        try { fs.unlinkSync(path.join(COVERS_DIR, file)); } catch (_) {}
      }
    });
  } catch (_) {}
}

// مرحله ۲ ـ بخش الف: همگام‌سازیِ کاور با ذخیرهٔ روی دیسک.
// قراردادِ بازگشت: کاوری که باید ذخیره شود (comic:// یا URL عبوری)،
// یا کاورِ قبلی اگر چیزی عوض نشد (مثلاً نگهبانِ سفارشی)، یا null اگر
// اصلاً کاوری نیست. فراخواننده‌ها باید از همین مقدارِ بازگشتی برای
// نوشتن در جدول‌ها استفاده کنند، نه از ورودیِ خام (که ممکن است
// Base64 باشد و هرگز نباید دوباره در db.json بنشیند).
function syncCoverAcrossTables(db, normPath, input, forceCustom = false) {
  const existingCache = db.coverCache[normPath];
  const existingCover = coverEntryToUrl(existingCache);
  if (!normPath || !isPermanentCover(input)) return existingCover;

  // عدم استبدال الغلاف المخصص الذي عينه المستخدم إلا إذا كان التحديث مخصصًا
  if (existingCache?.isCustom && !forceCustom) {
    return existingCover;
  }

  const isCustomFlag = forceCustom ? true : Boolean(existingCache?.isCustom);

  let cover = input;
  let file = null;
  if (typeof input === 'string' && input.startsWith('data:image/')) {
    const saved = saveCoverFile(normPath, input);
    if (!saved) return existingCover;
    cover = saved.cover;
    file = saved.file;
    // مرحله ۲ ـ بخش ب: کش‌باست. محتوای فایل عوض شده (حتی با همان
    // نامِ قبلی، مثلاً jpg→jpg در SET_CUSTOM_COVER)، پس URL باید
    // عوض شود تا <img> کاورِ قبلیِ کش‌شده را نشان ندهد. نسخه فقط
    // وقتی ساخته می‌شود که محتوا واقعاً نوشته شده باشد؛ بازهمگام‌سازیِ
    // همان URL (مثلاً در SAVE_PROGRESS) نسخهٔ قبلی را حفظ می‌کند تا
    // کشِ تصویر بی‌دلیل نشکند. نسخه یکنواخت و صعودی است تا دو تغییرِ
    // پی‌درپی در یک میلی‌ثانیه هم URL یکسان نسازند.
    let version = Date.now();
    const prevVersion = coverVersionFromUrl(existingCover);
    if (prevVersion && version <= prevVersion) version = prevVersion + 1;
    cover = `${cover}?v=${version}`;
  } else if (typeof input === 'string' && input.startsWith(COVER_URL_PREFIX)) {
    file = coverFileFromUrl(input);
  }

  const oldFile = existingCache?.file || null;
  db.coverCache[normPath] = {
    cover,
    file,
    isCustom: isCustomFlag,
    updatedAt: new Date().toISOString()
  };

  if (db.history[normPath]) {
    db.history[normPath].cover = cover;
  }

  const libItem = db.library.find((item) => normalizePath(item.path || item.filePath) === normPath);
  if (libItem) {
    libItem.cover = cover;
    if (isCustomFlag) libItem.hasCustomCover = true;
  }

  const favItem = db.favorites.find((item) => normalizePath(item.path || item.filePath) === normPath);
  if (favItem) {
    favItem.cover = cover;
  }

  if (oldFile && oldFile !== file) {
    deleteCoverFileIfUnreferenced(db, oldFile);
  }
  return cover;
}

// ============================================================================
// مرحله ۵ ـ بخش الف: پشتیبان‌گیری و بازیابیِ یک‌کلیکی.
// همهٔ کارِ ZIP و جایگزینی، داخلِ همین ورکر انجام می‌شود تا:
//  ۱) فلاشِ دیتابیس (handleFlushSync) و خواندنِ db.json در یک تردِ
//     مالکِ داده باشند و نسخهٔ پشتیبان، تازه‌ترین وضعیت باشد؛
//  ۲) جایگزینیِ دیتابیس از مسیرِ writeDB عبور کند تا حافظهٔ ورکر با
//     دیسک همگام بماند (جایگزینیِ مستقیمِ فایل از main، باعث می‌شد
//     نوشتنِ debounceِ بعدیِ ورکر، دیتابیسِ بازیابی‌شده را با حافظهٔ
//     قدیمی بازنویسی کند).
// ============================================================================

/** فهرستِ فایل‌های واقعیِ پوشهٔ covers (فقط نام‌های امن، مرتب‌شده). */
function listCoverFiles() {
  if (!fs.existsSync(COVERS_DIR)) return [];
  const out = [];
  for (const name of fs.readdirSync(COVERS_DIR)) {
    if (!getBackupFormat().isSafeCoverFileName(name)) continue;
    const fullPath = path.join(COVERS_DIR, name);
    try {
      const st = fs.statSync(fullPath);
      if (st.isFile()) out.push({ name, fullPath, size: st.size });
    } catch (_) {}
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/**
 * ساختِ فایلِ پشتیبان (ZIP) از وضعیتِ فلاش‌شدهٔ دیتابیس + کاورها.
 * @returns {Promise<{base64: string, coverCount: number, dbSha256: string, size: number}>}
 */
async function buildBackupZip() {
  const flush = await handleFlushSync();
  if (!flush.ok) {
    throw new Error('ذخیرهٔ تغییراتِ اخیر روی دیسک کامل نشد؛ چند لحظه دیگر دوباره تلاش کنید.');
  }
  if (!fs.existsSync(DB_FILE)) {
    throw new Error('فایل دیتابیس روی دیسک پیدا نشد.');
  }
  const dbBytes = fs.readFileSync(DB_FILE);
  if (dbBytes.length > getBackupFormat().MAX_DB_BYTES) {
    throw new Error('دیتابیس برای پشتیبان‌گیری بیش از حد بزرگ است.');
  }
  const covers = listCoverFiles();
  const manifest = getBackupFormat().createBackupManifest({ dbBytes, coverCount: covers.length });

  const zip = new JSZip();
  zip.file(getBackupFormat().BACKUP_MANIFEST_NAME, JSON.stringify(manifest, null, 2));
  zip.file(getBackupFormat().BACKUP_DB_NAME, dbBytes);
  const coversFolder = zip.folder(getBackupFormat().BACKUP_COVERS_PREFIX.replace(/\/$/, ''));
  for (const cover of covers) {
    if (cover.size > getBackupFormat().MAX_COVER_BYTES) {
      throw new Error(`فایل کاورِ ${cover.name} برای پشتیبان‌گیری بیش از حد بزرگ است.`);
    }
    coversFolder.file(cover.name, fs.readFileSync(cover.fullPath));
  }
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return {
    base64: buffer.toString('base64'),
    coverCount: covers.length,
    dbSha256: manifest.dbSha256,
    size: buffer.length,
  };
}

/** خطای قفلِ فایل/دایرکتوری در ویندوز (NTFS) قابلِ تلاشِ مجدد است. */
function isDirectoryLockError(err) {
  return err && ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(err.code);
}

/** renameِ دایرکتوری با تلاشِ مجددِ کوتاه (الگوی مرحله ۱ ـ بخش ب). */
function retryDirRenameSync(fromPath, toPath) {
  let lastErr = null;
  const delays = [50, 100];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.renameSync(fromPath, toPath);
      return;
    } catch (err) {
      lastErr = err;
      if (!isDirectoryLockError(err) || attempt === 2) throw err;
      const end = Date.now() + delays[attempt];
      while (Date.now() < end) { /* انتظارِ همگامِ کوتاه */ }
    }
  }
  throw lastErr || new Error('تغییرِ نامِ پوشه انجام نشد.');
}

function listPlainFilesInDir(dirPath) {
  let names = [];
  try { names = fs.readdirSync(dirPath); } catch (_) { return []; }
  const out = [];
  for (const name of names) {
    try {
      if (fs.statSync(path.join(dirPath, name)).isFile()) out.push(name);
    } catch (_) {}
  }
  out.sort();
  return out;
}

/**
 * Fallbackِ فایل‌به‌فایل برای ویندوز (مرحله ۵ ـ بخش ب): وقتی
 * renameِ خودِ دایرکتوریِ covers به‌خاطرِ باز بودنِ یک تصویر در
 * تگِ <img> یا پروتکلِ comic:// قفل است، پوشه نگه داشته می‌شود؛
 * فایل‌های قبلی به covers.pre-restore کپی می‌شوند و تک‌تکِ
 * فایل‌های staging با copyFileSync درونِ covers نوشته می‌شوند.
 * فایل‌های قدیمی‌ای که در مجموعهٔ جدید نیستند، بهترین تلاش حذف
 * می‌شوند؛ اگر قفل، حذفشان را نگذاشت، در بوتِ بعدی، جاروی
 * orphanِ کاورها آن‌ها را پاک می‌کند (پس شکستِ حذف، شکستِ
 * بازیابی نیست). کپیِ هر فایلِ staging که نشد، در failedCopies
 * برمی‌گردد و فراخواننده باید بازیابی را ناموفق اعلام کند.
 */
function swapCoversDirectoryFileByFile(stagingDir) {
  const failedCopies = [];
  try { fs.mkdirSync(COVERS_DIR, { recursive: true }); } catch (_) {}
  try { fs.rmSync(COVERS_PRE_RESTORE_DIR, { recursive: true, force: true }); } catch (_) {}
  try { fs.mkdirSync(COVERS_PRE_RESTORE_DIR, { recursive: true }); } catch (_) {}
  const oldFiles = listPlainFilesInDir(COVERS_DIR);
  for (const name of oldFiles) {
    try { fs.copyFileSync(path.join(COVERS_DIR, name), path.join(COVERS_PRE_RESTORE_DIR, name)); } catch (_) {}
  }
  const stagingFiles = listPlainFilesInDir(stagingDir);
  for (const name of stagingFiles) {
    try {
      fs.copyFileSync(path.join(stagingDir, name), path.join(COVERS_DIR, name));
    } catch (_) {
      failedCopies.push(name);
    }
  }
  const stagingSet = new Set(stagingFiles);
  const staleLeft = [];
  for (const name of oldFiles) {
    if (stagingSet.has(name)) continue;
    try { fs.unlinkSync(path.join(COVERS_DIR, name)); } catch (_) { staleLeft.push(name); }
  }
  try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}
  return { failedCopies, staleLeft };
}

/**
 * جابه‌جاییِ پوشهٔ کاورها با پوشهٔ staging + بازگشت در صورتِ خطا.
 * مسیرِ سریع، renameِ دایرکتوری است؛ اگر در ویندوز قفل شد،
 * Fallbackِ فایل‌به‌فایل (swapCoversDirectoryFileByFile) بازیابی را
 * نجات می‌دهد و فقط وقتی کپیِ فایل‌های staging هم نشد، خطا می‌دهد.
 */
function swapCoversDirectory(stagingDir) {
  const hadCovers = fs.existsSync(COVERS_DIR);
  try {
    if (hadCovers) {
      if (fs.existsSync(COVERS_PRE_RESTORE_DIR)) {
        fs.rmSync(COVERS_PRE_RESTORE_DIR, { recursive: true, force: true });
      }
      retryDirRenameSync(COVERS_DIR, COVERS_PRE_RESTORE_DIR);
    }
    try {
      retryDirRenameSync(stagingDir, COVERS_DIR);
      return;
    } catch (err) {
      if (hadCovers && fs.existsSync(COVERS_PRE_RESTORE_DIR) && !fs.existsSync(COVERS_DIR)) {
        try { fs.renameSync(COVERS_PRE_RESTORE_DIR, COVERS_DIR); } catch (_) {}
      }
      throw err;
    }
  } catch (fastErr) {
    // Fallback فقط وقتی معنا دارد که staging هنوز سرِ جایش باشد.
    if (!fs.existsSync(stagingDir)) throw fastErr;
    // اگر rollbackِ بالا موفق نبود و پوشهٔ covers نیست، اول همان
    // rollback را با تلاشِ مجدد امتحان کن تا fallback، پوشه‌ای
    // خالی نسازد.
    if (hadCovers && !fs.existsSync(COVERS_DIR) && fs.existsSync(COVERS_PRE_RESTORE_DIR)) {
      try { retryDirRenameSync(COVERS_PRE_RESTORE_DIR, COVERS_DIR); } catch (_) {}
    }
    const result = swapCoversDirectoryFileByFile(stagingDir);
    if (result.failedCopies.length > 0) {
      throw new Error('جایگزینیِ کاورها با کپیِ فایل‌به‌فایل کامل نشد (' + result.failedCopies.join(', ') + ')؛ نسخهٔ قبلی در covers.pre-restore نگه داشته شده است.');
    }
    return;
  }
}

/**
 * اعتبارسنجی و اعمالِ فایلِ پشتیبان. همهٔ بررسی‌ها پیش از هر تغییری
 * انجام می‌شوند؛ ترتیبِ تغییرات: ۱) کپیِ ایمنیِ دیتابیسِ فعلی،
 * ۲) جایگزینیِ اتمیکِ دیتابیس از مسیرِ writeDB، ۳) جابه‌جاییِ کاورها.
 * @returns {Promise<{coverCount: number, dbSha256: string}>}
 */
async function applyRestoreFromZip(zipBuffer) {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
    throw new Error('فایل پشتیبان خالی است.');
  }
  if (zipBuffer.length > getBackupFormat().MAX_BACKUP_BYTES) {
    throw new Error('فایل پشتیبان بیش از حد بزرگ است.');
  }
  let zip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch (_) {
    throw new Error('فایل پشتیبان خراب است یا یک فایل ZIP معتبر نیست.');
  }
  const entryNames = Object.keys(zip.files || {});
  if (entryNames.length > getBackupFormat().MAX_BACKUP_ENTRIES) {
    throw new Error('فایل پشتیبان ورودی‌های بیش از حد زیادی دارد.');
  }

  // --- اعتبارسنجی (پیش از هر تغییری) ---
  const manifestFile = zip.file(getBackupFormat().BACKUP_MANIFEST_NAME);
  if (!manifestFile || manifestFile.dir) {
    throw new Error('فایل پشتیبان، manifest ندارد.');
  }
  let manifest;
  try {
    manifest = JSON.parse(await manifestFile.async('string'));
  } catch (_) {
    throw new Error('فایل manifest پشتیبان خوانا نیست.');
  }
  const manifestError = getBackupFormat().validateBackupManifest(manifest);
  if (manifestError) throw new Error(manifestError);

  const dbFile = zip.file(getBackupFormat().BACKUP_DB_NAME);
  if (!dbFile || dbFile.dir) {
    throw new Error('فایل پشتیبان، دیتابیس (db.json) ندارد.');
  }
  const dbBytes = await dbFile.async('nodebuffer');
  if (dbBytes.length !== manifest.dbSize || dbBytes.length > getBackupFormat().MAX_DB_BYTES) {
    throw new Error('اندازهٔ دیتابیسِ داخلِ پشتیبان با manifest هم‌خوانی ندارد.');
  }
  if (getBackupFormat().sha256Hex(dbBytes) !== manifest.dbSha256) {
    throw new Error('اثر انگشتِ دیتابیسِ داخلِ پشتیبان با manifest هم‌خوانی ندارد؛ فایل ممکن است خراب یا دست‌کاری‌شده باشد.');
  }
  let parsed;
  try {
    parsed = JSON.parse(dbBytes.toString('utf8'));
  } catch (_) {
    throw new Error('دیتابیسِ داخلِ فایل پشتیبان، JSON معتبر نیست.');
  }
  const dbError = getBackupFormat().validateRestoredDb(parsed);
  if (dbError) throw new Error(dbError);
  const migratedDb = migrateSchema(parsed);

  // کاورها: همهٔ ورودی‌های covers/ باید نامِ امن داشته باشند و در سقف باشند؛
  // و هر ارجاعِ داخلِ دیتابیس باید فایلِ متناظرش در پشتیبان باشد.
  const coverEntries = [];
  for (const name of entryNames) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    if (!name.startsWith(getBackupFormat().BACKUP_COVERS_PREFIX)) continue;
    const fileName = name.slice(getBackupFormat().BACKUP_COVERS_PREFIX.length);
    if (!getBackupFormat().isSafeCoverFileName(fileName)) {
      throw new Error(`فایل پشتیبان، ورودیِ کاورِ نامعتبر دارد (${fileName}).`);
    }
    coverEntries.push({ name, fileName, entry });
  }
  if (coverEntries.length !== manifest.coverCount) {
    throw new Error('شمارِ کاورهای داخلِ پشتیبان با manifest هم‌خوانی ندارد.');
  }
  const availableCovers = new Set(coverEntries.map((c) => c.fileName));
  const referenced = getBackupFormat().collectBackupCoverReferences(migratedDb);
  const missing = [...referenced].filter((f) => !availableCovers.has(f));
  if (missing.length > 0) {
    throw new Error(`فایل پشتیبان ناقص است؛ ${missing.length} کاورِ موردنیازِ دیتابیس در آن نیست. بازیابی انجام نشد.`);
  }
  const coverBuffers = [];
  for (const cover of coverEntries) {
    const buffer = await cover.entry.async('nodebuffer');
    if (buffer.length > getBackupFormat().MAX_COVER_BYTES) {
      throw new Error(`فایل کاورِ ${cover.fileName} در پشتیبان بیش از حد بزرگ است.`);
    }
    coverBuffers.push({ fileName: cover.fileName, buffer });
  }

  // --- اعمال (پس از اعتبارسنجیِ کامل) ---
  // ۱) کپیِ ایمنیِ دیتابیسِ فعلی، پیش از هر جایگزینی.
  if (fs.existsSync(DB_FILE)) {
    try { fs.copyFileSync(DB_FILE, DB_PRE_RESTORE_FILE); } catch (_) {}
  }
  // ۲) جایگزینیِ اتمیکِ دیتابیس از مسیرِ writeDB (حافظهٔ ورکر همگام می‌ماند).
  const written = writeDB(migratedDb, true);
  if (!written) {
    throw new Error('جایگزینیِ دیتابیس انجام نشد؛ اطلاعات فعلی دست‌نخورده باقی ماند.');
  }
  // ۳) کاورها: اول در پوشهٔ staging، بعد جابه‌جاییِ اتمیکِ پوشه.
  if (fs.existsSync(COVERS_STAGING_DIR)) {
    fs.rmSync(COVERS_STAGING_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(COVERS_STAGING_DIR, { recursive: true });
  try {
    for (const cover of coverBuffers) {
      atomicWriteBinaryFileSync(path.join(COVERS_STAGING_DIR, cover.fileName), cover.buffer);
    }
    swapCoversDirectory(COVERS_STAGING_DIR);
  } catch (err) {
    try { fs.rmSync(COVERS_STAGING_DIR, { recursive: true, force: true }); } catch (_) {}
    throw new Error('جایگزینیِ کاورها کامل نشد: ' + (err && err.message ? err.message : String(err)));
  }
  return { coverCount: coverBuffers.length, dbSha256: manifest.dbSha256 };
}

initDB();
readDB();
initSQLite();

// مرحله ۱۰: ابزارهای هرس و پاک‌سازیِ کاور.
// پیشوندِ نامِ فایلِ کاور از هشِ مسیرِ نرمال‌شده (همان قراردادِ
// coverFileNameFor): برای یک کتاب همیشه یکسان است و پسوند، ممکن
// است بینِ نسخه‌ها عوض شده باشد؛ پس حذف، بر اساسِ پیشوند انجام
// می‌شود، نه نامِ کامل.
function coverHashPrefixFor(normPath) {
  try {
    return crypto.createHash('sha256').update(normPath).digest('hex').slice(0, 32);
  } catch (_) {
    return '';
  }
}

// حذفِ همهٔ فایل‌های کاورِ یک کتاب (بر اساسِ پیشوندِ هش + ورودیِ
// کش) و برگرداندنِ شمار و حجمِ آزادشده. نامِ فایل‌های کاور،
// ذاتاً به مسیرِ نرمال‌شده گره خورده‌اند؛ پس فایلی که پیشوندِ
// هشِ کتابی دیگر را داشته باشد، هرگز لمس نمی‌شود.
function deleteCoverFilesForNorm(db, normPath) {
  let deleted = 0;
  let freedBytes = 0;
  try {
    const prefix = coverHashPrefixFor(normPath);
    const entryFile = db.coverCache && db.coverCache[normPath] ? coverFileFromUrl(coverEntryToUrl(db.coverCache[normPath])) : null;
    if (!fs.existsSync(COVERS_DIR)) return { deleted: 0, freedBytes: 0 };
    const names = fs.readdirSync(COVERS_DIR);
    for (const name of names) {
      const isPrefixed = prefix && name.startsWith(prefix);
      const isEntryFile = entryFile && name === entryFile;
      if (!isPrefixed && !isEntryFile) continue;
      const full = path.join(COVERS_DIR, name);
      try {
        const st = fs.statSync(full);
        if (st.isFile()) {
          fs.unlinkSync(full);
          deleted += 1;
          freedBytes += st.size;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return { deleted, freedBytes };
}

// آیا ریشهٔ درایوِ مسیر (مثلاً D:\ یا \\server\share\) هنوز
// در سیستم هست؟ اگر درایو وصل نباشد، «نبودنِ فایل» به‌معنای
// «حذف‌شدن» نیست و کتاب باید بماند. نبودِ ریشه، یعنی درایو
// قطع است، نه فایلِ پاک‌شده.
function driveRootExists(filePath) {
  try {
    const root = path.parse(filePath).root;
    if (!root) return false;
    const st = fs.statSync(root);
    return st.isDirectory();
  } catch (_) {
    return false;
  }
}

// مرحلهٔ ۵۲ §۱: مسیرهایِ دستیِ اسلایدرِ هیرو (از تنظیماتِ
// heroSliderConfig). فایلِ فقط-اسلایدری، در هیچ جدولِ کاربری نیست؛
// ولی کاورش باید حفظ شود و عضویتش در اسلایدر هم دست نمی‌خورد.
// وقتی SQLite آماده است، kv_store مرجعِ تنظیمات است و آینهٔ JSON
// ممکن است عقب باشد؛ پس همان کلید از kv هم خوانده می‌شود.
function collectCustomSliderNorms(db) {
  const norms = new Set();
  const addList = (list) => {
    (Array.isArray(list) ? list : []).forEach((p) => {
      const n = normalizePath(p);
      if (n) norms.add(n);
    });
  };
  try {
    const fromSettings = db.settings && db.settings.heroSliderConfig;
    if (fromSettings && typeof fromSettings === 'object') addList(fromSettings.customSliderBookPaths);
  } catch (_) {}
  try {
    if (sqliteReady) {
      const raw = sqliteGetKv('setting:heroSliderConfig');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') addList(parsed.customSliderBookPaths);
      }
    }
  } catch (_) {}
  return norms;
}

// مرحلهٔ ۵۲ §۱: همگام‌سازیِ هوشمندِ فایل‌هایِ حذف‌شده (جایگزینِ
// هرسِ قدیمیِ مرحلهٔ ۱۰ که کتاب را از همه‌جا — از جمله کتابخانه و
// علاقه‌مندی‌ها — پاک می‌کرد).
//   - فایلِ موجود: می‌ماند؛ اگر پرچمِ isMissing داشت، پرچم برداشته
//     می‌شود (فایل برگشته است).
//   - فایلِ رفته (و درایوش وصل است): از Recent/history + بوک‌مارک‌ها
//     + حاشیه‌نویسی‌ها + epub_highlights + epub_text_cache پاک می‌شود؛
//     در هر دو موتور (جدول‌هایِ SQLite و آینهٔ JSON) و در یک گذرِ
//     دسته‌ای.
//   - همان فایل، در کتابخانه و علاقه‌مندی‌ها می‌ماند با isMissing:true
//     (و در اسلایدر هم می‌ماند؛ resolveHeroSliderItems آن را نگه
//     می‌دارد) تا کاربر با بجِ هشدار ببیندش و با دکمهٔ سطل، خودش
//     حذفش کند.
//   - کاور (ورودیِ coverCache + فایل‌هایِ covers/) فقط وقتی آزاد
//     می‌شود که فایل در هیچ‌کدام از library/favorites/
//     customSliderBookPaths نباشد.
//   - onlyPaths (آرایهٔ اختیاری): فقط همان مسیرها بررسی می‌شوند؛
//     باز هم یک پیامِ دسته‌ای است، نه حلقهٔ IPC.
//   - dryRun=true: هیچ چیز تغییر نمی‌کند؛ فقط پیش‌نمایش برمی‌گردد
//     (برایِ PREVIEW_PRUNE_MISSING_FILES).
// فقط یک بار writeDB انجام می‌شود و حذف‌هایِ SQLite در یک تراکنشِ
// واحد می‌نشینند.
function syncMissingFiles(db, dryRun = false, onlyPaths = null) {
  const onlyNorms = new Set();
  if (Array.isArray(onlyPaths)) {
    onlyPaths.forEach((p) => {
      const n = normalizePath(p);
      if (n) onlyNorms.add(n);
    });
  }
  const scoped = onlyNorms.size > 0;

  const candidates = new Map();
  const consider = (rawPath, fallbackNorm) => {
    const norm = normalizePath(rawPath) || fallbackNorm;
    if (!norm || candidates.has(norm)) return;
    if (scoped && !onlyNorms.has(norm)) return;
    candidates.set(norm, rawPath || fallbackNorm || '');
  };
  Object.entries(db.history || {}).forEach(([normKey, h]) => {
    consider(h && (h.filePath || h.path), normKey);
  });
  (db.library || []).forEach((item) => consider(item && (item.path || item.filePath), ''));
  (db.favorites || []).forEach((item) => consider(item && (item.path || item.filePath), ''));
  Object.keys(db.annotations || {}).forEach((norm) => consider(norm, norm));
  Object.keys(db.bookmarks || {}).forEach((norm) => consider(norm, norm));
  Object.keys(db.epubHighlights || {}).forEach((norm) => consider(norm, norm));
  if (db.epubTextCache && typeof db.epubTextCache === 'object') {
    Object.keys(db.epubTextCache).forEach((norm) => consider(norm, norm));
  }
  // کلیدهایِ فقط-SQLite (کشِ متنِ EPUB در JSON آینه ندارد).
  if (sqliteReady && sqliteStmts.listTextCacheKeys) {
    try {
      sqliteStmts.listTextCacheKeys.all().forEach((row) => {
        if (row && row.file_key) consider(row.file_key, row.file_key);
      });
    } catch (_) {}
  }

  const sliderNorms = collectCustomSliderNorms(db);
  const libraryNorms = new Set();
  (db.library || []).forEach((item) => {
    const n = normalizePath(item && (item.path || item.filePath));
    if (n) libraryNorms.add(n);
  });
  const favoriteNorms = new Set();
  (db.favorites || []).forEach((item) => {
    const n = normalizePath(item && (item.path || item.filePath));
    if (n) favoriteNorms.add(n);
  });

  const removed = [];
  const skipped = [];
  const missingPaths = [];
  const returnedPaths = [];
  const coversFreedPaths = [];
  let purgedFromRecent = 0;
  let keptWithWarning = 0;
  let coverFilesDeleted = 0;
  let coverBytesFreed = 0;
  let changed = false;
  // نرم‌هایِ حذف‌شده از SQLite (در یک تراکنشِ واحد، پس از حلقه).
  const sqliteDeleteNorms = [];

  const setMissingFlag = (list, norm, value) => {
    (list || []).forEach((item) => {
      if (normalizePath(item && (item.path || item.filePath)) !== norm) return;
      if (item.isMissing === value) return;
      if (!dryRun) item.isMissing = value;
      changed = true;
    });
  };

  for (const [norm, rawPath] of candidates.entries()) {
    const probePath = rawPath || norm;
    if (!probePath || !path.isAbsolute(probePath)) {
      skipped.push({ path: probePath, reason: 'non-absolute' });
      continue;
    }
    let exists = false;
    try { exists = fs.existsSync(probePath); } catch (_) { exists = false; }
    if (exists) {
      // فایل برگشته است: پرچمِ هشدار برداشته می‌شود.
      const wasMissing =
        (db.library || []).some((it) => normalizePath(it.path || it.filePath) === norm && it.isMissing === true) ||
        (db.favorites || []).some((it) => normalizePath(it.path || it.filePath) === norm && it.isMissing === true);
      if (wasMissing) {
        returnedPaths.push(probePath);
        setMissingFlag(db.library, norm, false);
        setMissingFlag(db.favorites, norm, false);
      }
      continue;
    }
    if (!driveRootExists(probePath)) {
      skipped.push({ path: probePath, reason: 'drive-offline' });
      continue;
    }
    // فایل، واقعاً رفته است.
    missingPaths.push(probePath);
    const inLibrary = libraryNorms.has(norm);
    const inFavorites = favoriteNorms.has(norm);
    const inSlider = sliderNorms.has(norm);
    const hadHistory = Boolean(db.history && db.history[norm]);
    if (hadHistory) purgedFromRecent += 1;
    if (inLibrary || inFavorites) keptWithWarning += 1;

    if (dryRun) {
      if (!inLibrary && !inFavorites && !inSlider) {
        const coverRes = statCoverFilesForNorm(db, norm);
        coverFilesDeleted += coverRes.deleted;
        coverBytesFreed += coverRes.freedBytes;
        coversFreedPaths.push(norm);
      }
      removed.push({ path: probePath, name: path.basename(probePath) });
      continue;
    }

    // (الف) پاک‌سازیِ کامل از Recent/history + بوک‌مارک + حاشیه‌نویسی
    // + هایلایتِ EPUB + کشِ متنِ EPUB — آینهٔ JSON.
    if (db.history && db.history[norm]) delete db.history[norm];
    if (db.bookmarks && db.bookmarks[norm]) delete db.bookmarks[norm];
    if (db.annotations && db.annotations[norm]) delete db.annotations[norm];
    if (db.epubHighlights && db.epubHighlights[norm]) delete db.epubHighlights[norm];
    if (db.epubTextCache && db.epubTextCache[norm]) delete db.epubTextCache[norm];
    // (ب) همان حذف‌ها در SQLite (در یک تراکنشِ واحد، پس از حلقه).
    if (sqliteReady) sqliteDeleteNorms.push(norm);
    changed = true;

    // (پ) پرچمِ هشدار رویِ ردیف‌هایِ نگه‌داشته‌شدهٔ کتابخانه و
    // علاقه‌مندی‌ها (حذف نمی‌شوند).
    if (inLibrary) setMissingFlag(db.library, norm, true);
    if (inFavorites) setMissingFlag(db.favorites, norm, true);

    // (ت) کاور فقط وقتی آزاد می‌شود که فایل در هیچ‌کدام از
    // library/favorites/customSliderBookPaths نباشد.
    if (!inLibrary && !inFavorites && !inSlider) {
      const coverRes = deleteCoverFilesForNorm(db, norm);
      coverFilesDeleted += coverRes.deleted;
      coverBytesFreed += coverRes.freedBytes;
      if (db.coverCache) delete db.coverCache[norm];
      coversFreedPaths.push(norm);
    }
    removed.push({ path: probePath, name: path.basename(probePath) });
  }

  if (!dryRun && sqliteReady && sqliteDeleteNorms.length > 0 && sqliteDb) {
    try {
      const run = sqliteDb.transaction(() => {
        for (const norm of sqliteDeleteNorms) {
          try { if (sqliteStmts.deleteHistory) sqliteStmts.deleteHistory.run(norm); } catch (_) {}
          try { if (sqliteStmts.deleteAnnotationsForFile) sqliteStmts.deleteAnnotationsForFile.run(norm); } catch (_) {}
          try { if (sqliteStmts.deleteBookmarksForFile) sqliteStmts.deleteBookmarksForFile.run(norm); } catch (_) {}
          try { if (sqliteStmts.deleteHighlightsForFile) sqliteStmts.deleteHighlightsForFile.run(norm); } catch (_) {}
          try { if (sqliteStmts.deleteTextCacheForFile) sqliteStmts.deleteTextCacheForFile.run(norm); } catch (_) {}
        }
      });
      run();
    } catch (_) {}
  }

  if (!dryRun && changed) {
    try { sweepOrphanCoverFiles(db); } catch (_) {}
    writeDB(db);
  }
  return {
    checked: candidates.size,
    purgedFromRecent,
    keptWithWarning,
    coversFreed: coverFilesDeleted,
    missingPaths,
    returnedPaths,
    coversFreedPaths,
    removed,
    skipped,
    removedCount: removed.length,
    skippedCount: skipped.length,
    coverFilesDeleted,
    coverBytesFreed,
  };
}

// سازگاریِ قدیمی: هرسِ مرحلهٔ ۱۰ حالا همان همگام‌سازیِ امنِ
// مرحلهٔ ۵۲ §۱ است (کتاب از کتابخانه/علاقه‌مندی‌ها حذف نمی‌شود).
function pruneMissingFiles(db, dryRun = false) {
  return syncMissingFiles(db, dryRun);
}


// مرحله ۱۳: بوک‌مارک‌هایِ دیجیتال و تفکیکِ پاک‌سازیِ کاورها.
// توجه: BOOKMARK_TEMPLATE_IDS بالاتر، پیش از migrateSchema تعریف شده
// است؛ چون initDB()/readDB() در انتهایِ ماژول، پیش از رسیدن به این
// نقطه اجرا می‌شوند و ارجاعِ زودهنگام به const، خطایِ TDZ می‌داد.

function sanitizeBookmarkRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const page = Number(raw.page);
  if (!Number.isFinite(page) || page < 1) return null;
  const yRaw = Number(raw.yRatio);
  const yRatio = Number.isFinite(yRaw) ? Math.max(0, Math.min(0.92, yRaw)) : 0;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : ('bm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)),
    page: Math.floor(page),
    yRatio,
    side: raw.side === 'left' ? 'left' : 'right',
    template: BOOKMARK_TEMPLATE_IDS.includes(raw.template) ? raw.template : 'MARGIN',
    image: typeof raw.image === 'string' ? raw.image : null,
    focalPoint: raw.focalPoint === 'top' || raw.focalPoint === 'bottom' ? raw.focalPoint : 'center',
    name: typeof raw.name === 'string' ? raw.name.slice(0, 60) : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}

// مرحله ۱۴: «ساختِ کاربر» (پریستِ سفارشی) — ترکیبِ تمپلیت +
// تصویر + نام که در همهٔ کتاب‌ها در دسترس است. اعتبارسنجی،
// همان قوانینِ بوک‌مارک را دارد؛ تمپلیتِ ناشناخته به MARGIN
// برمی‌گردد و سقفِ ۱۰۰ پریست، جلوی رشدِ بی‌نهایت را می‌گیرد.
function sanitizeBookmarkPreset(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : ('preset_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)),
    name: typeof raw.name === 'string' ? raw.name.slice(0, 60) : '',
    template: BOOKMARK_TEMPLATE_IDS.includes(raw.template) ? raw.template : 'MARGIN',
    image: typeof raw.image === 'string' ? raw.image : null,
    focalPoint: raw.focalPoint === 'top' || raw.focalPoint === 'bottom' ? raw.focalPoint : 'center',
    side: raw.side === 'left' ? 'left' : 'right',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}

// فایل‌هایِ کاوری که باید بمانند (فقط کاورهایِ سفارشیِ کاربر):
// ورودی‌هایِ coverCache با isCustom + کاورِ همان کتاب‌ها در
// سه جدول. همین مجموعه، هم در پاک‌سازی و هم در آمارِ پیش‌نمایش
// استفاده می‌شود تا عددِ «حذف می‌شود» با عملِ واقعی یکی باشد.
function collectKeptCoverFiles(db) {
  const keptFiles = new Set();
  const customNorms = new Set();
  const preservedCache = {};
  Object.entries(db.coverCache || {}).forEach(([normKey, entry]) => {
    if (entry && entry.isCustom) {
      customNorms.add(normKey);
      preservedCache[normKey] = entry;
      const f = coverFileFromUrl(coverEntryToUrl(entry));
      if (f) keptFiles.add(f);
      if (entry && typeof entry.file === 'string' && entry.file) keptFiles.add(entry.file);
    }
  });
  const addTableCover = (entry, rawPath) => {
    if (!entry) return;
    const norm = normalizePath(rawPath);
    if (norm && customNorms.has(norm)) {
      const f = coverFileFromUrl(entry.cover);
      if (f) keptFiles.add(f);
    }
  };
  Object.values(db.history || {}).forEach((h) => addTableCover(h, h && (h.filePath || h.path)));
  (db.library || []).forEach((item) => addTableCover(item, item && (item.path || item.filePath)));
  (db.favorites || []).forEach((item) => addTableCover(item, item && (item.path || item.filePath)));
  return { keptFiles, customNorms, preservedCache };
}

// مرحله ۱۳: پاک‌سازیِ فقط کاورها (بدونِ دست‌زدن به هیچ کشِ
// دیگری). preserveCustom=true همان رفتارِ قدیمیِ CLEAR_ALL_COVERS
// است؛ false یعنی کاورهایِ سفارشی هم پاک می‌شوند.
function clearOnlyCovers(db, preserveCustom = true) {
  let clearedFiles = 0;
  let freedBytes = 0;
  let keptCustom = 0;
  let keptFiles = new Set();
  let preservedCache = {};
  let customNorms = new Set();
  if (preserveCustom) {
    const kept = collectKeptCoverFiles(db);
    keptFiles = kept.keptFiles;
    preservedCache = kept.preservedCache;
    customNorms = kept.customNorms;
    keptCustom = customNorms.size;
  }
  const nullCoverUnlessCustom = (entry, rawPath) => {
    if (!entry) return;
    if (preserveCustom) {
      const norm = normalizePath(rawPath);
      if (norm && customNorms.has(norm)) return;
    }
    entry.cover = null;
  };
  Object.values(db.history || {}).forEach((h) => nullCoverUnlessCustom(h, h && (h.filePath || h.path)));
  (db.library || []).forEach((item) => nullCoverUnlessCustom(item, item && (item.path || item.filePath)));
  (db.favorites || []).forEach((item) => nullCoverUnlessCustom(item, item && (item.path || item.filePath)));
  db.coverCache = preservedCache;
  try {
    if (fs.existsSync(COVERS_DIR)) {
      fs.readdirSync(COVERS_DIR).forEach((name) => {
        if (keptFiles.has(name)) return;
        const full = path.join(COVERS_DIR, name);
        try {
          const st = fs.statSync(full);
          if (st.isFile()) {
            fs.unlinkSync(full);
            clearedFiles += 1;
            freedBytes += st.size;
          }
        } catch (_) {}
      });
    }
  } catch (_) {}
  writeDB(db);
  return { clearedFiles, freedBytes, keptCustom, coverCacheCleared: true };
}

// نسخهٔ فقط-خواندنیِ deleteCoverFilesForNorm برایِ پیش‌نمایشِ
// هرس: همان فایل‌ها شمرده می‌شوند، ولی هیچ فایلی پاک نمی‌شود.
function statCoverFilesForNorm(db, normPath) {
  let deleted = 0;
  let freedBytes = 0;
  try {
    const prefix = coverHashPrefixFor(normPath);
    const entryFile = db.coverCache && db.coverCache[normPath] ? coverFileFromUrl(coverEntryToUrl(db.coverCache[normPath])) : null;
    if (!fs.existsSync(COVERS_DIR)) return { deleted: 0, freedBytes: 0 };
    const names = fs.readdirSync(COVERS_DIR);
    for (const name of names) {
      const isPrefixed = prefix && name.startsWith(prefix);
      const isEntryFile = entryFile && name === entryFile;
      if (!isPrefixed && !isEntryFile) continue;
      const full = path.join(COVERS_DIR, name);
      try {
        const st = fs.statSync(full);
        if (st.isFile()) { deleted += 1; freedBytes += st.size; }
      } catch (_) {}
    }
  } catch (_) {}
  return { deleted, freedBytes };
}

// آمارِ دقیقِ کاورها برایِ مودالِ تأیید: مجموع و سهمِ سفارشی.
function getCoverStats(db) {
  const { keptFiles } = collectKeptCoverFiles(db);
  let totalFiles = 0;
  let totalBytes = 0;
  let customFiles = 0;
  let customBytes = 0;
  try {
    if (fs.existsSync(COVERS_DIR)) {
      fs.readdirSync(COVERS_DIR).forEach((name) => {
        const full = path.join(COVERS_DIR, name);
        try {
          const st = fs.statSync(full);
          if (!st.isFile()) return;
          totalFiles += 1;
          totalBytes += st.size;
          if (keptFiles.has(name)) { customFiles += 1; customBytes += st.size; }
        } catch (_) {}
      });
    }
  } catch (_) {}
  return { totalFiles, totalBytes, customFiles, customBytes, coverCacheEntries: Object.keys(db.coverCache || {}).length };
}

// مرحله ۱۳: clearAllCovers با clearOnlyCovers(db, true) جایگزین شد (رفتارِ یکسان).


// ============================================================================
// مرحلهٔ ۴۰ §۱ — موتورِ SQLite (better-sqlite3 + WAL) با Fallbackِ JSON.
//
// طراحی:
// - اگر better-sqlite3 نصب و بارگذاری شد، دیتابیسِ رابطه‌ای در
//   <dataDir>/library.sqlite باز می‌شود (WAL + synchronous=NORMAL).
// - اگر نصب نشده یا باز شدن ناموفق بود، ورکر بدونِ کرش رویِ همان
//   موتورِ db.json کار می‌کند (sqliteReady=false)؛ برنامه در هیچ
//   شرایطی متوقف نمی‌شود.
// - اکشن‌هایِ داغ (پیشرفت، حاشیه‌نویسی، بوک‌مارک، آمارِ مطالعه،
//   هایلایتِ EPUB، تنظیماتِ بوک‌مارک/رنگ/آماربندی) از SQLite پاسخ
//   می‌گیرند و هم‌زمان آینهٔ درون‌حافظه‌ایِ db.json را هم به‌روز
//   می‌کنند تا FLUSH_SYNC هنگامِ خروج، یک عکسِ تازه از db.json
//   بنویسد و مسیرِ JSON (کتابخانه، کاورها، بکاپ) بی‌تغییر
//   بماند. اکشن‌هایِ دیگر (کتابخانه، کاور، بکاپ، پروفایل) رویِ
//   همان مسیرِ JSON می‌مانند.
// - مهاجرت، یک‌باره و اتمیک است: اگر کلیدِ migration_from_json_v1_done
//   در kv_store نبود و db.json رویِ دیسک بود، همهٔ داده‌ها در یک
//   تراکنشِ واحد منتقل می‌شوند و پیش از آن، یک کپیِ پشتیبان
//   db.json.migrated.bak ساخته می‌شود.
// ============================================================================

const SQLITE_ROUTED_ACTIONS = new Set([
  'SAVE_PROGRESS',
  'GET_PROGRESS',
  'RECORD_READING_ACTIVITY',
  'RECORD_APP_ACTIVITY',
  'GET_READING_STATS',
  'GET_RECENTS',
  'REMOVE_FROM_RECENTS',
  'CLEAR_RECENTS',
  'GET_ANNOTATIONS',
  'SAVE_ANNOTATIONS',
  'CLEAR_ANNOTATIONS',
  'GET_ANNOTATION_COUNTS',
  'GET_ANNOTATION_TOTALS',
  'GET_BOOKMARKS',
  'SAVE_BOOKMARKS',
  'GET_ALL_BOOKMARKS',
  'GET_EPUB_HIGHLIGHTS',
  'SAVE_EPUB_HIGHLIGHTS',
  'GET_CUSTOM_STAT_VIEWS',
  'SAVE_CUSTOM_STAT_VIEWS',
  'GET_BOOKMARK_PREFERENCES',
  'SAVE_BOOKMARK_PREFERENCES',
  'GET_CUSTOM_COLOR_SYSTEM',
  'SAVE_CUSTOM_COLOR_SYSTEM',
  'GET_EPUB_CHAPTER_TEXT',
  'SAVE_EPUB_CHAPTER_TEXT',
  // مرحلهٔ ۴۴ §۵ (OPT-06): تنظیماتِ عمومی هم از SQLite می‌خوانند و می‌نویسند.
  'SAVE_SETTING',
  'GET_SETTINGS',
]);

// آینه را «کثیف» علامت بزن تا FLUSH_SYNC هنگامِ خروج، عکسِ تازهٔ
// db.json را بنویسد. عمداً writeDB صدا نمی‌شود تا نوشتنِ
// debounceدارِ ۹۰۰ میلی‌ثانیه‌ای، مزیتِ SQLite (عدمِ بازنویسیِ کلِ
// فایل در هر تغییر) را خنثی نکند.
function sqliteTouchMirror() {
  dbDirty = true;
}

// خواندنِ یک مقدارِ متنی از kv_store؛ در صورتِ نبودن یا خطا، null.
function sqliteGetKv(key) {
  if (!sqliteDb || !sqliteStmts.getKv) return null;
  try {
    const row = sqliteStmts.getKv.get(key);
    return row ? row.value_json : null;
  } catch (_) {
    return null;
  }
}

// نوشتنِ یک مقدارِ متنی در kv_store (همراه با زمانِ به‌روزرسانی).
function sqliteSetKv(key, value) {
  sqliteStmts.setKv.run(key, value, Date.now());
}

// شمارشِ ردیف‌هایِ هر جدول، برایِ GET_DATABASE_INFO.
function sqliteGetCounts() {
  const countOf = (stmt) => {
    try {
      const row = stmt.get();
      return row ? Number(row.n) || 0 : 0;
    } catch (_) {
      return 0;
    }
  };
  return {
    history: countOf(sqliteStmts.countHistory),
    annotations: countOf(sqliteStmts.countAnnotations),
    bookmarks: countOf(sqliteStmts.countBookmarks),
    readingDays: countOf(sqliteStmts.countDays),
    byBook: countOf(sqliteStmts.countByBook),
    textCache: countOf(sqliteStmts.countTextCache),
  };
}

// تبدیلِ ردیفِ history به همان شیءِ ورودیِ تاریخچهٔ JSON.
// extra_json، مرجعِ کامل است؛ اگر خراب بود، از ستون‌ها بازسازی می‌شود.
function sqliteHistoryRowToEntry(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.extra_json || 'null');
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) {}
  return {
    filePath: row.path || '',
    normPath: row.file_key,
    fileName: row.name || '',
    cover: row.cover || null,
    currentPage: Number(row.current_page) || 1,
    totalPages: Number(row.total_pages) || 1,
    percentage: Number(row.progress) || 0,
    updatedAt: row.last_read ? new Date(row.last_read).toISOString() : null,
    // مرحله ۴۷ §۲: وضعیتِ پین از ستونِ history خوانده می‌شود تا
    // بازسازیِ آینه از SQLite، آن را صفر نکند.
    pinned: Number(row.pinned) || 0,
  };
}

// تبدیلِ ردیفِ bookmarks به رکوردِ بوک‌مارکِ پاک‌سازی‌شده.
// extra_json، مرجعِ کامل است؛ اگر خراب بود، از ستون‌ها بازسازی می‌شود.
function sqliteBookmarkRowToRecord(row) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.extra_json || 'null');
    if (parsed && typeof parsed === 'object') {
      const clean = sanitizeBookmarkRecord(parsed);
      if (clean) return clean;
    }
  } catch (_) {}
  const fallback = {
    id: row.id,
    page: Number(row.page_num) || 1,
    yRatio: Number(row.y_ratio) || 0,
    side: 'right',
    template: row.template_id || 'MARGIN',
    image: null,
    focalPoint: 'center',
    name: row.label || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
  return sanitizeBookmarkRecord(fallback);
}

// پاک‌سازیِ آماربندی‌هایِ سفارشی — دقیقاً همان منطقِ کیسِ JSONِ
// SAVE_CUSTOM_STAT_VIEWS (تکثیرِ عمدی؛ کیسِ JSON دست‌نخورده می‌ماند).
function sqliteCleanStatViews(views) {
  if (!Array.isArray(views)) return null;
  return views
    .slice(0, 50)
    .filter((v) => v && typeof v === 'object' && typeof v.name === 'string' && v.name.trim())
    .map((v) => ({
      id: String(v.id || `cv-${Date.now()}`),
      name: String(v.name).slice(0, 60),
      color: typeof v.color === 'string' ? v.color : '#22d3ee',
      bookKeys: Array.isArray(v.bookKeys) ? v.bookKeys.filter((k) => typeof k === 'string').slice(0, 500) : [],
      metrics: Array.isArray(v.metrics) ? v.metrics.filter((m) => typeof m === 'string').slice(0, 10) : [],
      goalHours: Math.max(0, Number(v.goalHours) || 0),
      goalPages: Math.max(0, Number(v.goalPages) || 0),
    }));
}

// پاک‌سازیِ هایلایت‌هایِ EPUB — دقیقاً همان منطقِ کیسِ JSONِ
// SAVE_EPUB_HIGHLIGHTS (تکثیرِ عمدی؛ کیسِ JSON دست‌نخورده می‌ماند).
function sqliteCleanEpubHighlights(highlights) {
  if (!Array.isArray(highlights)) return null;
  return highlights
    .slice(0, 5000)
    .filter((h) => h && typeof h === 'object' && Number.isFinite(Number(h.chapterIndex)))
    .map((h) => ({
      id: String(h.id || ''),
      chapterIndex: Math.floor(Number(h.chapterIndex)),
      color: typeof h.color === 'string' ? h.color : '#facc15',
      text: String(h.text || '').slice(0, 2000),
      note: String(h.note || '').slice(0, 2000),
      startOffset: Math.max(0, Math.floor(Number(h.startOffset) || 0)),
      endOffset: Math.max(0, Math.floor(Number(h.endOffset) || 0)),
      createdAt: Number(h.createdAt) || Date.now(),
    }));
}

// پاک‌سازیِ تنظیماتِ بوک‌مارک — دقیقاً همان منطقِ کیسِ JSONِ
// SAVE_BOOKMARK_PREFERENCES (تکثیرِ عمدی؛ کیسِ JSON دست‌نخورده می‌ماند).
// prev، تنظیماتِ قبلیِ آینه است و برایِ حفظِ savedPresets در ذخیرهٔ
// جزئی استفاده می‌شود.
function sqliteCleanBookmarkPreferences(preferences, prev) {
  const prefs = (preferences && typeof preferences === 'object') ? preferences : {};
  const next = { ...defaultDB.bookmarkPreferences, templateImages: {} };
  if (BOOKMARK_TEMPLATE_IDS.includes(prefs.defaultTemplate)) next.defaultTemplate = prefs.defaultTemplate;
  if (typeof prefs.globalImage === 'string') next.globalImage = prefs.globalImage;
  else if (prefs.globalImage === null) next.globalImage = null;
  if (prefs.templateImages && typeof prefs.templateImages === 'object') {
    Object.entries(prefs.templateImages).forEach(([id, url]) => {
      if (BOOKMARK_TEMPLATE_IDS.includes(id) && typeof url === 'string' && url) next.templateImages[id] = url;
    });
  }
  if (prefs.defaultSide === 'left' || prefs.defaultSide === 'right') next.defaultSide = prefs.defaultSide;
  if (Array.isArray(prefs.savedPresets)) {
    next.savedPresets = [];
    prefs.savedPresets.forEach((p) => {
      const clean = sanitizeBookmarkPreset(p);
      if (clean && next.savedPresets.length < 100) next.savedPresets.push(clean);
    });
  } else if (prev && Array.isArray(prev.savedPresets)) {
    next.savedPresets = prev.savedPresets;
  }
  return next;
}

// پاک‌سازیِ سیستمِ رنگِ سفارشی — دقیقاً همان منطقِ کیسِ JSONِ
// SAVE_CUSTOM_COLOR_SYSTEM (تکثیرِ عمدی؛ کیسِ JSON دست‌نخورده می‌ماند).
function sqliteCleanColorSystem(customColorSystem) {
  const src = (customColorSystem && typeof customColorSystem === 'object') ? customColorSystem : {};
  const next = { favoriteColors: [], customColorTemplates: [], toolColors: {} };
  if (Array.isArray(src.favoriteColors)) {
    src.favoriteColors.forEach((c) => {
      if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) && next.favoriteColors.length < 48) next.favoriteColors.push(c);
    });
  }
  if (Array.isArray(src.customColorTemplates)) {
    src.customColorTemplates.forEach((t) => {
      if (!t || typeof t !== 'object' || typeof t.id !== 'string' || typeof t.name !== 'string' || !Array.isArray(t.colors)) return;
      if (next.customColorTemplates.length >= 24) return;
      next.customColorTemplates.push({
        id: t.id,
        name: String(t.name).slice(0, 40),
        colors: t.colors.filter((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 12),
      });
    });
  }
  if (src.toolColors && typeof src.toolColors === 'object') {
    for (const k of ['pen', 'highlighter', 'box', 'arrow', 'text', 'sticky']) {
      if (typeof src.toolColors[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.toolColors[k])) next.toolColors[k] = src.toolColors[k];
    }
  }
  return next;
}

// راه‌اندازیِ موتورِ SQLite: باز کردنِ فایل، تنظیمِ PRAGMAها، ساختِ
// جداول و ایندکس‌ها، آماده‌سازیِ Prepared Statementها، مهاجرتِ
// یک‌باره از db.json و همگام‌سازیِ آینهٔ درون‌حافظه‌ای. هر خطایی،
// فقط موتور را به JSON برمی‌گرداند؛ هیچ‌وقت ورکر را کرش نمی‌کند.
function initSQLite() {
  if (!BetterSqlite3) {
    console.info('[database] better-sqlite3 نصب نشده است؛ موتورِ JSON فعال است. راهنما: SQLITE_MIGRATION_GUIDE.md');
    return false;
  }
  try {
    sqliteDb = new BetterSqlite3(SQLITE_FILE);
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('synchronous = NORMAL');
    sqliteDb.pragma('temp_store = MEMORY');
    sqliteDb.pragma('cache_size = -16000');
    sqliteDb.pragma('foreign_keys = ON');
    sqliteDb.exec(`
CREATE TABLE IF NOT EXISTS history (
  file_key TEXT PRIMARY KEY,
  name TEXT,
  path TEXT,
  type TEXT,
  current_page INTEGER,
  total_pages INTEGER,
  progress REAL,
  cover TEXT,
  last_read INTEGER,
  pinned INTEGER,
  favorite INTEGER,
  extra_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_history_last_read ON history (last_read DESC);
CREATE TABLE IF NOT EXISTS annotations (
  file_key TEXT,
  page_num TEXT,
  items_json TEXT,
  updated_at INTEGER,
  PRIMARY KEY (file_key, page_num)
);
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  file_key TEXT,
  page_num INTEGER,
  y_ratio REAL,
  label TEXT,
  color TEXT,
  template_id TEXT,
  created_at INTEGER,
  extra_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_file ON bookmarks (file_key);
CREATE TABLE IF NOT EXISTS epub_highlights (
  file_key TEXT PRIMARY KEY,
  highlights_json TEXT,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS epub_text_cache (
  file_key TEXT,
  chapter_index INTEGER,
  mtime INTEGER,
  plain_text TEXT,
  PRIMARY KEY (file_key, chapter_index)
);
CREATE TABLE IF NOT EXISTS reading_days (
  date_key TEXT PRIMARY KEY,
  pages INTEGER,
  seconds INTEGER,
  app_seconds INTEGER
);
CREATE TABLE IF NOT EXISTS reading_by_book (
  file_key TEXT PRIMARY KEY,
  total_seconds INTEGER,
  total_pages INTEGER,
  days_json TEXT
);
CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value_json TEXT,
  updated_at INTEGER
);
`);
    sqliteStmts = {
      upsertHistory: sqliteDb.prepare('INSERT OR REPLACE INTO history (file_key, name, path, type, current_page, total_pages, progress, cover, last_read, pinned, favorite, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      updateHistoryPinned: sqliteDb.prepare('UPDATE history SET pinned = ? WHERE file_key = ?'),
      getHistory: sqliteDb.prepare('SELECT * FROM history WHERE file_key = ?'),
      deleteHistory: sqliteDb.prepare('DELETE FROM history WHERE file_key = ?'),
      clearHistory: sqliteDb.prepare('DELETE FROM history'),
      listHistoryRecent: sqliteDb.prepare('SELECT * FROM history ORDER BY last_read DESC LIMIT 500'),
      listAllHistory: sqliteDb.prepare('SELECT * FROM history'),
      countHistory: sqliteDb.prepare('SELECT COUNT(*) AS n FROM history'),
      upsertAnnotation: sqliteDb.prepare('INSERT OR REPLACE INTO annotations (file_key, page_num, items_json, updated_at) VALUES (?, ?, ?, ?)'),
      getAnnotationPage: sqliteDb.prepare('SELECT items_json FROM annotations WHERE file_key = ? AND page_num = ?'),
      listAnnotationsForFile: sqliteDb.prepare('SELECT page_num, items_json FROM annotations WHERE file_key = ?'),
      listAllAnnotations: sqliteDb.prepare('SELECT file_key, page_num, items_json FROM annotations'),
      deleteAnnotationPage: sqliteDb.prepare('DELETE FROM annotations WHERE file_key = ? AND page_num = ?'),
      deleteAnnotationsForFile: sqliteDb.prepare('DELETE FROM annotations WHERE file_key = ?'),
      countAnnotations: sqliteDb.prepare('SELECT COUNT(*) AS n FROM annotations'),
      upsertBookmark: sqliteDb.prepare('INSERT OR REPLACE INTO bookmarks (id, file_key, page_num, y_ratio, label, color, template_id, created_at, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      deleteBookmarksForFile: sqliteDb.prepare('DELETE FROM bookmarks WHERE file_key = ?'),
      listBookmarksForFile: sqliteDb.prepare('SELECT * FROM bookmarks WHERE file_key = ?'),
      listAllBookmarks: sqliteDb.prepare('SELECT * FROM bookmarks ORDER BY file_key'),
      countBookmarks: sqliteDb.prepare('SELECT COUNT(*) AS n FROM bookmarks'),
      upsertHighlights: sqliteDb.prepare('INSERT OR REPLACE INTO epub_highlights (file_key, highlights_json, updated_at) VALUES (?, ?, ?)'),
      getHighlights: sqliteDb.prepare('SELECT highlights_json FROM epub_highlights WHERE file_key = ?'),
      listAllHighlights: sqliteDb.prepare('SELECT file_key, highlights_json FROM epub_highlights'),
      upsertDay: sqliteDb.prepare('INSERT OR REPLACE INTO reading_days (date_key, pages, seconds, app_seconds) VALUES (?, ?, ?, ?)'),
      getDay: sqliteDb.prepare('SELECT * FROM reading_days WHERE date_key = ?'),
      listDays: sqliteDb.prepare('SELECT * FROM reading_days ORDER BY date_key'),
      deleteDay: sqliteDb.prepare('DELETE FROM reading_days WHERE date_key = ?'),
      countDays: sqliteDb.prepare('SELECT COUNT(*) AS n FROM reading_days'),
      upsertByBook: sqliteDb.prepare('INSERT OR REPLACE INTO reading_by_book (file_key, total_seconds, total_pages, days_json) VALUES (?, ?, ?, ?)'),
      getByBook: sqliteDb.prepare('SELECT * FROM reading_by_book WHERE file_key = ?'),
      listByBook: sqliteDb.prepare('SELECT * FROM reading_by_book'),
      countByBook: sqliteDb.prepare('SELECT COUNT(*) AS n FROM reading_by_book'),
      getKv: sqliteDb.prepare('SELECT value_json FROM kv_store WHERE key = ?'),
      setKv: sqliteDb.prepare('INSERT OR REPLACE INTO kv_store (key, value_json, updated_at) VALUES (?, ?, ?)'),
      listSettingKv: sqliteDb.prepare("SELECT key, value_json FROM kv_store WHERE key LIKE 'setting:%'"),
      upsertChapterText: sqliteDb.prepare('INSERT OR REPLACE INTO epub_text_cache (file_key, chapter_index, mtime, plain_text) VALUES (?, ?, ?, ?)'),
      getChapterText: sqliteDb.prepare('SELECT mtime, plain_text FROM epub_text_cache WHERE file_key = ? AND chapter_index = ?'),
      countTextCache: sqliteDb.prepare('SELECT COUNT(*) AS n FROM epub_text_cache'),
      // مرحلهٔ ۵۲ §۱: حذف‌هایِ دسته‌ایِ همگام‌سازیِ فایل‌هایِ رفته.
      deleteHighlightsForFile: sqliteDb.prepare('DELETE FROM epub_highlights WHERE file_key = ?'),
      deleteTextCacheForFile: sqliteDb.prepare('DELETE FROM epub_text_cache WHERE file_key = ?'),
      listTextCacheKeys: sqliteDb.prepare('SELECT DISTINCT file_key FROM epub_text_cache'),
    };
    const alreadyMigrated = sqliteGetKv(SQLITE_MIGRATION_KEY) === '1';
    if (!alreadyMigrated && fs.existsSync(DB_FILE)) {
      migrateJsonToSqlite(cachedDbInstance || readDB());
    }
    sqliteReady = true;
    resyncMirrorFromSqlite(cachedDbInstance || readDB());
    console.info('[database] SQLite (WAL) فعال شد: ' + SQLITE_FILE);
    return true;
  } catch (err) {
    console.warn('[database] راه‌اندازیِ SQLite ناموفق بود؛ موتورِ JSON فعال است:', err && err.message);
    try { if (sqliteDb) sqliteDb.close(); } catch (_) {}
    sqliteDb = null;
    sqliteReady = false;
    sqliteStmts = {};
    return false;
  }
}

// مهاجرتِ یک‌باره و اتمیک از db.json به library.sqlite. پیش از هر
// تغییری، یک کپیِ پشتیبان db.json.migrated.bak ساخته می‌شود (فقط اگر
// از قبل نبود). اگر تراکنش در میانه شکست بخورد، همه‌چیز به عقب
// برمی‌گردد و موتورِ JSON ادامه می‌دهد.
function migrateJsonToSqlite(jsonDb) {
  try {
    if (!fs.existsSync(SQLITE_MIGRATED_BAK)) fs.copyFileSync(DB_FILE, SQLITE_MIGRATED_BAK);
  } catch (_) {}
  const src = (jsonDb && typeof jsonDb === 'object') ? jsonDb : {};
  // مرحله ۴۷ §۲: وضعیتِ پینِ کتابخانه، مرجعِ ستونِ pinned در مهاجرت
  // است؛ پیش از این، همهٔ ردیف‌ها با ۰ نوشته می‌شدند.
  const pinnedPaths = new Set();
  for (const item of Array.isArray(src.library) ? src.library : []) {
    if (item?.isPinned) {
      const n = normalizePath(item.path || item.filePath);
      if (n) pinnedPaths.add(n);
    }
  }
  const run = sqliteDb.transaction(() => {
    for (const [norm, h] of Object.entries(src.history || {})) {
      if (!h || typeof h !== 'object') continue;
      sqliteStmts.upsertHistory.run(
        norm,
        typeof h.fileName === 'string' ? h.fileName : '',
        typeof h.filePath === 'string' ? h.filePath : '',
        typeof h.type === 'string' ? h.type : '',
        Number(h.currentPage) || 1,
        Number(h.totalPages) || 1,
        Number(h.percentage) || 0,
        typeof h.cover === 'string' ? h.cover : null,
        Date.parse(h.updatedAt) || 0,
        pinnedPaths.has(norm) ? 1 : 0,
        0,
        JSON.stringify(h)
      );
    }
    for (const [norm, pages] of Object.entries(src.annotations || {})) {
      if (!pages || typeof pages !== 'object') continue;
      for (const [pageKey, items] of Object.entries(pages)) {
        if (!Array.isArray(items)) continue;
        sqliteStmts.upsertAnnotation.run(norm, String(pageKey), JSON.stringify(items), Date.now());
      }
    }
    for (const [norm, list] of Object.entries(src.bookmarks || {})) {
      if (!Array.isArray(list)) continue;
      for (const bm of list) {
        const clean = sanitizeBookmarkRecord(bm);
        if (!clean) continue;
        sqliteStmts.upsertBookmark.run(
          clean.id,
          norm,
          clean.page,
          clean.yRatio,
          clean.name || '',
          '',
          clean.template,
          Date.parse(clean.createdAt) || 0,
          JSON.stringify(clean)
        );
      }
    }
    for (const [norm, list] of Object.entries(src.epubHighlights || {})) {
      if (!Array.isArray(list)) continue;
      sqliteStmts.upsertHighlights.run(norm, JSON.stringify(list), Date.now());
    }
    const days = (src.readingStats && src.readingStats.days) || {};
    for (const [dateKey, d] of Object.entries(days)) {
      if (!d || typeof d !== 'object') continue;
      sqliteStmts.upsertDay.run(dateKey, Number(d.pages) || 0, Number(d.seconds) || 0, Number(d.appSeconds) || 0);
    }
    const byBook = (src.readingStats && src.readingStats.byBook) || {};
    for (const [norm, b] of Object.entries(byBook)) {
      if (!b || typeof b !== 'object') continue;
      sqliteStmts.upsertByBook.run(norm, Number(b.totalSeconds) || 0, Number(b.totalPages) || 0, JSON.stringify(b.days || {}));
    }
    sqliteSetKv('bookmarkPreferences', JSON.stringify(src.bookmarkPreferences || defaultDB.bookmarkPreferences));
    sqliteSetKv('customStatViews', JSON.stringify(Array.isArray(src.customStatViews) ? src.customStatViews : []));
    sqliteSetKv('customColorSystem', JSON.stringify(src.customColorSystem || defaultDB.customColorSystem));
    sqliteSetKv('readingTotalAppSeconds', String(Number(src.readingStats && src.readingStats.totalAppSeconds) || 0));
    sqliteSetKv(SQLITE_MIGRATION_KEY, '1');
  });
  run();
}

// همگام‌سازیِ آینهٔ درون‌حافظه‌ایِ db.json از رویِ SQLite، در هر
// راه‌اندازی. این کار، آینه را پس از یک خاموشیِ ناگهانی (که در آن
// db.json عقب مانده) دوباره تازه می‌کند؛ بخش‌هایِ JSON-محور
// (کتابخانه، کاورها، پروفایل، تنظیمات) دست نمی‌خورند. خطا در این
// همگام‌سازی، موتور را متوقف نمی‌کند چون SQLite مرجع است.
function resyncMirrorFromSqlite(jsonDb) {
  if (!sqliteDb || !jsonDb || typeof jsonDb !== 'object') return;
  try {
    const freshHistory = {};
    for (const row of sqliteStmts.listAllHistory.all()) {
      const entry = sqliteHistoryRowToEntry(row);
      if (entry) freshHistory[row.file_key] = entry;
    }
    jsonDb.history = freshHistory;
    const freshAnnotations = {};
    for (const row of sqliteStmts.listAllAnnotations.all()) {
      let items = null;
      try { items = JSON.parse(row.items_json || 'null'); } catch (_) {}
      if (!Array.isArray(items)) continue;
      if (!freshAnnotations[row.file_key]) freshAnnotations[row.file_key] = {};
      freshAnnotations[row.file_key][row.page_num] = items;
    }
    jsonDb.annotations = freshAnnotations;
    const freshBookmarks = {};
    for (const row of sqliteStmts.listAllBookmarks.all()) {
      const rec = sqliteBookmarkRowToRecord(row);
      if (!rec) continue;
      if (!freshBookmarks[row.file_key]) freshBookmarks[row.file_key] = [];
      freshBookmarks[row.file_key].push(rec);
    }
    jsonDb.bookmarks = freshBookmarks;
    const freshHighlights = {};
    for (const row of sqliteStmts.listAllHighlights.all()) {
      try {
        const list = JSON.parse(row.highlights_json || 'null');
        if (Array.isArray(list)) freshHighlights[row.file_key] = list;
      } catch (_) {}
    }
    jsonDb.epubHighlights = freshHighlights;
    const days = {};
    for (const row of sqliteStmts.listDays.all()) {
      days[row.date_key] = { pages: Number(row.pages) || 0, seconds: Number(row.seconds) || 0, appSeconds: Number(row.app_seconds) || 0 };
    }
    const byBook = {};
    for (const row of sqliteStmts.listByBook.all()) {
      let d = {};
      try { d = JSON.parse(row.days_json || '{}'); } catch (_) {}
      byBook[row.file_key] = {
        totalSeconds: Number(row.total_seconds) || 0,
        totalPages: Number(row.total_pages) || 0,
        days: (d && typeof d === 'object' && !Array.isArray(d)) ? d : {},
      };
    }
    if (!jsonDb.readingStats || typeof jsonDb.readingStats !== 'object') jsonDb.readingStats = {};
    jsonDb.readingStats.days = days;
    jsonDb.readingStats.byBook = byBook;
    jsonDb.readingStats.totalAppSeconds = Number(sqliteGetKv('readingTotalAppSeconds')) || 0;
    const prefs = sqliteGetKv('bookmarkPreferences');
    if (prefs) { try { jsonDb.bookmarkPreferences = JSON.parse(prefs); } catch (_) {} }
    const views = sqliteGetKv('customStatViews');
    if (views) { try { const v = JSON.parse(views); if (Array.isArray(v)) jsonDb.customStatViews = v; } catch (_) {} }
    const colors = sqliteGetKv('customColorSystem');
    if (colors) { try { jsonDb.customColorSystem = JSON.parse(colors); } catch (_) {} }
  } catch (_) {}
  // آینه از رویِ SQLite بازسازی شد؛ اگر db.json عقب مانده باشد
  // (خاموشیِ ناگهانی)، FLUSH_SYNC باید عکسِ تازه را بنویسد. در حالتِ
  // عادی، محتوا یکی است و فقط یک بازنویسیِ یکسان در خروج رخ می‌دهد.
  dbDirty = true;
}

// توزیع‌کنندهٔ اکشن‌هایِ SQLite. هر کیس، اعتبارسنجی، سقف‌ها و شکلِ
// پاسخِ کیسِ JSONِ هم‌نام را دقیقاً تکرار می‌کند؛ با این تفاوت که
// به‌جایِ writeDB، ردیف را در SQLite می‌نویسد و آینهٔ درون‌حافظه‌ای
// را هم به‌روز می‌کند (بدونِ نوشتنِ db.json — فلاشِ آن با FLUSH_SYNC
// هنگامِ خروج انجام می‌شود).
function handleSqliteAction(action, payload, db, sendReply) {
  switch (action) {
    case 'SAVE_PROGRESS': {
      const { filePath, currentPage, totalPages = 1, fileName = '', cover = null } = payload;
      if (!filePath) {
        sendReply({ type: 'error', action, message: 'آدرس فایل ارسال نشده است.' });
        return;
      }
      const norm = normalizePath(filePath);
      const existingHist = db.history[norm];
      const incomingTotal = Number(totalPages) || 1;
      const validTotal =
        incomingTotal <= 1 && existingHist?.totalPages > 1
          ? existingHist.totalPages
          : Math.max(1, incomingTotal);
      const validPage = Math.max(1, Math.min(Number(currentPage) || 1, validTotal));
      const percentage = Math.round((validPage / validTotal) * 100);
      const now = new Date().toISOString();
      let resolvedCover = db.coverCache[norm]?.isCustom
        ? coverEntryToUrl(db.coverCache[norm])
        : isPermanentCover(cover)
        ? cover
        : coverEntryToUrl(db.coverCache[norm]) || existingHist?.cover || null;
      if (resolvedCover && isPermanentCover(resolvedCover)) {
        resolvedCover = syncCoverAcrossTables(db, norm, resolvedCover, false);
      } else {
        resolvedCover = null;
      }
      // مرحله ۴۷ §۲: وضعیتِ پین (و علاقه‌مندی) از ردیفِ موجود یا
      // کتابخانه خوانده می‌شود تا ذخیرهٔ پیشرفت، آن را با ۰
      // بازنویسی نکند؛ پیش از این، هر SAVE_PROGRESS پین را صفر می‌کرد.
      let prevPinned = 0;
      let prevFavorite = 0;
      try {
        const prevRow = sqliteStmts.getHistory.get(norm);
        if (prevRow) {
          prevPinned = Number(prevRow.pinned) || 0;
          prevFavorite = Number(prevRow.favorite) || 0;
        }
      } catch (_) {}
      const libItem = db.library.find((item) => normalizePath(item.path || item.filePath) === norm);
      if (prevPinned === 0 && libItem?.isPinned) prevPinned = 1;
      const historyEntry = {
        filePath,
        normPath: norm,
        fileName: fileName || existingHist?.fileName || path.basename(filePath),
        cover: resolvedCover,
        currentPage: validPage,
        totalPages: validTotal,
        percentage,
        updatedAt: now,
        pinned: Boolean(prevPinned),
      };
      db.history[norm] = historyEntry;
      if (libItem) {
        libItem.lastPage = validPage;
        libItem.totalPages = validTotal;
        libItem.percentage = percentage;
        libItem.lastReadAt = now;
        if (resolvedCover && !libItem.hasCustomCover) libItem.cover = resolvedCover;
      }
      const favItem = db.favorites.find((item) => normalizePath(item.path || item.filePath) === norm);
      if (favItem) {
        favItem.lastPage = validPage;
        favItem.totalPages = validTotal;
        favItem.percentage = percentage;
        favItem.lastReadAt = now;
        if (resolvedCover) favItem.cover = resolvedCover;
      }
      sqliteStmts.upsertHistory.run(
        norm,
        historyEntry.fileName,
        filePath,
        '',
        validPage,
        validTotal,
        percentage,
        resolvedCover,
        Date.parse(now) || 0,
        prevPinned,
        prevFavorite,
        JSON.stringify(historyEntry)
      );
      sqliteTouchMirror();
      sendReply({ type: 'done', action, success: true, progress: historyEntry });
      break;
    }

    case 'GET_PROGRESS': {
      const { filePath } = payload;
      const norm = normalizePath(filePath);
      const row = sqliteStmts.getHistory.get(norm);
      const progress = sqliteHistoryRowToEntry(row) || {
        filePath,
        currentPage: 1,
        totalPages: 1,
        percentage: 0,
        updatedAt: null,
      };
      sendReply({ type: 'done', action, progress });
      break;
    }

    case 'RECORD_READING_ACTIVITY': {
      const { date, pages = 0, seconds = 0, fileKey } = payload || {};
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        sendReply({ type: 'error', action, message: 'تاریخِ فعالیت معتبر نیست.' });
        return;
      }
      const addPages = Math.max(0, Math.min(10000, Math.floor(Number(pages) || 0)));
      const addSeconds = Math.max(0, Math.min(86400, Math.floor(Number(seconds) || 0)));
      if (addPages === 0 && addSeconds === 0) {
        if (typeof fileKey === 'string' && fileKey.trim()) {
          const normFile = normalizePath(fileKey);
          if (normFile) {
            if (!db.readingStats.byBook || typeof db.readingStats.byBook !== 'object') db.readingStats.byBook = {};
            if (!db.readingStats.byBook[normFile]) db.readingStats.byBook[normFile] = { totalSeconds: 0, totalPages: 0, days: {} };
            if (!sqliteStmts.getByBook.get(normFile)) sqliteStmts.upsertByBook.run(normFile, 0, 0, '{}');
            sqliteTouchMirror();
          }
        }
        sendReply({ type: 'done', action, success: true, days: db.readingStats?.days || {} });
        return;
      }
      if (!db.readingStats || typeof db.readingStats !== 'object' || Array.isArray(db.readingStats)) {
        db.readingStats = { days: {} };
      }
      if (!db.readingStats.days || typeof db.readingStats.days !== 'object') {
        db.readingStats.days = {};
      }
      const prev = db.readingStats.days[date] || { pages: 0, seconds: 0 };
      db.readingStats.days[date] = {
        pages: Math.min(100000, (Number(prev.pages) || 0) + addPages),
        seconds: Math.min(86400, (Number(prev.seconds) || 0) + addSeconds),
        appSeconds: Math.min(86400, Number(prev.appSeconds) || 0),
      };
      const dayKeys = Object.keys(db.readingStats.days).sort();
      if (dayKeys.length > 1095) {
        for (const oldKey of dayKeys.slice(0, dayKeys.length - 1095)) {
          delete db.readingStats.days[oldKey];
        }
      }
      if (typeof fileKey === 'string' && fileKey.trim()) {
        const normFile = normalizePath(fileKey);
        if (normFile) {
          if (!db.readingStats.byBook || typeof db.readingStats.byBook !== 'object') {
            db.readingStats.byBook = {};
          }
          const prevB = db.readingStats.byBook[normFile] || { totalSeconds: 0, totalPages: 0, days: {} };
          if (!prevB.days || typeof prevB.days !== 'object') prevB.days = {};
          const prevBD = prevB.days[date] || { seconds: 0, pages: 0 };
          prevB.days[date] = {
            seconds: Math.min(86400, (Number(prevBD.seconds) || 0) + addSeconds),
            pages: Math.min(10000, (Number(prevBD.pages) || 0) + addPages),
          };
          const bkKeys = Object.keys(prevB.days).sort();
          if (bkKeys.length > 1095) {
            for (const ok of bkKeys.slice(0, bkKeys.length - 1095)) delete prevB.days[ok];
          }
          db.readingStats.byBook[normFile] = {
            totalSeconds: (Number(prevB.totalSeconds) || 0) + addSeconds,
            totalPages: (Number(prevB.totalPages) || 0) + addPages,
            days: prevB.days,
          };
        }
      }
      const dayRow = db.readingStats.days[date];
      sqliteStmts.upsertDay.run(date, dayRow.pages, dayRow.seconds, dayRow.appSeconds || 0);
      const keepDates = new Set(Object.keys(db.readingStats.days));
      for (const row of sqliteStmts.listDays.all()) {
        if (!keepDates.has(row.date_key)) sqliteStmts.deleteDay.run(row.date_key);
      }
      if (typeof fileKey === 'string' && fileKey.trim()) {
        const normFile = normalizePath(fileKey);
        if (normFile && db.readingStats.byBook && db.readingStats.byBook[normFile]) {
          const bb = db.readingStats.byBook[normFile];
          sqliteStmts.upsertByBook.run(normFile, bb.totalSeconds, bb.totalPages, JSON.stringify(bb.days || {}));
        }
      }
      sqliteTouchMirror();
      sendReply({ type: 'done', action, success: true, days: db.readingStats.days });
      break;
    }

    case 'RECORD_APP_ACTIVITY': {
      const { date, seconds = 0 } = payload || {};
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        sendReply({ type: 'error', action, message: 'تاریخِ فعالیت معتبر نیست.' });
        return;
      }
      const addSeconds = Math.max(0, Math.min(86400, Math.floor(Number(seconds) || 0)));
      if (addSeconds === 0) {
        sendReply({ type: 'done', action, success: true, totalAppSeconds: db.readingStats?.totalAppSeconds || 0 });
        return;
      }
      if (!db.readingStats || typeof db.readingStats !== 'object' || Array.isArray(db.readingStats)) {
        db.readingStats = { days: {}, totalAppSeconds: 0 };
      }
      if (!db.readingStats.days || typeof db.readingStats.days !== 'object') {
        db.readingStats.days = {};
      }
      const prev = db.readingStats.days[date] || { pages: 0, seconds: 0, appSeconds: 0 };
      db.readingStats.days[date] = {
        pages: Number(prev.pages) || 0,
        seconds: Number(prev.seconds) || 0,
        appSeconds: Math.min(86400, (Number(prev.appSeconds) || 0) + addSeconds),
      };
      db.readingStats.totalAppSeconds = Math.min(315360000, (Number(db.readingStats.totalAppSeconds) || 0) + addSeconds);
      const dayRow = db.readingStats.days[date];
      sqliteStmts.upsertDay.run(date, dayRow.pages, dayRow.seconds, dayRow.appSeconds);
      sqliteSetKv('readingTotalAppSeconds', String(db.readingStats.totalAppSeconds));
      sqliteTouchMirror();
      sendReply({ type: 'done', action, success: true, totalAppSeconds: db.readingStats.totalAppSeconds });
      break;
    }

    case 'GET_READING_STATS': {
      const days = {};
      for (const row of sqliteStmts.listDays.all()) {
        days[row.date_key] = { pages: Number(row.pages) || 0, seconds: Number(row.seconds) || 0, appSeconds: Number(row.app_seconds) || 0 };
      }
      const byBook = {};
      for (const row of sqliteStmts.listByBook.all()) {
        let d = {};
        try { d = JSON.parse(row.days_json || '{}'); } catch (_) {}
        byBook[row.file_key] = {
          totalSeconds: Number(row.total_seconds) || 0,
          totalPages: Number(row.total_pages) || 0,
          days: (d && typeof d === 'object' && !Array.isArray(d)) ? d : {},
        };
      }
      const totalAppSeconds = Number(sqliteGetKv('readingTotalAppSeconds')) || 0;
      sendReply({ type: 'done', action, days, byBook, totalAppSeconds });
      break;
    }

    case 'GET_RECENTS': {
      const recents = sqliteStmts.listHistoryRecent.all().map((row) => sqliteHistoryRowToEntry(row)).filter(Boolean);
      sendReply({ type: 'done', action, recents });
      break;
    }

    case 'REMOVE_FROM_RECENTS': {
      const { filePath } = payload;
      const norm = normalizePath(filePath);
      if (db.history[norm]) {
        const removedFile = coverFileFromUrl(db.history[norm].cover);
        delete db.history[norm];
        purgeCoverCacheEntryIfBookGone(db, norm);
        if (removedFile) deleteCoverFileIfUnreferenced(db, removedFile);
        sqliteTouchMirror();
      }
      sqliteStmts.deleteHistory.run(norm);
      sendReply({ type: 'done', action, success: true });
      break;
    }

    case 'CLEAR_RECENTS': {
      const removedFiles = Object.values(db.history || {})
        .map((h) => coverFileFromUrl(h?.cover))
        .filter(Boolean);
      const removedNorms = Object.keys(db.history || {});
      db.history = {};
      removedNorms.forEach((normKey) => purgeCoverCacheEntryIfBookGone(db, normKey));
      removedFiles.forEach((file) => deleteCoverFileIfUnreferenced(db, file));
      sqliteStmts.clearHistory.run();
      sqliteTouchMirror();
      sendReply({ type: 'done', action, success: true });
      break;
    }

    case 'GET_ANNOTATIONS': {
      const { filePath, pageNumber } = payload;
      const norm = normalizePath(filePath);
      if (pageNumber !== undefined && pageNumber !== null) {
        const row = sqliteStmts.getAnnotationPage.get(norm, String(pageNumber));
        let items = [];
        try { items = JSON.parse(row?.items_json || 'null') || []; } catch (_) {}
        if (!Array.isArray(items)) items = [];
        sendReply({ type: 'done', action, items });
      } else {
        const annotations = {};
        for (const row of sqliteStmts.listAnnotationsForFile.all(norm)) {
          try {
            const items = JSON.parse(row.items_json || 'null');
            if (Array.isArray(items)) annotations[row.page_num] = items;
          } catch (_) {}
        }
        sendReply({ type: 'done', action, annotations });
      }
      break;
    }

    case 'SAVE_ANNOTATIONS': {
      const { filePath, pageNumber, items = [] } = payload;
      const norm = normalizePath(filePath);
      if (!norm || pageNumber === undefined || pageNumber === null) {
        sendReply({ type: 'error', action, message: 'اطلاعات صفحه نامعتبر است.' });
        return;
      }
      db.annotations = db.annotations || {};
      if (!db.annotations[norm]) {
        db.annotations[norm] = {};
      }
      const pageKey = String(pageNumber);
      if (!Array.isArray(items) || items.length === 0) {
        delete db.annotations[norm][pageKey];
        sqliteStmts.deleteAnnotationPage.run(norm, pageKey);
      } else {
        db.annotations[norm][pageKey] = items;
        sqliteStmts.upsertAnnotation.run(norm, pageKey, JSON.stringify(items), Date.now());
      }
      sqliteTouchMirror();
      sendReply({
        type: 'done',
        action,
        success: true,
        items: db.annotations[norm][pageKey] || [],
      });
      break;
    }

    case 'CLEAR_ANNOTATIONS': {
      const { filePath, pageNumber } = payload;
      const norm = normalizePath(filePath);
      if (norm && db.annotations && db.annotations[norm]) {
        if (pageNumber !== undefined && pageNumber !== null) {
          delete db.annotations[norm][String(pageNumber)];
          sqliteStmts.deleteAnnotationPage.run(norm, String(pageNumber));
        } else {
          delete db.annotations[norm];
          sqliteStmts.deleteAnnotationsForFile.run(norm);
        }
        sqliteTouchMirror();
      }
      sendReply({ type: 'done', action, success: true });
      break;
    }

    case 'GET_ANNOTATION_TOTALS': {
      let totalItems = 0;
      let annotatedPages = 0;
      let annotatedFiles = 0;
      const perFile = {};
      for (const row of sqliteStmts.listAllAnnotations.all()) {
        let items = [];
        try { items = JSON.parse(row.items_json || 'null') || []; } catch (_) {}
        if (!Array.isArray(items)) items = [];
        if (items.length > 0) annotatedPages += 1;
        perFile[row.file_key] = (perFile[row.file_key] || 0) + items.length;
        totalItems += items.length;
      }
      for (const n of Object.values(perFile)) {
        if (n > 0) annotatedFiles += 1;
      }
      sendReply({ type: 'done', action, totalItems, annotatedPages, annotatedFiles });
      break;
    }

    case 'GET_ANNOTATION_COUNTS': {
      const counts = {};
      for (const row of sqliteStmts.listAllAnnotations.all()) {
        let items = [];
        try { items = JSON.parse(row.items_json || 'null') || []; } catch (_) {}
        if (!Array.isArray(items)) items = [];
        counts[row.file_key] = (counts[row.file_key] || 0) + items.length;
      }
      for (const k of Object.keys(counts)) {
        if (!(counts[k] > 0)) delete counts[k];
      }
      sendReply({ type: 'done', action, counts });
      break;
    }

    case 'GET_BOOKMARKS': {
      const { filePath } = payload;
      const norm = normalizePath(filePath);
      const list = sqliteStmts.listBookmarksForFile.all(norm).map((row) => sqliteBookmarkRowToRecord(row)).filter(Boolean);
      sendReply({ type: 'done', action, bookmarks: list });
      break;
    }

    case 'SAVE_BOOKMARKS': {
      const { filePath, bookmarks = [] } = payload;
      const norm = normalizePath(filePath);
      if (!norm) {
        sendReply({ type: 'error', action, message: 'مسیرِ فایل نامعتبر است.' });
        return;
      }
      db.bookmarks = db.bookmarks || {};
      const clean = (Array.isArray(bookmarks) ? bookmarks : []).map(sanitizeBookmarkRecord).filter(Boolean);
      if (clean.length === 0) delete db.bookmarks[norm];
      else db.bookmarks[norm] = clean;
      const run = sqliteDb.transaction(() => {
        sqliteStmts.deleteBookmarksForFile.run(norm);
        for (const bm of clean) {
          sqliteStmts.upsertBookmark.run(
            bm.id,
            norm,
            bm.page,
            bm.yRatio,
            bm.name || '',
            '',
            bm.template,
            Date.parse(bm.createdAt) || 0,
            JSON.stringify(bm)
          );
        }
      });
      run();
      sqliteTouchMirror();
      sendReply({ type: 'done', action, success: true, bookmarks: clean });
      break;
    }

    case 'GET_ALL_BOOKMARKS': {
      const files = [];
      let total = 0;
      const grouped = {};
      for (const row of sqliteStmts.listAllBookmarks.all()) {
        const rec = sqliteBookmarkRowToRecord(row);
        if (!rec) continue;
        if (!grouped[row.file_key]) grouped[row.file_key] = [];
        grouped[row.file_key].push(rec);
      }
      for (const [norm, list] of Object.entries(grouped)) {
        if (list.length === 0) continue;
        const hist = db.history && db.history[norm];
        const libItem = (db.library || []).find((it) => normalizePath(it.path || it.filePath) === norm);
        const favItem = (db.favorites || []).find((it) => normalizePath(it.path || it.filePath) === norm);
        const filePath = (hist && (hist.filePath || hist.path))
          || (libItem && (libItem.path || libItem.filePath))
          || (favItem && (favItem.path || favItem.filePath))
          || norm;
        const fileName = String(filePath).split(/[\\/]/).pop() || norm;
        files.push({ filePath, fileName, bookmarks: list });
        total += list.length;
      }
      files.sort((a, b) => String(a.fileName).localeCompare(String(b.fileName)));
      sendReply({ type: 'done', action, files, total });
      break;
    }

    case 'GET_EPUB_HIGHLIGHTS': {
      const { filePath } = payload || {};
      const norm = normalizePath(filePath);
      const row = sqliteStmts.getHighlights.get(norm);
      let list = [];
      try { list = JSON.parse(row?.highlights_json || 'null') || []; } catch (_) {}
      sendReply({ type: 'done', action, highlights: Array.isArray(list) ? list : [] });
      break;
    }

    case 'SAVE_EPUB_HIGHLIGHTS': {
      const { filePath, highlights = [] } = payload || {};
      const norm = normalizePath(filePath);
      if (!norm || !Array.isArray(highlights)) {
        sendReply({ type: 'error', action, message: 'هایلایت‌ها معتبر نیستند.' });
        return;
      }
      const clean = sqliteCleanEpubHighlights(highlights);
      if (!db.epubHighlights || typeof db.epubHighlights !== 'object') db.epubHighlights = {};
      db.epubHighlights[norm] = clean;
      sqliteStmts.upsertHighlights.run(norm, JSON.stringify(clean), Date.now());
      sqliteTouchMirror();
      sendReply({ type: 'done', action, success: true });
      break;
    }

    case 'GET_CUSTOM_STAT_VIEWS': {
      let views = [];
      try {
        const raw = sqliteGetKv('customStatViews');
        const parsed = JSON.parse(raw || 'null');
        if (Array.isArray(parsed)) views = parsed;
      } catch (_) {}
      sendReply({ type: 'done', action, views });
      break;
    }

    case 'SAVE_CUSTOM_STAT_VIEWS': {
      const { views = [] } = payload || {};
      if (!Array.isArray(views)) {
        sendReply({ type: 'error', action, message: 'آماربندی‌ها معتبر نیستند.' });
        return;
      }
      const clean = sqliteCleanStatViews(views);
      db.customStatViews = clean;
      sqliteSetKv('customStatViews', JSON.stringify(clean));
      sqliteTouchMirror();
      sendReply({ type: 'done', action, views: clean });
      break;
    }

    case 'SAVE_SETTING': {
      const { key, value } = payload;
      if (key) {
        db.settings = db.settings || {};
        db.settings[key] = value;
        const settingRaw = JSON.stringify(value);
        sqliteSetKv('setting:' + key, settingRaw === undefined ? 'null' : settingRaw);
        sqliteTouchMirror();
        sendReply({ type: 'done', action, success: true, settings: db.settings });
      }
      break;
    }

    case 'GET_SETTINGS': {
      // مرحلهٔ ۴۴ §۵ (OPT-06): تنظیمات از kv_store خوانده می‌شوند؛
      // کلیدی که هنوز در kv_store نیست، از آینهٔ JSON خوانده و همان‌جا
      // به SQLite مهاجرت می‌کند تا تنظیماتِ قدیمی گم نشوند. کلیدهایِ
      // فقط-kv هم (مثلاً پس از خاموشیِ ناگهانی پیش از فلاشِ آینه) رویِ
      // نتیجه سوار می‌شوند؛ kv مرجع است و آینه همگام می‌شود تا
      // FLUSH_SYNC همان را در db.json بنویسد.
      const settings = JSON.parse(JSON.stringify(defaultDB.settings));
      db.settings = db.settings || {};
      Object.entries(db.settings).forEach(([k, v]) => {
        const raw = sqliteGetKv('setting:' + k);
        if (raw === null || raw === undefined) {
          try { sqliteSetKv('setting:' + k, JSON.stringify(v)); } catch (_) {}
          settings[k] = v;
        } else {
          try { settings[k] = JSON.parse(raw); } catch (_) { settings[k] = v; }
        }
      });
      try {
        for (const row of sqliteStmts.listSettingKv.all()) {
          const k = String(row.key || '').slice('setting:'.length);
          if (!k) continue;
          try { settings[k] = JSON.parse(row.value_json); } catch (_) {}
        }
      } catch (_) {}
      db.settings = settings;
      sqliteTouchMirror();
      sendReply({ type: 'done', action, settings });
      break;
    }

    case 'GET_BOOKMARK_PREFERENCES': {
      let preferences = null;
      try {
        const raw = sqliteGetKv('bookmarkPreferences');
        const parsed = JSON.parse(raw || 'null');
        if (parsed && typeof parsed === 'object') preferences = parsed;
      } catch (_) {}
      if (!preferences) preferences = JSON.parse(JSON.stringify(defaultDB.bookmarkPreferences));
      sendReply({ type: 'done', action, preferences });
      break;
    }

    case 'SAVE_BOOKMARK_PREFERENCES': {
      const { preferences = {} } = payload;
      const next = sqliteCleanBookmarkPreferences(preferences, db.bookmarkPreferences);
      db.bookmarkPreferences = next;
      sqliteSetKv('bookmarkPreferences', JSON.stringify(next));
      sqliteTouchMirror();
      sendReply({ type: 'done', action, success: true, preferences: next });
      break;
    }

    case 'GET_CUSTOM_COLOR_SYSTEM': {
      let customColorSystem = null;
      try {
        const raw = sqliteGetKv('customColorSystem');
        const parsed = JSON.parse(raw || 'null');
        if (parsed && typeof parsed === 'object') customColorSystem = parsed;
      } catch (_) {}
      if (!customColorSystem) customColorSystem = JSON.parse(JSON.stringify(defaultDB.customColorSystem));
      sendReply({ type: 'done', action, customColorSystem });
      break;
    }

    case 'SAVE_CUSTOM_COLOR_SYSTEM': {
      const { customColorSystem = {} } = payload;
      const next = sqliteCleanColorSystem(customColorSystem);
      db.customColorSystem = next;
      sqliteSetKv('customColorSystem', JSON.stringify(next));
      sqliteTouchMirror();
      sendReply({ type: 'done', action, success: true, customColorSystem: next });
      break;
    }

    case 'GET_EPUB_CHAPTER_TEXT': {
      const { filePath, chapterIndex, mtime } = payload || {};
      const norm = normalizePath(filePath);
      const row = sqliteStmts.getChapterText.get(norm, Math.floor(Number(chapterIndex) || 0));
      let found = false;
      let plainText = null;
      if (row && typeof row.plain_text === 'string') {
        const wanted = Number(mtime) || 0;
        if (!wanted || Number(row.mtime) === wanted) {
          found = true;
          plainText = row.plain_text;
        }
      }
      sendReply({ type: 'done', action, success: true, found, plainText, chapterIndex: Math.floor(Number(chapterIndex) || 0) });
      break;
    }

    case 'SAVE_EPUB_CHAPTER_TEXT': {
      const { filePath, chapterIndex, mtime, plainText } = payload || {};
      const norm = normalizePath(filePath);
      if (!norm || chapterIndex === undefined || chapterIndex === null || typeof plainText !== 'string') {
        sendReply({ type: 'error', action, message: 'متنِ فصل معتبر نیست.' });
        return;
      }
      const capped = plainText.slice(0, 2000000);
      sqliteStmts.upsertChapterText.run(norm, Math.floor(Number(chapterIndex)), Math.floor(Number(mtime) || 0), capped);
      sendReply({ type: 'done', action, success: true });
      break;
    }

    default:
      sendReply({
        type: 'error',
        action,
        message: `دستور ${action} در ورکر دیتابیس پشتیبانی نمی‌شود.`,
      });
  }
}


parentPort.on('message', (request) => {
  const { reqId, action, payload = {} } = request || {};
  let db = readDB();

  const sendReply = (msgObj) => {
    parentPort.postMessage(reqId !== undefined ? { ...msgObj, reqId } : msgObj);
  };

  try {
    // مرحلهٔ ۴۰ §۱: اطلاعاتِ موتورِ دیتابیس — در هر دو حالت (SQLite و
    // JSON) پاسخ می‌دهد تا راهنمایِ مهاجرت بتواند فعال بودنِ SQLite را
    // بررسی کند.
    if (action === 'GET_DATABASE_INFO') {
      let counts = { history: 0, annotations: 0, bookmarks: 0, readingDays: 0, byBook: 0, textCache: 0 };
      let migrated = false;
      if (sqliteReady) {
        counts = sqliteGetCounts();
        migrated = sqliteGetKv(SQLITE_MIGRATION_KEY) === '1';
      }
      sendReply({ type: 'done', action, success: true, engine: sqliteReady ? 'sqlite' : 'json', sqlitePath: SQLITE_FILE, jsonPath: DB_FILE, migrated, counts });
      return;
    }
    // مرحلهٔ ۴۰ §۱: اکشن‌هایِ داغ، وقتی SQLite آماده است، از
    // handleSqliteAction پاسخ می‌گیرند؛ بقیه به switchِ JSON می‌رسند.
    if (sqliteReady && SQLITE_ROUTED_ACTIONS.has(action)) {
      try {
        handleSqliteAction(action, payload || {}, db, sendReply);
      } catch (err) {
        sendReply({ type: 'error', action, message: 'خطای سیستمی دیتابیس: ' + err.message });
      }
      return;
    }
    switch (action) {
      case 'FLUSH_SYNC': {
        // پاسخ، صراحتاً FLUSH_SYNC_ACK است تا main در handshakeِ خروج
        // آن را از پاسخ‌های عادیِ db-action تشخیص بدهد. اگر main این
        // پیام را با reqId فرستاده باشد، sendReply همان reqId را هم
        // برمی‌گرداند.
        // مرحلهٔ ۴۰ §۱: پیش از فلاشِ JSON، WAL را در فایلِ اصلیِ
        // SQLite خالی کن تا library.sqlite همیشه خودکفا بماند.
        if (sqliteReady) {
          try { sqliteDb.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
        }
        handleFlushSync()
          .then((result) => {
            sendReply({ type: 'FLUSH_SYNC_ACK', action, success: result.ok, flushed: result.flushed });
          })
          .catch(() => {
            sendReply({ type: 'FLUSH_SYNC_ACK', action, success: false, flushed: false });
          });
        break;
      }

      case 'SAVE_PROGRESS': {
        const { filePath, currentPage, totalPages = 1, fileName = '', cover = null } = payload;
        if (!filePath) {
          sendReply({ type: 'error', action, message: 'آدرس فایل ارسال نشده است.' });
          return;
        }

        const norm = normalizePath(filePath);
        const existingHist = db.history[norm];

        // الحفاظ على إجمالي صفحات PDF الحقيقي إذا تم إرسال القيمة المؤقتة 1 عند بدء التشغيل
        const incomingTotal = Number(totalPages) || 1;
        const validTotal =
          incomingTotal <= 1 && existingHist?.totalPages > 1
            ? existingHist.totalPages
            : Math.max(1, incomingTotal);

        const validPage = Math.max(1, Math.min(Number(currentPage) || 1, validTotal));
        const percentage = Math.round((validPage / validTotal) * 100);
        const now = new Date().toISOString();

        let resolvedCover = db.coverCache[norm]?.isCustom
          ? coverEntryToUrl(db.coverCache[norm])
          : isPermanentCover(cover)
          ? cover
          : coverEntryToUrl(db.coverCache[norm]) || existingHist?.cover || null;

        if (resolvedCover && isPermanentCover(resolvedCover)) {
          resolvedCover = syncCoverAcrossTables(db, norm, resolvedCover, false);
        } else {
          resolvedCover = null;
        }

        // مرحله ۴۷ §۲: وضعیتِ پین در ورودیِ تازهٔ تاریخچه حفظ می‌شود
        // تا ذخیرهٔ پیشرفت، آن را از آینه پاک نکند.
        const libItem = db.library.find((item) => normalizePath(item.path || item.filePath) === norm);
        const historyEntry = {
          filePath,
          normPath: norm,
          fileName: fileName || existingHist?.fileName || path.basename(filePath),
          cover: resolvedCover,
          currentPage: validPage,
          totalPages: validTotal,
          percentage,
          updatedAt: now,
          pinned: Boolean(existingHist?.pinned ?? libItem?.isPinned)
        };

        db.history[norm] = historyEntry;

        if (libItem) {
          libItem.lastPage = validPage;
          libItem.totalPages = validTotal;
          libItem.percentage = percentage;
          libItem.lastReadAt = now;
          if (resolvedCover && !libItem.hasCustomCover) libItem.cover = resolvedCover;
        }

        const favItem = db.favorites.find((item) => normalizePath(item.path || item.filePath) === norm);
        if (favItem) {
          favItem.lastPage = validPage;
          favItem.totalPages = validTotal;
          favItem.percentage = percentage;
          favItem.lastReadAt = now;
          if (resolvedCover) favItem.cover = resolvedCover;
        }

        writeDB(db);
        sendReply({ type: 'done', action, success: true, progress: historyEntry });
        break;
      }

      case 'GET_PROGRESS': {
        const { filePath } = payload;
        const norm = normalizePath(filePath);
        const progress = db.history[norm] || {
          filePath,
          currentPage: 1,
          totalPages: 1,
          percentage: 0,
          updatedAt: null
        };
        sendReply({ type: 'done', action, progress });
        break;
      }

      // مرحله ۶ ـ بخش الف: آمارِ واقعیِ مطالعه، به تفکیکِ روزِ محلی.
      // رندرر گزارش‌ها را دسته‌ای می‌فرستد؛ اینجا فقط جمع می‌شود و
      // نوشته می‌شود. سقف‌های محافظ، از دادهٔ خراب یا سوءاستفادهٔ
      // فراخوانِ مستقیم جلوگیری می‌کنند.
      case 'RECORD_READING_ACTIVITY': {
        const { date, pages = 0, seconds = 0, fileKey } = payload || {};
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          sendReply({ type: 'error', action, message: 'تاریخِ فعالیت معتبر نیست.' });
          return;
        }
        const addPages = Math.max(0, Math.min(10000, Math.floor(Number(pages) || 0)));
        const addSeconds = Math.max(0, Math.min(86400, Math.floor(Number(seconds) || 0)));
        if (addPages === 0 && addSeconds === 0) {
          // مرحلهٔ ۳۶ §۵: ثبتِ ۰/۰ هم ورودیِ byBook را می‌سازد تا کتاب،
          // از همان لحظهٔ اول در آماربندی‌هایِ سفارشی دیده شود.
          if (typeof fileKey === 'string' && fileKey.trim()) {
            const normFile = normalizePath(fileKey);
            if (normFile) {
              if (!db.readingStats.byBook || typeof db.readingStats.byBook !== 'object') db.readingStats.byBook = {};
              if (!db.readingStats.byBook[normFile]) db.readingStats.byBook[normFile] = { totalSeconds: 0, totalPages: 0, days: {} };
              writeDB(db);
            }
          }
          sendReply({ type: 'done', action, success: true, days: db.readingStats?.days || {} });
          return;
        }
        if (!db.readingStats || typeof db.readingStats !== 'object' || Array.isArray(db.readingStats)) {
          db.readingStats = { days: {} };
        }
        if (!db.readingStats.days || typeof db.readingStats.days !== 'object') {
          db.readingStats.days = {};
        }
        const prev = db.readingStats.days[date] || { pages: 0, seconds: 0 };
        db.readingStats.days[date] = {
          pages: Math.min(100000, (Number(prev.pages) || 0) + addPages),
          seconds: Math.min(86400, (Number(prev.seconds) || 0) + addSeconds),
          // مرحله ۱۴: ثانیه‌هایِ حضورِ برنامه، با فلاشِ مطالعه پاک
          // نمی‌شوند؛ همان روز، هر دو شمارنده را نگه می‌دارد.
          appSeconds: Math.min(86400, Number(prev.appSeconds) || 0),
        };
        // هرسِ روزهای خیلی قدیمی (بیش از ۱۰۹۵ روز) در همان نوشتن.
        const dayKeys = Object.keys(db.readingStats.days).sort();
        if (dayKeys.length > 1095) {
          for (const oldKey of dayKeys.slice(0, dayKeys.length - 1095)) {
            delete db.readingStats.days[oldKey];
          }
        }
        // مرحلهٔ ۳۵ §۱: همان فلاش، آمارِ همان کتاب را هم در
        // byBook به‌روز می‌کند (کلید، همان normalizePathِ ورکر است).
        if (typeof fileKey === 'string' && fileKey.trim()) {
          const normFile = normalizePath(fileKey);
          if (normFile) {
            if (!db.readingStats.byBook || typeof db.readingStats.byBook !== 'object') {
              db.readingStats.byBook = {};
            }
            const prevB = db.readingStats.byBook[normFile] || { totalSeconds: 0, totalPages: 0, days: {} };
            if (!prevB.days || typeof prevB.days !== 'object') prevB.days = {};
            const prevBD = prevB.days[date] || { seconds: 0, pages: 0 };
            prevB.days[date] = {
              seconds: Math.min(86400, (Number(prevBD.seconds) || 0) + addSeconds),
              pages: Math.min(10000, (Number(prevBD.pages) || 0) + addPages),
            };
            const bkKeys = Object.keys(prevB.days).sort();
            if (bkKeys.length > 1095) {
              for (const ok of bkKeys.slice(0, bkKeys.length - 1095)) delete prevB.days[ok];
            }
            db.readingStats.byBook[normFile] = {
              totalSeconds: (Number(prevB.totalSeconds) || 0) + addSeconds,
              totalPages: (Number(prevB.totalPages) || 0) + addPages,
              days: prevB.days,
            };
          }
        }
        writeDB(db);
        sendReply({ type: 'done', action, success: true, days: db.readingStats.days });
        break;
      }

      case 'RECORD_APP_ACTIVITY': {
        // مرحله ۱۴: ثبتِ زمانِ حضورِ سراسریِ برنامه. مجموعِ کل
        // در totalAppSeconds و تفکیکِ روزانه در days[date].appSeconds
        // می‌نشیند؛ صفحات و ثانیه‌هایِ مطالعهٔ همان روز، دست
        // نمی‌خورند.
        const { date, seconds = 0 } = payload || {};
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          sendReply({ type: 'error', action, message: 'تاریخِ فعالیت معتبر نیست.' });
          return;
        }
        const addSeconds = Math.max(0, Math.min(86400, Math.floor(Number(seconds) || 0)));
        if (addSeconds === 0) {
          sendReply({ type: 'done', action, success: true, totalAppSeconds: db.readingStats?.totalAppSeconds || 0 });
          return;
        }
        if (!db.readingStats || typeof db.readingStats !== 'object' || Array.isArray(db.readingStats)) {
          db.readingStats = { days: {}, totalAppSeconds: 0 };
        }
        if (!db.readingStats.days || typeof db.readingStats.days !== 'object') {
          db.readingStats.days = {};
        }
        const prev = db.readingStats.days[date] || { pages: 0, seconds: 0, appSeconds: 0 };
        db.readingStats.days[date] = {
          pages: Number(prev.pages) || 0,
          seconds: Number(prev.seconds) || 0,
          appSeconds: Math.min(86400, (Number(prev.appSeconds) || 0) + addSeconds),
        };
        db.readingStats.totalAppSeconds = Math.min(315360000, (Number(db.readingStats.totalAppSeconds) || 0) + addSeconds);
        writeDB(db);
        sendReply({ type: 'done', action, success: true, totalAppSeconds: db.readingStats.totalAppSeconds });
        break;
      }

      case 'GET_READING_STATS': {
        const days =
          db.readingStats && typeof db.readingStats === 'object' && db.readingStats.days && typeof db.readingStats.days === 'object'
            ? db.readingStats.days
            : {};
        const byBook =
          db.readingStats && typeof db.readingStats === 'object' && db.readingStats.byBook && typeof db.readingStats.byBook === 'object'
            ? db.readingStats.byBook
            : {};
        sendReply({ type: 'done', action, days, byBook, totalAppSeconds: Number(db.readingStats?.totalAppSeconds) || 0 });
        break;
      }

      case 'GET_RECENTS': {
        // مرحلهٔ ۳۰ — سقفِ نگهداریِ مواردِ اخیر در خروجیِ دیتابیس،
        // از ۱۰۰ به ۵۰۰ رسید تا انتخابِ حدِ نمایش تا ۵۰۰/همه،
        // دادهٔ واقعی داشته باشد (نقشهٔ history خودش سقفی نداشت؛
        // سقفِ مؤثر، همین slice و sliceِ استور بود).
        const recents = Object.values(db.history)
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
          .slice(0, 500);
        sendReply({ type: 'done', action, recents });
        break;
      }

      case 'REMOVE_FROM_RECENTS': {
        const { filePath } = payload;
        const norm = normalizePath(filePath);
        if (db.history[norm]) {
          const removedFile = coverFileFromUrl(db.history[norm].cover);
          delete db.history[norm];
          // مرحله ۲ ـ بخش ب: اگر کتاب از هر سه جدول رفت، ورودیِ کشِ آن
          // هم حذف می‌شود.
          purgeCoverCacheEntryIfBookGone(db, norm);
          if (removedFile) deleteCoverFileIfUnreferenced(db, removedFile);
          writeDB(db);
        }
        sendReply({ type: 'done', action, success: true });
        break;
      }

      case 'CLEAR_RECENTS': {
        const removedFiles = Object.values(db.history || {})
          .map((h) => coverFileFromUrl(h?.cover))
          .filter(Boolean);
        const removedNorms = Object.keys(db.history || {});
        db.history = {};
        // مرحله ۲ ـ بخش ب: ورودی‌های کشِ کتاب‌هایی که با پاک‌شدنِ
        // تاریخچه از هر سه جدول رفته‌اند، حذف می‌شوند.
        removedNorms.forEach((normKey) => purgeCoverCacheEntryIfBookGone(db, normKey));
        removedFiles.forEach((file) => deleteCoverFileIfUnreferenced(db, file));
        writeDB(db);
        sendReply({ type: 'done', action, success: true });
        break;
      }

      case 'ADD_TO_LIBRARY': {
        const { filePath, name, coverPath, folderId = null, isPinned = false } = payload;
        if (!filePath) {
          sendReply({ type: 'error', action, message: 'آدرس فایل کمیک ارسال نشده است.' });
          return;
        }

        const norm = normalizePath(filePath);
        const existingIndex = db.library.findIndex(
          (item) => normalizePath(item.path || item.filePath) === norm
        );
        const existingItem = existingIndex >= 0 ? db.library[existingIndex] : null;
        const historyData = db.history[norm];

        let cachedCover = db.coverCache[norm]?.isCustom
          ? coverEntryToUrl(db.coverCache[norm])
          : isPermanentCover(coverPath)
          ? coverPath
          : coverEntryToUrl(db.coverCache[norm]) || existingItem?.cover || null;

        if (!isPermanentCover(cachedCover)) cachedCover = null;

        if (cachedCover) {
          cachedCover = syncCoverAcrossTables(db, norm, cachedCover, false);
        }

        const pinnedState = existingItem ? Boolean(existingItem.isPinned) : Boolean(isPinned);

        const itemData = {
          path: filePath,
          normPath: norm,
          name: name || existingItem?.name || path.basename(filePath),
          cover: cachedCover,
          hasCustomCover: Boolean(db.coverCache[norm]?.isCustom || existingItem?.hasCustomCover),
          folderId: folderId !== undefined ? folderId : existingItem?.folderId || null,
          isPinned: pinnedState,
          pinnedAt: pinnedState
            ? existingItem?.pinnedAt || new Date().toISOString()
            : null,
          addedAt: existingItem ? existingItem.addedAt : new Date().toISOString(),
          lastPage: historyData?.currentPage || existingItem?.lastPage || 1,
          totalPages: historyData?.totalPages || existingItem?.totalPages || 1,
          percentage: historyData?.percentage || existingItem?.percentage || 0,
          lastReadAt: historyData?.updatedAt || existingItem?.lastReadAt || null
        };

        if (existingIndex >= 0) {
          db.library[existingIndex] = itemData;
        } else {
          db.library.unshift(itemData);
        }

        db.library = sortLibraryItems(db.library);
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          library: db.library,
          folders: db.libraryFolders || []
        });
        break;
      }

      case 'REMOVE_FROM_LIBRARY': {
        const { filePath } = payload;
        const norm = normalizePath(filePath);
        const removed = db.library.find((item) => normalizePath(item.path || item.filePath) === norm);
        const removedFile = removed ? coverFileFromUrl(removed.cover) : null;
        db.library = db.library.filter((item) => normalizePath(item.path || item.filePath) !== norm);
        // مرحله ۲ ـ بخش ب: اگر کتاب از هر سه جدول رفت، ورودیِ کشِ آن
        // هم حذف می‌شود؛ وگرنه فایل با ارجاعِ خودِ کش هرگز پاک نمی‌شد.
        purgeCoverCacheEntryIfBookGone(db, norm);
        if (removedFile) deleteCoverFileIfUnreferenced(db, removedFile);
        writeDB(db);
        sendReply({ type: 'done', action, library: db.library });
        break;
      }

      case 'GET_LIBRARY': {
        db.library = sortLibraryItems(db.library);
        sendReply({
          type: 'done',
          action,
          library: db.library,
          folders: db.libraryFolders || []
        });
        break;
      }

      // =====================================================================
      // إدارة التثبيت (Pin) والمجلدات (Folders) والغلاف المخصص في المكتبة
      // =====================================================================
      case 'TOGGLE_PIN_LIBRARY': {
        const { filePath, comic = {} } = payload;
        const targetPath = filePath || comic.path || comic.filePath;
        if (!targetPath) {
          sendReply({ type: 'error', action, message: 'مسیر فایل مشخص نیست.' });
          return;
        }

        const norm = normalizePath(targetPath);
        let idx = db.library.findIndex(
          (item) => normalizePath(item.path || item.filePath) === norm
        );

        let nextPinned = true;
        const now = new Date().toISOString();

        if (idx >= 0) {
          nextPinned = !db.library[idx].isPinned;
          db.library[idx] = {
            ...db.library[idx],
            isPinned: nextPinned,
            pinnedAt: nextPinned ? now : null
          };
        } else {
          const hist = db.history[norm];
          // مرحله ۴۷ §۲: ورودیِ حداقلی، کاور و فیلدهایِ غنیِ ارسالی از
          // رندرر را هم می‌گیرد؛ پیش از این، کاورِ ارسالی نادیده
          // گرفته می‌شد و ورودی با cover: null ساخته می‌شد که پس از
          // ری‌لود، کارت را خالی نشان می‌داد.
          const incomingCover = isPermanentCover(comic.cover) ? comic.cover : null;
          const cachedCov = incomingCover || coverEntryToUrl(db.coverCache[norm]) || hist?.cover || null;
          const totalPages =
            Number(comic.totalPages || comic.items?.length) ||
            Number(hist?.totalPages) ||
            1;
          const lastPage = Math.max(
            1,
            Math.min(
              totalPages,
              Number(comic.lastPage || comic.currentPage) ||
                Number(hist?.currentPage) ||
                1
            )
          );
          const percentage =
            typeof comic.percentage === 'number'
              ? comic.percentage
              : typeof comic.progress === 'number'
              ? comic.progress
              : Number(hist?.percentage) || 0;
          db.library.unshift({
            path: targetPath,
            normPath: norm,
            name: comic.name || comic.fileName || hist?.fileName || path.basename(targetPath),
            cover: isPermanentCover(cachedCov) ? cachedCov : null,
            type: comic.type || (norm.endsWith('.pdf') ? 'pdf' : 'zip'),
            fileSize: comic.fileSize || '',
            folderId: comic.folderId || null,
            hasCustomCover: Boolean(comic.hasCustomCover),
            isPinned: true,
            pinnedAt: now,
            addedAt: now,
            lastPage,
            currentPage: lastPage,
            totalPages,
            percentage,
            progress: percentage,
            lastReadAt: hist?.updatedAt || comic.lastReadAt || null
          });
        }

        db.library = sortLibraryItems(db.library);
        // مرحله ۴۷ §۲: همگام‌سازیِ پین با جدولِ history در SQLite.
        // ستونِ pinned از اول در اسکیما هست (CREATE TABLE history)؛
        // فقط وقتی ردیفی برایِ این فایل وجود دارد به‌روز می‌شود — برایِ
        // کتابِ هرگز خوانده‌نشده ردیفی نیست و مرجعِ پین، همان
        // کتابخانهٔ JSON می‌ماند.
        if (db.history[norm]) {
          db.history[norm].pinned = nextPinned;
        }
        if (sqliteReady && sqliteStmts.updateHistoryPinned) {
          try {
            sqliteStmts.updateHistoryPinned.run(nextPinned ? 1 : 0, norm);
          } catch (_) {}
        }
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          isPinned: nextPinned,
          library: db.library
        });
        break;
      }

      case 'GET_LIBRARY_FOLDERS': {
        sendReply({
          type: 'done',
          action,
          folders: db.libraryFolders || []
        });
        break;
      }

      case 'CREATE_LIBRARY_FOLDER': {
        const { name, color = '#22d3ee', icon = 'Folder' } = payload;
        const cleanName = (name || '').trim();
        if (!cleanName) {
          sendReply({ type: 'error', action, message: 'نام پوشه نمی‌تواند خالی باشد.' });
          return;
        }

        db.libraryFolders = Array.isArray(db.libraryFolders) ? db.libraryFolders : [];
        const newFolder = {
          id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: cleanName,
          color,
          icon,
          createdAt: new Date().toISOString()
        };

        db.libraryFolders.push(newFolder);
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          folder: newFolder,
          folders: db.libraryFolders
        });
        break;
      }

      case 'RENAME_LIBRARY_FOLDER': {
        const { folderId, name, color } = payload;
        db.libraryFolders = Array.isArray(db.libraryFolders) ? db.libraryFolders : [];
        const target = db.libraryFolders.find((f) => f.id === folderId);
        if (target) {
          if (name && name.trim()) target.name = name.trim();
          if (color) target.color = color;
          target.updatedAt = new Date().toISOString();
          writeDB(db);
        }
        sendReply({
          type: 'done',
          action,
          success: Boolean(target),
          folders: db.libraryFolders
        });
        break;
      }

      case 'DELETE_LIBRARY_FOLDER': {
        const { folderId } = payload;
        db.libraryFolders = (db.libraryFolders || []).filter((f) => f.id !== folderId);
        db.library.forEach((item) => {
          if (item.folderId === folderId) {
            item.folderId = null;
          }
        });
        // مرحله ۴۹ (C): حذفِ پوشهٔ کتابخانه، علاقه‌مندی‌ها را دست
        // نمی‌زند؛ favoriteFolderIdِ همان کتاب‌ها مستقل می‌ماند.
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          folders: db.libraryFolders,
          library: db.library
        });
        break;
      }

      case 'ASSIGN_TO_LIBRARY_FOLDER': {
        const { filePath, filePaths, folderId = null, comic = {} } = payload;
        const targets = Array.isArray(filePaths)
          ? filePaths
          : filePath
          ? [filePath]
          : [];

        targets.forEach((rawP) => {
          const norm = normalizePath(rawP);
          if (!norm) return;
          const idx = db.library.findIndex(
            (item) => normalizePath(item.path || item.filePath) === norm
          );
          if (idx >= 0) {
            db.library[idx].folderId = folderId || null;
          } else {
            const hist = db.history[norm];
            const cachedCov = coverEntryToUrl(db.coverCache[norm]) || hist?.cover || null;
            db.library.unshift({
              path: rawP,
              normPath: norm,
              name: comic.name || comic.fileName || hist?.fileName || path.basename(rawP),
              cover: isPermanentCover(cachedCov) ? cachedCov : null,
              folderId: folderId || null,
              isPinned: false,
              pinnedAt: null,
              addedAt: new Date().toISOString(),
              lastPage: hist?.currentPage || 1,
              totalPages: hist?.totalPages || 1,
              percentage: hist?.percentage || 0,
              lastReadAt: hist?.updatedAt || null
            });
          }
        });

        // مرحله ۴۹ (C): انتسابِ پوشهٔ کتابخانه، علاقه‌مندی‌ها را دست
        // نمی‌زند؛ favoriteFolderIdِ همان کتاب‌ها مستقل می‌ماند.

        db.library = sortLibraryItems(db.library);
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          library: db.library
        });
        break;
      }

      // =====================================================================
      // مرحله ۴۹ (C): پوشه‌هایِ مستقلِ علاقه‌مندی‌ها — دقیقاً هم‌ارزِ
      // اکشن‌هایِ پوشهٔ کتابخانه، رویِ db.favoriteFolders و
      // favoriteFolderId؛ هیچ‌کدام، libraryFolders یا folderId را
      // دست نمی‌زنند.
      // =====================================================================
      case 'GET_FAVORITE_FOLDERS': {
        sendReply({
          type: 'done',
          action,
          favoriteFolders: db.favoriteFolders || [],
        });
        break;
      }

      case 'CREATE_FAVORITE_FOLDER': {
        const { name, color = '#22d3ee', icon = 'Folder' } = payload;
        const cleanName = (name || '').trim();
        if (!cleanName) {
          sendReply({ type: 'error', action, message: 'نام پوشه نمی‌تواند خالی باشد.' });
          return;
        }

        db.favoriteFolders = Array.isArray(db.favoriteFolders) ? db.favoriteFolders : [];
        const newFolder = {
          id: `favfolder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: cleanName,
          color,
          icon,
          createdAt: new Date().toISOString(),
        };

        db.favoriteFolders.push(newFolder);
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          folder: newFolder,
          favoriteFolders: db.favoriteFolders,
        });
        break;
      }

      case 'RENAME_FAVORITE_FOLDER': {
        const { folderId, name, color } = payload;
        db.favoriteFolders = Array.isArray(db.favoriteFolders) ? db.favoriteFolders : [];
        const target = db.favoriteFolders.find((f) => f.id === folderId);
        if (target) {
          if (name && name.trim()) target.name = name.trim();
          if (color) target.color = color;
          target.updatedAt = new Date().toISOString();
          writeDB(db);
        }
        sendReply({
          type: 'done',
          action,
          success: Boolean(target),
          favoriteFolders: db.favoriteFolders,
        });
        break;
      }

      case 'DELETE_FAVORITE_FOLDER': {
        const { folderId } = payload;
        db.favoriteFolders = (db.favoriteFolders || []).filter((f) => f.id !== folderId);
        // علاقه‌مندی‌هایِ داخلِ پوشهٔ حذف‌شده بی‌پوشه می‌شوند؛ خودِ
        // کتاب‌ها حذف نمی‌شوند و پوشه‌هایِ کتابخانه دست نمی‌خورند.
        (db.favorites || []).forEach((item) => {
          if (item.favoriteFolderId === folderId) {
            item.favoriteFolderId = null;
          }
        });
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          favoriteFolders: db.favoriteFolders,
          favorites: db.favorites,
        });
        break;
      }

      case 'ASSIGN_TO_FAVORITE_FOLDER': {
        const { filePath, filePaths, folderId = null, comic = {} } = payload;
        const targets = Array.isArray(filePaths)
          ? filePaths
          : filePath
          ? [filePath]
          : [];

        targets.forEach((rawP) => {
          const norm = normalizePath(rawP);
          if (!norm) return;
          const idx = (db.favorites || []).findIndex(
            (item) => normalizePath(item.path || item.filePath) === norm
          );
          if (idx >= 0) {
            db.favorites[idx].favoriteFolderId = folderId || null;
          } else {
            const hist = db.history[norm];
            const cachedCov = coverEntryToUrl(db.coverCache[norm]) || hist?.cover || null;
            db.favorites.unshift({
              path: rawP,
              normPath: norm,
              name: comic.name || comic.fileName || hist?.fileName || path.basename(rawP),
              cover: isPermanentCover(cachedCov) ? cachedCov : null,
              favoriteFolderId: folderId || null,
              lastPage: hist?.currentPage || 1,
              totalPages: hist?.totalPages || 1,
              percentage: hist?.percentage || 0,
              favoritedAt: new Date().toISOString(),
            });
          }
        });

        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          favorites: db.favorites,
        });
        break;
      }

      case 'SET_CUSTOM_COVER': {
        const { filePath, dataUrl } = payload;
        if (!filePath || !isPermanentCover(dataUrl)) {
          sendReply({ type: 'error', action, message: 'تصویر کاور معتبر نیست.' });
          return;
        }
        const norm = normalizePath(filePath);
        const resolvedCover = syncCoverAcrossTables(db, norm, dataUrl, true);
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          cover: resolvedCover || dataUrl,
          library: db.library
        });
        break;
      }

      // =====================================================================
      // إدارة التعليقات التوضيحية والتظليل والأشكال (Page Annotations)
      // =====================================================================
      case 'GET_ANNOTATIONS': {
        const { filePath, pageNumber } = payload;
        const norm = normalizePath(filePath);
        db.annotations = db.annotations || {};
        const docAnnots = db.annotations[norm] || {};
        if (pageNumber !== undefined && pageNumber !== null) {
          sendReply({
            type: 'done',
            action,
            items: docAnnots[String(pageNumber)] || []
          });
        } else {
          sendReply({
            type: 'done',
            action,
            annotations: docAnnots
          });
        }
        break;
      }

      // مرحلهٔ ۳۱ — مجموعِ حاشیه‌نویسی‌ها برایِ نمایِ پروفایل:
      // فقط خواندنی است (writeDB ندارد) و رویِ نقشهٔ درون‌حافظه‌ای
      // می‌دود، پس برایِ کتابخانه‌هایِ بزرگ هم ارزان است. شکلِ
      // ذخیره: db.annotations[مسیرِ نرمال] = {شمارهٔ صفحه: [آیتم]}.
      case 'GET_ANNOTATION_TOTALS': {
        const allDocs = (db.annotations && typeof db.annotations === 'object') ? db.annotations : {};
        let totalItems = 0;
        let annotatedPages = 0;
        let annotatedFiles = 0;
        for (const docKey of Object.keys(allDocs)) {
          const doc = allDocs[docKey] || {};
          let docItems = 0;
          for (const pageKey of Object.keys(doc)) {
            const pageItems = Array.isArray(doc[pageKey]) ? doc[pageKey] : [];
            if (pageItems.length > 0) annotatedPages += 1;
            docItems += pageItems.length;
          }
          if (docItems > 0) annotatedFiles += 1;
          totalItems += docItems;
        }
        sendReply({ type: 'done', action, totalItems, annotatedPages, annotatedFiles });
        break;
      }

      case 'GET_ANNOTATION_COUNTS': {
        const allDocs = (db.annotations && typeof db.annotations === 'object') ? db.annotations : {};
        const counts = {};
        for (const docKey of Object.keys(allDocs)) {
          const doc = allDocs[docKey] || {};
          let n = 0;
          for (const pageKey of Object.keys(doc)) {
            const pageItems = Array.isArray(doc[pageKey]) ? doc[pageKey] : [];
            n += pageItems.length;
          }
          if (n > 0) counts[docKey] = n;
        }
        sendReply({ type: 'done', action, counts });
        break;
      }

      case 'GET_CUSTOM_STAT_VIEWS': {
        const views = Array.isArray(db.customStatViews) ? db.customStatViews : [];
        sendReply({ type: 'done', action, views });
        break;
      }

      case 'SAVE_CUSTOM_STAT_VIEWS': {
        const { views = [] } = payload || {};
        if (!Array.isArray(views)) {
          sendReply({ type: 'error', action, message: 'آماربندی‌ها معتبر نیستند.' });
          return;
        }
        const clean = views
          .slice(0, 50)
          .filter((v) => v && typeof v === 'object' && typeof v.name === 'string' && v.name.trim())
          .map((v) => ({
            id: String(v.id || `cv-${Date.now()}`),
            name: String(v.name).slice(0, 60),
            color: typeof v.color === 'string' ? v.color : '#22d3ee',
            bookKeys: Array.isArray(v.bookKeys) ? v.bookKeys.filter((k) => typeof k === 'string').slice(0, 500) : [],
            metrics: Array.isArray(v.metrics) ? v.metrics.filter((m) => typeof m === 'string').slice(0, 10) : [],
            goalHours: Math.max(0, Number(v.goalHours) || 0),
            goalPages: Math.max(0, Number(v.goalPages) || 0),
          }));
        db.customStatViews = clean;
        writeDB(db, true);
        sendReply({ type: 'done', action, views: clean });
        break;
      }

      case 'GET_EPUB_HIGHLIGHTS': {
        const { filePath } = payload || {};
        const norm = normalizePath(filePath);
        const list = (db.epubHighlights && db.epubHighlights[norm]) || [];
        sendReply({ type: 'done', action, highlights: Array.isArray(list) ? list : [] });
        break;
      }

      case 'SAVE_EPUB_HIGHLIGHTS': {
        const { filePath, highlights = [] } = payload || {};
        const norm = normalizePath(filePath);
        if (!norm || !Array.isArray(highlights)) {
          sendReply({ type: 'error', action, message: 'هایلایت‌ها معتبر نیستند.' });
          return;
        }
        const clean = highlights
          .slice(0, 5000)
          .filter((h) => h && typeof h === 'object' && Number.isFinite(Number(h.chapterIndex)))
          .map((h) => ({
            id: String(h.id || ''),
            chapterIndex: Math.floor(Number(h.chapterIndex)),
            color: typeof h.color === 'string' ? h.color : '#facc15',
            text: String(h.text || '').slice(0, 2000),
            note: String(h.note || '').slice(0, 2000),
            startOffset: Math.max(0, Math.floor(Number(h.startOffset) || 0)),
            endOffset: Math.max(0, Math.floor(Number(h.endOffset) || 0)),
            createdAt: Number(h.createdAt) || Date.now(),
          }));
        if (!db.epubHighlights || typeof db.epubHighlights !== 'object') db.epubHighlights = {};
        db.epubHighlights[norm] = clean;
        writeDB(db);
        sendReply({ type: 'done', action, success: true });
        break;
      }

      case 'SAVE_ANNOTATIONS': {
        const { filePath, pageNumber, items = [] } = payload;
        const norm = normalizePath(filePath);
        if (!norm || pageNumber === undefined || pageNumber === null) {
          sendReply({ type: 'error', action, message: 'اطلاعات صفحه نامعتبر است.' });
          return;
        }
        db.annotations = db.annotations || {};
        if (!db.annotations[norm]) {
          db.annotations[norm] = {};
        }

        const pageKey = String(pageNumber);
        if (!Array.isArray(items) || items.length === 0) {
          delete db.annotations[norm][pageKey];
        } else {
          db.annotations[norm][pageKey] = items;
        }

        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          items: db.annotations[norm][pageKey] || []
        });
        break;
      }

      case 'CLEAR_ANNOTATIONS': {
        const { filePath, pageNumber } = payload;
        const norm = normalizePath(filePath);
        if (norm && db.annotations && db.annotations[norm]) {
          if (pageNumber !== undefined && pageNumber !== null) {
            delete db.annotations[norm][String(pageNumber)];
          } else {
            delete db.annotations[norm];
          }
          writeDB(db);
        }
        sendReply({ type: 'done', action, success: true });
        break;
      }

      case 'TOGGLE_FAVORITE': {
        const { comic } = payload;
        const filePath = comic?.path || comic?.filePath;
        if (!filePath) {
          sendReply({ type: 'error', action, message: 'آدرس فایل برای لایک مشخص نیست.' });
          return;
        }

        const norm = normalizePath(filePath);
        const existingIdx = db.favorites.findIndex(
          (item) => normalizePath(item.path || item.filePath) === norm
        );
        let isFav = false;

        if (existingIdx >= 0) {
          db.favorites.splice(existingIdx, 1);
          // مرحله ۲ ـ بخش ب: برداشتنِ لایک هم یک حذف از جدولِ کاربری
          // است و همان قاعدهٔ GC را دارد (در بخش الف جا افتاده بود).
          const favCoverFile = coverFileFromUrl(comic.cover);
          purgeCoverCacheEntryIfBookGone(db, norm);
          if (favCoverFile) deleteCoverFileIfUnreferenced(db, favCoverFile);
          isFav = false;
        } else {
          const hist = db.history[norm];
          let cachedCover = isPermanentCover(comic.cover)
            ? comic.cover
            : coverEntryToUrl(db.coverCache[norm]) || hist?.cover || null;

          if (!isPermanentCover(cachedCover)) cachedCover = null;

          const favEntry = {
            path: filePath,
            normPath: norm,
            name: comic.name || comic.fileName || path.basename(filePath),
            cover: cachedCover,
            // مرحله ۴۹ (C): علاقه‌مندیِ تازه، بدونِ پوشهٔ علاقه‌مندی
            // شروع می‌شود؛ پوشهٔ کتاب در کتابخانه ارث برده نمی‌شود.
            // فقط favoriteFolderIdِ همراهِ فراخوان گرفته می‌شود.
            favoriteFolderId: comic?.favoriteFolderId || null,
            lastPage: hist?.currentPage || comic.lastPage || 1,
            totalPages: hist?.totalPages || comic.totalPages || 1,
            percentage: hist?.percentage || 0,
            favoritedAt: new Date().toISOString()
          };
          db.favorites.unshift(favEntry);
          isFav = true;
        }

        writeDB(db);
        sendReply({ type: 'done', action, isFavorite: isFav, favorites: db.favorites });
        break;
      }

      case 'GET_FAVORITES': {
        sendReply({
          type: 'done',
          action,
          favorites: db.favorites,
          favoriteFolders: db.favoriteFolders || [],
        });
        break;
      }

      case 'REMOVE_FROM_FAVORITES': {
        const { filePath } = payload;
        const norm = normalizePath(filePath);
        const removed = db.favorites.find((item) => normalizePath(item.path || item.filePath) === norm);
        const removedFile = removed ? coverFileFromUrl(removed.cover) : null;
        db.favorites = db.favorites.filter(
          (item) => normalizePath(item.path || item.filePath) !== norm
        );
        // مرحله ۲ ـ بخش ب: مثل حذف از کتابخانه (بخش الف جا انداخته بود
        // که کشِ خودارجاع، فایل را نگه می‌دارد).
        purgeCoverCacheEntryIfBookGone(db, norm);
        if (removedFile) deleteCoverFileIfUnreferenced(db, removedFile);
        writeDB(db);
        sendReply({ type: 'done', action, favorites: db.favorites });
        break;
      }

      case 'SAVE_PROFILE': {
        const { username, subtitle, dailyGoalPages, avatarGradient } = payload;
        db.profile = {
          ...db.profile,
          ...(username ? { username: username.trim() } : {}),
          ...(subtitle !== undefined ? { subtitle: subtitle.trim() } : {}),
          ...(dailyGoalPages ? { dailyGoalPages: Number(dailyGoalPages) } : {}),
          ...(avatarGradient ? { avatarGradient } : {}),
          updatedAt: new Date().toISOString()
        };
        writeDB(db);
        sendReply({ type: 'done', action, profile: db.profile });
        break;
      }

      case 'SAVE_PROFILE_AVATAR': {
        const { avatar, avatarGradient } = payload;
        db.profile.avatar = avatar || null;
        if (avatarGradient) {
          db.profile.avatarGradient = avatarGradient;
        }
        db.profile.updatedAt = new Date().toISOString();
        writeDB(db);
        sendReply({ type: 'done', action, success: true, profile: db.profile });
        break;
      }

      case 'GET_PROFILE': {
        sendReply({ type: 'done', action, profile: db.profile || defaultDB.profile });
        break;
      }

      case 'CACHE_COVER': {
        const { filePath, dataUrl, isCustom = false } = payload;
        if (filePath && isPermanentCover(dataUrl)) {
          const norm = normalizePath(filePath);
          syncCoverAcrossTables(db, norm, dataUrl, Boolean(isCustom));
          writeDB(db);
        }
        sendReply({ type: 'done', action, success: true });
        break;
      }

      case 'GET_CACHED_COVER': {
        const { filePath } = payload;
        const norm = normalizePath(filePath);
        const cached = db.coverCache[norm] || null;
        const cachedUrl = coverEntryToUrl(cached);
        const validCover = isPermanentCover(cachedUrl) ? cachedUrl : null;
        sendReply({
          type: 'done',
          action,
          cover: validCover,
          isCustom: Boolean(cached?.isCustom)
        });
        break;
      }

      case 'GET_ALL_COVER_CACHES': {
        const simplified = {};
        Object.entries(db.coverCache || {}).forEach(([k, v]) => {
          const dUrl = coverEntryToUrl(v);
          if (isPermanentCover(dUrl)) {
            simplified[k] = dUrl;
          }
        });
        sendReply({ type: 'done', action, covers: simplified });
        break;
      }

      case 'SAVE_SETTING': {
        const { key, value } = payload;
        if (key) {
          db.settings = db.settings || {};
          db.settings[key] = value;
          writeDB(db);
          sendReply({ type: 'done', action, success: true, settings: db.settings });
        }
        break;
      }

      case 'GET_SETTINGS': {
        sendReply({ type: 'done', action, settings: db.settings || defaultDB.settings });
        break;
      }

      case 'SAVE_SHORTCUTS': {
        const { shortcuts } = payload;
        if (shortcuts && typeof shortcuts === 'object') {
          db.shortcuts = shortcuts;
          writeDB(db);
          sendReply({ type: 'done', action, success: true, shortcuts: db.shortcuts });
        }
        break;
      }

      case 'GET_SHORTCUTS': {
        sendReply({ type: 'done', action, shortcuts: db.shortcuts || {} });
        break;
      }

      case 'BUILD_BACKUP': {
        buildBackupZip()
          .then((result) => {
            sendReply({ type: 'done', action, success: true, ...result });
          })
          .catch((err) => {
            sendReply({ type: 'error', action, message: err && err.message ? err.message : 'خطا در ساخت فایل پشتیبان.' });
          });
        break;
      }

      case 'RESTORE_BACKUP': {
        const { base64 } = payload || {};
        if (!base64 || typeof base64 !== 'string') {
          sendReply({ type: 'error', action, message: 'دادهٔ فایل پشتیبان ارسال نشده است.' });
          break;
        }
        // فلاشِ اول: تا نوشتنِ debounceِ در حالِ انجام، دیتابیسِ فعلی
        // روی دیسک کامل شود و کپیِ .pre-restore.bak، تازه‌ترین وضعیت باشد.
        handleFlushSync()
          .then(() => applyRestoreFromZip(Buffer.from(base64, 'base64')))
          .then((result) => {
            sendReply({ type: 'done', action, success: true, ...result });
          })
          .catch((err) => {
            sendReply({ type: 'error', action, message: err && err.message ? err.message : 'خطا در بازیابیِ فایل پشتیبان.' });
          });
        break;
      }

      case 'SYNC_AND_CLEAN_MISSING_FILES': {
        // مرحلهٔ ۵۲ §۱: یک پیامِ دسته‌ای؛ payload.paths اختیاری است
        // (فقط همان مسیرها بررسی می‌شوند؛ باز هم بدونِ حلقهٔ IPC).
        const stats = syncMissingFiles(db, false, payload && payload.paths);
        sendReply({ type: 'done', action, success: true, ...stats });
        break;
      }

      case 'PRUNE_MISSING_FILES': {
        // مرحلهٔ ۵۲ §۱: نامِ قدیمیِ امن‌شده — حالا همان همگام‌سازیِ
        // §۱ است؛ کتاب از کتابخانه/علاقه‌مندی‌ها حذف نمی‌شود.
        const stats = syncMissingFiles(db, false);
        sendReply({ type: 'done', action, success: true, ...stats });
        break;
      }

      case 'CLEAR_ALL_COVERS': {
        const stats = clearOnlyCovers(db, true);
        sendReply({ type: 'done', action, success: true, ...stats });
        break;
      }

      case 'GET_ALL_BOOKMARKS': {
        // مرحله ۱۴: همهٔ بوک‌مارک‌هایِ همهٔ کتاب‌ها، برای نمایِ
        // سراسریِ سایدبار و بجِ شمارنده. مسیرِ قابلِ باز شدن، از
        // تاریخچه/کتابخانه/علاقه‌مندی‌ها برداشته می‌شود تا حروفِ
        // بزرگ‌وکوچکِ اصلیِ مسیر حفظ شود (کلیدِ نرمال‌شده، کوچک
        // شده است؛ در ویندوز فرقی نمی‌کند، ولی اصل، دقیق‌تر است).
        db.bookmarks = db.bookmarks || {};
        const files = [];
        let total = 0;
        Object.entries(db.bookmarks).forEach(([norm, list]) => {
          const clean = (Array.isArray(list) ? list : []).map(sanitizeBookmarkRecord).filter(Boolean);
          if (clean.length === 0) return;
          const hist = db.history && db.history[norm];
          const libItem = (db.library || []).find((it) => normalizePath(it.path || it.filePath) === norm);
          const favItem = (db.favorites || []).find((it) => normalizePath(it.path || it.filePath) === norm);
          const filePath = (hist && (hist.filePath || hist.path))
            || (libItem && (libItem.path || libItem.filePath))
            || (favItem && (favItem.path || favItem.filePath))
            || norm;
          const fileName = String(filePath).split(/[\\/]/).pop() || norm;
          files.push({ filePath, fileName, bookmarks: clean });
          total += clean.length;
        });
        files.sort((a, b) => String(a.fileName).localeCompare(String(b.fileName)));
        sendReply({ type: 'done', action, files, total });
        break;
      }

      case 'GET_BOOKMARKS': {
        const { filePath } = payload;
        const norm = normalizePath(filePath);
        db.bookmarks = db.bookmarks || {};
        const list = (db.bookmarks[norm] || []).map(sanitizeBookmarkRecord).filter(Boolean);
        sendReply({ type: 'done', action, bookmarks: list });
        break;
      }

      case 'SAVE_BOOKMARKS': {
        const { filePath, bookmarks = [] } = payload;
        const norm = normalizePath(filePath);
        if (!norm) { sendReply({ type: 'error', action, message: 'مسیرِ فایل نامعتبر است.' }); break; }
        db.bookmarks = db.bookmarks || {};
        const clean = (Array.isArray(bookmarks) ? bookmarks : []).map(sanitizeBookmarkRecord).filter(Boolean);
        if (clean.length === 0) delete db.bookmarks[norm];
        else db.bookmarks[norm] = clean;
        // مرحله ۱۹ — فلشِ همگام و فوری روی دیسک (مانندِ
        // SAVE_BOOKMARK_PREFERENCES در مرحلهٔ ۱۶ب): گذاشتن، تغییرِ
        // نام، جابه‌جایی یا حذفِ بوک‌مارک، در همان میلی‌ثانیه رویِ
        // db.json می‌نشیند و به تایمرِ ۹۰۰ میلی‌ثانیه‌ای وابسته نیست.
        writeDB(db, true);
        sendReply({ type: 'done', action, success: true, bookmarks: clean });
        break;
      }

      case 'GET_BOOKMARK_PREFERENCES': {
        db.bookmarkPreferences = db.bookmarkPreferences || { ...defaultDB.bookmarkPreferences };
        sendReply({ type: 'done', action, preferences: db.bookmarkPreferences });
        break;
      }

      case 'SAVE_BOOKMARK_PREFERENCES': {
        const { preferences = {} } = payload;
        const next = { ...defaultDB.bookmarkPreferences, templateImages: {} };
        if (BOOKMARK_TEMPLATE_IDS.includes(preferences.defaultTemplate)) next.defaultTemplate = preferences.defaultTemplate;
        if (typeof preferences.globalImage === 'string') next.globalImage = preferences.globalImage;
        else if (preferences.globalImage === null) next.globalImage = null;
        if (preferences.templateImages && typeof preferences.templateImages === 'object') {
          Object.entries(preferences.templateImages).forEach(([id, url]) => {
            if (BOOKMARK_TEMPLATE_IDS.includes(id) && typeof url === 'string' && url) next.templateImages[id] = url;
          });
        }
        if (preferences.defaultSide === 'left' || preferences.defaultSide === 'right') next.defaultSide = preferences.defaultSide;
        // مرحله ۱۴: پریست‌ها — اگر فیلد نفرستاده شد، مقدارِ قبلی
        // حفظ می‌شود تا ذخیرهٔ جزئیِ تنظیمات، ساخته‌هایِ کاربر را
        // پاک نکند؛ اگر فرستاده شد، پاک‌سازی و سقفِ ۱۰۰ اعمال می‌شود.
        if (Array.isArray(preferences.savedPresets)) {
          next.savedPresets = [];
          preferences.savedPresets.forEach((p) => {
            const clean = sanitizeBookmarkPreset(p);
            if (clean && next.savedPresets.length < 100) next.savedPresets.push(clean);
          });
        } else if (db.bookmarkPreferences && Array.isArray(db.bookmarkPreferences.savedPresets)) {
          next.savedPresets = db.bookmarkPreferences.savedPresets;
        }
        db.bookmarkPreferences = next;
        // مرحله ۱۶، بخش ب: فلشِ فوری و همگام به دیسک — پریست باید
        // حتی اگر کاربر ۱ ثانیه بعد برنامه را بست، سرِ جایش باشد؛
        // نوشتنِ debounceدارِ ۹۰۰ میلی‌ثانیه‌ای برایِ این مسیر کافی نیست.
        writeDB(db, true);
        sendReply({ type: 'done', action, success: true, preferences: next });
        break;
      }

      case 'GET_CUSTOM_COLOR_SYSTEM': {
        db.customColorSystem = db.customColorSystem || { ...defaultDB.customColorSystem };
        sendReply({ type: 'done', action, customColorSystem: db.customColorSystem });
        break;
      }

      case 'SAVE_CUSTOM_COLOR_SYSTEM': {
        const { customColorSystem = {} } = payload;
        const next = { favoriteColors: [], customColorTemplates: [], toolColors: {} };
        if (Array.isArray(customColorSystem.favoriteColors)) {
          customColorSystem.favoriteColors.forEach((c) => {
            if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) && next.favoriteColors.length < 48) next.favoriteColors.push(c);
          });
        }
        if (Array.isArray(customColorSystem.customColorTemplates)) {
          customColorSystem.customColorTemplates.forEach((t) => {
            if (!t || typeof t !== 'object' || typeof t.id !== 'string' || typeof t.name !== 'string' || !Array.isArray(t.colors)) return;
            if (next.customColorTemplates.length >= 24) return;
            next.customColorTemplates.push({
              id: t.id,
              name: String(t.name).slice(0, 40),
              colors: t.colors.filter((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 12),
            });
          });
        }
        if (customColorSystem.toolColors && typeof customColorSystem.toolColors === 'object') {
          for (const k of ['pen', 'highlighter', 'box', 'arrow', 'text', 'sticky']) {
            if (typeof customColorSystem.toolColors[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(customColorSystem.toolColors[k])) next.toolColors[k] = customColorSystem.toolColors[k];
          }
        }
        db.customColorSystem = next;
        writeDB(db, true);
        sendReply({ type: 'done', action, success: true, customColorSystem: next });
        break;
      }

      case 'GET_COVER_STATS': {
        const stats = getCoverStats(db);
        sendReply({ type: 'done', action, success: true, ...stats });
        break;
      }

      case 'PREVIEW_PRUNE_MISSING_FILES': {
        const stats = syncMissingFiles(db, true);
        sendReply({ type: 'done', action, success: true, ...stats });
        break;
      }

      case 'CLEAR_ONLY_COVERS': {
        const preserveCustom = payload.preserveCustom !== false;
        const stats = clearOnlyCovers(db, preserveCustom);
        sendReply({ type: 'done', action, success: true, ...stats });
        break;
      }

      default:
        sendReply({
          type: 'error',
          action,
          message: `دستور ${action} در ورکر دیتابیس پشتیبانی نمی‌شود.`
        });
    }
  } catch (error) {
    sendReply({ type: 'error', action, message: 'خطای سیستمی دیتابیس: ' + error.message });
  }
});