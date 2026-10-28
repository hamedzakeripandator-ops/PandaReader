// ============================================================================
// backupFormat.js — قالبِ خالصِ فایلِ پشتیبانِ یک‌کلیکی (بدونِ وابستگی به
// worker_threads یا Electron؛ تا هم ورکرِ دیتابیس آن را require کند و هم
// در تستِ مستقیمِ Node قابلِ فراخوانی باشد).
//
// قالبِ فایل: یک ZIP استاندارد (ساخته‌شده با jszip) با پسوندِ
// ‎.crbackup (که همان ZIP است؛ پسوند فقط برای تشخیصِ راحت‌تر است و
// هر ابزارِ ZIPی می‌تواند آن را باز کند):
//   manifest.json        — نسخهٔ قالب + sha256 و اندازهٔ db.json + شمارِ کاورها
//   db.json              — رونوشتِ دقیقِ بایت‌های db.jsonِ فلاش‌شده روی دیسک
//   covers/<filename>    — هر فایلِ موجود در پوشهٔ covers (فقط نامِ فایل،
//                          بدونِ مسیر؛ نام‌ها پیش از نوشتن اعتبارسنجی می‌شوند)
//
// چرا ZIP و چرا jszip؟ jszip از قبل در پروژه هست و در worker_threads
// اثبات‌شده کار می‌کند (fileExtractor.js با همان require('jszip') در
// محیطِ واقعی، آرشیوهای تو‌در‌تو را باز می‌کند)؛ پس هیچ وابستگیِ
// تازه‌ای به پروژه اضافه نمی‌شود و بیلد هم نمی‌شکند. قالبِ دست‌سازِ
// zlib + JSON هم ممکن بود، ولی ZIP استاندارد این مزیت را دارد که
// کاربر می‌تواند فایلِ پشتیبان را با هر ابزارِ فشرده‌سازیِ معمولی
// باز کند و ببیند داخلش چیست.
// ============================================================================

const crypto = require('crypto');
const path = require('path');

const BACKUP_FORMAT_VERSION = 1;
const BACKUP_MANIFEST_NAME = 'manifest.json';
const BACKUP_DB_NAME = 'db.json';
const BACKUP_COVERS_PREFIX = 'covers/';
const BACKUP_FILE_EXTENSION = 'crbackup';

// سقف‌های ایمنی در برابرِ فایلِ پشتیبانِ خراب یا مخرب (zip-bomb):
// فایلِ پشتیبانِ واقعیِ این برنامه (db.jsonِ چند مگابایتی + کاورهای
// چند صد کیلوبایتی) خیلی زیرِ این سقف‌هاست.
const MAX_BACKUP_BYTES = 512 * 1024 * 1024; // 512MB کلِ فایل
const MAX_DB_BYTES = 64 * 1024 * 1024; // 64MB برای db.json
const MAX_COVER_BYTES = 50 * 1024 * 1024; // 50MB برای هر کاور
const MAX_BACKUP_ENTRIES = 10000;

// کلیدهای سطحِ بالای db.json که migrateSchema می‌شناسد. فایلِ پشتیبانِ
// سالم، که با همین کد ساخته شده، هر ۹ کلیدِ الزامی را دارد؛ بازیابی،
// هر ۹ تا را با نوعِ درست می‌خواهد تا یک JSONِ بی‌ربط (مثلاً یک فایلِ
// تنظیماتِ دیگر) نتواند کتابخانهٔ کاربر را با یک دیتابیسِ خالی جایگزین
// کند. کلیدِ دهم (`readingStats`، مرحله ۶) اختیاری است تا پشتیبان‌های
// قدیمی همچنان بازیابی شوند؛ اگر هست، باید شیء باشد (در ادامه بررسی
// می‌شود).
const DB_TOP_LEVEL_KEYS = {
  history: 'object',
  library: 'array',
  libraryFolders: 'array',
  favorites: 'array',
  annotations: 'object',
  profile: 'object',
  coverCache: 'object',
  shortcuts: 'object',
  settings: 'object',
};

const COVER_URL_PREFIX = 'comic://covers/';

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * ساختِ manifest برای یک پشتیبانِ تازه. sha256 روی بایت‌های دقیقِ
 * db.json محاسبه می‌شود تا بازیابی بتواند یکپارچگی را پیش از هر
 * جایگزینی بررسی کند.
 */
function createBackupManifest({ dbBytes, coverCount }) {
  return {
    format: 'comic-reader-backup',
    version: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    dbSha256: sha256Hex(dbBytes),
    dbSize: dbBytes.length,
    coverCount: Number(coverCount) || 0,
  };
}

/**
 * اعتبارسنجیِ manifestِ خوانده‌شده از فایلِ پشتیبان.
 * @returns {string|null} پیامِ خطا، یا null اگر معتبر است.
 */
function validateBackupManifest(manifest) {
  if (!isPlainObject(manifest)) return 'فایل manifest پشتیبان معتبر نیست.';
  if (manifest.format !== 'comic-reader-backup') {
    return 'این فایل، فایل پشتیبان این برنامه نیست.';
  }
  if (manifest.version !== BACKUP_FORMAT_VERSION) {
    return `نسخهٔ فایل پشتیبان (${manifest.version}) پشتیبانی نمی‌شود.`;
  }
  if (typeof manifest.dbSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.dbSha256)) {
    return 'اثر انگشت (sha256) دیتابیس در manifest پشتیبان معتبر نیست.';
  }
  if (!Number.isFinite(manifest.dbSize) || manifest.dbSize <= 0 || manifest.dbSize > MAX_DB_BYTES) {
    return 'اندازهٔ دیتابیس در manifest پشتیبان معتبر نیست.';
  }
  if (!Number.isFinite(manifest.coverCount) || manifest.coverCount < 0) {
    return 'شمار کاورها در manifest پشتیبان معتبر نیست.';
  }
  return null;
}

