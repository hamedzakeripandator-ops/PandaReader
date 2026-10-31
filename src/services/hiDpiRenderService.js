// سرویس رندر دو مرحله‌ای باکیفیت (Dual-Pass Progressive HiDPI Rendering)
// مرحله ۲۲ — بازگشت به PNGِ سوپرسمپل‌شده در <img> (همان تیزیِ
// مرحلهٔ ۱۹)، ولی این بار انکودِ PNG در WebWorker انجام می‌شود تا
// تردِ اصلی، صفر میلی‌ثانیه قفل نشود؛ و یک موتورِ دوگانهٔ بهبودِ
// تصویر (تیزیِ متن + رفعِ ماتیِ عکس) هم در همان Worker اجرا می‌شود.
// picaِ مرحلهٔ ۲۱ حذف شد: کوچک‌کردنِ بوم به ابعادِ ۱:۱، تراکمِ
// پیکسلی را از ۲٫۵ برابر به ۱٫۰ برابر رسانده بود و ظرافتِ فونت‌ها
// را از بین برده بود. در این مرحله، بومِ رندرشده هرگز Downscale
// نمی‌شود؛ تگِ <img> با فیلترِ Skia Mipmap + Lanczos-3ِ کرومیوم،
// خودش آن را باکیفیت نشان می‌دهد.
import { processPdfPageInWorker } from '../utils/gpuImageEnhancer';

const MAX_HIDPI_CACHE_ENTRIES = 16;
const MAX_CANVAS_DIMENSION = 4608; // سقفِ ضلعِ بومِ دیپ (مرحلهٔ ۲۲)
const MAX_CANVAS_AREA = 18000000; // سقفِ مساحتِ بومِ دیپ: ۱۸ مگاپیکسل

class HiDpiRenderService {
  constructor() {
    this.cache = new Map(); // key -> { url, scale, timestamp }
    this.activePdfTasks = new Map(); // key -> pdfjs RenderTask
  }

  // پله‌بندی ضریب زوم برای جلوگیری از ری‌رندرهای تکراری در تغییرات جزئی اسلایدر
  quantizeZoom(zoomLevel = 1.0) {
    const z = Math.max(0.5, Math.min(3.5, Number(zoomLevel) || 1.0));
    return Math.round(z * 4) / 4; // گام‌های 0.25 (1.0, 1.25, 1.5, 1.75, 2.0, ...)
  }

  // مرحله ۲۲ — کلیدِ کش، فقط فایل/صفحه/زوم است؛ برشِ مرحلهٔ ۲۰،
  // از مرحلهٔ ۲۱ حذف شده و دیگر برنگشته است.
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

  // تبدیلِ بوم به Blobِ PNG در تردِ اصلی (فقط Fallback، وقتی Worker
  // در دسترس نیست). toBlob ناهمگام است و تردِ اصلی را قفل نمی‌کند.
  canvasToPngBlob(canvas) {
    return new Promise((resolve) => {
      try {
        canvas.toBlob((blob) => resolve(blob || null), 'image/png');
      } catch (_) {
        resolve(null);
      }
    });
  }

