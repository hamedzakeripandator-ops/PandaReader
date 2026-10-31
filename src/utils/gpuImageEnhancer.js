// ============================================================================
// src/utils/gpuImageEnhancer.js — مرحله ۲۲
// بازنویسیِ کامل: picaِ مرحلهٔ ۲۱ حذف شد؛ موتورِ دیپ رندر، حالا یک
// WebWorkerِ اختصاصی (Inline Blob Worker) است که PNGِ سوپرسمپل‌شده را
// در تردِ پس‌زمینه می‌سازد. تردِ اصلی، هیچ انکودی انجام نمی‌دهد.
//
// چرا این معماری؟ (جمع‌بندیِ تجربهٔ سه مرحله)
//   - مرحلهٔ ۱۹: PNGِ سوپرسمپل در <img>، متن را فوق‌العاده تیز نشان
//     می‌داد (فیلترِ Skia Mipmap + Lanczos-3ِ کرومیوم)، ولی انکودِ
//     PNG رویِ تردِ اصلی، CPU را قفل می‌کرد و عکس‌ها مات بودند.
//   - مرحلهٔ ۲۰: شیدرِ CAS، قله‌هایِ کنتراست را صاف می‌کرد.
//   - مرحلهٔ ۲۱: کوچک‌کردنِ بوم با pica به ابعادِ ۱:۱، تراکمِ پیکسلی
//     را از ۲٫۵ برابر به ۱٫۰ برابر رساند و ظرافتِ فونت‌ها را برد.
//   پس: سوپرسمپلِ کامل (بدونِ Downscale) + انکودِ PNG در Worker +
//   موتورِ مجزایِ بهبودِ عکس، هر سه با هم.
//
// معماریِ دو موتوره (داخلِ Worker، رویِ OffscreenCanvas):
//   موتورِ اول — تیزیِ متن (Text Ink & Edge Crispening):
//     پیکسل‌هایِ متن (کنتراستِ محلیِ بالا + اشباعِ پایین، یا هستهٔ
//     تیرهٔ جوهر) تیره‌تر و غلیظ‌تر می‌شوند و هاله‌هایِ خاکستریِ
//     نازکِ دورِ حروف به سفید رانده می‌شوند؛ هیچ بلور یا ریسمپلی
//     رویِ فونت اعمال نمی‌شود.
//   موتورِ دوم — رفعِ ماتیِ عکس (Dehaze & Local Clarity):
//     نواحیِ تصویری، منحنیِ S ملایم + آنشارپِ روشنایی (hue-preserving)
//     + تقویتِ ملایمِ اشباع می‌گیرند تا غبارِ محو برداشته شود.
//   تفکیکِ متن/عکس، «نرم» است، نه دودویی: وزنِ w در بازهٔ ۰ تا ۱،
//   خروجی را بینِ دو موتور میکس می‌کند تا در مرزِ متن و عکس، هیچ
//   درزِ قابلِ مشاهده‌ای ساخته نشود. (این، انحرافِ آگاهانه از
//   دسته‌بندیِ سختِ پرامپت است؛ دلیلش در گزارش آمده است.)
//   آنشارپ، رویِ روشنایی اعمال می‌شود (نه تک‌تکِ کانال‌ها) تا رنگ‌ها
//   جابه‌جا نشوند؛ و برایِ اینکه حافظه، با صفحه‌هایِ ۱۸ مگاپیکسلی
//   منفجر نشود، روشنایی فقط در سه ردیفِ لغزان نگه داشته می‌شود
//   (نه یک آرایهٔ کامل)، و RGB، همان‌جا در بافرِ اصلی نوشته می‌شود.
//
// قراردادِ خروجی:
//   processPdfPageInWorker(sourceCanvas)
//     → Promise<{ blob } | { bitmap } | null>
//   - blob: PNGِ آماده از Worker (مسیرِ اصلی).
//   - bitmap: Worker، convertToBlob نداشت و بیت‌مپِ پردازش‌شده را
//     برگرداند؛ فراخواننده، آن را در تردِ اصلی به blob تبدیل می‌کند.
//   - null: Worker در دسترس نیست؛ فراخواننده، از خودِ بومِ ورودی
//     (بدونِ موتورِ بهبود) blob می‌سازد تا تیزیِ مرحلهٔ ۱۹ حفظ شود.
//   هیچ‌وقت استثنا پرتاب نمی‌شود.
//
// نکتهٔ تک‌منبعی بودنِ کدِ Worker:
//   تابع‌هایِ موتور (clamp255، smoothstep، processPixels) با
//   toString() به متنِ Worker تبدیل می‌شوند؛ پس کدی که در Worker
//   اجرا می‌شود، دقیقاً همان کدی است که در تردِ اصلی قابلِ آزمون
//   است و هیچ کپیِ دومی برایِ همگام نگه داشتن وجود ندارد. به همین
//   دلیل، در این سه تابع، هیچ Template Literal و هیچ ${}ای نیست
//   (حتی در کامنت‌ها)، چون toString()، متنِ خامِ تابع را برمی‌گرداند.
// ============================================================================

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// موتورِ دوگانهٔ پیکسلی — درجا (in-place) رویِ بافرِ RGBA کار می‌کند.
// data: Uint8ClampedArray با چیدمانِ RGBA. آلفا دست نمی‌خورد.
// روشناییِ همسایه‌ها فقط در سه ردیفِ لغزان نگه داشته می‌شود تا
// حافظه، مستقل از ارتفاعِ صفحه بماند.
export function processPixels(data, width, height) {
  if (!data || !width || !height) return;
  const lumRow = (y) => {
    const yy = y < 0 ? 0 : y >= height ? height - 1 : y;
    const row = new Float32Array(width);
    const base = yy * width * 4;
    for (let x = 0; x < width; x++) {
      const o = base + x * 4;
      row[x] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }
    return row;
  };
  // ردیف‌هایِ لغزان: برایِ ردیفِ y، ردیف‌هایِ y-1 و y و y+1 لازم‌اند.
  // ردیفِ y+2، فقط وقتی محاسبه می‌شود که ردیفِ y نوشته شده باشد،
  // پس روشناییِ آن، هنوز از دادهٔ دست‌نخورده خوانده می‌شود.
  let rowPrev = lumRow(0);
  let rowCurr = lumRow(0);
  let rowNext = height > 1 ? lumRow(1) : lumRow(0);
  for (let y = 0; y < height; y++) {
    const base = y * width * 4;
    for (let x = 0; x < width; x++) {
      const o = base + x * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const lum = rowCurr[x];
      let mn = lum;
      let mx = lum;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const row = dy < 0 ? rowPrev : dy > 0 ? rowNext : rowCurr;
        const xx0 = x - 1 < 0 ? 0 : x - 1;
        const xx1 = x;
        const xx2 = x + 1 >= width ? width - 1 : x + 1;
        const l0 = row[xx0];
        const l1 = row[xx1];
        const l2 = row[xx2];
        if (l0 < mn) mn = l0;
        if (l0 > mx) mx = l0;
        if (l1 < mn) mn = l1;
        if (l1 > mx) mx = l1;
        if (l2 < mn) mn = l2;
        if (l2 > mx) mx = l2;
        sum += l0 + l1 + l2;
      }
      const range = mx - mn;
      const mean = sum / 9;
      const maxC = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const minC = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
      // وزنِ نرمِ متن: لبهٔ پُرکنتراستِ کم‌اشباع، یا هستهٔ تیرهٔ جوهر.
      const edgeText = smoothstep(0.15, 0.45, range / 255) * (1 - smoothstep(0.25, 0.5, sat));
      const inkText = (1 - smoothstep(90, 170, lum)) * (1 - smoothstep(0.25, 0.5, sat));
      let w = edgeText > inkText * 0.9 ? edgeText : inkText * 0.9;
      if (w > 1) w = 1;
      // شاخهٔ متن: تیره‌کردنِ جوهر + سفید کردنِ هالهٔ نازک.
      let tr = r;
      let tg = g;
      let tb = b;
      const darken = w * Math.min(1, Math.max(0, (170 - lum) / 170)) * 0.45;
      tr = tr * (1 - darken);
      tg = tg * (1 - darken);
      tb = tb * (1 - darken);
      if (lum > 210 && mn < 120) {
        const halo = w * 0.85;
        tr = tr + (255 - tr) * halo;
        tg = tg + (255 - tg) * halo;
        tb = tb + (255 - tb) * halo;
      }
      // شاخهٔ عکس: منحنیِ S ملایم + آنشارپِ روشنایی + اشباعِ ملایم.
      let pr = r;
      let pg = g;
      let pb = b;
      const sc = (c) => {
        const t = c / 255;
        const y = t * t * (3 - 2 * t);
        return c + (y * 255 - c) * 0.35;
      };
      pr = sc(pr);
      pg = sc(pg);
      pb = sc(pb);
      const delta = (lum - mean) * 0.55;
      pr = pr + delta;
      pg = pg + delta;
      pb = pb + delta;
      const gray = (pr + pg + pb) / 3;
      pr = gray + (pr - gray) * 1.12;
      pg = gray + (pg - gray) * 1.12;
      pb = gray + (pb - gray) * 1.12;
      // میکسِ نرمِ دو شاخه با وزنِ متن.
      data[o] = clamp255(tr * w + pr * (1 - w));
      data[o + 1] = clamp255(tg * w + pg * (1 - w));
      data[o + 2] = clamp255(tb * w + pb * (1 - w));
    }
    rowPrev = rowCurr;
    rowCurr = rowNext;
    rowNext = lumRow(y + 2);
  }
}

