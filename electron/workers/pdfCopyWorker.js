// مرحله ۸ ـ اصلاحِ نهایی: ورکرِ پروب/کپیِ PDFهای محافظت‌شده.
//
// چرا ورکر؟ پروب و ساختِ کپی روی فایلِ ۶۸ مگابایتی، چند پارسِ
// کاملِ pdf-lib + رمزگشایی + سریال‌سازیِ کامل + دو استخراجِ متنِ
// pdf.js را پشتِ سرِ هم در پروسهٔ اصلی انجام می‌دادند و حلقهٔ
// رویدادِ Electron را برای ده‌ها ثانیه قفل می‌کردند (هنگِ ظاهریِ
// برنامه روی CPUهای قدیمی). این ورکر، همان منطقِ saver را در یک
// worker_thread جدا اجرا می‌کند؛ پروسهٔ اصلی، فقط پیشرفت را به
// رندرر می‌رساند و نامِ نهایی را تغییر می‌دهد.
//
// قراردادِ پیام‌ها (از والد):
//   { type: 'probe', filePath }
//   { type: 'copy', filePath, tempPath, password }
//   { type: 'prepare', filePath, password, cacheDir }
// پیام‌های خروجی:
//   { type: 'progress', stage, fraction, label }
//   { type: 'log', level, message, detail }
//   { type: 'done', result }   — result همان خروجیِ saver است؛ در
//                               حالتِ کپیِ موفق، بایت‌ها در tempPath
//                               نوشته شده‌اند و result.tempPath دارد.
//   { type: 'error', message }
//
// این ورکر، هرگز electron را require نمی‌کند (مثلِ fileExtractor.js).
// لاگرِ دیسک، مستقیم در ورکر ساخته نمی‌شود تا حالتِ Portable و
// COMIC_READER_DATA_DIR، فقط در پروسهٔ اصلی حل شوند؛ خط‌های لاگ،
// به والد فرستاده می‌شوند و والد با getIpcLogger می‌نویسد. saver،
// فقط به شیئی با متدهای info/warn/error نیاز دارد.
'use strict';

const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

let saver = null;
try {
  saver = require('../services/pdfAnnotationSaver');
} catch (err) {
  if (parentPort) {
    parentPort.postMessage({ type: 'error', message: 'ماژولِ خروجیِ PDF (pdfAnnotationSaver.js) پیدا نشد: ' + String((err && err.message) || err) });
  }
}

function postProgress(stage, fraction, label) {
  try {
    if (parentPort) parentPort.postMessage({ type: 'progress', stage, fraction, label: String(label || '') });
  } catch (_) {}
}

function makeLogger() {
  const send = (level, message, detail) => {
    try {
      if (parentPort) {
        parentPort.postMessage({
          type: 'log',
          level,
          message: String(message),
          detail: detail === undefined || detail === null ? '' : String(detail && detail.stack ? detail.stack : detail),
        });
      }
    } catch (_) {}
  };
  return {
    info(message, detail) { send('info', message, detail); },
    warn(message, detail) { send('warn', message, detail); },
    error(message, detail) { send('error', message, detail); },
  };
}

// مرحله ۸ ـ اصلاحِ نهاییِ تأییدشده: پروبِ مسیریِ فوق‌سریع —
// فقط دمِ فایل خوانده می‌شود (۳۲ کیلوبایت)، نه کلِ فایل؛ پس
// پروبِ فایلِ ۶۸ مگابایتی هم چند میلی‌ثانیه است و هیچ PDFDocument
// .loadای در کار نیست (مگر وقتی دمِ فایل خوانا نباشد).
async function handleProbe(filePath) {
  const result = await saver.probePdfProtectionForPath(filePath, makeLogger(), (fraction, label) => {
    postProgress('probe', fraction, label);
  });
  // مرحله ۱۰: پروبِ سریعِ نتیجه‌بخش، جزئیاتِ رمزگذاری را ندارد؛
  // برای فایلِ قفل‌دار، توصیفِ رمزگذاری هم ضمیمه می‌شود تا TopBar
  // بداند کپیِ بی‌اتلاف ممکن است یا باید «بازسازی از pdf.js»
  // پیشنهاد شود. این، فقط روی کلیکِ استودیو اجرا می‌شود.
  let encryption = result && result.encryption ? result.encryption : null;
  let rebuildRecommended = Boolean(result && result.rebuildRecommended);
  if (result && result.protected && !encryption && saver.describePdfEncryptionForPath) {
    try {
      encryption = await saver.describePdfEncryptionForPath(filePath, makeLogger());
      rebuildRecommended = Boolean(encryption && encryption.rebuildRecommended);
    } catch (_) { /* توصیف انجام نشد؛ پروبِ پایه، معتبر می‌ماند */ }
  }
  postProgress('probe-done', 1, 'بررسیِ محافظت انجام شد.');
  let qpdfAvailable = false;
  try {
    if (saver.isQpdfAvailable) qpdfAvailable = Boolean(await saver.isQpdfAvailable());
  } catch (_) { qpdfAvailable = false; }
  return {
    protected: Boolean(result && result.protected),
    qpdfAvailable,
    readOnly: Boolean(result && result.readOnly),
    reason: (result && result.reason) || 'unknown',
    pageCount: (result && result.pageCount) || -1,
    hasEncryptToken: Boolean(result && result.hasEncryptToken),
    fast: Boolean(result && result.fast),
    invalidObjects: Array.isArray(result && result.invalidObjects) ? result.invalidObjects.length : 0,
    warningsCount: (result && result.warningsCount) || 0,
    encryption: encryption || undefined,
    rebuildRecommended,
  };
}

