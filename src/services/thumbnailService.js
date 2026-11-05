import { coreApi } from './coreApi';
import { getPdfSessionPassword } from './pdfPasswordSession';
import useLibraryStore from '../store/useLibraryStore';
// مرحله ۳ ـ بخش ب: بارگذاریِ تنبلِ pdfjs-dist. این فایل از مسیرِ
// بوتِ eager ایمپورت می‌شود (App → HomeView/ContextMenu →
// thumbnailService)، پس ایمپورتِ استاتیکِ pdfjs-dist چانکِ vendor-pdfjs
// را همان ثانیهٔ اول بارگذاری می‌کرد، حتی وقتی همهٔ کاورها از دیسک
// خوانده می‌شدند. حالا موتور فقط وقتی لود می‌شود که واقعاً یک PDFِ
// بدونِ کاورِ کش‌شده نیاز به رندر داشته باشد. وعده کش می‌شود تا
// فراخوانی‌های هم‌زمان، دو بار لود نکنند؛ و در صورتِ شکست، کش پاک
// می‌شود تا فراخوانیِ بعدی دوباره تلاش کند.
let pdfjsLibPromise = null;

async function getPdfJsLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      const workerModule = await import('pdfjs-dist/build/pdf.worker.mjs?url');
      const pdfjsWorker = workerModule.default;
      initThumbnailPdfEnvironmentInternal(pdfjsLib, pdfjsWorker);
      return pdfjsLib;
    })();
    pdfjsLibPromise = pdfjsLibPromise.catch((err) => {
      pdfjsLibPromise = null;
      throw err;
    });
  }
  return pdfjsLibPromise;
}

// ============================================================================
// ۱. نصب پلی‌فیل‌های ES2025/ES2026 برای جلوگیری از کرش ساخت کاور PDF
// (Map/WeakMap.getOrInsertComputed, Uint8Array.toHex/toBase64, Math.sumPrecise)
// ============================================================================
const THUMB_POLYFILL_RAW_CODE = `
(function() {
  if (typeof Map !== 'undefined') {
    if (typeof Map.prototype.getOrInsert !== 'function') {
      Object.defineProperty(Map.prototype, 'getOrInsert', {
        value: function (key, defaultValue) {
          if (!this.has(key)) this.set(key, defaultValue);
          return this.get(key);
        },
        configurable: true,
        writable: true
      });
    }
    if (typeof Map.prototype.getOrInsertComputed !== 'function') {
      Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
        value: function (key, callbackfn) {
          if (!this.has(key)) this.set(key, callbackfn(key));
          return this.get(key);
        },
        configurable: true,
        writable: true
      });
    }
  }
  if (typeof WeakMap !== 'undefined') {
    if (typeof WeakMap.prototype.getOrInsert !== 'function') {
      Object.defineProperty(WeakMap.prototype, 'getOrInsert', {
        value: function (key, defaultValue) {
          if (!this.has(key)) this.set(key, defaultValue);
          return this.get(key);
        },
        configurable: true,
        writable: true
      });
    }
    if (typeof WeakMap.prototype.getOrInsertComputed !== 'function') {
      Object.defineProperty(WeakMap.prototype, 'getOrInsertComputed', {
        value: function (key, callbackfn) {
          if (!this.has(key)) this.set(key, callbackfn(key));
          return this.get(key);
        },
        configurable: true,
        writable: true
      });
    }
  }
  if (typeof Uint8Array !== 'undefined') {
    if (typeof Uint8Array.prototype.toHex !== 'function') {
      Object.defineProperty(Uint8Array.prototype, 'toHex', {
        value: function () {
          let out = '';
          for (let i = 0; i < this.length; i++) {
            out += this[i].toString(16).padStart(2, '0');
          }
          return out;
        },
        configurable: true,
        writable: true
      });
    }
    if (typeof Uint8Array.fromHex !== 'function') {
      Uint8Array.fromHex = function (hexString) {
        const clean = String(hexString || '').replace(/[^0-9a-fA-F]/g, '');
        const bytes = new Uint8Array(Math.floor(clean.length / 2));
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
        }
        return bytes;
      };
    }
    if (typeof Uint8Array.prototype.setFromHex !== 'function') {
      Object.defineProperty(Uint8Array.prototype, 'setFromHex', {
        value: function (hexString) {
          const bytes = Uint8Array.fromHex(hexString);
          const len = Math.min(this.length, bytes.length);
          for (let i = 0; i < len; i++) this[i] = bytes[i];
          return { read: len * 2, written: len };
        },
        configurable: true,
        writable: true
      });
    }
    if (typeof Uint8Array.prototype.toBase64 !== 'function') {
      Object.defineProperty(Uint8Array.prototype, 'toBase64', {
        value: function () {
          let binary = '';
          const len = this.byteLength;
          const chunkSize = 0x8000;
          for (let i = 0; i < len; i += chunkSize) {
            binary += String.fromCharCode.apply(null, this.subarray(i, i + chunkSize));
          }
          return typeof btoa === 'function' ? btoa(binary) : '';
        },
        configurable: true,
        writable: true
      });
    }
    if (typeof Uint8Array.fromBase64 !== 'function') {
      Uint8Array.fromBase64 = function (base64String) {
        const clean = String(base64String || '').replace(/-/g, '+').replace(/_/g, '/');
        const bin = typeof atob === 'function' ? atob(clean) : '';
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      };
    }
  }
  if (typeof Promise !== 'undefined') {
    if (typeof Promise.withResolvers !== 'function') {
      Promise.withResolvers = function () {
        let resolve, reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
      };
    }
    if (typeof Promise.try !== 'function') {
      Promise.try = function (callbackfn, ...args) {
        return new Promise((resolve) => resolve(callbackfn(...args)));
      };
    }
  }
  if (typeof Math !== 'undefined' && typeof Math.sumPrecise !== 'function') {
    Math.sumPrecise = function (iterable) {
      let sum = 0;
      for (const val of iterable) sum += Number(val);
      return sum;
    };
  }
  if (typeof RegExp !== 'undefined' && typeof RegExp.escape !== 'function') {
    RegExp.escape = function (str) {
      return String(str).replace(/[\\\\^$*+?.()|[\\]{}]/g, '\\\\$&');
    };
  }
})();
`;

