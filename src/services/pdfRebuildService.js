// مرحله ۱۰: بازسازیِ «تمیزِ» PDF از سندِ بازشده در pdf.js.
//
// ایده: وقتی فایلی در pdf.js باز شده است (رمزِ خالی، رمزِ نشست، یا
// حتی AES-256)، سندِ رمزگشایی‌شده همین حالا در حافظهٔ رندرر است.
// به‌جای حدس زدنِ رمز یا دستکاریِ دیکشنریِ /Encrypt با pdf-lib،
// هر صفحه با همان سندِ بازشده رندر می‌شود (بوم + overlayِ
// حاشیه‌نویسی‌ها) و در یک سندِ تازهٔ pdf-lib (PDFDocument.create())
// بدونِ هیچ قفلی چیده می‌شود. خروجی، ۱۰۰٪ استاندارد و بدونِ
// /Encrypt است و روی آن، ذخیرهٔ معمولیِ حاشیه‌نویسی کار می‌کند.
//
// حدِ صادقانه: بازسازی، رستری است. لایهٔ متن، بردارها، Outline و
// لینک‌ها در خودِ PDF حفظ نمی‌شوند (فونتِ استانداردِ pdf-lib
// نمی‌تواند متنِ فارسی/غیرلاتین را به‌صورتِ نامرئیِ سالم بنویسد؛
// نوشتنِ آن با فونتِ اشتباه، جستجو/کپی را خراب می‌کند). پس
// بازسازی، فقط «مسیرِ آخر» برای فایل‌هایی است که pdf-lib ذاتاً
// نمی‌تواند رمزگشایی کند (AES-256، ObjStm)؛ برای بقیه، مسیرِ
// بی‌اتلافِ «رمزگشایی-اول»ِ saver اولویت دارد و دست نمی‌خورد.
// مرحله ۱۱: در زمانِ پرینت، متنِ هر صفحه هم از pdf.js استخراج و
// به‌صورتِ ایندکسِ جستجویِ کناری (<خروجی>.search.json در پوشهٔ
// داده) ذخیره می‌شود تا جستجویِ Ctrl+F با هایلایتِ دقیق، دست‌کم
// در همین برنامه، روی فایلِ بازسازی‌شده هم کار کند. در
// خواننده‌های دیگر، فایلِ بازسازی‌شده همچنان بدونِ لایهٔ متن است.
//
// این فایل، فقط در رندرر (Electron) اجرا می‌شود. رندرِ پیش‌فرض،
// از canvasِ DOM استفاده می‌کند؛ برای تستِ Node، renderPage
// قابلِ تزریق است تا منطقِ اسمبلی، بدونِ DOM هم آزمون شود.
// overlayها باید با cssRotation=0 ساخته شده باشند (قابِ طبیعیِ
// صفحه) تا با viewportِ طبیعیِ این‌جا هم‌تراز شوند.

import { PDFDocument } from 'pdf-lib';
import { normalizeSearchText } from '../utils/persianSearch';

