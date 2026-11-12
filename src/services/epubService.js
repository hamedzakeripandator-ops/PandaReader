// ============================================================================
// electron/services/epubService.js — مرحلهٔ ۳۵ §۲
//
// خواندنِ فایل‌هایِ EPUB (آرشیوِ ZIP) در پروسسِ اصلی: استخراجِ متادیتا،
// فهرستِ فصول و متنِ هر فصل با ایزوله‌سازیِ کاملِ استایل/اسکریپتِ
// ناشر، و سروِ تصاویر از طریقِ پروتکلِ comic://.
//
// معماریِ حافظه: loadEpubBook فقط متادیتا + فهرستِ فصل‌ها را برمی‌گرداند
// (بدونِ متنِ فصل‌ها) و loadEpubChapter، متنِ یک فصل را تنبل (lazy)
// می‌خواند و در کشِ دیسک ذخیره می‌کند؛ پس باز کردنِ کتاب، حتی برایِ
// EPUBهایِ چندصد فصلی، سبک است و فصل‌هایِ تکراری، اصلاً ZIP را باز
// نمی‌کنند. کش با اندازه + زمانِ تغییرِ فایلِ مبدأ اعتبارسنجی می‌شود.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_EPUB_BYTES = 200 * 1024 * 1024;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_CHAPTERS = 5000;

// مرحلهٔ ۴۴ §۵ (OPT-07): کشِ تک‌ورودیِ نمونهٔ بازشدهٔ JSZip برایِ
// loadEpubChapter — فصل‌هایِ پیاپیِ یک کتاب (ورق، پیش‌بارگذاریِ
// همسایه، جستجو) دیگر در هر miss کلِ فایل را نمی‌خوانند و zip را
// از نو پارس نمی‌کنند. کلید، مسیر + اندازه + زمانِ تغییر است، پس
// ویرایشِ فایل از بیرون، کش را باطل می‌کند. سقفِ ۵۰ مگابایت یعنی
// فایل‌هایِ غول‌پیکر کش نمی‌شوند تا رم قفل نشود. loadEpubBook دست
// نمی‌خورد و zip را جداگانه می‌سازد.
const MAX_CACHED_EPUB_ZIP_BYTES = 50 * 1024 * 1024;
let cachedEpubZip = null; // { key, zip } | null

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function normalizeKey(p) {
  return String(p || '').trim().replace(/\//g, '\\').toLowerCase();
}

function safeSegment(name) {
  const cleaned = String(name || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  return cleaned || 'file';
}

function decodeXmlEntities(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch (_) { return ''; }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch (_) { return ''; }
    })
    .replace(/&amp;/g, '&');
}

