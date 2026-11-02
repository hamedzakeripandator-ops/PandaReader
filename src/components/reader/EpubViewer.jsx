// ============================================================================
// src/components/reader/EpubViewer.jsx — مرحلهٔ ۳۵ §۲
//
// خوانندهٔ کاملِ EPUB: هر فصل روی یک برگهٔ کاغذِ هم‌تم با برنامه، با
// تنظیمِ اندازهٔ فونت، فونتِ فارسی، فاصلهٔ خطوط و تمِ کاغذ؛ هایلایتِ
// مستقیمِ متن (۵ رنگ + یادداشت + کپی)؛ لایهٔ حاشیه‌نویسی و
// بوک‌مارک‌هایِ حاشیه‌ای، دقیقاً با همان plumbingای PdfViewer.
//
// ایزوله‌سازی: HTML فصل در پروسسِ اصلی پاک‌سازی شده است و اینجا هم
// پیش از رندر، یک‌بارِ دیگر با DOMParser پاک می‌شود؛ استایلِ ناشر
// هرگز به document اصلی نمی‌رسد و تایپوگرافی، فقط از همین فایل می‌آید.
// ============================================================================

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import useReaderStore from '../../store/useReaderStore';
import useAppStore from '../../store/useAppStore';
import useLibraryStore from '../../store/useLibraryStore';
import useBookmarkStore, { normalizeBookKey } from '../../store/useBookmarkStore';
import Icons from '../common/Icons';
import { coreApi } from '../../services/coreApi';
import { readingActivity } from '../../services/readingActivity';
import annotationLocalBackup from '../../services/annotationLocalBackup';
import AnnotationLayer from './AnnotationLayer';
import AnnotationToolbar from './AnnotationToolbar';
import BookmarkMarker from './BookmarkMarker';
import { resolveBookmarkImage, clampYRatio } from './bookmarkTemplates';

const HL_COLORS = [
  { id: 'yellow', label: 'زرد', bg: '#facc15' },
  { id: 'green', label: 'سبز', bg: '#4ade80' },
  { id: 'cyan', label: 'فیروزه‌ای', bg: '#22d3ee' },
  { id: 'pink', label: 'صورتی', bg: '#f472b6' },
  { id: 'purple', label: 'بنفش', bg: '#c084fc' },
];

const THEMES = {
  light: { name: 'روشن', paper: '#ffffff', text: '#111827', muted: '#6b7280' },
  sepia: { name: 'سپیا', paper: '#f5eeda', text: '#3a2f1d', muted: '#7a6a4d' },
  dark: { name: 'تاریک', paper: '#0d131a', text: '#e5e7eb', muted: '#9ca3af' },
};

const FONT_OPTIONS = [
  { id: 'estedad', label: 'استعداد', family: "'Estedad', sans-serif" },
  { id: 'serif', label: 'سریف', family: "Georgia, 'Times New Roman', serif" },
  { id: 'sans', label: 'سنس', family: "Tahoma, 'Segoe UI', sans-serif" },
];

const LINE_HEIGHTS = [1.6, 1.9, 2.2];

