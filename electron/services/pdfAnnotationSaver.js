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

/**
 * بایت‌های پایهٔ PDF را برای ساختِ خروجی برمی‌گرداند.
 * @returns {{baseBytes: Buffer, origBackupPath: string, usedOrigBackup: boolean, origCreated: boolean}}
 * @throws اگر در حالتِ in-place، نگه‌داشتنِ نسخهٔ خام ممکن نشد یا
 *   `.orig.bak`ی موجود، PDFِ معتبر نیست (در این حالت، اصلاً روی فایلِ
 *   اصلی نوشته نمی‌شود تا پایهٔ تمیز، بی‌صدا از دست نرود).
 */
function resolveBasePdfBytes(pdfPath, mode) {
  const origPath = origBackupPathFor(pdfPath);
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
      return { baseBytes: origBytes, origBackupPath: origPath, usedOrigBackup: true, origCreated: false };
    }
    if (mode === 'in-place') {
      throw new Error('فایلِ پشتیبانِ پایهٔ خام (.orig.bak) خراب است؛ ذخیرهٔ درجا انجام نشد تا فایلِ اصلی آسیب نبیند. آن فایل را حذف کنید و دوباره تلاش کنید.');
    }
    // Save As: پایهٔ خراب را نادیده بگیر و از فایلِ فعلی استفاده کن.
    return { baseBytes: readCurrentBytes(), origBackupPath: origPath, usedOrigBackup: false, origCreated: false };
  }
  if (mode === 'in-place') {
    // فقط اگر وجود ندارد بساز؛ COPYFILE_EXCL جلوی بازنویسیِ مسابقه‌ای
    // (دو ذخیرهٔ هم‌زمان) را می‌گیرد.
    try {
      fs.copyFileSync(pdfPath, origPath, fs.constants.COPYFILE_EXCL);
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        const racedBytes = fs.readFileSync(origPath);
        if (isPdfMagic(racedBytes)) {
          return { baseBytes: racedBytes, origBackupPath: origPath, usedOrigBackup: true, origCreated: false };
        }
        throw new Error('فایلِ پشتیبانِ پایهٔ خام (.orig.bak) خراب است؛ ذخیرهٔ درجا انجام نشد.');
      }
      throw new Error('نگه‌داشتنِ نسخهٔ خامِ اولیهٔ فایل (.orig.bak) انجام نشد؛ ذخیرهٔ درجا لغو شد تا پایهٔ تمیز از دست نرود.');
    }
    return { baseBytes: readCurrentBytes(), origBackupPath: origPath, usedOrigBackup: false, origCreated: true };
  }
  return { baseBytes: readCurrentBytes(), origBackupPath: origPath, usedOrigBackup: false, origCreated: false };
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

function addInkAnnotation(pdfDoc, page, item) {
  const strokes = (item.strokes || []).filter((s) => Array.isArray(s) && s.length > 0 && s.every(isFinitePoint));
  if (strokes.length === 0) return false;
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
  const opacity = clampOpacity(item.opacity, item.kind === 'ink' ? 0.92 : 0.9);
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
  const ref = ctx.register(annot);
  page.node.addAnnot(ref);
  return true;
}

function addLineAnnotation(pdfDoc, page, item) {
  const { x1, y1, x2, y2 } = item;
  if (![x1, y1, x2, y2].every(Number.isFinite)) return false;
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
  const ref = ctx.register(annot);
  page.node.addAnnot(ref);
  return true;
}

function addSquareAnnotation(pdfDoc, page, item) {
  const rect = item.rect;
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) return false;
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
  const ref = ctx.register(annot);
  page.node.addAnnot(ref);
  return true;
}

function addCircleAnnotation(pdfDoc, page, item) {
  const rect = item.rect;
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) return false;
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
  const ref = ctx.register(annot);
  page.node.addAnnot(ref);
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
 * بازیابیِ درختِ صفحات وقتی `getPageCount()` خطا می‌دهد یا صفر
 * برمی‌گرداند (کاتالوگِ خراب): اول، درختِ `/Pages`ِ موجودِ سالمی
 * که در خودِ سند هست پیدا و به کاتالوگ وصل می‌شود؛ اگر نبود،
 * درختِ تازهٔ مسطحی از همهٔ برگ‌های `/Page`ِ یافت‌شده در سند
 * ساخته می‌شود (مرتب‌شده بر اساسِ شمارهٔ آبجکت). false یعنی
 * هیچ صفحهٔ قابلِ بازیابی‌ای در سند نیست.
 */