function stripTags(s) {
  return decodeXmlEntities(String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
}

// ویژگیِ یک تگِ XML/HTML (با کوتیشنِ دوتایی یا تکی).
function tagAttr(tagText, name) {
  if (!tagText) return '';
  const m = tagText.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i')) ||
    tagText.match(new RegExp(name + "\\s*=\\s*'([^']*)'", 'i'));
  return m ? decodeXmlEntities(m[1]) : '';
}

// مسیرِ داخلِ ZIP را نسبت به پوشهٔ مرجع حل می‌کند و هر تلاش برایِ
// خروج از آرشیو (../ فرار) را رد می‌کند. خروجی، مسیرِ POSIX است.
function resolveZipPath(baseDir, href) {
  if (!href || typeof href !== 'string') return null;
  let clean = href.split('#')[0].split('?')[0];
  try { clean = decodeURIComponent(clean); } catch (_) {}
  clean = clean.trim();
  if (!clean || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.startsWith('data:') || clean.startsWith('http://') || clean.startsWith('https://')) {
    return null;
  }
  const parts = (baseDir ? `${baseDir}/${clean}` : clean).split('/');
  const out = [];
  for (const seg of parts) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

// فایلِ ریشه (rootfile) از رویِ META-INF/container.xml.
function parseContainerXml(xml) {
  if (typeof xml !== 'string') return null;
  const m = xml.match(/<(?:[A-Za-z0-9_]+:)?rootfile\b[^>]*>/i);
  if (!m) return null;
  const fullPath = tagAttr(m[0], 'full-path');
  return fullPath || null;
}

// فایلِ .opf: متادیتا + manifest + spine + شناسهٔ فهرست.
function parseOpf(xml) {
  const out = { title: '', creator: '', coverId: '', manifest: {}, spine: [], tocId: '' };
  if (typeof xml !== 'string') return out;
  const titleM = xml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i) ||
    xml.match(/<(?:[A-Za-z0-9_]+:)?title[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?title>/i);
  if (titleM) out.title = stripTags(titleM[1]);
  const creatorM = xml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
  if (creatorM) out.creator = stripTags(creatorM[1]);
  const coverM = xml.match(/<meta\b[^>]*\bname\s*=\s*"cover"[^>]*>/i) ||
    xml.match(/<meta\b[^>]*\bname\s*=\s*'cover'[^>]*>/i);
  if (coverM) out.coverId = tagAttr(coverM[0], 'content');
  const itemRe = /<(?:[A-Za-z0-9_]+:)?item\b[^>]*>/gi;
  let im;
  while ((im = itemRe.exec(xml)) !== null) {
    const id = tagAttr(im[0], 'id');
    const href = tagAttr(im[0], 'href');
    if (!id || !href) continue;
    out.manifest[id] = {
      href,
      mediaType: tagAttr(im[0], 'media-type'),
      properties: tagAttr(im[0], 'properties'),
    };
    if (out.manifest[id].mediaType === 'application/x-dtbncx+xml') out.tocId = id;
    if (!out.coverId && (out.manifest[id].properties || '').split(/\s+/).includes('cover-image')) {
      out.coverId = id;
    }
  }
  const spineM = xml.match(/<(?:[A-Za-z0-9_]+:)?spine\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?spine>/i);
  if (spineM) {
    const refRe = /<(?:[A-Za-z0-9_]+:)?itemref\b[^>]*>/gi;
    let rm;
    while ((rm = refRe.exec(spineM[0])) !== null) {
      const idref = tagAttr(rm[0], 'idref');
      const linear = (tagAttr(rm[0], 'linear') || 'yes').toLowerCase();
      if (idref && linear !== 'no') out.spine.push(idref);
    }
  }
  return out;
}

// فهرستِ EPUB2 از رویِ toc.ncx: نگاشتِ «نامِ فایلِ فصل» → عنوان.
function parseTocNcx(xml) {
  const map = {};
  if (typeof xml !== 'string') return map;
  const pointRe = /<(?:[A-Za-z0-9_]+:)?navPoint\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?navPoint>/gi;
  let pm;
  while ((pm = pointRe.exec(xml)) !== null) {
    const block = pm[0];
    const labelM = block.match(/<(?:[A-Za-z0-9_]+:)?text[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?text>/i);
    const contentM = block.match(/<(?:[A-Za-z0-9_]+:)?content\b[^>]*>/i);
    const src = contentM ? tagAttr(contentM[0], 'src') : '';
    if (labelM && src) {
      const file = src.split('#')[0].split('/').pop();
      if (file && !map[file]) map[file] = stripTags(labelM[1]);
    }
  }
  return map;
}

// فهرستِ EPUB3 از رویِ سندِ nav: فهرستِ ترتیبیِ {href, title}.
function parseNavDoc(html) {
  const out = [];
  if (typeof html !== 'string') return out;
  const navM = html.match(/<nav\b[^>]*epub:type\s*=\s*"toc"[^>]*>([\s\S]*?)<\/nav\s*>/i) ||
    html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav\s*>/i);
  const body = navM ? navM[1] : html;
  const linkRe = /<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let lm;
  while ((lm = linkRe.exec(body)) !== null) {
    const title = stripTags(lm[2]);
    if (title) out.push({ href: lm[1], title });
  }
  return out;
}

function posixDirname(p) {
  const idx = String(p || '').lastIndexOf('/');
  return idx >= 0 ? String(p).slice(0, idx) : '';
}

function zipEntry(zip, zipPath) {
  if (!zip || !zipPath) return null;
  let entry = null;
  try { entry = zip.file(zipPath); } catch (_) { entry = null; }
  if (entry) return entry;
  // تلاشِ دوم: مسیرِ URL-encode شده یا برعکس.
  try {
    const encoded = zipPath.split('/').map(encodeURIComponent).join('/');
    entry = zip.file(encoded);
  } catch (_) {}
  return entry || null;
}

// پاک‌سازیِ HTML فصل + بازنویسیِ تصاویر به comic:// — ایزوله‌سازیِ
// کامل: استایلِ ناشر حذف می‌شود (نه محدودسازی به کلاس) تا رنگ و
// فونتِ سایدبار/تاپ‌بارِ برنامه هرگز خراب نشود؛ اسکریپت، رویدادهایِ
// on*، و hrefهایِ javascript: هم حذف می‌شوند.
async function sanitizeChapterHtml(rawHtml, opts) {
  const { zip, chapterDir, imagesDir } = opts || {};
  let html = String(rawHtml || '');
  // مرحلهٔ ۴۴ §۴: اورلیِ پخته‌شدهٔ خودِ برنامه، هرگز دوباره در
  // خواننده نمایش داده نمی‌شود (وگرنه حاشیه‌نویسیِ زنده رویِ تصویرِ
  // پخته‌شده، دو بار دیده می‌شد)؛ مانیفست، مرجعِ بازیابی است.
  html = removeOldEpubOverlayBlock(html);
  const bodyM = html.match(/<body\b[^>]*>([\s\S]*)<\/body\s*>/i);
  if (bodyM) html = bodyM[1];
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  html = html.replace(/<link\b[^>]*>/gi, '');
  html = html.replace(/<meta\b[^>]*>/gi, '');
  html = html.replace(/<base\b[^>]*>/gi, '');
  html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '');
  html = html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '');
  html = html.replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, '');
  html = html.replace(/<embed\b[^>]*>/gi, '');
  html = html.replace(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi, '');
  html = html.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '');
  html = html.replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '');
  html = html.replace(/\s+href\s*=\s*"(javascript|vbscript|data:text\/html)[^"]*"/gi, ' href="#"');
  html = html.replace(/\s+href\s*=\s*'(javascript|vbscript|data:text\/html)[^']*'/gi, " href='#'");
  // جهتِ خودکارِ پاراگراف‌ها: فارسی راست‌به‌چپ، انگلیسی چپ‌به‌راست.
  html = html.replace(/<p\b(?![^>]*\bdir\s*=)/gi, '<p dir="auto"');
  // تصاویر: استخراج به کش و بازنویسی به comic://.
  if (zip && imagesDir) {
    // مرحلهٔ ۵۹ §۳٫۲ — علاوه بر <img>، تگ‌های <image> داخلِ SVG هم پردازش
    // می‌شوند (مانگاهای EPUB صفحه‌ها را به‌شکل
    // ‎<svg><image xlink:href="..." /></svg>‎ جاسازی می‌کنند)؛ خاصیتِ
    // آن‌ها href یا xlink:href است، نه src.
    const imgRe = /<img\b[^>]*>/gi;
    const imageRe = /<image\b[^>]*>/gi;
    const matches = [];
    let mm;
    while ((mm = imgRe.exec(html)) !== null) matches.push({ tag: mm[0], index: mm.index, kind: 'img' });
    while ((mm = imageRe.exec(html)) !== null) matches.push({ tag: mm[0], index: mm.index, kind: 'image' });
    // مرتب‌سازی بر اساسِ موقعیت تا جایگزینیِ از انتها به ابتدا درست کار کند.
    matches.sort((a, b) => a.index - b.index);
    // از انتها به ابتدا جایگزین می‌کنیم تا ایندکس‌ها به‌هم نریزند.
    for (let i = matches.length - 1; i >= 0; i--) {
      const { tag, index, kind } = matches[i];
      let newTag = tag;
      let srcM = null;
      if (kind === 'image') {
        // در SVG اول xlink:href، بعد href ساده.
        srcM = newTag.match(/\sxlink:href\s*=\s*"([^"]*)"/i) || newTag.match(/\sxlink:href\s*=\s*'([^']*)'/i)
          || newTag.match(/\shref\s*=\s*"([^"]*)"/i) || newTag.match(/\shref\s*=\s*'([^']*)'/i);
      } else {
        newTag = newTag.replace(/\s+srcset\s*=\s*"[^"]*"/gi, '').replace(/\s+srcset\s*=\s*'[^']*'/gi, '');
        srcM = newTag.match(/\ssrc\s*=\s*"([^"]*)"/i) || newTag.match(/\ssrc\s*=\s*'([^']*)'/i);
      }
      if (!srcM) continue;
      const src = srcM[1];
      if (!src || /^(data:|https?:|comic:)/i.test(src)) continue;
      const zipPath = resolveZipPath(chapterDir, src);
      if (!zipPath) continue;
      const entry = zipEntry(zip, zipPath);
      if (!entry) continue;
      let buf = null;
      try {
        buf = await entry.async('nodebuffer');
      } catch (_) { buf = null; }
      if (!buf || buf.length === 0 || buf.length > MAX_IMAGE_BYTES) continue;
      const ext = path.posix.extname(zipPath).toLowerCase() || '.img';
      const fileName = `${safeSegment(path.posix.basename(zipPath, ext))}-${sha256Hex(zipPath).slice(0, 12)}${ext}`;
      const absPath = path.join(imagesDir, fileName);
      try {
        if (!fs.existsSync(absPath)) fs.writeFileSync(absPath, buf);
      } catch (_) { continue; }
      const comicUrl = `comic://media/?path=${encodeURIComponent(absPath)}`;
      // نامِ خاصیت حفظ می‌شود (src برایِ img، و xlink:href یا href برایِ image).
      const attrName = kind === 'image'
        ? (/\sxlink:href\s*=/i.test(srcM[0]) ? 'xlink:href' : 'href')
        : 'src';
      newTag = newTag.replace(srcM[0], ` ${attrName}="${comicUrl}"`);
      html = html.slice(0, index) + newTag + html.slice(index + tag.length);
    }
  }
  return html;
}

