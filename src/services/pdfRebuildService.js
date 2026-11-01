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

// مرحلهٔ ۳۰ — بازگشتِ آگاهانه به مقیاسِ ۲٫۰ و کیفیتِ ۰٫۹۲:
// مرحلهٔ ۱۱، این دو را برایِ کم‌شدنِ ~۷۰٪ حجم پایین آورده بود،
// ولی همان افت، علتِ «بی‌کیفیت شدنِ کپیِ بازسازی‌شده و خراب
// شدنِ زوم» است: صفحهٔ رستریِ ۱٫۴۵x با JPEGِ ۰٫۸۰، در زومِ
// ۳۵۰٪، دیگر جزئیاتی برایِ دیپ‌رندر ندارد. بازسازی، همچنان
// رستری است (مسیرِ آخر) ولی با وضوحِ بیشتر؛ حجمِ خروجی،
// دوباره بزرگ‌تر می‌شود و سقفِ ۱۶ مگاپیکسلِ بوم، سرِ جایش است.
export const DEFAULT_REBUILD_SCALE = 2.0;
export const REBUILD_JPEG_QUALITY = 0.92;
// سقفِ پیکسلِ بوم: بوم‌های غول‌پیکر، در Chromium خراب می‌شوند.
const MAX_REBUILD_CANVAS_PIXELS = 16000000;
// مرحله ۱۱: دسته‌های ۳ صفحه‌ایِ موازی برای فازِ رندر؛ اسمبلیِ
// pdf-lib (embedJpg/addPage/drawImage) همچنان ترتیبی است، چون
// جهشِ (mutation) سندِ pdf-lib موازی‌پذیر نیست.
const REBUILD_BATCH_SIZE = 3;

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
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('تبدیلِ بومِ صفحه به تصویر انجام نشد.'));
          return;
        }
        blob.arrayBuffer().then(
          (ab) => resolve(new Uint8Array(ab)),
          (err) => reject(err)
        );
      }, 'image/jpeg', quality);
    } catch (err) {
      reject(err);
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
    // مرحلهٔ ۳۰ — لغوِ دستی: در مرزِ دسته‌هایِ ۳ صفحه‌ای بررسی
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
    // برای حداکثر ۳ صفحه هم‌زمان. هر صفحه، بومِ مستقلِ خودش را
    // دارد و رندرهای pdf.js روی صفحه‌های متفاوت، مستقل‌اند.
    const rendered = await Promise.all(batchNums.map(async (pageNum) => {
      const pdfPage = await pdfDoc.getPage(pageNum);
      const natural = pdfPage.getViewport({ scale: 1 });
      const pagePixels = Math.max(1, natural.width) * Math.max(1, natural.height);
      const effectiveScale = Math.min(scale, Math.sqrt(MAX_REBUILD_CANVAS_PIXELS / pagePixels));
      const overlay = preparedPages && preparedPages[pageNum] ? preparedPages[pageNum] : null;
      const canvas = await renderPage(pdfPage, effectiveScale, overlay);
      const jpegBytes = await canvasToJpegBytes(canvas, jpegQuality);
      const entry = includeSearchIndex ? await extractPageTextEntry(pdfPage, natural) : null;
      return { pageNum, natural, jpegBytes, entry };
    }));
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