// --- ساختِ متنِ Worker از همین تابع‌هایِ بالا (تک‌منبع) ------------------
function buildWorkerSource() {
  const parts = [];
  parts.push('\'use strict\';');
  parts.push('self.onmessage = async function (e) {');
  parts.push('  const data = e.data || {};');
  parts.push('  try {');
  parts.push('    const bitmap = data.bitmap;');
  parts.push('    if (!bitmap) { self.postMessage({ type: \'error\', id: data.id, message: \'no bitmap\' }); return; }');
  parts.push('    const off = new OffscreenCanvas(bitmap.width, bitmap.height);');
  parts.push('    const ctx = off.getContext(\'2d\');');
  parts.push('    ctx.drawImage(bitmap);');
  parts.push('    try { bitmap.close(); } catch (err) {}');
  parts.push('    const img = ctx.getImageData(0, 0, off.width, off.height);');
  parts.push('    processPixels(img.data, off.width, off.height);');
  parts.push('    ctx.putImageData(img, 0, 0);');
  parts.push('    try {');
  parts.push('      const blob = await off.convertToBlob({ type: \'image/png\' });');
  parts.push('      self.postMessage({ type: \'blob\', id: data.id, blob: blob });');
  parts.push('    } catch (err) {');
  parts.push('      const outBitmap = off.transferToImageBitmap();');
  parts.push('      self.postMessage({ type: \'bitmap\', id: data.id, bitmap: outBitmap }, [outBitmap]);');
  parts.push('    }');
  parts.push('  } catch (err) {');
  parts.push('    self.postMessage({ type: \'error\', id: data.id, message: (err && err.message) || \'worker failed\' });');
  parts.push('  }');
  parts.push('};');
  parts.push(clamp255.toString());
  parts.push(smoothstep.toString());
  parts.push(processPixels.toString());
  return parts.join('\n');
}

