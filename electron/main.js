// افزایش ظرفیت تردپول I/O موتور Node.js پیش از بارگذاری کامل
process.env.UV_THREADPOOL_SIZE = '8';

const { app, BrowserWindow, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

// ۱. تنظیم سوییچ‌های شتاب‌نگاشت سخت‌افزاری کرومیوم، تردهای رستر موازی و حذف لاگ‌های مزاحم
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,Autofill,Translate');
app.commandLine.appendSwitch('log-level', '3');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('num-raster-threads', '4');
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,underlay');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,CanvasOopif');

// ثبت پروتکل سفارشی comic:// با تمامی امتیازات استریم، واکشی امن و دسترسی استاندارد
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'comic',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

let mainWindow;

// مرحله ۱ ـ بخش الف: قفلِ تک‌نمونه‌ای.
// بدونِ این قفل، اجرای دومِ برنامه یک پروسهٔ دوم با ورکرِ دیتابیسِ
// جدا می‌ساخت و هر دو پروسه روی یک db.json می‌نوشتند. اگر قفل گرفته
// نشد، این پروسه بلافاصله خارج می‌شود؛ app.quit() پیش از ready، جلوی
// شلیکِ whenReady را می‌گیرد، پس پنجره و ورکری ساخته نمی‌شود (و
// createWindow هم برای اطمینان، همین شرط را چک می‌کند).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    // اگر نمونهٔ دوم با یک فایل (مثلاً یک کمیک یا PDF) باز شده بود،
    // مسیرش را به پنجرهٔ موجود اطلاع بده تا در فازهای بعد، همان‌جا
    // باز شود؛ امروز، رندرر هنوز شنونده‌ای برای این رویداد ندارد و
    // پیام، بی‌اثر دریافت می‌شود (نه خطا).
    const fileArg = (commandLine || []).slice(1).find((arg) => {
      return arg && !arg.startsWith('-') && /\.(zip|cbz|cbr|rar|7z|pdf)$/i.test(arg);
    });
    if (fileArg) {
      try { mainWindow.webContents.send('second-instance-file', fileArg); } catch (_) {}
    }
  });
}

// مخزن بافر مقیم در حافظه رم کمیک فعال با سقف ایمن ۳۵۰ مگابایت (LRU Eviction)
const MAX_RAM_CACHE_BYTES = 350 * 1024 * 1024;
// سقف مجاز کش شدن مستقیم فایل PDF در رم (۱۲۰ مگابایت)؛ فایل‌های بزرگ‌تر مستقیماً استریم می‌شوند
const MAX_PDF_RAM_CACHE_BYTES = 120 * 1024 * 1024;
let currentRamCacheBytes = 0;

app.activeComicRamCache = new Map();
app.inFlightDiskReads = new Map();

app.normalizeComicCacheKey = (rawPath) => {
  if (!rawPath || typeof rawPath !== 'string') return '';
  return path.normalize(rawPath).toLowerCase();
};

app.setComicPageInRam = (rawPath, buffer) => {
  if (!rawPath || !buffer || !Buffer.isBuffer(buffer)) return;
  const key = app.normalizeComicCacheKey(rawPath);
  if (!key) return;

  if (app.activeComicRamCache.has(key)) {
    const oldBuf = app.activeComicRamCache.get(key);
    currentRamCacheBytes -= oldBuf ? oldBuf.length : 0;
    app.activeComicRamCache.delete(key);
  }

  // اگر فایل به‌تنهایی از کل ظرفیت کش بزرگ‌تر است، در رم نگه ندار
  if (buffer.length > MAX_RAM_CACHE_BYTES) return;

  while (currentRamCacheBytes + buffer.length > MAX_RAM_CACHE_BYTES && app.activeComicRamCache.size > 0) {
    const oldestKey = app.activeComicRamCache.keys().next().value;
    const oldestBuf = app.activeComicRamCache.get(oldestKey);
    currentRamCacheBytes -= oldestBuf ? oldestBuf.length : 0;
    app.activeComicRamCache.delete(oldestKey);
  }

  app.activeComicRamCache.set(key, buffer);
  currentRamCacheBytes += buffer.length;
};

