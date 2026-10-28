import { useEffect, useRef } from 'react';
import useAppStore from '../store/useAppStore';
import useReaderStore from '../store/useReaderStore';
import useLibraryStore from '../store/useLibraryStore';
import useSettingsStore from '../store/useSettingsStore';
import { coreApi } from '../services/coreApi';

// مرحله ۷ ـ بخش الف: نگاشتِ ابزار ← اکشنِ تنظیمات. این جدول، فقط
// «کدام اکشن، کدام ابزار است» را می‌گوید؛ خودِ کلیدها، فقط از
// matchesShortcut در useSettingsStore خوانده می‌شوند (مرجعِ واحد).
// پیش از این، این‌جا نگاشتِ هاردکدشدهٔ v/b/h/p/a/t/n/e بود که
// بدونِ خواندنِ تنظیمات، ابزار را عوض می‌کرد؛ به همین دلیل، تغییرِ
// میانبرِ ابزار در تنظیمات، کلیدِ قبلی را از کار نمی‌انداخت.
const STUDIO_TOOL_ACTIONS = [
  { actionId: 'toolSelect', toolId: 'select' },
  { actionId: 'toolPen', toolId: 'pen' },
  { actionId: 'toolBox', toolId: 'box' },
  { actionId: 'toolArrow', toolId: 'arrow' },
  { actionId: 'toolText', toolId: 'text' },
  { actionId: 'toolSticky', toolId: 'sticky' },
  { actionId: 'toolHighlighter', toolId: 'highlighter' },
  { actionId: 'toolEraser', toolId: 'eraser' },
];

function resolveStudioToolId(settingsState, e) {
  for (const { actionId, toolId } of STUDIO_TOOL_ACTIONS) {
    if (settingsState.matchesShortcut?.(actionId, e)) return toolId;
  }
  return null;
}

