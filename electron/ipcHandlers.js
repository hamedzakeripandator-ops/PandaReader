const { ipcMain, dialog, shell, clipboard, nativeImage, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const directoryService = require('./services/directoryService');

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
let dbRequestSeq = 0;
const pendingDbCallbacks = new Map();

function ensurePersistentDbWorker() {
  if (persistentDbWorker) return persistentDbWorker;

  const workerPath = path.join(__dirname, 'workers', 'database.js');
  if (!fs.existsSync(workerPath)) return null;

  try {
    persistentDbWorker = new Worker(workerPath);

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
    });

    persistentDbWorker.on('exit', (code) => {
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
    return null;
  }
}

function executeDbAction(action, payload) {
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
        resolve({ type: 'error', message: 'مهلت زمانی ورکر دیتابیس به پایان رسید (Timeout 5000ms)' });
      }
    }, 5000);

    pendingDbCallbacks.set(reqId, { resolve, timer });
    worker.postMessage({ reqId, action, payload });
  });
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
    const worker = persistentDbWorker;
    if (!worker) return;
    event.preventDefault();
    let finished = false;
    const finishQuit = () => {
      if (finished) return;
      finished = true;
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
          if (cachedCov?.cover && cachedCov.cover.startsWith('data:')) {
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
          if (cachedCov?.cover && cachedCov.cover.startsWith('data:')) {
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
            if (cachedCov?.cover && cachedCov.cover.startsWith('data:')) {
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
      if (cachedRes?.cover && cachedRes.cover.startsWith('data:')) {
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