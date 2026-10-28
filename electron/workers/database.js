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

const MAX_COVER_CACHE_ENTRIES = 300;

const defaultDB = {
  history: {},
  library: [],
  libraryFolders: [],
  favorites: [],
  annotations: {},
  readingStats: { days: {} },
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
    if (cleanCoverCache[norm]?.isCustom && isPermanentCover(cleanCoverCache[norm]?.cover)) {
      item.cover = cleanCoverCache[norm].cover;
    } else if (!isPermanentCover(item.cover)) {
      item.cover = cleanCoverCache[norm]?.cover || null;
    }
  });

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
      };
    }
  }
  const readingStats = { days: readingStatsDays };

  return {
    history,
    library: sortLibraryItems(library),
    libraryFolders,
    favorites,
    annotations,
    readingStats,
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
    cachedDbInstance = migrateSchema(parsed);
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

parentPort.on('message', (request) => {
  const { reqId, action, payload = {} } = request || {};
  let db = readDB();

  const sendReply = (msgObj) => {
    parentPort.postMessage(reqId !== undefined ? { ...msgObj, reqId } : msgObj);
  };

  try {
    switch (action) {
      case 'FLUSH_SYNC': {
        // پاسخ، صراحتاً FLUSH_SYNC_ACK است تا main در handshakeِ خروج
        // آن را از پاسخ‌های عادیِ db-action تشخیص بدهد. اگر main این
        // پیام را با reqId فرستاده باشد، sendReply همان reqId را هم
        // برمی‌گرداند.
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

        const historyEntry = {
          filePath,
          normPath: norm,
          fileName: fileName || existingHist?.fileName || path.basename(filePath),
          cover: resolvedCover,
          currentPage: validPage,
          totalPages: validTotal,
          percentage,
          updatedAt: now
        };

        db.history[norm] = historyEntry;

        const libItem = db.library.find((item) => normalizePath(item.path || item.filePath) === norm);
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
        const { date, pages = 0, seconds = 0 } = payload || {};
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          sendReply({ type: 'error', action, message: 'تاریخِ فعالیت معتبر نیست.' });
          return;
        }
        const addPages = Math.max(0, Math.min(10000, Math.floor(Number(pages) || 0)));
        const addSeconds = Math.max(0, Math.min(86400, Math.floor(Number(seconds) || 0)));
        if (addPages === 0 && addSeconds === 0) {
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
        };
        // هرسِ روزهای خیلی قدیمی (بیش از ۱۰۹۵ روز) در همان نوشتن.
        const dayKeys = Object.keys(db.readingStats.days).sort();
        if (dayKeys.length > 1095) {
          for (const oldKey of dayKeys.slice(0, dayKeys.length - 1095)) {
            delete db.readingStats.days[oldKey];
          }
        }
        writeDB(db);
        sendReply({ type: 'done', action, success: true, days: db.readingStats.days });
        break;
      }

      case 'GET_READING_STATS': {
        const days =
          db.readingStats && typeof db.readingStats === 'object' && db.readingStats.days && typeof db.readingStats.days === 'object'
            ? db.readingStats.days
            : {};
        sendReply({ type: 'done', action, days });
        break;
      }

      case 'GET_RECENTS': {
        const recents = Object.values(db.history)
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
          .slice(0, 100);
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
          const cachedCov = coverEntryToUrl(db.coverCache[norm]) || hist?.cover || null;
          db.library.unshift({
            path: targetPath,
            normPath: norm,
            name: comic.name || comic.fileName || hist?.fileName || path.basename(targetPath),
            cover: isPermanentCover(cachedCov) ? cachedCov : null,
            folderId: comic.folderId || null,
            isPinned: true,
            pinnedAt: now,
            addedAt: now,
            lastPage: hist?.currentPage || 1,
            totalPages: hist?.totalPages || 1,
            percentage: hist?.percentage || 0,
            lastReadAt: hist?.updatedAt || null
          });
        }

        db.library = sortLibraryItems(db.library);
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
        sendReply({ type: 'done', action, favorites: db.favorites });
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