// سرویس رندر دو مرحله‌ای باکیفیت (Dual-Pass Progressive HiDPI Rendering)
// مرحله ۲۰ — لایهٔ دیپ دیگر URL و PNG نیست: خروجی، یک ImageBitmapِ
// مستقیمِ کارتِ گرافیک است که رویِ بومِ صفحه با drawImage می‌نشیند.
// وظیفه: حذف کامل تاری صفحات PDF پس از زوم یا توقف اسکرول.
import { enhanceRenderedPageCanvas } from '../utils/gpuImageEnhancer';

const MAX_HIDPI_CACHE_ENTRIES = 16;
const MAX_CANVAS_DIMENSION = 6144; // سقفِ ضلعِ بوم در مرحله ۱۸: ۶۱۴۴ (زومِ ناحیه‌ایِ ۳٫۵x با dpr بالا، بیش از ۴۰۹۶ پیکسل می‌خواهد)
const MAX_CANVAS_AREA = 24000000; // سقفِ مساحتِ بوم در مرحله ۱۸: ۲۴ مگاپیکسل

class HiDpiRenderService {
  constructor() {
    this.cache = new Map(); // key -> { drawable, isBitmap, scale, timestamp }
    this.activePdfTasks = new Map(); // key -> pdfjs RenderTask
  }

  // پله‌بندی ضریب زوم برای جلوگیری از ری‌رندرهای تکراری در تغییرات جزئی اسلایدر
  quantizeZoom(zoomLevel = 1.0) {
    const z = Math.max(0.5, Math.min(3.5, Number(zoomLevel) || 1.0));
    return Math.round(z * 4) / 4; // گام‌های 0.25 (1.0, 1.25, 1.5, 1.75, 2.0, ...)
  }

