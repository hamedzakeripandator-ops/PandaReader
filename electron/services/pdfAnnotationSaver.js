// ============================================================================
// pdfAnnotationSaver.js — خروجیِ PDFِ حاشیه‌نویسی‌شده (ذخیرهٔ دوگانه: درجا + Save As)
// اجرا در: Electron Main Process (دسترسی به fs)
// کتابخانه: pdf-lib (نصب: npm install pdf-lib)
//
// تاریخچه: نسخهٔ اولِ این ماژول (اکتبر ۲۰۲۶) فقط قلم/هایلایتر را به‌صورتِ
// Ink روی «خودِ فایلِ اصلی» می‌نوشت و سیم‌کشیِ IPC/UI نداشت و هرگز داخلِ
// پروژه نصب نشد. این بازنویسی (مرحله ۵ ـ بخش الف) همان ایده را کامل می‌کند:
//  • همهٔ انواعِ آیتم (قلم، هایلایتر، باکس، فلشِ صاف و منحنی، نقطهٔ
//    مبدأ، متن، استیکی، باکسِ ابری) پوشش داده می‌شوند؛
//  • خروجی، «ذخیرهٔ دوگانه» است: یا «Save As» (فایلِ اصلی دست
//    نمی‌خورد) یا «ذخیره روی همین فایل» (in-place) که با پایهٔ خامِ
//    `.orig.bak`، همیشه از آخرین وضعیتِ کاملِ حاشیه‌نویسی‌ها ساخته
//    می‌شود و هرگز لایهٔ قبلی را دوباره روی خودش نمی‌پزد؛ نتیجه در هر
//    دو حالت با نوشتنِ اتمیک (tmp + rename) روی دیسک می‌نشیند؛
//  • هندسهٔ کامل (نقاطِ PDF، ضخامت‌ها، مستطیل‌ها) در سمتِ رندرر
//    محاسبه می‌شود و این ماژول فقط جایگذاریِ low-level با pdf-lib است.
//
// قراردادِ مختصات (مهم): همهٔ اعدادِ ورودی در «فضای خامِ صفحهٔ PDF»
// هستند — مبدأ پایین-چپ، واحد پوینت، بدونِ چرخش. چرخشِ صفحه (چه
// چرخشِ کاربر در نما و چه ‎/Rotate خودِ PDF) در سمتِ رندرر خنثی شده
// است؛ پس اینجا هیچ تبدیلی لازم نیست و overlayِ PNG هم دقیقاً در
// همین قاب، با drawImage روی کلِ صفحه می‌نشیند.
//
// چرا متن/استیکی/ابری، برداری نیستند؟ pdf-lib شکل‌دهیِ (shaping)
// متنِ فارسی/عربی ندارد: نوشتنِ متنِ فارسی با فونتِ embedشده، حروف را
// جدا و برعکس نشان می‌دهد. پس آن آیتم‌ها در رندرر با Canvas 2D
// (شکل‌دهیِ کاملِ مرورگر) روی یک PNGِ شفاف رندر می‌شوند و اینجا فقط
// همان تصویر روی صفحه می‌نشیند — وفاداریِ ۱۰۰٪ به چیزی که کاربر
// روی صفحه می‌بیند.
// ============================================================================

const fs = require('fs');
const path = require('path');
const nodeCrypto = (() => { try { return require('crypto'); } catch (_) { return null; } })();

// مرحله ۷ ـ بخش ب: ریشه‌کنیِ خطای PDFDict روی فایل‌های واقعی و
// وفاداریِ رنگ (گروهِ شفافیتِ DeviceRGB + گذرِ جداگانهٔ Multiply
// برای هایلایتر). کالبدشکافیِ بخش ب (۲۳ فایلِ دست‌سازِ تازه +
// ۳۳ فایلِ بخش الف، با pdf-lib 1.17.1) نشان داد: قلابِ سراسریِ
// روی PDFContext.prototype.lookup لازم نیست و خطرناک است (Kidsِ
// خراب را با آرایهٔ خالی «ترمیم» می‌کند و صفحه‌ها بی‌صدا گم
// می‌شوند)؛ شکاف‌های واقعی، سه‌تایند: (۱) بازیابیِ بخش الف فقط
// Kidsِ ریشه را اعتبارسنجی می‌کرد و گره‌های میانیِ خراب + برگ‌های
// بی‌Type را از دست می‌داد، (۲) زنجیرهٔ /Parentِ چرخه‌ای یا بدریخت
// روی صفحهٔ لمس‌شده، در ascendِ pdf-lib بازگشتِ بی‌نهایت/خطا
// می‌ساخت، (۳) ‎/Contentsِ بدریخت (عدد/دیکشنری)، در addContentStream
// با «Contents.push is not a function» می‌شکست. هر سه، این‌جا با
// ترمیمِ هدفمند (جست‌وجوی بی‌نوع) رفع شده‌اند؛ به‌علاوه، fallbackِ
// «بازسازیِ تمیز» که روی سندِ تازه، همه‌چیز را از نو می‌سازد.

let pdfLibCache = null;
let pdfLibError = null;

/** لودِ تنبلِ pdf-lib تا نبودِ آن، بوتِ برنامه را نشکند. */
function getPdfLib() {
  if (pdfLibCache) return pdfLibCache;
  if (pdfLibError) throw pdfLibError;
  try {
    pdfLibCache = require('pdf-lib');
    return pdfLibCache;
  } catch (err) {
    pdfLibError = new Error(
      'کتابخانهٔ pdf-lib نصب نیست؛ خروجیِ PDF ممکن نیست. در پوشهٔ پروژه این دستور را اجرا کنید: npm install pdf-lib'
    );
    throw pdfLibError;
  }
}

/** تبدیل رنگ hex به [r,g,b] در بازه 0-1 */
function hexToRgb01(hex) {
  const h = String(hex || '#22d3ee').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(num)) return [0.13, 0.86, 0.93];
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

function clampOpacity(value, fallback = 0.9) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0.05, Math.min(1, n));
}

/** خطای قفلِ فایل: فایلِ مقصد در لحظهٔ نوشتن، در دستِ خوانندهٔ دیگری است. */
class FileLockedError extends Error {
  constructor(targetPath) {
    super('فایل در حال استفاده است و نمی‌توان روی آن نوشت. اگر فایل در برنامهٔ دیگری (PDFخوان، مرورگر) باز است، آن را ببندید و دوباره ذخیره کنید.');
    this.name = 'FileLockedError';
    this.code = 'FILE_LOCKED';
    this.targetPath = targetPath;
  }
}

function isLockError(err) {
  return Boolean(err && ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(err.code));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * جایگزینیِ اتمیکِ فایلِ مقصد با فایلِ موقت، با تلاشِ مجددِ ناهمگام.
 *
 * هات‌فیکسِ مرحله ۶ (باگِ قفلِ ذخیره): نسخهٔ قبلی، پیش از rename،
 * خودِ فایلِ مقصد را unlink می‌کرد و بینِ تلاش‌ها با حلقهٔ مشغول،
 * تردِ اصلیِ الکترون را قفل می‌کرد. اگر rename پس از unlink شکست
 * می‌خورد، فایلِ اصلی از دست رفته بود و اگر خواننده‌ای (مثلِ
 * استریمِ Rangeِ پروتکلِ comic:// یا PDFخوانِ دیگر) فایل را باز
 * نگه داشته بود، هر سه تلاش با EPERM رد می‌شدند. نسخهٔ جدید:
 *  • هرگز مقصد را پیش از موفقیتِ جایگزینی حذف نمی‌کند؛
 *  • نامِ فایلِ موقت یکتاست (pid + تصادفی) تا دو ذخیرهٔ هم‌زمان،
 *    فایلِ موقتِ هم را لگد نکنند؛
 *  • انتظار بینِ تلاش‌ها ناهمگام است تا تردِ اصلی قفل نشود؛
 *  • اگر قفل پابرجا ماند، خطای ساخت‌یافتهٔ FILE_LOCKED برمی‌گردد و
 *    فایلِ اصلی دست‌نخورده می‌ماند و فایلِ موقت پاک می‌شود.
 */
async function replaceFileWithRetry(tmpPath, targetPath) {
  let lastErr = null;
  const delays = [120, 300, 700, 1200];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      // rename روی POSIX جایگزینیِ اتمیک است و روی ویندوز هم
      // (MoveFileEx با REPLACE_EXISTING) فایلِ موجود را جایگزین
      // می‌کند؛ هیچ unlinkای پیش از آن لازم نیست.
      await fs.promises.rename(tmpPath, targetPath);
      return;
    } catch (err) {
      lastErr = err;
      if (!isLockError(err) || attempt === delays.length) break;
      await sleep(delays[attempt]);
    }
  }
  // تلاشِ آخر: کپیِ بایت‌به‌بایت روی مقصد (برای قفلِ دایرکتوریِ
  // ویندوز، همان Fallbackِ مرحله ۱) و سپس حذفِ موقت.
  try {
    await fs.promises.copyFile(tmpPath, targetPath);
    await fs.promises.unlink(tmpPath);
    return;
  } catch (copyErr) {
    lastErr = copyErr;
  }
  try { await fs.promises.unlink(tmpPath); } catch (_) {}
  if (isLockError(lastErr)) throw new FileLockedError(targetPath);
  throw lastErr || new Error('نوشتنِ فایلِ خروجی انجام نشد.');
}

