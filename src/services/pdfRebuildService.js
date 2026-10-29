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
// لینک‌ها حفظ نمی‌شوند (فونتِ استانداردِ pdf-lib نمی‌تواند متنِ
// فارسی/غیرلاتین را به‌صورتِ نامرئیِ سالم بنویسد؛ نوشتنِ آن با
// فونتِ اشتباه، جستجو/کپی را خراب می‌کند). پس بازسازی، فقط
// «مسیرِ آخر» برای فایل‌هایی است که pdf-lib ذاتاً نمی‌تواند
// رمزگشایی کند (AES-256، ObjStm)؛ برای بقیه، مسیرِ بی‌اتلافِ
// «رمزگشایی-اول»ِ saver اولویت دارد و دست نمی‌خورد.
//
// این فایل، فقط در رندرر (Electron) اجرا می‌شود. رندرِ پیش‌فرض،
// از canvasِ DOM استفاده می‌کند؛ برای تستِ Node، renderPage
// قابلِ تزریق است تا منطقِ اسمبلی، بدونِ DOM هم آزمون شود.
// overlayها باید با cssRotation=0 ساخته شده باشند (قابِ طبیعیِ
// صفحه) تا با viewportِ طبیعیِ این‌جا هم‌تراز شوند.

import { PDFDocument } from 'pdf-lib';

export const DEFAULT_REBUILD_SCALE = 2;
export const REBUILD_JPEG_QUALITY = 0.92;
// سقفِ پیکسلِ بوم: بوم‌های غول‌پیکر، در Chromium خراب می‌شوند.
const MAX_REBUILD_CANVAS_PIXELS = 16000000;

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
  scale = DEFAULT_REBUILD_SCALE,
  jpegQuality = REBUILD_JPEG_QUALITY,
  renderPage = defaultRenderPage,
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

  for (let pageNum = 1; pageNum <= total; pageNum++) {
    const pdfPage = await pdfDoc.getPage(pageNum);
    const natural = pdfPage.getViewport({ scale: 1 });
    const pagePixels = Math.max(1, natural.width) * Math.max(1, natural.height);
    const effectiveScale = Math.min(scale, Math.sqrt(MAX_REBUILD_CANVAS_PIXELS / pagePixels));
    const overlay = preparedPages && preparedPages[pageNum] ? preparedPages[pageNum] : null;
    const canvas = await renderPage(pdfPage, effectiveScale, overlay);
    const jpegBytes = await canvasToJpegBytes(canvas, jpegQuality);
    const embedded = await newDoc.embedJpg(jpegBytes);
    const page = newDoc.addPage([natural.width, natural.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: natural.width, height: natural.height });
    if (typeof onProgress === 'function') {
      try { onProgress(pageNum, total); } catch (_) {}
    }
    // ییلد تا UI بینِ صفحه‌ها نفس بکشد (رندرِ صفحه می‌تواند سنگین باشد).
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const bytes = await newDoc.save();
  return { bytes, pageCount: total };
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