  // محاسبه مقیاس کریستالی بر اساس زوم و تراکم پیکسلی مانیتور (DevicePixelRatio)
  computeTargetScale(zoomLevel = 1.0, isPdf = true) {
    // مرحله ۱۸ — فرمولِ سوپرشارپ: کفِ تراکمِ پیکسلیِ ۱٫۵ (تا در
    // مانیتورهایِ dpr=1 هم، رندر از نمایش بزرگ‌تر باشد) با سقفِ
    // ۲٫۵، ضرب در ۱٫۱۵ اورسمپلینگ برایِ تیزیِ لبه‌هایِ فونت و
    // جزئیاتِ آناتومی. سقفِ ۴٫۲ مرحلهٔ ۱۷ حذف شد: در زومِ ناحیه‌ایِ
    // ۳٫۰x با dpr=2، مقیاسِ لازم ۶٫۹ است و سقفِ ۴٫۲، رندر را کوچک‌تر
    // از نمایشِ واقعی می‌کرد و مرورگر با آپ‌اسکیل، آن را تار
    // می‌کرد. سقفِ واقعیِ پیکسل، همان سقف‌هایِ بوم (۶۱۴۴/۲۴MP) است
    // که در ادامهٔ رندر اعمال می‌شوند. پارامترِ isPdf برایِ سازگاریِ
    // امضا مانده و دیگر در فرمول تفاوتی ندارد (quantizeZoom، زوم را
    // در گام‌هایِ ۰٫۲۵ و سقفِ ۳٫۵ نگه می‌دارد تا با کلیدِ کش سازگار
    // بماند؛ پس مقیاسِ خام، حداکثر ۳٫۵ × ۲٫۵ × ۱٫۱۵ است).
    const effectiveDpr = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2.5);
    const qZoom = this.quantizeZoom(zoomLevel);
    const rawScale = qZoom * effectiveDpr * 1.15;
    return Math.max(1.75, Number(rawScale.toFixed(2)));
  }

  // مرحله ۲۰ — کلیدِ کش، برشِ قابل‌مشاهده را هم دارد: یک تایلِ برش‌خورده
  // هرگز نباید به‌جایِ رندرِ کاملِ صفحه برگردد و برعکس. مختصاتِ برش
  // به پیکسلِ CSS گرد می‌شوند تا جابه‌جاییِ یک‌پیکسلی، کش را منفجر نکند.
  buildCacheKey(filePath, pageNumber, zoomLevel, clipRect = null) {
    const normPath = (filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase();
    const qZoom = this.quantizeZoom(zoomLevel);
    const base = `${normPath}::p${pageNumber}::z${qZoom}`;
    if (clipRect && clipRect.width > 0 && clipRect.height > 0) {
      const cx = Math.round(clipRect.x || 0);
      const cy = Math.round(clipRect.y || 0);
      const cw = Math.round(clipRect.width);
      const ch = Math.round(clipRect.height);
      return `${base}::clip:${cx},${cy},${cw},${ch}`;
    }
    return base;
  }

  // دریافتِ drawableیِ HiDPI از کش در صورت وجود (ImageBitmap یا بوم).
  peekHiDpiPage(filePath, pageNumber, zoomLevel, clipRect = null) {
    const key = this.buildCacheKey(filePath, pageNumber, zoomLevel, clipRect);
    const entry = this.cache.get(key);
    if (!entry) return null;

    // به‌روزرسانی اولویت LRU
    this.cache.delete(key);
    this.cache.set(key, { ...entry, timestamp: Date.now() });
    return entry.drawable || null;
  }

  // بستنِ امنِ یک drawable: فقط ImageBitmapها close می‌شوند؛ بومِ
  // معمولی (مسیرِ جایگزینِ بدونِ createImageBitmap) چیزی برایِ بستن ندارد.
  closeDrawable(drawable, isBitmap) {
    if (isBitmap && drawable && typeof drawable.close === 'function') {
      try { drawable.close(); } catch (_) {}
    }
  }

  // تبدیلِ بوم به drawable: اول ImageBitmapِ مستقیمِ GPU؛ اگر در
  // دسترس نبود، خودِ بوم برمی‌گردد (drawImage هر دو را می‌پذیرد).
  // در هیچ حالتی، انکودِ PNG انجام نمی‌شود.
  async toDrawable(canvas) {
    try {
      if (typeof createImageBitmap === 'function') {
        return { drawable: await createImageBitmap(canvas), isBitmap: true };
      }
    } catch (_) {}
    return { drawable: canvas, isBitmap: false };
  }

  // ذخیره در کش با آزادسازی خودکارِ VRAM (LRU Eviction): بیت‌مپِ
  // تخلیه‌شده، بی‌درنگ close می‌شود تا حافظهٔ کارتِ گرافیک آزاد شود.
  storeInCache(key, drawable, isBitmap, scale) {
    if (this.cache.has(key)) {
      const old = this.cache.get(key);
      if (old && old.drawable !== drawable) this.closeDrawable(old.drawable, old.isBitmap);
      this.cache.delete(key);
    }

    this.cache.set(key, {
      drawable,
      isBitmap,
      scale,
      timestamp: Date.now(),
    });

    while (this.cache.size > MAX_HIDPI_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      const oldest = this.cache.get(oldestKey);
      if (oldest) this.closeDrawable(oldest.drawable, oldest.isBitmap);
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

  // پاس دوم رندر کریستالی برای صفحات PDF — مرحله ۲۰: خروجی،
  // ImageBitmap (یا بومِ جایگزین) است، نه URL؛ هیچ PNGای ساخته نمی‌شود.
  // clipRect (پیکسلِ CSS نسبت به گوشهٔ بالایِ چپِ صفحه در نمایشِ
  // فعلی) فقط وقتی معتبر است که displayWidthPx هم داده شده باشد؛
  // در غیرِ این صورت، مسیرِ کاملِ صفحه اجرا می‌شود.
  async renderPdfPageHiDpi({ pdfDoc, filePath, pageNumber, zoomLevel = 1.0, displayWidthPx = 0, clipRect = null }) {
    if (!pdfDoc || !pageNumber) return null;

    const useClip = !!(
      clipRect && clipRect.width > 0 && clipRect.height > 0 &&
      displayWidthPx > 0
    );
    const effClip = useClip ? clipRect : null;
    const cacheKey = this.buildCacheKey(filePath, pageNumber, zoomLevel, effClip);
    const cachedDrawable = this.peekHiDpiPage(filePath, pageNumber, zoomLevel, effClip);
    if (cachedDrawable) return cachedDrawable;

    const pagePrefix = `${(filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase()}::p${pageNumber}::`;
    this.cancelPendingForPage(pagePrefix);

    let canvas = null;
    try {
      const page = await pdfDoc.getPage(pageNumber);
      const unscaledViewport = page.getViewport({ scale: 1.0 });

      // مرحله ۲۰ — دو مسیرِ مقیاس:
      // الف) برشِ قابل‌مشاهده: مقیاس، دقیقاً پیکسلِ دستگاه است
      // (dpr × عرضِ نمایشی / عرضِ پایه)؛ یعنی بومِ برش، دقیقاً
      // (عرضِ برش × dpr) در (ارتفاعِ برش × dpr) پیکسل می‌شود و هیچ
      // سقفِ کاهنده‌ای (۶۱۴۴/۲۴MP) رویِ آن اعمال نمی‌شود، چون برش
      // ذاتاً به ویوپورت محدود است. ماتریسِ transform، مبدأِ رندر را
      // به گوشهٔ برش می‌برد تا فقط همان ناحیه رسم شود.
      // ب) صفحهٔ کامل: همان فرمولِ مرحلهٔ ۱۹ (فرمولِ پایه + کفِ
      // نمایشی) با همان سقف‌هایِ ۶۱۴۴/۲۴MP.
      let targetScale = 0;
      let renderTransform = null;
      let canvasW = 0;
      let canvasH = 0;
      if (effClip) {
        const dpr = window.devicePixelRatio || 1;
        targetScale = (dpr * displayWidthPx) / unscaledViewport.width;
        const ptPerCssX = unscaledViewport.width / displayWidthPx;
        const clipXpt = effClip.x * ptPerCssX;
        const clipYpt = effClip.y * ptPerCssX;
        const clipWpt = effClip.width * ptPerCssX;
        const clipHpt = effClip.height * ptPerCssX;
        canvasW = Math.max(1, Math.floor(clipWpt * targetScale));
        canvasH = Math.max(1, Math.floor(clipHpt * targetScale));
        // transform در فضایِ دستگاه (پس از مقیاسِ ویوپورت) اعمال
        // می‌شود: گوشهٔ برش، دقیقاً رویِ مبدأِ بوم می‌نشیند.
        renderTransform = [1, 0, 0, 1, -clipXpt * targetScale, -clipYpt * targetScale];
      } else {
        targetScale = this.computeTargetScale(zoomLevel, true);
        if (displayWidthPx > 0 && unscaledViewport.width > 0) {
          const dprFloor = Math.max(window.devicePixelRatio || 1, 2.0);
          const requiredScale = (displayWidthPx * dprFloor * 1.25) / unscaledViewport.width;
          if (requiredScale > targetScale) targetScale = Number(requiredScale.toFixed(2));
        }
        const maxSide = Math.max(unscaledViewport.width, unscaledViewport.height);
        if (maxSide * targetScale > MAX_CANVAS_DIMENSION) {
          targetScale = Number((MAX_CANVAS_DIMENSION / maxSide).toFixed(2));
        }
        const rawArea = unscaledViewport.width * targetScale * (unscaledViewport.height * targetScale);
        if (rawArea > MAX_CANVAS_AREA) {
          targetScale = Number((targetScale * Math.sqrt(MAX_CANVAS_AREA / rawArea)).toFixed(2));
        }
        canvasW = Math.floor(unscaledViewport.width * targetScale);
        canvasH = Math.floor(unscaledViewport.height * targetScale);
      }

      const hiViewport = page.getViewport({ scale: targetScale });

      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, canvasW);
      canvas.height = Math.max(1, canvasH);

      // مرحله ۱۷: بومِ استاندارد (بدونِ alpha:false که بافرِ
      // اولیه را سیاه می‌کند)؛ پر کردنِ سفید، پیش از هر کاری.
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const renderTask = page.render({
        canvasContext: ctx,
        viewport: hiViewport,
        intent: 'display',
        ...(renderTransform ? { transform: renderTransform } : {}),
      });

      this.activePdfTasks.set(cacheKey, renderTask);
      await renderTask.promise;
      this.activePdfTasks.delete(cacheKey);

      // مرحله ۲۰ — قانونِ طلایی: هیچ انکودِ PNGای در کار نیست.
      // اول CAS (اگر WebGL2 بود)، بعد ImageBitmapِ مستقیمِ GPU؛ اگر
      // هیچ‌کدام نشد، خودِ بوم (drawImage هر دو را می‌پذیرد).
      let finalDrawable = null;
      let finalIsBitmap = false;
      try {
        const enhanced = await enhanceRenderedPageCanvas(canvas, { sharpness: 0.65 });
        if (enhanced) {
          finalDrawable = enhanced;
          finalIsBitmap = true;
        }
      } catch (_) {}
      if (!finalDrawable) {
        const converted = await this.toDrawable(canvas);
        finalDrawable = converted.drawable;
        finalIsBitmap = converted.isBitmap;
      }

      canvas.width = 0;
      canvas.height = 0;
      canvas = null;

      if (finalDrawable) {
        this.storeInCache(cacheKey, finalDrawable, finalIsBitmap, targetScale);
        return finalDrawable;
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
        if (entry) this.closeDrawable(entry.drawable, entry.isBitmap);
        this.cache.delete(key);
      }
    }
  }
}

export const hiDpiRenderService = new HiDpiRenderService();
export default hiDpiRenderService;