/** نوشتنِ اتمیکِ بایت‌ها: tmpِ یکتا در همان پوشه + fsync + rename. */
async function atomicWriteFile(targetPath, buffer) {
  const tmpPath = `${targetPath}.${process.pid}.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.promises.writeFile(tmpPath, buffer);
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
  // fsyncِ پوشه (فقط POSIX) تا خودِ ورودیِ دایرکتوری هم پایدار شود.
  if (process.platform !== 'win32') {
    let dirHandle = null;
    try {
      dirHandle = await fs.promises.open(path.dirname(targetPath), 'r');
      try { await dirHandle.sync(); } catch (_) {}
    } catch (_) {
    } finally {
      if (dirHandle) {
        try { await dirHandle.close(); } catch (_) {}
      }
    }
  }
  await replaceFileWithRetry(tmpPath, targetPath);
}

// ============================================================================
// پایهٔ خامِ اولیه (.orig.bak) — قلبِ ذخیرهٔ درجا (Idempotent In-Place Save)
//
// تله: اگر هر بار روی فایلِ قبلیِ پخته‌شده بنویسیم، حاشیه‌نویسی‌های
// قبلی دوباره روی هم می‌افتند و حذفِ یک آیتم در برنامه، از PDF پاک
// نمی‌شود. پس در اولین ذخیرهٔ درجا، بایت‌های خامِ اولیهٔ فایل در
// `<pdfPath>.orig.bak` نگه داشته می‌شوند و هرگز بازنویسی نمی‌شوند؛
// هر ذخیرهٔ بعدی، پایه را از همان فایلِ خام می‌خواند و آخرین وضعیتِ
// کاملِ فعلی را روی آن می‌نشاند. Save As هم اگر `.orig.bak` وجود
// داشت، از همان پایهٔ تمیز استفاده می‌کند (و خودش `.orig.bak`
// نمی‌سازد، چون نباید کنارِ فایلِ اصلی چیزی بنویسد).
// نکتهٔ صادقانه: `.orig.bak` از اولین ذخیرهٔ بخش ب به بعد ساخته
// می‌شود؛ فایلی که پیش‌تر با بخش الف روی خودش بازنویسی شده باشد،
// پایهٔ تمیزش را از دست داده و اولین `.orig.bak`اش همان نسخهٔ
// پخته‌شده خواهد بود (در گزارشِ بخش ب، §۲٫۳ آمده است).
// ============================================================================

/** مسیرِ فایلِ پشتیبانِ پایهٔ خام: `<pdfPath>.orig.bak` در همان پوشه. */
function origBackupPathFor(pdfPath) {
  return String(pdfPath) + '.orig.bak';
}

function isPdfMagic(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 5 && buffer.slice(0, 5).toString('ascii') === '%PDF-';
}


// ============================================================================
// مرحله ۷ ـ نهایی: شکارِ آبجکت‌های غیرقابل‌پارس، ترمیمِ هم‌طولِ بایت‌ها،
// و اعتبارسنجیِ خروجی پیش از نوشتن روی دیسک.
//
// چرا PDFParser روی یک آبجکتِ خاص شکست می‌خورد؟
// در PDFDocument.load، پارسرِ pdf-lib آبجکت‌ها را یکی‌یکی از روی جدولِ
// xref می‌خواند. اگر بدنهٔ یک آبجکت، سینتکسِ معتبرِ PDF نباشد
// (دیکشنریِ ناتمام، توکنِ زائد، براکتِ بسته‌نشده، بدنهٔ خالی)،
// parseObject خطا می‌دهد و tryToParseInvalidIndirectObject در
// pdf-lib، دو هشدارِ console.warn صادر می‌کند:
//   Trying to parse invalid object: {"line":…,"column":…,"offset":N}
//   Invalid object ref: X Y R
// و آبجکت را به‌صورتِ PDFInvalidObject (بایت‌های خام) نگه می‌دارد. در
// ذخیرهٔ کامل، آن بایت‌های خام، عیناً بازنویسی می‌شوند؛ اگر بدنه،
// دیکشنریِ ناتمام باشد (مثلاً براکتِ باز)، خروجی هم در pdf.js خراب
// است («End of file inside array»). ترمیمِ هم‌طول، همان بدنه را در
// جای خودش، با همان طولِ دقیقِ بایت، به دیکشنریِ معتبر تبدیل می‌کند
// تا هیچ آفستِ xrefای جابه‌جا نشود.
//
// قاعدهٔ ایمنیِ ترمیم: بافرِ ترمیم‌شده فقط وقتی پذیرفته می‌شود که
// بارگذاریِ دوبارهٔ آن، صفر هشدارِ آبجکتِ نامعتبر بدهد و شمارِ
// صفحه‌ها کم نشده باشد؛ وگرنه ترمیم دور انداخته می‌شود و مسیرِ
// قبلی (ترمیمِ صفحه‌به‌صفحه + بازیابیِ درخت) ادامه می‌یابد.
// ============================================================================

const MAX_HEAL_OBJECTS = 64;
const MAX_HEAL_OBJECT_BYTES = 1024 * 1024;
const INVALID_OBJECT_WARN_RE = /Trying to parse invalid object|Invalid object ref/;

/** لاگِ تشخیصیِ ذخیره: از لاگرِ تزریق‌شده (لاگِ دیسک) یا console. هرگز throw نمی‌کند. */
function logSaveDiag(logger, level, message, detail) {
  try {
    if (logger && typeof logger[level] === 'function') {
      logger[level](message, detail);
    } else if (level === 'error') {
      console.error('[pdf-save]', message, detail || '');
    } else {
      console.warn('[pdf-save]', message, detail || '');
    }
  } catch (_) {}
}

/**
 * هشدارهای خامِ console.warn را به جفت‌های {offset, num, gen} تبدیل
 * می‌کند. در pdf-lib، هر آبجکتِ خراب، دقیقاً دو هشدارِ پشتِ سرِ هم
 * تولید می‌کند: اول «Trying to parse invalid object» با موقعیتِ
 * بایت، بعد «Invalid object ref» با شمارهٔ آبجکت.
 */
function parseInvalidObjectWarnings(rawWarnings) {
  const out = [];
  let pendingOffset = null;
  for (const text of rawWarnings || []) {
    const m1 = /Trying to parse invalid object: (\{.*?\})\)?/.exec(String(text));
    if (m1) {
      try {
        pendingOffset = JSON.parse(m1[1]).offset;
      } catch (_) {
        pendingOffset = null;
      }
      continue;
    }
    const m2 = /Invalid object ref: (\d+) (\d+) R/.exec(String(text));
    if (m2 && pendingOffset !== null && Number.isFinite(pendingOffset)) {
      out.push({ offset: pendingOffset, num: Number(m2[1]), gen: Number(m2[2]) });
      pendingOffset = null;
    }
  }
  return out;
}

/**
 * بارگذاریِ PDFDocument با رصدِ موقتِ console.warn. هشدارهای
 * نامربوط، بلافاصله به console.warnِ اصلی پاس داده می‌شوند؛ فقط
 * هشدارهای آبجکتِ نامعتبر جمع می‌شوند. console.warn همیشه
 * برگردانده می‌شود (حتی اگر load خطا بدهد).
 */
async function loadPdfDocumentWithWarnings(bytes) {
  const { PDFDocument } = getPdfLib();
  const rawWarnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => {
    const text = args.map((a) => String(a)).join(' ');
    if (INVALID_OBJECT_WARN_RE.test(text)) {
      rawWarnings.push(text);
    } else {
      try {
        origWarn.apply(console, args);
      } catch (_) {}
    }
  };
  try {
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    let pageCount = -1;
    try {
      pageCount = pdfDoc.getPageCount();
    } catch (_) {
      pageCount = -1;
    }
    return {
      pdfDoc,
      warnings: rawWarnings,
      invalidObjects: parseInvalidObjectWarnings(rawWarnings),
      pageCount,
      loadError: null,
    };
  } catch (err) {
    return {
      pdfDoc: null,
      warnings: rawWarnings,
      invalidObjects: parseInvalidObjectWarnings(rawWarnings),
      pageCount: -1,
      loadError: err,
    };
  } finally {
    console.warn = origWarn;
  }
}

/** ۲۰۰ بایتِ اطرافِ آفستِ گزارش‌شده، به‌صورتِ متنِ چاپ‌پذیر (برای لاگِ دیباگِ ساختارِ آبجکت). */
function diagnosticSampleAround(buffer, offset) {
  const start = Math.max(0, offset - 100);
  const end = Math.min(buffer.length, offset + 100);
  let out = '';
  for (let i = start; i < end; i++) {
    const b = buffer[i];
    if (b === 0x0a) out += '\\n';
    else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    else out += '.';
  }
  return out;
}

function findHealableObjectRange(buffer, warnOffset, wantNum) {
  const start = Math.max(0, warnOffset - 1024);
  const end = Math.min(buffer.length, warnOffset + 256);
  const windowText = buffer.toString('latin1', start, end);
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m = null;
  let hit = null;
  while ((m = re.exec(windowText)) !== null) {
    if (Number(m[1]) === wantNum) {
      hit = m;
      break;
    }
  }
  if (!hit) return null;
  const headerStart = start + hit.index;
  const afterHdr = headerStart + hit[0].length;
  let bodyStart = afterHdr;
  if (buffer[bodyStart] === 0x0d && buffer[bodyStart + 1] === 0x0a) bodyStart += 2;
  else if (buffer[bodyStart] === 0x0a || buffer[bodyStart] === 0x0d) bodyStart += 1;
  const tail = buffer.toString('latin1', bodyStart, Math.min(buffer.length, bodyStart + MAX_HEAL_OBJECT_BYTES));
  const e = /\bendobj\b/.exec(tail);
  if (!e) return null;
  const bodyEnd = bodyStart + e.index;
  return { headerStart, bodyStart, bodyEnd, endObjEnd: bodyEnd + e[0].length };
}

/** استخراجِ کلیدهای قابلِ اعتماد از بدنهٔ خرابِ یک دیکشنری (فقط مقادیرِ ساده/ارجاع). */
function extractHealableKeys(bodyText) {
  const out = {};
  let m;
  if ((m = /\/Type\s+\/([A-Za-z0-9.]+)/.exec(bodyText))) out.Type = m[1];
  if ((m = /\/Subtype\s+\/([A-Za-z0-9.]+)/.exec(bodyText))) out.Subtype = m[1];
  if ((m = /\/Count\s+(\d+)/.exec(bodyText))) out.Count = m[1];
  if ((m = /\/Parent\s+(\d+)\s+(\d+)\s+R/.exec(bodyText))) out.Parent = m[1] + ' ' + m[2] + ' R';
  if ((m = /\/MediaBox\s*\[([^\]]*)\]/.exec(bodyText))) out.MediaBox = m[1].trim().replace(/\s+/g, ' ');
  if ((m = /\/Rotate\s+(-?\d+)/.exec(bodyText))) out.Rotate = m[1];
  const kidsIdx = bodyText.indexOf('/Kids');
  if (kidsIdx >= 0) {
    const br = bodyText.indexOf('[', kidsIdx);
    if (br >= 0) {
      const close = bodyText.indexOf(']', br);
      const seg = close >= 0 ? bodyText.slice(br, close + 1) : bodyText.slice(br, br + 4096);
      const refs = [];
      const refRe = /(\d+)\s+(\d+)\s+R/g;
      let rm;
      while ((rm = refRe.exec(seg)) !== null) refs.push(rm[1] + ' ' + rm[2] + ' R');
      if (refs.length > 0) out.Kids = refs;
    }
  }
  if ((m = /\/Resources\s+(\d+)\s+(\d+)\s+R/.exec(bodyText))) out.Resources = m[1] + ' ' + m[2] + ' R';
  if ((m = /\/Contents\s+(\d+)\s+(\d+)\s+R/.exec(bodyText))) out.Contents = m[1] + ' ' + m[2] + ' R';
  return out;
}

function rebuildHealDictBody(keys) {
  const parts = ['<<'];
  if (keys.Type) parts.push('/Type /' + keys.Type);
  if (keys.Subtype) parts.push('/Subtype /' + keys.Subtype);
  if (keys.Kids) parts.push('/Kids [' + keys.Kids.join(' ') + ']');
  if (keys.Count !== undefined) parts.push('/Count ' + keys.Count);
  if (keys.Parent) parts.push('/Parent ' + keys.Parent);
  if (keys.MediaBox) parts.push('/MediaBox [' + keys.MediaBox + ']');
  if (keys.Rotate !== undefined) parts.push('/Rotate ' + keys.Rotate);
  if (keys.Resources) parts.push('/Resources ' + keys.Resources);
  if (keys.Contents) parts.push('/Contents ' + keys.Contents);
  parts.push('>>');
  return parts.join(' ');
}

/**
 * ترمیمِ جراحیِ هم‌طولِ آبجکت‌های غیرقابل‌پارس: هر آبجکتِ گزارش‌شده،
 * در جای خودش و با همان طولِ دقیقِ بایت، به دیکشنریِ تمیزِ
 * بازسازی‌شده (یا `null` وقتی هیچ کلیدی قابلِ استخراج نیست و دست‌کم
 * ۴ بایت جا هست) تبدیل می‌شود و مابقیِ بایت‌ها با فاصله (0x20) پر
 * می‌شوند تا جدولِ xref کاملاً معتبر بماند. آبجکت‌های استریم
 * (stream/endstream) ترمیم نمی‌شوند. اگر هیچ ویرایشی اعمال نشد،
 * null برمی‌گردد. این تابع هرگز throw نمی‌کند.
 */
function healUnparseableIndirectObjectsInBuffer(buffer, invalidObjects) {
  try {
    if (!Buffer.isBuffer(buffer) || !Array.isArray(invalidObjects) || invalidObjects.length === 0) return null;
    const edits = [];
    const seen = new Set();
    for (const warn of invalidObjects.slice(0, MAX_HEAL_OBJECTS)) {
      const key = warn.num + ':' + warn.gen;
      if (seen.has(key)) continue;
      seen.add(key);
      const range = findHealableObjectRange(buffer, warn.offset, warn.num);
      if (!range) continue;
      const bodyLen = range.bodyEnd - range.bodyStart;
      if (bodyLen <= 0 || bodyLen > MAX_HEAL_OBJECT_BYTES) continue;
      const bodyText = buffer.toString('latin1', range.bodyStart, range.bodyEnd);
      if (/\bstream\r?\n/.test(bodyText)) continue;
      const keys = extractHealableKeys(bodyText);
      let replacement;
      if (Object.keys(keys).length > 0) replacement = rebuildHealDictBody(keys);
      else if (bodyLen >= 4) replacement = 'null';
      else continue;
      if (replacement.length > bodyLen) continue;
      edits.push({
        bodyStart: range.bodyStart,
        padded: replacement + ' '.repeat(bodyLen - replacement.length),
        ref: warn.num + ' ' + warn.gen + ' R',
      });
    }
    if (edits.length === 0) return null;
    const out = Buffer.from(buffer);
    for (const edit of edits) out.write(edit.padded, edit.bodyStart, 'latin1');
    return { buffer: out, healedRefs: edits.map((e) => e.ref) };
  } catch (_) {
    return null;
  }
}

/**
 * اعتبارسنجیِ بایت‌های خروجی پیش از نوشتن روی دیسک: بارگذاریِ
 * دوباره با pdf-lib (شمارِ صفحه‌ها باید برابرِ انتظار باشد و هیچ
 * هشدارِ آبجکتِ نامعتبری ندهد) و سپس با pdf.js (شمارِ صفحه‌ها).
 * بررسیِ pdf.js، بهترینِ تلاش است: اگر ماژولِ pdf.js در main در
 * دسترس نبود، فقط همان بررسیِ pdf-lib اعمال می‌شود.
 */
async function validateSavedPdfBytes(outBytes, expectedPageCount, logger) {
  const check = await loadPdfDocumentWithWarnings(Buffer.from(outBytes));
  if (check.loadError) {
    return { ok: false, reason: 'بارگذاریِ دوبارهٔ خروجی با pdf-lib انجام نشد: ' + String((check.loadError && check.loadError.message) || check.loadError) };
  }
  if (check.pageCount !== expectedPageCount) {
    return { ok: false, reason: 'شمارِ صفحه‌های خروجی (' + check.pageCount + ') با شمارِ موردِ انتظار (' + expectedPageCount + ') برابر نیست.' };
  }
  if (check.invalidObjects.length > 0) {
    return { ok: false, reason: 'خروجی، ' + check.invalidObjects.length + ' آبجکتِ غیرقابل‌پارس دارد.' };
  }
  let pdfjs = null;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (err) {
    logSaveDiag(logger, 'warn', 'pdf-save: pdf.js validation skipped (module unavailable in main)', String((err && err.message) || err));
    return { ok: true, pdfjsSkipped: true };
  }
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(outBytes), verbosity: 0 }).promise;
    const n = doc.numPages;
    if (doc && typeof doc.destroy === 'function') {
      try {
        await doc.destroy();
      } catch (_) {}
    }
    if (n !== expectedPageCount) {
      return { ok: false, reason: 'شمارِ صفحه‌های خروجی در pdf.js (' + n + ') با شمارِ موردِ انتظار (' + expectedPageCount + ') برابر نیست.' };
    }
  } catch (err) {
    return { ok: false, reason: 'اعتبارسنجیِ خروجی با pdf.js انجام نشد: ' + String((err && err.message) || err) };
  }
  return { ok: true };
}


// ============================================================================
// مرحله ۷ ـ نهاییِ دوم: الحاقِ افزایشیِ باینریِ واقعی (True PDF
// Incremental Append) — بدونِ بازنویسیِ کلِ فایل و بدونِ دست زدن
// به آبجکت‌های غیرقابل‌پارس.
//
// چرا بازنویسیِ کامل با pdfDoc.save() روی فایلِ ۶۸ مگابایتیِ کاربر
// شکست می‌خورد؟ آبجکت‌های 3950/3951 (و هر آبجکتِ استریمِ خرابِ
// دیگری) در PDFDocument.load به PDFInvalidObject تبدیل می‌شوند و
// save()، بایت‌های خامِ آن‌ها را در فایلِ بازنویسی‌شده می‌چرخاند؛
// جدولِ xref و استریم‌های آبجکتِ تازه، در PDFخوان‌های بیرونی خراب
// از آب درمی‌آیند. ترمیمِ هم‌طولِ مرحلهٔ نهایی هم روی آبجکت‌های
// استریم کار نمی‌کند (آگاهانه رد می‌شود تا استریم، بی‌صدا خراب
// نشود). راه‌حل: بایت‌های اصلی، از بایتِ ۰ تا آخر، ۱۰۰٪ دست‌نخورده
// می‌مانند و فقط آبجکت‌های تازه (تصویرهای XObject + SMask، استریمِ
// محتوای کوچک، دیکشنریِ صفحهٔ بازنویسی‌شده با همان شمارهٔ آبجکت،
// دیکشنریِ Resourcesِ تازه، دیکشنری‌های حاشیه‌نویسیِ برداری) به
// انتهای فایل الحاق می‌شوند + یک بخشِ xrefِ تازه (جدولِ کلاسیک یا
// استریمِ XRef، متناسب با فایلِ اصلی) با trailerِ /Prev به
// startxrefِ اصلی.
//
// نقشِ pdf-lib در این مسیر، فقط «تولیدکنندهٔ آبجکتِ تصویر» است:
// برای هر PNG، یک سندِ موقتِ تمیز ساخته می‌شود و embedPng،
// بایت‌های دقیقِ دیکشنری و استریمِ XObject (به‌همراهِ /SMask و
// FlateDecode) را می‌سازد؛ خروجیِ آن سندِ موقت، اسکن و آبجکت‌های
// تصویر، کلمه‌به‌کلمه کپی می‌شوند (بدونِ اینکه PNG با دست دیکد
// شود). دیکشنریِ صفحه، از مدلِ پارس‌شدهٔ pdf-lib بازسازی می‌شود
// (نه از بایت‌های خام) تا آبجکت‌های داخلِ ObjStm و ارث‌بریِ
// Resources هم درست کار کنند؛ ورودی‌های معلق/نامعتبر، با لاگ رد
// می‌شوند و هرگز واردِ دیکشنریِ تازه نمی‌شوند. بازنویسی با همان
// شمارهٔ آبجکتِ صفحه انجام می‌شود (مکانیزمِ استانداردِ به‌روزرسانیِ
// افزایشی) تا Kidsِ درختِ صفحات، دست نخورده بماند. فایل‌های
// رمزگذاری‌شده، از این مسیر کنار گذاشته می‌شوند (الحاقِ بدونِ رمز،
// فایل را خراب می‌کند).
// ============================================================================


const MAX_INC_OBJECTS = 512;

function fmtNum(n) {
  if (!Number.isFinite(n)) return '0';
  let s = Number(n.toFixed(4)).toString();
  if (s === '-0') s = '0';
  return s;
}

function serializePdfObject(obj) {
  const buf = Buffer.alloc(obj.sizeInBytes());
  obj.copyBytesInto(buf, 0);
  return buf.toString('latin1');
}

// جست‌وجویِ بی‌نوع (همان الگوی resolvePdfObjectUntyped): context.lookup
// بدونِ آرگومانِ نوع، هرگز assert نمی‌کند؛ ارجاعِ معلق، undefined
// برمی‌گرداند. (lookupMaybe با صفر نوع، در pdf-lib 1.17.1 همیشه
// throw می‌کند و برای این کار مناسب نیست.)
function resolveUntyped(context, value) {
  if (value === undefined || value === null) return undefined;
  try {
    return context.lookup(value);
  } catch (_) {
    return undefined;
  }
}

// --- minimal PDF value parser (dicts/arrays/refs/strings) over latin1 text ---
function skipWs(text, i) {
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\0') i++;
    else if (c === '%') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
    } else break;
  }
  return i;
}

function parsePdfValue(text, i) {
  i = skipWs(text, i);
  if (i >= text.length) return { value: null, next: i };
  if (text[i] === '<' && text[i + 1] === '<') {
    const dict = {};
    i += 2;
    for (;;) {
      i = skipWs(text, i);
      if (text[i] === '>' && text[i + 1] === '>') { i += 2; break; }
      if (i >= text.length) break;
      const key = parsePdfValue(text, i);
      if (key.value === null || key.value.kind !== 'name') break;
      i = key.next;
      const val = parsePdfValue(text, i);
      dict[key.value.text] = val.value;
      i = val.next;
    }
    return { value: { kind: 'dict', entries: dict }, next: i };
  }
  if (text[i] === '[') {
    const arr = [];
    i += 1;
    for (;;) {
      i = skipWs(text, i);
      if (text[i] === ']') { i += 1; break; }
      if (i >= text.length) break;
      const v = parsePdfValue(text, i);
      arr.push(v.value);
      i = v.next;
    }
    return { value: { kind: 'array', items: arr }, next: i };
  }
  if (text[i] === '(') {
    let depth = 0;
    i += 1;
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) { i += 1; break; }
        depth--;
      }
      i++;
    }
    return { value: { kind: 'string' }, next: i };
  }
  if (text[i] === '<') {
    const end = text.indexOf('>', i + 1);
    return { value: { kind: 'hex' }, next: end >= 0 ? end + 1 : text.length };
  }
  if (text[i] === '/') {
    let j = i + 1;
    while (j < text.length && !/[\s\[\]<>()%\/]/.test(text[j])) j++;
    return { value: { kind: 'name', text: text.slice(i + 1, j) }, next: j };
  }
  const numRe = /^[+-]?(?:\d+\.?\d*|\.\d+)/;
  const rest = text.slice(i);
  const nm = numRe.exec(rest);
  if (nm) {
    const after1 = skipWs(text, i + nm[0].length);
    const nm2 = numRe.exec(text.slice(after1));
    if (nm2) {
      const after2 = skipWs(text, after1 + nm2[0].length);
      if (text[after2] === 'R') {
        return { value: { kind: 'ref', num: Number(nm[0]), gen: Number(nm2[0]) }, next: after2 + 1 };
      }
    }
    return { value: { kind: 'number', num: Number(nm[0]) }, next: i + nm[0].length };
  }
  const kwRe = /^[A-Za-z]+/;
  const kw = kwRe.exec(rest);
  if (kw) return { value: { kind: 'keyword', text: kw[0] }, next: i + kw[0].length };
  return { value: null, next: i + 1 };
}

function parseDictAt(text, i) {
  i = skipWs(text, i);
  if (text[i] !== '<' || text[i + 1] !== '<') return null;
  const parsed = parsePdfValue(text, i);
  if (!parsed.value || parsed.value.kind !== 'dict') return null;
  return { entries: parsed.value.entries, end: parsed.next };
}

// --- original-file xref/trailer location ---
function findLastStartXref(bytes) {
  const tailLen = Math.min(bytes.length, 16384);
  let tail = bytes.toString('latin1', bytes.length - tailLen, bytes.length);
  let idx = tail.lastIndexOf('startxref');
  let base = bytes.length - tailLen;
  if (idx < 0) {
    tail = bytes.toString('latin1');
    idx = tail.lastIndexOf('startxref');
    base = 0;
    if (idx < 0) return null;
  }
  const after = tail.slice(idx + 9);
  const m = /(\d+)/.exec(after);
  if (!m) return null;
  const offset = Number(m[1]);
  if (!Number.isFinite(offset) || offset < 0 || offset >= bytes.length) return null;
  // kind: bytes at offset
  let j = offset;
  while (j < bytes.length && (bytes[j] === 0x20 || bytes[j] === 0x0a || bytes[j] === 0x0d || bytes[j] === 0x09)) j++;
  const head = bytes.toString('latin1', j, Math.min(bytes.length, j + 40));
  if (head.startsWith('xref')) return { startXref: offset, kind: 'table' };
  if (/^\d+\s+\d+\s+obj\b/.test(head)) return { startXref: offset, kind: 'stream' };
  return { startXref: offset, kind: 'unknown' };
}

function parseOriginalTrailer(bytes, loc) {
  const text = bytes.toString('latin1');
  if (loc.kind === 'table') {
    const tIdx = text.indexOf('trailer', loc.startXref);
    if (tIdx < 0) return null;
    const d = parseDictAt(text, tIdx + 7);
    return d ? d.entries : null;
  }
  if (loc.kind === 'stream') {
    const hdr = /^(\d+)\s+(\d+)\s+obj\b/.exec(text.slice(loc.startXref, loc.startXref + 40));
    if (!hdr) return null;
    const d = parseDictAt(text, loc.startXref + hdr[0].length);
    return d ? d.entries : null;
  }
  return null;
}

// --- tempDoc object scan ---
function scanTempDocObjects(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  const text = bytes.toString('latin1');
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const num = Number(m[1]);
    const gen = Number(m[2]);
    let bodyStart = m.index + m[0].length;
    if (text[bodyStart] === '\r' && text[bodyStart + 1] === '\n') bodyStart += 2;
    else if (text[bodyStart] === '\n' || text[bodyStart] === '\r') bodyStart += 1;
    const d = parseDictAt(text, bodyStart);
    if (!d) return null;
    const dictText = text.slice(bodyStart, d.end);
    let streamData = null;
    let end = d.end;
    let j = skipWs(text, d.end);
    if (text.slice(j, j + 6) === 'stream') {
      j += 6;
      if (text[j] === '\r' && text[j + 1] === '\n') j += 2;
      else if (text[j] === '\n' || text[j] === '\r') j += 1;
      const lenEntry = d.entries.Length;
      if (!lenEntry || lenEntry.kind !== 'number') return null;
      const len = lenEntry.num;
      streamData = Buffer.from(bytes.subarray(j, j + len));
      const afterData = j + len;
      const es = text.indexOf('endstream', afterData);
      if (es < 0) return null;
      end = es + 9;
    }
    const eo = text.indexOf('endobj', end);
    if (eo < 0) return null;
    out.push({ num, gen, dictText, entries: d.entries, streamData, endObjEnd: eo + 6 });
    re.lastIndex = eo + 6;
  }
  return out;
}

function extractImageObjects(tempBytes) {
  const objs = scanTempDocObjects(tempBytes);
  if (!objs) throw new Error('incremental: tempDoc object scan failed');
  const images = objs.filter((o) => {
    const st = o.entries.Subtype;
    return st && st.kind === 'name' && st.text === 'Image' && o.streamData;
  });
  if (images.length === 0) throw new Error('incremental: no image XObject in tempDoc output');
  let main = null;
  let smask = null;
  for (const img of images) {
    if (img.entries.SMask && img.entries.SMask.kind === 'ref') { main = img; break; }
  }
  if (!main) {
    if (images.length !== 1) throw new Error('incremental: ambiguous image objects in tempDoc output');
    main = images[0];
  }
  if (main.entries.SMask && main.entries.SMask.kind === 'ref') {
    const want = main.entries.SMask.num;
    smask = objs.find((o) => o.num === want) || null;
    if (!smask || !smask.streamData) throw new Error('incremental: SMask object not found in tempDoc output');
  }
  const checkRefs = (o, allowSmask) => {
    const refs = o.dictText.match(/\d+\s+\d+\s+R/g) || [];
    for (const r of refs) {
      if (allowSmask && o.entries.SMask && r === o.entries.SMask.num + ' ' + o.entries.SMask.gen + ' R') continue;
      throw new Error('incremental: unexpected indirect ref in image dict: ' + r);
    }
  };
  checkRefs(main, true);
  if (smask) checkRefs(smask, false);
  return { main, smask };
}

function imageObjectBody(obj, smaskNewNum) {
  let dictText = obj.dictText;
  if (obj.entries.SMask && obj.entries.SMask.kind === 'ref' && smaskNewNum != null) {
    const before = dictText;
    dictText = dictText.replace(/\/SMask\s+\d+\s+\d+\s+R/, '/SMask ' + smaskNewNum + ' 0 R');
    if (dictText === before) throw new Error('incremental: SMask ref rewrite failed');
  }
  const head = Buffer.from(dictText + '\nstream\n', 'latin1');
  const tail = Buffer.from('\nendstream', 'latin1');
  return Buffer.concat([head, obj.streamData, tail]);
}

// --- dict copying from the loaded pdf-lib model ---
function copyDictEntries(context, sourceDict, skipKeys, skipped) {
  const { PDFDict, PDFRef, PDFStream, PDFInvalidObject } = getPdfLib();
  const out = PDFDict.withContext(context);
  for (const [key, rawValue] of sourceDict.entries()) {
    const keyStr = key.toString();
    if (skipKeys.has(keyStr)) continue;
    const resolved = resolveUntyped(context, rawValue);
    if (resolved === undefined) { skipped.push(keyStr + ':dangling'); continue; }
    if (resolved instanceof PDFInvalidObject) { skipped.push(keyStr + ':invalid'); continue; }
    if (resolved instanceof PDFStream && !(rawValue instanceof PDFRef)) { skipped.push(keyStr + ':direct-stream'); continue; }
    out.set(key, rawValue);
  }
  return out;
}

// The leaf's own indirect ref, via the context's reverse lookup
// (same API the saver's repairParentChain already uses).
function getPageLeafRef(pdfDoc, targetNode) {
  try {
    const ref = pdfDoc.context.getObjectRef(targetNode);
    return ref || null;
  } catch (_) {
    return null;
  }
}

function collectLeavesFallback(pdfDoc) {
  const { PDFDict, PDFName, PDFArray } = getPdfLib();
  const context = pdfDoc.context;
  const isPageLike = (obj) => {
    if (!(obj instanceof PDFDict)) return false;
    const t = obj.get(PDFName.of('Type'));
    if (t && String(t) === '/Page') return true;
    const kids = obj.get(PDFName.of('Kids'));
    if (kids !== undefined) return false;
    const mb = obj.get(PDFName.of('MediaBox'));
    return mb !== undefined;
  };
  const leaves = [];
  const seen = new Set();
  const pushLeaf = (ref, obj) => {
    const key = ref.objectNumber + ':' + ref.generationNumber;
    if (seen.has(key)) return;
    seen.add(key);
    leaves.push({ ref, obj });
  };
  try {
    const catalog = pdfDoc.catalog;
    const walk = (raw, depth) => {
      if (depth > 60) return;
      const obj = resolveUntyped(context, raw);
      if (!(obj instanceof PDFDict)) return;
      const kidsRaw = obj.get(PDFName.of('Kids'));
      if (kidsRaw !== undefined) {
        const kids = resolveUntyped(context, kidsRaw);
        if (kids instanceof PDFArray) {
          for (const k of kids.asArray()) walk(k, depth + 1);
          return;
        }
      }
      if (isPageLike(obj) && raw instanceof PDFRef) pushLeaf(raw, obj);
    };
    if (catalog && typeof catalog.get === 'function') walk(catalog.get(PDFName.of('Pages')), 0);
  } catch (_) {}
  try {
    const orphans = [];
    for (const [ref, obj] of context.indirectObjects) {
      if (isPageLike(obj)) orphans.push({ ref, obj });
    }
    orphans.sort((a, b) => a.ref.objectNumber - b.ref.objectNumber);
    for (const e of orphans) pushLeaf(e.ref, e.obj);
  } catch (_) {}
  leaves.sort((a, b) => a.ref.objectNumber - b.ref.objectNumber);
  return leaves;
}

function contentsPlan(context, node, skipped) {
  const { PDFName, PDFStream, PDFArray, PDFInvalidObject } = getPdfLib();
  const raw = node.get(PDFName.of('Contents'));
  if (raw === undefined) return { refs: [], copiedStreams: [], dropped: false };
  const resolved = resolveUntyped(context, raw);
  if (resolved === undefined) return { refs: [], copiedStreams: [], dropped: true };
  if (resolved instanceof PDFStream) {
    return { refs: [], copiedStreams: [resolved], dropped: false };
  }
  if (resolved instanceof PDFArray) {
    const refs = [];
    const copiedStreams = [];
    let dropped = false;
    for (const entryRaw of resolved.asArray()) {
      const entry = resolveUntyped(context, entryRaw);
      if (entry === undefined) { dropped = true; continue; }
      if (entry instanceof PDFInvalidObject) { dropped = true; continue; }
      if (entry instanceof PDFStream) { copiedStreams.push(entry); continue; }
      if (entryRaw instanceof PDFRef) refs.push(entryRaw);
    }
    return { refs, copiedStreams, dropped };
  }
  skipped.push('Contents:wrong-type');
  return { refs: [], copiedStreams: [], dropped: true };
}

function resourcesPlan(context, node, skipped) {
  const { PDFName, PDFDict, PDFRef } = getPdfLib();
  let raw = node.get(PDFName.of('Resources'));
  let inherited = false;
  if (raw === undefined && typeof node.getInheritableAttribute === 'function') {
    try {
      raw = node.getInheritableAttribute(PDFName.of('Resources'));
      inherited = true;
    } catch (_) { raw = undefined; }
  }
  if (raw === undefined) return { dict: null, needsNewObject: true, skipped };
  const resolved = resolveUntyped(context, raw);
  if (!(resolved instanceof PDFDict)) {
    skipped.push('Resources:wrong-type');
    return { dict: null, needsNewObject: true, skipped };
  }
  const needsNewObject = inherited || raw instanceof PDFRef;
  return { dict: resolved, needsNewObject, skipped };
}

function buildResourcesDict(context, plan, imageEntries, skipped) {
  const { PDFDict, PDFName, PDFRef, PDFStream, PDFInvalidObject } = getPdfLib();
  const out = PDFDict.withContext(context);
  if (plan.dict) {
    for (const [key, rawValue] of plan.dict.entries()) {
      if (key.toString() === '/XObject') continue;
      const resolved = resolveUntyped(context, rawValue);
      if (resolved === undefined) { skipped.push('Resources/' + key.toString() + ':dangling'); continue; }
      if (resolved instanceof PDFInvalidObject) { skipped.push('Resources/' + key.toString() + ':invalid'); continue; }
      if (resolved instanceof PDFStream && !(rawValue instanceof PDFRef)) { skipped.push('Resources/' + key.toString() + ':direct-stream'); continue; }
      out.set(key, rawValue);
    }
  }
  // XObject: old entries + new images (collision-safe names)
  const xobj = PDFDict.withContext(context);
  const usedNames = new Set();
  if (plan.dict) {
    const oldRaw = plan.dict.get(PDFName.of('XObject'));
    const oldResolved = oldRaw !== undefined ? resolveUntyped(context, oldRaw) : undefined;
    if (oldResolved instanceof PDFDict) {
      for (const [key, rawValue] of oldResolved.entries()) {
        const resolved = resolveUntyped(context, rawValue);
        if (resolved === undefined || resolved instanceof PDFInvalidObject || (resolved instanceof PDFStream && !(rawValue instanceof PDFRef))) {
          skipped.push('XObject/' + key.toString() + ':dropped');
          continue;
        }
        usedNames.add(key.toString());
        xobj.set(key, rawValue);
      }
    } else if (oldRaw !== undefined) {
      skipped.push('XObject:wrong-type');
    }
  }
  const assigned = {};
  for (const [baseName, ref] of imageEntries) {
    let name = baseName;
    let n = 2;
    while (usedNames.has('/' + name)) { name = baseName + n; n++; }
    usedNames.add('/' + name);
    xobj.set(PDFName.of(name), ref);
    assigned[baseName] = name;
  }
  out.set(PDFName.of('XObject'), xobj);
  return { resourcesDict: out, assigned };
}


/** انتخابِ سازندهٔ دیکشنریِ حاشیه‌نویسیِ برداری (همان سازنده‌های مسیرِ کاملِ pdf-lib). */
function buildAnnotDictForIncremental(pdfDoc, item) {
  if (!item || typeof item !== 'object') return null;
  if (item.kind === 'ink') return buildInkAnnotDict(pdfDoc, item);
  if (item.kind === 'line') return buildLineAnnotDict(pdfDoc, item);
  if (item.kind === 'square') return buildSquareAnnotDict(pdfDoc, item);
  if (item.kind === 'circle') return buildCircleAnnotDict(pdfDoc, item);
  return null;
}

// --- main builder ---
async function saveByIncrementalUpdate({ pdfDoc, baseBytes, pages, logger }) {
  const log = (level, msg, detail) => {
    if (logger && typeof logger[level] === 'function') {
      try { logger[level](msg, detail); } catch (_) {}
    }
  };
  const context = pdfDoc.context;
  const { PDFDocument, PDFName, PDFRef, PDFArray, PDFInvalidObject } = getPdfLib();
  if (context.trailerInfo && context.trailerInfo.Encrypt) {
    throw new Error('incremental: فایل رمزگذاری‌شده است؛ الحاقِ افزایشی روی آن امن نیست.');
  }
  if (!Buffer.isBuffer(baseBytes) || baseBytes.length < 8) throw new Error('incremental: بایت‌های پایه معتبر نیستند.');
  const loc = findLastStartXref(baseBytes);
  if (!loc || loc.kind === 'unknown') throw new Error('incremental: جدولِ xrefِ پایانیِ فایلِ اصلی پیدا نشد.');
  const trailerEntries = parseOriginalTrailer(baseBytes, loc);
  let maxObjNum = context.largestObjectNumber || 0;
  if (trailerEntries && trailerEntries.Size && trailerEntries.Size.kind === 'number') {
    maxObjNum = Math.max(maxObjNum, trailerEntries.Size.num - 1);
  }
  let rootText = null;
  if (context.trailerInfo && context.trailerInfo.Root) rootText = serializePdfObject(context.trailerInfo.Root);
  else if (trailerEntries && trailerEntries.Root && trailerEntries.Root.kind === 'ref') rootText = trailerEntries.Root.num + ' ' + trailerEntries.Root.gen + ' R';
  if (!rootText) throw new Error('incremental: رفرنسِ ریشه (Root) پیدا نشد.');
  let infoText = null;
  if (context.trailerInfo && context.trailerInfo.Info) infoText = serializePdfObject(context.trailerInfo.Info);
  let idText = null;
  if (context.trailerInfo && context.trailerInfo.ID) idText = serializePdfObject(context.trailerInfo.ID);
  const origSize = trailerEntries && trailerEntries.Size && trailerEntries.Size.kind === 'number' ? trailerEntries.Size.num : null;

  let pageCount = -1;
  try { pageCount = pdfDoc.getPageCount(); } catch (_) { pageCount = -1; }
  const requested = Object.keys(pages || {}).map(Number).filter((n) => Number.isFinite(n) && pages[n]);
  const pageTargets = [];
  let usedFallbackLeaves = false;
  if (pageCount > 0) {
    for (const pageNum of requested) {
      const idx = pageNum - 1;
      if (idx < 0 || idx >= pageCount) continue;
      let page = null;
      try { page = pdfDoc.getPage(idx); } catch (_) { page = null; }
      if (!page) continue;
      const ref = getPageLeafRef(pdfDoc, page.node);
      if (!ref) throw new Error('incremental: شمارهٔ آبجکتِ صفحهٔ ' + pageNum + ' پیدا نشد (دیکشنریِ مستقیم).');
      pageTargets.push({ pageNum, node: page.node, ref });
    }
  } else {
    const leaves = collectLeavesFallback(pdfDoc);
    if (leaves.length === 0) throw new Error('incremental: هیچ صفحه‌ای در فایل پیدا نشد.');
    usedFallbackLeaves = true;
    pageCount = leaves.length;
    for (const pageNum of requested) {
      const leaf = leaves[pageNum - 1];
      if (!leaf) continue;
      pageTargets.push({ pageNum, node: leaf.obj, ref: leaf.ref });
    }
  }
  if (pageTargets.length === 0) throw new Error('incremental: صفحهٔ قابلِ پردازشی پیدا نشد.');

  let nextNum = maxObjNum + 1;
  const alloc = () => {
    if (nextNum - (maxObjNum + 1) > MAX_INC_OBJECTS) throw new Error('incremental: شمارِ آبجکت‌های جدید از سقف گذشت.');
    return nextNum++;
  };
  const appended = [];
  const skipped = [];
  let annotatedPages = 0;
  let placed = 0;
  const pagePlacements = {};

  for (const target of pageTargets) {
    const entry = pages[target.pageNum] || {};
    const vector = Array.isArray(entry.vector) ? entry.vector : [];
    const pngBuffer = entry.overlayPngBuffer || null;
    const highlightBuffer = entry.highlightPngBuffer || null;
    const hasPng = Boolean(pngBuffer || highlightBuffer);
    if (!hasPng && vector.length === 0) continue;
    const node = target.node;

    if (hasPng) {
      const rawW = Number(entry.pageWidth);
      const rawH = Number(entry.pageHeight);
      if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 0 || rawH <= 0) {
        throw new Error('incremental: ابعادِ خامِ صفحهٔ ' + target.pageNum + ' معتبر نیست.');
      }
      // One clean tempDoc per PNG: pdf-lib decodes the PNG and builds
      // the exact XObject + SMask stream bytes; we copy them verbatim.
      const imageSets = [];
      for (const buf of [highlightBuffer, pngBuffer].filter(Boolean)) {
        const tempDoc = await PDFDocument.create();
        await tempDoc.embedPng(buf);
        const tempBytes = Buffer.from(await tempDoc.save({ useObjectStreams: false, updateMetadata: false }));
        imageSets.push(extractImageObjects(tempBytes));
      }
      const hlSet = highlightBuffer ? imageSets[0] : null;
      const ovSet = highlightBuffer ? imageSets[1] : imageSets[0];
      const imageEntries = [];
      const contentOps = ['q'];
      const placeImage = (set, baseName) => {
        let smaskNum = null;
        if (set.smask) {
          smaskNum = alloc();
          appended.push({ num: smaskNum, gen: 0, body: imageObjectBody(set.smask, null) });
        }
        const imgNum = alloc();
        appended.push({ num: imgNum, gen: 0, body: imageObjectBody(set.main, smaskNum) });
        imageEntries.push([baseName, PDFRef.of(imgNum, 0)]);
        contentOps.push(fmtNum(rawW) + ' 0 0 ' + fmtNum(rawH) + ' 0 0 cm');
        contentOps.push('/' + baseName + ' Do');
        contentOps.push('Q');
        contentOps.push('q');
        placed += 1;
      };
      if (hlSet) placeImage(hlSet, 'ImHL');
      if (ovSet) placeImage(ovSet, 'ImOV');
      contentOps.pop(); // trailing bare 'q' (each Do block ends with Q + next q)
      const contentText = contentOps.join('\n') + '\n';
      const contentNum = alloc();
      const contentDictText = '<< /Length ' + Buffer.byteLength(contentText, 'latin1') + ' >>';
      appended.push({
        num: contentNum, gen: 0,
        body: Buffer.concat([Buffer.from(contentDictText + '\nstream\n', 'latin1'), Buffer.from(contentText, 'latin1'), Buffer.from('\nendstream', 'latin1')]),
      });

      const newDict = copyDictEntries(context, node, new Set(['/Contents', '/Resources', '/Group']), skipped);
      const cp = contentsPlan(context, node, skipped);
      const contentRefs = cp.refs.slice();
      for (const streamObj of cp.copiedStreams) {
        const num = alloc();
        const dictText = serializePdfObject(streamObj.dict);
        appended.push({
          num, gen: 0,
          body: Buffer.concat([Buffer.from(dictText + '\nstream\n', 'latin1'), Buffer.from(streamObj.getContents()), Buffer.from('\nendstream', 'latin1')]),
        });
        contentRefs.push(PDFRef.of(num, 0));
      }
      contentRefs.push(PDFRef.of(contentNum, 0));
      newDict.set(PDFName.of('Contents'), context.obj(contentRefs));
      const rp = resourcesPlan(context, node, skipped);
      const built = buildResourcesDict(context, rp, imageEntries, skipped);
      if (rp.needsNewObject) {
        const resNum = alloc();
        appended.push({ num: resNum, gen: 0, body: Buffer.from(serializePdfObject(built.resourcesDict), 'latin1') });
        newDict.set(PDFName.of('Resources'), PDFRef.of(resNum, 0));
      } else {
        newDict.set(PDFName.of('Resources'), built.resourcesDict);
      }
      if (newDict.get(PDFName.of('Type')) === undefined) newDict.set(PDFName.of('Type'), PDFName.of('Page'));
      pagePlacements[target.pageNum] = { images: (hlSet ? 1 : 0) + (ovSet ? 1 : 0), annots: 0 };
      appended.push({ num: target.ref.objectNumber, gen: target.ref.generationNumber, body: Buffer.from(serializePdfObject(newDict), 'latin1') });
      annotatedPages += 1;
      continue;
    }

    // Vector-only page: same annotation dicts as the full-save path,
    // appended as new indirect objects + /Annots on the redefined page.
    const annotRefs = [];
    for (const item of vector) {
      const dict = buildAnnotDictForIncremental(pdfDoc, item);
      if (!dict) continue;
      const num = alloc();
      appended.push({ num, gen: 0, body: Buffer.from(serializePdfObject(dict), 'latin1') });
      annotRefs.push(PDFRef.of(num, 0));
      placed += 1;
    }
    if (annotRefs.length === 0) continue;
    const newDict = copyDictEntries(context, node, new Set(['/Annots']), skipped);
    const oldEntries = [];
    const oldRaw = node.get(PDFName.of('Annots'));
    if (oldRaw !== undefined) {
      const resolved = resolveUntyped(context, oldRaw);
      if (resolved instanceof PDFArray) {
        for (const eRaw of resolved.asArray()) {
          const e = resolveUntyped(context, eRaw);
          if (e === undefined || e instanceof PDFInvalidObject) { skipped.push('Annots:dropped'); continue; }
          oldEntries.push(eRaw);
        }
      } else {
        skipped.push('Annots:wrong-type');
      }
    }
    newDict.set(PDFName.of('Annots'), context.obj(oldEntries.concat(annotRefs)));
    pagePlacements[target.pageNum] = { images: 0, annots: annotRefs.length };
    appended.push({ num: target.ref.objectNumber, gen: target.ref.generationNumber, body: Buffer.from(serializePdfObject(newDict), 'latin1') });
    annotatedPages += 1;
  }

  if (appended.length === 0) throw new Error('incremental: هیچ آبجکتِ جدیدی ساخته نشد.');
  let xrefNum = null;
  if (loc.kind === 'stream') xrefNum = alloc();
  appended.sort((a, b) => a.num - b.num || a.gen - b.gen);
  const highestNum = Math.max(xrefNum || 0, appended[appended.length - 1].num);
  const size = Math.max(origSize || 0, highestNum + 1);
  if (skipped.length > 0) log('warn', 'incremental: skipped entries: ' + skipped.join(', '));

  let cursor = baseBytes.length + 1;
  const parts = [Buffer.from('\n', 'latin1')];
  const offsets = new Map();
  for (const obj of appended) {
    const header = Buffer.from(obj.num + ' ' + obj.gen + ' obj\n', 'latin1');
    const footer = Buffer.from('\nendobj\n', 'latin1');
    offsets.set(obj.num + ':' + obj.gen, cursor);
    parts.push(header, obj.body, footer);
    cursor += header.length + obj.body.length + footer.length;
  }
  const xrefOffset = cursor;
  const runs = [];
  for (const obj of appended) {
    const last = runs[runs.length - 1];
    if (last && last.start + last.count === obj.num) last.count++;
    else runs.push({ start: obj.num, count: 1 });
  }
  let xrefSection;
  if (loc.kind === 'table') {
    let s = 'xref\n';
    for (const run of runs) {
      s += run.start + ' ' + run.count + '\n';
      for (let k = 0; k < run.count; k++) {
        const num = run.start + k;
        const obj = appended.find((o) => o.num === num);
        s += String(offsets.get(num + ':' + obj.gen)).padStart(10, '0') + ' ' + String(obj.gen).padStart(5, '0') + ' n \n';
      }
    }
    s += 'trailer\n<< /Size ' + size + ' /Root ' + rootText + ' /Prev ' + loc.startXref;
    if (infoText) s += ' /Info ' + infoText;
    if (idText) s += ' /ID ' + idText;
    s += ' >>\n';
    xrefSection = Buffer.from(s, 'latin1');
  } else {
    const entryBytes = [];
    for (const obj of appended) {
      const off = offsets.get(obj.num + ':' + obj.gen);
      entryBytes.push(1, (off >>> 24) & 255, (off >>> 16) & 255, (off >>> 8) & 255, off & 255, (obj.gen >>> 8) & 255, obj.gen & 255);
    }
    const entriesBuf = Buffer.from(entryBytes);
    const indexText = runs.map((r) => r.start + ' ' + r.count).join(' ');
    const dictText = '<< /Type /XRef /Size ' + size + ' /Root ' + rootText + ' /Prev ' + loc.startXref + ' /W [ 1 4 2 ] /Index [ ' + indexText + ' ] /Length ' + entriesBuf.length + (infoText ? ' /Info ' + infoText : '') + (idText ? ' /ID ' + idText : '') + ' >>';
    xrefSection = Buffer.concat([
      Buffer.from(xrefNum + ' 0 obj\n' + dictText + '\nstream\n', 'latin1'),
      entriesBuf,
      Buffer.from('\nendstream\nendobj\n', 'latin1'),
    ]);
  }
  const tail = Buffer.from('startxref\n' + xrefOffset + '\n%%EOF\n', 'latin1');
  const outBytes = Buffer.concat([baseBytes].concat(parts, [xrefSection, tail]));
  return { outBytes, annotatedPages, placed, pageCount, skipped, usedFallbackLeaves, appendedCount: appended.length, xrefKind: loc.kind, pagePlacements };
}


/**
 * اعتبارسنجیِ خروجیِ افزایشی پیش از نوشتن روی دیسک: شمارِ صفحه‌ها
 * باید برابرِ انتظار باشد، شمارِ آبجکت‌های غیرقابل‌پارس باید
 * دقیقاً برابرِ خطِ مبنا (بایت‌های پایه) باشد — یعنی هیچ آبجکتِ
 * خرابِ تازه‌ای نساخته‌ایم — و روی صفحه‌های حاشیه‌نویسی‌شده،
 * تصویرِ XObject یا حاشیه‌نویسی‌های جدید باید واقعاً در دیکشنریِ
 * صفحه دیده شوند؛ سپس بررسیِ pdf.js. هر ردی، یعنی هیچ‌چیز نوشته
 * نمی‌شود.
 */
async function validateIncrementalBytes(outBytes, expectedPageCount, baselineInvalidCount, pagePlacements, buildDoc, logger, baseBytes) {
  // NOTE (Stage 8): expectedPageCount از دیدِ pdf-lib است. وقتی فایلِ
  // پایه آبجکتِ خراب دارد، pdf-lib ممکن است صفحه‌ای را که pdf.js
  // (خوانندهٔ واقعی) می‌بیند، گم کند؛ در این حالت، شمارِ درستِ
  // «حفظ‌شده» همان شمارِ pdf.js از بایت‌های پایه است، چون الحاقِ
  // افزایشی، درختِ صفحهٔ اصلی را بایت‌به‌بایت حفظ می‌کند. پس بخشِ
  // pdf.js، خروجی را با شمارِ pdf.js از بایت‌های پایه می‌سنجد (اگر
  // baseBytes داده شده باشد).
  const check = await loadPdfDocumentWithWarnings(Buffer.from(outBytes));
  if (check.loadError) {
    return { ok: false, reason: 'بارگذاریِ دوبارهٔ خروجیِ افزایشی با pdf-lib انجام نشد: ' + String((check.loadError && check.loadError.message) || check.loadError) };
  }
  if (expectedPageCount > 0 && check.pageCount !== expectedPageCount) {
    return { ok: false, reason: 'شمارِ صفحه‌های خروجیِ افزایشی (' + check.pageCount + ') با شمارِ موردِ انتظار (' + expectedPageCount + ') برابر نیست.' };
  }
  if (check.invalidObjects.length !== baselineInvalidCount) {
    return { ok: false, reason: 'خروجیِ افزایشی، ' + check.invalidObjects.length + ' آبجکتِ غیرقابل‌پارس دارد؛ خطِ مبنا ' + baselineInvalidCount + ' بود.' };
  }
  try {
    const { PDFName } = getPdfLib();
    for (const [pageNumStr, placement] of Object.entries(pagePlacements || {})) {
      const idx = Number(pageNumStr) - 1;
      if (!Number.isFinite(idx) || idx < 0 || idx >= check.pageCount) continue;
      const page = check.doc.getPage(idx);
      if (placement.images > 0) {
        let imageCount = 0;
        try {
          const res = page.node.Resources();
          const xobjRaw = res && res.get(PDFName.of('XObject'));
          const xobj = xobjRaw !== undefined ? check.doc.context.lookup(xobjRaw) : undefined;
          if (xobj && typeof xobj.entries === 'function') {
            for (const [, v] of xobj.entries()) {
              const obj = check.doc.context.lookup(v);
              if (obj && obj.dict && String(obj.dict.get(PDFName.of('Subtype'))) === '/Image') imageCount += 1;
            }
          }
        } catch (_) {}
        if (imageCount < placement.images) {
          return { ok: false, reason: 'تصویرِ حاشیه‌نویسی در صفحهٔ ' + pageNumStr + ' پیدا نشد.' };
        }
      }
      if (placement.annots > 0) {
        let expected = placement.annots;
        try {
          const oldAnnots = buildDoc.getPage(idx).node.Annots();
          if (oldAnnots) expected += oldAnnots.size();
        } catch (_) {}
        let have = expected;
        try {
          const a = page.node.Annots();
          if (a) have = a.size();
        } catch (_) {}
        if (have < expected) {
          return { ok: false, reason: 'حاشیه‌نویسی‌های برداری در صفحهٔ ' + pageNumStr + ' پیدا نشدند.' };
        }
      }
    }
  } catch (_) {}
  let pdfjs = null;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (err) {
    logSaveDiag(logger, 'warn', 'pdf-save: pdf.js validation skipped (module unavailable in main)', String((err && err.message) || err));
    return { ok: true, pdfjsSkipped: true };
  }
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(outBytes), verbosity: 0 }).promise;
    const n = doc.numPages;
    if (doc && typeof doc.destroy === 'function') {
      try { await doc.destroy(); } catch (_) {}
    }
    // شمارِ مرجعِ pdf.js: اگر بایت‌های پایه در دسترس‌اند، شمارِ
    // صفحه‌های خودِ فایلِ پایه از دیدِ pdf.js (درختِ حفظ‌شده)؛
    // در غیرِ این صورت، همان expectedPageCount.
    let pdfjsExpected = expectedPageCount;
    if (baseBytes && baseBytes.length > 0) {
      try {
        const baseDoc = await pdfjs.getDocument({ data: new Uint8Array(baseBytes), verbosity: 0 }).promise;
        const baseCount = baseDoc.numPages;
        if (baseDoc && typeof baseDoc.destroy === 'function') {
          try { await baseDoc.destroy(); } catch (_) {}
        }
        if (baseCount > 0) pdfjsExpected = baseCount;
      } catch (_) {
        // اگر پایه با pdf.js باز نشد، به expectedPageCount برمی‌گردیم.
      }
    }
    if (pdfjsExpected > 0 && n !== pdfjsExpected) {
      return { ok: false, reason: 'شمارِ صفحه‌های خروجیِ افزایشی در pdf.js (' + n + ') با شمارِ موردِ انتظار (' + pdfjsExpected + ') برابر نیست.' };
    }
    if (n <= 0) {
      return { ok: false, reason: 'pdf.js هیچ صفحه‌ای در خروجیِ افزایشی ندید.' };
    }
  } catch (err) {
    return { ok: false, reason: 'اعتبارسنجیِ خروجیِ افزایشی با pdf.js انجام نشد: ' + String((err && err.message) || err) };
  }
  return { ok: true };
}

/**
 * بایت‌های پایهٔ PDF را برای ساختِ خروجی برمی‌گرداند.
 * @returns {{baseBytes: Buffer, origBackupPath: string, usedOrigBackup: boolean, origCreated: boolean}}
 * @throws اگر در حالتِ in-place، نگه‌داشتنِ نسخهٔ خام ممکن نشد یا
 *   نه `.orig.bak` و نه فایلِ فعلی، بارگذاری نمی‌شوند (در این حالت،
 *   اصلاً روی فایلِ اصلی نوشته نمی‌شود تا پایهٔ تمیز، بی‌صدا از دست
 *   نرود). نتیجه، probeِ بارگذاریِ بایت‌های پایه را هم دارد تا مسیرِ
 *   ذخیره، فایل را دوبار پارس نکند.
 */
async function resolveBasePdfBytes(pdfPath, mode, logger) {
  const origPath = origBackupPathFor(pdfPath);
  // مرحله ۷ ـ نهاییِ دوم: «سالم بودنِ» پایه، فقط جادوی %PDF- نیست؛
  // بایت‌ها باید واقعاً با pdf-lib بارگذاری شوند و صفحه بدهند.
  // این کاوش، همان بارگذاریِ اولِ مسیرِ ذخیره است و نتیجه‌اش
  // (probe) به فراخواننده برمی‌گردد تا فایل، دوبار پارس نشود.
  // نکتهٔ مهم: هشدارِ آبجکتِ غیرقابل‌پارس، به‌تنهایی «ناسالم»
  // نیست — فایلِ ۶۸ مگابایتیِ کاربر، همان آبجکت‌های 3950/3951 را
  // در `.orig.bak` هم دارد و با مسیرِ افزایشی، سالم ذخیره می‌شود؛
  // ناسالم، یعنی بارگذاری کلاً شکست بخورد. پس معیارِ سلامت،
  // نبودِ loadError است، نه صفر بودنِ هشدارها.
  const isHealthyProbe = (probe) => Boolean(probe && probe.pdfDoc && !probe.loadError);
  // هات‌فیکسِ مرحله ۶: خواندنِ کاملِ فایلِ اصلی فقط وقتی لازم است
  // که `.orig.bak`ای نیست (یا خراب است و Save As به فایلِ فعلی
  // برمی‌گردد)؛ وقتی پایهٔ خام هست، خواندنِ دوبارهٔ فایلِ چندصد
  // مگابایتی، هم کند است و هم پنجرهٔ مسابقه با استریم‌های خواندنِ
  // پروتکل را بی‌دلیل باز می‌کند. pdf-lib هرگز خودِ فایل را باز
  // نمی‌کند (فقط روی بایت‌های حافظه کار می‌کند)؛ پس هیچ
  // file descriptorای از سمتِ این ماژول باز نمی‌ماند.
  let currentBytes = null;
  const readCurrentBytes = () => {
    if (!currentBytes) currentBytes = fs.readFileSync(pdfPath);
    return currentBytes;
  };
  let origExists = false;
  try {
    origExists = fs.existsSync(origPath) && fs.statSync(origPath).isFile();
  } catch (_) {
    origExists = false;
  }
  if (origExists) {
    const origBytes = fs.readFileSync(origPath);
    if (isPdfMagic(origBytes)) {
      const probe = await loadPdfDocumentWithWarnings(origBytes);
      if (isHealthyProbe(probe)) {
        return { baseBytes: origBytes, origBackupPath: origPath, usedOrigBackup: true, origCreated: false, origBackupCorrupt: false, probe };
      }
      // پایهٔ خام، بارگذاری نمی‌شود ولی فایلِ فعلی شاید سالم باشد
      // (مثلاً خروجیِ خرابِ قبلی، روی `.orig.bak` ننشسته است).
      // در این حالت، از بایت‌های فعلی استفاده می‌شود و `.orig.bak`ی
      // خراب، هرگز بازنویسی نمی‌شود؛ پرچمِ origBackupCorrupt،
      // موضوع را در نتیجهٔ ذخیره آشکار می‌کند.
      logSaveDiag(logger, 'warn', 'pdf-save: .orig.bak failed probe load; falling back to current file bytes', 'origBackup=' + origPath);
    } else {
      logSaveDiag(logger, 'warn', 'pdf-save: .orig.bak is not a PDF; falling back to current file bytes', 'origBackup=' + origPath);
    }
    const cur = readCurrentBytes();
    if (isPdfMagic(cur)) {
      const curProbe = await loadPdfDocumentWithWarnings(cur);
      if (isHealthyProbe(curProbe)) {
        return { baseBytes: cur, origBackupPath: origPath, usedOrigBackup: false, origCreated: false, origBackupCorrupt: true, probe: curProbe };
      }
    }
    if (mode === 'in-place') {
      throw new Error('فایلِ پشتیبانِ پایهٔ خام (.orig.bak) خراب است و فایلِ فعلی هم بارگذاری نمی‌شود؛ ذخیره انجام نشد. فایلِ .orig.bak را حذف کنید و دوباره تلاش کنید.');
    }
    // Save As: پایهٔ خراب را نادیده بگیر و از فایلِ فعلی استفاده کن
    // (اگر آن هم بارگذاری نشود، مسیرِ ذخیره با خطای بارگذاری رد می‌شود).
    return { baseBytes: cur, origBackupPath: origPath, usedOrigBackup: false, origCreated: false, origBackupCorrupt: true, probe: await loadPdfDocumentWithWarnings(cur) };
  }
  if (mode === 'in-place') {
    // پیش از ساختنِ `.orig.bak`، بایت‌های فعلی کاوش می‌شوند تا
    // بایت‌های بارگذاری‌نشدنی، «پایهٔ تمیز» نشوند.
    const cur = readCurrentBytes();
    const curProbe = await loadPdfDocumentWithWarnings(cur);
    if (!isHealthyProbe(curProbe)) {
      throw new Error('فایلِ PDFِ فعلی بارگذاری نمی‌شود؛ ذخیرهٔ درجا انجام نشد و نسخهٔ خام هم ساخته نشد تا بایت‌های خراب، پایهٔ تمیز نشوند.');
    }
    // فقط اگر وجود ندارد بساز؛ COPYFILE_EXCL جلوی بازنویسیِ مسابقه‌ای
    // (دو ذخیرهٔ هم‌زمان) را می‌گیرد.
    try {
      fs.copyFileSync(pdfPath, origPath, fs.constants.COPYFILE_EXCL);
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        const racedBytes = fs.readFileSync(origPath);
        if (isPdfMagic(racedBytes)) {
          const racedProbe = await loadPdfDocumentWithWarnings(racedBytes);
          if (isHealthyProbe(racedProbe)) {
            return { baseBytes: racedBytes, origBackupPath: origPath, usedOrigBackup: true, origCreated: false, origBackupCorrupt: false, probe: racedProbe };
          }
        }
        throw new Error('فایلِ پشتیبانِ پایهٔ خام (.orig.bak) خراب است؛ ذخیرهٔ درجا انجام نشد.');
      }
      throw new Error('نگه‌داشتنِ نسخهٔ خامِ اولیهٔ فایل (.orig.bak) انجام نشد؛ ذخیرهٔ درجا لغو شد تا پایهٔ تمیز از دست نرود.');
    }
    return { baseBytes: cur, origBackupPath: origPath, usedOrigBackup: false, origCreated: true, origBackupCorrupt: false, probe: curProbe };
  }
  const cur = readCurrentBytes();
  return { baseBytes: cur, origBackupPath: origPath, usedOrigBackup: false, origCreated: false, origBackupCorrupt: false, probe: await loadPdfDocumentWithWarnings(cur) };
}

// برای خوانایی، ساختِ PDFName/PDFNumber در یک جا متمرکز شده است.
function pdfLibName(pdfDoc, value) {
  const { PDFName } = getPdfLib();
  return PDFName.of(value);
}
function pdfLibNumber(pdfDoc, value) {
  const { PDFNumber } = getPdfLib();
  return PDFNumber.of(Number(Number(value).toFixed(2)));
}
function pdfLibNumberArray(pdfDoc, values) {
  const ctx = pdfDoc.context;
  return ctx.obj(values.map((v) => pdfLibNumber(pdfDoc, v)));
}
function pdfLibColorArray(pdfDoc, hex) {
  const ctx = pdfDoc.context;
  const [r, g, b] = hexToRgb01(hex);
  return ctx.obj([pdfLibNumber(pdfDoc, r), pdfLibNumber(pdfDoc, g), pdfLibNumber(pdfDoc, b)]);
}

/** کادرِ محیطیِ چند نقطه + پد. */
function bboxOfPoints(allPoints, pad = 4) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of allPoints) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return [0, 0, 1, 1];
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

function isFinitePoint(p) {
  return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

function buildInkAnnotDict(pdfDoc, item) {
  const strokes = (item.strokes || []).filter((s) => Array.isArray(s) && s.length > 0 && s.every(isFinitePoint));
  if (strokes.length === 0) return null;
  const ctx = pdfDoc.context;
  // تک‌نقطه: خطِ کوتاهِ افقی تا در PDF دیده شود (الگوی نسخهٔ اول).
  const normalized = strokes.map((stroke) => {
    if (stroke.length === 1) {
      const [x, y] = stroke[0];
      return [[x - 3, y], [x + 3, y]];
    }
    return stroke;
  });
  const flat = normalized.map((stroke) => stroke.flat());
  const allPoints = normalized.flat();
  const rect = bboxOfPoints(allPoints, 4);
  const opacity = clampOpacity(item.opacity, item.kind === 'ink' ? 0.95 : 0.9);
  const lineWidth = Math.max(0.25, Number(item.lineWidth) || 1);
  const annot = ctx.obj({
    Type: pdfLibName(pdfDoc, 'Annot'),
    Subtype: pdfLibName(pdfDoc, 'Ink'),
    Rect: pdfLibNumberArray(pdfDoc, rect),
    InkList: ctx.obj(flat.map((stroke) => ctx.obj(stroke.map((v) => pdfLibNumber(pdfDoc, v))))),
    C: pdfLibColorArray(pdfDoc, item.color),
    CA: pdfLibNumber(pdfDoc, opacity),
    Border: pdfLibNumberArray(pdfDoc, [0, 0, lineWidth]),
  });
  return annot;
}
function addInkAnnotation(pdfDoc, page, item) {
  const annot = buildInkAnnotDict(pdfDoc, item);
  if (!annot) return false;
  page.node.addAnnot(pdfDoc.context.register(annot));
  return true;
}


function buildLineAnnotDict(pdfDoc, item) {
  const { x1, y1, x2, y2 } = item;
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const ctx = pdfDoc.context;
  const pad = 4;
  const rect = [
    Math.min(x1, x2) - pad,
    Math.min(y1, y2) - pad,
    Math.max(x1, x2) + pad,
    Math.max(y1, y2) + pad,
  ];
  const lineWidth = Math.max(0.25, Number(item.lineWidth) || 1);
  const annot = ctx.obj({
    Type: pdfLibName(pdfDoc, 'Annot'),
    Subtype: pdfLibName(pdfDoc, 'Line'),
    Rect: pdfLibNumberArray(pdfDoc, rect),
    L: pdfLibNumberArray(pdfDoc, [x1, y1, x2, y2]),
    // سرِ فلش و نقطهٔ مبدأ، جدا رسم می‌شوند (Ink/Circle) تا دقیقاً
    // همان هندسهٔ روی صفحه باشند؛ پس انتهای خط، بدونِ تزئین است.
    LE: ctx.obj([pdfLibName(pdfDoc, 'None'), pdfLibName(pdfDoc, 'None')]),
    C: pdfLibColorArray(pdfDoc, item.color),
    CA: pdfLibNumber(pdfDoc, clampOpacity(item.opacity, 0.9)),
    Border: pdfLibNumberArray(pdfDoc, [0, 0, lineWidth]),
  });
  return annot;
}
function addLineAnnotation(pdfDoc, page, item) {
  const annot = buildLineAnnotDict(pdfDoc, item);
  if (!annot) return false;
  page.node.addAnnot(pdfDoc.context.register(annot));
  return true;
}


function buildSquareAnnotDict(pdfDoc, item) {
  const rect = item.rect;
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) return null;
  const ctx = pdfDoc.context;
  const fields = {
    Type: pdfLibName(pdfDoc, 'Annot'),
    Subtype: pdfLibName(pdfDoc, 'Square'),
    Rect: pdfLibNumberArray(pdfDoc, rect),
    C: pdfLibColorArray(pdfDoc, item.strokeColor || item.color),
    CA: pdfLibNumber(pdfDoc, clampOpacity(item.opacity, 0.9)),
    Border: pdfLibNumberArray(pdfDoc, [0, 0, Math.max(0.25, Number(item.lineWidth) || 1)]),
  };
  // پس‌زمینه: فقط وقتی آیتم fill دارد. شفافیتِ fill جدا (ca) گذاشته
  // می‌شود تا خطِ دور، با شفافیتِ خودش بماند.
  if (item.fillColor) {
    fields.IC = pdfLibColorArray(pdfDoc, item.fillColor);
    fields.ca = pdfLibNumber(pdfDoc, clampOpacity(item.fillOpacity, 0.15));
  }
  const annot = ctx.obj(fields);
  return annot;
}
function addSquareAnnotation(pdfDoc, page, item) {
  const annot = buildSquareAnnotDict(pdfDoc, item);
  if (!annot) return false;
  page.node.addAnnot(pdfDoc.context.register(annot));
  return true;
}


function buildCircleAnnotDict(pdfDoc, item) {
  const rect = item.rect;
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) return null;
  const ctx = pdfDoc.context;
  // نقطهٔ مبدأِ فلش: دایرهٔ توپرِ بدونِ خطِ دورِ جدا.
  const annot = ctx.obj({
    Type: pdfLibName(pdfDoc, 'Annot'),
    Subtype: pdfLibName(pdfDoc, 'Circle'),
    Rect: pdfLibNumberArray(pdfDoc, rect),
    C: pdfLibColorArray(pdfDoc, item.fillColor || item.color),
    IC: pdfLibColorArray(pdfDoc, item.fillColor || item.color),
    CA: pdfLibNumber(pdfDoc, clampOpacity(item.opacity, 0.9)),
    Border: pdfLibNumberArray(pdfDoc, [0, 0, 0]),
  });
  return annot;
}
function addCircleAnnotation(pdfDoc, page, item) {
  const annot = buildCircleAnnotDict(pdfDoc, item);
  if (!annot) return false;
  page.node.addAnnot(pdfDoc.context.register(annot));
  return true;
}


function decodeDataUrlPng(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  const buffer = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  return buffer.length > 0 ? buffer : null;
}


// ============================================================================
// مرحله ۷ ـ بخش الف: ضدضربه‌کردنِ دیکشنری‌های PDF پیش از دستکاریِ pdf-lib
//
// کالبدشکافی (با ۳۳ فایلِ PDFِ دست‌سازِ خراب و pdf-lib 1.17.1، اثبات‌شده
// در گزارشِ مرحله ۷): خودِ این ماژول، هیچ‌وقت `context.lookup` صدا
// نمی‌زند؛ خطای `Expected instance of PDFDict, but got instance of
// undefined` از درونِ pdf-lib می‌آید — از `normalizedEntries()` هنگامِ
// `page.node.addAnnot` یا `page.drawImage`، و از پیمایشِ درختِ صفحات
// هنگامِ `getPageCount()`. دو فرضِ پرامپت، با تست رد شد: ارجاع‌هایِ
// معلق (Dangling Refs) در `/Resources` و `/XObject` و `/Font` و
// `/ExtGState` و `/Annots`، به‌تنهایی هرگز کرش نمی‌کنند، چون
// `normalize()` در pdf-lib با `lookupMaybe` آن‌ها را ترمیم می‌کند.
// ماشه‌های واقعی، «مقدارهایِ بدریخت» (Wrong-Typed) هستند: `/Resources`
//ای که رشته/عدد/آرایه/استریم است، `/Annots`ای که عدد/دیکشنری است،
// و اشاره‌گرِ `/Pages` در کاتالوگ که به هیچ آبجکتی نمی‌رسد یا به
// آبجکتِ غیرِ درختِ صفحات اشاره می‌کند. این توابع، دقیقاً همان
// جاها را با «جست‌وجویِ بی‌نوع» (context.lookup بدونِ آرگومانِ نوع،
// که هرگز assert نمی‌کند) بررسی و ترمیم می‌کنند؛ هرگز throw
// نمی‌کنند تا خودِ ترمیم، به باگِ تازه‌ای تبدیل نشود.
// ============================================================================

/** جست‌وجویِ بی‌نوع: ارجاعِ معلق → undefined؛ مقدارِ مستقیم → خودش. هرگز throw نمی‌کند. */
function resolvePdfObjectUntyped(context, value) {
  if (value === undefined || value === null) return undefined;
  try {
    return context.lookup(value);
  } catch (_) {
    return undefined;
  }
}

/** دیکشنریِ «ساده»: نمونهٔ PDFDict که استریم نیست (استریم‌ها زیرکلاسِ PDFDictاند و Resourcesِ معتبر نیستند). */
function isPlainPdfDict(value, PDFDict, PDFStream) {
  return Boolean(value) && value instanceof PDFDict && !(value instanceof PDFStream);
}

/** نامِ `/Type` یک دیکشنری (مثلِ 'Page' یا 'Pages')؛ با ارجاعِ معلق یا مقدارِ بدریخت، null. */
function pdfDictTypeName(context, dict) {
  try {
    const { PDFName } = getPdfLib();
    const raw = dict.get(PDFName.of('Type'));
    const resolved = resolvePdfObjectUntyped(context, raw);
    if (!resolved) return null;
    if (typeof resolved.decodeText === 'function') return resolved.decodeText();
    if (typeof resolved.asString === 'function') return resolved.asString().replace(/^\//, '');
  } catch (_) {}
  return null;
}

/** ترمیمِ ورودی‌های `/Font` و `/XObject` و `/ExtGState` درونِ یک دیکشنریِ Resourcesِ معتبر. */
function repairResourcesDict(context, resourcesDict) {
  const { PDFDict, PDFStream, PDFName } = getPdfLib();
  if (!isPlainPdfDict(resourcesDict, PDFDict, PDFStream)) return;
  for (const key of ['Font', 'XObject', 'ExtGState']) {
    const raw = resourcesDict.get(PDFName.of(key));
    if (raw === undefined) continue;
    if (!isPlainPdfDict(resolvePdfObjectUntyped(context, raw), PDFDict, PDFStream)) {
      resourcesDict.set(PDFName.of(key), context.obj({}));
    }
  }
}

/**
 * یافتنِ Resourcesِ به‌ارث‌رسیدهٔ معتبر با بالا رفتن از زنجیرهٔ `/Parent`
 * (با جست‌وجویِ بی‌نوع و محافظِ چرخه). اگر هیچ سطحی Resourcesِ معتبر
 * نداشت، null برمی‌گردد تا فراخواننده، دیکشنریِ تازه بسازد.
 */
function findInheritedResourcesDict(context, pageNode) {
  const { PDFDict, PDFStream, PDFName } = getPdfLib();
  const seen = new Set();
  let node = pageNode;
  for (let depth = 0; depth < 50 && node; depth++) {
    if (seen.has(node)) return null;
    seen.add(node);
    const raw = node.get(PDFName.of('Resources'));
    if (raw !== undefined) {
      const resolved = resolvePdfObjectUntyped(context, raw);
      if (isPlainPdfDict(resolved, PDFDict, PDFStream)) return resolved;
    }
    const parentRaw = node.get(PDFName.of('Parent'));
    if (parentRaw === undefined) return null;
    const parent = resolvePdfObjectUntyped(context, parentRaw);
    if (!isPlainPdfDict(parent, PDFDict, PDFStream)) return null;
    node = parent;
  }
  return null;
}

/**
 * ترمیمِ دیکشنری‌های یک صفحه پیش از هر عملیاتِ pdf-lib روی آن:
 *  • `/Resources`: اگر ورودیِ خودِ صفحه، دیکشنریِ معتبر نیست،
 *    Resourcesِ به‌ارث‌رسیدهٔ معتبرِ والد جایگزین می‌شود؛ اگر
 *    آن هم نبود، دیکشنریِ تازهٔ خالی می‌نشیند (محتوایِ موجود،
 *    چون استریمِ خودش را دارد، از دست نمی‌رود؛ فقط مرجعِ
 *    Resourcesِ خراب، با مرجعِ سالم عوض می‌شود).
 *  • `/Annots`: ورودی‌هایِ معلق یا بدریختِ آرایه، حذف می‌شوند؛
 *    اگر خودِ `/Annots` آرایه نیست (عدد/دیکشنری/ارجاعِ معلق)،
 *    با آرایهٔ خالی جایگزین می‌شود تا `addAnnot` هرگز کرش نکند.
 *    حاشیه‌نویسی‌هایِ معتبرِ موجود، دست نمی‌خورند.
 */
function sanitizePageDictionaries(pdfDoc, page) {
  try {
    const { PDFDict, PDFStream, PDFArray, PDFName } = getPdfLib();
    const context = pdfDoc.context;
    const node = page.node;
    if (!node || typeof node.get !== 'function') return;
    // مرحله ۷ ـ بخش ب: پیش از هر چیز، زنجیرهٔ Parent (چرخه/بدریخت)
    // و ‎/Contentsِ بدریخت ترمیم شوند؛ وگرنه normalizeِ pdf-lib،
    // پیش از رسیدن به ترمیمِ Resources، می‌شکند.
    repairParentChain(pdfDoc, page);
    repairContentsEntry(context, node);
    const inherited = findInheritedResourcesDict(context, node);
    const ownRaw = node.get(PDFName.of('Resources'));
    const ownResolved = ownRaw === undefined ? undefined : resolvePdfObjectUntyped(context, ownRaw);
    if (isPlainPdfDict(ownResolved, PDFDict, PDFStream)) {
      repairResourcesDict(context, ownResolved);
    } else if (inherited) {
      node.set(PDFName.of('Resources'), inherited);
      repairResourcesDict(context, inherited);
    } else {
      node.set(PDFName.of('Resources'), context.obj({}));
    }
    const annotsRaw = node.get(PDFName.of('Annots'));
    if (annotsRaw !== undefined) {
      const annotsResolved = resolvePdfObjectUntyped(context, annotsRaw);
      if (annotsResolved instanceof PDFArray) {
        const kept = [];
        for (let i = 0; i < annotsResolved.size(); i++) {
          let entry;
          try {
            entry = annotsResolved.get(i);
          } catch (_) {
            continue;
          }
          if (entry === undefined) continue;
          if (isPlainPdfDict(resolvePdfObjectUntyped(context, entry), PDFDict, PDFStream)) {
            kept.push(entry);
          }
        }
        if (kept.length !== annotsResolved.size()) {
          node.set(PDFName.of('Annots'), context.obj(kept));
        }
      } else {
        node.set(PDFName.of('Annots'), context.obj([]));
      }
    }
  } catch (_) {
    // اگر خودِ ترمیم خطا داد، صفحه دست‌نخورده می‌ماند؛ مسیرِ عادیِ
    // pdf-lib (و catchِ بیرونیِ saveAnnotatedPdf) تصمیم می‌گیرد.
  }
}


/**
 * شمارشِ فقط‌خواندنیِ برگ‌های قابلِ‌دسترسیِ درختِ صفحات (بدونِ هیچ
 * تغییری روی سند): پیمایشِ Kids با رد شدن از ارجاع‌های معلق و
 * ادامهٔ پیمایشِ خواهرها. اگر این شمار، با شمارِ getPageCountِ
 * pdf-lib فرق کند، یعنی پیمایشِ pdf-lib، صفحه‌ای را (مثلاً به‌خاطرِ
 * ارجاعِ معلق در وسطِ Kids که ناوبریِ Countمحور را می‌شکند) گم
 * کرده است و درخت، ناسازگار است. ‎-1 یعنی شمارش ممکن نشد.
 */
function countReadablePageLeaves(pdfDoc) {
  try {
    const { PDFDict, PDFStream, PDFArray, PDFName, PDFPageTree, PDFPageLeaf } = getPdfLib();
    const context = pdfDoc.context;
    const catalog = pdfDoc.catalog;
    if (!catalog || typeof catalog.get !== 'function') return -1;
    const seen = new Set();
    let count = 0;
    const isLeafLike = (obj) => {
      if (!obj) return false;
      if (obj instanceof PDFPageLeaf) return true;
      if (obj instanceof PDFPageTree) return false;
      if (!isPlainPdfDict(obj, PDFDict, PDFStream)) return false;
      try {
        if (obj.get(PDFName.of('Kids')) !== undefined) return false;
      } catch (_) {
        return false;
      }
      const kind = pdfDictTypeName(context, obj);
      if (kind === 'Page') return true;
      if (kind === 'Pages') return false;
      try {
        return obj.get(PDFName.of('Contents')) !== undefined ||
          obj.get(PDFName.of('MediaBox')) !== undefined;
      } catch (_) {
        return false;
      }
    };
    const walk = (value, depth) => {
      if (depth > 200) return;
      const obj = resolvePdfObjectUntyped(context, value);
      if (!obj || seen.has(obj)) return;
      seen.add(obj);
      if (isLeafLike(obj)) {
        count += 1;
        return;
      }
      if (!isPlainPdfDict(obj, PDFDict, PDFStream) && !(obj instanceof PDFPageTree)) return;
      let kidsRaw;
      try {
        kidsRaw = obj.get(PDFName.of('Kids'));
      } catch (_) {
        return;
      }
      const kids = resolvePdfObjectUntyped(context, kidsRaw);
      if (!(kids instanceof PDFArray)) return;
      for (let i = 0; i < kids.size(); i++) {
        let kid;
        try {
          kid = kids.get(i);
        } catch (_) {
          continue;
        }
        walk(kid, depth + 1);
      }
    };
    walk(catalog.get(PDFName.of('Pages')), 0);
    return count;
  } catch (_) {
    return -1;
  }
}

/**
 * آیا شمارِ صفحه‌های pdf-lib با ساختارِ درخت ناسازگار است؟ دو
 * نشانه، مستقل بررسی می‌شود: ‎/Countِ اعلام‌شدهٔ ریشه، و شمارِ
 * برگ‌های قابلِ‌دسترسی در پیمایشِ فقط‌خواندنی. هر اختلافی، به
 * معنای گم‌شدنِ صفحه در پیمایش است و بازیابیِ درخت را لازم
 * می‌کند. هرگز throw نمی‌کند.
 */
function pageTreeCountMismatch(pdfDoc, pageCount) {
  try {
    const { PDFName } = getPdfLib();
    const context = pdfDoc.context;
    const catalog = pdfDoc.catalog;
    if (catalog && typeof catalog.get === 'function') {
      const pagesObj = resolvePdfObjectUntyped(context, catalog.get(PDFName.of('Pages')));
      if (pagesObj && typeof pagesObj.get === 'function') {
        const countResolved = resolvePdfObjectUntyped(context, pagesObj.get(PDFName.of('Count')));
        if (countResolved && typeof countResolved.asNumber === 'function') {
          const declared = countResolved.asNumber();
          if (Number.isFinite(declared) && declared !== pageCount) return true;
        }
      }
    }
  } catch (_) {}
  const readable = countReadablePageLeaves(pdfDoc);
  if (readable >= 0 && readable !== pageCount) return true;
  return false;
}

/**
 * مرحله ۷ ـ بخش ب: جمع‌آوریِ برگ‌های صفحه برای بازیابیِ عمیقِ
 * درخت (پیمایشِ بی‌نوع از ریشه + جاروی سراسریِ برگ‌های یتیم).
 * وراثتِ Resources/MediaBox/CropBox/Rotate، روی برگ‌ها کپی
 * می‌شود تا صاف‌کردنِ درخت، رندرِ صفحه‌ها را عوض نکند.
 */
function collectPageLeavesDeep(pdfDoc) {
  const { PDFDict, PDFStream, PDFArray, PDFName, PDFRef, PDFPageTree, PDFPageLeaf } = getPdfLib();
  const context = pdfDoc.context;
  const ordered = [];
  const seenRefs = new Set();
  const seenNodes = new Set();
  const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

  const isPageLike = (obj) => {
    if (!obj) return false;
    if (obj instanceof PDFPageLeaf) return true;
    if (obj instanceof PDFPageTree) return false;
    if (!isPlainPdfDict(obj, PDFDict, PDFStream)) return false;
    // گرهِ میانیِ بی‌Type (که MediaBox دارد) هرگز برگ نیست.
    try {
      if (obj.get(PDFName.of('Kids')) !== undefined) return false;
    } catch (_) {
      return false;
    }
    const kind = pdfDictTypeName(context, obj);
    if (kind === 'Page') return true;
    if (kind === 'Pages') return false;
    // برگِ بی‌Type: دیکشنری‌ای که استریمِ محتوا یا MediaBox دارد.
    try {
      return obj.get(PDFName.of('Contents')) !== undefined ||
        obj.get(PDFName.of('MediaBox')) !== undefined;
    } catch (_) {
      return false;
    }
  };

  const pushLeaf = (rawValue, obj, ancestors) => {
    // وراثتِ گم‌شده را پیش از جابه‌جاییِ برگ، روی خودِ برگ بنشان
    // تا صاف‌کردنِ درخت، فونت‌ها/MediaBoxِ به‌ارث‌رسیده را نکُشد.
    try {
      for (const key of INHERITABLE) {
        if (obj.get(PDFName.of(key)) !== undefined) continue;
        for (let a = ancestors.length - 1; a >= 0; a--) {
          const ancestor = ancestors[a];
          let raw;
          try { raw = ancestor.get(PDFName.of(key)); } catch (_) { raw = undefined; }
          if (raw !== undefined) {
            try { obj.set(PDFName.of(key), raw); } catch (_) {}
            break;
          }
        }
      }
    } catch (_) {}
    let ref = null;
    if (rawValue instanceof PDFRef) {
      ref = rawValue;
    } else {
      try { ref = context.getObjectRef(obj) || null; } catch (_) { ref = null; }
      if (!ref) {
        try { ref = context.register(obj); } catch (_) { return; }
      }
    }
    const key = ref.objectNumber + ':' + ref.generationNumber;
    if (seenRefs.has(key)) return;
    seenRefs.add(key);
    ordered.push({ ref, obj });
  };

  const walk = (value, depth, ancestors) => {
    if (depth > 200 || value === undefined || value === null) return;
    const obj = resolvePdfObjectUntyped(context, value);
    if (!obj) return;
    if (seenNodes.has(obj)) return;
    seenNodes.add(obj);
    if (isPageLike(obj)) {
      pushLeaf(value, obj, ancestors);
      return;
    }
    if (!isPlainPdfDict(obj, PDFDict, PDFStream) && !(obj instanceof PDFPageTree)) return;
    let kidsRaw;
    try { kidsRaw = obj.get(PDFName.of('Kids')); } catch (_) { return; }
    const kids = resolvePdfObjectUntyped(context, kidsRaw);
    if (!(kids instanceof PDFArray)) return;
    const nextAncestors = ancestors.concat([obj]);
    for (let i = 0; i < kids.size(); i++) {
      let kid;
      try { kid = kids.get(i); } catch (_) { continue; }
      walk(kid, depth + 1, nextAncestors);
    }
  };

  // ۱) پیمایش از ریشهٔ کاتالوگ (ترتیبِ سند حفظ می‌شود).
  try {
    const catalog = pdfDoc.catalog;
    if (catalog && typeof catalog.get === 'function') {
      walk(catalog.get(PDFName.of('Pages')), 0, []);
    }
  } catch (_) {}
  // ۲) جاروی سراسری: برگ‌های یتیمِ زیرِ گرهِ خراب، بر اساسِ شمارهٔ آبجکت.
  const orphans = [];
  try {
    for (const [ref, obj] of context.indirectObjects) {
      if (isPageLike(obj)) orphans.push({ ref, obj });
    }
  } catch (_) {}
  orphans.sort((a, b) => a.ref.objectNumber - b.ref.objectNumber);
  for (const entry of orphans) pushLeaf(entry.ref, entry.obj, []);
  return ordered;
}

/**
 * بازیابیِ عمیقِ درختِ صفحات وقتی `getPageCount()` خطا می‌دهد یا
 * صفر برمی‌گرداند. برخلافِ نسخهٔ بخش الف (که فقط Kidsِ ریشه را
 * بررسی می‌کرد)، این نسخه کلِ درخت را با جست‌وجوی بی‌نوع پیمایش
 * می‌کند، گره‌های میانیِ خراب را دور می‌زند، برگ‌های بی‌Type را
 * هم می‌یابد و همیشه یک درختِ مسطحِ تازه می‌سازد؛ وراثتِ
 * Resources/MediaBox/CropBox/Rotate، پیش از جابه‌جایی روی برگ‌ها
 * کپی می‌شود. false یعنی هیچ صفحهٔ قابلِ بازیابی‌ای نیست.
 */
function recoverPdfPageTree(pdfDoc) {
  try {
    const { PDFName, PDFNumber, PDFPageTree, PDFPageLeaf } = getPdfLib();
    const context = pdfDoc.context;
    const catalog = pdfDoc.catalog;
    if (!catalog || typeof catalog.get !== 'function') return false;
    const leaves = collectPageLeavesDeep(pdfDoc);
    if (leaves.length === 0) return false;
    // ترتیبِ نهایی، شمارهٔ آبجکت است (همان قراردادِ بخش الف):
    // در درختِ خراب، ترتیبِ پیمایش قابلِ اعتماد نیست (برگِ زیرِ
    // گرهِ خراب، آخرِ صف می‌افتد) و شمارهٔ آبجکت، در قریبِ اتفاقِ
    // تولیدکننده‌ها، همان ترتیبِ ساختِ صفحه‌هاست. بدونِ این مرتب‌سازی،
    // حاشیه‌نویسی روی صفحهٔ فیزیکیِ اشتباهی می‌نشست (تستِ A8b).
    leaves.sort((a, b) => a.ref.objectNumber - b.ref.objectNumber);
    // برگ‌های بی‌Type، در پارس، PDFDictِ ساده‌اند و computePagesِ
    // pdf-lib فقط نمونه‌های PDFPageLeaf را می‌شمارد؛ پس به PDFPageLeaf
    // ارتقا داده می‌شوند (همان ورودی‌ها، با ‎/Type /Page) و با همان
    // ارجاع، در کانتکست جایگزین می‌شوند. بدونِ این ارتقا، درختِ
    // بازسازی‌شده صفر صفحه برمی‌گرداند (باگِ کشف‌شده در تستِ A8b).
    for (const entry of leaves) {
      if (entry.obj instanceof PDFPageLeaf) continue;
      try {
        const leaf = PDFPageLeaf.fromMapWithContext(entry.obj.asMap(), context);
        leaf.set(PDFName.of('Type'), PDFName.of('Page'));
        context.assign(entry.ref, leaf);
        entry.obj = leaf;
      } catch (_) {}
    }
    const treeObj = PDFPageTree.withContext(context);
    treeObj.set(PDFName.of('Kids'), context.obj(leaves.map((entry) => entry.ref)));
    treeObj.set(PDFName.of('Count'), PDFNumber.of(leaves.length));
    const treeRef = context.register(treeObj);
    for (const { obj } of leaves) {
      try { obj.set(PDFName.of('Parent'), treeRef); } catch (_) {}
    }
    catalog.set(PDFName.of('Pages'), treeRef);
    return true;
  } catch (_) {
    return false;
  }
}

/** پاک‌سازیِ کشِ صفحه‌های pdf-lib پس از بازیابیِ درخت (وگرنه پیمایشِ خرابِ قبلی، کش‌شده می‌ماند). */
function invalidatePdfPageCache(pdfDoc) {
  try {
    if (pdfDoc.pageCache && typeof pdfDoc.pageCache.invalidate === 'function') {
      pdfDoc.pageCache.invalidate();
    }
  } catch (_) {}
  try {
    pdfDoc.pageCount = undefined;
  } catch (_) {}
}

/**
 * ترمیمِ زنجیرهٔ /Parentِ یک صفحه پیش از هر عملیاتِ pdf-lib روی
 * آن: زنجیرهٔ چرخه‌ای (Parentِ برگ = خودش یا چرخهٔ بالاتر) در
 * ascendِ pdf-lib، بازگشتِ بی‌نهایت (Maximum call stack) می‌سازد
 * و Parentِ بدریخت (عدد/رشته)، همان خطای PDFDict را پرتاب
 * می‌کند. فقط وقتی زنجیره واقعاً خراب است، برگ مستقیم به ریشهٔ
 * درخت وصل می‌شود (یا اگر ریشه معتبر نیست، Parent حذف می‌شود)؛
 * زنجیره‌های سالم، دست نمی‌خورند. هرگز throw نمی‌کند.
 */
function repairParentChain(pdfDoc, page) {
  try {
    const { PDFDict, PDFStream, PDFName, PDFRef } = getPdfLib();
    const context = pdfDoc.context;
    const node = page && page.node;
    if (!node || typeof node.get !== 'function') return;
    const seen = new Set();
    let current = node;
    let broken = false;
    for (let depth = 0; depth < 50 && current; depth++) {
      if (seen.has(current)) { broken = true; break; }
      seen.add(current);
      const parentRaw = current.get(PDFName.of('Parent'));
      if (parentRaw === undefined) break;
      const parent = resolvePdfObjectUntyped(context, parentRaw);
      if (parent === undefined) break; // ارجاعِ معلق: ascend خودش متوقف می‌شود.
      if (!isPlainPdfDict(parent, PDFDict, PDFStream)) { broken = true; break; }
      current = parent;
    }
    if (!broken) return;
    let rootRef = null;
    try {
      const catalog = pdfDoc.catalog;
      if (catalog && typeof catalog.get === 'function') {
        const pagesRaw = catalog.get(PDFName.of('Pages'));
        if (pagesRaw !== undefined) {
          const pagesObj = resolvePdfObjectUntyped(context, pagesRaw);
          if (isPlainPdfDict(pagesObj, PDFDict, PDFStream)) {
            rootRef = pagesRaw instanceof PDFRef ? pagesRaw : (context.getObjectRef(pagesObj) || null);
          }
        }
      }
    } catch (_) {}
    if (rootRef) {
      node.set(PDFName.of('Parent'), rootRef);
    } else {
      try {
        node.delete(PDFName.of('Parent'));
      } catch (_) {
        try { node.set(PDFName.of('Parent'), context.register(context.obj({}))); } catch (_) {}
      }
    }
  } catch (_) {}
}

/** ترمیمِ ‎/Contentsِ بدریختِ صفحه (عدد/دیکشنریِ ساده): با آرایهٔ خالی عوض می‌شود تا addContentStream، روی `Contents.push` نشکند. ارجاعِ معلق، دست نمی‌خورد (normalize خودش آرایه می‌سازد). */
function repairContentsEntry(context, node) {
  try {
    const { PDFArray, PDFName, PDFStream } = getPdfLib();
    const raw = node.get(PDFName.of('Contents'));
    if (raw === undefined) return;
    const resolved = resolvePdfObjectUntyped(context, raw);
    if (resolved === undefined) return;
    if (resolved instanceof PDFStream || resolved instanceof PDFArray) return;
    node.set(PDFName.of('Contents'), context.obj([]));
  } catch (_) {}
}

function pruneDanglingCatalogEntries(pdfDoc) {
  try {
    const { PDFName } = getPdfLib();
    const catalog = pdfDoc.catalog;
    if (!catalog || typeof catalog.get !== 'function') return 0;
    let pruned = 0;
    for (const key of ['AcroForm', 'StructTreeRoot', 'OCProperties', 'Outlines', 'Metadata']) {
      let raw;
      try { raw = catalog.get(PDFName.of(key)); } catch (_) { continue; }
      if (raw === undefined) continue;
      if (resolvePdfObjectUntyped(pdfDoc.context, raw) === undefined) {
        try { catalog.delete(PDFName.of(key)); pruned += 1; } catch (_) {}
      }
    }
    return pruned;
  } catch (_) {
    return 0;
  }
}

/** بازنشانیِ نرمالیزاسیونِ صفحه برای تلاشِ دوبارهٔ drawImage: Resourcesِ تازه (اول، به‌ارث‌رسیدهٔ معتبر) + پرچمِ normalize خاموش تا normalizeِ pdf-lib، دوباره با ترمیمِ lookupMaybe اجرا شود. */
function resetPageNormalization(pdfDoc, page) {
  try {
    const { PDFName } = getPdfLib();
    const node = page && page.node;
    if (!node || typeof node.set !== 'function') return;
    const inherited = findInheritedResourcesDict(pdfDoc.context, node);
    node.set(PDFName.of('Resources'), inherited || pdfDoc.context.obj({}));
    node.normalized = false;
  } catch (_) {}
}

/** نشستنِ یک تصویرِ overlay با یک بار تلاشِ دوباره پس از بازنشانیِ Resources؛ اگر تلاشِ دوم هم خطا داد، خطا به فراخواننده می‌رسد تا fallbackِ بازسازیِ تمیز تصمیم بگیرد. */
async function drawOverlayImageWithRetry(pdfDoc, page, pngImage, options) {
  try {
    page.drawImage(pngImage, options);
  } catch (firstErr) {
    resetPageNormalization(pdfDoc, page);
    sanitizePageDictionaries(pdfDoc, page);
    page.drawImage(pngImage, options);
  }
}

/**
 * اعمالِ حاشیه‌نویسی‌ها روی یک سندِ pdf-libِ باز (بازیابیِ درخت +
 * ترمیمِ صفحه‌ها + بردار/PNG + گروهِ شفافیت). خروجی‌اش، تعدادِ
 * صفحه‌ها و آیتم‌هاست؛ نوشتنِ بایت‌ها با buildOutputBytes است تا
 * fallbackِ بازسازی، همین مراحل را روی سندِ تازه تکرار کند.
 */
async function applyAnnotationsToDocument(pdfDoc, pages, options = {}) {
  const hadInvalidObjectWarnings = Boolean(options.hadInvalidObjectWarnings);
  const pageNumbers = Object.keys(pages || {})
    .map(Number)
    .filter((n) => Number.isFinite(n) && pages[n]);
  let pageCount = -1;
  let pageCountFailed = false;
  let pageTreeRecovered = false;
  try {
    pageCount = pdfDoc.getPageCount();
  } catch (_) {
    pageCount = -1;
    pageCountFailed = true;
  }
  // مرحله ۷ ـ نهایی: بازیابیِ درختِ صفحات، فقط وقتی خرابیِ درخت،
  // اثبات شده باشد — یعنی شمارِ صفحه‌ها خوانده نشد/صفر شد و یا
  // دسترسی به درخت، خودش خطا داد، یا هشدارِ آبجکتِ نامعتبر در
  // بارگذاری بود. روی درختِ سالم (بارگذاریِ تمیز + شمارِ معتبر)،
  // بازیابی هرگز اجرا نمی‌شود و ساختارِ اصلیِ فایل، دست‌نخورده
  // می‌ماند. توجه: «بدونِ هشدار» به‌تنهایی، بازیابی را ممنوع
  // نمی‌کند، چون ارجاعِ معلقِ /Pages (که در بخش الف اثبات شد)
  // هیچ هشداری تولید نمی‌کند ولی getPageCount را می‌شکند.
  // ناسازگاریِ شمار (صفحهٔ گم‌شده در پیمایش، با وجودِ شمارِ
  // مثبت) هم بازیابی را لازم می‌کند — وگرنه خروجی، بی‌صدا یک صفحه
  // کم می‌شود (ارجاعِ معلق در وسطِ Kids، ناوبریِ Countمحورِ
  // pdf-lib را می‌شکند).
  const countMismatch = pageCount > 0 && pageTreeCountMismatch(pdfDoc, pageCount);
  if ((pageCount <= 0 && (hadInvalidObjectWarnings || pageCountFailed)) || countMismatch) {
    pageTreeRecovered = recoverPdfPageTree(pdfDoc);
    if (pageTreeRecovered) {
      invalidatePdfPageCache(pdfDoc);
      try {
        pageCount = pdfDoc.getPageCount();
      } catch (_) {
        pageCount = -1;
      }
    }
  }
  if (pageCount <= 0) {
    return { annotatedPages: 0, placed: 0, pageCount: 0, pageTreeRecovered };
  }

  let annotatedPages = 0;
  let placed = 0;
  for (const pageNum of pageNumbers) {
    const idx = pageNum - 1;
    if (idx < 0 || idx >= pageCount) continue;
    const entry = pages[pageNum] || {};
    const vector = Array.isArray(entry.vector) ? entry.vector : [];
    const pngBuffer = decodeDataUrlPng(entry.overlayPng);
    const highlightBuffer = decodeDataUrlPng(entry.highlightPng);
    if (vector.length === 0 && !pngBuffer && !highlightBuffer) continue;
    const page = pdfDoc.getPage(idx);

    // مرحله ۷ ـ بخش ب: ترمیمِ Parent/Contents، پیش از هر عملیاتِ pdf-lib.
    sanitizePageDictionaries(pdfDoc, page);

    const hasPng = Boolean(pngBuffer || highlightBuffer);
    // وقتی هیچ تصویری نیست، بردار استفاده می‌شود؛ وقتی تصویر هست
    // (حتی فقط هایلایتر)، بردارِ تکراری نفرست تا «شبح دوتایی» پیش نیاید.
    if (!hasPng) {
      for (const item of vector) {
        if (!item || typeof item !== 'object') continue;
        let ok = false;
        if (item.kind === 'ink') ok = addInkAnnotation(pdfDoc, page, item);
        else if (item.kind === 'line') ok = addLineAnnotation(pdfDoc, page, item);
        else if (item.kind === 'square') ok = addSquareAnnotation(pdfDoc, page, item);
        else if (item.kind === 'circle') ok = addCircleAnnotation(pdfDoc, page, item);
        if (ok) placed += 1;
      }
    }

    if (hasPng) {
      const rawW = Number(entry.pageWidth);
      const rawH = Number(entry.pageHeight);
      if (Number.isFinite(rawW) && Number.isFinite(rawH) && rawW > 0 && rawH > 0) {
        // گذرِ اول: فقط هایلایترها، با ترکیبِ عادی (Normal /
        // source-over) — دقیقاً همان ترکیبی که مرورگر، بومِ
        // شفافِ Konva را روی تصویرِ صفحه می‌نشاند. ترکیبِ
        // Multiplyِ مرحلهٔ ۷ ـ بخش ب، روی هر پیکسلِ غیرسفیدِ
        // صفحه (متنِ سیاه، زمینهٔ خاکستریِ اسکن) تصویر را تیره‌تر
        // از داخلِ برنامه نشان می‌داد (روی سفید، هر دو یکسان‌اند؛
        // روی سیاه، Multiply متن را سیاهِ خالص نگه می‌دارد ولی
        // در برنامه، متن با رنگِ هایلایتر رنگی می‌شود)؛ پس
        // Multiply حذف شد و گروهِ شفافیتِ DeviceRGB هم که فقط
        // برای ایزوله‌کردنِ همان گذر لازم بود، برداشته شد.
        if (highlightBuffer) {
          const hlImage = await pdfDoc.embedPng(highlightBuffer);
          await drawOverlayImageWithRetry(pdfDoc, page, hlImage, {
            x: 0, y: 0, width: rawW, height: rawH,
          });
          placed += 1;
        }
        if (pngBuffer) {
          const pngImage = await pdfDoc.embedPng(pngBuffer);
          await drawOverlayImageWithRetry(pdfDoc, page, pngImage, {
            x: 0, y: 0, width: rawW, height: rawH,
          });
          placed += 1;
        }
      }
    }
    annotatedPages += 1;
  }
  return { annotatedPages, placed, pageCount, pageTreeRecovered };
}

/** بازیابی + اعمال + پاک‌سازیِ کاتالوگ + ذخیره (با fallbackِ بدونِ Object Streams). اگر هیچ صفحهٔ معتبری نباشد، outBytes برابرِ null است و چیزی نوشته نمی‌شود. */
async function buildOutputBytes(pdfDoc, pages, options = {}) {
  const applied = await applyAnnotationsToDocument(pdfDoc, pages, options);
  if (applied.annotatedPages === 0) {
    return { outBytes: null, ...applied };
  }
  pruneDanglingCatalogEntries(pdfDoc);
  // مرحله ۷ ـ نهایی: برای فایل‌های ترمیم‌شده/بازیابی‌شده، ذخیرهٔ
  // بدونِ Object Stream اول امتحان می‌شود (ساختارِ نزدیک‌تر به
  // فایلِ اصلی، جدولِ xrefِ کلاسیک) و ذخیرهٔ پیش‌فرض، fallback است.
  // برای فایل‌های سالم، ترتیبِ قبلی حفظ می‌شود.
  const preferNoObjectStreams = Boolean(options.preferNoObjectStreams);
  const saveDefault = () => pdfDoc.save();
  const savePlain = () => pdfDoc.save({ useObjectStreams: false, updateMetadata: false });
  let outBytes;
  try {
    outBytes = preferNoObjectStreams ? await savePlain() : await saveDefault();
  } catch (firstSaveErr) {
    try {
      outBytes = preferNoObjectStreams ? await saveDefault() : await savePlain();
    } catch (_) {
      throw firstSaveErr;
    }
  }
  return { outBytes, ...applied };
}

/**
 * ساختِ PDFِ حاشیه‌نویسی‌شده و ذخیرهٔ آن در مسیرِ خروجی.
 *
 * @param {Object} args
 * @param {string} args.pdfPath - مسیرِ فایلِ PDFِ اصلی (فقط خوانده می‌شود).
 * @param {Object} args.pages - { [pageNumber: number]: { vector: Array, overlayPng: string|null, pageWidth: number, pageHeight: number } }
 *   vector: آیتم‌های برداری با هندسهٔ نهایی در فضای خامِ PDF (پوینت، مبدأ پایین-چپ):
 *     { kind: 'ink', strokes: [[[x,y],...],...], color, lineWidth, opacity }
 *     { kind: 'line', x1, y1, x2, y2, color, lineWidth, opacity }
 *     { kind: 'square', rect: [x1,y1,x2,y2], strokeColor, fillColor|null, fillOpacity, lineWidth, opacity }
 *     { kind: 'circle', rect: [x1,y1,x2,y2], fillColor, opacity }
 *   overlayPng: dataURL تصویرِ PNGِ شفافِ کلِ صفحه (متن/استیکی/ابری)،
 *   در جهتِ خامِ صفحه؛ pageWidth/pageHeight ابعادِ خامِ صفحه به پوینت‌اند.
 * @param {string} args.outputPath - مسیرِ کاملِ فایلِ خروجی.
 * @param {'in-place'|'save-as'} [args.mode] - حالتِ ذخیره؛ اگر
 *   outputPath همان pdfPath باشد، بدونِ توجه به mode، درجا اعمال
 *   می‌شود. پیش‌فرض: 'save-as' (سازگاری با فراخوانِ بخش الف).
 * @returns {Promise<{success: boolean, outputPath?: string, pagesAnnotated?: number, annotationsPlaced?: number, backupPath?: string|null, origBackupPath?: string, usedOrigBackup?: boolean, origCreated?: boolean, restoredClean?: boolean, mode?: string, error?: string, canceled?: boolean}>}
 */
async function saveAnnotatedPdf({ pdfPath, pages, outputPath, mode, logger }) {
  try {
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      return { success: false, error: 'فایل PDF پیدا نشد.' };
    }
    if (path.extname(pdfPath).toLowerCase() !== '.pdf') {
      return { success: false, error: 'فقط فایل PDF پشتیبانی می‌شود.' };
    }
    if (!outputPath || typeof outputPath !== 'string') {
      return { success: false, error: 'مسیر فایل خروجی مشخص نشده است.' };
    }
    const normalizedMode = mode === 'in-place' ? 'in-place' : 'save-as';
    // خروجی روی خودِ فایلِ اصلی = درجا، هرچه mode گفته شده باشد.
    const effectiveMode = path.resolve(outputPath) === path.resolve(pdfPath) ? 'in-place' : normalizedMode;
    const pageNumbers = Object.keys(pages || {})
      .map(Number)
      .filter((n) => Number.isFinite(n) && pages[n]);
    // پایهٔ خام را پیش از هر تغییری مشخص کن (در حالتِ درجا، همین‌جا
    // `.orig.bak` ساخته می‌شود؛ اگر ساختنش نشد، هیچ‌چیز نوشته نمی‌شود).
    const saveLoggerEarly = (logger && typeof logger === 'object') ? logger : null;
    let base;
    try {
      base = await resolveBasePdfBytes(pdfPath, effectiveMode, saveLoggerEarly);
    } catch (err) {
      return { success: false, error: String((err && err.message) || err) };
    }
    if (pageNumbers.length === 0) {
      // حالتِ خاصِ درجا با صفر آیتم: کاربر همهٔ حاشیه‌نویسی‌ها را پاک
      // کرده و «ذخیره روی همین فایل» را زده است — فایل باید به پایهٔ
      // تمیز برگردد، نه اینکه بایت‌های پخته‌شدهٔ قبلی سرِ جایشان بمانند.
      // در Save As با صفر آیتم، چیزی برای نوشتن نیست (رفتارِ بخش الف).
      if (effectiveMode !== 'in-place') {
        return { success: false, error: 'حاشیه‌نویسی‌ای برای خروجی وجود ندارد.' };
      }
      await atomicWriteFile(outputPath, Buffer.from(base.baseBytes));
      return {
        success: true,
        outputPath,
        pagesAnnotated: 0,
        annotationsPlaced: 0,
        backupPath: base.origBackupPath,
        origBackupPath: base.origBackupPath,
        usedOrigBackup: base.usedOrigBackup,
        origCreated: base.origCreated,
        origBackupCorrupt: base.origBackupCorrupt,
        restoredClean: true,
        mode: effectiveMode,
      };
    }

    const saveLogger = saveLoggerEarly;
    // مرحله ۷ ـ نهایی، لایهٔ ۱: بارگذاریِ کاوشگرانه با رصدِ
    // هشدارهای پارسر، همین‌جا در resolveBasePdfBytes انجام شده و
    // نتیجه‌اش (probe) برگشته است تا فایل، دوبار پارس نشود. اگر
    // آبجکتِ غیرقابل‌پارسی گزارش شد، ترمیمِ هم‌طول روی کپیِ بافر
    // انجام و با بارگذاریِ دوباره اعتبارسنجی می‌شود؛ فقط بافرِ
    // ترمیم‌شدهٔ تمیز، مبنای ساخت قرار می‌گیرد. بایت‌های پایه،
    // همیشه از resolveBasePdfBytes می‌آیند — یعنی وقتی `.orig.bak`
    // هست، از روی نسخهٔ خامِ سالم، نه از روی فایلِ فعلی که ممکن
    // است خروجیِ خرابِ قبلی باشد.
    const firstLoad = base.probe;
    let buildBytes = base.baseBytes;
    let buildDoc = firstLoad.pdfDoc;
    // خطِ مبنای اعتبارسنجیِ افزایشی: شمارِ آبجکت‌های غیرقابل‌پارسِ
    // بایت‌هایی که واقعاً مبنای ساخت‌اند (پس از پذیرشِ ترمیم، صفر
    // است، نه شمارِ کاوشِ اول).
    let buildInvalidCount = firstLoad.invalidObjects.length;
    let healedObjects = [];
    let healRejected = false;
    if (firstLoad.invalidObjects.length > 0) {
      for (const inv of firstLoad.invalidObjects) {
        logSaveDiag(saveLogger, 'warn', 'pdf-save: invalid object ' + inv.num + ' ' + inv.gen + ' R at offset ' + inv.offset, diagnosticSampleAround(base.baseBytes, inv.offset));
      }
      const healed = healUnparseableIndirectObjectsInBuffer(base.baseBytes, firstLoad.invalidObjects);
      if (healed) {
        const checkLoad = await loadPdfDocumentWithWarnings(healed.buffer);
        if (!checkLoad.loadError && checkLoad.invalidObjects.length === 0 && checkLoad.pageCount > 0 && checkLoad.pageCount >= firstLoad.pageCount) {
          buildBytes = healed.buffer;
          buildDoc = checkLoad.pdfDoc;
          buildInvalidCount = checkLoad.invalidObjects.length;
          healedObjects = healed.healedRefs;
          logSaveDiag(saveLogger, 'info', 'pdf-save: byte-preserving heal applied to ' + healedObjects.length + ' object(s): ' + healedObjects.join(', '));
        } else {
          healRejected = true;
          logSaveDiag(saveLogger, 'warn', 'pdf-save: heal rejected (reload still invalid or page count dropped); continuing with original bytes', 'checkCount=' + checkLoad.pageCount + ' checkInvalidObjects=' + checkLoad.invalidObjects.length);
        }
      }
      // اگر هیچ ویرایشی اعمال نشد (مثلاً بدنهٔ خالی که جایی برای
      // `null` ندارد)، مسیرِ موجودِ ترمیمِ صفحه‌به‌صفحه + بازیابی،
      // طبقِ قبل ادامه می‌یابد؛ این حالت، ردِ ترمیم نیست.
    }
    if (!buildDoc) {
      throw firstLoad.loadError || new Error('ساختِ PDFِ حاشیه‌نویسی‌شده انجام نشد.');
    }
    // مرحله ۸ ـ بخش الف: فایلِ محافظت‌شده (‎/Encrypt) هرگز در مسیرِ
    // ذخیرهٔ معمولی بازنویسی نمی‌شود: بارگذاری با ignoreEncryption
    // انجام می‌شود و save()، دیکشنریِ ‎/Encrypt را دوباره صادر
    // می‌کند؛ پس خروجی، همچنان قفل می‌ماند (و اگر محتوای استریم‌ها
    // واقعاً رمز شده باشد، بازنویسی/الحاق، آن را خراب می‌کند). ذخیره،
    // با خطایِ راهنما رد می‌شود تا کاربر از مسیرِ «نسخهٔ کپیِ بدونِ
    // قفل» (استراتژیِ Xodo، هنگامِ ورود به استودیو) استفاده کند.
    const encryptRefForGuard = buildDoc.context && buildDoc.context.trailerInfo
      ? buildDoc.context.trailerInfo.Encrypt
      : null;
    let isEncryptedForGuard = false;
    if (encryptRefForGuard) {
      try {
        isEncryptedForGuard = Boolean(buildDoc.context.lookup(encryptRefForGuard));
      } catch (_) {
        isEncryptedForGuard = true;
      }
    }
    if (isEncryptedForGuard) {
      return { success: false, error: 'این فایل PDF محافظت‌شده است و امکانِ ذخیرهٔ مستقیمِ تغییرات روی آن وجود ندارد. از دکمهٔ استودیو، «ساخت نسخهٔ کپی و شروع ویرایش» را انتخاب کنید تا نسخه‌ای قابل‌ویرایش ساخته شود.' };
    }
    const hadInvalidObjectWarnings = firstLoad.invalidObjects.length > 0;
    const preferNoObjectStreams = healedObjects.length > 0;
    // مرحله ۷ ـ نهاییِ دوم: تصمیمِ هوشمندِ مسیرِ ذخیره. اگر در
    // بارگذاریِ بایت‌های پایه، حتی یک هشدارِ آبجکتِ غیرقابل‌پارس
    // بود، بازنویسیِ کامل با pdfDoc.save() اکیداً ممنوع است (فایلِ
    // دارای PDFInvalidObject را در PDFخوان‌های بیرونی فاسد می‌کند)
    // و فقط الحاقِ افزایشی اجرا می‌شود. ترمیمِ هم‌طول، این پرچم را
    // پاک نمی‌کند: ترمیم، حدسِ نحوی است و بازنویسیِ کامل، همچنان
    // همهٔ آبجکت‌ها را از نو می‌سازد.
    const incPages = {};
    for (const pn of pageNumbers) {
      const e = pages[pn] || {};
      incPages[pn] = {
        vector: Array.isArray(e.vector) ? e.vector : [],
        overlayPngBuffer: decodeDataUrlPng(e.overlayPng),
        highlightPngBuffer: decodeDataUrlPng(e.highlightPng),
        pageWidth: e.pageWidth,
        pageHeight: e.pageHeight,
      };
    }
    let incrementalFailureReason = '';
    const attemptIncrementalFallback = async (useFreshDoc) => {
      let incDoc = buildDoc;
      if (useFreshDoc) {
        // پس از تلاشِ ناموفقِ مسیرِ کامل، سندِ بارگذاری‌شده ممکن
        // است نیمه‌جهش‌یافته باشد؛ پس الحاق روی سندِ تازه‌ای از
        // همان بایت‌های پایه انجام می‌شود.
        const freshLoad = await loadPdfDocumentWithWarnings(buildBytes);
        if (!freshLoad.pdfDoc) return null;
        incDoc = freshLoad.pdfDoc;
      }
      try {
        const inc = await saveByIncrementalUpdate({ pdfDoc: incDoc, baseBytes: buildBytes, pages: incPages, logger: saveLogger });
        const v = await validateIncrementalBytes(inc.outBytes, inc.pageCount, buildInvalidCount, inc.pagePlacements, incDoc, saveLogger, buildBytes);
        if (!v.ok) {
          incrementalFailureReason = v.reason;
          logSaveDiag(saveLogger, 'error', 'pdf-save: incremental validation failed; nothing written', v.reason);
          return null;
        }
        await atomicWriteFile(outputPath, Buffer.from(inc.outBytes));
        return {
          success: true,
          outputPath,
          pagesAnnotated: inc.annotatedPages,
          annotationsPlaced: inc.placed,
          backupPath: base.origBackupPath,
          origBackupPath: base.origBackupPath,
          usedOrigBackup: base.usedOrigBackup,
          origCreated: base.origCreated,
          origBackupCorrupt: base.origBackupCorrupt,
          restoredClean: false,
          pageTreeRecovered: false,
          rebuiltClean: false,
          healedObjects,
          parseWarnings: firstLoad.invalidObjects.length,
          healRejected,
          outputValidated: true,
          incremental: true,
          incrementalFallback: Boolean(useFreshDoc),
          mode: effectiveMode,
        };
      } catch (err) {
        incrementalFailureReason = String((err && err.message) || err);
        logSaveDiag(saveLogger, 'error', 'pdf-save: incremental append failed; nothing written', incrementalFailureReason);
        return null;
      }
    };
    if (hadInvalidObjectWarnings) {
      const fb = await attemptIncrementalFallback(false);
      if (fb) return fb;
      return { success: false, error: 'ذخیرهٔ افزایشی انجام نشد و فایلِ اصلی دست نخورده باقی ماند. (' + incrementalFailureReason + ')' };
    }
    // تلاشِ اول روی سندِ بارگذاری‌شده؛ اگر هر مرحله‌ای (پیمایشِ
    // درخت، اعمال، ذخیره) شکست، کلِ مسیر روی سندِ تازه‌ای از همان
    // بایت‌های پایه (ترمیم‌شده، اگر ترمیم پذیرفته شد) تکرار
    // می‌شود (بازسازیِ تمیز). اگر بازسازی هم شکست، خطایِ تلاشِ
    // اول (گویاتر) برمی‌گردد و هیچ بایتی روی دیسک نوشته نمی‌شود.
    let outBytes = null;
    let annotatedPages = 0;
    let placed = 0;
    let expectedPageCount = -1;
    let pageTreeRecovered = false;
    let rebuiltClean = false;
    let firstError = null;
    try {
      const built = await buildOutputBytes(buildDoc, pages, { hadInvalidObjectWarnings, preferNoObjectStreams });
      annotatedPages = built.annotatedPages;
      placed = built.placed;
      pageTreeRecovered = built.pageTreeRecovered;
      expectedPageCount = built.pageCount;
      outBytes = built.outBytes;
    } catch (err) {
      firstError = err;
    }
    if (!outBytes && annotatedPages === 0 && !firstError) {
      return { success: false, error: 'هیچ صفحهٔ معتبری برای خروجی پیدا نشد.' };
    }
    if (!outBytes) {
      try {
        const retryLoad = await loadPdfDocumentWithWarnings(buildBytes);
        if (!retryLoad.pdfDoc) {
          throw firstLoad.loadError || new Error('ساختِ PDFِ حاشیه‌نویسی‌شده انجام نشد.');
        }
        const built2 = await buildOutputBytes(retryLoad.pdfDoc, pages, { hadInvalidObjectWarnings, preferNoObjectStreams });
        annotatedPages = built2.annotatedPages;
        placed = built2.placed;
        pageTreeRecovered = pageTreeRecovered || built2.pageTreeRecovered;
        expectedPageCount = built2.pageCount;
        outBytes = built2.outBytes;
        rebuiltClean = true;
      } catch (_) {
        // بازسازیِ تمیز هم شکست: آخرین شانس، الحاقِ افزایشی روی
        // سندِ تازه است؛ اگر آن هم نشد، خطایِ تلاشِ اول برمی‌گردد.
        const fb = await attemptIncrementalFallback(true);
        if (fb) return fb;
        throw firstError || new Error('ساختِ PDFِ حاشیه‌نویسی‌شده انجام نشد.');
      }
    }
    if (!outBytes || annotatedPages === 0) {
      return { success: false, error: 'هیچ صفحهٔ معتبری برای خروجی پیدا نشد.' };
    }
    // مرحله ۷ ـ نهایی، لایهٔ ۲: اعتبارسنجیِ خروجی پیش از نوشتن.
    // فقط وقتی ترمیم/بازیابی/بازسازی در کار بوده است (فایل‌های
    // سالم، مسیرِ سریعِ قبلی را می‌روند). اگر اعتبارسنجی رد شد،
    // هیچ‌چیز نوشته نمی‌شود و فایلِ اصلی + `.orig.bak` سالم
    // می‌مانند.
    let outputValidated = false;
    if (healedObjects.length > 0 || pageTreeRecovered || rebuiltClean) {
      const validation = await validateSavedPdfBytes(outBytes, expectedPageCount, saveLogger);
      if (!validation.ok) {
        logSaveDiag(saveLogger, 'error', 'pdf-save: output validation failed; trying incremental append', validation.reason);
        const fb = await attemptIncrementalFallback(true);
        if (fb) return fb;
        logSaveDiag(saveLogger, 'error', 'pdf-save: incremental fallback also failed; nothing written', incrementalFailureReason);
        return { success: false, error: 'خروجیِ ساخته‌شده، اعتبارسنجی نشد و روی دیسک نوشته نشد؛ فایلِ اصلی دست نخورده باقی ماند. (' + validation.reason + ')' };
      }
      outputValidated = true;
    }

    // دیگر `.bak`ی بازنویسی‌شونده ساخته نمی‌شود (همان باگی که
    // `.orig.bak` برای رفعش آمده): پشتیبانِ پایهٔ خام، پیش‌تر و فقط
    // یک بار در resolveBasePdfBytes ساخته/خوانده شده است.
    await atomicWriteFile(outputPath, Buffer.from(outBytes));

    return {
      success: true,
      outputPath,
      pagesAnnotated: annotatedPages,
      annotationsPlaced: placed,
      backupPath: base.origBackupPath,
      origBackupPath: base.origBackupPath,
      usedOrigBackup: base.usedOrigBackup,
      origCreated: base.origCreated,
      restoredClean: false,
      pageTreeRecovered,
      rebuiltClean,
      healedObjects,
      parseWarnings: firstLoad.invalidObjects.length,
      healRejected,
      outputValidated,
      origBackupCorrupt: base.origBackupCorrupt,
      mode: effectiveMode,
    };
  } catch (err) {
    if (err && err.code === 'FILE_LOCKED') {
      return { success: false, locked: true, error: err.message };
    }
    return { success: false, error: String((err && err.message) || err) };
  }
}


// ============================================================================
// مرحله ۸ ـ بخش الف: استراتژیِ Xodo برای PDFهای محافظت‌شده.
//
// probePdfProtection(bytes): فقط «وجودِ /Encrypt» را می‌سنجد؛ هیچ‌چیز
// نمی‌نویسد. فراخواننده (TopBar)، فقط هنگامِ کلیک روی دکمهٔ استودیو
// صدا می‌زند، پس باز کردنِ فایل برای خواندن، هیچ مزاحمتی ندارد.
//
// createUnlockedPdfCopy({bytes}): سند را با ignoreEncryption
// بارگذاری، محتوای رمزگذاری‌شده را با رمزِ خالی رمزگشایی می‌کند
// (decryptEncryptedDocument: Standard handler، V=1/2/4 و R=2/3/4)،
// دیکشنریِ /Encrypt را از تریلر حذف و دوباره ذخیره می‌کند. خروجی
// از «گیتِ متنیِ pdf.js» هم می‌گذرد: متنِ صفحهٔ اول و میانیِ
// فایلِ اصلی (که pdf.js با رمزِ خالی رمزگشایی می‌کند) با متنِ همان
// صفحه‌های کپی مقایسه می‌شود؛ اگر نخواند، کپی رد می‌شود و هیچ‌چیز
// نوشته نمی‌شود. رمزِ عبورِ واقعی و AES-256 پشتیبانی نمی‌شوند.
// ============================================================================


// ============================================================================
// مرحله ۸ ـ بخش الف (ادامه): رمزگشاییِ «Standard Security Handler»
// با رمزِ خالی (Empty User Password) — PDF 32000 §7.6.
//
// دامنهٔ پشتیبانی (آگاهانه و صریح):
//   • V=1 (RC4 ‎۴۰ بیت)، V=2 (RC4 با ‎/Lengthِ متغیر)، V=4 (فیلترِ
//     رمزِ StdCF با ‎/CFMِ ‎/V2 یا ‎/AESV2)؛ R=2/3/4.
//   • رمزِ مالک/کاربرِ غیرِخالی، V=5/R=5/6 (AES-256)، فیلترهای
//     غیرِStdCF و ترکیبِ «استریمِ آبجکتِ فشرده (ObjStm) + رمز»
//     پشتیبانی نمی‌شوند و با پیامِ صریح رد می‌شوند (نه خروجیِ خراب).
//   • راستی‌آزماییِ رمزِ خالی با مقدارِ ‎/U (الگوریتمِ ۳٫۶) انجام
//     می‌شود؛ اگر نخواند، یعنی فایل رمزِ عبورِ واقعی می‌خواهد.
//   • رشته‌ها با فیلترِ ‎/StrF و استریم‌ها با ‎/StmF رمزگشایی
//     می‌شوند؛ استریمِ xref هرگز رمز نمی‌شود و لمس نمی‌شود.
// ============================================================================

const PDF_ENCRYPTION_PADDING = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa,
  0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9,
  0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function pdfCopyCryptoError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function rc4CryptBytes(keyBytes, dataBytes) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + keyBytes[i % keyBytes.length]) & 0xff;
    const t = S[i]; S[i] = S[j]; S[j] = t;
  }
  const out = Buffer.alloc(dataBytes.length);
  let ii = 0;
  j = 0;
  for (let n = 0; n < dataBytes.length; n++) {
    ii = (ii + 1) & 0xff;
    j = (j + S[ii]) & 0xff;
    const t = S[ii]; S[ii] = S[j]; S[j] = t;
    out[n] = dataBytes[n] ^ S[(S[ii] + S[j]) & 0xff];
  }
  return out;
}

