const fs = require('fs');
const path = require('path');

const IMAGE_REGEX = /\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i;

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 MB';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + ['B', 'KB', 'MB', 'GB'][i];
}

class DirectoryService {
  constructor() {
    this.supportedArchiveExtensions = new Set(['.cbz', '.zip', '.cbr', '.pdf', '.rar', '.epub']); // NOTE: ‎'.7z' تا فاز node-7z
    this.collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  }

  // ۱. اسکن بازگشتی تمام تصاویر داخل یک پوشه با سورت درختی
  scanFolderForImages(folderPath) {
    const images = [];

    const walkSync = (currentDir, relativePrefix = '') => {
      let entries = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch (err) {
        return;
      }

      // سورت نام‌ها
      entries.sort((a, b) => this.collator.compare(a.name, b.name));

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name;

        if (entry.isDirectory()) {
          walkSync(fullPath, relPath);
        } else if (entry.isFile() && IMAGE_REGEX.test(entry.name)) {
          const dirPart = path.dirname(relPath);
          const chapterName = dirPart && dirPart !== '.' ? dirPart.replace(/[\\/]/g, ' - ') : '';
          images.push({
            path: fullPath,
            name: chapterName ? `${chapterName} / ${entry.name}` : entry.name,
            fileName: entry.name,
            chapter: chapterName,
            relativePath: relPath
          });
        }
      }
    };

    walkSync(folderPath);

    // سورت نهایی با حفظ تقدم پوشه‌ها
    images.sort((a, b) => {
      const segA = a.relativePath.replace(/\\/g, '/').split('/');
      const segB = b.relativePath.replace(/\\/g, '/').split('/');
      const minLen = Math.min(segA.length, segB.length);
      for (let i = 0; i < minLen; i++) {
        if (segA[i] !== segB[i]) {
          return this.collator.compare(segA[i], segB[i]);
        }
      }
      return segA.length - segB.length;
    });