// مرحلهٔ ۳۳ — بازگشتِ آگاهانه به سرعت، به دستورِ صریحِ کاربر:
// مقیاسِ ۱٫۵، کیفیتِ JPEGِ ۰٫۸۴، سقفِ ۴٫۵ مگاپیکسل و سقفِ ضلعِ
// ۲۴۰۰ پیکسل، دسته‌هایِ ۴ صفحه‌ای. هشدارِ صریح: مرحلهٔ ۳۰،
// مقیاس را از ۱٫۴۵/۰٫۸۰ به ۲٫۰/۰٫۹۲ بالا برده بود چون افتِ
// کیفیت، «بی‌کیفیت شدنِ کپیِ بازسازی‌شده و خراب شدنِ زوم» را
// ساخته بود؛ این مرحله، آگاهانه به سمتِ سرعت برمی‌گردد و
// نسخهٔ بازسازی‌شده، نرم‌تر از خروجیِ مرحلهٔ ۳۰ خواهد بود.
// تبدیلِ JPEG، از همان اول هم باینری و ناهمگام بود
// (canvasToJpegBytes با canvas.toBlob)؛ هیچ toDataURLای در این
// مسیر نبود که حذف شود — کندیِ واقعی، پیکسلِ زیادِ هر صفحه
// بود، نه رشتهٔ Base64.
// مرحلهٔ ۳۴ — بازگشتِ دوم به سرعت، به دستورِ صریحِ کاربر:
// مقیاسِ ۱٫۳۵، کیفیتِ JPEGِ ۰٫۸۲، سقفِ ۳٫۲ مگاپیکسل و سقفِ ضلعِ
// ۲۰۰۰ پیکسل، دسته‌هایِ ۲ صفحه‌ایِ ترتیبی (نه موازیِ ۴تایی).
// آزادسازیِ بوم و cleanupِ صفحه، فقط پس از اتمامِ کاملِ دسته
// انجام می‌شود تا cleanupِ یک صفحه، منابعِ مشترکِ صفحه‌هایِ
// دیگرِ همان دسته را در ورکرِ pdf.js خراب نکند. اگر toBlob
// خالی برگرداند، toDataURL پشتیبان است تا هیچ صفحه‌ای، کلِ
// بازسازی را شکست ندهد. هشدارِ پابرجا: نسخهٔ بازسازی‌شده،
// نرم‌تر از خروجیِ مرحلهٔ ۳۰ (۲٫۰/۰٫۹۲) خواهد بود.
export const DEFAULT_REBUILD_SCALE = 1.35;
export const REBUILD_JPEG_QUALITY = 0.82;
// سقفِ پیکسلِ بوم: بوم‌های غول‌پیکر، در Chromium خراب می‌شوند.
const MAX_REBUILD_CANVAS_PIXELS = 3200000;
// سقفِ ضلعِ بومِ بازسازی (مرحلهٔ ۳۳).
const MAX_REBUILD_CANVAS_SIDE = 2000;
// مرحله ۱۱/۳۳: دسته‌های ۴ صفحه‌ایِ موازی برای فازِ رندر؛ اسمبلیِ
// pdf-lib (embedJpg/addPage/drawImage) همچنان ترتیبی است، چون
// جهشِ (mutation) سندِ pdf-lib موازی‌پذیر نیست.
const REBUILD_BATCH_SIZE = 2;

// مرحله ۱۱: همان منطقِ تشخیصِ جهتِ PdfViewer.extractPageText
// (بدونِ وابستگی به pdfjsLib): ضربِ ماتریسِ آفین و تشخیصِ
// کاراکترِ قویِ اول.
const RTL_STRONG_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LTR_STRONG_RE = /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/;
function isRtlSearchItem(item, str) {
  if (item && typeof item.dir === 'string') {
    if (item.dir === 'rtl') return true;
    if (item.dir === 'ltr') return false;
  }
  const text = str || '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (RTL_STRONG_RE.test(ch)) return true;
    if (LTR_STRONG_RE.test(ch)) return false;
  }
  return false;
}
function multiplyTransform(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

// مرحله ۱۱: استخراجِ متنِ یک صفحه با همان ریاضیِ مستطیلِ
// PdfViewer (item.width/item.height، درصدهای viewport) تا
// ایندکسِ کناری، دقیقاً با موتورِ جستجویِ PdfViewer سازگار باشد.
// شکستِ استخراجِ یک صفحه، هرگز کلِ بازسازی را خراب نمی‌کند.
async function extractPageTextEntry(pdfPage, viewport) {
  try {
    const textContent = await pdfPage.getTextContent();
    const items = [];
    let text = '';
    for (const item of (textContent && textContent.items) || []) {
      const str = item.str || '';
      const start = text.length;
      text += str;
      const end = text.length;
      if (!str) continue;
      const tx = multiplyTransform(viewport.transform, item.transform);
      const scaleY = Math.hypot(tx[2], tx[3]);
      const fontHeight = scaleY;
      const vertical = Math.abs(tx[1]) > Math.abs(tx[0]);
      const advance = vertical ? (item.height || 0) : (item.width || 0);
      let rect;
      if (vertical) {
        rect = {
          left: (tx[4] / viewport.width) * 100,
          top: ((tx[5] - advance) / viewport.height) * 100,
          width: (fontHeight / viewport.width) * 100,
          height: (advance / viewport.height) * 100,
        };
      } else {
        rect = {
          left: (tx[4] / viewport.width) * 100,
          top: ((tx[5] - fontHeight) / viewport.height) * 100,
          width: (advance / viewport.width) * 100,
          height: (fontHeight / viewport.height) * 100,
        };
      }
      items.push({ start, end, rect, vertical, rtl: isRtlSearchItem(item, str) });
    }
    if (!text) return null;
    const normalized = normalizeSearchText(text);
    const strippedChars = [];
    const strippedToOriginal = [];
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\u200C' || ch === '\u200D') continue;
      strippedChars.push(ch);
      strippedToOriginal.push(i);
    }
    return { text, normalized, stripped: strippedChars.join(''), strippedToOriginal, items };
  } catch (_) {
    return null;
  }
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch (_) {
      resolve(null);
    }
  });
}