// همان بدنهٔ قبلیِ راه‌اندازیِ محیطِ pdfjs، با pdfjsLib و pdfjsWorker
// به‌عنوانِ پارامتر (دیگر از ایمپورتِ استاتیک نمی‌آیند). فقط از طریقِ
// getPdfJsLib صدا زده می‌شود، پس در بوت اجرا نمی‌شود.
function initThumbnailPdfEnvironmentInternal(pdfjsLib, pdfjsWorker) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(THUMB_POLYFILL_RAW_CODE)();
  } catch (_) {}

  if (typeof window !== 'undefined' && !window.__pdfWorkerPatchedUrlV2) {
    try {
      const resolvedWorkerUrl = new URL(pdfjsWorker, window.location.href).href;
      const polyfillModuleUrl =
        'data:text/javascript;charset=utf-8,' + encodeURIComponent(THUMB_POLYFILL_RAW_CODE);
      const wrapperSource = `${THUMB_POLYFILL_RAW_CODE}\nimport "${polyfillModuleUrl}";\nimport "${resolvedWorkerUrl}";\n`;
      const blob = new Blob([wrapperSource], { type: 'text/javascript' });
      window.__pdfWorkerPatchedUrlV2 = URL.createObjectURL(blob);

      const NativeWorker = window.__OriginalNativeWorker || window.Worker;
      window.__OriginalNativeWorker = NativeWorker;

      if (NativeWorker) {
        const PatchedWorker = function (scriptURL, options) {
          const urlStr = String(scriptURL || '');
          if (
            (urlStr.includes('pdf.worker') || urlStr === window.__pdfWorkerPatchedUrl) &&
            window.__pdfWorkerPatchedUrlV2
          ) {
            return new NativeWorker(window.__pdfWorkerPatchedUrlV2, {
              ...(options || {}),
              type: 'module',
            });
          }
          return new NativeWorker(scriptURL, options);
        };
        PatchedWorker.prototype = NativeWorker.prototype;
        Object.setPrototypeOf(PatchedWorker, NativeWorker);
        window.Worker = PatchedWorker;
      }
    } catch (_) {}
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = window.__pdfWorkerPatchedUrlV2 || pdfjsWorker;
}

