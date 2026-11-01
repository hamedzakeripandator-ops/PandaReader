// سرویس رندر دو مرحله‌ای باکیفیت (Dual-Pass Progressive HiDPI Rendering)
// مرحله ۲۴ — بازطراحیِ موتورِ دیپ‌رندر:
//   لایهٔ ۱ (کاملِ صفحه): خروجی، در ۱۰۰٪ مواقع و برایِ تمامِ صفحات،
//     فقط و فقط image/png است. WebPِ مرحلهٔ ۲۳ حذف شد، چون در
//     کرومیوم، YUV420 لبه‌هایِ رنگی و متن را کدر می‌کند (همان چیزی
//     که مرحلهٔ ۱۹ ثابت کرده بود). انکودِ PNG، در ورکرِ انکودرِ
//     خالصِ gpuImageEnhancer انجام می‌شود تا تردِ اصلی، صفر
//     میلی‌ثانیه قفل شود؛ بومِ اصلی تا جوابِ ورکر، زنده می‌ماند و
//     اگر ورکر نبود، Fallbackِ تردِ اصلی رویِ همان بوم اجرا می‌شود.
//   لایهٔ ۲ (برشِ ناحیهٔ دید): دیگر بومِ مستقیم نیست، بلکه یک
//     <img> با نشانیِ blob: از نوعِ PNG است (Viewport Detail PNG
//     Overlay) تا از Mipmapِ باکیفیتِ تگِ <img> در کرومیوم استفاده
//     شود، نه از رسترِ خامِ <canvas>. برش، با حاشیهٔ امنِ ۲۰٪ و با
//     تراکمِ detailDpr رندر می‌شود و نشانی‌اش، فقط پس از decode
//     شدن، جایگزینِ تایلِ قبلی می‌شود تا هیچ چشمکی رخ ندهد.
// فیلترِ SVGِ مرحلهٔ ۲۳ حذف شد (بخشِ ۲٫۱ گزارشِ مرحلهٔ ۲۴).
// نسبتِ ابعاد، از ویوپورتِ بدونِ چرخش خوانده می‌شود، چون چرخشِ
// برنامه با CSS اعمال می‌شود، نه با ویوپورتِ pdf.js.

import { renderCanvasToSharpWebP } from '../utils/gpuImageEnhancer';

const MAX_HIDPI_CACHE_ENTRIES = 16;
const MAX_CANVAS_DIMENSION = 4800; // سقفِ ضلعِ بومِ دیپ (مرحلهٔ ۲۳، حفظ شد)
const MAX_CANVAS_AREA = 18000000; // سقفِ مساحتِ بومِ دیپ: ۱۸ مگاپیکسل

class HiDpiRenderService {
  constructor() {
    this.cache = new Map(); // key -> { url, scale, timestamp }
    this.activePdfTasks = new Map(); // key -> pdfjs RenderTask
  }

  // پله‌بندی ضریب زوم برای کلیدِ کش (تا تغییراتِ جزئیِ اسلایدر،
  // رندرِ تازه نسازند). مقیاسِ واقعیِ رندر، از رویِ
  // displayWidthPx حساب می‌شود، نه از رویِ همین مقدار.
  quantizeZoom(zoomLevel = 1.0) {
    const z = Math.max(0.5, Math.min(3.5, Number(zoomLevel) || 1.0));
    return Math.round(z * 4) / 4; // گام‌های 0.25 (1.0, 1.25, 1.5, 1.75, 2.0, ...)
  }

