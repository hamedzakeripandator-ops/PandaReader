// src/services/annotationLocalBackup.js
// فاز ۴، بخش ۳ — آینهٔ localStorage برای حاشیه‌نویسی‌ها.
//
// چرا این فایل وجود دارد؟
//   مسیرِ اصلیِ ذخیره‌سازی، دیتابیسِ Electron است (coreApi.savePageAnnotations
//   → فایلِ JSON روی دیسک) و همان مسیرِ اصلی باقی می‌ماند. این ماژول فقط یک
//   «آینهٔ ایمنی» است برای دو شکافی که مسیرِ اصلی پوشش نمی‌دهد:
//     ۱. وقتی coreApi در دسترس نیست (اجرای بدونِ Electron)، کامیت‌ها فقط در
//        حافظهٔ React می‌مانند و با بستنِ برنامه از بین می‌روند.
//     ۲. وقتی فایلِ دیتابیس گم یا خراب شود، همهٔ صفحاتِ یک سند با هم می‌روند.
//   قانونِ طلایی: هر وقت دیتابیس برای یک صفحه ورودی دارد (حتی آرایهٔ خالی،
//   یعنی «کاربر عمداً پاک کرده»)، دیتابیس برنده است و آینه فقط جاهای خالی
//   را پر می‌کند. پس آینه هرگز چیزی را که کاربر پاک کرده زنده نمی‌کند.
//
// قراردادها:
//   - کلید: `comicReader.annotations.v1:<hash64(filePath)>:<pageNumber>`
//     (هش، کلید را کوتاه و فارغ از کاراکترهای خاصِ مسیر نگه می‌دارد).
//   - مقدار: JSON ‏{ v: 1, filePath, pageNumber, savedAt, items }‏ که items
//     همان آیتم‌های صفحه پس از حذفِ فیلدِ محاسباتیِ `_bbox` است (سریالایزِ تمیز).
//   - همهٔ تابع‌ها در برابرِ نبودنِ localStorage، دادهٔ خراب و خطای Quota
//     مقاوم‌اند و هرگز throw نمی‌کنند تا مسیرِ دیتابیس را خراب نکنند.

const PREFIX = 'comicReader.annotations.v1:';
const MAX_EVICT_ATTEMPTS = 30;

function storageAvailable() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch (_) {
    return false;
  }
}

// هشِ ۵۳ بیتیِ cyrb53 — قطعی، سریع و بدونِ وابستگی.
function hashFilePath(filePath) {
  const str = String(filePath || '');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  return combined;
}

function keyFor(filePath, pageNumber) {
  return PREFIX + hashFilePath(filePath) + ':' + String(Number(pageNumber) || 0);
}

// سریالایزِ تمیز: فقط دادهٔ سادهٔ قابلِ JSON، بدونِ `_bbox` و بدونِ
// فیلدهای محاسباتیِ دیگر. ورودیِ نامعتبر → آرایهٔ خالی.
function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  try {
    const stripped = items.filter(Boolean).map((it) => {
      if (!it || typeof it !== 'object') return null;
      const { _bbox, ...rest } = it;
      return rest;
    }).filter(Boolean);
    return JSON.parse(JSON.stringify(stripped));
  } catch (_) {
    return [];
  }
}

function isQuotaError(err) {
  if (!err) return false;
  if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  const code = err.code;
  return code === 22 || code === 1014;
}

// حذفِ قدیمی‌ترین ورودی‌های آینه تا برای نوشتنِ جدید جا باز شود.
// فقط کلیدهای همین پیشوند لمس می‌شوند؛ بقیهٔ localStorage دست نمی‌خورد.
function evictOldest(count) {
  if (!storageAvailable()) return 0;
  let entries = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      let savedAt = 0;
      try {
        const parsed = JSON.parse(localStorage.getItem(key));
        savedAt = Number(parsed?.savedAt) || 0;
      } catch (_) {
        savedAt = 0;
      }
      entries.push({ key, savedAt });
    }
  } catch (_) {
    return 0;
  }
  entries.sort((a, b) => a.savedAt - b.savedAt);
  let removed = 0;
  for (const entry of entries.slice(0, count)) {
    try {
      localStorage.removeItem(entry.key);
      removed += 1;
    } catch (_) {
      // ادامه بده؛ یک کلیدِ قفل‌شده نباید بقیه را متوقف کند.
    }
  }
  return removed;
}

// نوشتنِ آینه برای یک صفحه. بهترین تلاش (best-effort): در صورتِ Quota،
// قدیمی‌ترین‌ها را تخلیه می‌کند و یک بارِ دیگر تلاش می‌کند؛ اگر باز هم
// نشد، فقط هشدار می‌دهد و هرگز throw نمی‌کند. نوشتنِ آرایهٔ خالی هم
// عمدی است (یعنی «صفحه پاک شده») و نباید نادیده گرفته شود.
function writePageBackup(filePath, pageNumber, items) {
  if (!storageAvailable() || !filePath) return false;
  const key = keyFor(filePath, pageNumber);
  const payload = JSON.stringify({
    v: 1,
    filePath: String(filePath),
    pageNumber: Number(pageNumber) || 0,
    savedAt: Date.now(),
    items: cleanItems(items),
  });
  try {
    localStorage.setItem(key, payload);
    return true;
  } catch (err) {
    if (!isQuotaError(err)) {
      try { console.warn('[annotationLocalBackup] write failed:', err); } catch (_) {}
      return false;
    }
    evictOldest(MAX_EVICT_ATTEMPTS);
    try {
      localStorage.setItem(key, payload);
      return true;
    } catch (err2) {
      try { console.warn('[annotationLocalBackup] write failed after eviction:', err2); } catch (_) {}
      return false;
    }
  }
}

