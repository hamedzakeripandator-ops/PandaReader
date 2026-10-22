// سرویس رندر دو مرحله‌ای باکیفیت (Dual-Pass Progressive HiDPI Rendering)
// وظیفه: حذف کامل تاری صفحات PDF و تصاویر کمیک پس از زوم یا توقف اسکرول

const MAX_HIDPI_CACHE_ENTRIES = 16;
const MAX_CANVAS_DIMENSION = 4096; // سقف امن ابعاد بوم گرافیکی در کرومیوم

class HiDpiRenderService {
  constructor() {
    this.cache = new Map(); // key -> { url, isObjectUrl, scale, timestamp }
    this.activePdfTasks = new Map(); // key -> pdfjs RenderTask
  }

  // پله‌بندی ضریب زوم برای جلوگیری از ری‌رندرهای تکراری در تغییرات جزئی اسلایدر
  quantizeZoom(zoomLevel = 1.0) {
    const z = Math.max(0.5, Math.min(3.5, Number(zoomLevel) || 1.0));
    return Math.round(z * 4) / 4; // گام‌های 0.25 (1.0, 1.25, 1.5, 1.75, 2.0, ...)
  }

  // محاسبه مقیاس کریستالی بر اساس زوم و تراکم پیکسلی مانیتور (DevicePixelRatio)
  computeTargetScale(zoomLevel = 1.0, isPdf = true) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const qZoom = this.quantizeZoom(zoomLevel);
    const baseBoost = isPdf ? 1.45 : 1.25;
    const rawScale = qZoom * dpr * baseBoost;
    return Math.min(4.2, Math.max(1.75, Number(rawScale.toFixed(2))));
  }

  buildCacheKey(filePath, pageNumber, zoomLevel) {
    const normPath = (filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase();
    const qZoom = this.quantizeZoom(zoomLevel);
    return `${normPath}::p${pageNumber}::z${qZoom}`;
  }

  // دریافت تصویر HiDPI از کش در صورت وجود
  peekHiDpiPage(filePath, pageNumber, zoomLevel) {
    const key = this.buildCacheKey(filePath, pageNumber, zoomLevel);
    const entry = this.cache.get(key);
    if (!entry) return null;

    // به‌روزرسانی اولویت LRU
    this.cache.delete(key);
    this.cache.set(key, { ...entry, timestamp: Date.now() });
    return entry.url;
  }

  // ذخیره در کش با آزادسازی خودکار حافظه (LRU Eviction)
  storeInCache(key, url, isObjectUrl, scale) {
    if (this.cache.has(key)) {
      const old = this.cache.get(key);
      if (old?.isObjectUrl && old.url !== url) {
        try {
          URL.revokeObjectURL(old.url);
        } catch (_) {}
      }
      this.cache.delete(key);
    }

    this.cache.set(key, {
      url,
      isObjectUrl,
      scale,
      timestamp: Date.now(),
    });

    while (this.cache.size > MAX_HIDPI_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      const oldest = this.cache.get(oldestKey);
      if (oldest?.isObjectUrl && oldest.url) {
        try {
          URL.revokeObjectURL(oldest.url);
        } catch (_) {}
      }
      this.cache.delete(oldestKey);
    }
  }

  // لغو رندرهای در حال انجام برای صفحاتی که از دید کاربر خارج شده‌اند
  cancelPendingForPage(pageKeyPrefix) {
    for (const [taskKey, task] of this.activePdfTasks.entries()) {
      if (taskKey.startsWith(pageKeyPrefix)) {
        try {
          task.cancel();
        } catch (_) {}
        this.activePdfTasks.delete(taskKey);
      }
    }
  }

  // پاس دوم رندر کریستالی برای صفحات PDF
  async renderPdfPageHiDpi({ pdfDoc, filePath, pageNumber, zoomLevel = 1.0 }) {
    if (!pdfDoc || !pageNumber) return null;

    const cacheKey = this.buildCacheKey(filePath, pageNumber, zoomLevel);
    const cachedUrl = this.peekHiDpiPage(filePath, pageNumber, zoomLevel);
    if (cachedUrl) return cachedUrl;

    const pagePrefix = `${(filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase()}::p${pageNumber}::`;
    this.cancelPendingForPage(pagePrefix);

    let canvas = null;
    try {
      const page = await pdfDoc.getPage(pageNumber);
      const unscaledViewport = page.getViewport({ scale: 1.0 });

      let targetScale = this.computeTargetScale(zoomLevel, true);

      // محافظت از سقف ابعاد بوم کارت گرافیک (حداکثر 4096 پیکسل)
      const maxSide = Math.max(unscaledViewport.width, unscaledViewport.height);
      if (maxSide * targetScale > MAX_CANVAS_DIMENSION) {
        targetScale = Number((MAX_CANVAS_DIMENSION / maxSide).toFixed(2));
      }

      const hiViewport = page.getViewport({ scale: targetScale });

      canvas = document.createElement('canvas');
      canvas.width = Math.floor(hiViewport.width);
      canvas.height = Math.floor(hiViewport.height);

      const ctx = canvas.getContext('2d', {
        alpha: false,
        willReadFrequently: false,
      });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const renderTask = page.render({
        canvasContext: ctx,
        viewport: hiViewport,
        intent: 'display',
      });

      this.activePdfTasks.set(cacheKey, renderTask);
      await renderTask.promise;
      this.activePdfTasks.delete(cacheKey);

      // تبدیل سریع به Blob URL (بسیار سبک‌تر از Base64 روی ترد اصلی)
      const resultUrl = await new Promise((resolve) => {
        if (typeof canvas.toBlob === 'function') {
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve({ url: URL.createObjectURL(blob), isObjectUrl: true });
              } else {
                resolve({
                  url: canvas.toDataURL('image/webp', 0.96),
                  isObjectUrl: false,
                });
              }
            },
            'image/webp',
            0.96
          );
        } else {
          resolve({
            url: canvas.toDataURL('image/webp', 0.96),
            isObjectUrl: false,
          });
        }
      });

      canvas.width = 0;
      canvas.height = 0;
      canvas = null;

      if (resultUrl?.url) {
        this.storeInCache(cacheKey, resultUrl.url, resultUrl.isObjectUrl, targetScale);
        return resultUrl.url;
      }
      return null;
    } catch (err) {
      this.activePdfTasks.delete(cacheKey);
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      if (err?.name !== 'RenderingCancelledException') {
        console.warn(`HiDPI PDF render skipped for page ${pageNumber}:`, err?.message);
      }
      return null;
    }
  }

  // پاک‌سازی کامل کش هنگام بستن کتاب یا کمیک
  clearFileCache(filePath) {
    for (const [, task] of this.activePdfTasks.entries()) {
      try {
        task.cancel();
      } catch (_) {}
    }
    this.activePdfTasks.clear();

    const norm = filePath
      ? filePath.trim().replace(/[\\/]+/g, '\\').toLowerCase()
      : null;

    for (const [key, entry] of this.cache.entries()) {
      if (!norm || key.startsWith(norm)) {
        if (entry?.isObjectUrl && entry.url) {
          try {
            URL.revokeObjectURL(entry.url);
          } catch (_) {}
        }
        this.cache.delete(key);
      }
    }
  }
}

export const hiDpiRenderService = new HiDpiRenderService();
export default hiDpiRenderService;