async function defaultRenderPage(pdfPage, scale, overlay) {
  const viewport = pdfPage.getViewport({ scale });
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
  await renderTask.promise;
  if (overlay && (overlay.overlayPng || overlay.highlightPng)) {
    if (overlay.overlayPng) {
      const img = await loadImageFromDataUrl(overlay.overlayPng);
      if (img) ctx.drawImage(img, 0, 0, width, height);
    }
    if (overlay.highlightPng) {
      const img = await loadImageFromDataUrl(overlay.highlightPng);
      if (img) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(img, 0, 0, width, height);
        ctx.restore();
      }
    }
  }
  return canvas;
}

function canvasToJpegBytes(canvas, quality) {
  // مرحلهٔ ۳۴ — اگر toBlob خالی برگرداند (یا arrayBuffer آن
  // شکست خورد)، بلافاصله با toDataURL پشتیبان گرفته می‌شود تا
  // تحتِ هیچ شرایطی، یک صفحه، کلِ بازسازی را شکست ندهد.
  function fallbackToDataUrl(resolve, reject) {
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const base64 = (dataUrl.split(',')[1] || '');
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      resolve(bytes);
    } catch (err) {
      reject(err);
    }
  }
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          blob.arrayBuffer().then(
            (ab) => resolve(new Uint8Array(ab)),
            () => fallbackToDataUrl(resolve, reject)
          );
          return;
        }
        fallbackToDataUrl(resolve, reject);
      }, 'image/jpeg', quality);
    } catch (_) {
      fallbackToDataUrl(resolve, reject);
    }
  });
}