    return images;
  }

  // ۲. استخراج لیست فصل‌ها از روی تصاویر اسکن‌شده: [{ name, startPage, endPage }]
  // فصل = نام پوشه سطح‌اول؛ پوشه تخت (بدون زیرپوشه) = تک‌فصل با نام خود پوشه
  extractChapters(images, fallbackName = '') {
    const chapters = [];
    let current = null;
    for (let idx = 0; idx < images.length; idx++) {
      const rel = (images[idx].relativePath || '').replace(/\\/g, '/');
      const segs = rel.split('/').filter(Boolean);
      const name = segs.length > 1 ? segs[0] : (fallbackName || '');
      if (!current || current.name !== name) {
        current = { name, startPage: idx, endPage: idx };
        chapters.push(current);
      } else {
        current.endPage = idx;
      }
    }
    return chapters;
  }

  // ۳. بررسی اینکه آیا یک پوشه مستقیماً کمیک (حاوی عکس) است یا خیر
  hasImagesRecursively(folderPath) {
    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && IMAGE_REGEX.test(e.name)) return true;
        if (e.isDirectory()) {
          const sub = path.join(folderPath, e.name);
          if (this.hasImagesRecursively(sub)) return true;
        }
      }
    } catch (_) {}
    return false;
  }

  // ۴. اسکن و ناوبری بین پوشه‌ها یا فایل‌های کمیک همسایه
  scanAndSortDirectory(targetPath, sortBy = 'name_asc') {
    try {
      if (!targetPath) return this._getEmptyResult();

      const normalized = path.normalize(targetPath);

      // پوشه والد اسکن می‌شود تا آیتم‌های همسایه (فصل/کمیک بعدی و قبلی) پیدا شوند
      const dirPath = path.dirname(normalized);
      const currentItemName = path.basename(normalized);
      const currentLower = currentItemName.toLowerCase().trim();

      const allEntries = fs.readdirSync(dirPath, { withFileTypes: true });

      let list = allEntries
        .filter((entry) => {
          if (entry.isFile()) {
            return this.supportedArchiveExtensions.has(path.extname(entry.name).toLowerCase());
          }
          if (entry.isDirectory()) {
            // آیا پوشه همسایه یک پوشه کمیک شامل عکس است؟
            const fullSubPath = path.join(dirPath, entry.name);
            return this.hasImagesRecursively(fullSubPath);
          }
          return false;
        })
        .map((entry) => {
          const fullPath = path.join(dirPath, entry.name);
          let stat = { mtimeMs: 0, size: 0 };
          try {
            stat = fs.statSync(fullPath);
          } catch (e) {}
          return {
            name: entry.name,
            path: fullPath,
            isDir: entry.isDirectory(),
            sizeBytes: stat.size,
            size: formatBytes(stat.size),
            mtime: stat.mtimeMs
          };
        });

      switch (sortBy) {
        case 'name_desc':
          list.sort((a, b) => this.collator.compare(b.name, a.name));
          break;
        case 'date_desc':
          list.sort((a, b) => b.mtime - a.mtime);
          break;
        case 'date_asc':
          list.sort((a, b) => a.mtime - b.mtime);
          break;
        case 'size_desc':
          list.sort((a, b) => b.sizeBytes - a.sizeBytes);
          break;
        case 'size_asc':
          list.sort((a, b) => a.sizeBytes - b.sizeBytes);
          break;
        case 'name_asc':
        default:
          list.sort((a, b) => this.collator.compare(a.name, b.name));
          break;
      }

      const currentIndex = list.findIndex((f) => f.name.toLowerCase().trim() === currentLower);

      return {
        dirName: path.basename(dirPath),
        dirPath: dirPath,
        totalInDir: list.length,
        currentIndex: currentIndex >= 0 ? currentIndex + 1 : 1,
        prevComic: currentIndex > 0 ? list[currentIndex - 1] : null,
        nextComic: currentIndex >= 0 && currentIndex < list.length - 1 ? list[currentIndex + 1] : null,
        sortBy: sortBy
      };
    } catch (error) {
      console.error('DirectoryService Scan Error:', error);
      return this._getEmptyResult();
    }
  }

  // ۵. مرحلهٔ ۳۹ §۱: اسکنِ فایل‌هایِ قابلِ مطالعهٔ داخلِ یک پوشه
  // (ریشه + یک سطح زیرپوشه): PDF، EPUB، آرشیو (CBZ/ZIP/CBR/RAR) و
  // پوشه‌هایِ دارایِ عکس. مرتب‌سازی با همان ترتیبِ طبیعیِ فارسی که
  // پنلِ راست نمایش می‌دهد (Intl.Collator('fa')).
  scanFolderForReadableFiles(folderPath) {
    const out = [];
    try {
      if (!folderPath || typeof folderPath !== 'string') return out;
      const collatorFa = new Intl.Collator('fa', { numeric: true, sensitivity: 'base' });
      const kindOf = (entryName) => {
        const ext = path.extname(entryName).toLowerCase();
        if (ext === '.pdf') return 'pdf';
        if (ext === '.epub') return 'epub';
        if (ext === '.cbz' || ext === '.zip' || ext === '.cbr' || ext === '.rar') return 'archive';
        return null;
      };
      const collect = (dir, prefix) => {
        let entries = [];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_) {
          return;
        }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!prefix && this.hasImagesRecursively(fullPath)) {
              let stat = { mtimeMs: 0, size: 0 };
              try { stat = fs.statSync(fullPath); } catch (_) {}
              out.push({
                name: entry.name,
                path: fullPath,
                isDir: true,
                kind: 'folder',
                sizeBytes: stat.size,
                size: formatBytes(stat.size),
                mtime: stat.mtimeMs,
              });
            }
            if (!prefix) collect(fullPath, entry.name);
          } else if (entry.isFile()) {
            const kind = kindOf(entry.name);
            if (!kind) continue;
            let stat = { mtimeMs: 0, size: 0 };
            try { stat = fs.statSync(fullPath); } catch (_) {}
            out.push({
              name: prefix ? `${prefix} / ${entry.name}` : entry.name,
              path: fullPath,
              isDir: false,
              kind,
              sizeBytes: stat.size,
              size: formatBytes(stat.size),
              mtime: stat.mtimeMs,
            });
          }
        }
      };
      collect(folderPath, '');
      out.sort((a, b) => collatorFa.compare(a.name, b.name));
      return out;
    } catch (err) {
      console.error('DirectoryService Readable Files Scan Error:', err);
      return out;
    }
  }

  _getEmptyResult() {
    return {
      dirName: '',
      dirPath: '',
      totalInDir: 0,
      currentIndex: 0,
      prevComic: null,
      nextComic: null,
      sortBy: 'name_asc'
    };
  }
}

module.exports = new DirectoryService();