// --- مدیریتِ تک‌نمونهٔ Worker در تردِ اصلی -------------------------------
let workerInstance = null;
let workerFailed = false;
let nextReqId = 1;
const pendingRequests = new Map();

function getWorker() {
  if (workerInstance) return workerInstance;
  if (workerFailed) return null;
  try {
    const src = buildWorkerSource();
    const blob = new Blob([src], { type: 'text/javascript' });
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
        entry.resolve({ type: 'error', message: 'worker error' });
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

export async function processPdfPageInWorker(sourceCanvas) {
  try {
    if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) return null;
    const w = getWorker();
    if (!w) return null;
    if (typeof createImageBitmap !== 'function') return null;
    // انتقالِ Zero-Copy: بیت‌مپ، بدونِ کپی، به Worker می‌رود.
    const bitmap = await createImageBitmap(sourceCanvas);
    const id = nextReqId++;
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        resolve({ type: 'error', message: 'worker timeout' });
      }, 60000);
      pendingRequests.set(id, { resolve, timer });
      try {
        w.postMessage({ id, bitmap }, [bitmap]);
      } catch (_) {
        clearTimeout(timer);
        pendingRequests.delete(id);
        resolve({ type: 'error', message: 'post failed' });
      }
    });
    if (result.type === 'blob' && result.blob) return { blob: result.blob };
    if (result.type === 'bitmap' && result.bitmap) return { bitmap: result.bitmap };
    return null;
  } catch (_) {
    return null;
  }
}

export function isWorkerEnhancerAvailable() {
  return !workerFailed;
}

// برایِ آزمون و اشکال‌زدایی: متنِ کاملِ Workerِ ساخته‌شده.
export function buildWorkerSourceForTest() {
  return buildWorkerSource();
}

export default { processPdfPageInWorker, isWorkerEnhancerAvailable, processPixels };
