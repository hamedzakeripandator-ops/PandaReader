// ============================================================================
// pdfOutline.js — استخراجِ غیرمسدودکنندهٔ فهرستِ PDF (Outline/Bookmarks)
//
// مرحله ۶ ـ بخش الف: `pdfDoc.getOutline()` در pdf.js، درختی از
// آیتم‌ها با `dest` برمی‌گرداند که می‌تواند آرایهٔ مقصد، رشتهٔ نامِ
// مقصد، یا null باشد. این ماژول، هر سه حالت را به شمارهٔ صفحه حل
// می‌کند (1-based). استخراج، هر ۲۵ گره یک بار به حلقهٔ رویداد برمی‌گردد
// تا رندرِ صفحه‌ها هرگز قفل نشود و با سقفِ ۸۰۰ گره و عمقِ ۶، فهرست‌های
// غول‌پیکر هم UI را خفه نمی‌کنند. توابع خالص‌اند و با سندِ جعلی در
// Node تست می‌شوند.
// ============================================================================

const MAX_OUTLINE_NODES = 800;
const MAX_OUTLINE_DEPTH = 6;
const YIELD_EVERY = 25;

/** حلِ یک dest به شمارهٔ صفحه (1-based)؛ null اگر قابلِ حل نیست.
 * مرحله ۶ ـ بخش ب: علاوه بر رشته و آرایه، destای به‌شکلِ Ref
 * ({num, gen}) و دیکشنریِ {D: ...} هم مهار می‌شود؛ و شمارهٔ صفحه،
 * در برابرِ numPages سند اعتبارسنجی می‌شود تا سرفصلی با مقصدِ
 * خارج از بازه، هرگز به پرشِ نامعتبر نرسد. هر شکلی که حل نشود،
 * بی‌صدا null می‌شود (سرفصل، غیرقابلِ پرش و کم‌رنگ نمایش داده
 * می‌شود) و استخراجِ بقیهٔ فهرست ادامه پیدا می‌کند. توجه: Refای که
 * به خودِ آرایهٔ مقصد اشاره می‌کند (نه به صفحه)، از APIِ عمومیِ
 * pdf.js قابلِ حل نیست و همین‌طور مهار می‌شود. */
export async function resolveOutlineDestToPage(pdfDoc, dest) {
  try {
    if (!dest) return null;
    const numPages = Number.isFinite(pdfDoc?.numPages) ? pdfDoc.numPages : null;
    const toPage = (pageIndex) => {
      if (!Number.isFinite(pageIndex) || pageIndex < 0) return null;
      const page = pageIndex + 1;
      if (numPages !== null && page > numPages) return null;
      return page;
    };
    const resolveArrayDest = async (arr) => {
      if (!Array.isArray(arr) || arr.length === 0) return null;
      return toPage(await pdfDoc.getPageIndex(arr[0]));
    };
    if (typeof dest === 'string') {
      const resolved = await pdfDoc.getDestination(dest);
      if (!resolved) return null;
      if (Array.isArray(resolved)) return await resolveArrayDest(resolved);
      // نامِ مقصدی که به دیکشنری/Ref دیگری حل می‌شود: یک سطحِ دیگر.
      if (typeof resolved === 'object') return await resolveOutlineDestToPage(pdfDoc, resolved);
      return null;
    }
    if (Array.isArray(dest)) {
      return await resolveArrayDest(dest);
    }
    if (typeof dest === 'object') {
      // دیکشنریِ مقصد: {D: [...] | 'نام'}.
      if (dest.D !== undefined) {
        if (typeof dest.D === 'string') {
          const resolved = await pdfDoc.getDestination(dest.D);
          if (Array.isArray(resolved)) return await resolveArrayDest(resolved);
          return null;
        }
        return await resolveArrayDest(dest.D);
      }
      // Refای مستقیم به صفحه ({num, gen}): getPageIndex همان Ref را
      // می‌پذیرد؛ اگر به صفحه اشاره نکند، خطا می‌دهد و مهار می‌شود.
      if (Number.isFinite(dest.num)) {
        return toPage(await pdfDoc.getPageIndex(dest));
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function walkOutlineItems(pdfDoc, items, depth, state) {
  const out = [];
  for (const item of items || []) {
    if (state.count >= MAX_OUTLINE_NODES) break;
    state.count += 1;
    if (state.count % YIELD_EVERY === 0) {
      // نفس‌کشیدنِ حلقهٔ رویداد: رندرِ صفحه‌ها معطلِ فهرست نمی‌ماند.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const title = String(item?.title || '').trim();
    let page = null;
    if (item?.dest !== undefined) {
      page = await resolveOutlineDestToPage(pdfDoc, item.dest);
    }
    let children = [];
    if (Array.isArray(item?.items) && item.items.length > 0 && depth < MAX_OUTLINE_DEPTH) {
      children = await walkOutlineItems(pdfDoc, item.items, depth + 1, state);
    }
    // گرهِ بدونِ عنوان و بدونِ فرزندِ قابلِ نمایش، دور انداخته می‌شود؛
    // گرهِ بدونِ صفحه ولی با فرزند، به‌عنوانِ سرگروه نگه داشته می‌شود
    // (کلیک روی آن، به اولین فرزندِ صفحه‌دار می‌پرد).
    if (!title && children.length === 0) continue;
    out.push({ title: title || 'بدون عنوان', page, children });
  }
  return out;
}

/**
 * استخراجِ فهرستِ PDF. اگر سند فهرست ندارد یا استخراج شکست خورد،
 * آرایهٔ خالی برمی‌گردد (فهرست، قابلیتِ اختیاری است و هرگز بارگذاریِ
 * سند را خراب نمی‌کند).
 */
export async function extractPdfOutline(pdfDoc) {
  try {
    if (!pdfDoc || typeof pdfDoc.getOutline !== 'function') return [];
    const raw = await pdfDoc.getOutline();
    if (!Array.isArray(raw) || raw.length === 0) return [];
    const state = { count: 0 };
    return await walkOutlineItems(pdfDoc, raw, 0, state);
  } catch (_) {
    return [];
  }
}

/** صاف‌کردنِ درخت به لیستِ تختِ {title, page, depth} با حفظِ ترتیبِ سند. */
export function flattenOutline(items, depth = 0, out = []) {
  for (const item of items || []) {
    out.push({ title: item.title, page: item.page, depth, children: item.children });
    if (Array.isArray(item.children) && item.children.length > 0) {
      flattenOutline(item.children, depth + 1, out);
    }
  }
  return out;
}

/** اولین صفحهٔ قابلِ پرش در زیردرختِ یک گره (خودش یا اولین فرزندِ صفحه‌دار). */
export function firstJumpablePage(item) {
  if (!item) return null;
  if (Number.isFinite(item.page) && item.page > 0) return item.page;
  for (const child of item.children || []) {
    const p = firstJumpablePage(child);
    if (p) return p;
  }
  return null;
}

/** ورودیِ فعالِ فهرست برای صفحهٔ جاری: آخرین ورودیِ تخت با page <= currentPage. */
export function findActiveOutlineEntry(flatEntries, currentPage) {
  let active = null;
  for (const entry of flatEntries || []) {
    if (Number.isFinite(entry.page) && entry.page > 0 && entry.page <= currentPage) {
      active = entry;
    } else if (Number.isFinite(entry.page) && entry.page > currentPage) {
      break;
    }
  }
  return active;
}
