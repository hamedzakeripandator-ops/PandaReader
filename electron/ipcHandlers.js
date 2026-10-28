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

      const terminateWorker = () => {
        if (!isSettled) {
          isSettled = true;
          activeExtractionContext = null;
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
        const onSenderDestroyed = () => {
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
    return await executeDbAction(action, payload);
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
      const { pdfPath, pages, mode } = payload || {};
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

      let saver;
      try {
        saver = require('./services/pdfAnnotationSaver');
      } catch (_) {
        return { success: false, error: 'ماژولِ خروجیِ PDF (pdfAnnotationSaver.js) پیدا نشد؛ فایل را در پوشهٔ electron/services قرار دهید.' };
      }
      // مرحله ۶ ـ بخش ب: بستنِ استریم‌ها باید *پیش* از نوشتن
      // انجام شود، نه فقط پس از آن (invalidate پس از ذخیره)؛ وگرنه
      // در اولین ذخیرهٔ درجا — وقتی هنوز .orig.bakای نیست و comic://
      // مستقیم روی pdfPath استریم دارد — پنجرهٔ قفلِ ویندوز باز
      // می‌ماند. پس از ساخته‌شدنِ .orig.bak، استریم‌های بعدی دیگر
      // روی pdfPath باز نمی‌شوند و این فراخوانی، عملاً بی‌اثر است.
      if (normalizedMode === 'in-place') {
        closeComicReadStreams(app, pdfPath);
      }
      const result = await saver.saveAnnotatedPdf({ pdfPath, pages, outputPath: finalPath, mode: normalizedMode });
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