function pdfMd5(buf) {
  return nodeCrypto.createHash('md5').update(buf).digest();
}

function padPdfPassword(pwdBytes) {
  const b = Buffer.isBuffer(pwdBytes) ? pwdBytes : Buffer.from(pwdBytes || '');
  if (b.length >= 32) return b.slice(0, 32);
  return Buffer.concat([b, PDF_ENCRYPTION_PADDING.slice(0, 32 - b.length)]);
}

function int32LEBytes(value) {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(value | 0, 0);
  return buf;
}

function computePdfFileKey({ O, P, id0, keyLengthBytes, R, encryptMetadata }) {
  let seed = Buffer.concat([padPdfPassword(Buffer.alloc(0)), O, int32LEBytes(P)]);
  if (id0 && id0.length > 0) seed = Buffer.concat([seed, id0]);
  if (R >= 4 && encryptMetadata === false) {
    seed = Buffer.concat([seed, Buffer.from([0xff, 0xff, 0xff, 0xff])]);
  }
  let digest = pdfMd5(seed);
  if (R >= 3) {
    for (let i = 0; i < 50; i++) digest = pdfMd5(digest.slice(0, keyLengthBytes));
  }
  return digest.slice(0, keyLengthBytes);
}

function verifyPdfUserPassword({ fileKey, U, id0, R }) {
  if (!U || U.length < 16) return false;
  if (R === 2) {
    return U.length === 32 && rc4CryptBytes(fileKey, PDF_ENCRYPTION_PADDING).equals(U);
  }
  // Algorithm 3.5 (R>=3): 19 extra RC4 passes with key bytes XORed by 1..19.
  let check = rc4CryptBytes(fileKey, pdfMd5(Buffer.concat([PDF_ENCRYPTION_PADDING, id0 || Buffer.alloc(0)])));
  for (let j = 1; j <= 19; j++) {
    const kj = Buffer.from(fileKey);
    for (let k = 0; k < kj.length; k++) kj[k] ^= j;
    check = rc4CryptBytes(kj, check);
  }
  return U.slice(0, 16).equals(check);
}

