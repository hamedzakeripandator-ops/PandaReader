// مرحلهٔ ۲۹ — گونهٔ تازهٔ 'deep' (دیپ‌رندرِ PNGِ مرحلهٔ ۱۹) و کشِ
// LRUِ نشانی‌هایِ PNG (مالکِ واحدِ آزادسازی): پایه حداکثر ۳۰
// ورودی، دیپ حداکثر ۶ ورودی. گونه‌هایِ 'tile' و 'upscale' دیگر
// صف نمی‌شوند (کلیدهایِ آمارشان برایِ سازگاری مانده‌اند).
// منطقِ صف (حداکثر ۲ هم‌زمان، اولویت، تأخیر) دست نخورده است.

// مرحلهٔ ۲۷ — صفِ اولویت‌دارِ رندرِ مستقیمِ PDF (شبیهِ نقشه):
//   این سرویس، دیگر هیچ انکودی ندارد: نه toBlob('image/png')،
//   نه toBlob('image/webp')، نه نشانیِ blob: و نه عبوری از
//   IPC در مسیرِ زنده. رندرِ pdf.js مستقیم رویِ بومِ
//   نمایانِ صفحه (لایهٔ پایه) یا رویِ بومِ آفسکرینِ تایل و سپس
//   drawImage رویِ بومِ نمایان (لایهٔ جزئیاتِ زوم) انجام می‌شود.
//   صف، در هر لحظه حداکثر ۲ رندرِ هم‌زمان اجازه می‌دهد:
//     اولویتِ ۱: صفحهٔ فعال (distance === 0)
//     اولویتِ ۲: همسایه‌هایِ بلافصل (distance === 1)
//     اولویتِ ۳: همسایه‌هایِ بعدی (distance 2 و ۳) با ۱۲۰
//       میلی‌ثانیه تأخیر (تا در اسکرولِ سریع، صف قفل نشود).
//   در لحظهٔ باز شدنِ فایل، فقط صفحهٔ فعال بی‌درنگ رندر می‌شود
//   و همسایه‌ها پشتِ سرش صف می‌کشند؛ به همین دلیل، باز شدنِ
//   فایل دیگر ۱۳ رندرِ هم‌زمان به ورکرِ pdf.js نمی‌فرستد.
//   نوعِ 'upscale' (مرحلهٔ ۲۸): لایهٔ PNGِ سبکِ ۳ صفحه‌ای —
//     فعال اولویتِ ۱ با تأخیرِ ۰، همسایه‌هایِ بلافصل اولویتِ ۲
//     با تأخیرِ ۶۰ میلی‌ثانیه؛ آمارش avgUpscaleMs است.
//   تله‌متری: با window.__PDF_RENDER_DEBUG = true، هر رندر
//   (نوع، زمان، طولِ صف، لغوها) در کنسول ثبت می‌شود و با
//   getStats() قابلِ خواندن است. کشِ بیت‌مپ، در این معماری
//   وجود ندارد (رندرِ مستقیم، چند میلی‌ثانیه طول می‌کشد و
//   بومِ نمایان، خودش حافظهٔ صفحه است)؛ پس آمارِ آن صفر است.

export const MAX_CONCURRENT_RENDERS = 2;

