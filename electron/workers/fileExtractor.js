const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const IMAGE_REGEX = /\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i;
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

// استخراج فوق‌سریع ابعاد تصویر (Width & Height) مستقیماً از هدر باینری بافر در ۰.۰۱ میلی‌ثانیه
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
  return 'zip';
}

// ۱. استخراج موازی و فوق‌سریع ZIP / CBZ همراه با ابعاد دقیق صفحات
async function extractZip(fileContent, outputDir, coverOnly = false) {
  const zip = await JSZip.loadAsync(fileContent);
  const entries = [];

  zip.forEach((relativePath, entry) => {
    if (!entry.dir && isValidImageEntry(relativePath)) {
      entries.push({ relativePath, entry });
    }
  });

  const totalFiles = entries.length;
  if (totalFiles === 0) {
    throw new Error('هیچ فایل تصویری معتبری در این فایل فشرده یافت نشد.');
  }

  entries.sort((a, b) => hierarchicalCompare(a.relativePath, b.relativePath));

  if (coverOnly) {
    const firstBuffer = await entries[0].entry.async('nodebuffer');
    const mime = detectMimeFromBuffer(firstBuffer);
    return { coverBuffer: firstBuffer, mime };
  }

  const imageFiles = new Array(totalFiles);
  let firstCoverBuffer = null;
  let firstCoverMime = 'image/jpeg';
  let processed = 0;
  const WRITE_BATCH_SIZE = 8;

  for (let batchStart = 0; batchStart < totalFiles; batchStart += WRITE_BATCH_SIZE) {
    const batchEnd = Math.min(totalFiles, batchStart + WRITE_BATCH_SIZE);
    const batchPromises = [];

    for (let i = batchStart; i < batchEnd; i++) {
      batchPromises.push(
        (async (idx) => {
          const { relativePath, entry } = entries[idx];
          const buffer = await entry.async('nodebuffer');

          if (idx === 0) {
            firstCoverBuffer = buffer;
            firstCoverMime = detectMimeFromBuffer(buffer);
          }

          const dims = extractImageDimensions(buffer);
          const normRel = relativePath.replace(/\\/g, '/');
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
    processed = batchEnd;
    const percent = Math.round((processed / totalFiles) * 100);
    parentPort.postMessage({ type: 'progress', percent });
  }

  return {
    items: imageFiles.filter(Boolean),
    coverBuffer: firstCoverBuffer,
    coverMime: firstCoverMime
  };
}

// ۲. استخراج موازی و ایمن RAR / CBR همراه با ابعاد دقیق صفحات
async function extractRar(fileBuffer, outputDir, coverOnly = false) {
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

  const extracted = extractor.extract({
    files: fileHeaders.map((h) => h.name)
  });

  const rawExtractedMap = new Map();
  for (const file of extracted.files) {
    if (file.extraction) {
      rawExtractedMap.set(file.fileHeader.name, Buffer.from(file.extraction));
    }
  }

  const imageFiles = new Array(totalFiles);
  let firstCoverBuffer = null;
  let firstCoverMime = 'image/jpeg';
  let processed = 0;
  const WRITE_BATCH_SIZE = 8;

  for (let batchStart = 0; batchStart < totalFiles; batchStart += WRITE_BATCH_SIZE) {
    const batchEnd = Math.min(totalFiles, batchStart + WRITE_BATCH_SIZE);
    const batchPromises = [];

    for (let i = batchStart; i < batchEnd; i++) {
      batchPromises.push(
        (async (idx) => {
          const headerName = fileHeaders[idx].name;
          const buffer = rawExtractedMap.get(headerName);
          if (!buffer) return;
          rawExtractedMap.delete(headerName);

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
    processed = batchEnd;
    const percent = Math.round((processed / totalFiles) * 100);
    parentPort.postMessage({ type: 'progress', percent });
  }

  return {
    items: imageFiles.filter(Boolean),
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

    if (coverOnly) {
      const res = archiveType === 'rar'
        ? await extractRar(fileBuffer, null, true)
        : await extractZip(fileBuffer, null, true);

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
      ? await extractRar(fileBuffer, comicOutputDir, false)
      : await extractZip(fileBuffer, comicOutputDir, false);

    parentPort.postMessage({
      type: 'done',
      items: res.items,
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