  // کلیدِ کش: فایل/صفحه/زومِ پله‌بندی‌شده.
  buildCacheKey(filePath, pageNumber, zoomLevel) {
    const normPath = (filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase();
    const qZoom = this.quantizeZoom(zoomLevel);
    return `${normPath}::p${pageNumber}::z${qZoom}`;
  }

  // دریافتِ نشانیِ blob:یِ HiDPI از کش در صورت وجود.
  peekHiDpiPage(filePath, pageNumber, zoomLevel) {
    const key = this.buildCacheKey(filePath, pageNumber, zoomLevel);
    const entry = this.cache.get(key);
    if (!entry) return null;

    // به‌روزرسانی اولویت LRU
    this.cache.delete(key);
    this.cache.set(key, { ...entry, timestamp: Date.now() });
    return entry.url || null;
  }

  // باطل‌کردنِ امنِ یک ورودیِ کش (بازیابیِ خطایِ <img>): نشانیِ
  // blob:، بی‌درنگ revoke می‌شود تا حافظه پس داده شود.
  revokeEntry(entry) {
    if (entry && entry.url) {
      try { URL.revokeObjectURL(entry.url); } catch (_) {}
    }
  }

  // حذفِ یک صفحه از کش (وقتی <img> آن خطا داد تا با رندرِ تازه
  // جایگزین شود، نه اینکه همان نشانیِ خراب برگردد).
  invalidateHiDpiPage(filePath, pageNumber, zoomLevel) {
    const key = this.buildCacheKey(filePath, pageNumber, zoomLevel);
    const entry = this.cache.get(key);
    if (entry) {
      this.revokeEntry(entry);
      this.cache.delete(key);
    }
  }

  // ذخیره در کش با آزادسازی خودکارِ حافظه (LRU Eviction): نشانیِ
  // تخلیه‌شده، بی‌درنگ revoke می‌شود.
  storeInCache(key, url, scale) {
    if (this.cache.has(key)) {
      const old = this.cache.get(key);
      if (old && old.url !== url) this.revokeEntry(old);
      this.cache.delete(key);
    }

    this.cache.set(key, {
      url,
      scale,
      timestamp: Date.now(),
    });

    while (this.cache.size > MAX_HIDPI_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      const oldest = this.cache.get(oldestKey);
      if (oldest) this.revokeEntry(oldest);
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

  // سقف‌هایِ یکنواختِ بوم: یک ضریبِ واحد، هر دو محور را با هم
  // پایین می‌آورد تا نسبتِ ابعاد، ۱۰۰٪ حفظ شود.
  applyCanvasCaps(baseW, baseH, scale) {
    let s = scale;
    const maxSide = Math.max(baseW, baseH) * s;
    if (maxSide > MAX_CANVAS_DIMENSION) {
      s *= MAX_CANVAS_DIMENSION / maxSide;
    }
    const rawArea = baseW * s * (baseH * s);
    if (rawArea > MAX_CANVAS_AREA) {
      s *= Math.sqrt(MAX_CANVAS_AREA / rawArea);
    }
    return s;
  }

  // پاس دوم رندر کریستالی برای صفحات PDF — مرحلهٔ ۲۴، لایهٔ ۱:
  //   ۱) مقیاسِ سوپرسمپل از رویِ عرضِ نمایشیِ واقعیِ صفحه در DOM
  //      و تراکمِ مانیتور (فرمولِ مرحلهٔ ۲۳، حفظ شد): dpr بینِ ۲٫۰
  //      تا ۳٫۰؛ desiredWidth = max(displayWidthPx × dpr × 1.35،
  //      baseWidth × 3.6)؛ سقفِ ضلعِ ۴۸۰۰ و مساحتِ ۱۸ مگاپیکسل.
  //   ۲) رندرِ مستقیمِ pdf.js رویِ بومِ موقت (بدونِ ورکرِ پیکسلی،
  //      بدونِ انتقالِ بیت‌مپِ مخرب، بدونِ Downscale).
  //   ۳) خروجی، همیشه و فقط PNG است — از طریقِ ورکرِ انکودرِ
  //      خالص (تردِ اصلی، صفر میلی‌ثانیه قفل نمی‌شود). نشانیِ
  //      blob: در کشِ LRU می‌نشیند.
  async renderPdfPageHiDpi({ pdfDoc, filePath, pageNumber, zoomLevel = 1.0, displayWidthPx = 0, onPageRatio = null, enhanceFn = null }) {
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
      const baseW = unscaledViewport.width;
      const baseH = unscaledViewport.height;
      if (!baseW || !baseH) return null;

      // ثبتِ فوریِ نسبتِ واقعیِ صفحه (مرحلهٔ ۲۲): کادرِ صفحه،
      // دقیقاً هم‌اندازهٔ تصویرِ واقعی‌اش می‌شود.
      if (typeof onPageRatio === 'function') {
        try { onPageRatio(baseH / baseW); } catch (_) {}
      }

      // فرمولِ مقیاسِ سوپرسمپل (مرحلهٔ ۲۳، حفظ شد).
      const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2.0), 3.0);
      const desiredWidth = Math.max(displayWidthPx * dpr * 1.35, baseW * 3.5);
      let targetScale = desiredWidth / Math.max(1, baseW);
      targetScale = this.applyCanvasCaps(baseW, baseH, targetScale);

      const hiViewport = page.getViewport({ scale: targetScale });

      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(baseW * targetScale));
      canvas.height = Math.max(1, Math.floor(baseH * targetScale));

      // بومِ استاندارد (بدونِ alpha:false که بافرِ اولیه را سیاه
      // می‌کند)؛ پر کردنِ سفید، پیش از هر کاری.
      const ctx = canvas.getContext('2d');
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

      // مرحلهٔ ۲۶ — مسیرِ تازه: بوم -> WebP ۱٫۰ -> موتورِ sharpِ
      // پروسهٔ اصلی (lanczos3 + شارپنینگِ دو موتوره + WebP 100)
      // -> نشانیِ blob:. اگر sharp نبود یا خطا داد، همان WebPِ
      // مستقیمِ ۱٫۰ برمی‌گردد (بدونِ هیچ دستکاریِ مخربی).
      // enhanceFn را فراخواننده می‌دهد (پوششی رویِ
      // coreApi.enhanceRenderedPageSharp) تا سرویس، وابستگیِ
      // مستقیم به coreApi نگیرد.
      const sharpResult = await renderCanvasToSharpWebP(canvas, enhanceFn);

      canvas.width = 0;
      canvas.height = 0;
      canvas = null;

      if (sharpResult) {
        this.storeInCache(cacheKey, sharpResult.url, targetScale);
        return sharpResult.url;
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
        if (entry) this.revokeEntry(entry);
        this.cache.delete(key);
      }
    }
  }
}

export const hiDpiRenderService = new HiDpiRenderService();
export default hiDpiRenderService;