export default function useKeyboard(callbacks = {}) {
  const isCopyingRef = useRef(false);
  const callbacksRef = useRef(callbacks);

  // به‌روزرسانی رفرنس کال‌بک‌ها بدون نیاز به ثبت مجدد شنونده پنجره
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    const handleKeyDown = async (e) => {
      // ۰. توقف کامل در صورت ضبط شورت‌کات در تنظیمات
      if (window.__isRecordingShortcut) return;

      const appState = useAppStore.getState();
      const readerState = useReaderStore.getState();
      const libraryState = useLibraryStore.getState();
      const settingsState = useSettingsStore.getState();

      const { comicData, currentPage } = readerState;
      const target = e.target;

      // تشخیص فوکوس در کادرهای متنی، سرچ‌بار و ادیتور یادداشت‌های صفحه
      const isInputFocused = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable ||
            target.closest?.('input, textarea, select, [contenteditable="true"]'))
      );

      // ۱. رفتار کلید Escape هنگام حضور در اینپوت
      if (isInputFocused) {
        if (e.key === 'Escape' || e.code === 'Escape') {
          e.preventDefault();
          target.blur?.();
          appState.setIsSearchFocused(false);
        }
        return;
      }

      // ۲. سلسله‌مراتب اولویت‌بندی شده کلید Escape
      if (e.key === 'Escape' || e.code === 'Escape') {
        // مرحله ۴ ـ بخش ب: نوارِ جستجوی PDF، لایهٔ روئیِ گذراست. اگر
        // باز است و فوکوس از اینپوتش بیرون آمده (مثلاً کاربر دکمهٔ
        // بعدی/قبلی را زده یا روی صفحه کلیک کرده)، Escape اول نوار
        // را می‌بندد، نه کمیک را. شنوندهٔ PdfViewer به‌خاطرِ
        // capture:true بودنِ این شنونده و زودتر ثبت شدنش نمی‌تواند
        // جلوی این شاخه را بگیرد؛ هماهنگی از راهِ استورِ ریدر است.
        if (
          appState.currentView === 'reader' &&
          readerState.comicData?.type === 'pdf' &&
          readerState.pdfSearchOpen
        ) {
          e.preventDefault();
          e.stopPropagation();
          readerState.setPdfSearchOpen(false);
          return;
        }
        if (appState.isAreaZoomActive) {
          e.preventDefault();
          e.stopPropagation();
          appState.setIsAreaZoomActive(false);
          return;
        }
        if (appState.isSnippingActive) {
          e.preventDefault();
          e.stopPropagation();
          appState.setIsSnippingActive(false);
          return;
        }
        if (appState.isAnnotationActive) {
          e.preventDefault();
          e.stopPropagation();
          // اگر شکلی انتخاب شده است، ابتدا آن را از حالت انتخاب خارج کن
          if (appState.selectedAnnotationId) {
            appState.setSelectedAnnotation(null, null);
            return;
          }
          appState.setIsAnnotationActive(false);
          appState.showToast('استودیو ویرایش بسته شد', { type: 'info' });
          return;
        }
        if (appState.isScreenshotModalOpen) {
          e.preventDefault();
          e.stopPropagation();
          appState.closeScreenshotModal();
          return;
        }
        if (appState.isQuickSettingsOpen) {
          e.preventDefault();
          e.stopPropagation();
          appState.closeQuickSettings();
          return;
        }
        if (appState.isContextMenuOpen) {
          e.preventDefault();
          e.stopPropagation();
          appState.closeContextMenu();
          return;
        }
        // اگر زوم باکسی فعال بوده است، ابتدا به زوم قبلی برگرد
        if (comicData && readerState.preAreaZoomLevel !== null) {
          e.preventDefault();
          e.stopPropagation();
          readerState.restorePreAreaZoom();
          appState.showToast('بازگشت به بزرگ‌نمایی قبلی انجام شد', { type: 'info' });
          return;
        }
        // اگر کمیک باز است اما در ویوی دیگری هستیم، بازگشت به ریدر
        if (comicData && appState.currentView !== 'reader' && appState.currentView !== 'home') {
          e.preventDefault();
          appState.returnToReader();
          return;
        }
        // بستن کامل کمیک جاری به همراه ذخیره پیشرفت معلق و پاک‌سازی کش دیسک
        if (comicData) {
          e.preventDefault();
          appState.resetSidebars();
          window.dispatchEvent(new CustomEvent('app:close-comic'));
          return;
        }
        return;
      }

      // =========================================================================
      // مدیریت اختصاصی کلیدهای استودیو ویرایش (فقط زمانی که از TopBar روشن شده باشد)
      // =========================================================================
      // Refinement Final: اولویتِ مطلقِ کلیدهای ابزار وقتی استودیو
      // روشن است. قبلاً این شاخه به comicData هم وابسته بود؛ حالا فقط
      // isAnnotationActive گیت است تا هیچ بخشِ بعدی (ناوبریِ فصل‌ها
      // یا Type-to-Search) نتواند کلیدِ ابزار را برباید. در جریانِ
      // عادی، وقتی استودیو روشن است comicData هم هست (و با عوض شدنِ
      // نما، isAnnotationActive خاموش می‌شود)، پس این تغییر فقط حالتِ
      // مرزی را می‌بندد، نه رفتارِ عادی را.
      if (appState.isAnnotationActive) {
        const lowerKey = (e.key || '').toLowerCase();

        // واگذاری Undo / Redo به تولبار/ویوور: فقط وقتی رویداد،
        // دقیقاً با میانبرِ فعلیِ undo/redo در تنظیمات جور است.
        // پیش از این، هر Ctrl+Z/Y (حتی پس از تغییرِ میانبر) به
        // این‌جا می‌رسید و کلیدِ قبلی، زنده می‌ماند.
        if (
          settingsState.matchesShortcut?.('undoAnnotation', e) ||
          settingsState.matchesShortcut?.('redoAnnotation', e)
        ) {
          return;
        }

        // اگر شکلی انتخاب شده است، اجازه بده Ctrl+D (تکثیر)، Delete و کلیدهای جهتی در AnnotationLayer اجرا شوند
        if (appState.selectedAnnotationId) {
          if (
            e.key === 'Delete' ||
            e.key === 'Backspace' ||
            ((e.ctrlKey || e.metaKey) && lowerKey === 'd') ||
            ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
          ) {
            return;
          }
        }

        // سوییچ سریع بین ابزارهای داخل استودیو — فقط از مرجعِ واحد
        // (matchesShortcut). گیتِ modifier، خودِ matcher است؛ پس
        // اگر کاربر، ابزار را به ترکیبی (مثلِ Alt+P) ببندد، همان
        // ترکیب کار می‌کند و کلیدِ سادهٔ قبلی، دیگر ابزار را عوض
        // نمی‌کند.
        const studioToolId = resolveStudioToolId(settingsState, e);
        if (studioToolId) {
          e.preventDefault();
          e.stopPropagation();
          appState.setAnnotationTool(studioToolId);
          return;
        }
      }

      // =========================================================================
      // بخش الف: شورت‌کات‌های دستوری با کلیدهای ترکیبی (Ctrl / Alt / F-Keys)
      // =========================================================================

      // ۳. تمام‌صفحه (پیش‌فرض: F11)
      if (settingsState.matchesShortcut?.('fullscreen', e)) {
        e.preventDefault();
        e.stopPropagation();
        coreApi.toggleFullscreen();
        return;
      }

      // ۴. باز کردن فایل کمیک (پیش‌فرض: Ctrl + O)
      if (settingsState.matchesShortcut?.('openFile', e)) {
        if (e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        if (callbacksRef.current?.onOpenFile) {
          callbacksRef.current.onOpenFile();
        } else {
          const res = await coreApi.openFile();
          if (res?.success && res.filePath) {
            window.dispatchEvent(
              new CustomEvent('app:navigate-comic', { detail: res.filePath })
            );
          }
        }
        return;
      }

      // ۵. باز کردن پوشه مانهوا (پیش‌فرض: Ctrl + Shift + O)
      if (settingsState.matchesShortcut?.('openFolder', e)) {
        if (e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        if (callbacksRef.current?.onOpenFolder) {
          callbacksRef.current.onOpenFolder();
        } else {
          const res = await coreApi.openFolder();
          if (res?.success && res.filePath) {
            window.dispatchEvent(
              new CustomEvent('app:navigate-comic', { detail: res.filePath })
            );
          }
        }
        return;
      }

      // ۶. فوکوس صریح روی نوار جستجو با کلید میانبر (پیش‌فرض: Ctrl + F)
      if (settingsState.matchesShortcut?.('focusSearch', e)) {
        // مرحله ۴ — در ریدرِ PDF، Ctrl+F به جستجوی درون‌متنیِ PdfViewer
        // واگذار می‌شود: بدونِ preventDefault و stopPropagation برمی‌گردیم
        // تا شنوندهٔ PdfViewer (که دیرتر و در فازِ حباب ثبت شده) آن را
        // بگیرد. در ریدرِ کمیکِ تصویری و همهٔ نماهای دیگر، رفتارِ قبلی
        // (فوکوسِ جستجوی TopBar) دقیقاً حفظ می‌شود؛ جستجوی TopBar در
        // ریدرِ PDF همچنان با کلیک در دسترس است.
        if (
          appState.currentView === 'reader' &&
          readerState.comicData?.type === 'pdf'
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const searchInput = document.getElementById('global-topbar-search-input');
        if (searchInput) {
          appState.setIsSearchFocused(true);
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // ۷. باز کردن تنظیمات پیشرفته (پیش‌فرض: Ctrl + ,)
      if (settingsState.matchesShortcut?.('openSettings', e)) {
        e.preventDefault();
        e.stopPropagation();
        appState.setCurrentView('settings');
        return;
      }

      // ۸. کپی تصویر صفحه جاری در کلیپ‌بورد (پیش‌فرض: Ctrl + C)
      if (comicData && settingsState.matchesShortcut?.('copyPage', e)) {
        if (e.repeat || isCopyingRef.current) return;
        e.preventDefault();
        e.stopPropagation();

        isCopyingRef.current = true;
        try {
          const items = comicData.items || [];
          const safeIndex = Math.max(
            0,
            Math.min(currentPage - 1, Math.max(0, items.length - 1))
          );
          const currentItem = items[safeIndex];

          let copyRes = { success: false };

          if (
            currentItem?.path &&
            !currentItem.isPdf &&
            !currentItem.path.includes('#page=')
          ) {
            copyRes = await coreApi.copyImageToClipboard({
              filePath: currentItem.path,
            });
          }

          if (!copyRes?.success) {
            const pageEl =
              document.getElementById(`comic-page-${currentPage}`) ||
              document.querySelector(`.comic-page-item[data-index="${safeIndex}"]`);
            const imgEl =
              pageEl?.querySelector('img') ||
              document.querySelector('.comic-page-item img');

            if (imgEl) {
              if (imgEl.src?.startsWith('data:image/')) {
                copyRes = await coreApi.copyImageToClipboard({ dataUrl: imgEl.src });
              } else if (imgEl.naturalWidth > 0) {
                const canvas = document.createElement('canvas');
                canvas.width = imgEl.naturalWidth;
                canvas.height = imgEl.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(imgEl, 0, 0);
                const dataUrl = canvas.toDataURL('image/png', 1.0);
                canvas.width = 0;
                canvas.height = 0;
                copyRes = await coreApi.copyImageToClipboard({ dataUrl });
              }
            }
          }

          if (copyRes?.success) {
            appState.showToast(
              `تصویر صفحه ${currentPage} در کلیپ‌بورد ذخیره شد`,
              { type: 'success' }
            );
          } else {
            appState.showToast('خطا در کپی تصویر صفحه', { type: 'error' });
          }
        } catch (err) {
          console.error('Keyboard copy error:', err);
          appState.showToast('خطا در کپی تصویر صفحه', { type: 'error' });
        } finally {
          setTimeout(() => {
            isCopyingRef.current = false;
          }, 300);
        }
        return;
      }

      // ۹. ابزار برش اسکرین‌شات (پیش‌فرض: Ctrl + Shift + S)
      if (comicData && settingsState.matchesShortcut?.('quickSnip', e)) {
        e.preventDefault();
        e.stopPropagation();
        appState.closeScreenshotModal();
        appState.setIsSnippingActive(!appState.isSnippingActive);
        return;
      }

      // ۱۰. میانبر زوم ناحیه‌ای با کشیدن باکس (Alt + Z)
      if (comicData && settingsState.matchesShortcut?.('areaZoom', e)) {
        e.preventDefault();
        e.stopPropagation();
        const activeNow = appState.toggleAreaZoom?.();
        if (activeNow) {
          appState.showToast('ناحیه مورد نظر را با ماوس کادر بکشید تا زوم شود', {
            type: 'info',
          });
        }
        return;
      }

      // ۱۱. افزودن به علاقه‌مندی‌ها (پیش‌فرض: Ctrl + D)
      if (comicData && settingsState.matchesShortcut?.('toggleFavorite', e)) {
        if (e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        const isNowFav = libraryState.toggleFavorite({
          path: comicData.filePath,
          name: comicData.fileName,
          fileSize: comicData.fileSize,
          totalPages: comicData.items?.length || comicData.savedTotalPages || 1,
          lastPage: currentPage,
        });
        appState.showToast(
          isNowFav
            ? 'به لیست علاقه‌مندی‌ها اضافه شد'
            : 'از لیست علاقه‌مندی‌ها حذف شد',
          { type: isNowFav ? 'success' : 'info' }
        );
        return;
      }

      // ۱۲. کنترل‌های بزرگ‌نمایی و کوچک‌نمایی با کیبورد (Ctrl + Plus, Ctrl + Minus, Ctrl + 0)
      // مرحله ۷ ـ بخش الف: زوم، فقط از مرجعِ واحد. پیش از این، هر
      // سه چک، هاردکدشده بودند و تغییرِ میانبرِ زوم در تنظیمات،
      // هیچ اثری نداشت. تحملِ Shift برای '+' روی چیدمانِ QWERTY،
      // در خودِ matchesShortcut (پرچمِ ignoreShift) حل شده است.
      const isZoomInTriggered = settingsState.matchesShortcut?.('zoomIn', e);
      const isZoomOutTriggered = settingsState.matchesShortcut?.('zoomOut', e);
      const isResetZoomTriggered = settingsState.matchesShortcut?.('resetZoom', e);

      if (isZoomInTriggered) {
        e.preventDefault();
        e.stopPropagation();
        readerState.zoomIn();
        return;
      }

      if (isZoomOutTriggered) {
        e.preventDefault();
        e.stopPropagation();
        readerState.zoomOut();
        return;
      }

      if (isResetZoomTriggered) {
        e.preventDefault();
        e.stopPropagation();
        readerState.resetZoom();
        return;
      }

      // =========================================================================
      // بخش ب: شورت‌کات‌های ناوبری چپترها و کنترل‌های محیط مطالعه
      // =========================================================================

      // ۱۳. چرخش ۹۰ درجه صفحه (Alt + R یا شورت‌کات سفارشی)
      if (comicData && settingsState.matchesShortcut?.('rotatePage', e)) {
        e.preventDefault();
        e.stopPropagation();
        readerState.rotateClockwise();
        return;
      }

      // ۱۴. حالت تمرکز و زن‌مود (Alt + F یا کلید اختصاصی)
      if (comicData && settingsState.matchesShortcut?.('zenMode', e)) {
        e.preventDefault();
        e.stopPropagation();
        appState.toggleZenMode();
        return;
      }

      // ۱۵. داک اسکرین‌شات (Alt + S یا کلید اختصاصی)
      if (comicData && settingsState.matchesShortcut?.('screenshotWidget', e)) {
        e.preventDefault();
        e.stopPropagation();
        if (appState.isScreenshotModalOpen) {
          appState.closeScreenshotModal();
        } else {
          appState.openScreenshotModal({ pageIndex: currentPage - 1 });
        }
        return;
      }

      // ۱۶. فصل یا فایل بعدی در پوشه (PageDown یا شورت‌کات اختصاصی)
      if (comicData && settingsState.matchesShortcut?.('nextChapter', e)) {
        const nextComic = comicData.nextComic;
        if (nextComic?.path) {
          e.preventDefault();
          e.stopPropagation();
          if (callbacksRef.current?.onOpenComic) {
            callbacksRef.current.onOpenComic(nextComic.path);
          } else {
            window.dispatchEvent(
              new CustomEvent('app:navigate-comic', { detail: nextComic.path })
            );
          }
        } else {
          appState.showToast('فصل بعدی در این پوشه یافت نشد', { type: 'info' });
        }
        return;
      }

      // ۱۷. فصل یا فایل قبلی در پوشه (PageUp یا شورت‌کات اختصاصی)
      if (comicData && settingsState.matchesShortcut?.('prevChapter', e)) {
        // Refinement Final: کلیدِ سادهٔ A (prevChapter) وقتی استودیو
        // روشن است، هرگز فصلِ قبلی را باز نمی‌کند — چون A ابزارِ فلش
        // است و شاخهٔ ابزار (بالا) وقتی comicData باشد آن را گرفته
        // است؛ این گیت، حالتِ مرزیِ بدونِ comicData و هر مسیرِ دیگری
        // را هم می‌بندد. PageUp در حالتِ استودیو همچنان فصلِ قبلی را
        // می‌آورد (فقط KeyA گیت شده است، طبقِ TASK).
        const isPlainA =
          (e.code === 'KeyA' || (e.key || '').toLowerCase() === 'a') &&
          !e.ctrlKey && !e.altKey && !e.metaKey;
        if (!(appState.isAnnotationActive && isPlainA)) {
        const prevComic = comicData.prevComic;
        if (prevComic?.path) {
          e.preventDefault();
          e.stopPropagation();
          if (callbacksRef.current?.onOpenComic) {
            callbacksRef.current.onOpenComic(prevComic.path);
          } else {
            window.dispatchEvent(
              new CustomEvent('app:navigate-comic', { detail: prevComic.path })
            );
          }
        } else {
          appState.showToast('این اولین فایل در پوشه جاری است', { type: 'info' });
        }
        return;
        } // پایانِ گیتِ KeyA (Refinement Final)
      }

      // =========================================================================
      // بخش ج: معماری مدرن Type-to-Search (غیرفعال در زمان باز بودن استودیو ویرایش یا زوم باکسی)
      // =========================================================================
      const isControlOrNavKey =
        e.key.length > 1 ||
        e.ctrlKey ||
        e.altKey ||
        e.metaKey ||
        e.key === ' ' ||
        e.isComposing;

      // Refinement Final: کلیدهای ابزارِ حاشیه‌نویسی، حتی در صورتِ
      // ابهام، هرگز به اینپوتِ جستجو تزریق نمی‌شوند. قبلاً این بخش
      // فقط با !isAnnotationActive گیت شده بود؛ حالا صراحتاً چک
      // می‌شود که کلید، با میانبرِ فعلیِ یک ابزار در تنظیمات جور باشد. با این گیت،
      // وقتی استودیو خاموش است، فشردنِ V/P/B/A/T/N/H/E به‌جای
      // اینکه حرف را در جستجو بنویسد، هیچ‌کاری نمی‌کند (باز کردنِ
      // استودیو با میانبر، در این گام خواسته نشده است و همچنان با
      // دکمهٔ TopBar انجام می‌شود).
      // مرحله ۷ ـ بخش الف: کلیدِ ابزارِ فعلیِ تنظیمات، هرگز به
      // جستجو تزریق نمی‌شود — حتی اگر کاربر، آن را به کلیدِ دیگری
      // بسته باشد. پیش از این، فقط حروفِ هاردکدشدهٔ قدیمی مستثنا
      // بودند و کلیدِ جدیدِ ابزار، به جستجو می‌رفت.
      const isStudioToolKey = resolveStudioToolId(settingsState, e) !== null;
      if (
        !isInputFocused &&
        !isControlOrNavKey &&
        !appState.isAnnotationActive &&
        !appState.isAreaZoomActive &&
        !isStudioToolKey
      ) {
        e.preventDefault();
        e.stopPropagation();

        const searchInput = document.getElementById('global-topbar-search-input');
        if (searchInput) {
          appState.setIsSearchFocused(true);
          appState.setSearchQuery(e.key);

          requestAnimationFrame(() => {
            searchInput.focus();
            const len = e.key.length;
            try {
              searchInput.setSelectionRange(len, len);
            } catch (_) {}
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);
}