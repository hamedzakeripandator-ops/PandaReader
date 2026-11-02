const { ipcMain, dialog, shell, clipboard, nativeImage, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const directoryService = require('./services/directoryService');

// مرحله ۷ ـ بخش الف: لاگرِ دیسک برای خطاهای ورکرِ دیتابیس و
// ذخیرهٔ PDF. تنبل ساخته می‌شود تا متغیرِ محیطیِ
// COMIC_READER_DATA_DIR (که main.js پیش از اسپاونِ ورکر تنظیم
// می‌کند) حتماً خوانده شده باشد. هرگز throw نمی‌کند.
let ipcLoggerCache = null;
function getIpcLogger() {
  if (ipcLoggerCache) return ipcLoggerCache;
  try {
    const { createLogger } = require('./logger');
    ipcLoggerCache = createLogger(process.env.COMIC_READER_DATA_DIR);
  } catch (_) {
    ipcLoggerCache = null;
  }
  return ipcLoggerCache;
}
function getIpcLogger() {
  if (ipcLoggerCache) return ipcLoggerCache;
  try {
    const { createLogger } = require('./logger');
    ipcLoggerCache = createLogger(process.env.COMIC_READER_DATA_DIR);
  } catch (_) {
    ipcLoggerCache = null;
  }
  return ipcLoggerCache;
}

// مرحله ۸ ـ اصلاحِ نهایی: زیرساختِ ورکرِ پروب/کپیِ PDFهای
// محافظت‌شده. پروب و ساختِ کپی، دیگر در پروسهٔ اصلی پارس نمی‌شوند؛
// مرحله ۹: پوشهٔ کشِ فایل‌های آماده‌شده برای خواندن (رمزِ صوریِ
// خنثی‌شده / کپیِ رمزگشایی‌شده). زیرِ همان دایرکتوریِ دادهٔ برنامه
// (Portable: COMIC_READER_DATA_DIR) تا با حالتِ Portable هم‌خوان
// باشد؛ فایل‌ها با کلیدِ هشِ محتوا نام‌گذاری می‌شوند و هرگز روی
// فایلِ اصلی نوشته نمی‌شوند.
function getProtectedCacheDir() {
  try {
    const base = (app && app.comicDataDir) || process.env.COMIC_READER_DATA_DIR || (app && typeof app.getPath === 'function' ? app.getPath('userData') : '');
    return base ? path.join(base, 'protected-cache') : '';
  } catch (_) { return ''; }
}

// ورکرِ جدا (electron/workers/pdfCopyWorker.js) کارِ سنگین را
// انجام می‌دهد و فقط پیشرفت/لاگ/نتیجه را برمی‌گرداند. اگر ساختِ
// ورکر شکست بخورد (مثلاً در حالتِ بسته‌بندی‌شده)، مسیرِ درونِ
// پروسهٔ اصلی با همان saverِ اصلاح‌شده (هشدارها ساکت) به‌عنوانِ
// پشتیبان اجرا می‌شود. لغو، فقط کارهای همان فرستنده را خاتمه
// می‌دهد و فایلِ موقت را پاک می‌کند.
const pdfCopyJobs = new Map();
let pdfCopyJobSeq = 0;

function cleanupPdfCopyTemp(tempPath) {
  if (!tempPath) return;
  try { fs.promises.unlink(tempPath).catch(() => {}); } catch (_) {}
}

async function renamePdfCopyTempWithRetries(tmpPath, targetPath) {
  let lastErr = null;
  const delays = [120, 300, 700, 1200];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      await fs.promises.rename(tmpPath, targetPath);
      return;
    } catch (err) {
      lastErr = err;
      const retryable = err && ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(err.code);
      if (!retryable || attempt === delays.length) break;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  try {
    await fs.promises.copyFile(tmpPath, targetPath);
    await fs.promises.unlink(tmpPath);
    return;
  } catch (copyErr) {
    lastErr = copyErr;
  }
  try { await fs.promises.unlink(tmpPath); } catch (_) {}
  if (lastErr && ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(lastErr.code)) {
    const lockedErr = new Error('فایل در حال استفاده است و نمی‌توان روی آن نوشت. اگر فایل در برنامهٔ دیگری باز است، آن را ببندید و دوباره تلاش کنید.');
    lockedErr.code = 'FILE_LOCKED';
    throw lockedErr;
  }
  throw lastErr || new Error('نوشتنِ فایل انجام نشد.');
}

function runPdfCopyWorker({ kind, filePath, tempPath, sender, timeoutMs, password, cacheDir }) {
  const workerPath = path.join(__dirname, 'workers', 'pdfCopyWorker.js');
  let worker;
  try {
    worker = new Worker(workerPath);
  } catch (err) {
    const spawnErr = new Error('ساختِ ورکرِ کپیِ PDF انجام نشد: ' + String((err && err.message) || err));
    spawnErr.code = 'WORKER_SPAWN_FAILED';
    throw spawnErr;
  }
  const jobId = 'pdfcopy-' + (++pdfCopyJobSeq) + '-' + Date.now().toString(36);
  const job = { worker, sender, tempPath: tempPath || null, settled: false, cancelled: false };
  pdfCopyJobs.set(jobId, job);
  let timer = null;
  const finish = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    pdfCopyJobs.delete(jobId);
    try { worker.terminate(); } catch (_) {}
  };
  return new Promise((resolve, reject) => {
    const settleReject = (err) => {
      if (job.settled) return;
      job.settled = true;
      finish();
      reject(err);
    };
    worker.on('message', (msg) => {
      try {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'progress') {
          if (sender && typeof sender.isDestroyed === 'function' && !sender.isDestroyed()) {
            try { sender.send('pdf-copy-progress', { jobId, kind, filePath, stage: msg.stage, fraction: msg.fraction, label: msg.label }); } catch (_) {}
          }
        } else if (msg.type === 'log') {
          try {
            const lg = getIpcLogger();
            if (lg && typeof lg[msg.level] === 'function') lg[msg.level]('[pdf-copy-worker] ' + msg.message, msg.detail || '');
          } catch (_) {}
        } else if (msg.type === 'done') {
          if (job.settled) return;
          job.settled = true;
          finish();
          resolve(msg.result);
        } else if (msg.type === 'error') {
          settleReject(new Error(msg.message || 'ورکرِ کپیِ PDF خطا داد.'));
        }
      } catch (_) {}
    });
    worker.on('error', (err) => {
      settleReject(new Error('ورکرِ کپیِ PDF خطا داد: ' + String((err && err.message) || err)));
    });
    worker.on('exit', (code) => {
      if (job.settled) return;
      if (job.cancelled) {
        const cancelErr = new Error('ساختِ نسخهٔ کپی لغو شد.');
        cancelErr.code = 'PDF_COPY_CANCELLED';
        settleReject(cancelErr);
        return;
      }
      settleReject(new Error('ورکرِ کپیِ PDF بدونِ نتیجه پایان یافت (کدِ خروج: ' + code + ').'));
    });
    if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (job.settled) return;
        job.cancelled = true;
        settleReject(new Error('بررسیِ محافظتِ PDF بیش از حد طول کشید.'));
      }, timeoutMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
    try {
      worker.postMessage({ type: kind, filePath, tempPath: tempPath || null, password: typeof password === 'string' ? password : '', cacheDir: typeof cacheDir === 'string' ? cacheDir : '' });
    } catch (err) {
      settleReject(new Error('ارسالِ کار به ورکرِ کپیِ PDF انجام نشد: ' + String((err && err.message) || err)));
    }
    job.cancel = () => {
      if (job.settled) return;
      job.cancelled = true;
      try { worker.terminate(); } catch (_) {}
    };
  });
}

// مرحلهٔ ۳۲ — اجرایِ ذخیرهٔ PDFِ حاشیه‌نویسی‌شده در ورکرِ جدا، نه در
// پروسهٔ اصلی (pdf-lib رویِ فایل‌هایِ بزرگ، حلقهٔ رویداد را قفل می‌کرد
// و «Not Responding» نشان می‌داد). عمداً در نقشهٔ کارهایِ کپی ثبت
// نمی‌شود تا دکمهٔ «لغوِ ساختِ کپی» نتواند آن را بکشد؛ در صورتِ خطایِ
// ساختِ ورکر، خطایِ ورکر یا تایم‌اوت، فراخواننده به اجرایِ مستقیم برمی‌گردد.
function runAnnotatedExportWorker({ pdfPath, pages, outputPath, mode, password, dataDir, sender, timeoutMs }) {
  const workerPath = path.join(__dirname, 'workers', 'pdfCopyWorker.js');
  let worker;
  try {
    worker = new Worker(workerPath);
  } catch (err) {
    const spawnErr = new Error('ورکرِ خروجیِ PDF ساخته نشد: ' + String((err && err.message) || err));
    spawnErr.code = 'WORKER_SPAWN_FAILED';
    throw spawnErr;
  }
  let timer = null;
  let settled = false;
  const finish = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    try { worker.terminate(); } catch (_) {}
  };
  return new Promise((resolve, reject) => {
    const settleReject = (err) => {
      if (settled) return;
      settled = true;
      finish();
      reject(err);
    };
    worker.on('message', (msg) => {
      try {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'log') {
          try {
            const lg = getIpcLogger();
            if (lg && typeof lg[msg.level] === 'function') lg[msg.level]('[pdf-copy-worker] ' + msg.message, msg.detail || '');
          } catch (_) {}
        } else if (msg.type === 'done') {
          if (settled) return;
          settled = true;
          finish();
          resolve(msg.result);
        } else if (msg.type === 'error') {
          settleReject(new Error(msg.message || 'ورکرِ خروجیِ PDF خطا داد.'));
        }
      } catch (_) {}
    });
    worker.on('error', (err) => {
      settleReject(new Error('ورکرِ خروجیِ PDF خطا داد: ' + String((err && err.message) || err)));
    });
    worker.on('exit', (code) => {
      if (settled) return;
      settleReject(new Error('ورکرِ خروجیِ PDF بدونِ نتیجه پایان یافت (کدِ خروج: ' + code + ').'));
    });
    if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settleReject(new Error('ساختِ PDFِ حاشیه‌نویسی‌شده در ورکر بیش از حد طول کشید.'));
      }, timeoutMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
    try {
      worker.postMessage({ type: 'export', pdfPath, pages, outputPath, mode, password: typeof password === 'string' ? password : '', dataDir: typeof dataDir === 'string' ? dataDir : '' });
    } catch (err) {
      settleReject(new Error('ارسالِ کار به ورکرِ خروجیِ PDF انجام نشد: ' + String((err && err.message) || err)));
    }
  });
}

function cancelPdfCopyJobsForSender(sender) {
  let count = 0;
  for (const job of pdfCopyJobs.values()) {
    if (job.sender === sender && !job.settled && typeof job.cancel === 'function') {
      job.cancel();
      count++;
    }
  }
  return count;
}

const IMAGE_REGEX = /\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i;

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 MB';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + ['B', 'KB', 'MB', 'GB'][i];
}

// پارسر سریع ابعاد تصویر از هدر ۶۴ کیلوبایتی برای پوشه‌های مستقیم
function parseDimensionsFromHeaderBuffer(buffer) {
  try {
    if (!buffer || buffer.length < 30) return null;
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      if (width > 0 && height > 0) return { width, height };
    }
    if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
      const width = Math.abs(buffer.readInt32LE(18));
      const height = Math.abs(buffer.readInt32LE(22));
      if (width > 0 && height > 0) return { width, height };
    }
    if (
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    ) {
      const chunkHeader = buffer.toString('ascii', 12, 16);
      if (chunkHeader === 'VP8 ' && buffer.length >= 30) {
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        if (width > 0 && height > 0) return { width, height };
      } else if (chunkHeader === 'VP8L' && buffer.length >= 25) {
        const b0 = buffer[21], b1 = buffer[22], b2 = buffer[23], b3 = buffer[24];
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        if (width > 0 && height > 0) return { width, height };
      } else if (chunkHeader === 'VP8X' && buffer.length >= 30) {
        const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
        const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
        if (width > 0 && height > 0) return { width, height };
      }
    }
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      let offset = 2;
      const len = buffer.length;
      while (offset < len - 9) {
        if (buffer[offset] !== 0xFF) { offset++; continue; }
        const marker = buffer[offset + 1];
        if (marker === 0xFF) { offset++; continue; }
        if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
          offset += 2;
          continue;
        }
        if (offset + 3 >= len) break;
        const segmentLength = buffer.readUInt16BE(offset + 2);
        if (segmentLength < 2) break;
        if (
          (marker >= 0xC0 && marker <= 0xC3) ||
          (marker >= 0xC5 && marker <= 0xC7) ||
          (marker >= 0xC9 && marker <= 0xCB) ||
          (marker >= 0xCD && marker <= 0xCF)
        ) {
          if (offset + 8 < len) {
            const height = buffer.readUInt16BE(offset + 5);
            const width = buffer.readUInt16BE(offset + 7);
            if (width > 0 && height > 0) return { width, height };
          }
          break;
        }
        offset += 2 + segmentLength;
      }
    }
  } catch (_) {}
  return null;
}

async function enrichFolderImagesWithDimensions(folderImages) {
  const BATCH = 12;
  for (let i = 0; i < folderImages.length; i += BATCH) {
    const slice = folderImages.slice(i, i + BATCH);
    await Promise.allSettled(
      slice.map(async (item) => {
        const p = item.path || item.filePath;
        if (!p) return;
        let fh;
        try {
          fh = await fs.promises.open(p, 'r');
          const buf = Buffer.allocUnsafe(65536);
          const { bytesRead } = await fh.read(buf, 0, 65536, 0);
          const dims = parseDimensionsFromHeaderBuffer(buf.subarray(0, bytesRead));
          if (dims) {
            item.width = dims.width;
            item.height = dims.height;
            item.aspectRatio = Number((dims.height / dims.width).toFixed(5));
          }
        } catch (_) {
        } finally {
          if (fh) await fh.close().catch(() => {});
        }
      })
    );
  }
  return folderImages;
}

// ============================================================================
// مدیریت تک‌ورکر پایدار دیتابیس (Persistent Singleton DB Worker)
// ============================================================================
let persistentDbWorker = null;
// مرحله ۱ ـ بخش الف: پرچمِ خروجِ پس از فلاش — وقتی before-quitِ اول،
// handshake را کامل کرد و app.quit() را دوباره صدا زد، before-quitِ
// دوم با این پرچم، بدونِ توقف عبور می‌کند (وگرنه حلقه می‌شد).
let quitAfterFlush = false;
// مرحله ۱ ـ بخش ب: محافظِ ورودِ مجددِ Handshake — وقتی true است،
// یک before-quitِ دوم، Handshakeِ تازه شروع نمی‌کند (بخش B-I2).
let flushInProgress = false;
let dbRequestSeq = 0;
const pendingDbCallbacks = new Map();