// مرحله ۱۱: دو آستانهٔ جدا — مسیرِ سنگینِ pdf-lib فقط تا ۱۵
// مگابایت (پرامپتِ مرحلهٔ ۸)؛ مسیرِ qpdf (چند ده میلی‌ثانیه،
// حافظهٔ خطی) تا ۲۰۰ مگابایت. فایلِ بزرگ‌تر از ۲۰۰ مگابایت،
// مستقیم کپیِ باینری می‌شود.
const COPY_DECRYPT_MAX_BYTES = 15 * 1024 * 1024;
const COPY_QPDF_MAX_BYTES = 200 * 1024 * 1024;

async function handleCopy(filePath, tempPath, password) {
  // مرحله ۸ ـ اصلاحِ نهاییِ تأییدشده: تصمیمِ مسیر، پیش از هر
  // پارسِ سنگینی، با پروبِ سریع + اندازه گرفته می‌شود:
  //   • نه قفل، نه فقط‌خواندنی → alreadyUnlocked (بدونِ خواندنِ فایل).
  //   • قفل‌دار و ≤۱۵ مگابایت → مسیرِ رمزگشایی؛ اگر رمزگشایی
  //     ذاتاً ممکن نبود (ObjStm/AES-256/رمزِ واقعی) → کپیِ باینری.
  //   • بقیه (بزرگ، یا فقط‌خواندنیِ بدونِ قفل) → کپیِ باینریِ
  //     فوری با copyFile. کپیِ باینری، «باز کردنِ قفل» نیست —
  //     بایت‌به‌بایت همان فایل است؛ ذخیره روی آن، در
  //     saveAnnotatedPdf با «رمزگشایی-اول» انجام می‌شود (به گزارش
  //     مراجعه کنید) و فقط برای فایل‌های ذاتاً رمزگشایی‌ناپذیر،
  //     با پیامِ راهنما رد می‌شود.
  const stat = await fs.promises.stat(filePath);
  const size = stat.size;
  const probe = await saver.probePdfProtectionForPath(filePath, makeLogger(), (fraction, label) => {
    postProgress('copy-probe', fraction * 0.05, label);
  });
  postProgress('copy-probe', 0.05, 'بررسیِ محافظت انجام شد.');
  if (!probe.protected && !probe.readOnly) {
    return { success: true, alreadyUnlocked: true, pageCount: probe.pageCount, textGate: 'not-needed' };
  }
  if (probe.protected && size <= COPY_QPDF_MAX_BYTES) {
    const bytes = await fs.promises.readFile(filePath);
    postProgress('copy-read', 0.08, 'در حالِ خواندنِ فایل…');
    const result = await saver.createUnlockedPdfCopy({
      bytes,
      logger: makeLogger(),
      password: typeof password === 'string' ? password : '',
      // مرحله ۱۱: پروبِ سریع، صفحه‌شمار را می‌داند؛ از پارسِ کاملِ
      // دوباره در createUnlockedPdfCopy جلوگیری می‌شود. مسیرِ
      // سنگینِ pdf-lib فقط برای فایل‌های ≤۱۵ مگابایت مجاز است؛
      // بزرگ‌ترها فقط با qpdf باز می‌شوند و در صورتِ شکست، کدِ
      // خطا برمی‌گردد تا TopBar بازسازی را پیشنهاد دهد.
      probeHint: { protected: true, pageCount: probe.pageCount, invalidObjects: [] },
      allowHeavyFallback: size <= COPY_DECRYPT_MAX_BYTES,
      onProgress: (fraction, label) => { postProgress('copy', 0.08 + fraction * 0.85, label); },
    });
    if (result && result.success) {
      const done = await writeCopyTemp(result, tempPath);
      if (done && done.tempPath) postProgress('copy-done', 1, 'نسخهٔ کپی آماده است.');
      if (done) return done;
      return result;
    }
    if (result && (result.code === 'PDF_COPY_PASSWORD_REQUIRED' || result.code === 'PDF_COPY_UNSUPPORTED_ENCRYPTION')) {
      // مرحله ۱۱: شکستِ رمزگشایی، دیگر به کپیِ باینریِ خاموش
      // نمی‌افتد؛ کد برمی‌گردد تا TopBar، بازسازیِ از pdf.js یا
      // درخواستِ رمز را به کاربر پیشنهاد دهد. کپیِ باینری فقط
      // برای فایلِ فقط‌خواندنیِ بدونِ قفل یا فایلِ >۲۰۰ مگابایت
      // است (مسیرِ پایینِ تابع).
      return {
        success: false,
        code: result.code,
        error: result.error || 'ساختِ نسخهٔ کپیِ قابل‌ویرایش انجام نشد.',
        pageCount: probe.pageCount,
      };
    }
    return result || { success: false, error: 'ساختِ نسخهٔ کپی انجام نشد.' };
  }
  // مسیرِ کپیِ باینری: ناهمگام، بدونِ پارس، بدونِ هنگ.
  postProgress('copy-binary', 0.1, 'در حالِ ساختِ کپیِ باینری…');
  await fs.promises.copyFile(filePath, tempPath);
  const tempStat = await fs.promises.stat(tempPath);
  if (tempStat.size !== size) {
    throw new Error('کپیِ باینری ناقص نوشته شد (' + tempStat.size + ' از ' + size + ' بایت).');
  }
  postProgress('copy-binary', 1, 'نسخهٔ کپی آماده است.');
  return {
    success: true,
    alreadyUnlocked: false,
    binaryCopy: true,
    stillEncrypted: Boolean(probe.protected),
    readOnlyCopy: Boolean(probe.readOnly),
    pageCount: -1,
    textGate: 'skipped-binary-copy',
    tempPath,
  };
}