// مرحله ۳ ـ بخش ب: فراخوانیِ سطحِ ماژول حذف شد؛ راه‌اندازیِ محیطِ
// pdfjs حالا فقط داخلِ getPdfJsLib و هنگامِ نیازِ واقعی اجرا می‌شود.

// استانداردسازی یکسان کلید مسیر در تمام بخش‌های برنامه
function normalizeCoverKey(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  return filePath.trim().replace(/[\\/]+/g, '\\').toLowerCase();
}

// آزادسازی ۱۰۰٪ ایمن منابع PDF بدون پرتاب خطای doc.destroy is not a function
async function safeDestroyPdfResources(page, doc, loadingTask) {
  try {
    if (page && typeof page.cleanup === 'function') {
      page.cleanup();
    }
  } catch (_) {}

  try {
    if (doc) {
      if (typeof doc.cleanup === 'function') {
        await doc.cleanup();
      }
      if (typeof doc.destroy === 'function') {
        await doc.destroy();
      }
    }
  } catch (_) {}

  try {
    if (loadingTask && typeof loadingTask.destroy === 'function') {
      await loadingTask.destroy();
    }
  } catch (_) {}
}

// کش رم در سطح اپلیکیشن برای دسترسی فوری و بدون فریز
const memoryCoverCache = new Map();
// نقشه جلوگیری از ارسال درخواست‌های هم‌زمان برای یک مسیر مشترک
const inFlightRequests = new Map();

// مرحله ۴ — صفِ استخراجِ کاور با اولویتِ تازه‌ترین و لغوِ در صف:
//  - LIFO به‌جای FIFO: وقتی کاربر سریع اسکرول می‌کند، تازه‌ترین کارت‌های
//    در دید، زودتر از کارت‌های قدیمیِ صف اجرا می‌شوند (کارت‌های قدیمی
//    معمولاً تا آن موقع از دید خارج شده و با cancel حذف شده‌اند).
//  - cancel(key) فقط ورودیِ هنوز اجرا نشده را حذف می‌کند و وعده‌اش را با
//    null حل می‌کند (نه reject)، چون فراخواننده‌ها catch ندارند و null
//    یعنی «کاور نیست»؛ استخراجِ در حالِ اجرا لغو نمی‌شود (حداکثر ۳ عددند
//    و به‌زودی تمام می‌شوند). گرسنگیِ دائمی رخ نمی‌دهد: وقتی اسکرول
//    می‌ایستد، ورودیِ تازه‌ای نمی‌آید و صف خالی می‌شود.
class TaskQueue {
  constructor(concurrency = 3) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  add(key, task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ key, task, resolve, reject });
      this.next();
    });
  }

  cancel(key) {
    const idx = this.queue.findIndex((entry) => entry.key === key);
    if (idx === -1) return false;
    const [entry] = this.queue.splice(idx, 1);
    entry.resolve(null);
    return true;
  }

  next() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const { task, resolve, reject } = this.queue.pop();
      this.running++;
      task()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          this.running--;
          this.next();
        });
    }
  }
}

const thumbnailQueue = new TaskQueue(3);

// حل و استانداردسازی آدرس کاور با فیلتر کامل مسیرهای موقت و نامعتبر
export function resolveCoverUrl(cover) {
  if (!cover || typeof cover !== 'string') return null;

  const trimmed = cover.trim();

  // ۱. کاورهای دائمی معتبر Base64 یا آدرس‌های تحت وب
  if (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }

  // ۲. مسدودسازی قطعی فایل‌های پوشه موقت (زیرا پس از خواندن کمیک پاک می‌شوند)
  if (
    trimmed.includes('ComicReaderCache') ||
    trimmed.includes('Temp') ||
    trimmed.includes('AppData')
  ) {
    return null;
  }

  // ۳. فرمت پروتکل امن comic://
  if (trimmed.startsWith('comic://')) {
    return trimmed;
  }

  // ۴. تبدیل مسیر لوکال به پروتکل امن و استاندارد comic://
  const sanitized = trimmed.replace(/^[\\/]+/, '');
  return `comic://media/?path=${encodeURIComponent(sanitized)}`;
}