async function readMeta(cacheDir) {
  try {
    const raw = await fs.promises.readFile(path.join(cacheDir, 'meta.json'), 'utf8');
    const meta = JSON.parse(raw);
    if (meta && Array.isArray(meta.chapters)) return meta;
  } catch (_) {}
  return null;
}

async function writeMeta(cacheDir, meta) {
  await fs.promises.mkdir(cacheDir, { recursive: true });
  await fs.promises.writeFile(path.join(cacheDir, 'meta.json'), JSON.stringify(meta), 'utf8');
}

// استخراجِ کاملِ متادیتا + فهرستِ فصل‌ها (بدونِ متنِ فصل‌ها).
async function loadEpubBook(filePath, dataDir) {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, message: 'مسیرِ فایل مشخص نیست.' };
    }
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return { success: false, message: 'فایلِ EPUB یافت نشد.' };
    if (stat.size > MAX_EPUB_BYTES) {
      return { success: false, message: 'فایلِ EPUB بزرگ‌تر از حدِ مجاز (۲۰۰ مگابایت) است.' };
    }
    if (!dataDir) return { success: false, message: 'پوشهٔ دادهٔ برنامه مشخص نیست.' };
    const cacheDir = path.join(dataDir, 'epub-cache', sha256Hex(normalizeKey(filePath)));
    const imagesDir = path.join(cacheDir, 'images');
    const chaptersDir = path.join(cacheDir, 'chapters');
    await fs.promises.mkdir(imagesDir, { recursive: true });
    await fs.promises.mkdir(chaptersDir, { recursive: true });

    const meta = await readMeta(cacheDir);
    if (meta && meta.sourceSize === stat.size && meta.sourceMtimeMs === stat.mtimeMs) {
      return {
        success: true,
        fromCache: true,
        title: meta.title || '',
        // مرحلهٔ ۴۴ §۴: در مسیرِ کش، zip باز نمی‌شود؛ مانیفست فقط
        // در پارسِ کامل خوانده می‌شود. فایلِ دارایِ مانیفست، پس از
        // هر ذخیره اندازه/زمانش عوض می‌شود، پس مسیرِ کامل اجرا
        // می‌شود و مانیفست همان‌جا خوانده می‌شود.
        embeddedAnnotations: null,
        creator: meta.creator || '',
        coverUrl: meta.coverUrl || null,
        chapters: meta.chapters,
        fileName: path.basename(filePath),
        fileSize: stat.size,
        sourceMtimeMs: meta.sourceMtimeMs,
        totalChapters: meta.chapters.length,
      };
    }

    const JSZip = require('jszip');
    const buf = await fs.promises.readFile(filePath);
    const zip = await JSZip.loadAsync(buf);
    // مرحلهٔ ۴۴ §۴: مانیفستِ جاسازی‌شدهٔ حاشیه‌نویسی (اگر بود) از
    // همان zipِ بازشده خوانده می‌شود تا باز کردنِ دوباره لازم نباشد.
    const embeddedAnnotations = await readEmbeddedEpubAnnotationsFromZip(zip);
    const names = Object.keys(zip.files || {});
    const findCaseInsensitive = (target) => names.find((n) => n.toLowerCase() === target.toLowerCase()) || null;
    const encName = findCaseInsensitive('META-INF/encryption.xml');
    if (encName) {
      try {
        const encEntry = zipEntry(zip, encName);
        const encText = encEntry ? await encEntry.async('string') : '';
        if (/<EncryptedData/i.test(encText)) {
          return { success: false, code: 'epub-encrypted', message: 'این EPUB با DRM قفل شده است و خواندنش پشتیبانی نمی‌شود.' };
        }
      } catch (_) {}
    }
    const containerName = findCaseInsensitive('META-INF/container.xml');
    const containerEntry = containerName ? zipEntry(zip, containerName) : null;
    if (!containerEntry) {
      return { success: false, message: 'ساختارِ EPUB معتبر نیست (container.xml یافت نشد).' };
    }
    const containerXml = await containerEntry.async('string');
    const opfPath = parseContainerXml(containerXml);
    if (!opfPath) {
      return { success: false, message: 'فایلِ ریشهٔ EPUB (OPF) یافت نشد.' };
    }
    const opfEntry = zipEntry(zip, opfPath);
    if (!opfEntry) {
      return { success: false, message: 'فایلِ OPF داخلِ EPUB یافت نشد.' };
    }
    const opfXml = await opfEntry.async('string');
    const opf = parseOpf(opfXml);
    const opfDir = posixDirname(opfPath);

    // فهرستِ مطالب: EPUB3 (nav) در اولویت، بعد EPUB2 (ncx).
    const tocByFile = {};
    const navItem = Object.values(opf.manifest).find((it) => (it.properties || '').split(/\s+/).includes('nav'));
    if (navItem) {
      const navPath = resolveZipPath(opfDir, navItem.href);
      const navEntry = navPath ? zipEntry(zip, navPath) : null;
      if (navEntry) {
        const navHtml = await navEntry.async('string');
        for (const link of parseNavDoc(navHtml)) {
          const file = link.href.split('#')[0].split('/').pop();
          if (file && !tocByFile[file]) tocByFile[file] = link.title;
        }
      }
    }
    if (opf.tocId && opf.manifest[opf.tocId]) {
      const ncxPath = resolveZipPath(opfDir, opf.manifest[opf.tocId].href);
      const ncxEntry = ncxPath ? zipEntry(zip, ncxPath) : null;
      if (ncxEntry) {
        const ncxXml = await ncxEntry.async('string');
        Object.assign(tocByFile, parseTocNcx(ncxXml));
      }
    }

    const spine = opf.spine.slice(0, MAX_CHAPTERS);
    const chapters = [];
    for (let i = 0; i < spine.length; i++) {
      const item = opf.manifest[spine[i]];
      if (!item) continue;
      const zipPath = resolveZipPath(opfDir, item.href);
      if (!zipPath) continue;
      const file = zipPath.split('/').pop();
      const title = tocByFile[file] || file.replace(/\.[^.]+$/, '') || `فصل ${i + 1}`;
      chapters.push({ id: `ch${i}`, title, href: zipPath });
    }
    if (chapters.length === 0) {
      return { success: false, message: 'در این فایلِ EPUB هیچ فصلی یافت نشد.' };
    }

    let coverUrl = null;
    if (opf.coverId && opf.manifest[opf.coverId]) {
      const coverPath = resolveZipPath(opfDir, opf.manifest[opf.coverId].href);
      const coverEntry = coverPath ? zipEntry(zip, coverPath) : null;
      if (coverEntry) {
        try {
          const coverBuf = await coverEntry.async('nodebuffer');
          if (coverBuf && coverBuf.length > 0 && coverBuf.length <= MAX_IMAGE_BYTES) {
            const ext = path.posix.extname(coverPath).toLowerCase() || '.jpg';
            const coverAbs = path.join(cacheDir, `cover${ext}`);
            if (!fs.existsSync(coverAbs)) fs.writeFileSync(coverAbs, coverBuf);
            coverUrl = `comic://media/?path=${encodeURIComponent(coverAbs)}`;
          }
        } catch (_) {}
      }
    }

    const newMeta = {
      sourceSize: stat.size,
      sourceMtimeMs: stat.mtimeMs,
      title: opf.title,
      creator: opf.creator,
      coverUrl,
      chapters,
    };
    await writeMeta(cacheDir, newMeta);
    return {
      success: true,
      fromCache: false,
      embeddedAnnotations,
      title: opf.title,
      creator: opf.creator,
      coverUrl,
      chapters,
      fileName: path.basename(filePath),
      fileSize: stat.size,
      sourceMtimeMs: stat.mtimeMs,
      totalChapters: chapters.length,
    };
  } catch (err) {
    return { success: false, message: `خطا در خواندنِ EPUB: ${err && err.message ? err.message : 'نامشخص'}` };
  }
}