function ensurePersistentDbWorker() {
  if (persistentDbWorker) return persistentDbWorker;

  const workerPath = path.join(__dirname, 'workers', 'database.js');
  if (!fs.existsSync(workerPath)) return null;

  try {
    // مرحله ۷ ـ بخش الف: env صریحاً منتقل می‌شود تا ورکرِ
    // دیتابیس، COMIC_READER_DATA_DIR (حالتِ Portable) را حتماً
    // ببیند؛ مقدارِ پیش‌فرضِ worker_threads هم همین است، ولی
    // این‌جا صریح و قابلِ اتکاست.
    persistentDbWorker = new Worker(workerPath, { env: { ...process.env } });

    persistentDbWorker.on('message', (result) => {
      const { reqId, ...payloadData } = result || {};
      if (reqId !== undefined && pendingDbCallbacks.has(reqId)) {
        const { resolve, timer } = pendingDbCallbacks.get(reqId);
        if (timer) clearTimeout(timer);
        pendingDbCallbacks.delete(reqId);
        resolve(payloadData);
      }
    });

    persistentDbWorker.on('error', (err) => {
      console.error('Persistent DB Worker error:', err.message);
      try { const lg = getIpcLogger(); if (lg) lg.error('DB worker error', err); } catch (_) { /* ignore */ }
    });

    persistentDbWorker.on('exit', (code) => {
      if (code !== 0) {
        try { const lg = getIpcLogger(); if (lg) lg.error('DB worker exited with code ' + code); } catch (_) { /* ignore */ }
      }
      persistentDbWorker = null;
      for (const [, { resolve, timer }] of pendingDbCallbacks.entries()) {
        if (timer) clearTimeout(timer);
        resolve({ type: code === 0 ? 'success' : 'error', message: `ورکر با کد ${code} خاتمه یافت.` });
      }
      pendingDbCallbacks.clear();
    });

    return persistentDbWorker;
  } catch (e) {
    console.error('Failed to initialize DB worker:', e.message);
    try { const lg = getIpcLogger(); if (lg) lg.error('Failed to initialize DB worker', e); } catch (_) { /* ignore */ }
    return null;
  }
}

// مرحله ۵ ـ بخش الف: همان executeDbAction، ولی با تایم‌اوتِ پارامتری؛
// چون ساختِ پشتیبان (خواندنِ همهٔ کاورها + فشرده‌سازی) و بازیابی
// (اعتبارسنجی + جایگزینی) ذاتاً از ۵ ثانیه طولانی‌ترند و نباید با
// تایم‌اوتِ عملیاتِ عادیِ دیتابیس کشته شوند. قراردادِ ۵ ثانیه‌ایِ
// عملیاتِ عادی دست نخورده است (executeDbAction همان ۵۰۰۰ را می‌دهد).
function executeDbRequest(action, payload, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const worker = ensurePersistentDbWorker();
    if (!worker) {
      resolve({ type: 'error', message: 'فایل ورکر دیتابیس یافت نشد.' });
      return;
    }

    const reqId = ++dbRequestSeq;

    // مرحله ۱ ـ بخش الف: قراردادِ تایم‌اوتِ دیتابیس — main: ۵۰۰۰،
    // رندرر: ۵۵۰۰ میلی‌ثانیه. پس خطای کنترل‌شدهٔ main همیشه زودتر از
    // تایم‌اوتِ رندرر می‌رسد و رندرر، نیم ثانیه زودتر خطای کاذب نشان
    // نمی‌دهد (باگِ قبلی: ۴۰۰۰ در برابرِ ۳۵۰۰).
    const timer = setTimeout(() => {
      if (pendingDbCallbacks.has(reqId)) {
        pendingDbCallbacks.delete(reqId);
        resolve({ type: 'error', message: `مهلت زمانی ورکر دیتابیس به پایان رسید (Timeout ${timeoutMs}ms)` });
      }
    }, timeoutMs);

    pendingDbCallbacks.set(reqId, { resolve, timer });
    worker.postMessage({ reqId, action, payload });
  });
}

function executeDbAction(action, payload) {
  return executeDbRequest(action, payload, 5000);
}

// نوشتنِ اتمیکِ بافر: tmpِ یکتا در همان پوشه + fsync + rename با
// تلاشِ مجددِ ناهمگام (همان الگوی مرحله ۱ ـ بخش ب، برای فایل‌های
// خروجیِ main) — هات‌فیکسِ مرحله ۶: هرگز مقصد را پیش از موفقیتِ
// جایگزینی unlink نمی‌کند و بینِ تلاش‌ها، تردِ اصلی را با حلقهٔ
// مشغول قفل نمی‌کند (دلیلِ «قفلِ محیطِ الکترون» هنگامِ ذخیره).
async function atomicWriteBuffer(targetPath, buffer) {
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
  let lastErr = null;
  const delays = [120, 300, 700, 1200];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      await fs.promises.rename(tmpPath, targetPath);
      return;
    } catch (err) {
      lastErr = err;
      const retryable = err && ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(err.code);
      if (!retryable || attempt === delays.length) break;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  try {
    await fs.promises.copyFile(tmpPath, targetPath);
    await fs.promises.unlink(tmpPath);
    return;
  } catch (copyErr) {
    lastErr = copyErr;
  }
  try { await fs.promises.unlink(tmpPath); } catch (_) {}
  if (lastErr && ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(lastErr.code)) {
    const lockedErr = new Error('فایل در حال استفاده است و نمی‌توان روی آن نوشت. اگر فایل در برنامهٔ دیگری باز است، آن را ببندید و دوباره تلاش کنید.');
    lockedErr.code = 'FILE_LOCKED';
    throw lockedErr;
  }
  throw lastErr || new Error('نوشتنِ فایل انجام نشد.');
}

// خوانش کاملاً غیرهمگام کاور بدون مسدود کردن ترد اصلی الکترون
async function createPermanentCoverDataUrlAsync(imagePath, targetWidth = 340) {
  try {
    if (!imagePath || !fs.existsSync(imagePath)) return null;
    const buffer = await fs.promises.readFile(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.avif': 'image/avif',
      '.bmp': 'image/bmp'
    };
    const mime = mimeTypes[ext] || 'image/jpeg';
    return createCoverFromBuffer(buffer, mime, targetWidth);
  } catch (e) {
    return null;
  }
}

function createCoverFromBuffer(buffer, forcedMime = 'image/jpeg', targetWidth = 340) {
  try {
    if (!buffer || buffer.length === 0) return null;

    const nImg = nativeImage.createFromBuffer(Buffer.from(buffer));
    if (!nImg.isEmpty()) {
      const size = nImg.getSize();
      if (size.width > 0 && size.height > 0) {
        const finalWidth = Math.min(size.width, targetWidth);
        const finalHeight = Math.max(
          1,
          Math.round((size.height / Math.max(1, size.width)) * finalWidth)
        );
        const resized = nImg.resize({
          width: finalWidth,
          height: finalHeight,
          quality: 'better'
        });
        const jpegBuffer = resized.toJPEG(86);
        if (jpegBuffer && jpegBuffer.length > 0) {
          return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
        }
      }
    }

    const rawBase64 = Buffer.from(buffer).toString('base64');
    return `data:${forcedMime};base64,${rawBase64}`;
  } catch (e) {
    return null;
  }
}

// مرحله ۱۱: نامِ دلخواهِ نسخهٔ کپی و ایندکسِ جستجویِ کناری.
// sanitizeCopyFileName: فقط نامِ پایه را می‌پذیرد (بدونِ پوشه)،
// کاراکترهایِ نامعتبرِ ویندوز و کنترلی را حذف می‌کند و پسوندِ
// .pdf را تضمین می‌کند. نامِ خالی → نامِ پیش‌فرضِ خودکار.
function sanitizeCopyFileName(name, fallbackBase) {
  const fallback = String(fallbackBase || 'copy') + '-editable.pdf';
  if (!name || typeof name !== 'string') return fallback;
  let base = path.basename(name.trim());
  base = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim();
  if (!base) return fallback;
  if (path.extname(base).toLowerCase() !== '.pdf') base += '.pdf';
  return base;
}

// resolveCopyOutputPath: مسیرِ نهاییِ کپی از سه منبع (به ترتیبِ
// اولویت): مسیرِ انتخاب‌شده در showSaveDialog، نامِ تایپ‌شده در
// مودال، نامِ خودکارِ <base>-editable.pdf. اگر مسیرِ نهایی از
// قبل وجود داشته باشد، پسوندِ شماره‌دار (-2 … -100) می‌گیرد؛
// اگر هیچ نامی آزاد نباشد، null برمی‌گردد.
function resolveCopyOutputPath(pdfPath, desiredName, desiredPath) {
  const dir = path.dirname(pdfPath);
  const baseName = path.basename(pdfPath, path.extname(pdfPath));
  let candidate = null;
  if (desiredPath && typeof desiredPath === 'string') {
    const p = desiredPath.trim();
    if (path.isAbsolute(p)) {
      let withExt = p;
      if (path.extname(withExt).toLowerCase() !== '.pdf') withExt += '.pdf';
      if (fs.existsSync(path.dirname(withExt))) candidate = withExt;
    }
  }
  if (!candidate) {
    candidate = path.join(dir, sanitizeCopyFileName(desiredName, baseName));
  }
  if (fs.existsSync(candidate)) {
    const cDir = path.dirname(candidate);
    const cBase = path.basename(candidate, '.pdf');
    for (let i = 2; i <= 100; i++) {
      const numbered = path.join(cDir, cBase + '-' + i + '.pdf');
      if (!fs.existsSync(numbered)) return numbered;
    }
    return null;
  }
  return candidate;
}

// مرحله ۱۱: ایندکسِ جستجویِ کناریِ فایل‌هایِ بازسازی‌شده.
// کلید، هشِ مسیرِ مطلقِ خروجی است تا بازسازیِ دوباره، ایندکسِ
// کهنه را بازنویسی کند؛ محتوا، مختصاتِ کلماتِ استخراج‌شده از
// pdf.js در زمانِ پرینت است.
function getSearchIndexDir() {
  const dataDir = (app && app.comicDataDir) || process.env.COMIC_READER_DATA_DIR || '';
  const dir = path.join(dataDir || path.join(require('os').homedir(), '.comic-reader'), 'search-index');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}
function searchIndexPathFor(outputPath) {
  const key = path.resolve(String(outputPath)).toLowerCase();
  const hash = require('crypto').createHash('sha256').update(key, 'utf8').digest('hex');
  return path.join(getSearchIndexDir(), hash + '.json');
}
function writeSearchIndexFile(outputPath, searchIndex) {
  try {
    if (!searchIndex || typeof searchIndex !== 'object') return false;
    if (!searchIndex.pages || typeof searchIndex.pages !== 'object') return false;
    const doc = {
      version: 1,
      sourcePath: String(outputPath),
      pageCount: Number(searchIndex.pageCount) || 0,
      createdAt: Date.now(),
      pages: searchIndex.pages,
    };
    fs.writeFileSync(searchIndexPathFor(outputPath), JSON.stringify(doc), 'utf8');
    return true;
  } catch (_) { return false; }
}

function getWindowFromEvent(event) {
  if (!event || !event.sender || event.sender.isDestroyed()) return null;
  try {
    if (BrowserWindow && typeof BrowserWindow.fromWebContents === 'function') {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) return win;
    }
  } catch (_) {}
  return null;
}

// ============================================================================
// موتور بارگذاری کنترل‌شده در رم بدون اشباع تردپول دیسک
// ============================================================================
let activePreloadSessionId = 0;

async function preloadComicImagesIntoRam(items, appInstance) {
  if (!items || items.length === 0 || typeof appInstance.readComicPageToRam !== 'function') return;

  const sessionId = ++activePreloadSessionId;
  const total = items.length;

  // ۱. بارگذاری فوری ۸ صفحه اول برای نمایش آنی ابتدای کمیک
  const immediateCount = Math.min(total, 8);
  for (let i = 0; i < immediateCount; i += 4) {
    if (sessionId !== activePreloadSessionId) return;
    const batch = items.slice(i, i + 4);
    await Promise.allSettled(
      batch.map((item) => {
        const p = item.path || item.filePath;
        return p ? appInstance.readComicPageToRam(p) : Promise.resolve();
      })
    );
  }

  // ۲. بارگذاری نرم صفحات بعدی در دسته‌های ۳تایی با استراحت دادن به تردپول دیسک
  const BATCH_SIZE = 3;
  for (let i = immediateCount; i < total; i += BATCH_SIZE) {
    if (sessionId !== activePreloadSessionId) break;

    const batch = items.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map((item) => {
        const p = item.path || item.filePath;
        return p ? appInstance.readComicPageToRam(p) : Promise.resolve();
      })
    );

    await new Promise((r) => setTimeout(r, 15));
  }
}

// مرحله ۵ ـ بخش ب: باطل‌کردنِ کشِ رمِ فقط همان مسیر پس از ذخیرهٔ
// درجا. main.js تابعِ دقیقِ invalidateComicRamCache را دارد (حذفِ
// ورودی + کم‌کردنِ شمارندهٔ بایت، با همان گاردِ مرحله ۲ ـ بخش ب)؛
// اگر آن تابع نبود (نسخهٔ قدیمیِ main)، فقط ورودیِ Map حذف می‌شود.
// مرحله ۶ ـ بخش ب: بستنِ استریم‌های خواندنِ فعالِ پروتکل comic://
// روی یک PDF پیش از ذخیرهٔ درجا، تا در ویندوز هیچ هندلِ بازی روی
// فایلِ اصلی نماند. بهترین تلاش است و هرگز خطا پرتاب نمی‌کند؛ اگر
// main.js تابعش را نداشت (نسخهٔ قدیمی)، بی‌اثر است.
function closeComicReadStreams(appInstance, rawPath) {
  try {
    if (!appInstance || !rawPath) return;
    if (typeof appInstance.closeComicReadStreams === 'function') {
      appInstance.closeComicReadStreams(rawPath);
    }
  } catch (_) {}
}

function invalidateComicRamCache(appInstance, rawPath) {
  try {
    if (!appInstance || !rawPath) return;
    if (typeof appInstance.invalidateComicRamCache === 'function') {
      appInstance.invalidateComicRamCache(rawPath);
      return;
    }
    if (appInstance.activeComicRamCache && typeof appInstance.normalizeComicCacheKey === 'function') {
      const key = appInstance.normalizeComicCacheKey(rawPath);
      if (key) appInstance.activeComicRamCache.delete(key);
    }
  } catch (_) {}
}

