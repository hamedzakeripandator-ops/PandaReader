// افزایش ظرفیت تردپول I/O موتور Node.js پیش از بارگذاری کامل
process.env.UV_THREADPOOL_SIZE = '8';

const { app, BrowserWindow, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
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

// مرحله ۲ ـ بخش الف: ورودی‌های کشِ رم حالا متادیتا هم دارند
// ({buffer, mtimeMs, size, validated}) تا جایگزینیِ فایل در همان
// مسیر، با بافرِ کهنه سرو نشود. ورودی‌های بدونِ متادیتا (مثلاً
// کاورِ صفحهٔ اول که ipcHandlers با setComicPageInRam می‌گذارد)
// «اعتبارسنجی‌نشده» (validated: false) اند و همان‌طور که هستند
// برگردانده می‌شوند؛ فقط ورودی‌های اعتبارسنجی‌شده با stat مقایسه
// می‌شوند. این تفکیک، رفتارِ قبلیِ کاور را حفظ می‌کند و در عینِ حال
// جلوی سروِ بافرِ کهنه برای فایل‌های جایگزین‌شده را می‌گیرد.
app.setComicPageInRam = (rawPath, buffer, meta = null) => {
  if (!rawPath || !buffer || !Buffer.isBuffer(buffer)) return;
  const key = app.normalizeComicCacheKey(rawPath);
  if (!key) return;

  if (app.activeComicRamCache.has(key)) {
    const oldEntry = app.activeComicRamCache.get(key);
    const oldLen = oldEntry && oldEntry.buffer ? oldEntry.buffer.length : 0;
    currentRamCacheBytes -= oldLen;
    app.activeComicRamCache.delete(key);
  }

  // اگر فایل به‌تنهایی از کل ظرفیت کش بزرگ‌تر است، در رم نگه ندار
  if (buffer.length > MAX_RAM_CACHE_BYTES) return;

  while (currentRamCacheBytes + buffer.length > MAX_RAM_CACHE_BYTES && app.activeComicRamCache.size > 0) {
    const oldestKey = app.activeComicRamCache.keys().next().value;
    const oldestEntry = app.activeComicRamCache.get(oldestKey);
    currentRamCacheBytes -= oldestEntry && oldestEntry.buffer ? oldestEntry.buffer.length : 0;
    app.activeComicRamCache.delete(oldestKey);
  }

  app.activeComicRamCache.set(key, {
    buffer,
    mtimeMs: meta && typeof meta.mtimeMs === 'number' ? meta.mtimeMs : null,
    size: meta && typeof meta.size === 'number' ? meta.size : buffer.length,
    validated: Boolean(meta)
  });
  currentRamCacheBytes += buffer.length;
};

app.readComicPageToRam = async (rawPath) => {
  const normalizedPath = path.normalize(rawPath);
  const key = app.normalizeComicCacheKey(normalizedPath);

  if (app.activeComicRamCache.has(key)) {
    const entry = app.activeComicRamCache.get(key);
    const buf = entry && entry.buffer ? entry.buffer : null;
    if (entry && entry.validated) {
      // ورودیِ اعتبارسنجی‌شده فقط وقتی معتبر است که فایل روی دیسک
      // همان mtime و size را داشته باشد؛ وگرنه کهنه است و دوباره
      // خوانده می‌شود.
      try {
        const stat = await fs.promises.stat(normalizedPath);
        if (entry.mtimeMs === stat.mtimeMs && entry.size === stat.size) {
          // ارتقای موقعیت در LRU
          app.activeComicRamCache.delete(key);
          app.activeComicRamCache.set(key, entry);
          return buf;
        }
      } catch (_) {}
      // کهنه یا غیرقابلِ stat: ورودی را دور بینداز تا خواندنِ دیسک
      // در ادامه، بافرِ تازه (یا خطای واقعی) را برگرداند.
      // مرحله ۲ ـ بخش ب: کم‌کردن فقط وقتی که delete واقعاً حذف کرده
      // باشد؛ بین get و delete یک await (stat) هست و دو درخواستِ
      // هم‌زمان می‌توانستند یک ورودی را دو بار کم کنند.
      if (app.activeComicRamCache.delete(key)) {
        currentRamCacheBytes -= buf ? buf.length : 0;
      }
    } else {
      // ورودیِ اعتبارسنجی‌نشده (مثل کاورِ ipcHandlers) بدونِ چک
      // برگردانده می‌شود؛ رفتارِ قبلی حفظ می‌شود.
      app.activeComicRamCache.delete(key);
      app.activeComicRamCache.set(key, entry);
      return buf;
    }
  }

  if (app.inFlightDiskReads.has(key)) {
    return await app.inFlightDiskReads.get(key);
  }

  const diskReadPromise = fs.promises.readFile(normalizedPath)
    .then(async (buf) => {
      let meta = null;
      try {
        const stat = await fs.promises.stat(normalizedPath);
        meta = { mtimeMs: stat.mtimeMs, size: stat.size };
      } catch (_) {}
      app.setComicPageInRam(normalizedPath, buf, meta);
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
// مرحله ۲ ـ بخش ب: سه‌حالته شد — null یعنی «Range نیست یا قابلِ
// چشم‌پوشی است» (پاسخِ کامل)، {start,end} یعنی بازهٔ معتبر، و
// {invalid:true} یعنی نحو درست ولی برآورده‌نشدنی (پاسخِ 416).
// نکته‌های RFC که رعایت شده: end بزرگ‌تر از فایل، clamp می‌شود
// (نه 416)؛ بازهٔ باز (bytes=0- یا bytes=65536-) تا انتهای فایل
// ادامه دارد؛ start>=size یا start>end یا suffix<=0 یعنی 416؛
// نحوِ کاملاً خراب (مثلاً bytes=abc) نادیده گرفته می‌شود و پاسخِ
// کامل برمی‌گردد، چون سرور موظف نیست آن را بفهمد.
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
    if (isNaN(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  }

  if (isNaN(start) || isNaN(end) || start < 0 || start >= totalSize) {
    return { invalid: true };
  }

  end = Math.min(end, totalSize - 1);
  if (start > end) return { invalid: true };

  return { start, end, chunkSize: end - start + 1 };
}

// ایجاد استریم وب ایمن از روی دیسک با بستن خودکار هندل فایل در صورت لغو درخواست
// مرحله ۲ ـ بخش ب (ممیزیِ نشتِ fd): علاوه بر abort، خطای استریم هم
// صریحاً destroy می‌شود. Readable.toWeb خطا را به وب‌استریم منتقل
// می‌کند، ولی destroy صریح تضمین می‌کند که هندلِ فایل روی ویندوز
// باز نماند، حتی اگر مصرف‌کنندهٔ وب‌استریم دیگر گوش ندهد.
function createSafeWebFileStream(filePath, options, abortSignal) {
  const nodeStream = fs.createReadStream(filePath, options);
  nodeStream.on('error', () => {
    try { nodeStream.destroy(); } catch (_) {}
  });

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

// مرحله ۲ ـ بخش الف: پسوندهای مجازِ پروتکل comic:// (Default-Deny).
// فقط همین‌ها سرو می‌شوند: آرشیوهای کمیک، PDF و تصاویر (از جمله
// svg، چون کاورِ سفارشیِ SVG امروز کار می‌کند و در این برنامه فقط
// در بسترِ <img> رندر می‌شود، نه به‌عنوانِ سند).
// عمداً فایل‌های بدونِ پسوند سرو نمی‌شوند.
// توجه: این allowlist، افشای فایل‌های تصویریِ دلخواهِ روی دیسک را
// به‌طورِ کامل نمی‌بندد (مسیرِ مطلقِ یک تصویر، هنوز با پسوندِ مجاز
// سرو می‌شود)؛ بستنِ کامل، به رجیستریِ «فایل‌های بازِ فعلی» نیاز
// دارد که کارِ فازِ بعد است — ولی فایل‌های سیستمی، اجرایی، دیتابیس
// و اسنادِ متنی از همین‌جا مسدود می‌شوند.
const ALLOWED_COMIC_EXTS = new Set([
  '.zip', '.cbz', '.cbr', '.rar', '.7z',
  '.pdf',
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.svg'
]);

// پوشهٔ کاورهای روی دیسک (همان که ورکرِ دیتابیس می‌نویسد).
const COMIC_COVERS_DIR = path.join(os.homedir(), '.comic-reader', 'covers');

// مرحله ۲ ـ بخش الف: helperهای خالصِ پروتکل (بدونِ وابستگی به
// Electron، تا مستقل قابلِ تست باشند).
function makeComicETag(size, mtimeMs) {
  return `"${size}-${Math.floor(mtimeMs)}"`;
}

function isAllowedComicExtension(ext) {
  return ALLOWED_COMIC_EXTS.has(String(ext || '').toLowerCase());
}

// بررسیِ عبور از مسیر (Path Traversal) روی مسیرِ نرمال‌شده: اگر بعد
// از normalize هنوز جزءِ '..' مانده باشد، یعنی مسیر از مبدأ فرار
// کرده است. روی هر دو جداکننده (‎/‎ و ‎\‎) چک می‌شود تا مستقل از
// سیستم‌عامل باشد.
function hasTraversalSegments(normalizedPath) {
  if (!normalizedPath || typeof normalizedPath !== 'string') return true;
  return normalizedPath.split(/[\\/]+/).includes('..');
}

// استخراجِ نامِ فایلِ کاور از URL (دو شکل: comic://covers/<file> که
// hostname برابرِ covers است، و pathnameای که با /covers/ شروع
// می‌شود). basename، هر تلاشِ traversal را خنثی می‌کند.
function resolveCoverFileName(hostname, pathname) {
  let raw = '';
  if (hostname === 'covers') {
    raw = String(pathname || '').replace(/^\/+/, '');
  } else if (String(pathname || '').startsWith('/covers/')) {
    raw = String(pathname || '').slice('/covers/'.length);
  } else {
    return null;
  }
  // مرحله ۲ ـ بخش ب: Query String کش‌باست (?v=...) پیش از اعتبارسنجی
  // جدا می‌شود؛ وگرنه 'abc.jpg?v=123' با regex رد می‌شد و کاورِ
  // نسخه‌دار هرگز سرو نمی‌شد. (در عمل، URL پارسر query را از pathname
  // جدا می‌کند، ولی این خط دفاعِ دوم برای URLهای ناقص است.)
  const file = raw.split('?')[0].split('/').pop();
  if (!file || !/^[A-Za-z0-9._-]+$/.test(file)) return null;
  return file;
}

// بررسیِ درخواستِ شرطی (If-None-Match مقدم بر If-Modified-Since):
// true یعنی فایل تغییر نکرده و باید 304 برگردد.
function isNotModified(requestHeaders, etag, mtimeMs) {
  if (!requestHeaders || typeof requestHeaders.get !== 'function') return false;
  const noneMatch = requestHeaders.get('if-none-match');
  if (noneMatch && noneMatch.trim() === etag) return true;
  const modifiedSince = requestHeaders.get('if-modified-since');
  if (modifiedSince) {
    const sinceMs = Date.parse(modifiedSince);
    if (!Number.isNaN(sinceMs) && Math.floor(mtimeMs) <= sinceMs) return true;
  }
  return false;
}

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
    // مرحله ۱ ـ بخش ب: URLهای data: هم نادیده گرفته می‌شوند تا
    // بارگذاریِ خودِ صفحهٔ خطا، هرگز did-fail-loadِ دیگری نسازد و
    // حلقهٔ بی‌نهایت محال شود (صفحهٔ خطا با data: ساخته می‌شود).
    if (!isMainFrame || errorCode === -3) return;
    if (validatedURL && validatedURL.startsWith('data:')) return;
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
      // مرحله ۲ ـ بخش الف: پاسخِ Preflight برای درخواست‌های Range
      // از pdf.js (هدرِ Range، درخواستِ ساده نیست و مرورگر پیش از آن
      // OPTIONS می‌فرستد؛ بدونِ این شاخه، preflight شکست می‌خورد و
      // Range عملاً هرگز کار نمی‌کرد).
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Content-Type, If-None-Match, If-Modified-Since',
            'Access-Control-Max-Age': '86400'
          }
        });
      }

      const rawUrl = request.url;
      let targetFilePath = null;
      let coverFileName = null;

      try {
        const parsedUrl = new URL(rawUrl);
        coverFileName = resolveCoverFileName(parsedUrl.hostname, parsedUrl.pathname);
        if (coverFileName) {
          targetFilePath = path.join(COMIC_COVERS_DIR, coverFileName);
        } else {
          targetFilePath = parsedUrl.searchParams.get('path');
          if (!targetFilePath && parsedUrl.pathname && parsedUrl.pathname !== '/') {
            targetFilePath = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ''));
          }
        }
      } catch (_) {
        const match = rawUrl.match(/[?&]path=([^&]+)/);
        if (match && match[1]) {
          targetFilePath = decodeURIComponent(match[1]);
        }
      }

      if (!targetFilePath || targetFilePath.includes('\0')) {
        return new Response('Path parameter is missing', { status: 400 });
      }

      const normalizedPath = path.normalize(targetFilePath);
      const ext = path.extname(normalizedPath).toLowerCase();

      // مرحله ۲ ـ بخش الف: لایهٔ امنیتی — Default-Deny.
      if (hasTraversalSegments(normalizedPath)) {
        return new Response('Forbidden: path traversal', { status: 403 });
      }
      if (!isAllowedComicExtension(ext)) {
        return new Response('Forbidden: file type not allowed', { status: 403 });
      }

      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      // ۱. پایپ‌لاین فوق‌سریع اختصاصی برای اسناد و کتاب‌های PDF (پشتیبانی از کش رم + Range Requests)
      if (ext === '.pdf') {
        const stat = await fs.promises.stat(normalizedPath);
        const totalSize = stat.size;
        const etag = makeComicETag(stat.size, stat.mtimeMs);
        const lastModified = new Date(stat.mtimeMs).toUTCString();
        const rangeHeader = request.headers.get('range');

        // مرحله ۲ ـ بخش الف: هدرهای لازم برای Range در pdf.js —
        // Expose-Headers (وگرنه مرورگر Content-Range را از fetch
        // پنهان می‌کند و pdf.js پشتیبانیِ Range را تشخیص نمی‌دهد) +
        // ETag/Last-Modified + اعتبارسنجیِ مجدد به‌جای کشِ یک‌ساله.
        const basePdfHeaders = {
          'Content-Type': 'application/pdf',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Length, ETag, Last-Modified',
          'Accept-Ranges': 'bytes',
          'ETag': etag,
          'Last-Modified': lastModified,
          'Cache-Control': 'public, max-age=0, must-revalidate'
        };

        if (isNotModified(request.headers, etag, stat.mtimeMs)) {
          return new Response(null, { status: 304, headers: basePdfHeaders });
        }

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
        // مرحله ۲ ـ بخش ب: بازهٔ برآورده‌نشدنی → 416 استاندارد با
        // Content-Range: bytes */total (نه 200 کامل که قبلاً بود).
        if (parsedRange && parsedRange.invalid) {
          return new Response(null, {
            status: 416,
            headers: {
              ...basePdfHeaders,
              'Content-Range': `bytes */${totalSize}`
            }
          });
        }
        const cacheKey = app.normalizeComicCacheKey(normalizedPath);
        const cachedEntry = app.activeComicRamCache.get(cacheKey);
        // فقط ورودیِ اعتبارسنجی‌شده و هم‌خوان با stat فعلی قابلِ
        // استفاده است؛ ورودیِ کهنه یا اعتبارسنجی‌نشده دور انداخته
        // می‌شود تا هرگز بایتِ کاور به‌جای PDF سرو نشود.
        let cachedPdfBuf = null;
        if (cachedEntry && cachedEntry.validated && cachedEntry.mtimeMs === stat.mtimeMs && cachedEntry.size === stat.size) {
          cachedPdfBuf = cachedEntry.buffer;
        } else if (cachedEntry) {
          // مرحله ۲ ـ بخش ب: کم‌کردنِ بایت فقط وقتی که delete واقعاً
          // چیزی را حذف کرده باشد؛ وگرنه دو درخواستِ هم‌زمان برای
          // یک فایلِ کهنه، حسابِ کش را دو بار کم می‌کردند و سقفِ
          // ۳۵۰ مگابایت به‌تدریج سوراخ می‌شد.
          if (app.activeComicRamCache.delete(cacheKey)) {
            currentRamCacheBytes -= cachedEntry.buffer ? cachedEntry.buffer.length : 0;
          }
        }

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
      // مرحله ۲ ـ بخش الف: کشِ یک‌سالهٔ immutable حذف شد؛ به‌جایش
      // ETag/Last-Modified + اعتبارسنجیِ مجدد: فایلِ جایگزین‌شده در
      // همان مسیر، بلافاصله تشخیص داده می‌شود (200 با محتوای جدید)
      // و فایلِ بدونِ تغییر، با 304 بدونِ بدنه سرو می‌شود.
      const stat = await fs.promises.stat(normalizedPath);
      const etag = makeComicETag(stat.size, stat.mtimeMs);
      const lastModified = new Date(stat.mtimeMs).toUTCString();
      if (isNotModified(request.headers, etag, stat.mtimeMs)) {
        return new Response(null, {
          status: 304,
          headers: {
            'ETag': etag,
            'Last-Modified': lastModified,
            'Cache-Control': 'public, max-age=0, must-revalidate',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': stat.size.toString(),
            'Cache-Control': 'public, max-age=0, must-revalidate',
            'Access-Control-Allow-Origin': '*',
            'ETag': etag,
            'Last-Modified': lastModified
          }
        });
      }
      const buffer = await app.readComicPageToRam(normalizedPath);

      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': buffer.length.toString(),
          'Cache-Control': 'public, max-age=0, must-revalidate',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Length, ETag, Last-Modified',
          'Accept-Ranges': 'bytes',
          'ETag': etag,
          'Last-Modified': lastModified
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