/**
 * اعتبارسنجیِ ساختارِ db.jsonِ بازیابی‌شده، پیش از هر جایگزینی.
 * @returns {string|null} پیامِ خطا، یا null اگر معتبر است.
 */
function validateRestoredDb(parsed) {
  if (!isPlainObject(parsed)) return 'دیتابیس داخل فایل پشتیبان معتبر نیست.';
  const missing = [];
  for (const [key, kind] of Object.entries(DB_TOP_LEVEL_KEYS)) {
    const value = parsed[key];
    if (value === undefined) {
      missing.push(key);
    } else if (kind === 'array' && !Array.isArray(value)) {
      missing.push(`${key} (نوع نادرست)`);
    } else if (kind === 'object' && !isPlainObject(value)) {
      missing.push(`${key} (نوع نادرست)`);
    }
  }
  if (missing.length > 0) {
    return `دیتابیس داخل فایل پشتیبان ناقص است (بخش‌های گم‌شده: ${missing.join('، ')})؛ بازیابی انجام نشد تا اطلاعات فعلی آسیب نبیند.`;
  }
  // مرحله ۶: readingStats اختیاری است (پشتیبان‌های قدیمی آن را ندارند)،
  // ولی اگر هست باید شیء باشد؛ وگرنه بازیابیِ آمار، خراب تحویل داده می‌شود.
  if (parsed.readingStats !== undefined && !isPlainObject(parsed.readingStats)) {
    return 'بخشِ آمارِ مطالعه در دیتابیسِ پشتیبان معتبر نیست؛ بازیابی انجام نشد.';
  }
  if (parsed.readingStats !== undefined && parsed.readingStats.days !== undefined && !isPlainObject(parsed.readingStats.days)) {
    return 'بخشِ آمارِ مطالعه در دیتابیسِ پشتیبان معتبر نیست؛ بازیابی انجام نشد.';
  }
  return null;
}

/** استخراجِ نامِ فایلِ کاور از روی URLای comic://covers/... (با حذفِ ?v=). */
function coverFileFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.startsWith(COVER_URL_PREFIX)) return null;
  const withoutQuery = url.slice(COVER_URL_PREFIX.length).split('?')[0];
  const file = withoutQuery.split('/').pop();
  return file || null;
}

/**
 * همهٔ نامِ فایل‌های کاوری که دیتابیس به آن‌ها ارجاع می‌دهد
 * (از جدول‌های کاربری + coverCache). بازیابی بررسی می‌کند که هر
 * ارجاع، فایلِ متناظرش داخلِ پشتیبان باشد؛ وگرنه پشتیبان ناقص است.
 */
function collectBackupCoverReferences(db) {
  const referenced = new Set();
  const addFromCover = (cover) => {
    const file = coverFileFromUrl(cover);
    if (file) referenced.add(file);
  };
  Object.values(db.history || {}).forEach((h) => addFromCover(h && h.cover));
  (db.library || []).forEach((item) => addFromCover(item && item.cover));
  (db.favorites || []).forEach((item) => addFromCover(item && item.cover));
  Object.values(db.coverCache || {}).forEach((entry) => {
    const cover = typeof entry === 'string' ? entry : entry && (entry.cover || entry.dataUrl);
    addFromCover(cover);
  });
  return referenced;
}

/**
 * نامِ فایلِ کاورِ داخلِ ZIP باید امن باشد: فقط نامِ فایل (بدونِ
 * مسیر)، بدونِ کاراکترهای مسیر، و با پسوندِ تصویریِ مجاز. این تابع،
 * نام‌های مشکوک (مثل ‎../x یا C:\...) را رد می‌کند تا فایلِ پشتیبانِ
 * دست‌کاری‌شده نتواند بیرون از پوشهٔ covers چیزی بنویسد.
 */
function isSafeCoverFileName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name !== path.basename(name)) return false;
  if (name.includes('\\') || name.includes('/') || name.includes('\0')) return false;
  if (name === '.' || name === '..') return false;
  const ext = path.extname(name).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.svg'].includes(ext);
}

/** نامِ پیش‌فرضِ فایلِ پشتیبان برای دیالوگِ ذخیره. */
function backupDefaultFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `comic-reader-backup-${stamp}.${BACKUP_FILE_EXTENSION}`;
}

module.exports = {
  BACKUP_FORMAT_VERSION,
  BACKUP_MANIFEST_NAME,
  BACKUP_DB_NAME,
  BACKUP_COVERS_PREFIX,
  BACKUP_FILE_EXTENSION,
  MAX_BACKUP_BYTES,
  MAX_DB_BYTES,
  MAX_COVER_BYTES,
  MAX_BACKUP_ENTRIES,
  DB_TOP_LEVEL_KEYS,
  COVER_URL_PREFIX,
  sha256Hex,
  createBackupManifest,
  validateBackupManifest,
  validateRestoredDb,
  coverFileFromUrl,
  collectBackupCoverReferences,
  isSafeCoverFileName,
  backupDefaultFileName,
};
