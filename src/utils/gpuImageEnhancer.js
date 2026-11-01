// ============================================================================
// src/utils/gpuImageEnhancer.js — مرحله ۲۸
// بازنویسیِ سوم: این فایل، حالا فقط یک کار می‌کند: انکودِ PNGِ سبک
// در Worker، بدونِ اینکه تردِ اصلی را قفل کند. موتورهایِ قدیمیِ
// مرحلهٔ ۲۵ (فیلترِ دوطرفهٔ WebGL2/CPU و آپ‌اسکیلِ آناتومی) و
// تابعِ وابسته به موتورِ حذف‌شده در مرحلهٔ ۲۸ پاک شد؛ چون از مرحلهٔ ۲۶ در مسیرِ زنده صدا زده
// نمی‌شدند و نگه‌داشتن‌شان فقط حجم و سردرگمی می‌آورد.
//
// کدِ ورکر، یک رشتهٔ ثابت است، نه خروجیِ fn.toString(). هیچ
// تابعی به رشته تبدیل نمی‌شود، هیچ حلقهٔ دستکاریِ پیکسلی در کار
// نیست، و هیچ getImageData یا putImageDataای وجود ندارد. ورکر
// فقط بیت‌مپ را می‌گیرد، رویِ OffscreenCanvas می‌کشد و PNG
// برمی‌گرداند — همین.
//
// قراردادِ encodeCanvasToLightweightPngUrl(canvas):
//   - اول، با createImageBitmap یک کپیِ سخت‌افزاری از بوم گرفته
//     می‌شود؛ بومِ اصلی تا زمانِ دریافتِ جوابِ ورکر، دست‌نخورده
//     نگه داشته می‌شود تا اگر ورکر در محیطی نبود، بلافاصله رویِ
//     همان بومِ اصلی، toBlobِ PNG اجرا شود.
//   - اگر ورکر جواب داد → همان blob به نشانیِ blob: تبدیل می‌شود.
//   - اگر ورکر نبود، خطا داد یا در ۶۰ ثانیه جواب نداد → Fallbackِ
//     تردِ اصلی (canvas.toBlob با image/png) اجرا می‌شود.
//   - هیچ‌وقت استثنا پرتاب نمی‌شود؛ در بدترین حالت، null برمی‌گردد
//     و فراخواننده، لایهٔ قبلی (یا بومِ پایه) را نگه می‌دارد.
// ============================================================================

// کدِ ورکرِ انکودرِ خالصِ PNG — رشتهٔ ثابت، بدونِ toString.
// مرحلهٔ ۲۹ — ورکر، حالا نوع و کیفیت را هم از پیام می‌گیرد تا
// همان ورکر، هم PNGِ دیپ و هم WebPِ پایه (کیفیتِ ۰٫۹۵) را انکد
// کند؛ برایِ نوع‌هایِ بی‌اتلاف، کیفیت نادیده گرفته می‌شود.
export const PNG_WORKER_CODE = `
self.onmessage = async (e) => {
  const { id, bitmap, type, quality } = e.data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const outType = type || 'image/png';
    const opts = { type: outType };
    if ((outType === 'image/webp' || outType === 'image/jpeg') && typeof quality === 'number') opts.quality = quality;
    const blob = await canvas.convertToBlob(opts);
    self.postMessage({ id, ok: true, blob });
  } catch (err) {
    try { bitmap.close(); } catch (_) {}
    self.postMessage({ id, ok: false });
  }
};
`;

// --- مدیریتِ تک‌نمونهٔ ورکر در تردِ اصلی -------------------------------
let workerInstance = null;
let workerFailed = false;
let nextReqId = 1;
const pendingRequests = new Map();

