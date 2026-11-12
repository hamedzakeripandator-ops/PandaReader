const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const IMAGE_REGEX = /\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i;
const NESTED_ARCHIVE_REGEX = /\.(zip|cbz)$/i;
// سقف عمق تودرتویی زیپ‌در‌زیپ — جلوگیری از بازگشت بی‌نهایت / بمب آرشیوی
const MAX_NESTED_DEPTH = 3;
const WRITE_BATCH_SIZE = 8;
// اندازهٔ دستهٔ استخراج RAR — هر دسته فقط ۸ فایل را به رم می‌کشد (مثل ZIP) تا
// آرشیوهای ۱ گیگابایتی ورکر را با OOM نکشند. مقدارش با WRITE_BATCH_SIZE یکی
// است ولی ثابتِ جداگانه دارد تا اگر روزی لازم شد مستقل تنظیم شود.
const RAR_BATCH_SIZE = 8;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// فیلتر هوشمند فایل‌های مخفی مکینتاش، فایل‌های سیستمی و تصاویر بندانگشتی معیوب
function isValidImageEntry(relativePath) {
  if (!relativePath) return false;
  const norm = relativePath.replace(/\\/g, '/');
  if (norm.includes('__MACOSX/') || norm.includes('/._') || norm.startsWith('._')) {
    return false;
  }
  const base = path.basename(norm);
  if (base.startsWith('.')) return false;
  return IMAGE_REGEX.test(base);
}

// تشخیص قطعی فرمت تصویر از روی بایت‌های جادویی بافر (Magic Bytes)
function detectMimeFromBuffer(buffer) {
  if (!buffer || buffer.length < 12) return 'image/jpeg';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

// استخراج فوق‌سریع ابعاد تصویر (Width & Height) مستقیماً از هدر باینری بافر
function extractImageDimensions(buffer) {
  try {
    if (!buffer || buffer.length < 30) return null;

    // 1. PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }

    // 2. GIF
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      if (width > 0 && height > 0) return { width, height };
    }

    // 3. BMP
    if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
      const width = Math.abs(buffer.readInt32LE(18));
      const height = Math.abs(buffer.readInt32LE(22));
      if (width > 0 && height > 0) return { width, height };
    }

    // 4. WebP (VP8, VP8L, VP8X)
    if (
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    ) {
      const chunkHeader = buffer.toString('ascii', 12, 16);
      if (chunkHeader === 'VP8 ' && buffer.length >= 30) {
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        if (width > 0 && height > 0) return { width, height };
      } else if (chunkHeader === 'VP8L' && buffer.length >= 25) {
        const b0 = buffer[21];
        const b1 = buffer[22];
        const b2 = buffer[23];
        const b3 = buffer[24];
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        if (width > 0 && height > 0) return { width, height };
      } else if (chunkHeader === 'VP8X' && buffer.length >= 30) {
        const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
        const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
        if (width > 0 && height > 0) return { width, height };
      }
    }

    // 5. JPEG (SOF0 .. SOF15)
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      let offset = 2;
      const len = buffer.length;
      while (offset < len - 9) {
        if (buffer[offset] !== 0xFF) {
          offset++;
          continue;
        }
        const marker = buffer[offset + 1];
        if (marker === 0xFF) {
          offset++;
          continue;
        }
        if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
          offset += 2;
          continue;
        }
        if (offset + 3 >= len) break;
        const segmentLength = buffer.readUInt16BE(offset + 2);
        if (segmentLength < 2) break;

        if (
          (marker >= 0xC0 && marker <= 0xC3) ||
          (marker >= 0xC5 && marker <= 0xC7) ||
          (marker >= 0xC9 && marker <= 0xCB) ||
          (marker >= 0xCD && marker <= 0xCF)
        ) {
          if (offset + 8 < len) {
            const height = buffer.readUInt16BE(offset + 5);
            const width = buffer.readUInt16BE(offset + 7);
            if (width > 0 && height > 0) return { width, height };
          }
          break;
        }
        offset += 2 + segmentLength;
      }
    }
  } catch (_) {}
  return null;
}

// مقایسه هوشمند درختی و سلسله‌مراتبی فصول و فایل‌ها
function hierarchicalCompare(pathA, pathB) {
  const normA = pathA.replace(/\\/g, '/');
  const normB = pathB.replace(/\\/g, '/');
  const partsA = normA.split('/').filter(Boolean);
  const partsB = normB.split('/').filter(Boolean);
  const minLen = Math.min(partsA.length, partsB.length);

  for (let i = 0; i < minLen; i++) {
    if (partsA[i] !== partsB[i]) {
      return collator.compare(partsA[i], partsB[i]);
    }
  }
  return partsA.length - partsB.length;
}