function readLs(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function writeLs(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

// پاک‌سازیِ دفاعیِ سمتِ رندرر (پروسسِ اصلی هم پاک کرده است): حذفِ
// script/style/link/iframe/object/embed/form و رویدادهایِ on* و
// hrefهایِ javascript: پیش از dangerouslySetInnerHTML.
function sanitizeEpubHtmlClient(html) {
  try {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
    doc.querySelectorAll('script, style, link, iframe, object, embed, form, meta, base, title').forEach((el) => el.remove());
    doc.querySelectorAll('*').forEach((el) => {
      for (const attr of Array.from(el.attributes || [])) {
        if (/^on/i.test(attr.name) || /^(javascript|vbscript|data:text\/html)/i.test(attr.value.trim())) {
          el.removeAttribute(attr.name);
        }
      }
    });
    const div = doc.querySelector('div');
    return div ? div.innerHTML : html;
  } catch (_) {
    return html;
  }
}

// مرحلهٔ ۳۶ §۵: پیمایشِ کران‌دار — برایِ هر هایلایت، فقط تا انتهایِ
// همان بازه پیموده می‌شود (نه کلِ فصل) و سقفِ ۲۰۰۰۰ گرهٔ متنی،
// فصل‌هایِ بسیار بلند را از قفلِ تردِ اصلی نجات می‌دهد.
const MAX_HIGHLIGHT_TEXT_NODES = 20000;
function collectTextNodes(root, stopAfterChars) {
  const nodes = [];
  let total = 0;
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      nodes.push(n);
      total += n.textContent.length;
      if (nodes.length >= MAX_HIGHLIGHT_TEXT_NODES) break;
      if (typeof stopAfterChars === 'number' && total > stopAfterChars) break;
    }
  } catch (_) {}
  return nodes;
}

function unwrapMarks(root) {
  const marks = root.querySelectorAll('mark[data-hl-id]');
  marks.forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  try { root.normalize(); } catch (_) {}
}

// اعمالِ یک هایلایت روی DOM فصل: بازهٔ کاراکتری به گره‌هایِ متنی
// نگاشت می‌شود؛ خواندن‌ها (split) و نوشتن‌ها (ساختِ mark در
// DocumentFragment و جایگزینیِ معکوس) از هم جدا شده‌اند تا چیدمان،
// میانِ هر جایگزینی بازمحاسبه نشود.
function applyHighlightToEl(root, hl) {
  const nodes = collectTextNodes(root, hl.endOffset);
  let acc = 0;
  const ranges = [];
  for (const node of nodes) {
    const len = node.textContent.length;
    const start = acc;
    const end = acc + len;
    if (end > hl.startOffset && start < hl.endOffset) {
      ranges.push({ node, s: Math.max(0, hl.startOffset - start), e: Math.min(len, hl.endOffset - start) });
    }
    acc = end;
  }
  if (ranges.length === 0) return;
  const targets = [];
  for (let i = ranges.length - 1; i >= 0; i--) {
    const { node, s, e } = ranges[i];
    let target = node;
    if (e < node.textContent.length) node.splitText(e);
    if (s > 0) target = node.splitText(s);
    targets.push(target);
  }
  const fragment = document.createDocumentFragment();
  const marks = targets.map((target) => {
    const mark = document.createElement('mark');
    mark.setAttribute('data-hl-id', hl.id);
    mark.style.backgroundColor = hl.color;
    mark.style.color = 'inherit';
    mark.style.borderRadius = '3px';
    mark.style.padding = '0 1px';
    mark.style.cursor = 'pointer';
    fragment.appendChild(mark);
    return mark;
  });
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const mark = marks[i];
    if (target.parentNode) {
      target.parentNode.replaceChild(mark, target);
      mark.appendChild(target);
    }
  }
}