function getWorker() {
  if (workerInstance) return workerInstance;
  if (workerFailed) return null;
  try {
    const blob = new Blob([PNG_WORKER_CODE], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    // اسکریپت، همان‌جا خوانده شده؛ نشانیِ Blob لازم نیست بماند.
    try { URL.revokeObjectURL(url); } catch (_) {}
    w.onmessage = (e) => {
      const msg = e.data || {};
      const entry = pendingRequests.get(msg.id);
      if (!entry) return;
      pendingRequests.delete(msg.id);
      clearTimeout(entry.timer);
      entry.resolve(msg);
    };
    w.onerror = () => {
      workerFailed = true;
      for (const [, entry] of pendingRequests) {
        clearTimeout(entry.timer);
        entry.resolve({ ok: false });
      }
      pendingRequests.clear();
    };
    workerInstance = w;
    return w;
  } catch (_) {
    workerFailed = true;
    return null;
  }
}

function canvasToBlobFallback(canvas, type, quality) {
  return new Promise((resolve) => {
    try {
      if (type === 'image/webp' || type === 'image/jpeg') {
        canvas.toBlob((blob) => resolve(blob || null), type, quality);
      } else {
        canvas.toBlob((blob) => resolve(blob || null), type || 'image/png');
      }
    } catch (_) {
      resolve(null);
    }
  });
}

function canvasToPngBlobFallback(canvas) {
  return canvasToBlobFallback(canvas, 'image/png');
}

async function encodeCanvasToBlob(canvas, type, quality) {
  try {
    if (!canvas || !canvas.width || !canvas.height) return null;
    const w = getWorker();
    if (w && typeof createImageBitmap === 'function') {
      // کپیِ سخت‌افزاری؛ بومِ اصلی تا جوابِ ورکر، زنده می‌ماند.
      const bitmap = await createImageBitmap(canvas);
      const id = nextReqId++;
      const result = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(id);
          resolve({ ok: false, timeout: true });
        }, 60000);
        pendingRequests.set(id, { resolve, timer });
        try {
          w.postMessage({ id, bitmap, type, quality }, [bitmap]);
        } catch (_) {
          clearTimeout(timer);
          pendingRequests.delete(id);
          resolve({ ok: false });
        }
      });
      if (result.ok && result.blob) return result.blob;
      // ورکر جوابِ خوب نداد → Fallback رویِ همان بومِ اصلی.
    }
    return await canvasToBlobFallback(canvas, type, quality);
  } catch (_) {
    try {
      return await canvasToBlobFallback(canvas, type, quality);
    } catch (_) {
      return null;
    }
  }
}

export async function encodeCanvasToPng(canvas) {
  return encodeCanvasToBlob(canvas, 'image/png');
}

// مرحلهٔ ۲۹ — انکدِ WebPِ پایه (کیفیتِ ۰٫۹۵) با همان ورکر؛ در
// بدترین حالت null برمی‌گردد و هرگز throw نمی‌کند.
export async function encodeCanvasToWebpUrl(canvas) {
  try {
    const blob = await encodeCanvasToBlob(canvas, 'image/webp', 0.95);
    if (!blob) return null;
    try {
      const url = URL.createObjectURL(blob);
      // مرحلهٔ ۳۰ — آزادسازیِ بومِ موقت پس از انکد (مثلِ PNG).
      try { canvas.width = 0; canvas.height = 0; } catch (_) {}
      return url;
    } catch (_) {
      return null;
    }
  } catch (_) {
    return null;
  }
}

// مرحلهٔ ۲۸ — wrapperِ لایهٔ PNGِ سبک: blob را به نشانیِ blob:
// تبدیل می‌کند؛ در بدترین حالت null برمی‌گرداند و هرگز throw
// نمی‌کند. آزادسازیِ نشانی، با فراخواننده است (revoke).
export async function encodeCanvasToLightweightPngUrl(canvas) {
  try {
    const blob = await encodeCanvasToPng(canvas);
    if (!blob) return null;
    try {
      const url = URL.createObjectURL(blob);
      // مرحلهٔ ۳۰ — بومِ موقت، پس از انکد آزاد می‌شود (width=0):
      // فراخواننده (PdfViewer) هم همین کار را می‌کند؛ آزادسازیِ
      // دوباره، no-op است و هیچ فراخوانندهٔ دیگری، این بوم را
      // پس از انکد، دوباره استفاده نمی‌کند.
      try { canvas.width = 0; canvas.height = 0; } catch (_) {}
      return url;
    } catch (_) {
      return null;
    }
  } catch (_) {
    return null;
  }
}

export default { PNG_WORKER_CODE, encodeCanvasToPng, encodeCanvasToLightweightPngUrl, encodeCanvasToWebpUrl };