// خواندنِ آینهٔ یک صفحه. دادهٔ خراب یا نسخهٔ ناشناخته → null.
function readPageBackup(filePath, pageNumber) {
  if (!storageAvailable() || !filePath) return null;
  let raw = null;
  try {
    raw = localStorage.getItem(keyFor(filePath, pageNumber));
  } catch (_) {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items)) return null;
    return parsed.items;
  } catch (_) {
    return null;
  }
}

// همهٔ صفحاتِ پشتیبان‌گرفته‌شدهٔ یک سند، به شکلِ { '1': [...], '2': [...] }.
// فقط برای وقتی که دیتابیس در دسترس نیست یا سندی هنوز در دیتابیس نیست.
function restoreBackupsAsPages(filePath) {
  const pages = {};
  if (!storageAvailable() || !filePath) return pages;
  const hash = hashFilePath(filePath);
  const prefix = PREFIX + hash + ':';
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const pagePart = key.slice(prefix.length);
      const pageNum = Number(pagePart);
      if (!Number.isFinite(pageNum) || pageNum <= 0) continue;
      const items = readPageBackup(filePath, pageNum);
      if (items !== null) pages[String(pageNum)] = items;
    }
  } catch (_) {
    // اسکنِ ناقص بهتر از crash است؛ همان صفحاتی که خوانده شده‌اند برمی‌گردند.
  }
  return pages;
}

// ادغامِ آینه در صفحاتِ دیتابیس با قانونِ «دیتابیس برنده است»:
//   - صفحه‌ای که در dbPages کلید دارد (حتی با آرایهٔ خالی) دست نمی‌خورد.
//   - صفحه‌ای که در dbPages نیست ولی در آینه هست، از آینه پر می‌شود و در
//     فهرستِ healed برمی‌گردد تا فراخواننده آن را به دیتابیس هم برگرداند.
// خروجی: { pages, healed: [{ pageNum, items }] }.
function mergeBackupsIntoPages(filePath, dbPages) {
  const pages = { ...(dbPages && typeof dbPages === 'object' ? dbPages : {}) };
  const healed = [];
  const backups = restoreBackupsAsPages(filePath);
  for (const [pageKey, items] of Object.entries(backups)) {
    if (Object.prototype.hasOwnProperty.call(pages, pageKey)) continue;
    pages[pageKey] = items;
    healed.push({ pageNum: Number(pageKey), items });
  }
  return { pages, healed };
}

// مرحله ۵ ـ بخش ب: پاک‌کردنِ کاملِ آینه پس از Restoreِ موفق.
// اگر پس از بازیابیِ `.crbackup`، کلیدهای قدیمی سرِ جایشان بمانند،
// با reload، قانونِ «ترمیمِ صفحه‌های بدونِ کلید» دوباره آن‌ها را
// واردِ دیتابیسِ بازیابی‌شده می‌کند. فقط کلیدهای همین پیشوند لمس
// می‌شوند؛ بقیهٔ localStorage (مثلاً `comicReader.lastBackup`) دست
// نمی‌خورد. هرگز throw نمی‌کند و شمارِ حذف‌شده‌ها را برمی‌گرداند.
// نکته: کلیدها اول در یک آرایه جمع می‌شوند، بعد حذف می‌شوند —
// حذفِ هم‌زمان با پیمایشِ localStorage.length، ایندکس‌ها را جابه‌جا
// می‌کند و بعضی کلیدها جا می‌مانند.
function clearAllAnnotationBackups() {
  if (!storageAvailable()) return 0;
  let keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
  } catch (_) {
    return 0;
  }
  let removed = 0;
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
      removed += 1;
    } catch (_) {}
  }
  return removed;
}

// مرحلهٔ ۵۲ §۱: پاک‌کردنِ فقط آینهٔ یک فایلِ مشخص (نه همهٔ آینه).
// کلیدها `comicReader.annotations.v1:<hash64(filePath)>:<pageNumber>`
// هستند؛ پس با هشِ همان مسیر، فقط کلیدهایِ همان سند جمع و بعد حذف
// می‌شوند (جمع‌کردن اول، حذف بعد — مثلِ clearAllAnnotationBackups —
// تا پیمایشِ localStorage به‌هم نریزد). بقیهٔ localStorage دست
// نمی‌خورد. هرگز throw نمی‌کند و شمارِ حذف‌شده‌ها را برمی‌گرداند.
function clearFileBackups(filePath) {
  if (!storageAvailable() || !filePath) return 0;
  const prefix = PREFIX + hashFilePath(filePath) + ':';
  let keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
  } catch (_) {
    return 0;
  }
  let removed = 0;
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
      removed += 1;
    } catch (_) {}
  }
  return removed;
}

const annotationLocalBackup = {
  PREFIX,
  hashFilePath,
  keyFor,
  cleanItems,
  writePageBackup,
  readPageBackup,
  restoreBackupsAsPages,
  mergeBackupsIntoPages,
  clearAllAnnotationBackups,
  clearFileBackups,
};

export default annotationLocalBackup;