// خواندنِ تنبلِ یک فصل (با کشِ دیسکیِ HTMLِ پاک‌سازی‌شده).
async function loadEpubChapter(filePath, chapterId, dataDir) {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, message: 'مسیرِ فایل مشخص نیست.' };
    }
    if (!chapterId || typeof chapterId !== 'string') {
      return { success: false, message: 'شناسهٔ فصل مشخص نیست.' };
    }
    if (!dataDir) return { success: false, message: 'پوشهٔ دادهٔ برنامه مشخص نیست.' };
    const cacheDir = path.join(dataDir, 'epub-cache', sha256Hex(normalizeKey(filePath)));
    const imagesDir = path.join(cacheDir, 'images');
    const chaptersDir = path.join(cacheDir, 'chapters');
    const stat = await fs.promises.stat(filePath);
    let meta = await readMeta(cacheDir);
    if (!meta || meta.sourceSize !== stat.size || meta.sourceMtimeMs !== stat.mtimeMs) {
      // کش کهنه است: متادیتا را تازه می‌کنیم (متنِ فصل‌ها لازم نیست).
      const fresh = await loadEpubBook(filePath, dataDir);
      if (!fresh.success) return fresh;
      meta = await readMeta(cacheDir);
      if (!meta) return { success: false, message: 'متادیتایِ EPUB ساخته نشد.' };
    }
    const chapter = (meta.chapters || []).find((c) => c.id === chapterId);
    if (!chapter) return { success: false, message: 'فصلِ خواسته‌شده یافت نشد.' };
    const htmlPath = path.join(chaptersDir, `${safeSegment(chapterId)}.html`);
    try {
      const cached = await fs.promises.readFile(htmlPath, 'utf8');
      if (cached) return { success: true, fromCache: true, chapterId, title: chapter.title, html: cached };
    } catch (_) {}
    const zipCacheKey = `${filePath}|${stat.size}|${stat.mtimeMs}`;
    let zip = cachedEpubZip && cachedEpubZip.key === zipCacheKey ? cachedEpubZip.zip : null;
    if (!zip) {
      const JSZip = require('jszip');
      const buf = await fs.promises.readFile(filePath);
      zip = await JSZip.loadAsync(buf);
      if (stat.size <= MAX_CACHED_EPUB_ZIP_BYTES) {
        cachedEpubZip = { key: zipCacheKey, zip };
      } else {
        cachedEpubZip = null;
      }
    }
    const entry = zipEntry(zip, chapter.href);
    if (!entry) return { success: false, message: 'متنِ فصل داخلِ EPUB یافت نشد.' };
    const rawHtml = await entry.async('string');
    const html = await sanitizeChapterHtml(rawHtml, {
      zip,
      chapterDir: posixDirname(chapter.href),
      imagesDir,
    });
    await fs.promises.mkdir(chaptersDir, { recursive: true });
    await fs.promises.writeFile(htmlPath, html, 'utf8');
    return { success: true, fromCache: false, chapterId, title: chapter.title, html };
  } catch (err) {
    return { success: false, message: `خطا در خواندنِ فصل: ${err && err.message ? err.message : 'نامشخص'}` };
  }
}