// مرحله ۹ — لایهٔ ۱ در ورکر: آماده‌سازیِ خواندنِ فایلِ محافظت‌شده
// (رمزِ صوری → رمزگشایی با رمزِ نشست → نیازِ رمز)، با همان
// راستی‌آزماییِ saver. خروجی، مسیرِ فایلِ کش است؛ بایت‌ها هرگز از
// ورکر به پروسهٔ اصلی برنمی‌گردند.
async function handlePrepare(filePath, password, cacheDir) {
  const result = await saver.prepareProtectedPdfForReading({
    filePath,
    password: typeof password === 'string' ? password : '',
    cacheDir: typeof cacheDir === 'string' ? cacheDir : '',
    logger: makeLogger(),
    onProgress: (fraction, label) => { postProgress('prepare', fraction, label); },
  });
  postProgress('prepare-done', 1, 'آماده‌سازی انجام شد.');
  return {
    status: result.status,
    path: result.path || null,
    pageCount: typeof result.pageCount === 'number' ? result.pageCount : -1,
    reason: result.reason || null,
  };
}

async function writeCopyTemp(result, tempPath) {
  if (result.alreadyUnlocked || !result.bytes) {
    // فایل، قفلِ فعالی ندارد: چیزی نوشته نمی‌شود؛ والد، همین
    // نتیجه را به رندرر برمی‌گرداند (بدونِ Buffer.from(undefined)).
    return { success: true, alreadyUnlocked: true, pageCount: result.pageCount, textGate: 'not-needed' };
  }
  // بایت‌های کپی، در فایلِ موقتِ همان پوشه نوشته می‌شوند تا والد،
  // فقط با renameِ اتمی (با retry برای قفلِ ویندوز) نامِ نهایی را
  // بدهد؛ خودِ ورکر، نامِ نهایی را لمس نمی‌کند.
  await fs.promises.writeFile(tempPath, Buffer.from(result.bytes));
  return {
    success: true,
    alreadyUnlocked: false,
    binaryCopy: false,
    pageCount: result.pageCount,
    textGate: result.textGate,
    unlockedBy: result.unlockedBy || undefined,
    healed: Boolean(result.healed),
    baselineInvalidObjects: result.baselineInvalidObjects || 0,
    outputInvalidObjects: result.outputInvalidObjects || 0,
    tempPath,
  };
}

if (parentPort && saver) {
  parentPort.on('message', async (msg) => {
    try {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'probe') {
        const result = await handleProbe(msg.filePath);
        parentPort.postMessage({ type: 'done', result });
      } else if (msg.type === 'prepare') {
        const result = await handlePrepare(msg.filePath, msg.password, msg.cacheDir);
        parentPort.postMessage({ type: 'done', result });
      } else if (msg.type === 'copy') {
        if (!msg.tempPath || typeof msg.tempPath !== 'string') {
          parentPort.postMessage({ type: 'error', message: 'مسیرِ فایلِ موقتِ کپی مشخص نشده است.' });
          return;
        }
        const result = await handleCopy(msg.filePath, msg.tempPath, msg.password);
        parentPort.postMessage({ type: 'done', result: result || { success: false, error: 'ساختِ نسخهٔ کپی انجام نشد.' } });
      }
    } catch (err) {
      try {
        parentPort.postMessage({ type: 'error', message: String((err && err.message) || err) });
      } catch (_) {}
    }
  });
}