function computePdfObjectKey(fileKey, objNum, genNum, useAes) {
  const ext = Buffer.alloc(5);
  ext[0] = objNum & 0xff;
  ext[1] = (objNum >> 8) & 0xff;
  ext[2] = (objNum >> 16) & 0xff;
  ext[3] = genNum & 0xff;
  ext[4] = (genNum >> 8) & 0xff;
  let seed = Buffer.concat([fileKey, ext]);
  if (useAes) seed = Buffer.concat([seed, Buffer.from('sAlT', 'latin1')]);
  const digest = pdfMd5(seed);
  return digest.slice(0, Math.min(fileKey.length + 5, 16));
}

function decryptPdfBytesWithObjectKey(objKey, data, useAes, isStream) {
  if (!useAes) return rc4CryptBytes(objKey, data);
  // AES-128-CBC: هم استریم‌ها و هم رشته‌ها IV را در ۱۶ بایتِ اولِ
  // دادهٔ رمزگذاری‌شده دارند (ISO 32000 7.6.2؛ در pdf.js هم رشتهٔ AES
  // با خواندنِ ۱۶ بایتِ اول به‌عنوانِ IV رمزگشایی می‌شود).
  if (data.length < 32) {
    throw pdfCopyCryptoError('PDF_COPY_UNSUPPORTED_ENCRYPTION', 'دادهٔ رمزگذاری‌شدهٔ AES، کوتاه‌تر از حدِ IV + یک بلوک است.');
  }
  const iv = data.slice(0, 16);
  const body = data.slice(16);
  if (body.length === 0) return Buffer.alloc(0);
  const decipher = nodeCrypto.createDecipheriv('aes-128-cbc', objKey, iv);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function pdfNameText(nameObj) {
  try {
    const s = typeof nameObj.asString === 'function' ? nameObj.asString() : String(nameObj);
    return String(s).replace(/^\//, '');
  } catch (_) {
    return '';
  }
}

function pdfDictStringBytes(value) {
  if (!value) return null;
  const cn = value.constructor ? value.constructor.name : '';
  if (cn === 'PDFString') {
    try { return Buffer.from(value.asString(), 'latin1'); } catch (_) { return null; }
  }
  if (cn === 'PDFHexString') {
    try {
      let hex = String(value.asString()).replace(/\s+/g, '');
      if (hex.length % 2 === 1) hex += '0';
      return Buffer.from(hex, 'hex');
    } catch (_) { return null; }
  }
  return null;
}

function parsePdfEncryptionInfo(pdfDoc) {
  const { PDFName, PDFRef } = getPdfLib();
  const context = pdfDoc.context;
  const encRef = context.trailerInfo ? context.trailerInfo.Encrypt : null;
  if (!encRef) return null;
  let encDict = null;
  try {
    const looked = context.lookup(encRef);
    if (looked && looked.constructor && looked.constructor.name === 'PDFDict') encDict = looked;
  } catch (_) {}
  if (!encDict && encRef && encRef.constructor && encRef.constructor.name === 'PDFDict') encDict = encRef;
  if (!encDict) return null;

  const resolveVal = (v) => {
    if (v && v.constructor && v.constructor.name === 'PDFRef') {
      try { return context.lookup(v); } catch (_) { return undefined; }
    }
    return v;
  };
  const getRaw = (key) => resolveVal(encDict.get(PDFName.of(key)));
  const getNumber = (key, fallback) => {
    const v = getRaw(key);
    if (v && typeof v.asNumber === 'function') {
      const n = v.asNumber();
      return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
  };
  const getName = (key, fallback) => {
    const v = getRaw(key);
    if (!v) return fallback;
    const n = pdfNameText(v);
    return n || fallback;
  };

  const filter = getName('Filter', 'Standard');
  const V = getNumber('V', 0);
  const R = getNumber('R', 0);
  let lengthBits = getNumber('Length', 0);
  if (!lengthBits) lengthBits = V === 4 ? 128 : 40;
  const O = pdfDictStringBytes(getRaw('O'));
  const U = pdfDictStringBytes(getRaw('U'));
  const P = getNumber('P', -4);
  let encryptMetadata = true;
  const emRaw = getRaw('EncryptMetadata');
  if (emRaw && typeof emRaw.asBoolean === 'function') encryptMetadata = Boolean(emRaw.asBoolean());

  let id0 = Buffer.alloc(0);
  try {
    const idVal = context.trailerInfo ? context.trailerInfo.ID : null;
    const idResolved = resolveVal(idVal);
    if (idResolved && typeof idResolved.asArray === 'function') {
      const parts = idResolved.asArray();
      const first = pdfDictStringBytes(parts && parts[0]);
      if (first) id0 = first;
    }
  } catch (_) {}

  // فیلترهای رمز (V=4): پیش‌فرض، StdCF برای هر دو نوع.
  let stmFilterName = 'StdCF';
  let strFilterName = 'StdCF';
  let cfmByFilter = { StdCF: { cfm: 'V2', lengthBits } };
  try {
    const stmF = getName('StmF', '');
    if (stmF) stmFilterName = stmF;
    const strF = getName('StrF', '');
    if (strF) strFilterName = strF;
    const cfRaw = getRaw('CF');
    if (cfRaw && cfRaw.constructor && cfRaw.constructor.name === 'PDFDict') {
      for (const [keyObj, valObj] of cfRaw.entries()) {
        const fname = pdfNameText(keyObj);
        const fdict = resolveVal(valObj);
        if (!fname || !fdict || fdict.constructor.name !== 'PDFDict') continue;
        const cfmRaw = fdict.get(PDFName.of('CFM'));
        const cfm = cfmRaw ? pdfNameText(resolveVal(cfmRaw)) : 'V2';
        const flen = (() => {
          const lv = fdict.get(PDFName.of('Length'));
          const lr = resolveVal(lv);
          return lr && typeof lr.asNumber === 'function' ? lr.asNumber() : lengthBits;
        })();
        cfmByFilter[fname] = { cfm: cfm || 'V2', lengthBits: flen || lengthBits };
      }
    }
  } catch (_) {}

  return {
    encryptRef: encRef,
    filter, V, R, lengthBits, O, U, P, id0, encryptMetadata,
    stmFilterName, strFilterName, cfmByFilter,
    stmCfm: (cfmByFilter[stmFilterName] || {}).cfm || 'V2',
    strCfm: (cfmByFilter[strFilterName] || {}).cfm || 'V2',
  };
}

function decryptEncryptedDocument(pdfDoc, logger) {
  if (!nodeCrypto) {
    throw pdfCopyCryptoError('PDF_COPY_UNSUPPORTED_ENCRYPTION', 'رمزگشایی در این محیط در دسترس نیست (ماژولِ crypto پیدا نشد).');
  }
  const info = parsePdfEncryptionInfo(pdfDoc);
  if (!info) return { decrypted: false, reason: 'no-encrypt-dict' };
  if (info.filter !== 'Standard') {
    throw pdfCopyCryptoError('PDF_COPY_UNSUPPORTED_ENCRYPTION', 'فیلترِ رمزگذاریِ فایل (' + info.filter + ') پشتیبانی نمی‌شود؛ فقط Standard پشتیبانی می‌شود.');
  }
  if (info.R >= 5 || info.V === 5) {
    throw pdfCopyCryptoError('PDF_COPY_UNSUPPORTED_ENCRYPTION', 'این فایل با AES-256 (R=5/6) رمزگذاری شده است و بدونِ رمزِ عبور، در برنامه باز نمی‌شود.');
  }
  if (![1, 2, 4].includes(info.V) || ![2, 3, 4].includes(info.R)) {
    throw pdfCopyCryptoError('PDF_COPY_UNSUPPORTED_ENCRYPTION', 'نسخهٔ رمزگذاریِ فایل (V=' + info.V + '، R=' + info.R + ') پشتیبانی نمی‌شود.');
  }
  for (const kind of ['stmCfm', 'strCfm']) {
    const cfm = info[kind];
    if (!['V2', 'AESV2', 'None'].includes(cfm)) {
      throw pdfCopyCryptoError('PDF_COPY_UNSUPPORTED_ENCRYPTION', 'روشِ رمزگذاریِ ' + (kind === 'stmCfm' ? 'استریم' : 'رشته') + ' (' + cfm + ') پشتیبانی نمی‌شود.');
    }
  }
  if (!info.O || !info.U) {
    throw pdfCopyCryptoError('PDF_COPY_UNSUPPORTED_ENCRYPTION', 'دیکشنریِ /Encrypt ناقص است (‎/O یا ‎/U ندارد).');
  }
  const keyLengthBytes = Math.max(5, Math.min(16, Math.floor(info.lengthBits / 8) || 5));
  const fileKey = computePdfFileKey({
    O: info.O, P: info.P, id0: info.id0,
    keyLengthBytes, R: info.R, encryptMetadata: info.encryptMetadata,
  });
  if (!verifyPdfUserPassword({ fileKey, U: info.U, id0: info.id0, R: info.R })) {
    throw pdfCopyCryptoError('PDF_COPY_PASSWORD_REQUIRED', 'این فایل با رمزِ عبور محافظت شده است و با رمزِ خالی باز نمی‌شود. برای ساختِ نسخهٔ کپی، ابتدا فایل را با رمزِ آن در یک PDFخوان باز و بدونِ رمز ذخیره کنید.');
  }

  const { PDFDict, PDFArray, PDFString, PDFHexString, PDFRef } = getPdfLib();
  const context = pdfDoc.context;
  const encryptObjNum = info.encryptRef && typeof info.encryptRef.objectNumber === 'number'
    ? info.encryptRef.objectNumber
    : -1;

  // پیش‌اسکن (بدونِ تغییر): استریمِ آبجکتِ فشرده یا xref، زیرِ رمز،
  // مدلِ پارس‌شده را از قبل خراب کرده است؛ پس کلِ مسیر رد می‌شود.
  const allEntries = context.enumerateIndirectObjects();
  for (const [, obj] of allEntries) {
    if (!obj || !obj.dict || typeof obj.getContents !== 'function') continue;
    let typeName = '';
    try {
      const tRaw = obj.dict.get(getPdfLib().PDFName.of('Type'));
      const tResolved = tRaw && tRaw.constructor && tRaw.constructor.name === 'PDFRef' ? context.lookup(tRaw) : tRaw;
      typeName = tResolved ? pdfNameText(tResolved) : '';
    } catch (_) {}
    if (typeName === 'ObjStm') {
      throw pdfCopyCryptoError('PDF_COPY_UNSUPPORTED_ENCRYPTION', 'این فایل، آبجکت‌های فشرده (ObjStm) را با رمز ترکیب کرده است و رمزگشاییِ امنِ آن در برنامه ممکن نیست.');
    }
    if (typeName === 'XRef') {
      // استریمِ xref هرگز رمز نمی‌شود؛ در گامِ بعد، از رمزگشایی رد می‌شود.
    }
  }

  const visited = new Set();
  let streamCount = 0;
  let stringCount = 0;

  const makeDecryptedString = (origObj, decryptedBytes) => {
    // همیشه رشتهٔ هگز: PDFStringِ pdf-lib هنگامِ نوشتن، پرانتز و
    // بک‌اسلش را escape نمی‌کند؛ پس بایت‌های دلخواهِ رمزگشایی‌شده
    // اگر به‌صورتِ رشتهٔ لفظی نوشته شوند، پارسِ دوبارهٔ فایل را
    // می‌شکنند (در فیکسچرِ تست، دقیقاً همین اتفاق برای O/U افتاد).
    // رشتهٔ هگز، از نظرِ معنایی با رشتهٔ لفظی یکی است.
    void origObj;
    return PDFHexString.of(Buffer.from(decryptedBytes).toString('hex'));
  };

  const decryptStringObject = (strObj, objNum, genNum, useAes) => {
    const raw = pdfDictStringBytes(strObj);
    if (raw === null || raw.length === 0) return strObj;
    const objKey = computePdfObjectKey(fileKey, objNum, genNum, useAes);
    const dec = decryptPdfBytesWithObjectKey(objKey, raw, useAes, false);
    stringCount++;
    return makeDecryptedString(strObj, dec);
  };

  const walkValue = (value, objNum, genNum, kind) => {
    if (!value) return value;
    const cn = value.constructor ? value.constructor.name : '';
    if (cn === 'PDFRef') {
      let target = null;
      try { target = context.lookup(value); } catch (_) { return value; }
      if (!target) return value;
      const tNum = typeof value.objectNumber === 'number' ? value.objectNumber : objNum;
      const tGen = typeof value.generationNumber === 'number' ? value.generationNumber : genNum;
      return walkValue(target, tNum, tGen, kind);
    }
    if (cn === 'PDFString' || cn === 'PDFHexString') {
      if (kind === 'none') return value;
      const useAes = kind === 'aes';
      return decryptStringObject(value, objNum, genNum, useAes);
    }
    if (cn === 'PDFDict') {
      if (visited.has(value)) return value;
      visited.add(value);
      const entries = [...value.entries()];
      for (const [keyObj, valObj] of entries) {
        const replaced = walkValue(valObj, objNum, genNum, kind);
        if (replaced !== valObj) value.set(keyObj, replaced);
      }
      return value;
    }
    if (cn === 'PDFArray') {
      if (visited.has(value)) return value;
      visited.add(value);
      const items = value.asArray();
      for (let i = 0; i < items.length; i++) {
        const replaced = walkValue(items[i], objNum, genNum, kind);
        if (replaced !== items[i]) value.set(i, replaced);
      }
      return value;
    }
    return value;
  };

  for (const [ref, obj] of allEntries) {
    if (!obj) continue;
    const objNum = typeof ref.objectNumber === 'number' ? ref.objectNumber : 0;
    const genNum = typeof ref.generationNumber === 'number' ? ref.generationNumber : 0;
    if (objNum === encryptObjNum) continue;
    const isStream = obj && obj.dict && typeof obj.getContents === 'function' && ('contents' in obj);
    if (isStream) {
      let typeName = '';
      try {
        const tRaw = obj.dict.get(getPdfLib().PDFName.of('Type'));
        const tResolved = tRaw && tRaw.constructor && tRaw.constructor.name === 'PDFRef' ? context.lookup(tRaw) : tRaw;
        typeName = tResolved ? pdfNameText(tResolved) : '';
      } catch (_) {}
      if (typeName === 'XRef') continue;
      // دیکشنریِ استریم (رشته‌ها با فیلترِ رشته).
      const strUseAes = info.strCfm === 'AESV2';
      if (info.strCfm !== 'None') walkValue(obj.dict, objNum, genNum, strUseAes ? 'aes' : 'rc4');
      // محتوای استریم (با فیلترِ استریم).
      if (info.stmCfm !== 'None') {
        const stmUseAes = info.stmCfm === 'AESV2';
        const rawContents = obj.getContents();
        if (rawContents && rawContents.length > 0) {
          const objKey = computePdfObjectKey(fileKey, objNum, genNum, stmUseAes);
          const dec = decryptPdfBytesWithObjectKey(objKey, Buffer.from(rawContents), stmUseAes, true);
          obj.contents = new Uint8Array(dec);
          streamCount++;
        }
      }
      continue;
    }
    const strUseAes = info.strCfm === 'AESV2';
    if (info.strCfm !== 'None') walkValue(obj, objNum, genNum, strUseAes ? 'aes' : 'rc4');
  }

  logSaveDiag(logger, 'info', 'pdf-copy: decrypted objects with empty password', 'streams=' + streamCount + ' strings=' + stringCount);
  return { decrypted: true, streamCount, stringCount };
}

function safeProbePageCount(pdfDoc) {
  try {
    return pdfDoc.getPageCount();
  } catch (_) {
    return -1;
  }
}

function trailerEncryptPresent(pdfDoc) {
  try {
    const ctx = pdfDoc && pdfDoc.context;
    const enc = ctx && ctx.trailerInfo ? ctx.trailerInfo.Encrypt : null;
    if (!enc) return false;
    try {
      return Boolean(ctx.lookup(enc));
    } catch (_) {
      return true;
    }
  } catch (_) {
    return false;
  }
}

async function probePdfProtection(bytes, logger) {
  const { PDFDocument } = getPdfLib();
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  let hasEncryptToken = false;
  try {
    const tail = buf.slice(Math.max(0, buf.length - 65536)).toString('latin1');
    hasEncryptToken = /\/Encrypt\s+\d+\s+\d+\s+R/.test(tail) || /\/Encrypt\s*<</.test(tail);
  } catch (_) {}
  // تلاشِ اول: بارگذاریِ معمولی (بدونِ ignoreEncryption). فایلِ
  // رمزگذاری‌شده، همین‌جا EncryptedPDFError می‌دهد.
  try {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: false, updateMetadata: false });
    const present = trailerEncryptPresent(doc);
    return {
      protected: present,
      reason: present ? 'encrypt-dict' : 'clean',
      pageCount: safeProbePageCount(doc),
      hasEncryptToken,
      loadError: null,
    };
  } catch (err) {
    const errText = String((err && err.message) || err);
    const errName = String((err && err.name) || '');
    if (/encrypt/i.test(errName) || /encrypt/i.test(errText)) {
      // فقط شمارِ صفحه‌ها را هم با چشم‌پوشی از رمز بخوان تا
      // فراخواننده، اطلاعاتِ کامل‌تری داشته باشد (خودِ حفاظت،
      // همین‌جا قطعی است).
      let counted = -1;
      try {
        const docCounted = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
        counted = safeProbePageCount(docCounted);
      } catch (_) {}
      return { protected: true, reason: 'encrypted-error', pageCount: counted, hasEncryptToken, loadError: errText };
    }
    // بارگذاری به دلیلِ دیگری شکست خورد (مثلاً آبجکتِ خراب)؛ با
    // ignoreEncryption دوباره امتحان کن تا ‎/Encrypt از خرابیِ
    // ساختاری، قابلِ تمایز بماند.
    try {
      const doc2 = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
      const present = trailerEncryptPresent(doc2);
      return {
        protected: present,
        reason: present ? 'encrypt-dict' : 'load-failed-other',
        pageCount: safeProbePageCount(doc2),
        hasEncryptToken,
        loadError: errText,
      };
    } catch (err2) {
      logSaveDiag(logger, 'warn', 'pdf-probe: load failed even with ignoreEncryption', String((err2 && err2.message) || err2));
      return { protected: hasEncryptToken, reason: 'unparseable', pageCount: -1, hasEncryptToken, loadError: errText };
    }
  }
}

async function extractPdfTextSample(pdfjsModule, bytes, logger) {
  // متنِ صفحهٔ اول و صفحهٔ میانی؛ خروجی، رشتهٔ نرمال‌شده.
  // اگر pdf.js نتواند سند را باز کند (رمزِ واقعی، خرابیِ ساختاری)،
  // خطا پرتاب می‌شود تا گیتِ متنی، کپی را رد کند — نه اینکه با
  // «skipped-unavailable» قبول شود. فقط نبودِ خودِ ماژولِ pdf.js
  // (خطای import در بیرونِ این تابع) باعثِ رد شدنِ گیت می‌شود.
  try {
    const doc = await pdfjsModule.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
    try {
      const total = doc.numPages || 0;
      if (total <= 0) return '';
      const wanted = [1];
      if (total > 2) wanted.push(Math.floor(total / 2) + 1);
      const parts = [];
      for (const pno of wanted) {
        try {
          const page = await doc.getPage(pno);
          const tc = await page.getTextContent();
          const items = (tc && tc.items) || [];
          parts.push(items.map((it) => (it && it.str) || '').join(' '));
        } catch (_) {}
      }
      return parts.join(' ');
    } finally {
      if (doc && typeof doc.destroy === 'function') {
        try { await doc.destroy(); } catch (_) {}
      }
    }
  } catch (err) {
    logSaveDiag(logger, 'warn', 'pdf-copy: pdf.js text extraction failed', String((err && err.message) || err));
    throw err;
  }
}

function normalizePdfTextSample(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function loosePdfTextSample(text) {
  try {
    return String(text || '').replace(/[^\p{L}\p{N}]+/gu, '');
  } catch (_) {
    return String(text || '').replace(/[^A-Za-z0-9\u0600-\u06FF]+/g, '');
  }
}

async function createUnlockedPdfCopy({ bytes, logger }) {
  const { PDFDocument, PDFName } = getPdfLib();
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (buf.length < 8 || buf.slice(0, 5).toString('latin1') !== '%PDF-') {
    return { success: false, error: 'بایت‌های ورودی، یک فایلِ PDF معتبر نیستند.' };
  }
  const probe = await probePdfProtection(buf, logger);
  if (!probe.protected) {
    return { success: true, alreadyUnlocked: true, pageCount: probe.pageCount, textGate: 'not-needed' };
  }
  const expectedPageCount = probe.pageCount;

  // بارگذاری با رصدِ هشدار؛ اگر آبجکتِ خراب بود، ترمیمِ هم‌طولِ
  // مرحلهٔ ۷ ـ نهایی را هم امتحان کن (فقط وقتی ترمیم، بارگذاریِ
  // تمیز بدهد، مبنا عوض می‌شود).
  let load = await loadPdfDocumentWithWarnings(buf);
  let baseBytes = buf;
  let healed = false;
  if ((!load.pdfDoc || load.invalidObjects.length > 0) && load.invalidObjects.length > 0) {
    try {
      const healedBuf = healUnparseableIndirectObjectsInBuffer(buf, load.invalidObjects);
      if (healedBuf) {
        const recheck = await loadPdfDocumentWithWarnings(healedBuf);
        if (recheck.pdfDoc && !recheck.loadError && recheck.invalidObjects.length === 0 && recheck.pageCount > 0) {
          load = recheck;
          baseBytes = healedBuf;
          healed = true;
        }
      }
    } catch (_) {}
  }
  if (!load.pdfDoc) {
    return { success: false, error: 'بازسازیِ نسخهٔ بدونِ قفل انجام نشد؛ فایل، حتی با چشم‌پوشی از رمز هم بارگذاری نمی‌شود.' };
  }
  const doc = load.pdfDoc;
  // اگر بایت‌های پایه هنوز آبجکتِ غیرقابل‌پارس دارند، مدلِ
  // پارس‌شده قابلِ اعتماد نیست و ترکیبِ «خرابیِ ساختاری + رمز»،
  // با پیامِ صریح رد می‌شود.
  if (load.invalidObjects.length > 0) {
    return { success: false, error: 'فایل، هم خرابیِ ساختاری دارد و هم محافظت‌شده است؛ ساختِ نسخهٔ بدونِ قفلِ امن ممکن نیست.' };
  }
  // رمزگشایی با رمزِ خالی، پیش از حذفِ ‎/Encrypt: اگر محتوا واقعاً
  // رمز شده باشد، آبجکت‌ها همین‌جا به بایت‌های خوانا برمی‌گردند؛
  // اگر رمزِ عبورِ واقعی لازم باشد یا نسخهٔ رمز پشتیبانی نشود،
  // با پیامِ صریح رد می‌شود و هیچ‌چیز نوشته نمی‌شود.
  try {
    decryptEncryptedDocument(doc, logger);
  } catch (err) {
    if (err && err.code === 'PDF_COPY_PASSWORD_REQUIRED') {
      return { success: false, error: String(err.message) };
    }
    if (err && err.code === 'PDF_COPY_UNSUPPORTED_ENCRYPTION') {
      return { success: false, error: String(err.message) };
    }
    return { success: false, error: 'رمزگشاییِ فایل انجام نشد: ' + String((err && err.message) || err) };
  }
  if (!trailerEncryptPresent(doc)) {
    // کاوش، /Encrypt دیده بود ولی سندِ بارگذاری‌شده آن را ندارد
    // (ارجاعِ معلق)؛ فایل، عملاً قفل نیست.
    return { success: true, alreadyUnlocked: true, pageCount: safeProbePageCount(doc), textGate: 'not-needed' };
  }
  // حذفِ واقعیِ قفل: writerِ pdf-lib، تریلر را از trailerInfo
  // می‌سازد (PDFWriter.createTrailerDict)؛ پس حذف از trailerInfo،
  // برای حذف از خروجی کافی است. حذف از دیکشنریِ trailer هم،
  // دفاعِ دوم است (با محافظ، چون در همهٔ نسخه‌ها همان شکل نیست).
  try {
    if (doc.context.trailerInfo) delete doc.context.trailerInfo.Encrypt;
  } catch (_) {}
  try {
    const trailer = doc.context.trailer;
    if (trailer && typeof trailer.delete === 'function') trailer.delete(PDFName.of('Encrypt'));
  } catch (_) {}

  let outBytes;
  try {
    outBytes = await doc.save({ useObjectStreams: false });
  } catch (err) {
    return { success: false, error: 'ذخیرهٔ نسخهٔ بدونِ قفل انجام نشد: ' + String((err && err.message) || err) };
  }
  const outBuf = Buffer.from(outBytes);

  // اعتبارسنجیِ ساختاری: بارگذاریِ دوباره، شمارِ صفحه‌ها + نبودِ
  // /Encrypt + صفر آبجکتِ نامعتبر.
  const check = await loadPdfDocumentWithWarnings(outBuf);
  if (check.loadError || !check.pdfDoc) {
    return { success: false, error: 'نسخهٔ ساخته‌شده، دوباره بارگذاری نشد و رد شد؛ فایلِ اصلی دست نخورده است.' };
  }
  const checkCount = safeProbePageCount(check.pdfDoc);
  if (expectedPageCount > 0 && checkCount !== expectedPageCount) {
    return { success: false, error: 'شمارِ صفحه‌های نسخهٔ ساخته‌شده (' + checkCount + ') با فایلِ اصلی (' + expectedPageCount + ') برابر نیست؛ کپی رد شد.' };
  }
  if (trailerEncryptPresent(check.pdfDoc)) {
    return { success: false, error: 'حذفِ قفلِ /Encrypt از خروجی انجام نشد؛ کپی رد شد.' };
  }
  if (check.invalidObjects.length > 0) {
    return { success: false, error: 'نسخهٔ ساخته‌شده، آبجکتِ غیرقابل‌پارس دارد؛ کپی رد شد.' };
  }

  // گیتِ متنیِ pdf.js: اگر متنِ اصلی (رمزگشایی‌شده با رمزِ خالی)
  // با متنِ کپی نخواند، یعنی محتوای استریم‌ها واقعاً رمز شده و
  // کپی، فقط بایت‌های رمز را بدونِ /Encrypt دارد → رد.
  let textGate = 'skipped-unavailable';
  try {
    const pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
    let origText;
    try {
      origText = await extractPdfTextSample(pdfjsModule, baseBytes, logger);
    } catch (err) {
      // pdf.js نمی‌تواند فایلِ اصلی را با رمزِ خالی باز کند → کپی،
      // قابل‌اعتماد نیست؛ رد می‌شود (نه skip).
      return { success: false, error: 'فایلِ اصلی با رمزِ خالی قابل‌بازشدن نیست؛ نسخهٔ کپی رد شد و فایلِ اصلی دست نخورده است.' };
    }
    let copyText;
    try {
      copyText = await extractPdfTextSample(pdfjsModule, outBuf, logger);
    } catch (err) {
      return { success: false, error: 'نسخهٔ ساخته‌شده با pdf.js قابل‌بازشدن نیست؛ کپی رد شد و فایلِ اصلی دست نخورده است.' };
    }
    const origNorm = normalizePdfTextSample(origText);
    const copyNorm = normalizePdfTextSample(copyText);
    if (origNorm.length === 0 && copyNorm.length === 0) {
      textGate = 'skipped-no-text';
    } else if (origNorm.length > 0 && origNorm.length < 20) {
      textGate = 'skipped-short-text';
    } else if (origNorm === copyNorm || loosePdfTextSample(origNorm) === loosePdfTextSample(copyNorm)) {
      textGate = 'passed';
    } else {
      return { success: false, error: 'نسخهٔ ساخته‌شده، محتوای قابل‌خواندنِ فایلِ اصلی را ندارد (محتوای فایل، با رمزِ واقعی رمزگذاری شده است)؛ کپی رد شد و فایلِ اصلی دست نخورده است.' };
    }
  } catch (err) {
    textGate = 'skipped-unavailable';
    logSaveDiag(logger, 'warn', 'pdf-copy: text gate skipped (pdf.js import failed)', String((err && err.message) || err));
  }

  return {
    success: true,
    alreadyUnlocked: false,
    bytes: outBuf,
    pageCount: checkCount,
    healed,
    textGate,
  };
}

module.exports = { saveAnnotatedPdf, origBackupPathFor, healUnparseableIndirectObjectsInBuffer, parseInvalidObjectWarnings, validateSavedPdfBytes, saveByIncrementalUpdate, validateIncrementalBytes, probePdfProtection, createUnlockedPdfCopy };