function normFilePath(filePath) {
  return (filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase();
}

function nowMs() {
  try {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
  } catch (_) {}
  return Date.now();
}

class PdfRenderQueue {
  constructor() {
    this.pending = []; // [{seq,key,filePath,kind,priority,delayMs,run,timer}]
    this.running = new Map(); // key -> {job, filePathNorm, cancelFn}
    this.seq = 0;
    this.cancelledCount = 0;
    this.completedCount = 0;
    this.failedCount = 0;
    this.renderMs = { base: [], tile: [] };
    this.debugEntries = [];
  }

  debug(msg) {
    const entry = { t: Date.now(), msg };
    this.debugEntries.push(entry);
    if (this.debugEntries.length > 100) this.debugEntries.shift();
    try {
      if (typeof window !== 'undefined' && window.__PDF_RENDER_DEBUG) {
        console.log('[pdf-render]', msg);
      }
    } catch (_) {}
  }

  sortPending() {
    this.pending.sort((a, b) => (a.priority - b.priority) || (a.seq - b.seq));
  }

  enqueue(job) {
    if (!job || !job.key || typeof job.run !== 'function') return;
    // جایگزینیِ کارِ هم‌کلیدِ قبلی (در حالِ اجرا باشد، لغو می‌شود).
    this.cancel(job.key);
    const entry = {
      seq: this.seq++,
      key: job.key,
      filePath: job.filePath || '',
      kind: job.kind || 'base',
      priority: job.priority || 3,
      delayMs: job.delayMs || 0,
      run: job.run,
      timer: null,
    };
    this.pending.push(entry);
    this.sortPending();
    if (entry.delayMs > 0) {
      entry.timer = setTimeout(() => {
        entry.timer = null;
        this.pump();
      }, entry.delayMs);
    }
    this.debug(`enqueue ${entry.kind} ${entry.key} p${entry.priority}${entry.delayMs ? ` +${entry.delayMs}ms` : ''} (pending=${this.pending.length} running=${this.running.size})`);
    this.pump();
  }

  cancel(key) {
    const pi = this.pending.findIndex((j) => j.key === key);
    if (pi >= 0) {
      const [old] = this.pending.splice(pi, 1);
      if (old.timer) {
        try { clearTimeout(old.timer); } catch (_) {}
      }
      this.cancelledCount += 1;
      this.debug(`cancel pending ${key}`);
    }
    const run = this.running.get(key);
    if (run) {
      this.running.delete(key);
      this.cancelledCount += 1;
      try {
        if (typeof run.cancelFn === 'function') run.cancelFn();
      } catch (_) {}
      this.debug(`cancel running ${key}`);
      this.pump();
    }
  }

  cancelFile(filePath) {
    const norm = normFilePath(filePath);
    if (!norm) return;
    for (const j of [...this.pending]) {
      if (normFilePath(j.filePath) === norm) this.cancel(j.key);
    }
    for (const k of [...this.running.keys()]) {
      const run = this.running.get(k);
      if (run && run.filePathNorm === norm) this.cancel(k);
    }
    this.debug(`cancelFile ${filePath} (pending=${this.pending.length} running=${this.running.size})`);
  }

  pump() {
    while (this.running.size < MAX_CONCURRENT_RENDERS) {
      const idx = this.pending.findIndex((j) => !j.timer);
      if (idx < 0) return;
      const job = this.pending.splice(idx, 1)[0];
      this.start(job);
    }
  }

  start(job) {
    const record = { job, filePathNorm: normFilePath(job.filePath), cancelFn: null };
    this.running.set(job.key, record);
    const hooks = {
      onCancel: (fn) => { record.cancelFn = fn; },
      isCancelled: () => !this.running.has(job.key),
    };
    const t0 = nowMs();
    let runResult = null;
    try {
      runResult = job.run(hooks);
    } catch (err) {
      runResult = Promise.reject(err);
    }
    Promise.resolve(runResult).then(
      () => this.finish(job, t0, true),
      () => this.finish(job, t0, false)
    );
  }

  finish(job, t0, ok) {
    if (!this.running.has(job.key)) return; // پیش‌تر لغو شده است.
    this.running.delete(job.key);
    const ms = nowMs() - t0;
    if (ok) {
      this.completedCount += 1;
      const arr = this.renderMs[job.kind] || (this.renderMs[job.kind] = []);
      arr.push(ms);
      if (arr.length > 50) arr.shift();
      this.debug(`${job.kind} done ${job.key} ${ms.toFixed(0)}ms (pending=${this.pending.length} running=${this.running.size})`);
    } else {
      this.failedCount += 1;
      this.debug(`${job.kind} failed ${job.key} ${ms.toFixed(0)}ms`);
    }
    this.pump();
  }

  getStats() {
    const avg = (arr) => (arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    return {
      running: this.running.size,
      pending: this.pending.filter((j) => !j.timer).length,
      delayed: this.pending.filter((j) => !!j.timer).length,
      cancelled: this.cancelledCount,
      completed: this.completedCount,
      failed: this.failedCount,
      avgBaseMs: avg(this.renderMs.base),
      avgTileMs: avg(this.renderMs.tile),
      avgUpscaleMs: avg(this.renderMs.upscale),
      avgDeepMs: avg(this.renderMs.deep),
      basePngCachePages: basePngCache.size,
      deepPngCachePages: deepPngCache.size,
      bitmapCacheBytes: 0,
      bitmapCachePages: 0,
      debug: this.debugEntries.slice(-20),
    };
  }
}

// مرحلهٔ ۲۹ — کشِ LRUِ نشانی‌هایِ PNG (مالکِ واحدِ آزادسازی):
// ثبتِ دوبارهٔ یک کلید، نشانیِ قبلی را همان‌جا آزاد می‌کند و
// ثبتِ ورودیِ تازه پس از پر شدنِ سقف، قدیمی‌ترین ورودی را آزاد
// و حذف می‌کند. آزادسازی فقط از همین توابع انجام می‌شود تا
// نشانیِ در حالِ نمایش، هرگز زودتر از تعویضِ src آزاد نشود.
function revokeUrlSilently(url) {
  try { if (url) URL.revokeObjectURL(url); } catch (_) {}
}
function makePngLruCache(limit) {
  const map = new Map();
  return {
    register(key, url) {
      if (!key || !url) return;
      const prev = map.get(key);
      if (prev && prev !== url) revokeUrlSilently(prev);
      map.delete(key);
      map.set(key, url);
      while (map.size > limit) {
        const oldestKey = map.keys().next().value;
        revokeUrlSilently(map.get(oldestKey));
        map.delete(oldestKey);
      }
    },
    revoke(key) {
      if (!key) return;
      revokeUrlSilently(map.get(key));
      map.delete(key);
    },
    get(key) {
      if (!key) return undefined;
      const url = map.get(key);
      if (!url) return undefined;
      map.delete(key);
      map.set(key, url);
      return url;
    },
    keys() {
      return [...map.keys()];
    },
    get size() { return map.size; },
  };
}
// مرحلهٔ ۳۰ — سقفِ کش‌ها کم شد (پایه ۳۰→۱۲، دیپ ۶→۳):
// دیپِ ۲۰ مگاپیکسلی، هر ورودی تا ~۸۰ مگابایت تصویرِ دیکدشده
// نگه می‌دارد؛ ۶ ورودی، سقفِ نظریِ ~۴۸۰ مگابایت بود و ۳ ورودی،
// آن را به ~۲۴۰ مگابایت می‌رساند (فقط صفحهٔ فعال و ۲ همسایه).
const basePngCache = makePngLruCache(18);
const deepPngCache = makePngLruCache(3);
// مرحلهٔ ۳۴ — سقفِ کشِ پایه ۱۲→۱۸ صفحه: unmount دیگر نشانی‌ها
// را باطل نمی‌کند و LRU، مالکِ آزادسازی است؛ ۱۸ صفحه،
// رفت‌وبرگشتِ اسکرول را بدونِ رندرِ دوباره پوشش می‌دهد.
export function registerBasePngUrl(key, url) { basePngCache.register(key, url); }
export function revokeBasePngUrl(key) { basePngCache.revoke(key); }
export function getBasePngUrl(key) { return basePngCache.get(key); }
// مرحلهٔ ۳۴ — خالی کردنِ کشِ یک فایل (بسته شدنِ فایل): همهٔ
// ورودی‌هایِ همان فایل، از هر دو کش، باطل می‌شوند.
export function clearFileCache(filePath) {
  const norm = normFilePath(filePath);
  if (!norm) return;
  for (const cache of [basePngCache, deepPngCache]) {
    for (const key of cache.keys()) {
      const sep = key.lastIndexOf(':');
      if (sep < 0) continue;
      if (normFilePath(key.slice(0, sep)) === norm) cache.revoke(key);
    }
  }
}
export function registerDeepPngUrl(key, url) { deepPngCache.register(key, url); }
export function revokeDeepPngUrl(key) { deepPngCache.revoke(key); }

export const hiDpiRenderService = new PdfRenderQueue();
export default hiDpiRenderService;