function getArchiveType(filePath, headerBuf) {
  if (headerBuf && headerBuf.length >= 4) {
    if (headerBuf[0] === 0x50 && headerBuf[1] === 0x4B) return 'zip';
    if (headerBuf[0] === 0x52 && headerBuf[1] === 0x61 && headerBuf[2] === 0x72 && headerBuf[3] === 0x21) return 'rar';
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.cbr' || ext === '.rar') return 'rar';
  // NOTE: ‎.7z فعلاً پشتیبانی نمی‌شود (فاز node-7z) — به‌عنوان zip برمی‌گردد و خطای کنترل‌شده می‌دهد
  return 'zip';
}

function stripArchiveExt(name) {
  return name.replace(/\.(zip|cbz)$/i, '');
}

// نام فصل هر آیتم = اولین سگمنت مسیر (پوشه سطح‌اول یا نام زیپ تودرتو)
function chapterNameOf(relativePath, fallback) {
  const segs = relativePath.split('/').filter(Boolean);
  if (segs.length > 1) return stripArchiveExt(segs[0]);
  return fallback;
}

// پیمایش بازگشتی زیپ: جمع‌آوری تصاویر + باز کردن زیپ‌های تودرتو
// زیپ‌های تودرتو «ترتیبی» باز می‌شوند تا حافظه جهش نکند
async function collectEntries(zip, prefix, depth, out) {
  const nested = [];

  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    const norm = relativePath.replace(/\\/g, '/');
    if (!norm) return;
    const base = norm.split('/').pop();
    if (base.startsWith('._') || base.startsWith('.')) return; // فایل سیستمی/مک
    const fullRel = prefix ? `${prefix}/${norm}` : norm;

    if (isValidImageEntry(norm)) {
      out.push({ relativePath: fullRel, load: () => entry.async('nodebuffer') });
    } else if (depth < MAX_NESTED_DEPTH && NESTED_ARCHIVE_REGEX.test(base)) {
      nested.push({ norm, entry });
    }
  });

  for (const { norm, entry } of nested) {
    try {
      const buf = await entry.async('nodebuffer');
      const sub = await JSZip.loadAsync(buf);
      const zipBase = stripArchiveExt(norm.split('/').pop());
      const subPrefix = prefix ? `${prefix}/${zipBase}` : zipBase;
      await collectEntries(sub, subPrefix, depth + 1, out);
    } catch (_) {
      // زیپ تودرتوی خراب نادیده گرفته می‌شود
    }
  }
}

// ساخت لیست فصل‌ها از روی آیتم‌های سورت‌شده: [{ name, startPage, endPage }]
function buildChapters(sortedItems, fallbackName) {
  const chapters = [];
  let current = null;
  sortedItems.forEach((item, idx) => {
    const name = chapterNameOf(item.relativePath, fallbackName);
    if (!current || current.name !== name) {
      current = { name, startPage: idx, endPage: idx };
      chapters.push(current);
    } else {
      current.endPage = idx;
    }
  });
  return chapters;
}