export default function EpubViewer({ filePath }) {
  const setCurrentPage = useReaderStore((state) => state.setCurrentPage);
  const setEpubChapters = useReaderStore((state) => state.setEpubChapters);
  const isAnnotationActive = useAppStore((state) => Boolean(state.isAnnotationActive));
  const showToast = useAppStore((state) => state.showToast);
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const updateReadingProgress = useLibraryStore((state) => state.updateReadingProgress);

  const [book, setBook] = useState(null);
  const [bookLoading, setBookLoading] = useState(true);
  const [bookError, setBookError] = useState('');
  const [chapterIndex, setChapterIndex] = useState(0);
  const [chapterHtml, setChapterHtml] = useState('');
  const [chapterLoading, setChapterLoading] = useState(false);

  const [fontSize, setFontSize] = useState(() => {
    const v = readLs('comicReader.epubFontSize.v1', 18);
    return typeof v === 'number' && v >= 14 && v <= 28 ? v : 18;
  });
  const [fontId, setFontId] = useState(() => readLs('comicReader.epubFont.v1', 'estedad'));
  const [lineHeight, setLineHeight] = useState(() => {
    const v = readLs('comicReader.epubLineHeight.v1', 1.9);
    return LINE_HEIGHTS.includes(v) ? v : 1.9;
  });
  const [themeId, setThemeId] = useState(() => readLs('comicReader.epubTheme.v1', 'light'));
  const [tocOpen, setTocOpen] = useState(false);

  const [highlights, setHighlights] = useState([]);
  const [selMenu, setSelMenu] = useState(null);
  const [markMenu, setMarkMenu] = useState(null);
  const [annotationsByPage, setAnnotationsByPage] = useState({});

  const contentRef = useRef(null);
  const chapterElRef = useRef(null);
  const pendingBookmarkScrollRef = useRef(null);

  const chapters = useMemo(() => (book && Array.isArray(book.chapters) ? book.chapters : []), [book]);
  const theme = THEMES[themeId] || THEMES.light;
  const fontFamily = (FONT_OPTIONS.find((f) => f.id === fontId) || FONT_OPTIONS[0]).family;

  const pageBookmarkList = useBookmarkStore((state) => state.bookmarksByFile[normalizeBookKey(filePath)] || []);
  const bookmarkPreferences = useBookmarkStore((state) => state.preferences);
  const loadBookmarksForFile = useBookmarkStore((state) => state.loadBookmarksForFile);
  const loadBookmarkPreferences = useBookmarkStore((state) => state.loadPreferences);
  const addBookmark = useBookmarkStore((state) => state.addBookmark);
  const updateBookmark = useBookmarkStore((state) => state.updateBookmark);
  const deleteBookmark = useBookmarkStore((state) => state.deleteBookmark);

  const chapterBookmarks = useMemo(
    () => (pageBookmarkList || []).filter((bm) => Number(bm.page) === chapterIndex + 1),
    [pageBookmarkList, chapterIndex],
  );
  const currentChapterAnnotations = annotationsByPage[String(chapterIndex + 1)] || [];
  const shouldMountAnnotationLayer = isAnnotationActive || currentChapterAnnotations.length > 0;

  useEffect(() => { writeLs('comicReader.epubFontSize.v1', fontSize); }, [fontSize]);
  useEffect(() => { writeLs('comicReader.epubFont.v1', fontId); }, [fontId]);
  useEffect(() => { writeLs('comicReader.epubLineHeight.v1', lineHeight); }, [lineHeight]);
  useEffect(() => { writeLs('comicReader.epubTheme.v1', themeId); }, [themeId]);

  // بارگذاریِ کتاب + شروعِ جلسهٔ مطالعه.
  useEffect(() => {
    if (!filePath) return undefined;
    let isMounted = true;
    setBookLoading(true);
    setBookError('');
    setBook(null);
    coreApi.loadEpubBook(filePath).then((res) => {
      if (!isMounted) return;
      if (!res || !res.success) {
        setBookError((res && res.message) || 'خواندنِ فایلِ EPUB ناموفق بود.');
        setBookLoading(false);
        return;
      }
      const list = Array.isArray(res.chapters) ? res.chapters : [];
      setBook({ title: res.title || '', creator: res.creator || '', coverUrl: res.coverUrl || null, chapters: list });
      setEpubChapters(list.map((c) => ({ id: c.id, title: c.title })));
      const startPage = useReaderStore.getState().currentPage || 1;
      setChapterIndex(Math.max(0, Math.min(startPage - 1, list.length - 1)));
      setBookLoading(false);
    }).catch((err) => {
      if (!isMounted) return;
      setBookError(err?.message || 'خواندنِ فایلِ EPUB ناموفق بود.');
      setBookLoading(false);
    });
    try { readingActivity.begin(filePath); } catch (_) {}
    coreApi.getEpubHighlights(filePath).then((list) => {
      if (isMounted && Array.isArray(list)) setHighlights(list);
    }).catch(() => {});
    return () => {
      isMounted = false;
      try { readingActivity.end(); } catch (_) {}
      setEpubChapters([]);
    };
  }, [filePath, setEpubChapters]);

  // بارگذاریِ فصل + همگام‌سازی با استور و آمار (باگِ ۴ پرامپت).
  useEffect(() => {
    if (!book || chapters.length === 0) return undefined;
    const chapter = chapters[chapterIndex];
    if (!chapter) return undefined;
    let isMounted = true;
    setChapterLoading(true);
    setSelMenu(null);
    setMarkMenu(null);
    coreApi.loadEpubChapter(filePath, chapter.id).then((res) => {
      if (!isMounted) return;
      if (res && res.success) {
        setChapterHtml(sanitizeEpubHtmlClient(res.html || ''));
        // پیش‌بارگذاریِ فصل‌هایِ همسایه (بی‌صدا).
        for (const nb of [chapterIndex - 1, chapterIndex + 1]) {
          const nCh = chapters[nb];
          if (nCh) coreApi.loadEpubChapter(filePath, nCh.id).catch(() => {});
        }
      } else {
        setChapterHtml('<p>بارگذاریِ این فصل ناموفق بود.</p>');
      }
      setChapterLoading(false);
    }).catch(() => {
      if (!isMounted) return;
      setChapterHtml('<p>بارگذاریِ این فصل ناموفق بود.</p>');
      setChapterLoading(false);
    });
    setCurrentPage(chapterIndex + 1);
    try { readingActivity.visitPage(chapterIndex + 1); } catch (_) {}
    try { updateReadingProgress(filePath, chapterIndex + 1, chapters.length); } catch (_) {}
    if (contentRef.current) contentRef.current.scrollTop = 0;
    return () => { isMounted = false; };
  }, [book, chapters, chapterIndex, filePath, setCurrentPage, updateReadingProgress]);

  const goToChapter = useCallback((idx, scrollRatio) => {
    if (!chapters.length) return;
    const next = Math.max(0, Math.min(idx, chapters.length - 1));
    if (typeof scrollRatio === 'number') pendingBookmarkScrollRef.current = scrollRatio;
    setChapterIndex(next);
  }, [chapters.length]);
  // پرش از پنلِ راست (فصل‌ها).
  useEffect(() => {
    const onJump = (e) => {
      const idx = Number(e?.detail?.chapterIndex);
      if (Number.isFinite(idx)) goToChapter(idx);
    };
    window.addEventListener('app:epub-jump', onJump);
    return () => window.removeEventListener('app:epub-jump', onJump);
  }, [goToChapter]);

  // حاشیه‌نویسی‌ها: همان plumbingای PdfViewer (دیتابیس + آینهٔ محلی).
  useEffect(() => {
    if (!filePath) return undefined;
    let isMounted = true;
    if (!coreApi.isAvailable()) {
      setAnnotationsByPage(annotationLocalBackup.restoreBackupsAsPages(filePath));
      return undefined;
    }
    coreApi.dbAction({ action: 'GET_ANNOTATIONS', payload: { filePath } }).then((res) => {
      if (!isMounted) return;
      const dbPages = res?.annotations && typeof res.annotations === 'object' ? res.annotations : {};
      const merged = annotationLocalBackup.mergeBackupsIntoPages(filePath, dbPages);
      setAnnotationsByPage(merged.pages);
      if (coreApi.isAvailable()) {
        merged.healed.forEach(({ pageNum, items }) => {
          coreApi.savePageAnnotations(filePath, pageNum, items).catch(() => {});
        });
      }
    }).catch(() => {});
    return () => { isMounted = false; };
  }, [filePath]);

  // بوک‌مارک‌ها (با همان تأخیرِ ۴۰۰ میلی‌ثانیه‌ایِ PdfViewer).
  useEffect(() => {
    if (!filePath) return undefined;
    const timerId = setTimeout(() => {
      loadBookmarksForFile(filePath);
      loadBookmarkPreferences();
    }, 400);
    return () => clearTimeout(timerId);
  }, [filePath, loadBookmarksForFile, loadBookmarkPreferences]);

  // اعمالِ هایلایت‌هایِ فصلِ جاری روی DOM.
  useEffect(() => {
    const el = chapterElRef.current;
    if (!el || !chapterHtml) return;
    unwrapMarks(el);
    for (const hl of highlights.filter((h) => h.chapterIndex === chapterIndex)) {
      applyHighlightToEl(el, hl);
    }
    if (pendingBookmarkScrollRef.current !== null) {
      const ratio = pendingBookmarkScrollRef.current;
      pendingBookmarkScrollRef.current = null;
      requestAnimationFrame(() => {
        const sc = contentRef.current;
        if (sc) sc.scrollTop = ratio * sc.scrollHeight;
      });
    }
  }, [chapterHtml, highlights, chapterIndex]);


  const handleCommitPageAnnotations = useCallback((pageNum, nextPageItems) => {
    const pageKey = String(pageNum);
    setAnnotationsByPage((prev) => ({ ...prev, [pageKey]: nextPageItems }));
    if (coreApi.isAvailable()) coreApi.savePageAnnotations(filePath, pageNum, nextPageItems).catch(() => {});
    annotationLocalBackup.writePageBackup(filePath, pageNum, nextPageItems);
  }, [filePath]);

  const handleClearChapterAnnotations = useCallback(() => {
    handleCommitPageAnnotations(chapterIndex + 1, []);
  }, [handleCommitPageAnnotations, chapterIndex]);

  const handleContentMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setSelMenu(null); return; }
    const range = sel.getRangeAt(0);
    const contentEl = chapterElRef.current;
    if (!contentEl || !contentEl.contains(range.commonAncestorContainer)) { setSelMenu(null); return; }
    try {
      const pre = document.createRange();
      pre.selectNodeContents(contentEl);
      pre.setEnd(range.startContainer, range.startOffset);
      const startOffset = pre.toString().length;
      const endPre = document.createRange();
      endPre.selectNodeContents(contentEl);
      endPre.setEnd(range.endContainer, range.endOffset);
      const endOffset = endPre.toString().length;
      const text = sel.toString();
      if (endOffset <= startOffset || !text.trim()) { setSelMenu(null); return; }
      const rect = range.getBoundingClientRect();
      setSelMenu({ x: rect.left + rect.width / 2, y: rect.top, startOffset, endOffset, text });
    } catch (_) {
      setSelMenu(null);
    }
  };

  const handleContentClick = (e) => {
    const mark = e.target && e.target.closest ? e.target.closest('mark[data-hl-id]') : null;
    if (!mark) return;
    const id = mark.getAttribute('data-hl-id');
    const hl = highlights.find((h) => h.id === id);
    if (!hl) return;
    setMarkMenu({ id, x: e.clientX, y: e.clientY, note: hl.note || '' });
  };

  const addHighlight = async (color) => {
    if (!selMenu) return;
    const hl = {
      id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chapterIndex,
      color,
      text: selMenu.text,
      note: '',
      startOffset: selMenu.startOffset,
      endOffset: selMenu.endOffset,
      createdAt: Date.now(),
    };
    const next = [...highlights, hl];
    setHighlights(next);
    setSelMenu(null);
    try { window.getSelection()?.removeAllRanges(); } catch (_) {}
    await coreApi.saveEpubHighlights(filePath, next);
    return hl;
  };

  const copySelectionText = async () => {
    if (!selMenu) return;
    try {
      await navigator.clipboard.writeText(selMenu.text);
      showToast('متن کپی شد', { type: 'success' });
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = selMenu.text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('متن کپی شد', { type: 'success' });
      } catch (_) {}
    }
    setSelMenu(null);
  };

  const updateHighlight = async (id, patch) => {
    const next = highlights.map((h) => (h.id === id ? { ...h, ...patch } : h));
    setHighlights(next);
    await coreApi.saveEpubHighlights(filePath, next);
  };

  const deleteHighlight = async (id) => {
    const next = highlights.filter((h) => h.id !== id);
    setHighlights(next);
    setMarkMenu(null);
    await coreApi.saveEpubHighlights(filePath, next);
  };

  const handleAddBookmark = () => {
    const sc = contentRef.current;
    let yRatio = 0;
    if (sc && sc.scrollHeight > sc.clientHeight) {
      yRatio = clampYRatio(sc.scrollTop / (sc.scrollHeight - sc.clientHeight));
    }
    addBookmark({ filePath, page: chapterIndex + 1, yRatio, name: '' });
  };

  const handleOpenBookmark = useCallback((bm) => {
    if (!bm) return;
    const targetChapter = Number(bm.page) - 1;
    if (targetChapter !== chapterIndex) goToChapter(targetChapter, bm.yRatio);
    else if (contentRef.current) contentRef.current.scrollTop = (bm.yRatio || 0) * contentRef.current.scrollHeight;
  }, [chapterIndex, goToChapter]);

  const handleDeleteBookmark = useCallback((bm) => {
    if (!bm) return;
    deleteBookmark(filePath, bm.id);
  }, [deleteBookmark, filePath]);

  const handleRenameBookmark = useCallback((bm, newName) => {
    if (!bm) return;
    updateBookmark(filePath, bm.id, { name: newName });
  }, [updateBookmark, filePath]);

  const handleMoveBookmark = useCallback((bm, patch) => {
    if (!bm || !patch) return;
    updateBookmark(filePath, bm.id, patch);
  }, [updateBookmark, filePath]);

  if (bookLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', fontSize: 14 }}>
        در حالِ باز کردنِ کتاب…
      </div>
    );
  }

  if (bookError || !book) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
        <p style={{ color: 'var(--text)', fontSize: 14 }}>{bookError || 'کتاب بارگذاری نشد.'}</p>
        <button
          type="button"
          onClick={() => setCurrentView && setCurrentView('library')}
          style={{ background: 'rgba(34,211,238,0.15)', border: '1px solid rgba(34,211,238,0.4)', color: '#67e8f9', borderRadius: 10, padding: '8px 16px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}
        >
          بازگشت به کتابخانه
        </button>
      </div>
    );
  }

  const chapter = chapters[chapterIndex];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <style>{`
        .epub-chapter-content img { max-width: 100%; height: auto; }
        .epub-chapter-content p { margin: 0 0 1em; }
        .epub-chapter-content h1, .epub-chapter-content h2, .epub-chapter-content h3, .epub-chapter-content h4 { line-height: 1.4; margin: 0.8em 0 0.5em; }
        .epub-chapter-content a { color: #22d3ee; }
        .epub-chapter-content table { max-width: 100%; border-collapse: collapse; }
      `}</style>

      <AnnotationToolbar
        activePage={chapterIndex + 1}
        pageItemCount={currentChapterAnnotations.length}
        canUndo={false}
        canRedo={false}
        onUndo={() => {}}
        onRedo={() => {}}
        onClearPage={handleClearChapterAnnotations}
        isExportingPdf={false}
        pdfSaveState="idle"
      />

      {/* نوارِ ابزارِ فصل */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
        <button type="button" onClick={() => goToChapter(chapterIndex - 1)} disabled={chapterIndex <= 0} title="فصلِ قبلی" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, opacity: chapterIndex <= 0 ? 0.4 : 1 }}>
          <Icons.ChevronRight size={14} />
        </button>
        <button type="button" onClick={() => goToChapter(chapterIndex + 1)} disabled={chapterIndex >= chapters.length - 1} title="فصلِ بعدی" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, opacity: chapterIndex >= chapters.length - 1 ? 0.4 : 1 }}>
          <Icons.ChevronLeft size={14} />
        </button>
        <button type="button" onClick={() => setTocOpen((v) => !v)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
          فهرستِ فصل‌ها
        </button>
        <span style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 120 }}>
          {chapter ? chapter.title : ''} · فصلِ {chapterIndex + 1} از {chapters.length}
        </span>
        <button type="button" onClick={handleAddBookmark} title="افزودن بوک‌مارک در همین‌جا" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icons.Bookmark size={14} />
          بوک‌مارک
        </button>
        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
          فونت:
          <select value={fontId} onChange={(e) => setFontId(e.target.value)} style={{ background: 'var(--panel2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 8px', fontFamily: 'inherit', fontSize: 12 }}>
            {FONT_OPTIONS.map((f) => (<option key={f.id} value={f.id}>{f.label}</option>))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
          اندازه:
          <button type="button" onClick={() => setFontSize((v) => Math.max(14, v - 2))} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, width: 26, height: 26, cursor: 'pointer' }}>−</button>
          <span style={{ minWidth: 30, textAlign: 'center', color: 'var(--text)', fontSize: 12 }}>{fontSize}</span>
          <button type="button" onClick={() => setFontSize((v) => Math.min(28, v + 2))} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, width: 26, height: 26, cursor: 'pointer' }}>+</button>
        </label>
        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
          فاصلهٔ خطوط:
          <select value={lineHeight} onChange={(e) => setLineHeight(Number(e.target.value))} style={{ background: 'var(--panel2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 8px', fontFamily: 'inherit', fontSize: 12 }}>
            {LINE_HEIGHTS.map((lh) => (<option key={lh} value={lh}>{lh}</option>))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
          تمِ کاغذ:
          <select value={themeId} onChange={(e) => setThemeId(e.target.value)} style={{ background: 'var(--panel2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 8px', fontFamily: 'inherit', fontSize: 12 }}>
            {Object.entries(THEMES).map(([id, t]) => (<option key={id} value={id}>{t.name}</option>))}
          </select>
        </label>
      </div>

      {/* فهرستِ فصل‌ها */}
      {tocOpen && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel2)', maxHeight: 220, overflowY: 'auto' }}>
          {book.coverUrl && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
              <img src={book.coverUrl} alt="" style={{ width: 44, height: 64, objectFit: 'cover', borderRadius: 6 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{book.title || 'بدونِ عنوان'}</div>
                {book.creator && (<div style={{ fontSize: 12, color: 'var(--muted)' }}>{book.creator}</div>)}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {chapters.map((ch, idx) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => { goToChapter(idx); setTocOpen(false); }}
                style={{
                  display: 'flex', gap: 8, alignItems: 'center', textAlign: 'right',
                  background: idx === chapterIndex ? 'rgba(34,211,238,0.12)' : 'transparent',
                  border: idx === chapterIndex ? '1px solid var(--accent)' : '1px solid transparent',
                  borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: idx === chapterIndex ? 'var(--accent)' : 'var(--text)',
                  fontFamily: 'inherit', fontSize: 13,
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 22 }}>{idx + 1}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* برگهٔ فصل */}
      <div ref={contentRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '24px 80px', direction: 'rtl' }}>
        {chapterLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 32 }}>در حالِ بارگذاریِ فصل…</div>
        ) : (
          <div style={{ position: 'relative', maxWidth: 720, margin: '0 auto', background: theme.paper, color: theme.text, borderRadius: 12, padding: '32px 36px', boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}>
            <div
              ref={chapterElRef}
              className="epub-chapter-content"
              onMouseUp={handleContentMouseUp}
              onClick={handleContentClick}
              style={{ fontSize, fontFamily, lineHeight, wordBreak: 'break-word' }}
              dangerouslySetInnerHTML={{ __html: chapterHtml }}
            />
            {shouldMountAnnotationLayer && (
              <AnnotationLayer
                pageNumber={chapterIndex + 1}
                items={currentChapterAnnotations}
                onCommitPageItems={handleCommitPageAnnotations}
                rotation={0}
                isNearViewport
                zoomLevel={1}
              />
            )}
            {chapterBookmarks.map((bm) => (
              <div
                key={bm.id}
                style={{
                  position: 'absolute',
                  top: bm.yRatio <= 0 ? '0px' : `calc(${bm.yRatio * 100}% - 12px)`,
                  left: bm.side === 'left' ? undefined : 'calc(100% + 10px)',
                  right: bm.side === 'left' ? 'calc(100% + 10px)' : undefined,
                  zIndex: 50,
                }}
              >
                <BookmarkMarker
                  bookmark={bm}
                  imageUrl={resolveBookmarkImage(bm, bookmarkPreferences)}
                  onOpen={handleOpenBookmark}
                  onDelete={handleDeleteBookmark}
                  onRename={handleRenameBookmark}
                  onMove={handleMoveBookmark}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* منویِ شناورِ انتخابِ متن */}
      {selMenu && (
        <div
          style={{
            position: 'fixed', left: selMenu.x, top: selMenu.y, transform: 'translate(-50%, -100%)',
            background: '#0d131a', border: '1px solid rgba(34,211,238,0.4)', borderRadius: 12,
            padding: '8px 10px', zIndex: 100000, display: 'flex', gap: 6, alignItems: 'center', direction: 'rtl',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          {HL_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={`هایلایت ${c.label}`}
              onClick={() => addHighlight(c.bg)}
              style={{ width: 22, height: 22, borderRadius: '50%', background: c.bg, border: '2px solid rgba(255,255,255,0.7)', cursor: 'pointer', padding: 0 }}
            />
          ))}
          <button
            type="button"
            onClick={async () => {
              const hl = await addHighlight(HL_COLORS[0].bg);
              if (hl) setMarkMenu({ id: hl.id, x: selMenu.x, y: selMenu.y, note: '' });
            }}
            title="افزودن یادداشت به هایلایت"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 8, padding: '5px 9px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}
          >
            یادداشت
          </button>
          <button
            type="button"
            onClick={copySelectionText}
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 8, padding: '5px 9px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}
          >
            کپی متن
          </button>
          <button
            type="button"
            onClick={() => setSelMenu(null)}
            style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      )}

      {/* منویِ هایلایت (تغییرِ رنگ / یادداشت / حذف) */}
      {markMenu && (
        <div
          style={{
            position: 'fixed', left: Math.min(markMenu.x, window.innerWidth - 260), top: Math.min(markMenu.y, window.innerHeight - 200),
            background: '#0d131a', border: '1px solid rgba(34,211,238,0.4)', borderRadius: 12,
            padding: 10, zIndex: 100000, direction: 'rtl', width: 240,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {HL_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={`تغییر به ${c.label}`}
                onClick={() => { updateHighlight(markMenu.id, { color: c.bg }); setMarkMenu(null); }}
                style={{ width: 22, height: 22, borderRadius: '50%', background: c.bg, border: '2px solid rgba(255,255,255,0.7)', cursor: 'pointer', padding: 0 }}
              />
            ))}
          </div>
          <input
            type="text"
            value={markMenu.note}
            onChange={(e) => setMarkMenu({ ...markMenu, note: e.target.value })}
            placeholder="یادداشت برای این هایلایت…"
            style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: 8, color: '#fff', padding: '7px 10px', fontFamily: 'inherit', fontSize: 12, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => { updateHighlight(markMenu.id, { note: markMenu.note }); setMarkMenu(null); }}
              style={{ flex: 1, background: 'rgba(34,211,238,0.15)', border: '1px solid rgba(34,211,238,0.4)', color: '#67e8f9', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}
            >
              ذخیرهٔ یادداشت
            </button>
            <button
              type="button"
              onClick={() => deleteHighlight(markMenu.id)}
              style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}
            >
              حذف
            </button>
            <button
              type="button"
              onClick={() => setMarkMenu(null)}
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}
            >
              بستن
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