export async function rebuildEditablePdfFromPdfJs({
  pdfDoc,
  preparedPages,
  onProgress,
  signal,
  scale = DEFAULT_REBUILD_SCALE,
  jpegQuality = REBUILD_JPEG_QUALITY,
  renderPage = defaultRenderPage,
  includeSearchIndex = true,
}) {
  if (!pdfDoc || typeof pdfDoc.getPage !== 'function' || !Number.isFinite(pdfDoc.numPages) || pdfDoc.numPages < 1) {
    throw new Error('سندِ PDFِ بازشده برای بازسازی در دسترس نیست.');
  }
  const total = pdfDoc.numPages;
  const newDoc = await PDFDocument.create();
  try {
    const metadata = typeof pdfDoc.getMetadata === 'function' ? await pdfDoc.getMetadata() : null;
    const info = metadata && metadata.info ? metadata.info : null;
    if (info && typeof info.Title === 'string' && info.Title) newDoc.setTitle(info.Title);
    if (info && typeof info.Author === 'string' && info.Author) newDoc.setAuthor(info.Author);
  } catch (_) {}
  try { newDoc.setCreator('ComicReader'); } catch (_) {}

  const searchPages = {};
  for (let batchStart = 1; batchStart <= total; batchStart += REBUILD_BATCH_SIZE) {
    // مرحلهٔ ۳۰ — لغوِ دستی: در مرزِ دسته‌هایِ ۴ صفحه‌ای بررسی
    // می‌شود؛ دستهٔ در حالِ اجرا تمام می‌شود و بعد، هیچ صفحهٔ
    // تازه‌ای رندر نمی‌شود و هیچ فایلی نوشته نمی‌شود.
    if (signal && signal.aborted) {
      const abortErr = new Error('عملیاتِ بازسازی لغو شد.');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    const batchEnd = Math.min(total, batchStart + REBUILD_BATCH_SIZE - 1);
    const batchNums = [];
    for (let n = batchStart; n <= batchEnd; n++) batchNums.push(n);
    // فازِ رندرِ موازی: getPage + رندرِ بوم + JPEG + استخراجِ متن،
    // برای حداکثر ۴ صفحه هم‌زمان. هر صفحه، بومِ مستقلِ خودش را
    // دارد و رندرهای pdf.js روی صفحه‌های متفاوت، مستقل‌اند.
    const rendered = await Promise.all(batchNums.map(async (pageNum) => {
      const pdfPage = await pdfDoc.getPage(pageNum);
      const natural = pdfPage.getViewport({ scale: 1 });
      const pagePixels = Math.max(1, natural.width) * Math.max(1, natural.height);
      const effectiveScale = Math.min(scale, Math.sqrt(MAX_REBUILD_CANVAS_PIXELS / pagePixels), MAX_REBUILD_CANVAS_SIDE / Math.max(natural.width, natural.height));
      const overlay = preparedPages && preparedPages[pageNum] ? preparedPages[pageNum] : null;
      const canvas = await renderPage(pdfPage, effectiveScale, overlay);
      const jpegBytes = await canvasToJpegBytes(canvas, jpegQuality);
      const entry = includeSearchIndex ? await extractPageTextEntry(pdfPage, natural) : null;
      // مرحلهٔ ۳۴ — آزادسازی، دیگر وسطِ دسته نیست: بوم و شیءِ
      // صفحه تا پایانِ کاملِ دسته زنده می‌مانند و پس از Promise.all
      // (پایین‌تر) آزاد می‌شوند.
      return { pageNum, natural, jpegBytes, entry, canvas, pdfPage };
    }));
    // مرحلهٔ ۳۴ — آزادسازیِ دسته، پس از اتمامِ کاملِ آن: بوم‌ها
    // خالی و صفحه‌هایِ pdf.js، cleanup می‌شوند (پیش از اسمبلی،
    // چون اسمبلی فقط jpegBytes و entry را می‌خواهد).
    for (const renderedPage of rendered) {
      try { if (renderedPage.canvas) { renderedPage.canvas.width = 0; renderedPage.canvas.height = 0; } } catch (_) {}
      try { if (renderedPage.pdfPage && typeof renderedPage.pdfPage.cleanup === 'function') renderedPage.pdfPage.cleanup(); } catch (_) {}
    }
    // فازِ اسمبلیِ ترتیبی: ترتیبِ صفحه‌ها حفظ می‌شود و جهشِ سند،
    // هرگز موازی نمی‌شود.
    for (const renderedPage of rendered) {
      const embedded = await newDoc.embedJpg(renderedPage.jpegBytes);
      const page = newDoc.addPage([renderedPage.natural.width, renderedPage.natural.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: renderedPage.natural.width, height: renderedPage.natural.height });
      if (renderedPage.entry && renderedPage.entry.text) {
        searchPages[renderedPage.pageNum] = renderedPage.entry;
      }
      if (typeof onProgress === 'function') {
        try { onProgress(renderedPage.pageNum, total); } catch (_) {}
      }
    }
    // ییلد تا UI بینِ دسته‌ها نفس بکشد (رندرِ صفحه می‌تواند سنگین باشد).
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const bytes = await newDoc.save();
  return {
    bytes,
    pageCount: total,
    searchIndex: { version: 1, pageCount: total, pages: searchPages },
  };
}

// تبدیلِ بایت‌ها به Base64 برای IPC (رندرر، Buffer ندارد؛ در
// محیطِ Node، Buffer به کار می‌رود). تکه‌تکه انجام می‌شود تا
// رشته‌های خیلی بزرگ، پشتهٔ فراخوانی را پر نکنند.
export function rebuildPdfBytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return Buffer.from(u8).toString('base64');
  }
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