// ============================================================================
// مرحلهٔ ۴۴ §۴: مانیفستِ جاسازی‌شدهٔ حاشیه‌نویسی (CBZ و EPUB — یک شکلِ واحد)
// ============================================================================
const EMBEDDED_ANNOTATIONS_FORMAT = 'comic-reader-annotations';
const EMBEDDED_ANNOTATIONS_VERSION = 1;
const EPUB_EMBEDDED_MANIFEST_PATH = 'META-INF/comic-reader-annotations.json';
const EPUB_OVERLAY_CLASS = 'cr-baked-epub-overlay';
const EPUB_OVERLAY_BEGIN_MARKER = '<!--cr-baked-epub-overlay-begin-->';
const EPUB_OVERLAY_END_MARKER = '<!--cr-baked-epub-overlay-end-->';
const MAX_EMBEDDED_MANIFEST_BYTES = 20 * 1024 * 1024;
const MAX_OVERLAY_IMAGE_BYTES = 50 * 1024 * 1024;

// پاک‌سازیِ annotationsByPage: فقط کلیدهایِ عددیِ مثبت با آیتم‌هایِ آبجکتی.
function cleanAnnotationPages(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, items] of Object.entries(raw)) {
    const n = Number(key);
    if (!Number.isFinite(n) || n < 1 || Math.floor(n) !== n) continue;
    if (!Array.isArray(items) || items.length === 0) continue;
    const cleanItems = items.filter((it) => it && typeof it === 'object' && !Array.isArray(it));
    if (cleanItems.length > 0) out[String(n)] = cleanItems;
  }
  return out;
}

function cleanObjectList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((it) => it && typeof it === 'object' && !Array.isArray(it));
}

// ساختِ مانیفستِ جاسازی‌شده (همان شکل در CBZ و EPUB).
function buildAnnotationManifest(fileType, annotationsByPage, extra) {
  return {
    format: EMBEDDED_ANNOTATIONS_FORMAT,
    version: EMBEDDED_ANNOTATIONS_VERSION,
    app: 'my-comic-reader',
    fileType,
    savedAt: new Date().toISOString(),
    annotationsByPage: cleanAnnotationPages(annotationsByPage),
    highlights: cleanObjectList(extra && extra.highlights),
    bookmarks: cleanObjectList(extra && extra.bookmarks),
  };
}

// پارسِ مانیفستِ جاسازی‌شده؛ هر ساختارِ نامعتبر → null (نه throw).
function parseAnnotationManifest(text, fileType) {
  try {
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_EMBEDDED_MANIFEST_BYTES) return null;
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.format !== EMBEDDED_ANNOTATIONS_FORMAT) return null;
    if (parsed.version !== EMBEDDED_ANNOTATIONS_VERSION) return null;
    if (fileType && parsed.fileType && parsed.fileType !== fileType) return null;
    return {
      annotationsByPage: cleanAnnotationPages(parsed.annotationsByPage),
      highlights: cleanObjectList(parsed.highlights),
      bookmarks: cleanObjectList(parsed.bookmarks),
    };
  } catch (_) { return null; }
}