app.readComicPageToRam = async (rawPath) => {
  const normalizedPath = path.normalize(rawPath);
  const key = app.normalizeComicCacheKey(normalizedPath);

  if (app.activeComicRamCache.has(key)) {
    const buf = app.activeComicRamCache.get(key);
    // ارتقای موقعیت در LRU
    app.activeComicRamCache.delete(key);
    app.activeComicRamCache.set(key, buf);
    return buf;
  }

  if (app.inFlightDiskReads.has(key)) {
    return await app.inFlightDiskReads.get(key);
  }

  const diskReadPromise = fs.promises.readFile(normalizedPath)
    .then((buf) => {
      app.setComicPageInRam(normalizedPath, buf);
      app.inFlightDiskReads.delete(key);
      return buf;
    })
    .catch((err) => {
      app.inFlightDiskReads.delete(key);
      throw err;
    });

  app.inFlightDiskReads.set(key, diskReadPromise);
  return await diskReadPromise;
};

// تجزیه استاندارد هدر Range برای پشتیبانی از 206 Partial Content در فایل‌های PDF
function parseByteRange(rangeHeader, totalSize) {
  if (!rangeHeader || typeof rangeHeader !== 'string' || totalSize <= 0) return null;
  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return null;

  const startStr = match[1];
  const endStr = match[2];

  let start = startStr ? parseInt(startStr, 10) : 0;
  let end = endStr ? parseInt(endStr, 10) : totalSize - 1;

  if (!startStr && endStr) {
    // حالت suffix-byte-range-spec (مثلاً bytes=-500 برای خواندن انتهای PDF)
    const suffixLength = parseInt(endStr, 10);
    if (isNaN(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  }

  if (isNaN(start) || isNaN(end) || start < 0 || start >= totalSize) {
    return null;
  }

  end = Math.min(end, totalSize - 1);
  if (start > end) return null;

  return { start, end, chunkSize: end - start + 1 };
}

// ایجاد استریم وب ایمن از روی دیسک با بستن خودکار هندل فایل در صورت لغو درخواست
function createSafeWebFileStream(filePath, options, abortSignal) {
  const nodeStream = fs.createReadStream(filePath, options);

  if (abortSignal) {
    if (abortSignal.aborted) {
      nodeStream.destroy();
    } else {
      abortSignal.addEventListener(
        'abort',
        () => {
          try {
            nodeStream.destroy();
          } catch (_) {}
        },
        { once: true }
      );
    }
  }

  return Readable.toWeb(nodeStream);
}

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf'
};

function createWindow() {
  // نمونهٔ دوم، هرگز پنجره نمی‌سازد (نگهبانِ دومِ قفلِ تک‌نمونه‌ای).
  if (!gotSingleInstanceLock) return;
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0a0f13',
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
      allowRunningInsecureContent: true,
      plugins: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  // مرحله ۱ ـ بخش الف: هندلرِ ایمنِ did-fail-load.
  // قبلاً اگر سرورِ توسعه (Vite) بالا نبود، فقط صفحهٔ سفیدِ
  // ERR_CONNECTION_REFUSED دیده می‌شد. حالا به‌جای آن، یک صفحهٔ
  // خطای فارسی با دکمهٔ «تلاش مجدد» نشان داده می‌شود؛ خطای -3
  // (لغوِ ناوبری، مثلاً با ناوبریِ جدید) نادیده گرفته می‌شود تا حلقه
  // نسازد، و خطاهای فریم‌های فرعی هم صفحه را عوض نمی‌کنند.
  // (شنوندهٔ قبلیِ devtools-opened که console.clear می‌کرد، عمداً
  // حذف شد تا لاگ‌های حیاتیِ دیباگ پاک نشوند.)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const devUrl = 'http://localhost:5173';
    const safeDesc = String(errorDescription || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const errorHtml = '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8">'
      + '<title>خطا در بارگذاری</title>'
      + '<style>body{margin:0;background:#0a0f13;color:#e5e7eb;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}main{text-align:center;max-width:480px;padding:24px}h1{font-size:20px}p{color:#9ca3af;line-height:2}button{margin-top:16px;padding:10px 24px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:#111827;color:#fff;font-size:15px;cursor:pointer}button:hover{background:#1f2937}</style></head>'
      + '<body><main><h1>برنامه نتوانست بارگذاری شود</h1>'
      + '<p>سرورِ توسعه (Vite) در دسترس نیست. مطمئن شوید <b>npm run dev</b> در حال اجراست، بعد دوباره تلاش کنید.</p>'
      + '<p style="font-size:12px;direction:ltr">' + String(errorCode) + ' — ' + safeDesc + '</p>'
      + '<button onclick="window.location.href=' + "'" + devUrl + "'" + '">تلاش مجدد</button></main></body></html>';
    mainWindow.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
  });

  mainWindow.loadURL('http://localhost:5173');
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  app.on('comic-cache-clear', () => {
    if (app.activeComicRamCache) {
      app.activeComicRamCache.clear();
    }
    if (app.inFlightDiskReads) {
      app.inFlightDiskReads.clear();
    }
    currentRamCacheBytes = 0;
  });

  protocol.handle('comic', async (request) => {
    try {
      const rawUrl = request.url;
      let targetFilePath = null;

      try {
        const parsedUrl = new URL(rawUrl);
        targetFilePath = parsedUrl.searchParams.get('path');
        if (!targetFilePath && parsedUrl.pathname && parsedUrl.pathname !== '/') {
          targetFilePath = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ''));
        }
      } catch (_) {
        const match = rawUrl.match(/[?&]path=([^&]+)/);
        if (match && match[1]) {
          targetFilePath = decodeURIComponent(match[1]);
        }
      }

      if (!targetFilePath) {
        return new Response('Path parameter is missing', { status: 400 });
      }

      const normalizedPath = path.normalize(targetFilePath);
      const ext = path.extname(normalizedPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      // ۱. پایپ‌لاین فوق‌سریع اختصاصی برای اسناد و کتاب‌های PDF (پشتیبانی از کش رم + Range Requests)
      if (ext === '.pdf') {
        const stat = await fs.promises.stat(normalizedPath);
        const totalSize = stat.size;
        const rangeHeader = request.headers.get('range') || request.headers.get('Range');

        const basePdfHeaders = {
          'Content-Type': 'application/pdf',
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600'
        };

        if (request.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: {
              ...basePdfHeaders,
              'Content-Length': totalSize.toString()
            }
          });
        }

        const parsedRange = parseByteRange(rangeHeader, totalSize);
        const cacheKey = app.normalizeComicCacheKey(normalizedPath);
        const cachedPdfBuf = app.activeComicRamCache.get(cacheKey);

        // الف) اگر درخواست Range (بایت‌های خاص) ارسال شده باشد
        if (parsedRange) {
          const { start, end, chunkSize } = parsedRange;
          const rangeHeaders = {
            ...basePdfHeaders,
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            'Content-Length': chunkSize.toString()
          };

          if (cachedPdfBuf) {
            return new Response(cachedPdfBuf.subarray(start, end + 1), {
              status: 206,
              headers: rangeHeaders
            });
          }

          const webStream = createSafeWebFileStream(
            normalizedPath,
            { start, end, highWaterMark: 256 * 1024 },
            request.signal
          );
          return new Response(webStream, {
            status: 206,
            headers: rangeHeaders
          });
        }

        // ب) درخواست کامل فایل PDF: برای فایل‌های تا ۱۲۰ مگابایت از کش رم ادغام‌شده استفاده کن
        if (totalSize <= MAX_PDF_RAM_CACHE_BYTES) {
          const pdfBuffer = await app.readComicPageToRam(normalizedPath);
          return new Response(pdfBuffer, {
            status: 200,
            headers: {
              ...basePdfHeaders,
              'Content-Length': pdfBuffer.length.toString()
            }
          });
        }

        // ج) برای کتاب‌های PDF بسیار حجیم (بالای ۱۲۰ مگابایت)، استریم مستقیم با بافر ۵۱۲ کیلوبایتی
        const fullWebStream = createSafeWebFileStream(
          normalizedPath,
          { highWaterMark: 512 * 1024 },
          request.signal
        );
        return new Response(fullWebStream, {
          status: 200,
          headers: {
            ...basePdfHeaders,
            'Content-Length': totalSize.toString()
          }
        });
      }

      // ۲. پایپ‌لاین صفحات تصویری کمیک (تحویل مستقیم از رم در ۰ میلی‌ثانیه)
      const buffer = await app.readComicPageToRam(normalizedPath);

      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': buffer.length.toString(),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes'
        }
      });
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return new Response('File not found', { status: 404 });
      }
      console.error('Comic protocol critical error:', error);
      return new Response('Internal Protocol Error: ' + error.message, { status: 500 });
    }
  });

  require('./ipcHandlers')(app);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});