// ============================================================================
// مرحلهٔ ۳۹ §۲: دان‌اسکیلِ فوق‌سبکِ تامبنیل با pica
//  - pica به صورتِ تنبل (dynamic import) بارگذاری می‌شود تا بوتِ
//    برنامه سنگین نشود؛ اگر pica نصب نباشد (یا لودش شکست بخورد)،
//    بومِ دومرحله‌ایِ بومی جایگزین می‌شود — هیچ‌وقت کرش نمی‌کند.
//  - ورودی: بوم، تصویر، یا data URL؛ خروجی: data URL با فرمتِ
//    image/webp و کیفیتِ 0.78 (حداکثر 220×310 با حفظِ نسبتِ ابعاد)،
//    یا null در صورتِ هر خطایی.
// ============================================================================
let picaPromise = null;

function getPicaInstance() {
  if (!picaPromise) {
    picaPromise = import('pica')
      .then((m) => {
        const factory = (m && m.default) || m;
        if (typeof factory !== 'function') return null;
        try {
          return factory();
        } catch (_) {
          return null;
        }
      })
      .catch(() => null);
  }
  return picaPromise;
}

function canvasToWebpDataUrl(canvas, quality = 0.78) {
  try {
    const url = canvas.toDataURL('image/webp', quality);
    if (url && url.startsWith('data:image/webp')) return url;
  } catch (_) {}
  try {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url && url.startsWith('data:image/')) return url;
  } catch (_) {}
  return null;
}

function drawImageTwoStage(srcCanvas, destCanvas) {
  const dw = destCanvas.width;
  const dh = destCanvas.height;
  const mid = document.createElement('canvas');
  const midW = Math.max(dw, Math.min(srcCanvas.width, dw * 2));
  const midH = Math.max(dh, Math.min(srcCanvas.height, dh * 2));
  mid.width = Math.max(1, Math.floor(midW));
  mid.height = Math.max(1, Math.floor(midH));
  const midCtx = mid.getContext('2d', { alpha: false });
  midCtx.fillStyle = '#ffffff';
  midCtx.fillRect(0, 0, mid.width, mid.height);
  midCtx.drawImage(srcCanvas, 0, 0, mid.width, mid.height);
  const destCtx = destCanvas.getContext('2d', { alpha: false });
  destCtx.fillStyle = '#ffffff';
  destCtx.fillRect(0, 0, dw, dh);
  destCtx.drawImage(mid, 0, 0, dw, dh);
  mid.width = 0;
  mid.height = 0;
}

export function dataUrlByteSize(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return 0;
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return 0;
  return Math.floor((dataUrl.length - comma - 1) * 0.75);
}

export async function downscaleThumbnailWithPica(sourceImageOrCanvas, targetMaxWidth = 220, targetMaxHeight = 310) {
  try {
    if (typeof document === 'undefined') return null;
    let srcCanvas = null;
    let srcW = 0;
    let srcH = 0;
    if (sourceImageOrCanvas && typeof sourceImageOrCanvas.getContext === 'function' && sourceImageOrCanvas.tagName === 'CANVAS') {
      srcCanvas = sourceImageOrCanvas;
      srcW = sourceImageOrCanvas.width || 0;
      srcH = sourceImageOrCanvas.height || 0;
    } else {
      let img = null;
      if (typeof sourceImageOrCanvas === 'string') {
        img = new Image();
        img.decoding = 'async';
        const loaded = new Promise((resolve, reject) => {
          img.onload = () => resolve(true);
          img.onerror = () => reject(new Error('image load failed'));
        });
        img.src = sourceImageOrCanvas;
        await loaded;
      } else if (sourceImageOrCanvas && sourceImageOrCanvas.tagName === 'IMG') {
        img = sourceImageOrCanvas;
        if (!img.complete || !img.naturalWidth) {
          await new Promise((resolve, reject) => {
            img.onload = () => resolve(true);
            img.onerror = () => reject(new Error('image load failed'));
          });
        }
      } else {
        return null;
      }
      srcW = img.naturalWidth || img.width || 0;
      srcH = img.naturalHeight || img.height || 0;
      if (!srcW || !srcH) return null;
      srcCanvas = document.createElement('canvas');
      srcCanvas.width = srcW;
      srcCanvas.height = srcH;
      const srcCtx = srcCanvas.getContext('2d', { alpha: false });
      srcCtx.fillStyle = '#ffffff';
      srcCtx.fillRect(0, 0, srcW, srcH);
      srcCtx.drawImage(img, 0, 0, srcW, srcH);
    }
    if (!srcCanvas || !srcW || !srcH) return null;
    const maxW = Math.max(1, Number(targetMaxWidth) || 220);
    const maxH = Math.max(1, Number(targetMaxHeight) || 310);
    const scale = Math.min(1, maxW / srcW, maxH / srcH);
    const destW = Math.max(1, Math.round(srcW * scale));
    const destH = Math.max(1, Math.round(srcH * scale));
    const destCanvas = document.createElement('canvas');
    destCanvas.width = destW;
    destCanvas.height = destH;
    let usedPica = false;
    try {
      const picaInstance = await getPicaInstance();
      if (picaInstance && typeof picaInstance.resize === 'function') {
        await picaInstance.resize(srcCanvas, destCanvas, {
          quality: 3,
          alpha: false,
          unsharpAmount: 60,
          unsharpRadius: 0.6,
          unsharpThreshold: 2,
        });
        usedPica = true;
      }
    } catch (_) {
      usedPica = false;
    }
    if (!usedPica) {
      drawImageTwoStage(srcCanvas, destCanvas);
    }
    return canvasToWebpDataUrl(destCanvas, 0.78);
  } catch (_) {
    return null;
  }
}