// ۱. استخراج موازی ZIP / CBZ — با پشتیبانی از زیپ‌در‌زیپ و مرز فصل‌ها
async function extractZip(fileContent, outputDir, coverOnly = false, archiveLabel = 'comic') {
  const zip = await JSZip.loadAsync(fileContent);
  const collected = [];
  await collectEntries(zip, '', 0, collected);

  if (collected.length === 0) {
    throw new Error('هیچ فایل تصویری معتبری در این فایل فشرده یافت نشد.');
  }

  collected.sort((a, b) => hierarchicalCompare(a.relativePath, b.relativePath));

  if (coverOnly) {
    const firstBuffer = await collected[0].load();
    const mime = detectMimeFromBuffer(firstBuffer);
    return { coverBuffer: firstBuffer, mime };
  }

  const totalFiles = collected.length;
  const imageFiles = new Array(totalFiles);
  let firstCoverBuffer = null;
  let firstCoverMime = 'image/jpeg';

  for (let batchStart = 0; batchStart < totalFiles; batchStart += WRITE_BATCH_SIZE) {
    const batchEnd = Math.min(totalFiles, batchStart + WRITE_BATCH_SIZE);
    const batchPromises = [];

    for (let i = batchStart; i < batchEnd; i++) {
      batchPromises.push(
        (async (idx) => {
          const { relativePath, load } = collected[idx];
          const buffer = await load();

          if (idx === 0) {
            firstCoverBuffer = buffer;
            firstCoverMime = detectMimeFromBuffer(buffer);
          }

          const dims = extractImageDimensions(buffer);
          const normRel = relativePath.replace(/\\/g, '/');
          const dirPart = path.dirname(normRel);
          const fileName = path.basename(normRel);
          const ext = path.extname(fileName).toLowerCase() || '.jpg';
          // فرمت فیلد chapter دقیقاً مثل قبل حفظ شده (سازگاری با RightPanel)
          const chapterName = dirPart && dirPart !== '.' ? dirPart.replace(/\//g, ' - ') : '';

          const safeDiskFileName = `page_${String(idx + 1).padStart(5, '0')}${ext}`;
          const outputPath = path.join(outputDir, safeDiskFileName);

          await fs.promises.writeFile(outputPath, buffer);

          imageFiles[idx] = {
            path: outputPath,
            name: chapterName ? `${chapterName} / ${fileName}` : fileName,
            fileName: fileName,
            chapter: chapterName,
            relativePath: normRel,
            width: dims?.width || null,
            height: dims?.height || null,
            aspectRatio: dims?.width && dims?.height ? Number((dims.height / dims.width).toFixed(5)) : null
          };
        })(i)
      );
    }

    await Promise.all(batchPromises);
    const percent = Math.round((batchEnd / totalFiles) * 100);
    parentPort.postMessage({ type: 'progress', percent });
  }

  const items = imageFiles.filter(Boolean);
  return {
    items,
    chapters: buildChapters(items, archiveLabel),
    coverBuffer: firstCoverBuffer,
    coverMime: firstCoverMime
  };
}

// ۲. استخراج موازی و ایمن RAR / CBR همراه با ابعاد دقیق صفحات
async function extractRar(fileBuffer, outputDir, coverOnly = false, archiveLabel = 'comic') {
  let unrar;
  try {
    unrar = require('node-unrar-js');
  } catch (e) {
    throw new Error('ماژول node-unrar-js در سیستم یافت نشد.');
  }

  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );

  const extractor = await unrar.createExtractorFromData({ data: arrayBuffer });
  const list = extractor.getFileList();
  const fileHeaders = [...list.fileHeaders].filter(
    (h) => !h.flags.directory && isValidImageEntry(h.name)
  );

  const totalFiles = fileHeaders.length;
  if (totalFiles === 0) {
    throw new Error('هیچ تصویری در این آرشیو RAR/CBR یافت نشد.');
  }

  fileHeaders.sort((a, b) => hierarchicalCompare(a.name, b.name));

  if (coverOnly) {
    const singleExtracted = extractor.extract({ files: [fileHeaders[0].name] });
    for (const file of singleExtracted.files) {
      if (file.extraction) {
        const coverBuf = Buffer.from(file.extraction);
        const mime = detectMimeFromBuffer(coverBuf);
        return { coverBuffer: coverBuf, mime };
      }
    }
    throw new Error('استخراج بافر کاور اول ناموفق بود.');
  }

  // مرحلهٔ ۵۹ §۳٫۱ — استخراجِ دسته‌ایِ RAR: هر دسته فقط RAR_BATCH_SIZE فایل
  // را به رم می‌کشد و بلافاصله پس از نوشتن روی دیسک، بافرش دور ریخته
  // می‌شود؛ رم در کلِ استخراج، به ۸ صفحهٔ هم‌زمان محدود می‌ماند.
  // نکتهٔ node-unrar-js (نسخهٔ ۲٫۰٫۲): مقدارِ برگشتیِ extract() ایتریتورِ
  // تنبل است و شیءِ C++‎ آرشیو تا وقتی ایتریتور تا انتها پیموده نشود آزاد
  // نمی‌شود (هشدارِ نشتِ حافظه در مستنداتِ کتابخانه)؛ فراخوانیِ دوبارهٔ
  // ‎extract()‎ روی همان extractor هم تضمین‌شده نیست، پس برای هر دسته یک
  // extractorِ تازه از روی همان ArrayBuffer ساخته می‌شود (هزینه‌اش فقط
  // بازخوانیِ هدرِ آرشیو است، نه کپیِ دوبارهٔ کلِ فایل). نتیجهٔ تستِ
  // رفتارِ «یک‌بارمصرف» بودنِ extractor در گزارشِ مرحلهٔ ۵۹ (m5) ثبت
  // شده است.
  const imageFiles = new Array(totalFiles);
  let firstCoverBuffer = null;
  let firstCoverMime = 'image/jpeg';

  for (let batchStart = 0; batchStart < totalFiles; batchStart += RAR_BATCH_SIZE) {
    const batchEnd = Math.min(totalFiles, batchStart + RAR_BATCH_SIZE);
    const batchNames = fileHeaders.slice(batchStart, batchEnd).map((h) => h.name);

    // extractorِ تازه برای این دسته (همان دادهٔ ورودی، بدونِ کپیِ دوباره).
    const batchExtractor = await unrar.createExtractorFromData({ data: arrayBuffer });
    const batchExtracted = batchExtractor.extract({ files: batchNames });

    // فقط بافرهای همین دسته در رم می‌مانند؛ ایتریتور تا انتها پیموده
    // می‌شود تا شیءِ C++‎ آرشیو آزاد شود، و با تمام‌شدنِ دسته، Map دور
    // انداخته می‌شود و GC بافرها را آزاد می‌کند.
    const batchMap = new Map();
    for (const file of batchExtracted.files) {
      if (file.extraction) {
        batchMap.set(file.fileHeader.name, Buffer.from(file.extraction));
      }
    }

    const batchPromises = [];

    for (let i = batchStart; i < batchEnd; i++) {
      batchPromises.push(
        (async (idx) => {
          const headerName = fileHeaders[idx].name;
          const buffer = batchMap.get(headerName);
          if (!buffer) return;
          batchMap.delete(headerName);

          if (idx === 0) {
            firstCoverBuffer = buffer;
            firstCoverMime = detectMimeFromBuffer(buffer);
          }

          const dims = extractImageDimensions(buffer);
          const normRel = headerName.replace(/\\/g, '/');
          const dirPart = path.dirname(normRel);
          const fileName = path.basename(normRel);
          const ext = path.extname(fileName).toLowerCase() || '.jpg';
          const chapterName = dirPart && dirPart !== '.' ? dirPart.replace(/\//g, ' - ') : '';

          const safeDiskFileName = `page_${String(idx + 1).padStart(5, '0')}${ext}`;
          const outputPath = path.join(outputDir, safeDiskFileName);

          await fs.promises.writeFile(outputPath, buffer);

          imageFiles[idx] = {
            path: outputPath,
            name: chapterName ? `${chapterName} / ${fileName}` : fileName,
            fileName: fileName,
            chapter: chapterName,
            relativePath: normRel,
            width: dims?.width || null,
            height: dims?.height || null,
            aspectRatio: dims?.width && dims?.height ? Number((dims.height / dims.width).toFixed(5)) : null
          };
        })(i)
      );
    }

    await Promise.all(batchPromises);
    const percent = Math.round((batchEnd / totalFiles) * 100);
    parentPort.postMessage({ type: 'progress', percent });
  }

  const items = imageFiles.filter(Boolean);
  return {
    items,
    chapters: buildChapters(items, archiveLabel),
    coverBuffer: firstCoverBuffer,
    coverMime: firstCoverMime
  };
}

parentPort.on('message', async (data) => {
  const { filePath, tempDir, coverOnly = false } = data;

  try {
    if (!filePath || !fs.existsSync(filePath)) {
      parentPort.postMessage({ type: 'error', message: 'فایل کمیک در دیسک یافت نشد.' });
      return;
    }

    const fileBuffer = await fs.promises.readFile(filePath);
    const archiveType = getArchiveType(filePath, fileBuffer);
    const archiveLabel = path.basename(filePath, path.extname(filePath)) || 'comic';

    if (coverOnly) {
      const res = archiveType === 'rar'
        ? await extractRar(fileBuffer, null, true, archiveLabel)
        : await extractZip(fileBuffer, null, true, archiveLabel);

      parentPort.postMessage({
        type: 'done_cover',
        coverBuffer: res.coverBuffer,
        mime: res.mime || 'image/jpeg'
      });
      return;
    }

    const hashSuffix = Buffer.from(filePath).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-10);
    const safeComicName = `comic_${hashSuffix}_${Date.now().toString(36)}`;
    const comicOutputDir = path.join(tempDir, safeComicName);

    await fs.promises.mkdir(comicOutputDir, { recursive: true });
    parentPort.postMessage({ type: 'progress', percent: 5 });

    const res = archiveType === 'rar'
      ? await extractRar(fileBuffer, comicOutputDir, false, archiveLabel)
      : await extractZip(fileBuffer, comicOutputDir, false, archiveLabel);

    parentPort.postMessage({
      type: 'done',
      items: res.items,
      chapters: res.chapters || [],
      extractedDir: comicOutputDir,
      coverBuffer: res.coverBuffer || null,
      coverMime: res.coverMime || 'image/jpeg'
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      message: 'خطا در استخراج فایل: ' + error.message
    });
  }
});