  // پاس دوم رندر کریستالی برای صفحات PDF — مرحلهٔ ۲۲:
  //   ۱) مقیاسِ سوپرسمپلِ بالا (فرمولِ دقیقِ پرامپت، هم‌ارزِ
  //      مرحلهٔ ۱۹): کفِ ۳٫۰، با سقف‌هایِ یکنواختِ ۴۶۰۸/۱۸MP که
  //      نسبتِ ابعاد را در هر دو محور، ۱۰۰٪ حفظ می‌کنند.
  //   ۲) رندرِ pdf.js رویِ بومِ موقت (بدونِ هیچ Downscaleای).
  //   ۳) بهبودِ دو موتوره + انکودِ PNG در WebWorker؛ خروجی، یک
  //      نشانیِ blob: است که در کشِ LRU می‌نشیند.
  // نسبتِ ابعاد، از ویوپورتِ بدونِ چرخش خوانده می‌شود (همان رفتارِ
  // لایهٔ پایه)، چون چرخشِ برنامه با CSS اعمال می‌شود، نه با
  // ویوپورتِ pdf.js؛ دادنِ rotation به getViewport، تصویر را
  // پیش‌چرخیده می‌کرد و چرخشِ CSS، آن را دوباره می‌چرخاند.
  async renderPdfPageHiDpi({ pdfDoc, filePath, pageNumber, zoomLevel = 1.0, displayWidthPx = 0, onPageRatio = null }) {
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

      // ثبتِ فوریِ نسبتِ واقعیِ صفحه (مرحلهٔ ۲۲، بخش ۲): کادرِ
      // صفحه، دقیقاً هم‌اندازهٔ تصویرِ واقعی‌اش می‌شود.
      if (typeof onPageRatio === 'function') {
        try { onPageRatio(baseH / baseW); } catch (_) {}
      }

      // فرمولِ دقیقِ مقیاسِ سوپرسمپل (پرامپتِ مرحلهٔ ۲۲):
      // در dpr=1 و نمایشِ ۱۰۰۰ پیکسل برایِ صفحهٔ ۵۹۵ نقطه‌ای،
      // minDisplayScale می‌شود ۴٫۲۰؛ یعنی دقیقاً همان مقیاسِ
      // مرحلهٔ ۱۹ که متن‌ها را فوق‌العاده تیز نشان می‌داد.
      const effectiveDpr = Math.min(Math.max(window.devicePixelRatio || 1, 2.0), 2.5);
      const minDisplayScale = displayWidthPx > 0
        ? (displayWidthPx * effectiveDpr * 1.25) / Math.max(1, baseW)
        : 0;
      let targetScale = Math.max(
        this.quantizeZoom(zoomLevel) * effectiveDpr * 1.2,
        minDisplayScale,
        3.0
      );
      // سقف‌هایِ یکنواخت: یک ضریبِ واحد، هر دو محور را با هم
      // پایین می‌آورد تا نسبتِ ابعاد، ۱۰۰٪ حفظ شود.
      const maxSide = Math.max(baseW, baseH) * targetScale;
      if (maxSide > MAX_CANVAS_DIMENSION) {
        targetScale *= MAX_CANVAS_DIMENSION / maxSide;
      }
      const rawArea = baseW * targetScale * (baseH * targetScale);
      if (rawArea > MAX_CANVAS_AREA) {
        targetScale *= Math.sqrt(MAX_CANVAS_AREA / rawArea);
      }

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

      // بهبودِ دو موتوره + انکودِ PNG در WebWorker (۰ میلی‌ثانیه
      // قفلِ تردِ اصلی). اگر Worker نبود، همان بومِ سوپرسمپل،
      // در تردِ اصلی به PNG تبدیل می‌شود (تیزیِ مرحلهٔ ۱۹، بدونِ
      // موتورِ بهبود — نه تاریِ مرحلهٔ ۲۱).
      let blob = null;
      try {
        const result = await processPdfPageInWorker(canvas);
        if (result && result.blob) {
          blob = result.blob;
        } else if (result && result.bitmap) {
          const tmp = document.createElement('canvas');
          tmp.width = result.bitmap.width;
          tmp.height = result.bitmap.height;
          const tmpCtx = tmp.getContext('2d');
          tmpCtx.drawImage(result.bitmap, 0, 0);
          try { result.bitmap.close(); } catch (_) {}
          blob = await this.canvasToPngBlob(tmp);
          tmp.width = 0;
          tmp.height = 0;
        }
      } catch (_) {
        blob = null;
      }
      if (!blob) {
        blob = await this.canvasToPngBlob(canvas);
      }

      canvas.width = 0;
      canvas.height = 0;
      canvas = null;

      if (blob) {
        const url = URL.createObjectURL(blob);
        this.storeInCache(cacheKey, url, targetScale);
        return url;
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
        if (entry) this.revokeEntry(entry);
        this.cache.delete(key);
      }
    }
  }
}

export const hiDpiRenderService = new HiDpiRenderService();
export default hiDpiRenderService;