export const thumbnailService = {
  // تزریق مستقیم کاور ساخته‌شده (توسط PdfViewer یا ورکر) برای جلوگیری از پردازش دوبل
  seedCover: (filePath, dataUrl) => {
    const norm = normalizeCoverKey(filePath);
    const valid = resolveCoverUrl(dataUrl);
    if (!norm || !valid) return;
    memoryCoverCache.set(norm, valid);
    useLibraryStore.getState().cacheCover?.(filePath, valid);
  },

  // دریافت تضمینی تصویر صفحه اول (با ذخیره دائمی Base64 در دیتابیس)
  getThumbnail: async (filePath) => {
    const norm = normalizeCoverKey(filePath);
    if (!norm) return null;

    // گام اول: بررسی کش رم فوق‌سریع
    if (memoryCoverCache.has(norm)) {
      return memoryCoverCache.get(norm);
    }

    // گام دوم: بررسی کش استور کتابخانه
    const dbCover = useLibraryStore.getState().getCover?.(norm);
    const validDbCover = resolveCoverUrl(dbCover);
    if (validDbCover && (validDbCover.startsWith('data:') || validDbCover.startsWith('comic://'))) { // مرحله ۲: کاورِ روی دیسک هم معتبر است
      memoryCoverCache.set(norm, validDbCover);
      return validDbCover;
    }

    // گام سوم: جلوگیری از ارسال درخواست‌های تکراری موازی
    if (inFlightRequests.has(norm)) {
      return inFlightRequests.get(norm);
    }

    const requestPromise = thumbnailQueue
      .add(norm, async () => {
        // بررسی مجدد کش رم پس از نوبت در صف (در صورتی که PdfViewer در این فاصله کاور را ساخته باشد)
        if (memoryCoverCache.has(norm)) {
          return memoryCoverCache.get(norm);
        }

        try {
          // الف) بررسی مستقیم دیتابیس لوکال پیش از پردازش سنگین فایل
          if (coreApi.isAvailable()) {
            const cachedDbRes = await coreApi.dbAction({
              action: 'GET_CACHED_COVER',
              payload: { filePath },
            });
            const resolvedFromDb = resolveCoverUrl(cachedDbRes?.cover);
            if (resolvedFromDb && (resolvedFromDb.startsWith('data:') || resolvedFromDb.startsWith('comic://'))) { // مرحله ۲: کاورِ روی دیسک هم معتبر است
              memoryCoverCache.set(norm, resolvedFromDb);
              useLibraryStore.getState().cacheCover?.(filePath, resolvedFromDb);
              return resolvedFromDb;
            }
          }

          // ب) استخراج کاور PDF با رزولوشن بهینه و بدون بارگذاری صفحات اضافی
          // مرحله ۲ ـ بخش ب: مثل PdfViewer، اول با url + Range خوانده
          // می‌شود تا برای رندرِ صفحهٔ اول، فقط چانک‌های لازم بیایند؛
          // اگر بارگذاریِ URL شکست خورد، به fetch + arrayBuffer
          // برمی‌گردد تا هیچ کاوری از تولید شدن باز نماند.
          if (norm.endsWith('.pdf')) {
            // مرحله ۳ ـ بخش ب: موتورِ pdfjs فقط همین‌جا، و فقط برای
            // PDFِ بدونِ کاورِ کش‌شده، بارگذاری می‌شود. اگر بارگذاری
            // شکست بخورد، کاور null برمی‌گردد و مسیرِ کشِ دیسک سالم
            // می‌ماند (نه کرش، نه وعدهٔ بی‌پاسخ).
            let pdfjsLib = null;
            try {
              pdfjsLib = await getPdfJsLib();
            } catch (_) {
              return null;
            }
            if (!pdfjsLib) return null;

            const sanitized = filePath.trim().replace(/^[\\/]+/, '');
            const comicUrl = `comic://media/?path=${encodeURIComponent(sanitized)}`;

            let loadingTask = null;
            let doc = null;
            let page = null;
            let canvas = null;

            // مرحله ۹: بارگذاریِ PDF با رمزِ خالی و هندلرِ
            // onPassword که بی‌درنگ رد می‌کند تا فایلِ دارای رمزِ
            // واقعی، به‌جای آویزان شدن، به مسیرِ آماده (prepare)
            // بیفتد. فایل‌های با رمزِ خالی، مثلِ قبل مستقیم باز
            // می‌شوند.
            const loadPdfDocFromUrl = async (url) => {
              let task = null;
              try {
                task = pdfjsLib.getDocument({
                  url,
                  cMapPacked: true,
                  isEvalSupported: false,
                  disableAutoFetch: true,
                  disableStream: false,
                  disableRange: false,
                  rangeChunkSize: 65536,
                  stopAtErrors: false,
                  password: '',
                  onPassword: (updatePassword) => {
                    try { updatePassword(new Error('__thumb_password__')); } catch (_) {}
                  },
                });
                loadingTask = task;
                return await task.promise;
              } catch (rangeErr) {
                try {
                  if (task && typeof task.destroy === 'function') await task.destroy();
                } catch (_) {}
                loadingTask = null;
                if (rangeErr && (rangeErr.name === 'PasswordException' || rangeErr.message === '__thumb_password__')) throw rangeErr;
                const resp = await fetch(url);
                if (!resp.ok) return null;
                const arrayBuffer = await resp.arrayBuffer();
                task = pdfjsLib.getDocument({
                  data: new Uint8Array(arrayBuffer),
                  cMapPacked: true,
                  isEvalSupported: false,
                  disableAutoFetch: true,
                  disableStream: true,
                  stopAtErrors: false,
                  password: '',
                  onPassword: (updatePassword) => {
                    try { updatePassword(new Error('__thumb_password__')); } catch (_) {}
                  },
                });
                loadingTask = task;
                return await task.promise;
              }
            };

            try {
              try {
                doc = await loadPdfDocFromUrl(comicUrl);
              } catch (loadErr) {
                // مرحله ۹: PasswordException → لایهٔ ۱: مسیرِ
                // آماده‌شدهٔ کش (رمزِ صوری یا رمزگشایی‌شده) را
                // امتحان کن؛ اگر نبود، کاور null می‌ماند (نه کرش).
                if (loadErr && (loadErr.name === 'PasswordException' || loadErr.message === '__thumb_password__')) {
                  try {
                    // مرحله ۹: رمزِ نشست (اگر کاربر در همین نشست،
                    // فایل را با رمز باز کرده) به prepare می‌رسد تا
                    // کاورِ فایلِ قفل‌دار هم پس از باز شدنِ با رمز
                    // ساخته شود؛ در غیرِ این صورت، رمزِ خالی.
                    const sessionPw = getPdfSessionPassword(filePath) || '';
                    const prepared = await coreApi.prepareProtectedPdfForReading(filePath, { password: sessionPw });
                    if (prepared && (prepared.status === 'ghost-neutralized' || prepared.status === 'unlocked-copy') && prepared.path) {
                      const pSanitized = String(prepared.path).trim().replace(/^[\\/]+/, '');
                      doc = await loadPdfDocFromUrl(`comic://media/?path=${encodeURIComponent(pSanitized)}`);
                    }
                  } catch (_) {
                    doc = null;
                  }
                } else {
                  throw loadErr;
                }
              }
              if (!doc) return null;
              page = await doc.getPage(1);

              const baseVp = page.getViewport({ scale: 1.0 });
              const targetScale =
                baseVp.width > 0 ? Math.min(1.0, 320 / baseVp.width) : 0.45;
              const viewport = page.getViewport({ scale: targetScale });

              canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.floor(viewport.width));
              canvas.height = Math.max(1, Math.floor(viewport.height));
              const ctx = canvas.getContext('2d', { alpha: false });

              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);

              await page.render({ canvasContext: ctx, viewport }).promise;
              // مرحلهٔ ۳۹ §۲: کاورِ PDF با pica به 220×310 و WebP
              // فشرده می‌شود؛ اگر دان‌اسکیل شکست خورد، JPEGِ قبلی
              // بدونِ هیچ تغییری برمی‌گردد.
              const smallCover = await downscaleThumbnailWithPica(canvas);
              const dataUrl = smallCover || canvas.toDataURL('image/jpeg', 0.84);

              // ذخیره فوری کاور قبل از اجرای متدهای پاک‌سازی
              if (dataUrl && dataUrl.startsWith('data:image/')) {
                memoryCoverCache.set(norm, dataUrl);
                useLibraryStore.getState().cacheCover?.(filePath, dataUrl);
                return dataUrl;
              }
            } finally {
              if (canvas) {
                canvas.width = 0;
                canvas.height = 0;
              }
              await safeDestroyPdfResources(page, doc, loadingTask);
            }
            return null;
          }

          // ج) استخراج کاور کمیک (ZIP, RAR, CBR, CBZ) از هسته الکترون
          const res = await coreApi.getFirstPageThumbnail(filePath);
          if (res && res.success && res.cover) {
            const resolved = resolveCoverUrl(res.cover);
            if (resolved) {
              memoryCoverCache.set(norm, resolved);
              useLibraryStore.getState().cacheCover?.(filePath, resolved);
              return resolved;
            }
          }
        } catch (err) {
          console.warn('Cover generation failed for:', filePath, err?.message);
        }
        return null;
      })
      .finally(() => {
        inFlightRequests.delete(norm);
      });

    inFlightRequests.set(norm, requestPromise);
    return requestPromise;
  },

  // مرحله ۴ — لغوِ استخراجِ در صف برای یک مسیر (صدا زده‌شده از
  // پاک‌سازیِ ComicCard هنگامِ آنمانتِ کارتِ خارج از دید). اگر استخراج
  // در حالِ اجراست یا اصلاً در صف نیست، false برمی‌گردد و هیچ‌کاری
  // نمی‌شود؛ لغو، وعدهٔ در انتظار را با null حل می‌کند.
  // مرحله ۱۰: خالی کردنِ کشِ رمِ کاورها پس از پاک‌سازیِ کاورها.
  // درخواست‌هایِ در حالِ پرواز، وعده‌هایِ حل‌شده‌اند و دست نمی‌خورند.
  clearMemoryCache: () => {
    memoryCoverCache.clear();
  },

  cancelThumbnailRequest: (filePath) => {
    const norm = normalizeCoverKey(filePath);
    if (!norm) return false;
    return thumbnailQueue.cancel(norm);
  },

  // بررسی آنی کش رم بدون تاخیر
  peekCover: (filePath) => {
    const norm = normalizeCoverKey(filePath);
    if (!norm) return null;
    if (memoryCoverCache.has(norm)) return memoryCoverCache.get(norm);

    const dbCover = useLibraryStore.getState().getCover?.(norm);
    const validDbCover = resolveCoverUrl(dbCover);
    if (validDbCover && (validDbCover.startsWith('data:') || validDbCover.startsWith('comic://'))) { // مرحله ۲: کاورِ روی دیسک هم معتبر است
      memoryCoverCache.set(norm, validDbCover);
      return validDbCover;
    }
    return null;
  },
};

export default thumbnailService;