async function readEmbeddedEpubAnnotationsFromZip(zip) {
  try {
    if (!zip) return null;
    const entry = zipEntry(zip, EPUB_EMBEDDED_MANIFEST_PATH);
    if (!entry) return null;
    const text = await entry.async('string');
    return parseAnnotationManifest(text, 'epub');
  } catch (_) { return null; }
}

async function readEmbeddedEpubAnnotations(filePath) {
  try {
    if (!filePath || typeof filePath !== 'string') return null;
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_EPUB_BYTES) return null;
    const JSZip = require('jszip');
    const buf = await fs.promises.readFile(filePath);
    const zip = await JSZip.loadAsync(buf);
    return await readEmbeddedEpubAnnotationsFromZip(zip);
  } catch (_) { return null; }
}

// پاک‌سازی و بازسازیِ کشِ epub-cache پس از ذخیرهٔ درجا: پوشهٔ کشِ
// همان فایل حذف می‌شود و نمونهٔ کش‌شدهٔ JSZip (OPT-07) هم باطل
// می‌شود تا باز شدنِ بعدی، فصل‌ها را از فایلِ تازه بخواند.
async function clearEpubCache(filePath, dataDir) {
  try {
    if (!filePath || !dataDir) return false;
    if (cachedEpubZip && typeof cachedEpubZip.key === 'string' && cachedEpubZip.key.startsWith(String(filePath) + '|')) cachedEpubZip = null;
    const cacheDir = path.join(dataDir, 'epub-cache', sha256Hex(normalizeKey(filePath)));
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
    return true;
  } catch (_) { return false; }
}

// اعتبارسنجِ سبکِ خوش‌فرمیِ XML/XHTML (بدونِ وابستگی): توازنِ تگ‌ها
// با پشته؛ کامنت، CDATA، دستورِ پردازش و DOCTYPE نادیده گرفته
// می‌شوند و تگ‌هایِ void حتی بدونِ «/» هم خودبسته حساب می‌شوند.
function validateXhtmlWellFormed(xhtml) {
  try {
    let s = String(xhtml || '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    s = s.replace(/<\?[\s\S]*?\?>/g, '');
    s = s.replace(/<!DOCTYPE[^>]*>/gi, '');
    const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    const stack = [];
    const tagRe = /<(\/?)([A-Za-z][A-Za-z0-9_.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
    let m;
    while ((m = tagRe.exec(s)) !== null) {
      const isClose = m[1] === '/';
      const name = m[2].toLowerCase();
      const selfClose = m[4] === '/';
      if (isClose) {
        if (VOID.has(name)) continue;
        if (stack.length === 0 || stack[stack.length - 1] !== name) return false;
        stack.pop();
      } else if (!selfClose && !VOID.has(name)) {
        stack.push(name);
      }
    }
    return stack.length === 0;
  } catch (_) { return false; }
}

// حذفِ بلوکِ اورلیِ پخته‌شدهٔ قبلی: اول با مارکرهایِ خودمان (دقیق)،
// بعد با کلاس (دفاعِ دوم برایِ بلوکِ بدونِ مارکر).
function removeOldEpubOverlayBlock(xhtml) {
  let s = String(xhtml || '');
  s = s.replace(/<!--cr-baked-epub-overlay-begin-->[\s\S]*?<!--cr-baked-epub-overlay-end-->/g, '');
  s = s.replace(/<div\b[^>]*cr-baked-epub-overlay[^>]*>[\s\S]*?<\/div\s*>/gi, '');
  return s;
}

// بلوکِ اورلیِ تطبیقی: divای مطلق که کلِ جعبهٔ فصل را می‌پوشاند و
// تصویر(ها) با object-fit:fill کش می‌آیند؛ pointer-events ندارد تا
// خواندن/انتخابِ متن مختل نشود. ترتیبِ imgها: هایلایت زیر، لایهٔ اصلی رو.
function buildEpubOverlayBlock(files) {
  const imgs = files.map((f) => `<img src="${f.src}" alt="" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill;pointer-events:none;" />`).join('');
  return `${EPUB_OVERLAY_BEGIN_MARKER}<div class="${EPUB_OVERLAY_CLASS}" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;">${imgs}</div>${EPUB_OVERLAY_END_MARKER}`;
}

// تزریقِ بلوک در انتهایِ <body> — با جستجویِ ساختاری (نه جایگذاریِ
// کورکورانه): نزدیک‌ترین </body> که داخلِ کامنت نباشد؛ اگر <body>
// نبود، پیش از </html>؛ اگر آن هم نبود، انتهایِ سند.
function injectEpubOverlay(xhtml, overlayBlock) {
  let s = String(xhtml || '');
  s = removeOldEpubOverlayBlock(s);
  const bodyCloseRe = /<\/body\s*>/gi;
  let match = null;
  let last = null;
  while ((match = bodyCloseRe.exec(s)) !== null) last = match;
  if (last) {
    const prefix = s.slice(0, last.index);
    const openComments = (prefix.match(/<!--/g) || []).length;
    const closeComments = (prefix.match(/-->/g) || []).length;
    if (openComments === closeComments) {
      return { xhtml: s.slice(0, last.index) + overlayBlock + s.slice(last.index), injected: true };
    }
  }
  const htmlCloseRe = /<\/html\s*>/gi;
  let hMatch = null;
  let hLast = null;
  while ((hMatch = htmlCloseRe.exec(s)) !== null) hLast = hMatch;
  if (hLast) {
    return { xhtml: s.slice(0, hLast.index) + overlayBlock + s.slice(hLast.index), injected: true };
  }
  return { xhtml: s + overlayBlock, injected: true };
}

// مسیرِ نسبیِ POSIX از پوشهٔ OPF تا فایلِ هدف (برایِ hrefِ مانیفست).
function posixRelativePath(fromDir, toPath) {
  const from = String(fromDir || '').split('/').filter(Boolean);
  const to = String(toPath || '').split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const parts = [];
  for (let k = 0; k < from.length - i; k++) parts.push('..');
  for (let k = i; k < to.length; k++) parts.push(to[k]);
  return parts.join('/');
}

// به‌روزرسانیِ مانیفستِ OPF: آیتم‌هایِ اورلیِ قبلی حذف و آیتم‌هایِ
// تازه پیش از </manifest> درج می‌شوند؛ اگر </manifest> نبود، ناموفق.
function updateOpfManifestXml(opfXml, opfDir, overlayFiles) {
  let s = String(opfXml || '');
  s = s.replace(/<(?:[A-Za-z0-9_]+:)?item\b[^>]*\bid\s*=\s*"cr-overlay-[^"]*"[^>]*\/?>/gi, '');
  s = s.replace(/<(?:[A-Za-z0-9_]+:)?item\b[^>]*\bid\s*=\s*'cr-overlay-[^']*'[^>]*\/?>/gi, '');
  if (!overlayFiles || overlayFiles.length === 0) return { opfXml: s, updated: true };
  const itemsXml = overlayFiles.map((f) => `    <item id="${f.id}" href="${f.href}" media-type="image/png" />`).join('\n');
  const closeRe = /<\/(?:[A-Za-z0-9_]+:)?manifest\s*>/i;
  const m = s.match(closeRe);
  if (!m) return { opfXml: s, updated: false };
  const idx = s.search(closeRe);
  return { opfXml: s.slice(0, idx) + itemsXml + '\n' + s.slice(idx), updated: true };
}

// دیکدِ data URLِ تصویری (base64) به بافر؛ هر چیزِ دیگر → null.
function decodeImageDataUrl(dataUrl, maxBytes) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[2], 'base64');
    const cap = typeof maxBytes === 'number' && maxBytes > 0 ? maxBytes : MAX_OVERLAY_IMAGE_BYTES;
    if (!buf || buf.length === 0 || buf.length > cap) return null;
    return { buffer: buf, mime: m[1] };
  } catch (_) { return null; }
}

