import { coreApi } from './coreApi';
import useLibraryStore from '../store/useLibraryStore';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

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

export function initThumbnailPdfEnvironment() {
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

initThumbnailPdfEnvironment();

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

class TaskQueue {
  constructor(concurrency = 3) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.next();
    });
  }

  next() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const { task, resolve, reject } = this.queue.shift();
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
    if (validDbCover && validDbCover.startsWith('data:')) {
      memoryCoverCache.set(norm, validDbCover);
      return validDbCover;
    }

    // گام سوم: جلوگیری از ارسال درخواست‌های تکراری موازی
    if (inFlightRequests.has(norm)) {
      return inFlightRequests.get(norm);
    }

    const requestPromise = thumbnailQueue
      .add(async () => {
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
            if (resolvedFromDb && resolvedFromDb.startsWith('data:')) {
              memoryCoverCache.set(norm, resolvedFromDb);
              useLibraryStore.getState().cacheCover?.(filePath, resolvedFromDb);
              return resolvedFromDb;
            }
          }

          // ب) استخراج کاور PDF با رزولوشن بهینه و بدون بارگذاری صفحات اضافی
          if (norm.endsWith('.pdf')) {
            initThumbnailPdfEnvironment();

            const sanitized = filePath.trim().replace(/^[\\/]+/, '');
            const resp = await fetch(`comic://media/?path=${encodeURIComponent(sanitized)}`);
            if (!resp.ok) return null;
            const arrayBuffer = await resp.arrayBuffer();

            let loadingTask = null;
            let doc = null;
            let page = null;
            let canvas = null;

            try {
              loadingTask = pdfjsLib.getDocument({
                data: new Uint8Array(arrayBuffer),
                cMapPacked: true,
                isEvalSupported: false,
                disableAutoFetch: true,
                disableStream: true,
                stopAtErrors: false,
              });

              doc = await loadingTask.promise;
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
              const dataUrl = canvas.toDataURL('image/jpeg', 0.84);

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

  // بررسی آنی کش رم بدون تاخیر
  peekCover: (filePath) => {
    const norm = normalizeCoverKey(filePath);
    if (!norm) return null;
    if (memoryCoverCache.has(norm)) return memoryCoverCache.get(norm);

    const dbCover = useLibraryStore.getState().getCover?.(norm);
    const validDbCover = resolveCoverUrl(dbCover);
    if (validDbCover && validDbCover.startsWith('data:')) {
      memoryCoverCache.set(norm, validDbCover);
      return validDbCover;
    }
    return null;
  },
};

export default thumbnailService;