function recoverPdfPageTree(pdfDoc) {
  try {
    const { PDFDict, PDFStream, PDFArray, PDFName, PDFNumber, PDFPageTree, PDFRef } = getPdfLib();
    const context = pdfDoc.context;
    const catalog = pdfDoc.catalog;
    if (!catalog || typeof catalog.get !== 'function') return false;
    const leaves = [];
    for (const [ref, obj] of context.indirectObjects) {
      if (isPlainPdfDict(obj, PDFDict, PDFStream) && pdfDictTypeName(context, obj) === 'Page') {
        leaves.push({ ref, obj });
      }
    }
    if (leaves.length === 0) return false;
    leaves.sort((a, b) => a.ref.objectNumber - b.ref.objectNumber);
    const leafRefs = leaves.map((entry) => entry.ref);
    const isUsableKid = (rawKid) => {
      if (!(rawKid instanceof PDFRef)) return false;
      const kid = resolvePdfObjectUntyped(context, rawKid);
      if (!kid) return false;
      const kind = pdfDictTypeName(context, kid);
      return kind === 'Page' || kind === 'Pages';
    };
    let treeRef = null;
    let treeObj = null;
    for (const [ref, obj] of context.indirectObjects) {
      if (!(obj instanceof PDFPageTree)) continue;
      const kids = resolvePdfObjectUntyped(context, obj.get(PDFName.of('Kids')));
      if (kids instanceof PDFArray && kids.size() > 0) {
        let usable = true;
        for (let i = 0; i < kids.size(); i++) {
          if (!isUsableKid(kids.get(i))) {
            usable = false;
            break;
          }
        }
        if (usable) {
          treeRef = ref;
          treeObj = obj;
          break;
        }
      }
    }
    if (!treeObj) {
      treeObj = PDFPageTree.withContext(context);
      treeObj.set(PDFName.of('Kids'), context.obj(leafRefs));
      treeObj.set(PDFName.of('Count'), PDFNumber.of(leaves.length));
      treeRef = context.register(treeObj);
      for (const { obj } of leaves) obj.set(PDFName.of('Parent'), treeRef);
    } else {
      const kids = resolvePdfObjectUntyped(context, treeObj.get(PDFName.of('Kids')));
      let broken = !(kids instanceof PDFArray) || kids.size() === 0;
      if (!broken) {
        for (let i = 0; i < kids.size(); i++) {
          if (!isUsableKid(kids.get(i))) {
            broken = true;
            break;
          }
        }
      }
      if (broken) {
        treeObj.set(PDFName.of('Kids'), context.obj(leafRefs));
        treeObj.set(PDFName.of('Count'), PDFNumber.of(leaves.length));
        for (const { obj } of leaves) obj.set(PDFName.of('Parent'), treeRef);
      }
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
async function saveAnnotatedPdf({ pdfPath, pages, outputPath, mode }) {
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
    let base;
    try {
      base = resolveBasePdfBytes(pdfPath, effectiveMode);
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
        restoredClean: true,
        mode: effectiveMode,
      };
    }

    const { PDFDocument } = getPdfLib();
    // مرحله ۷ ـ بخش الف: updateMetadata:false تا save() دیکشنریِ Info
    // را بازنویسی نکند (یک سطحِ جست‌وجویِ نوع‌دارِ اضافی، حذف می‌شود
    // و متادیتایِ اصلیِ فایل، دست‌نخورده می‌ماند).
    const pdfDoc = await PDFDocument.load(base.baseBytes, { ignoreEncryption: true, updateMetadata: false });
    // مرحله ۷ ـ بخش الف: اگر پیمایشِ درختِ صفحات خطا داد یا صفر
    // صفحه برگرداند، درخت را بازیابی کن و دوباره بشمار؛ اگر هنوز
    // صفحه‌ای نیست، فایلِ اصلی دست‌نخورده می‌ماند.
    let pageCount = -1;
    let pageTreeRecovered = false;
    try {
      pageCount = pdfDoc.getPageCount();
    } catch (_) {
      pageCount = -1;
    }
    if (pageCount <= 0) {
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
      return { success: false, error: 'ساختارِ درختِ صفحاتِ این فایلِ PDF خراب است و هیچ صفحه‌ای قابلِ بازیابی نیست؛ فایلِ اصلی دست‌نخورده باقی ماند.' };
    }

    let annotatedPages = 0;
    let placed = 0;
    for (const pageNum of pageNumbers) {
      const idx = pageNum - 1;
      if (idx < 0 || idx >= pageCount) continue;
      const entry = pages[pageNum] || {};
      const vector = Array.isArray(entry.vector) ? entry.vector : [];
      const pngBuffer = decodeDataUrlPng(entry.overlayPng);
      if (vector.length === 0 && !pngBuffer) continue;
      const page = pdfDoc.getPage(idx);

      // مرحله ۷ ـ بخش الف: ترمیمِ دیکشنری‌های صفحه پیش از addAnnot/drawImage.
      sanitizePageDictionaries(pdfDoc, page);

      // مرحله ۵ ـ بخش ب: وقتی overlayِ PNGِ کاملِ صفحه هست، دیکشنریِ
      // /Annotِ تکراری روی همان آیتم‌ها ساخته نمی‌شود تا «شبح دوتایی»
      // (شفافیت/خطِ دوبار روی هم) پیش نیاید. بردار فقط وقتی استفاده
      // می‌شود که overlayای برای آن صفحه نباشد (fallback).
      if (!pngBuffer) {
      for (const item of vector) {
        if (!item || typeof item !== 'object') continue;
        let ok = false;
        if (item.kind === 'ink') ok = addInkAnnotation(pdfDoc, page, item);
        else if (item.kind === 'line') ok = addLineAnnotation(pdfDoc, page, item);
        else if (item.kind === 'square') ok = addSquareAnnotation(pdfDoc, page, item);
        else if (item.kind === 'circle') ok = addCircleAnnotation(pdfDoc, page, item);
        if (ok) placed += 1;
      }

      } // پایانِ if (!pngBuffer) — بردار فقط در نبودِ overlay

      if (pngBuffer) {
        const rawW = Number(entry.pageWidth);
        const rawH = Number(entry.pageHeight);
        if (Number.isFinite(rawW) && Number.isFinite(rawH) && rawW > 0 && rawH > 0) {
          const pngImage = await pdfDoc.embedPng(pngBuffer);
          page.drawImage(pngImage, { x: 0, y: 0, width: rawW, height: rawH });
          placed += 1;
        }
      }
      annotatedPages += 1;
    }

    if (annotatedPages === 0) {
      return { success: false, error: 'هیچ صفحهٔ معتبری برای خروجی پیدا نشد.' };
    }

    // مرحله ۷ ـ بخش الف: ذخیرهٔ پیش‌فرض، مثلِ قبل (با Object Streams).
    // اگر همان ذخیره خطا داد (مثلاً به‌خاطرِ آبجکتِ معلقِ دیگری در
    // سند)، یک بارِ دیگر بدونِ Object Streams تلاش می‌شود؛ اگر آن هم
    // خطا داد، خطایِ اول (گویاتر) به catchِ بیرونی می‌رسد و هیچ
    // بایتی روی دیسک نوشته نمی‌شود.
    let outBytes;
    try {
      outBytes = await pdfDoc.save();
    } catch (firstSaveErr) {
      try {
        outBytes = await pdfDoc.save({ useObjectStreams: false, updateMetadata: false });
      } catch (_) {
        throw firstSaveErr;
      }
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
      mode: effectiveMode,
    };
  } catch (err) {
    if (err && err.code === 'FILE_LOCKED') {
      return { success: false, locked: true, error: err.message };
    }
    return { success: false, error: String((err && err.message) || err) };
  }
}

module.exports = { saveAnnotatedPdf, origBackupPathFor };