// مرحلهٔ ۴۴ §۴: خروجیِ EPUBِ حاشیه‌نویسی‌شده.
// ورودی: { epubPath, outputPath, chapters, annotationsByPage, highlights, bookmarks }
// که chapters همان [{ chapterId, chapterIndex, href, overlayPng, highlightPng }] است.
// همهٔ ویرایش‌ها اول در حافظه انجام می‌شوند و فقط بافرِ نهایی
// برگردانده می‌شود (نوشتنِ اتمیک با هندلرِ main است)؛ پس هر خطا
// پیش از نوشتن، فایل را دست‌نخورده می‌گذارد.
// برایِ هر فصلِ spine: بلوکِ قدیمی همیشه پاک می‌شود و بلوکِ تازه
// فقط برایِ فصل‌هایِ دارایِ لایه تزریق می‌شود (ذخیرهٔ دوم، بلوک را
// دو تا نمی‌کند). اگر هیچ حاشیه‌نویسی/هایلایت/بوک‌مارکی نمانده باشد،
// مانیفست و اورلی‌ها حذف می‌شوند (restoredClean).
async function exportAnnotatedEpub(args) {
  try {
    const { epubPath, outputPath, chapters, annotationsByPage, highlights, bookmarks } = args || {};
    if (!epubPath || typeof epubPath !== 'string') return { success: false, error: 'مسیرِ فایلِ EPUB مشخص نیست.' };
    if (!outputPath || typeof outputPath !== 'string') return { success: false, error: 'مسیرِ خروجی مشخص نیست.' };
    const stat = await fs.promises.stat(epubPath);
    if (!stat.isFile()) return { success: false, error: 'فایلِ EPUB یافت نشد.' };
    if (stat.size > MAX_EPUB_BYTES) return { success: false, error: 'فایلِ EPUB بزرگ‌تر از حدِ مجاز (۲۰۰ مگابایت) است.' };
    const JSZip = require('jszip');
    const buf = await fs.promises.readFile(epubPath);
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files || {});
    const findCaseInsensitive = (target) => names.find((n) => n.toLowerCase() === target.toLowerCase()) || null;
    const containerName = findCaseInsensitive('META-INF/container.xml');
    const containerEntry = containerName ? zipEntry(zip, containerName) : null;
    if (!containerEntry) return { success: false, error: 'ساختارِ EPUB معتبر نیست (container.xml یافت نشد).' };
    const containerXml = await containerEntry.async('string');
    const opfPath = parseContainerXml(containerXml);
    if (!opfPath) return { success: false, error: 'فایلِ ریشهٔ EPUB (OPF) یافت نشد.' };
    const opfEntry = zipEntry(zip, opfPath);
    if (!opfEntry) return { success: false, error: 'فایلِ OPF داخلِ EPUB یافت نشد.' };
    const opfXml = await opfEntry.async('string');
    const opf = parseOpf(opfXml);
    const opfDir = posixDirname(opfPath);
    const spineChapters = [];
    for (let i = 0; i < opf.spine.length; i++) {
      const item = opf.manifest[opf.spine[i]];
      if (!item) continue;
      const zipPath = resolveZipPath(opfDir, item.href);
      if (!zipPath) continue;
      spineChapters.push({ id: `ch${i}`, href: zipPath });
    }
    const wanted = Array.isArray(chapters) ? chapters : [];
    const wantedById = new Map();
    for (const ch of wanted) {
      if (!ch || typeof ch !== 'object') continue;
      const chapterId = typeof ch.chapterId === 'string' ? ch.chapterId : '';
      if (!chapterId) continue;
      wantedById.set(chapterId, ch);
    }
    const manifest = buildAnnotationManifest('epub', annotationsByPage, { highlights, bookmarks });
    const hasManifestContent = Object.keys(manifest.annotationsByPage).length > 0 || manifest.highlights.length > 0 || manifest.bookmarks.length > 0;
    let injectedCount = 0;
    let removedChapters = 0;
    let removedFiles = 0;
    const newOverlayFiles = [];
    const newOverlayZipPaths = new Set();
    for (const spineCh of spineChapters) {
      const entry = zipEntry(zip, spineCh.href);
      if (!entry) continue;
      const xhtml = await entry.async('string');
      const hadOld = xhtml.includes(EPUB_OVERLAY_BEGIN_MARKER) || /cr-baked-epub-overlay/.test(xhtml);
      const wantedCh = wantedById.get(spineCh.id);
      const preValid = validateXhtmlWellFormed(xhtml);
      const cleaned = removeOldEpubOverlayBlock(xhtml);
      if (hadOld) removedChapters++;
      const overlayPng = wantedCh && typeof wantedCh.overlayPng === 'string' ? decodeImageDataUrl(wantedCh.overlayPng) : null;
      const highlightPng = wantedCh && typeof wantedCh.highlightPng === 'string' ? decodeImageDataUrl(wantedCh.highlightPng) : null;
      if (!overlayPng && !highlightPng) {
        if (cleaned !== xhtml) zip.file(spineCh.href, cleaned);
        continue;
      }
      const chapterDir = posixDirname(spineCh.href);
      const safeId = String(spineCh.id).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'ch';
      const files = [];
      if (highlightPng) {
        const hlName = `cr-overlay-${safeId}-hl.png`;
        const hlZipPath = chapterDir ? `${chapterDir}/${hlName}` : hlName;
        zip.file(hlZipPath, highlightPng.buffer);
        newOverlayZipPaths.add(hlZipPath);
        newOverlayFiles.push({ id: `cr-overlay-${safeId}-hl`, href: posixRelativePath(opfDir, hlZipPath) });
        files.push({ src: hlName });
      }
      if (overlayPng) {
        const ovName = `cr-overlay-${safeId}.png`;
        const ovZipPath = chapterDir ? `${chapterDir}/${ovName}` : ovName;
        zip.file(ovZipPath, overlayPng.buffer);
        newOverlayZipPaths.add(ovZipPath);
        newOverlayFiles.push({ id: `cr-overlay-${safeId}`, href: posixRelativePath(opfDir, ovZipPath) });
        files.push({ src: ovName });
      }
      const block = buildEpubOverlayBlock(files);
      const injected = injectEpubOverlay(cleaned, block);
      const postValid = validateXhtmlWellFormed(injected.xhtml);
      if (!postValid && preValid) {
        return { success: false, error: `تزریقِ اورلی در فصلِ ${spineCh.href} سند را خراب می‌کند؛ فایل دست نخورده است.` };
      }
      zip.file(spineCh.href, injected.xhtml);
      injectedCount++;
    }
    for (const name of Object.keys(zip.files || {})) {
      if (/(^|\/)cr-overlay-[A-Za-z0-9._-]+\.png$/.test(name) && !newOverlayZipPaths.has(name)) {
        try { zip.remove(name); } catch (_) {}
        removedFiles++;
      }
    }
    let restoredClean = false;
    if (hasManifestContent || injectedCount > 0) {
      zip.file(EPUB_EMBEDDED_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    } else {
      const existing = zipEntry(zip, EPUB_EMBEDDED_MANIFEST_PATH);
      if (existing) {
        try { zip.remove(EPUB_EMBEDDED_MANIFEST_PATH); } catch (_) {}
        restoredClean = true;
      }
      if (removedChapters > 0 || removedFiles > 0) restoredClean = true;
    }
    const opfUpdated = updateOpfManifestXml(opfXml, opfDir, newOverlayFiles);
    if (!opfUpdated.updated) {
      return { success: false, error: 'مانیفستِ OPF قابلِ به‌روزرسانی نیست؛ فایل دست نخورده است.' };
    }
    if (opfUpdated.opfXml !== opfXml) {
      const opfPreValid = validateXhtmlWellFormed(opfXml);
      const opfPostValid = validateXhtmlWellFormed(opfUpdated.opfXml);
      if (!opfPostValid && opfPreValid) {
        return { success: false, error: 'به‌روزرسانیِ مانیفستِ OPF سند را خراب می‌کند؛ فایل دست نخورده است.' };
      }
      zip.file(opfPath, opfUpdated.opfXml);
    }
    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    return { success: true, buffer: outBuffer, injectedChapters: injectedCount, removedChapters, removedFiles, restoredClean };
  } catch (err) {
    return { success: false, error: `خطا در ذخیرهٔ EPUBِ حاشیه‌نویسی‌شده: ${err && err.message ? err.message : 'نامشخص'}` };
  }
}

module.exports = {
  loadEpubBook,
  loadEpubChapter,
  readEmbeddedEpubAnnotations,
  readEmbeddedEpubAnnotationsFromZip,
  exportAnnotatedEpub,
  clearEpubCache,
  buildAnnotationManifest,
  parseAnnotationManifest,
  validateXhtmlWellFormed,
  injectEpubOverlay,
  removeOldEpubOverlayBlock,
  updateOpfManifestXml,
  decodeImageDataUrl,
  parseContainerXml,
  parseOpf,
  parseTocNcx,
  parseNavDoc,
  resolveZipPath,
  sanitizeChapterHtml,
  MAX_EPUB_BYTES,
  MAX_CHAPTERS,
};