module.exports = function(app) {
  const tempDir = path.join(app.getPath('temp'), 'ComicReaderCache');

  let activeExtractionContext = null;
  let currentExtractedDir = null;

  ensurePersistentDbWorker();

  const ensureTempDir = () => {
    try {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
    } catch (_) {}
  };

  // پاک‌سازی غیرهمگام کش دیسک برای جلوگیری از فریز شدن ترد اصلی هنگام باز کردن کمیک
  const cleanupExtractedDiskCache = (specificDir = null, syncMode = false) => {
    try {
      activePreloadSessionId++;
      app.emit('comic-cache-clear');

      const target = specificDir || currentExtractedDir;
      const normalizedTemp = path.resolve(tempDir).toLowerCase();

      if (target && target !== '__FORCE_ALL__') {
        if (target === currentExtractedDir) {
          currentExtractedDir = null;
        }
        const normalizedTarget = path.resolve(target).toLowerCase();
        if (normalizedTarget.startsWith(normalizedTemp) && normalizedTarget !== normalizedTemp) {
          if (syncMode) {
            try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) {}
          } else {
            fs.promises.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
          }
        }
      } else if (specificDir === '__FORCE_ALL__' && fs.existsSync(tempDir)) {
        currentExtractedDir = null;
        if (syncMode) {
          const entries = fs.readdirSync(tempDir);
          for (const entry of entries) {
            try { fs.rmSync(path.join(tempDir, entry), { recursive: true, force: true }); } catch (_) {}
          }
        } else {
          fs.promises.readdir(tempDir).then((entries) => {
            for (const entry of entries) {
              fs.promises.rm(path.join(tempDir, entry), { recursive: true, force: true }).catch(() => {});
            }
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('Cache cleanup non-fatal warning:', err.message);
    }
  };

  ensureTempDir();

  // مرحله ۱ ـ بخش الف: Handshakeِ واقعیِ خروج.
  // رفتارِ قبلی، FLUSH_SYNC را می‌فرستاد و بلافاصله terminate می‌کرد،
  // پس ورکر معمولاً پیش از نوشتن می‌مرد و تغییراتِ ۹۰۰ میلی‌ثانیهٔ
  // آخر گم می‌شد. حالا: خروجِ اول با preventDefault متوقف می‌شود،
  // FLUSH_SYNC فرستاده می‌شود و تا رسیدنِ FLUSH_SYNC_ACK یا حداکثر
  // ۲۵۰۰ میلی‌ثانیه صبر می‌شود؛ بعد ورکر تمیز متوقف و app.quit() با
  // پرچمِ quitAfterFlush دوباره صدا زده می‌شود. اگر ورکری اصلاً
  // ساخته نشده باشد، خروج بی‌درنگ انجام می‌شود.
  app.on('before-quit', (event) => {
    cleanupExtractedDiskCache('__FORCE_ALL__', true);
    if (quitAfterFlush) return;
    // مرحله ۱ ـ بخش ب: محافظِ ورودِ مجدد. اگر Handshake در حالِ
    // انجام است، before-quitِ دوم فقط خروج را متوقف می‌کند و برمی‌گردد
    // تا FLUSH_SYNCِ تکراری، شنوندهٔ تکراری و تایمرِ دوم ساخته نشود؛
    // Handshakeِ اول، خروج را به‌هرحال کامل می‌کند.
    if (flushInProgress) {
      event.preventDefault();
      return;
    }
    const worker = persistentDbWorker;
    if (!worker) return;
    event.preventDefault();
    flushInProgress = true;
    let finished = false;
    const finishQuit = () => {
      if (finished) return;
      finished = true;
      flushInProgress = false;
      try { worker.removeListener('message', onFlushAck); } catch (_) {}
      quitAfterFlush = true;
      try { worker.terminate(); } catch (_) {}
      app.quit();
    };
    const onFlushAck = (msg) => {
      if (msg && msg.type === 'FLUSH_SYNC_ACK') finishQuit();
    };
    try {
      worker.on('message', onFlushAck);
    } catch (_) {
      finishQuit();
      return;
    }
    try {
      worker.postMessage({ action: 'FLUSH_SYNC' });
    } catch (_) {
      finishQuit();
      return;
    }
    setTimeout(() => { finishQuit(); }, 2500);
  });

  const processComicFile = (filePath, sortBy = 'name_asc', sender = null) => {
    return new Promise(async (resolve) => {
      if (!filePath || typeof filePath !== 'string') {
        resolve({ success: false, error: 'مسیر فایل مشخص نشده است.' });
        return;
      }

      const normalizedPath = path.normalize(filePath);

      if (!fs.existsSync(normalizedPath)) {
        resolve({ success: false, error: 'فایل یا پوشه مورد نظر در دیسک یافت نشد.' });
        return;
      }

      if (activeExtractionContext) {
        activeExtractionContext.cancel();
      }

      cleanupExtractedDiskCache(null, false);
      ensureTempDir();

      let stat;
      try {
        stat = await fs.promises.stat(normalizedPath);
      } catch (err) {
        resolve({ success: false, error: 'خطا در دسترسی به اطلاعات فایل: ' + err.message });
        return;
      }

      const dirInfo = directoryService.scanAndSortDirectory(normalizedPath, sortBy);

      // ۱. حالت پوشه مستقیم عکس
      if (stat.isDirectory()) {
        const folderImages = directoryService.scanFolderForImages(normalizedPath);
        if (folderImages.length > 0) {
          await enrichFolderImagesWithDimensions(folderImages);

          let coverBase64 = null;
          const cachedCov = await executeDbAction('GET_CACHED_COVER', { filePath: normalizedPath });
          if (cachedCov?.cover && (cachedCov.cover.startsWith('data:') || cachedCov.cover.startsWith('comic://'))) { // مرحله ۲: کاورِ روی دیسک (comic://) هم معتبر است
            coverBase64 = cachedCov.cover;
          } else {
            coverBase64 = await createPermanentCoverDataUrlAsync(folderImages[0].path);
            if (coverBase64) {
              executeDbAction('CACHE_COVER', { filePath: normalizedPath, dataUrl: coverBase64 }).catch(() => {});
            }
          }

          preloadComicImagesIntoRam(folderImages, app);

          resolve({
            success: true,
            type: 'folder',
            filePath: normalizedPath,
            items: folderImages,
            chapters: directoryService.extractChapters(folderImages, path.basename(normalizedPath)),
            fileName: path.basename(normalizedPath),
            fileSize: `${folderImages.length} Image`,
            cover: coverBase64,
            dirInfo: {
              name: dirInfo.dirName,
              current: dirInfo.currentIndex,
              total: dirInfo.totalInDir,
              sortBy: dirInfo.sortBy
            },
            nextComic: dirInfo.nextComic,
            prevComic: dirInfo.prevComic
          });
          return;
        } else {
          resolve({ success: false, error: 'هیچ فایل تصویری در این پوشه یافت نشد.' });
          return;
        }
      }

      const ext = path.extname(normalizedPath).toLowerCase();

      // ۲. فایل‌های سند PDF (همراه با واکشی کاور ذخیره‌شده یا سفارشی از دیتابیس)
      if (ext === '.pdf') {
        let pdfCover = null;
        try {
          const cachedCov = await executeDbAction('GET_CACHED_COVER', { filePath: normalizedPath });
          if (cachedCov?.cover && (cachedCov.cover.startsWith('data:') || cachedCov.cover.startsWith('comic://'))) { // مرحله ۲: کاورِ روی دیسک (comic://) هم معتبر است
            pdfCover = cachedCov.cover;
          }
        } catch (_) {}

        resolve({
          success: true,
          type: 'pdf',
          filePath: normalizedPath,
          fileName: path.basename(normalizedPath),
          fileSize: formatBytes(stat.size),
          cover: pdfCover,
          items: [],
          dirInfo: {
            name: dirInfo.dirName,
            current: dirInfo.currentIndex,
            total: dirInfo.totalInDir,
            sortBy: dirInfo.sortBy
          },
          nextComic: dirInfo.nextComic,
          prevComic: dirInfo.prevComic
        });
        return;
      }

      // ۳. فایل‌های فشرده آرشیو (ZIP, CBZ, RAR, CBR)
      const extractorPath = path.join(__dirname, 'workers', 'fileExtractor.js');
      if (!fs.existsSync(extractorPath)) {
        resolve({ success: false, error: 'ماژول استخراج فایل یافت نشد.' });
        return;
      }

      let worker = null;
      try {
        worker = new Worker(extractorPath);
      } catch (err) {
        resolve({ success: false, error: 'خطا در ایجاد ورکر استخراج: ' + err.message });
        return;
      }

      let isSettled = false;
      // Stage 8 Part B (LEAK FIX): the 'destroyed' listener below is
      // held in this variable so terminateWorker() — the single
      // settlement gate for done/error/exit/cancel — can remove it.
      // Before this fix the once-listener was never removed when the
      // window survived, so every archive extraction added one more
      // 'destroyed' listener to the SAME WebContents until Node's
      // 10-listener limit fired MaxListenersExceededWarning.
      let onSenderDestroyed = null;

      const terminateWorker = () => {
        if (!isSettled) {
          isSettled = true;
          activeExtractionContext = null;
          if (sender && onSenderDestroyed && typeof sender.removeListener === 'function') {
            try { sender.removeListener('destroyed', onSenderDestroyed); } catch (_) {}
          }
          try {
            worker.terminate();
          } catch (_) {}
        }
      };

      activeExtractionContext = {
        cancel: () => {
          terminateWorker();
          cleanupExtractedDiskCache(null, false);
          resolve({ success: false, canceled: true, error: 'بارگذاری فایل توسط کاربر لغو شد.' });
        }
      };

      if (sender && !sender.isDestroyed()) {
        onSenderDestroyed = () => {
          terminateWorker();
          cleanupExtractedDiskCache(null, false);
        };
        sender.once('destroyed', onSenderDestroyed);
      }

      worker.postMessage({ filePath: normalizedPath, tempDir, coverOnly: false });

      worker.on('message', async (result) => {
        if (result.type === 'progress') {
          if (sender && !sender.isDestroyed()) {
            sender.send('extraction-progress', result.percent);
          }
        } else if (result.type === 'done') {
          terminateWorker();
          currentExtractedDir = result.extractedDir || null;

          if (!result.items || result.items.length === 0) {
            resolve({ success: false, error: 'هیچ فایل تصویری معتبری در این آرشیو یافت نشد.' });
            return;
          }

          // اگر بافر صفحه اول از ورکر آمده، مستقیم در کش رم نیز قرار بده
          if (result.coverBuffer && result.items[0]?.path && typeof app.setComicPageInRam === 'function') {
            app.setComicPageInRam(result.items[0].path, Buffer.from(result.coverBuffer));
          }

          let coverBase64 = null;
          try {
            const cachedCov = await executeDbAction('GET_CACHED_COVER', { filePath: normalizedPath });
            if (cachedCov?.cover && (cachedCov.cover.startsWith('data:') || cachedCov.cover.startsWith('comic://'))) { // مرحله ۲: کاورِ روی دیسک (comic://) هم معتبر است
              coverBase64 = cachedCov.cover;
            } else if (result.coverBuffer) {
              coverBase64 = createCoverFromBuffer(result.coverBuffer, result.coverMime || 'image/jpeg');
              if (coverBase64) {
                executeDbAction('CACHE_COVER', { filePath: normalizedPath, dataUrl: coverBase64 }).catch(() => {});
              }
            } else {
              coverBase64 = await createPermanentCoverDataUrlAsync(result.items[0].path);
              if (coverBase64) {
                executeDbAction('CACHE_COVER', { filePath: normalizedPath, dataUrl: coverBase64 }).catch(() => {});
              }
            }
          } catch (covErr) {
            console.warn('Cover caching non-fatal error:', covErr.message);
          }

          preloadComicImagesIntoRam(result.items, app);

          resolve({
            success: true,
            type: 'zip',
            filePath: normalizedPath,
            items: result.items,
            chapters: result.chapters || [],
            fileName: path.basename(normalizedPath),
            fileSize: formatBytes(stat.size),
            cover: coverBase64,
            dirInfo: {
              name: dirInfo.dirName,
              current: dirInfo.currentIndex,
              total: dirInfo.totalInDir,
              sortBy: dirInfo.sortBy
            },
            nextComic: dirInfo.nextComic,
            prevComic: dirInfo.prevComic
          });
        } else if (result.type === 'error') {
          terminateWorker();
          resolve({ success: false, error: result.message });
        }
      });

      worker.on('error', (err) => {
        terminateWorker();
        resolve({ success: false, error: err.message });
      });

      worker.on('exit', (code) => {
        if (code !== 0 && !isSettled) {
          terminateWorker();
          resolve({ success: false, error: `فرایند استخراج متوقف شد (کد ${code})` });
        }
      });
    });
  };

  ipcMain.handle('db-action', async (event, requestData) => {
    const { action, payload } = requestData || {};
    const result = await executeDbAction(action, payload);
    // مرحله ۱۵ — آینهٔ تمپلیت‌ها در پوشهٔ نرم‌افزار: هر بار که
    // تنظیماتِ بوک‌مارک ذخیره می‌شود، همان savedPresets در
    // bookmark-backgrounds/bookmark-presets.json هم نوشته می‌شود
    // تا با extraResources، همراهِ نصاب باشد. نوشتن، اتمیک است
    // (فایلِ موقت + rename) و شکستش، هرگز پاسخِ دیتابیس را
    // خراب نمی‌کند؛ مرجعِ حقیقت، همچنان db.json است.
    if (
      action === 'SAVE_BOOKMARK_PREFERENCES' &&
      payload && payload.preferences &&
      Array.isArray(payload.preferences.savedPresets)
    ) {
      try {
        const { appBgDir } = getBookmarkBackgroundsDirs();
        if (appBgDir) {
          if (!fs.existsSync(appBgDir)) fs.mkdirSync(appBgDir, { recursive: true });
          const tmpPath = path.join(appBgDir, 'bookmark-presets.json.tmp');
          const finalPath = path.join(appBgDir, 'bookmark-presets.json');
          fs.writeFileSync(tmpPath, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), presets: payload.preferences.savedPresets }, null, 2), 'utf-8');
          fs.renameSync(tmpPath, finalPath);
        }
      } catch (_) {}
    }
    return result;
  });

  ipcMain.handle('cancel-extraction', async () => {
    if (activeExtractionContext) {
      activeExtractionContext.cancel();
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle('cleanup-comic-cache', async () => {
    cleanupExtractedDiskCache(null, false);
    return { success: true };
  });

  // دیالوگ انتخاب تصویر کاور سفارشی از سیستم توسط کاربر و ذخیره دائمی در دیتابیس
  ipcMain.handle('select-custom-cover', async (event, targetComicPath = '') => {
    try {
      const win = getWindowFromEvent(event);
      const dialogOptions = {
        title: 'انتخاب تصویر کاور سفارشی',
        properties: ['openFile'],
        filters: [
          {
            name: 'Images',
            extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'gif']
          }
        ]
      };

      const result = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const selectedImagePath = result.filePaths[0];
      // تولید کاور با عرض ۴۶۰ پیکسل تا هم در کارت‌ها و هم در اسلایدر بزرگ کتابخانه کیفیت بالایی داشته باشد
      const coverBase64 = await createPermanentCoverDataUrlAsync(selectedImagePath, 460);

      if (!coverBase64) {
        return { success: false, error: 'خطا در پردازش تصویر انتخاب‌شده.' };
      }

      if (targetComicPath && typeof targetComicPath === 'string' && targetComicPath.trim()) {
        await executeDbAction('SET_CUSTOM_COVER', {
          filePath: path.normalize(targetComicPath.trim()),
          dataUrl: coverBase64
        });
      }

      return {
        success: true,
        cover: coverBase64,
        imagePath: selectedImagePath
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-first-page-thumbnail', async (event, filePath) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'مسیر نامعتبر است' };
      }
      const normalizedPath = path.normalize(filePath);

      const cachedRes = await executeDbAction('GET_CACHED_COVER', { filePath: normalizedPath });
      if (cachedRes?.cover && (cachedRes.cover.startsWith('data:') || cachedRes.cover.startsWith('comic://'))) { // مرحله ۲: کاورِ روی دیسک (comic://) هم معتبر است
        return { success: true, cover: cachedRes.cover };
      }

      if (!fs.existsSync(normalizedPath)) {
        return { success: false, error: 'فایل در دیسک یافت نشد' };
      }

      const stat = await fs.promises.stat(normalizedPath);

      if (stat.isDirectory()) {
        const folderImages = directoryService.scanFolderForImages(normalizedPath);
        if (folderImages.length > 0) {
          const coverBase64 = await createPermanentCoverDataUrlAsync(folderImages[0].path);
          if (coverBase64) {
            await executeDbAction('CACHE_COVER', { filePath: normalizedPath, dataUrl: coverBase64 });
            return { success: true, cover: coverBase64 };
          }
        }
        return { success: false, error: 'تصویری در این پوشه یافت نشد' };
      }

      const ext = path.extname(normalizedPath).toLowerCase();
      if (ext === '.pdf') {
        return { success: true, isPdf: true, filePath: normalizedPath };
      }

      if (IMAGE_REGEX.test(ext)) {
        const coverBase64 = await createPermanentCoverDataUrlAsync(normalizedPath);
        if (coverBase64) {
          await executeDbAction('CACHE_COVER', { filePath: normalizedPath, dataUrl: coverBase64 });
          return { success: true, cover: coverBase64 };
        }
      }

      const extractorPath = path.join(__dirname, 'workers', 'fileExtractor.js');
      if (!fs.existsSync(extractorPath)) {
        return { success: false, error: 'ماژول استخراج فایل یافت نشد' };
      }

      return new Promise((resolve) => {
        let worker = null;
        try {
          worker = new Worker(extractorPath);
        } catch (err) {
          resolve({ success: false, error: err.message });
          return;
        }

        let settled = false;
        let timer = null;

        const finish = (data) => {
          if (!settled) {
            settled = true;
            if (timer) clearTimeout(timer);
            try { worker.terminate(); } catch (_) {}
            resolve(data);
          }
        };

        timer = setTimeout(() => {
          finish({ success: false, error: 'مهلت زمانی استخراج کاور به پایان رسید.' });
        }, 5000);

        worker.postMessage({ filePath: normalizedPath, tempDir, coverOnly: true });

        worker.on('message', async (res) => {
          if (res.type === 'done_cover' && res.coverBuffer) {
            const coverBase64 = createCoverFromBuffer(res.coverBuffer, res.mime || 'image/jpeg');
            if (coverBase64) {
              try {
                await executeDbAction('CACHE_COVER', { filePath: normalizedPath, dataUrl: coverBase64 });
              } catch (_) {}
              finish({ success: true, cover: coverBase64 });
            } else {
              finish({ success: false, error: 'تبدیل بافر کاور ناموفق بود' });
            }
          } else if (res.type === 'error') {
            finish({ success: false, error: res.message });
          }
        });

        worker.on('error', (err) => finish({ success: false, error: err.message }));
        worker.on('exit', () => finish({ success: false, error: 'ورکر بسته شد' }));
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sort-directory', async (event, { filePath, sortBy } = {}) => {
    if (!filePath) return null;
    try {
      return directoryService.scanAndSortDirectory(path.normalize(filePath), sortBy || 'name_asc');
    } catch (err) {
      return null;
    }
  });

  ipcMain.handle('open-file', async (event) => {
    const win = getWindowFromEvent(event);
    const dialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Comics & Documents', extensions: ['cbz', 'zip', 'cbr', 'pdf', 'rar', 'webp', 'jpg', 'png'] }]
      // NOTE: ‎'7z' تا فاز node-7z از فیلتر حذف شده چون استخراجش پشتیبانی نمی‌شود
    };

    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    return { success: true, filePath: result.filePaths[0] };
  });

  ipcMain.handle('open-folder', async (event) => {
    const win = getWindowFromEvent(event);
    const dialogOptions = { properties: ['openDirectory'] };

    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    return { success: true, filePath: result.filePaths[0] };
  });

  ipcMain.handle('handle-drop', async (event, filePaths) => {
    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return { success: false, error: 'هیچ فایلی دریافت نشد.' };
    }
    return await processComicFile(filePaths[0], 'name_asc', event.sender);
  });

  ipcMain.handle('show-item-in-folder', async (event, filePath) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'مسیر فایل نامعتبر است.' };
      }
      const normalized = path.normalize(filePath);
      if (fs.existsSync(normalized)) {
        shell.showItemInFolder(normalized);
        return { success: true };
      }
      return { success: false, error: 'فایل در مسیر مشخص‌شده یافت نشد.' };
    } catch (err) {
      return { success: false, error: 'خطا در باز کردن اکسپلورر: ' + err.message };
    }
  });

  ipcMain.handle('copy-image-clipboard', async (event, payload) => {
    try {
      const { filePath, dataUrl } = payload || {};
      let image = null;

      if (dataUrl && typeof dataUrl === 'string') {
        image = nativeImage.createFromDataURL(dataUrl);
      } else if (filePath && typeof filePath === 'string') {
        const normalized = path.normalize(filePath);
        if (fs.existsSync(normalized)) {
          const buffer = await fs.promises.readFile(normalized);
          image = nativeImage.createFromBuffer(buffer);
        }
      }

      if (!image || image.isEmpty()) {
        return { success: false, error: 'داده تصویری نامعتبر یا خالی است.' };
      }

      clipboard.writeImage(image);
      return { success: true };
    } catch (err) {
      return { success: false, error: 'خطا در کپی تصویر: ' + err.message };
    }
  });

  ipcMain.handle('save-screenshot', async (event, payload) => {
    try {
      const { dataUrl, defaultName = 'comic-capture.png' } = payload || {};
      if (!dataUrl || typeof dataUrl !== 'string') {
        return { success: false, error: 'داده تصویری یافت نشد.' };
      }

      const win = getWindowFromEvent(event);
      const dialogOptions = {
        title: 'ذخیره تصویر اسکرین‌شات',
        defaultPath: defaultName,
        filters: [
          { name: 'PNG Image (*.png)', extensions: ['png'] },
          { name: 'JPEG Image (*.jpg)', extensions: ['jpg', 'jpeg'] }
        ]
      };

      const { canceled, filePath } = win
        ? await dialog.showSaveDialog(win, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);

      if (canceled || !filePath) return { success: false, canceled: true };

      let finalSavePath = filePath;
      const currentExt = path.extname(finalSavePath).toLowerCase();
      if (!['.png', '.jpg', '.jpeg'].includes(currentExt)) {
        finalSavePath += defaultName.endsWith('.jpg') ? '.jpg' : '.png';
      }

      const base64Data = dataUrl.replace(/^data:image\/[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.promises.writeFile(finalSavePath, buffer);

      return { success: true, filePath: finalSavePath };
    } catch (err) {
      return { success: false, error: 'خطا در ذخیره فایل اسکرین‌شات: ' + err.message };
    }
  });

  // مرحله ۵ ـ بخش ب: خروجیِ PDFِ حاشیه‌نویسی‌شده — ذخیرهٔ دوگانه.
  //  • mode='save-as' (پیش‌فرض، سازگاری با بخش الف): دیالوگِ
  //    showSaveDialog با نامِ پیش‌فرضِ `<نام>-annotated.pdf`.
  //  • mode='in-place': هیچ دیالوگی باز نمی‌شود؛ خروجی مستقیماً و
  //    اتمیک روی خودِ pdfPath نوشته می‌شود و پایهٔ خامِ `.orig.bak`
  //    در pdfAnnotationSaver، پختِ دوباره را غیرممکن می‌کند.
  //  • pages می‌تواند آبجکتِ خالی باشد، فقط در حالتِ درجا: یعنی
  //    «همهٔ حاشیه‌نویسی‌ها پاک شده‌اند» و فایل باید به پایهٔ تمیز
  //    برگردد (saver، همین حالت را با restoredClean برمی‌گرداند).
  // پس از ذخیرهٔ موفقِ درجا، کشِ رمِ همان مسیر باطل می‌شود تا ETag
  // و اندازهٔ جدیدِ فایل، معتبر باشند (دفاعِ دوم، کنارِ چکِ statِ
  // پروتکلِ comic:// که ورودی‌های اعتبارسنجی‌شده را با mtime/size
  // مقایسه می‌کند).
  ipcMain.handle('export-annotated-pdf', async (event, payload) => {
    try {
      const { pdfPath, pages, mode, password } = payload || {};
      const normalizedMode = mode === 'in-place' ? 'in-place' : 'save-as';
      if (!pdfPath || typeof pdfPath !== 'string' || !fs.existsSync(pdfPath)) {
        return { success: false, error: 'فایل PDF پیدا نشد.' };
      }
      if (!pages || typeof pages !== 'object') {
        return { success: false, error: 'حاشیه‌نویسی‌ای برای خروجی وجود ندارد.' };
      }
      const pageKeys = Object.keys(pages);
      if (pageKeys.length === 0 && normalizedMode !== 'in-place') {
        return { success: false, error: 'حاشیه‌نویسی‌ای برای خروجی وجود ندارد.' };
      }
      // سقفِ ایمنی در برابرِ payloadای غول‌پیکر (overlayهای PNG).
      let overlayChars = 0;
      for (const entry of Object.values(pages)) {
        if (entry && typeof entry.overlayPng === 'string') overlayChars += entry.overlayPng.length;
      }
      if (overlayChars > 100000000) {
        return { success: false, error: 'دادهٔ خروجی بیش از حد بزرگ است.' };
      }

      let finalPath;
      if (normalizedMode === 'in-place') {
        finalPath = pdfPath;
      } else {
        const baseName = path.basename(pdfPath, path.extname(pdfPath));
        const defaultName = `${baseName}-annotated.pdf`;
        const win = getWindowFromEvent(event);
        const dialogOptions = {
          title: 'ذخیره PDF با حاشیه‌نویسی‌ها',
          defaultPath: path.join(path.dirname(pdfPath), defaultName),
          filters: [{ name: 'PDF (*.pdf)', extensions: ['pdf'] }],
        };
        const { canceled, filePath: chosenPath } = win
          ? await dialog.showSaveDialog(win, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions);
        if (canceled || !chosenPath) return { success: false, canceled: true };

        finalPath = chosenPath;
        if (path.extname(finalPath).toLowerCase() !== '.pdf') finalPath += '.pdf';
      }

      // مرحلهٔ ۳۲ — اول ورکر امتحان می‌شود (پروسهٔ اصلی هرگز قفل
      // نمی‌شود)؛ در صورتِ خطایِ ساختِ ورکر، خطایِ ورکر یا تایم‌اوت،
      // به فراخوانِ مستقیم برمی‌گردیم (همان رفتارِ قبلی). توجه: DONEِ
      // ورکر با { success: false }، شکستِ سطحِ saver است و همان‌طور
      // برمی‌گردد (کارِ دوبرابر نمی‌شود)؛ فقط خطاهایِ انتقالی fallback
      // می‌خورند. اگر ورکر فایل را نوشت ولی در رساندنِ نتیجه شکست
      // خورد، فراخوانِ مستقیم همان خروجی را دوباره می‌نویسد (نوشتن
      // اتمیک است، پس فایلِ ناقص نمی‌ماند).
      const dataDir = (app && app.comicDataDir) || process.env.COMIC_READER_DATA_DIR || '';
      const savePassword = typeof password === 'string' ? password : '';
      let result = null;
      try {
        result = await runAnnotatedExportWorker({ pdfPath, pages, outputPath: finalPath, mode: normalizedMode, password: savePassword, dataDir, sender: event.sender, timeoutMs: 300000 });
      } catch (workerErr) {
        try { const lg = getIpcLogger(); if (lg) lg.warn('export-annotated-pdf: worker failed, falling back to direct save', String((workerErr && workerErr.message) || workerErr)); } catch (_) {}
      }
      if (!result) {
        let saver;
        try {
          saver = require('./services/pdfAnnotationSaver');
        } catch (_) {
          return { success: false, error: 'ماژولِ خروجیِ PDF (pdfAnnotationSaver.js) پیدا نشد؛ فایل را در پوشهٔ electron/services قرار دهید.' };
        }
        let saveLogger = null;
        try { saveLogger = getIpcLogger(); } catch (_) { saveLogger = null; }
        result = await saver.saveAnnotatedPdf({ pdfPath, pages, outputPath: finalPath, mode: normalizedMode, logger: saveLogger, password: savePassword, dataDir });
      }
      if (result && result.success && (result.mode === 'in-place' || path.resolve(finalPath) === path.resolve(pdfPath))) {
        invalidateComicRamCache(app, pdfPath);
      }
      return result;
    } catch (err) {
      // هات‌فیکسِ مرحله ۶: خطای قفل، ساخت‌یافته برمی‌گردد تا رندرر
      // پیامِ دقیقِ «فایل در برنامهٔ دیگری باز است» را نشان دهد.
      if (err && err.code === 'FILE_LOCKED') {
        try { const lg = getIpcLogger(); if (lg) lg.warn('export-annotated-pdf: file locked', err.message); } catch (_) { /* ignore */ }
        return { success: false, locked: true, error: err.message };
      }
      // مرحله ۷ ـ بخش الف: خطای ذخیره، در لاگِ دیسک هم ثبت
      // می‌شود (با Stack Trace) تا علتِ شکستِ ذخیره، پس از بستنِ
      // برنامه هم قابلِ بررسی باشد. قراردادِ برگشتی، عیناً قبل است.
      try { const lg = getIpcLogger(); if (lg) lg.error('export-annotated-pdf failed', err); } catch (_) { /* ignore */ }
      return { success: false, error: 'خطا در ساختِ PDFِ حاشیه‌نویسی‌شده: ' + err.message };
    }
  });

  // مرحله ۸ ـ بخش الف: استراتژیِ Xodo برای PDFهای محافظت‌شده.
  // بررسیِ محافظت، فقط هنگامِ کلیک روی دکمهٔ استودیو انجام می‌شود
  // (نه هنگامِ باز کردنِ فایل)؛ پس خواندنِ صرفِ فایل، هیچ مزاحمتی
  // ندارد. سقفِ ۵۰۰ مگابایت، همان سقفِ probe در saver است.
  // مرحله ۸ ـ بخش الف: استراتژیِ Xodo برای PDFهای محافظت‌شده.
  // بررسیِ محافظت، فقط هنگامِ کلیک روی دکمهٔ استودیو انجام می‌شود
  // (نه هنگامِ باز کردنِ فایل)؛ پس خواندنِ صرفِ فایل، هیچ مزاحمتی
  // ندارد. سقفِ ۵۰۰ مگابایت، همان سقفِ probe در saver است.
  // مرحله ۸ ـ اصلاحِ نهایی: پروب در ورکرِ جدا اجرا می‌شود تا
  // پروسهٔ اصلی قفل نشود؛ هشدارهای pdf-lib، در saver ساکت شده‌اند
  // و فقط در لاگِ دیسک خلاصه می‌شوند.
  ipcMain.handle('check-pdf-protection', async (event, payload) => {
    const unknown = { protected: false, reason: 'unknown', pageCount: -1, hasEncryptToken: false };
    try {
      const filePath = payload && payload.filePath;
      if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) return unknown;
      if (path.extname(filePath).toLowerCase() !== '.pdf') return { protected: false, reason: 'not-pdf', pageCount: -1, hasEncryptToken: false };
      const stat = fs.statSync(filePath);
      if (!stat || stat.size > 500 * 1024 * 1024) return unknown;
      let result = null;
      try {
        result = await runPdfCopyWorker({ kind: 'probe', filePath, sender: event.sender, timeoutMs: 150000 });
      } catch (err) {
        if (err && err.code === 'WORKER_SPAWN_FAILED') {
          // پشتیبانِ درونِ پروسهٔ اصلی: پروبِ مسیریِ سریع (بدونِ
          // پارسِ کلِ فایل) و فقط در صورتِ نامشخص بودن، پروبِ کامل.
          let saver;
          try { saver = require('./services/pdfAnnotationSaver'); } catch (_) { return unknown; }
          let saveLogger = null;
          try { saveLogger = getIpcLogger(); } catch (_) { saveLogger = null; }
          const probed = await saver.probePdfProtectionForPath(filePath, saveLogger);
          let qpdfAvailable = false;
          try { if (saver.isQpdfAvailable) qpdfAvailable = Boolean(await saver.isQpdfAvailable()); } catch (_) {}
          result = {
            protected: Boolean(probed && probed.protected),
            readOnly: Boolean(probed && probed.readOnly),
            reason: (probed && probed.reason) || 'unknown',
            pageCount: (probed && probed.pageCount) || -1,
            hasEncryptToken: Boolean(probed && probed.hasEncryptToken),
            fast: Boolean(probed && probed.fast),
            invalidObjects: Array.isArray(probed && probed.invalidObjects) ? probed.invalidObjects.length : 0,
            warningsCount: (probed && probed.warningsCount) || 0,
            qpdfAvailable,
          };
        } else {
          try { const lg = getIpcLogger(); if (lg) lg.warn('check-pdf-protection worker failed', err && err.message); } catch (_) {}
          return unknown;
        }
      }
      // مرحله ۱۰: اگر پروبِ سریع، جزئیاتِ رمزگذاری را نداشت و
      // فایل قفل‌دار است، توصیفِ رمزگذاری ضمیمه می‌شود (بهترین‌تلاش)
      // تا رندرر بداند کپیِ بی‌اتلاف ممکن است یا بازسازی لازم است.
      if (result && result.protected && !result.encryption) {
        try {
          const saverForDescribe = require('./services/pdfAnnotationSaver');
          if (saverForDescribe && saverForDescribe.describePdfEncryptionForPath) {
            const enc = await saverForDescribe.describePdfEncryptionForPath(filePath, getIpcLogger());
            if (enc) { result.encryption = enc; result.rebuildRecommended = Boolean(enc.rebuildRecommended); }
          }
        } catch (_) { /* توصیف انجام نشد؛ پروبِ پایه، معتبر می‌ماند */ }
      }
      return {
        protected: Boolean(result && result.protected),
        readOnly: Boolean(result && result.readOnly),
        reason: (result && result.reason) || 'unknown',
        pageCount: (result && result.pageCount) || -1,
        hasEncryptToken: Boolean(result && result.hasEncryptToken),
        fast: Boolean(result && result.fast),
        invalidObjects: (result && result.invalidObjects) || 0,
        warningsCount: (result && result.warningsCount) || 0,
        encryption: (result && result.encryption) || undefined,
        rebuildRecommended: Boolean(result && result.rebuildRecommended),
        qpdfAvailable: Boolean(result && result.qpdfAvailable),
      };
    } catch (err) {
      try { const lg = getIpcLogger(); if (lg) lg.warn('check-pdf-protection failed', err && err.message); } catch (_) {}
      return unknown;
    }
  });

  // مرحله ۸ ـ بخش الف: ساختِ نسخهٔ کپیِ بدونِ قفلِ /Encrypt.
  // ذخیره، خودکار و کنارِ فایلِ اصلی است (<نام>-editable.pdf و در
  // صورتِ تکراری، <نام>-editable-2.pdf و … تا سقفِ ۱۰۰)؛ دیالوگِ
  // Save As ندارد تا جریانِ «کلیک روی استودیو → کپی → ویرایش»
  // با یک تأیید انجام شود. فایلِ اصلی هرگز دست نمی‌خورد و برای
  // کپی، .orig.bak ساخته نمی‌شود.
  // مرحله ۸ ـ اصلاحِ نهایی: کارِ سنگین در ورکرِ جدا انجام می‌شود
  // (پروسهٔ اصلی قفل نمی‌شود)، پیشرفت با 'pdf-copy-progress' به
  // رندرر می‌رسد، لغو با 'cancel-pdf-copy' کار را خاتمه می‌دهد، و
  // حالتِ alreadyUnlocked دیگر با Buffer.from(undefined) کرش
  // نمی‌کند — کپی‌ای نوشته نمی‌شود و مسیرِ فایلِ اصلی برمی‌گردد.
  ipcMain.handle('create-unlocked-pdf-copy', async (event, payload) => {
    let tempPath = null;
    try {
      const filePath = payload && payload.filePath;
      const copyPassword = payload && typeof payload.password === 'string' ? payload.password : '';
      if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) {
        return { success: false, error: 'فایل PDF پیدا نشد.' };
      }
      if (path.extname(filePath).toLowerCase() !== '.pdf') {
        return { success: false, error: 'فقط فایل‌های PDF می‌توانند نسخهٔ کپیِ قابل‌ویرایش داشته باشند.' };
      }
      // مرحله ۱۱: نام/مسیرِ دلخواهِ کاربر (از مودال یا دیالوگِ
      // ویندوز) با همان حلقهٔ شماره‌دارِ قبلی؛ در غیابِ آن‌ها،
      // نامِ خودکارِ <base>-editable.pdf.
      const copyPath = resolveCopyOutputPath(filePath, payload && payload.desiredName, payload && payload.desiredPath);
      if (!copyPath) {
        return { success: false, error: 'نامِ مناسبی برای نسخهٔ کپی پیدا نشد؛ پوشهٔ فایل را خلوت کنید و دوباره تلاش کنید.' };
      }
      tempPath = copyPath + '.' + process.pid + '.' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.tmp';
      let copy = null;
      try {
        copy = await runPdfCopyWorker({ kind: 'copy', filePath, tempPath, sender: event.sender, password: copyPassword });
      } catch (err) {
        if (err && err.code === 'WORKER_SPAWN_FAILED') {
          // پشتیبانِ درونِ پروسهٔ اصلی (saverِ اصلاح‌شده: هشدارها ساکت).
          let saver;
          try { saver = require('./services/pdfAnnotationSaver'); } catch (_) {
            return { success: false, error: 'ماژولِ خروجیِ PDF (pdfAnnotationSaver.js) پیدا نشد؛ فایل را در پوشهٔ electron/services قرار دهید.' };
          }
          let saveLogger = null;
          try { saveLogger = getIpcLogger(); } catch (_) { saveLogger = null; }
          const bytes = await fs.promises.readFile(filePath);
          const inMain = await saver.createUnlockedPdfCopy({ bytes, logger: saveLogger, password: copyPassword });
          if (!inMain || !inMain.success) {
            // مرحله ۱۱: ردِ رمزگشایی در پشتیبانِ درونِ پروسه هم،
            // کد برمی‌گرداند تا TopBar بازسازی را پیشنهاد دهد؛
            // کپیِ باینریِ خاموش، دیگر صادر نمی‌شود (همانندِ ورکر).
            if (inMain && (inMain.code === 'PDF_COPY_PASSWORD_REQUIRED' || inMain.code === 'PDF_COPY_UNSUPPORTED_ENCRYPTION')) {
              return { success: false, code: inMain.code, error: inMain.error || 'ساختِ نسخهٔ کپیِ قابل‌ویرایش انجام نشد.', pageCount: -1 };
            }
            return { success: false, error: (inMain && inMain.error) || 'ساختِ نسخهٔ کپی انجام نشد.' };
          }
          if (inMain.alreadyUnlocked || !inMain.bytes) {
            return { success: true, copyPath: filePath, pageCount: inMain.pageCount, textGate: 'not-needed', alreadyUnlocked: true };
          }
          await atomicWriteBuffer(copyPath, Buffer.from(inMain.bytes));
          return { success: true, copyPath, pageCount: inMain.pageCount, textGate: inMain.textGate, alreadyUnlocked: false, unlockedBy: inMain.unlockedBy || undefined };
        }
        throw err;
      }
      if (!copy || !copy.success) {
        cleanupPdfCopyTemp(tempPath);
        tempPath = null;
        return { success: false, code: (copy && copy.code) || undefined, error: (copy && copy.error) || 'ساختِ نسخهٔ کپی انجام نشد.', pageCount: (copy && copy.pageCount) || -1 };
      }
      if (copy.alreadyUnlocked) {
        // فایل، قفلِ فعالی ندارد: هیچ‌چیز نوشته نشده است؛ مسیرِ
        // فایلِ اصلی برمی‌گردد تا رندرر، استودیو را روی همان فایل
        // فعال کند (بدونِ جابه‌جاییِ بیهوده).
        cleanupPdfCopyTemp(tempPath);
        tempPath = null;
        return { success: true, copyPath: filePath, pageCount: copy.pageCount, textGate: 'not-needed', alreadyUnlocked: true };
      }
      await renamePdfCopyTempWithRetries(tempPath, copyPath);
      tempPath = null;
      return {
        success: true,
        copyPath,
        pageCount: copy.pageCount,
        textGate: copy.textGate,
        alreadyUnlocked: false,
        binaryCopy: Boolean(copy.binaryCopy),
        stillEncrypted: Boolean(copy.stillEncrypted),
        unlockedBy: copy.unlockedBy || undefined,
        healed: Boolean(copy.healed),
        baselineInvalidObjects: copy.baselineInvalidObjects || 0,
        outputInvalidObjects: copy.outputInvalidObjects || 0,
      };
    } catch (err) {
      cleanupPdfCopyTemp(tempPath);
      if (err && err.code === 'PDF_COPY_CANCELLED') {
        return { success: false, cancelled: true, error: 'ساختِ نسخهٔ کپی لغو شد.' };
      }
      if (err && err.code === 'FILE_LOCKED') {
        return { success: false, locked: true, error: err.message };
      }
      try { const lg = getIpcLogger(); if (lg) lg.error('create-unlocked-pdf-copy failed', err); } catch (_) {}
      return { success: false, error: 'خطا در ساختِ نسخهٔ کپی: ' + err.message };
    }
  });

  // مرحله ۹ — لایهٔ ۱: آماده‌سازیِ خواندنِ فایلِ محافظت‌شده.
  // ورکر (غیرمسدودکننده) اول؛ اگر اسپاونِ ورکر شکست خورد، همان
  // منطق در پروسهٔ اصلی اجرا می‌شود. خروجی، همیشه مسیرِ فایلِ کشِ
  // راستی‌آزمایی‌شده است (یا وضعیتِ نیازِ رمز)؛ بایت‌ها هرگز از
  // این کانال برنمی‌گردند و فایلِ اصلی، دست نمی‌خورد.
  ipcMain.handle('prepare-protected-pdf-for-reading', async (event, payload) => {
    try {
      const filePath = payload && payload.filePath;
      const password = payload && typeof payload.password === 'string' ? payload.password : '';
      if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) {
        return { status: 'error', reason: 'file-missing', pageCount: -1 };
      }
      if (path.extname(filePath).toLowerCase() !== '.pdf') {
        return { status: 'error', reason: 'not-pdf', pageCount: -1 };
      }
      const cacheDir = getProtectedCacheDir();
      let result = null;
      try {
        result = await runPdfCopyWorker({ kind: 'prepare', filePath, sender: event.sender, timeoutMs: 150000, password, cacheDir });
      } catch (err) {
        if (err && err.code === 'WORKER_SPAWN_FAILED') {
          let saver;
          try { saver = require('./services/pdfAnnotationSaver'); } catch (_) {
            return { status: 'error', reason: 'saver-missing', pageCount: -1 };
          }
          let saveLogger = null;
          try { saveLogger = getIpcLogger(); } catch (_) { saveLogger = null; }
          result = await saver.prepareProtectedPdfForReading({ filePath, password, cacheDir, logger: saveLogger });
        } else if (err && err.code === 'PDF_COPY_CANCELLED') {
          return { status: 'error', reason: 'cancelled', pageCount: -1 };
        } else {
          throw err;
        }
      }
      if (result && (result.status === 'ghost-neutralized' || result.status === 'unlocked-copy') && result.path) {
        try {
          const st = await fs.promises.stat(result.path);
          if (!st.isFile() || st.size < 8) {
            return { status: 'error', reason: 'cache-missing', pageCount: result.pageCount || -1 };
          }
        } catch (_) {
          return { status: 'error', reason: 'cache-missing', pageCount: result.pageCount || -1 };
        }
      }
      return {
        status: (result && result.status) || 'error',
        path: (result && result.path) || null,
        pageCount: (result && typeof result.pageCount === 'number') ? result.pageCount : -1,
        reason: (result && result.reason) || null,
      };
    } catch (err) {
      try { const lg = getIpcLogger(); if (lg) lg.error('prepare-protected-pdf-for-reading failed', err); } catch (_) {}
      return { status: 'error', reason: 'failed', pageCount: -1 };
    }
  });

  // مرحله ۸ ـ اصلاحِ نهایی: لغوِ ساختِ کپی. کارهای فعالِ همین
  // فرستنده خاتمه می‌یابند؛ invokeِ در حالِ انتظار، با
  // { success: false, cancelled: true } برمی‌گردد و مودال، باز
  // می‌ماند تا کاربر، دوباره تصمیم بگیرد.
  ipcMain.handle('cancel-pdf-copy', async (event) => {
    const count = cancelPdfCopyJobsForSender(event.sender);
    return { cancelled: count };
  });

  // مرحله ۵ ـ بخش الف: پشتیبان‌گیریِ یک‌کلیکی. ساختِ ZIP در ورکرِ
  // دیتابیس انجام می‌شود (فلاشِ اول + خواندنِ db.json + کاورها)؛
  // اینجا فقط دیالوگِ ذخیره + نوشتنِ اتمیکِ فایل است.
  ipcMain.handle('export-backup', async (event) => {
    try {
      const result = await executeDbRequest('BUILD_BACKUP', {}, 60000);
      if (!result || result.type === 'error' || !result.success) {
        return { success: false, error: (result && result.message) || 'ساختِ فایل پشتیبان انجام نشد.' };
      }
      let defaultName = 'comic-reader-backup.crbackup';
      try {
        const backupFormat = require('./workers/backupFormat');
        defaultName = backupFormat.backupDefaultFileName();
      } catch (_) {}
      const win = getWindowFromEvent(event);
      const dialogOptions = {
        title: 'ذخیره فایل پشتیبان',
        defaultPath: defaultName,
        filters: [
          { name: 'Comic Reader Backup (*.crbackup)', extensions: ['crbackup'] },
          { name: 'ZIP Archive (*.zip)', extensions: ['zip'] },
        ],
      };
      const { canceled, filePath: chosenPath } = win
        ? await dialog.showSaveDialog(win, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);
      if (canceled || !chosenPath) return { success: false, canceled: true };

      const buffer = Buffer.from(result.base64, 'base64');
      await atomicWriteBuffer(chosenPath, buffer);
      return { success: true, filePath: chosenPath, coverCount: result.coverCount, size: result.size };
    } catch (err) {
      return { success: false, error: 'خطا در ذخیرهٔ فایل پشتیبان: ' + err.message };
    }
  });

  // مرحله ۵ ـ بخش الف: بازیابیِ یک‌کلیکی. خواندنِ فایل + اعتبارسنجی +
  // جایگزینیِ اتمیک، همه در ورکرِ دیتابیس انجام می‌شود؛ رندرر پس از
  // موفقیت، برنامه را دوباره بارگذاری می‌کند تا استورها هایدریت شوند.
  ipcMain.handle('import-backup', async (event) => {
    try {
      const win = getWindowFromEvent(event);
      const dialogOptions = {
        title: 'انتخاب فایل پشتیبان برای بازیابی',
        properties: ['openFile'],
        filters: [
          { name: 'Comic Reader Backup (*.crbackup, *.zip)', extensions: ['crbackup', 'zip'] },
          { name: 'All Files (*.*)', extensions: ['*'] },
        ],
      };
      const { canceled, filePaths } = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      const chosenPath = filePaths[0];
      const stat = fs.statSync(chosenPath);
      if (stat.size > 512 * 1024 * 1024) {
        return { success: false, error: 'فایل پشتیبان بیش از حد بزرگ است.' };
      }
      const buffer = fs.readFileSync(chosenPath);
      const result = await executeDbRequest('RESTORE_BACKUP', { base64: buffer.toString('base64') }, 120000);
      if (!result || result.type === 'error' || !result.success) {
        return { success: false, error: (result && result.message) || 'بازیابیِ فایل پشتیبان انجام نشد.' };
      }
      return { success: true, coverCount: result.coverCount, dbSha256: result.dbSha256 };
    } catch (err) {
      return { success: false, error: 'خطا در بازیابیِ فایل پشتیبان: ' + err.message };
    }
  });

  ipcMain.handle('toggle-fullscreen', (event) => {
    const win = getWindowFromEvent(event);
    if (!win) return false;
    const nextState = !win.isFullScreen();
    win.setFullScreen(nextState);
    return nextState;
  });

  ipcMain.handle('is-fullscreen', (event) => {
    const win = getWindowFromEvent(event);
    return win ? win.isFullScreen() : false;
  });

  // مرحله ۷ ـ بخش الف: اطلاعاتِ صادقانهٔ محیط برای صفحهٔ
  // دانلودها/به‌روزرسانی. هرگز throw نمی‌کند و هر فیلد، با
  // بهترین تلاش پر می‌شود؛ نبودِ یک فایل، صفر/خالی برمی‌گرداند،
  // نه خطا. هیچ سرورِ به‌روزرسانی‌ای در کار نیست و این هندلر هم
  // چیزی را چک نمی‌کند؛ فقط وضعیتِ فعلیِ همین نصب را گزارش
  // می‌دهد.
  ipcMain.handle('get-app-info', async () => {
    try {
      const dataDir = (app && app.comicDataDir) || process.env.COMIC_READER_DATA_DIR || '';
      const dbFile = dataDir ? path.join(dataDir, 'db.json') : '';
      let dbSize = 0;
      try { dbSize = dbFile ? fs.statSync(dbFile).size : 0; } catch (_) { dbSize = 0; }
      let coverCount = 0;
      try {
        const coversDir = dataDir ? path.join(dataDir, 'covers') : '';
        if (coversDir) coverCount = fs.readdirSync(coversDir).length;
      } catch (_) { coverCount = 0; }
      let logSize = 0;
      let logExists = false;
      try {
        const { getLogFileInfo } = require('./logger');
        const info = getLogFileInfo(dataDir);
        logSize = info.size;
        logExists = info.exists;
      } catch (_) { /* ignore */ }
      return {
        success: true,
        version: (() => { try { return app.getVersion(); } catch (_) { return ''; } })(),
        isPackaged: Boolean(app && app.isPackaged),
        isPortableMode: Boolean(app && app.isPortableMode),
        platform: process.platform,
        arch: process.arch,
        electronVersion: (process.versions && process.versions.electron) || '',
        chromeVersion: (process.versions && process.versions.chrome) || '',
        nodeVersion: (process.versions && process.versions.node) || '',
        dataDir,
        logFile: dataDir ? path.join(dataDir, 'logs', 'app.log') : '',
        logSize,
        logExists,
        dbSize,
        coverCount,
      };
    } catch (err) {
      return { success: false, error: String((err && err.message) || err) };
    }
  });


  // ==========================================================================
  // مرحله ۱۰: مدیریتِ حافظه، پاک‌سازی و تغییرِ محلِ ذخیرهٔ داده.
  // ==========================================================================

  // اندازهٔ بازگشتیِ یک پوشه (فایل‌ها + بایت‌ها)؛ هر خطا در یک
  // ورودی، همان ورودی را رد می‌کند، نه کلِ محاسبه را. پیوندهای
  // نمادین دنبال نمی‌شوند تا حلقهٔ بی‌نهایت ساخته نشود.
  function dirSizeRecursive(dirPath) {
    let bytes = 0;
    let files = 0;
    try {
      if (!dirPath || !fs.existsSync(dirPath)) return { bytes: 0, files: 0 };
      const stack = [dirPath];
      while (stack.length > 0) {
        const current = stack.pop();
        let entries;
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { continue; }
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          try {
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) { stack.push(full); continue; }
            if (entry.isFile()) {
              const st = fs.statSync(full);
              bytes += st.size;
              files += 1;
            }
          } catch (_) { /* یک ورودیِ خراب، محاسبه را متوقف نمی‌کند */ }
        }
      }
    } catch (_) {}
    return { bytes, files };
  }

  // مرحله ۱۰: فلاشِ دیتابیس + توقفِ تمیزِ ورکر، برای جابه‌جاییِ
  // محلِ داده. همان handshakeِ خروجِ مرحلهٔ ۱ است، ولی بدونِ
  // app.quit: پس از ACK (یا حداکثر ۲۵۰۰ میلی‌ثانیه)، ورکر خاتمه
  // می‌یابد و persistentDbWorker خالی می‌شود تا هیچ نوشتنِ
  // معلقی، روی پوشهٔ قدیمی نماند.
  function flushAndTerminateDbWorker() {
    return new Promise((resolve) => {
      const worker = persistentDbWorker;
      if (!worker) { resolve(true); return; }
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        try { worker.removeListener('message', onAck); } catch (_) {}
        try { worker.terminate(); } catch (_) {}
        persistentDbWorker = null;
        resolve(true);
      };
      const onAck = (msg) => {
        if (msg && msg.type === 'FLUSH_SYNC_ACK') finish();
      };
      try { worker.on('message', onAck); } catch (_) { finish(); return; }
      try { worker.postMessage({ action: 'FLUSH_SYNC' }); } catch (_) { finish(); return; }
      setTimeout(finish, 2500);
    });
  }

  function isPathInsidePath(child, parent) {
    try {
      const rel = path.relative(parent, child);
      return rel === '' || (rel && !rel.startsWith('..') && !path.isAbsolute(rel));
    } catch (_) { return false; }
  }

  // مرحله ۱۰: جابه‌جاییِ کلِ پوشهٔ داده (db.json، covers، logs،
  // کش‌ها، پشتیبان‌ها) به مقصدِ تازه. اول rename (همان درایو)؛
  // اگر rename ممکن نبود (درایوِ دیگر)، کپیِ بازگشتی + راستی‌آزماییِ
  // شمارِ فایل‌ها و حجم‌ها + حذفِ مبدأ. مقصد باید خالی یا ناموجود
  // باشد؛ هرگز روی دادهٔ موجود نوشته نمی‌شود.
  function moveDataDirectory(sourceDir, targetDir) {
    const source = path.normalize(sourceDir);
    const target = path.normalize(targetDir);
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
      throw new Error('پوشهٔ فعلیِ داده پیدا نشد.');
    }
    if (fs.existsSync(target)) {
      if (!fs.statSync(target).isDirectory()) throw new Error('مسیرِ انتخاب‌شده، پوشه نیست.');
      if (fs.readdirSync(target).length > 0) throw new Error('پوشهٔ انتخاب‌شده خالی نیست؛ پوشه‌ای خالی (یا تازه) انتخاب کنید.');
      fs.rmSync(target, { recursive: true, force: true });
    }
    const before = dirSizeRecursive(source);
    let movedByRename = false;
    try {
      fs.renameSync(source, target);
      movedByRename = true;
    } catch (_) {
      movedByRename = false;
    }
    if (!movedByRename) {
      fs.mkdirSync(target, { recursive: true });
      fs.cpSync(source, target, { recursive: true });
      const after = dirSizeRecursive(target);
      if (after.files !== before.files || after.bytes !== before.bytes) {
        try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) {}
        throw new Error('کپیِ اطلاعات به مقصدِ جدید کامل انجام نشد؛ هیچ‌چیز جابه‌جا نشد و مسیرِ قبلی دست نخورده باقی ماند.');
      }
      fs.rmSync(source, { recursive: true, force: true });
    }
    return { moved: true, method: movedByRename ? 'rename' : 'copy', files: before.files, bytes: before.bytes };
  }

  // مرحله ۱۰: راه‌اندازیِ دوبارهٔ برنامه پس از تغییرِ محلِ داده،
  // با تأخیرِ کوتاه تا پاسخِ IPC به رندرر برسد و Toast دیده شود.
  function scheduleDataDirRelaunch() {
    setTimeout(() => {
      try { quitAfterFlush = true; } catch (_) {}
      try { app.relaunch(); } catch (_) {}
      try { app.quit(); } catch (_) {}
    }, 900);
  }

  // مرحله ۱۰: اگر پشتیبانِ جابه‌جاشده‌ای برای فایل نیست، از
  // بایت‌های فعلیِ فایل (همان‌طور که هستند، حتی رمزدار) یک نسخهٔ
  // خامِ دست‌نخورده در پوشهٔ داده بساز + sidecar. پشتیبانِ موجود،
  // هرگز بازنویسی نمی‌شود. معیارِ سلامت، فقط جادوی %PDF- است:
  // بایت‌های اصلی باید بایت‌به‌بایت حفظ شوند، حتی اگر pdf-lib
  // نتواند آن‌ها را پارس کند (فایلِ رمزدار).
  function ensureRelocatedOrigBackup(pdfPath, dataDir) {
    try {
      const saver = require('./services/pdfAnnotationSaver');
      if (!saver || !saver.relocatedOrigBackupPathFor) return { created: false };
      const backupPath = saver.relocatedOrigBackupPathFor(pdfPath, dataDir);
      if (fs.existsSync(backupPath)) return { created: false, backupPath };
      const current = fs.readFileSync(pdfPath);
      if (!current || current.length <= 5 || current.slice(0, 5).toString('ascii') !== '%PDF-') {
        return { created: false, reason: 'not-pdf' };
      }
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(pdfPath, backupPath, fs.constants.COPYFILE_EXCL);
      if (saver.writeOrigBackupSidecar) saver.writeOrigBackupSidecar(backupPath, pdfPath, current);
      return { created: true, backupPath };
    } catch (err) {
      if (err && err.code === 'EEXIST') return { created: false };
      return { created: false, reason: String((err && err.message) || err) };
    }
  }

  ipcMain.handle('get-storage-stats', async () => {
    try {
      const { readCustomDataDir } = require('./logger');
      const dataDir = (app && app.comicDataDir) || process.env.COMIC_READER_DATA_DIR || '';
      const dbFiles = ['db.json', 'db.json.bak', 'db.json.pre-restore.bak'];
      let dbSizeBytes = 0;
      for (const name of dbFiles) {
        try { dbSizeBytes += fs.statSync(path.join(dataDir, name)).size; } catch (_) {}
      }
      const covers = dirSizeRecursive(dataDir ? path.join(dataDir, 'covers') : '');
      const protectedCache = dirSizeRecursive(getProtectedCacheDir());
      const origBackups = dirSizeRecursive(dataDir ? path.join(dataDir, 'orig-backups') : '');
      const extractedTemp = dirSizeRecursive(typeof tempDir === 'string' ? tempDir : '');
      const logs = dirSizeRecursive(dataDir ? path.join(dataDir, 'logs') : '');
      const searchIndex = dirSizeRecursive(dataDir ? path.join(dataDir, 'search-index') : '');
      // مرحله ۱۳: سهمِ کاورهایِ سفارشی (بهترین تلاش؛ اگر ورکر
      // جواب نداد، صفر می‌ماند و مودال فقط مجموع را نشان می‌دهد).
      let coverCustomCount = 0;
      let coverCustomBytes = 0;
      try {
        const coverStats = await executeDbRequest('GET_COVER_STATS', {}, 30000);
        if (coverStats && coverStats.type === 'done') {
          coverCustomCount = coverStats.customFiles || 0;
          coverCustomBytes = coverStats.customBytes || 0;
        }
      } catch (_) {}
      const tempCacheSizeBytes = protectedCache.bytes + origBackups.bytes + extractedTemp.bytes;
      const totalSizeBytes = dbSizeBytes + covers.bytes + tempCacheSizeBytes + logs.bytes;
      return {
        success: true,
        stats: {
          currentDataDir: dataDir,
          drive: dataDir ? path.parse(dataDir).root : '',
          isPortableMode: Boolean(app && app.isPortableMode),
          isCustomDir: Boolean(readCustomDataDir && readCustomDataDir()),
          dbSizeBytes,
          coversSizeBytes: covers.bytes,
          coversCount: covers.files,
          tempCacheSizeBytes,
          protectedCacheSizeBytes: protectedCache.bytes,
          origBackupsSizeBytes: origBackups.bytes,
          extractedTempSizeBytes: extractedTemp.bytes,
          protectedCacheCount: protectedCache.files,
          origBackupsCount: origBackups.files,
          extractedTempCount: extractedTemp.files,
          searchIndexSizeBytes: searchIndex.bytes,
          searchIndexCount: searchIndex.files,
          coverCustomCount,
          coverCustomBytes,
          logsSizeBytes: logs.bytes,
          totalSizeBytes,
        },
      };
    } catch (err) {
      return { success: false, error: 'دریافتِ آمارِ حافظه انجام نشد: ' + String((err && err.message) || err) };
    }
  });

  ipcMain.handle('clear-all-covers', async () => {
    try {
      const result = await executeDbRequest('CLEAR_ALL_COVERS', {}, 60000);
      if (result && result.type === 'done') {
        return { success: true, clearedFiles: result.clearedFiles || 0, freedBytes: result.freedBytes || 0, keptCustom: result.keptCustom || 0 };
      }
      return { success: false, error: (result && result.message) || 'پاک‌سازیِ کاورها انجام نشد.' };
    } catch (err) {
      return { success: false, error: 'پاک‌سازیِ کاورها انجام نشد: ' + String((err && err.message) || err) };
    }
  });

  // مرحله ۱۳: پوشهٔ اختصاصیِ تصاویرِ بوک‌مارک. پوشهٔ اصلی،
  // همیشه زیرِ dataDir است (در حالتِ Portable هم همان‌جاست)؛
  // در حالتِ توسعه، پوشهٔ کنارِ پروژه هم خوانده می‌شود تا کاربر
  // بتواند همان‌جا هم عکس بریزد. اگر پوشه‌ای نبود، ساخته می‌شود.
  // مرحله ۱۵ — پوشهٔ عکس‌ها و تمپلیت‌هایِ بوک‌مارک، دقیقاً در
  // پوشهٔ خودِ نرم‌افزار (App-Local Bookmark Assets):
  // - توسعه (!isPackaged): ریشهٔ پروژه، کنارِ package.json
  //   (app.getAppPath()/bookmark-backgrounds).
  // - نصب‌شده (isPackaged): resources/bookmark-backgrounds که
  //   electron-builder با extraResources از همین پوشهٔ پروژه پر
  //   می‌کند؛ چون بیرونِ asar است، در زمانِ اجرا قابلِ نوشتن است.
  // پوشهٔ قدیمیِ dataDir، فقط منبعِ خواندنِ سازگار با نسخه‌هایِ
  // قبلی است تا عکس‌هایِ قبلیِ کاربر ناپدید نشوند؛ نوشتنِ تازه
  // (باز کردن، وارد کردن، حذف، presets.json) همیشه در پوشهٔ
  // همراهِ نرم‌افزار است. کلیدِ projectBgDir برای سازگاری، همان
  // appBgDir است.
  function getBookmarkBackgroundsDirs() {
    const dataDir = (app && app.comicDataDir) || process.env.COMIC_READER_DATA_DIR || '';
    const dataBgDir = dataDir ? path.join(dataDir, 'bookmark-backgrounds') : '';
    let appBgDir = '';
    try {
      if (app && app.isPackaged) {
        appBgDir = path.join(process.resourcesPath, 'bookmark-backgrounds');
      } else if (app && typeof app.getAppPath === 'function') {
        appBgDir = path.join(app.getAppPath(), 'bookmark-backgrounds');
      }
    } catch (_) {}
    return { dataDir, dataBgDir, projectBgDir: appBgDir, appBgDir };
  }

  function ensureBookmarkBackgroundsDirs() {
    const { dataBgDir, appBgDir } = getBookmarkBackgroundsDirs();
    [dataBgDir, appBgDir].forEach((d) => {
      if (!d) return;
      try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch (_) {}
    });
    return { dataBgDir, projectBgDir: appBgDir, appBgDir };
  }

  // حذفِ محتوایِ یک پوشه (نه خودِ پوشه) + شمارشِ قبل از حذف.
  function clearDirContentsSync(dirPath) {
    const before = dirSizeRecursive(dirPath);
    if (!dirPath || !fs.existsSync(dirPath)) return { files: 0, bytes: 0 };
    try {
      fs.readdirSync(dirPath).forEach((name) => {
        try { fs.rmSync(path.join(dirPath, name), { recursive: true, force: true }); } catch (_) {}
      });
    } catch (_) {}
    return before;
  }

  ipcMain.handle('list-bookmark-backgrounds', async () => {
    try {
      const { dataBgDir, appBgDir } = ensureBookmarkBackgroundsDirs();
      const exts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);
      const files = [];
      const seen = new Set();
      // مرحله ۱۵: پوشهٔ نرم‌افزار اول است تا در نامِ تکراری، نسخهٔ
      // همراهِ نرم‌افزار برنده شود؛ پوشهٔ قدیمیِ dataDir، فقط برای
      // سازگاری خوانده می‌شود.
      for (const dir of [appBgDir, dataBgDir]) {
        if (!dir || !fs.existsSync(dir)) continue;
        let names = [];
        try { names = fs.readdirSync(dir); } catch (_) { continue; }
        for (const name of names) {
          const ext = path.extname(name).toLowerCase();
          if (!exts.has(ext)) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const full = path.join(dir, name);
          let size = 0;
          try {
            const st = fs.statSync(full);
            if (!st.isFile()) continue;
            size = st.size;
          } catch (_) { continue; }
          // سروِ تصویر از راهِ همان هندلرِ comic:// است
          // (شاخهٔ ?path=)؛ پس هیچ کانالِ تازه‌ای لازم نیست.
          files.push({ name, url: 'comic://media/?path=' + encodeURIComponent(full), size, source: dir === appBgDir ? 'app' : 'data' });
        }
      }
      return { success: true, files, dirs: { dataDir: dataBgDir, projectDir: appBgDir || '', appDir: appBgDir || '' } };
    } catch (err) {
      return { success: false, error: 'خواندنِ پوشهٔ تصاویرِ بوک‌مارک انجام نشد: ' + String((err && err.message) || err) };
    }
  });

  ipcMain.handle('open-bookmark-backgrounds-folder', async () => {
    try {
      const { appBgDir } = ensureBookmarkBackgroundsDirs();
      if (!appBgDir) return { success: false, error: 'پوشهٔ نرم‌افزار در دسترس نیست.' };
      const { shell } = require('electron');
      // مرحله ۱۴: openPath در صورتِ شکست، رشتهٔ خطا برمی‌گرداند و
      // استثنا نمی‌اندازد؛ نسخهٔ مرحلهٔ ۱۳، همین رشته را نادیده
      // می‌گرفت و همیشه موفقیت گزارش می‌کرد، پس شکست، بی‌صدا
      // می‌ماند. حالا خطا صریح برگردانده می‌شود تا استودیو آن را
      // با توست نشان بدهد. path.resolve هم مسیر را یکتا می‌کند.
      const resolved = path.resolve(appBgDir);
      const openErr = await shell.openPath(resolved);
      if (openErr) return { success: false, error: 'باز کردنِ پوشه انجام نشد: ' + String(openErr) };
      return { success: true, dir: resolved };
    } catch (err) {
      return { success: false, error: 'باز کردنِ پوشه انجام نشد: ' + String((err && err.message) || err) };
    }
  });

  // مرحله ۱۴: واردکنندهٔ مستقیمِ عکس به پوشهٔ bookmark-backgrounds —
  // بدونِ هیچ دیالوگِ ویندوز: مسیرها از درگ‌واندراپِ استودیو یا
  // انتخاب‌گرِ فایلِ وب می‌آیند. فقط فایل‌هایِ تصویریِ مجاز کپی
  // می‌شوند؛ نامِ تکراری با پسوندِ شماره‌دار یکتا می‌شود؛ مقصد،
  // از مرحله ۱۵، همیشه پوشهٔ همراهِ نرم‌افزار است.
  ipcMain.handle('import-bookmark-background-files', async (event, payload) => {
    try {
      const { appBgDir } = ensureBookmarkBackgroundsDirs();
      if (!appBgDir) return { success: false, error: 'پوشهٔ نرم‌افزار در دسترس نیست.' };
      const rawPaths = Array.isArray(payload && payload.paths) ? payload.paths : [];
      const exts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);
      const imported = [];
      const skipped = [];
      let count = 0;
      for (const raw of rawPaths) {
        if (count >= 100) { skipped.push({ path: String(raw || ''), reason: 'بیش از ۱۰۰ فایل در یک مرحله' }); continue; }
        count += 1;
        try {
          const src = typeof raw === 'string' ? raw.trim() : '';
          if (!src) { skipped.push({ path: '', reason: 'مسیرِ خالی' }); continue; }
          const st = fs.statSync(src);
          if (!st.isFile()) { skipped.push({ path: src, reason: 'فایل نیست' }); continue; }
          const ext = path.extname(src).toLowerCase();
          if (!exts.has(ext)) { skipped.push({ path: src, reason: 'پسوندِ تصویریِ مجاز نیست' }); continue; }
          const base = path.basename(src, ext).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'image';
          let name = base + ext;
          let n = 2;
          while (fs.existsSync(path.join(appBgDir, name))) { name = base + '-' + n + ext; n += 1; }
          fs.copyFileSync(src, path.join(appBgDir, name));
          imported.push({ name, url: 'comic://media/?path=' + encodeURIComponent(path.join(appBgDir, name)) });
        } catch (err) {
          skipped.push({ path: String(raw || ''), reason: String((err && err.message) || err) });
        }
      }
      return { success: true, imported, skipped, dir: appBgDir };
    } catch (err) {
      return { success: false, error: 'وارد کردنِ عکس‌ها انجام نشد: ' + String((err && err.message) || err) };
    }
  });

  // مرحله ۱۵: حذفِ یک عکس از پوشهٔ بوک‌مارک — اول پوشهٔ همراهِ
  // نرم‌افزار، بعد پوشهٔ قدیمیِ dataDir (سازگاری). نام، فقط
  // basename است تا هیچ مسیری از بیرون تزریق نشود؛ فقط پسوندهایِ
  // تصویریِ مجاز حذف می‌شوند.
  ipcMain.handle('delete-bookmark-background', async (event, payload) => {
    try {
      const rawName = typeof payload === 'string' ? payload : (payload && payload.name) || '';
      const name = path.basename(String(rawName || '').trim());
      if (!name || name === '.' || name === '..') return { success: false, error: 'نامِ فایل معتبر نیست.' };
      const ext = path.extname(name).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'].includes(ext)) {
        return { success: false, error: 'فقط فایل‌هایِ تصویری حذف می‌شوند.' };
      }
      const { appBgDir, dataBgDir } = ensureBookmarkBackgroundsDirs();
      for (const dir of [appBgDir, dataBgDir]) {
        if (!dir) continue;
        const full = path.join(dir, name);
        try {
          const st = fs.statSync(full);
          if (!st.isFile()) continue;
          fs.unlinkSync(full);
          return { success: true, name, dir };
        } catch (_) { continue; }
      }
      return { success: false, error: 'فایل در پوشهٔ بوک‌مارک پیدا نشد.' };
    } catch (err) {
      return { success: false, error: 'حذفِ عکس انجام نشد: ' + String((err && err.message) || err) };
    }
  });

  // مرحله ۱۵: خواندنِ تمپلیت‌هایِ همراهِ نرم‌افزار
  // (bookmark-presets.json) برای ادغام در بارگذاریِ تنظیمات.
  // نبودنِ فایل، یعنی هنوز تمپلیتی همراه نشده — خطا نیست.
  ipcMain.handle('get-app-bookmark-presets', async () => {
    try {
      const { appBgDir } = ensureBookmarkBackgroundsDirs();
      if (!appBgDir) return { success: false, error: 'پوشهٔ نرم‌افزار در دسترس نیست.' };
      const finalPath = path.join(appBgDir, 'bookmark-presets.json');
      if (!fs.existsSync(finalPath)) return { success: true, presets: [] };
      let parsed = null;
      try {
        parsed = JSON.parse(fs.readFileSync(finalPath, 'utf-8'));
      } catch (_) {
        return { success: false, error: 'فایلِ تمپلیت‌هایِ همراه، خراب است و نادیده گرفته شد.' };
      }
      const presets = Array.isArray(parsed && parsed.presets) ? parsed.presets : [];
      return { success: true, presets };
    } catch (err) {
      return { success: false, error: 'خواندنِ تمپلیت‌هایِ همراه انجام نشد: ' + String((err && err.message) || err) };
    }
  });

  // مرحله ۱۳: پاک‌سازیِ فقط کاورها — به هیچ کشِ دیگری دست
  // نمی‌زند (نه orig-backups، نه protected-cache، نه search-index).
  ipcMain.handle('clear-only-covers', async (event, payload) => {
    try {
      const preserveCustom = !(payload && payload.preserveCustom === false);
      const result = await executeDbRequest('CLEAR_ONLY_COVERS', { preserveCustom }, 60000);
      if (result && result.type === 'done') {
        return { success: true, clearedFiles: result.clearedFiles || 0, freedBytes: result.freedBytes || 0, keptCustom: result.keptCustom || 0 };
      }
      return { success: false, error: (result && result.message) || 'پاک‌سازیِ کاورها انجام نشد.' };
    } catch (err) {
      return { success: false, error: 'پاک‌سازیِ کاورها انجام نشد: ' + String((err && err.message) || err) };
    }
  });

  // مرحله ۱۳: پاک‌سازیِ فقط کش‌هایِ موقت — به پوشهٔ covers و
  // کاورهایِ کتابخانه دست نمی‌زند. orig-backups فقط وقتی پاک
  // می‌شود که کاربر در مودال، تیکش را زده باشد. توجه: اگر کتابی
  // باز است، استخراجِ موقتِ آن هم پاک می‌شود و کتاب باید دوباره
  // باز شود؛ مودال، همین را به کاربر می‌گوید.
  ipcMain.handle('clear-only-caches', async (event, payload) => {
    try {
      const includeOrigBackups = Boolean(payload && payload.includeOrigBackups);
      const dataDir = (app && app.comicDataDir) || process.env.COMIC_READER_DATA_DIR || '';
      const beforeTemp = dirSizeRecursive(typeof tempDir === 'string' ? tempDir : '');
      cleanupExtractedDiskCache('__FORCE_ALL__', true);
      const protectedCache = clearDirContentsSync(getProtectedCacheDir());
      const searchIndex = clearDirContentsSync(dataDir ? path.join(dataDir, 'search-index') : '');
      const origBackups = includeOrigBackups
        ? clearDirContentsSync(dataDir ? path.join(dataDir, 'orig-backups') : '')
        : { files: 0, bytes: 0 };
      const clearedFiles = beforeTemp.files + protectedCache.files + searchIndex.files + origBackups.files;
      const freedBytes = beforeTemp.bytes + protectedCache.bytes + searchIndex.bytes + origBackups.bytes;
      return {
        success: true,
        clearedFiles,
        freedBytes,
        breakdown: {
          extractedTemp: beforeTemp,
          protectedCache,
          searchIndex,
          origBackups,
        },
      };
    } catch (err) {
      return { success: false, error: 'پاک‌سازیِ کش‌ها انجام نشد: ' + String((err && err.message) || err) };
    }
  });

  // مرحله ۱۳: پیش‌نمایشِ هرس (فقط خواندن؛ هیچ چیز پاک نمی‌شود)
  // تا مودال، تعدادِ دقیق را پیش از تأیید نشان بدهد.
  ipcMain.handle('preview-prune-missing-files', async () => {
    try {
      const result = await executeDbRequest('PREVIEW_PRUNE_MISSING_FILES', {}, 60000);
      if (result && result.type === 'done') {
        return {
          success: true,
          removed: Array.isArray(result.removed) ? result.removed : [],
          skipped: Array.isArray(result.skipped) ? result.skipped : [],
          removedCount: result.removedCount || 0,
          skippedCount: result.skippedCount || 0,
          coverFilesDeleted: result.coverFilesDeleted || 0,
          coverBytesFreed: result.coverBytesFreed || 0,
        };
      }
      return { success: false, error: (result && result.message) || 'پیش‌نمایشِ هرس انجام نشد.' };
    } catch (err) {
      return { success: false, error: 'پیش‌نمایشِ هرس انجام نشد: ' + String((err && err.message) || err) };
    }
  });

  ipcMain.handle('prune-missing-files', async () => {
    try {
      const result = await executeDbRequest('PRUNE_MISSING_FILES', {}, 60000);
      if (result && result.type === 'done') {
        return {
          success: true,
          removed: Array.isArray(result.removed) ? result.removed : [],
          skipped: Array.isArray(result.skipped) ? result.skipped : [],
          removedCount: result.removedCount || 0,
          skippedCount: result.skippedCount || 0,
          coverFilesDeleted: result.coverFilesDeleted || 0,
          coverBytesFreed: result.coverBytesFreed || 0,
        };
      }
      return { success: false, error: (result && result.message) || 'هرسِ فایل‌های حذف‌شده انجام نشد.' };
    } catch (err) {
      return { success: false, error: 'هرسِ فایل‌های حذف‌شده انجام نشد: ' + String((err && err.message) || err) };
    }
  });

  ipcMain.handle('save-rebuilt-pdf', async (event, payload) => {
    try {
      const { pdfPath, base64, pdfBytes, mode, expectedPageCount } = payload || {};
      const normalizedMode = mode === 'in-place' ? 'in-place' : (mode === 'copy' ? 'copy' : 'save-as');
      if (!pdfPath || typeof pdfPath !== 'string' || !fs.existsSync(pdfPath)) {
        return { success: false, error: 'فایل PDF پیدا نشد.' };
      }
      if (path.extname(pdfPath).toLowerCase() !== '.pdf') {
        return { success: false, error: 'فقط فایل‌های PDF قابلِ بازسازی‌اند.' };
      }
      // مرحلهٔ ۳۲ — ورودیِ باینری (Uint8Array از structured clone)
      // اولویت دارد؛ base64 فقط برایِ سازگاریِ عقب‌رو مانده است.
      let bytes = null;
      if (pdfBytes instanceof Uint8Array && pdfBytes.length > 0) {
        // معادلِ سقفِ قبلیِ رشته (۵۰۰ میلیون کاراکترِ base64 ≈ ۳۷۵ مگابایت).
        if (pdfBytes.length > 375000000) {
          return { success: false, error: 'دادهٔ PDFِ بازسازی‌شده معتبر نیست.' };
        }
        bytes = Buffer.from(pdfBytes);
      } else if (typeof base64 === 'string' && base64.length > 0 && base64.length <= 500000000) {
        bytes = Buffer.from(base64, 'base64');
      } else {
        return { success: false, error: 'دادهٔ PDFِ بازسازی‌شده معتبر نیست.' };
      }
      if (bytes.length <= 5 || bytes.slice(0, 5).toString('ascii') !== '%PDF-') {
        return { success: false, error: 'خروجیِ بازسازی‌شده، یک فایلِ PDF معتبر نیست.' };
      }
      let saver;
      try { saver = require('./services/pdfAnnotationSaver'); } catch (_) {
        return { success: false, error: 'ماژولِ خروجیِ PDF (pdfAnnotationSaver.js) پیدا نشد.' };
      }
      let saveLogger = null;
      try { saveLogger = getIpcLogger(); } catch (_) { saveLogger = null; }
      const validation = await saver.validateSavedPdfBytes(bytes, expected, saveLogger, 0);
      if (!validation || !validation.ok) {
        return { success: false, error: (validation && validation.reason) || 'راستی‌آزماییِ فایلِ بازسازی‌شده انجام نشد.' };
      }
      let outputPath = null;
      if (normalizedMode === 'in-place') {
        outputPath = pdfPath;
      } else if (normalizedMode === 'copy') {
        // مرحله ۱۱: نام/مسیرِ دلخواهِ کاربر (از مودالِ محافظت) با
        // همان حلقهٔ شماره‌دار؛ در غیابِ آن، نامِ خودکار.
        outputPath = resolveCopyOutputPath(pdfPath, payload && payload.desiredName, payload && payload.desiredPath);
        if (!outputPath) {
          return { success: false, error: 'نامِ مناسبی برای نسخهٔ کپی پیدا نشد؛ پوشهٔ فایل را خلوت کنید و دوباره تلاش کنید.' };
        }
      } else {
        const baseName = path.basename(pdfPath, path.extname(pdfPath));
        const defaultName = baseName + '-annotated.pdf';
        const win = getWindowFromEvent(event);
        const dialogOptions = {
          title: 'ذخیره PDF بازسازی‌شده با حاشیه‌نویسی‌ها',
          defaultPath: path.join(path.dirname(pdfPath), defaultName),
          filters: [{ name: 'PDF (*.pdf)', extensions: ['pdf'] }],
        };
        const { canceled, filePath: chosenPath } = win
          ? await dialog.showSaveDialog(win, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions);
        if (canceled || !chosenPath) return { success: false, canceled: true };
        outputPath = chosenPath;
        if (path.extname(outputPath).toLowerCase() !== '.pdf') outputPath += '.pdf';
      }
      const dataDir = (app && app.comicDataDir) || process.env.COMIC_READER_DATA_DIR || '';
      let backupCreated = false;
      if (normalizedMode === 'in-place') {
        closeComicReadStreams(app, pdfPath);
        const ensured = ensureRelocatedOrigBackup(pdfPath, dataDir);
        backupCreated = Boolean(ensured && ensured.created);
      }
      try {
        await atomicWriteBuffer(outputPath, bytes);
      } catch (err) {
        if (err && err.code === 'FILE_LOCKED') {
          return { success: false, locked: true, error: err.message };
        }
        throw err;
      }
      if (normalizedMode === 'in-place') {
        invalidateComicRamCache(app, pdfPath);
      }
      // مرحله ۱۱: ایندکسِ جستجویِ کناری، بهترین‌تلاش و هرگز
      // مانعِ موفقیتِ ذخیره نمی‌شود.
      const searchIndexSaved = writeSearchIndexFile(outputPath, payload && payload.searchIndex);
      return { success: true, outputPath, mode: normalizedMode, pageCount: expected, backupCreated, searchIndexSaved };
    } catch (err) {
      if (err && err.code === 'FILE_LOCKED') {
        return { success: false, locked: true, error: err.message };
      }
      try { const lg = getIpcLogger(); if (lg) lg.error('save-rebuilt-pdf failed', err); } catch (_) {}
      return { success: false, error: 'ذخیرهٔ فایلِ بازسازی‌شده انجام نشد: ' + String((err && err.message) || err) };
    }
  });

  // مرحله ۱۱: دیالوگِ استانداردِ انتخابِ نام و پوشهٔ نسخهٔ کپی
  // (از مودالِ فایلِ محافظت‌شده در TopBar).
  ipcMain.handle('choose-copy-save-path', async (event, payload) => {
    try {
      const filePath = payload && payload.filePath;
      const defaultName = payload && typeof payload.defaultName === 'string' && payload.defaultName
        ? payload.defaultName
        : 'copy-editable.pdf';
      if (!filePath || typeof filePath !== 'string') return { canceled: true };
      const win = getWindowFromEvent(event);
      const dialogOptions = {
        title: 'انتخابِ نام و محلِ ذخیرهٔ نسخهٔ کپی',
        defaultPath: path.join(path.dirname(filePath), defaultName),
        filters: [{ name: 'PDF (*.pdf)', extensions: ['pdf'] }],
      };
      const { canceled, filePath: chosenPath } = win
        ? await dialog.showSaveDialog(win, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);
      if (canceled || !chosenPath) return { canceled: true };
      let out = chosenPath;
      if (path.extname(out).toLowerCase() !== '.pdf') out += '.pdf';
      return { canceled: false, filePath: out };
    } catch (err) {
      try { const lg = getIpcLogger(); if (lg) lg.error('choose-copy-save-path failed', err); } catch (_) {}
      return { canceled: true };
    }
  });

  // مرحله ۱۱: خواندنِ ایندکسِ جستجویِ کناریِ یک فایلِ بازسازی‌شده.
  ipcMain.handle('get-search-index', async (event, payload) => {
    try {
      const filePath = payload && payload.filePath;
      if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) return { found: false };
      const indexPath = searchIndexPathFor(filePath);
      if (!fs.existsSync(indexPath)) return { found: false };
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (!parsed || parsed.version !== 1 || !parsed.pages || typeof parsed.pages !== 'object') return { found: false };
      return { found: true, index: parsed };
    } catch (_) {
      return { found: false };
    }
  });

  ipcMain.handle('change-data-directory', async (event, payload) => {
    try {
      const { writeCustomDataDirConfig } = require('./logger');
      if (app && app.isPortableMode) {
        return { success: false, error: 'در حالتِ Portable، محلِ ذخیرهٔ اطلاعات ثابت است و قابلِ تغییر نیست.' };
      }
      const currentDir = (app && app.comicDataDir) || process.env.COMIC_READER_DATA_DIR || '';
      if (!currentDir) return { success: false, error: 'مسیرِ فعلیِ داده مشخص نیست.' };
      const mode = payload && payload.mode === 'reset' ? 'reset' : 'choose';
      if (mode === 'reset') {
        const res = writeCustomDataDirConfig(null);
        if (!res || !res.success) return { success: false, error: (res && res.error) || 'بازگشت به مسیرِ پیش‌فرض انجام نشد.' };
        scheduleDataDirRelaunch();
        return { success: true, restarting: true, customDataDir: null };
      }
      const win = getWindowFromEvent(event);
      const dialogOptions = {
        title: 'انتخابِ محلِ ذخیرهٔ اطلاعاتِ برنامه',
        properties: ['openDirectory', 'createDirectory'],
      };
      const dlg = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      if (dlg.canceled || !dlg.filePaths || !dlg.filePaths[0]) return { success: false, canceled: true };
      const target = path.normalize(String(dlg.filePaths[0]));
      const normCurrent = path.normalize(currentDir);
      const samePath = (a, b) => a.toLowerCase() === b.toLowerCase();
      if (samePath(target, normCurrent)) {
        return { success: false, error: 'همین مسیر، الان محلِ ذخیرهٔ اطلاعات است.' };
      }
      if (path.parse(target).root === target) {
        return { success: false, error: 'ریشهٔ درایو را نمی‌توان محلِ ذخیرهٔ اطلاعات کرد؛ یک پوشه انتخاب کنید.' };
      }
      try {
        const osMod = require('os');
        if (samePath(target, path.normalize(osMod.homedir()))) {
          return { success: false, error: 'پوشهٔ خانهٔ کاربر را نمی‌توان محلِ ذخیرهٔ اطلاعات کرد؛ یک پوشهٔ دیگر انتخاب کنید.' };
        }
      } catch (_) {}
      if (isPathInsidePath(target, normCurrent) || isPathInsidePath(normCurrent, target)) {
        return { success: false, error: 'مسیرِ جدید نباید داخلِ مسیرِ فعلی (یا برعکس) باشد.' };
      }
      // ساختِ پوشه + آزمونِ نوشتن، پیش از هر جابه‌جایی.
      try {
        fs.mkdirSync(target, { recursive: true });
        const probeFile = path.join(target, '.comic-reader-write-test');
        fs.writeFileSync(probeFile, 'ok', 'utf8');
        fs.unlinkSync(probeFile);
      } catch (err) {
        return { success: false, error: 'پوشهٔ انتخاب‌شده قابلِ نوشتن نیست: ' + String((err && err.message) || err) };
      }
      if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
        return { success: false, error: 'پوشهٔ انتخاب‌شده خالی نیست؛ پوشه‌ای خالی (یا تازه) انتخاب کنید.' };
      }
      await flushAndTerminateDbWorker();
      let moved;
      try {
        moved = moveDataDirectory(normCurrent, target);
      } catch (err) {
        return { success: false, error: String((err && err.message) || err) };
      }
      const written = writeCustomDataDirConfig(target);
      if (!written || !written.success) {
        // پیکربندی نوشته نشد: جابه‌جایی را برگردان تا برنامه با
        // مسیرِ قدیمی بالا بیاید و داده، گم نشود.
        try { moveDataDirectory(target, normCurrent); } catch (_) {}
        return { success: false, error: (written && written.error) || 'ذخیرهٔ مسیرِ جدید انجام نشد؛ جابه‌جایی برگردانده شد.' };
      }
      scheduleDataDirRelaunch();
      return { success: true, restarting: true, customDataDir: target, movedFiles: moved.files, movedBytes: moved.bytes };
    } catch (err) {
      try { const lg = getIpcLogger(); if (lg) lg.error('change-data-directory failed', err); } catch (_) {}
      return { success: false, error: 'تغییرِ محلِ ذخیرهٔ اطلاعات انجام نشد: ' + String((err && err.message) || err) };
    }
  });

  ipcMain.on('window-close', (event) => {
    const win = getWindowFromEvent(event);
    if (win) win.close();
  });
  ipcMain.on('window-minimize', (event) => {
    const win = getWindowFromEvent(event);
    if (win) win.minimize();
  });
  ipcMain.on('window-maximize', (event) => {
    const win = getWindowFromEvent(event);
    if (win) {
      win.isMaximized() ? win.unmaximize() : win.maximize();
    }
  });

};