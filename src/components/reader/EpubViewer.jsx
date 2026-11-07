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
import useSettingsStore from '../../store/useSettingsStore';
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
import { normalizeSearchTextLoose, findTextMatchSpans } from '../../utils/persianSearch';

// مرحلهٔ ۴۰ §۵: تبدیلِ HTML فصل به متنِ خالص برایِ جستجو و کشِ SQLite —
// همان زنجیرهٔ runEpubSearch، این‌بار در سطحِ ماژول تا هم جستجو و هم
// کشِ نمایشِ فصل از آن استفاده کنند.
export function stripEpubHtmlToPlainText(html) {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

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
  gray: { name: 'خاکستریِ ملایم', paper: '#e8eaed', text: '#1f2937', muted: '#6b7280' },
  dark: { name: 'تاریکِ شب', paper: '#0d131a', text: '#e5e7eb', muted: '#9ca3af' },
  amoled: { name: 'سیاهِ مطلق', paper: '#000000', text: '#e5e7eb', muted: '#9ca3af' },
};

// مرحلهٔ ۳۹ §۴: عرضِ ستونِ صفحهٔ EPUB + ترازبندیِ متن.
const COLUMN_WIDTHS = {
  narrow: { label: 'باریک', maxWidth: 560 },
  standard: { label: 'استاندارد', maxWidth: 720 },
  wide: { label: 'پهن', maxWidth: 880 },
  full: { label: 'تمام‌صفحه', maxWidth: '100%' },
};
const TEXT_ALIGNS = {
  right: { label: 'راست‌چین' },
  justify: { label: 'ترازِ دوطرفه' },
};

const FONT_OPTIONS = [
  { id: 'estedad', label: 'استعداد', family: "'Estedad', sans-serif" },
  { id: 'serif', label: 'سریف', family: "Georgia, 'Times New Roman', serif" },
  { id: 'sans', label: 'سنس', family: "Tahoma, 'Segoe UI', sans-serif" },
];

const LINE_HEIGHTS = [1.5, 1.7, 1.9, 2.1, 2.4];

// مرحلهٔ ۴۳ فازِ سوم (F6): آرایهٔ مشترکِ «فصل بدونِ حاشیه‌نویسی» —
// مثلِ EMPTY_PAGE_ANNOTATIONS در VerticalViewer/PdfViewer: `|| []`یِ
// تازه در هر رندر، مقایسهٔ سطحیِ memoیِ لایهٔ Konva را می‌شکست.
const EMPTY_PAGE_ANNOTATIONS = Object.freeze([]);

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

// مرحلهٔ ۴۱ §۳: کلیدِ ذخیرهٔ موقعیتِ داکِ شناورِ EPUB.
export const EPUB_DOCK_POSITION_KEY = 'comicReader.epubDockPosition.v1';

// مرحلهٔ ۴۱ §۳: clamp موقعیتِ داک — پنل هرگز از صفحه بیرون نمی‌زند.
// width: عرضِ داک در حالتِ جاری (۴۲ برای دکمهٔ بسته، ۲۶۴ برای پنلِ باز).
export function clampEpubDockPosition(x, y, width, viewportWidth, viewportHeight) {
  const w = typeof width === 'number' && width > 0 ? width : 264;
  const vw = typeof viewportWidth === 'number' && viewportWidth > 0 ? viewportWidth : 1200;
  const vh = typeof viewportHeight === 'number' && viewportHeight > 0 ? viewportHeight : 800;
  const maxX = Math.max(12, vw - w - 12);
  const maxY = Math.max(72, vh - 64);
  return {
    x: Math.min(Math.max(typeof x === 'number' && Number.isFinite(x) ? x : 18, 12), maxX),
    y: Math.min(Math.max(typeof y === 'number' && Number.isFinite(y) ? y : 82, 72), maxY),
  };
}

// مرحلهٔ ۴۱ §۶: نگاشتِ زومِ پیش‌فرضِ EPUB (درصد) به اندازهٔ فونت —
// زومِ EPUB اندازهٔ فونت است (۱۸ در ۱۰۰٪)؛ بازهٔ مجاز ۱۴ تا ۲۸.
export function epubDefaultZoomToFontSize(epubDefaultZoom) {
  const z = typeof epubDefaultZoom === 'number' && epubDefaultZoom > 0 ? epubDefaultZoom : 100;
  return Math.min(28, Math.max(14, Math.round((18 * z) / 100)));
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

// مرحلهٔ ۳۹ §۶: مارک‌هایِ جستجویِ EPUB (جدا از هایلایت‌هایِ دائمی:
// unwrapMarks فقط mark[data-hl-id] را برمی‌دارد، پس این دو با هم
// تداخل ندارند).
function unwrapSearchMarks(root) {
  const marks = root.querySelectorAll('mark[data-search-mark]');
  marks.forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  try { root.normalize(); } catch (_) {}
}

// اعمالِ مارکِ جستجو رویِ فصل: تطابق، فقط درونِ هر گرهٔ متنی پیدا
// می‌شود (تطابقی که از مرزِ دو المنت بگذرد، مارک نمی‌گیرد — همان
// محدودیتِ الگویِ TreeWalkerِ مرحلهٔ ۳۶). سقفِ ۲۰۰ مارک در هر فصل.
function applySearchMarksToEl(root, query, options) {
  const nodes = collectTextNodes(root);
  for (const node of nodes) {
    const spans = findTextMatchSpans(node.textContent, query, options).slice(0, 200);
    if (spans.length === 0) continue;
    let current = node;
    for (let i = spans.length - 1; i >= 0; i--) {
      const { start, end } = spans[i];
      if (end > current.textContent.length) continue;
      current.splitText(end);
      const mid = current.splitText(start);
      const mark = document.createElement('mark');
      mark.setAttribute('data-search-mark', '1');
      mark.style.backgroundColor = 'rgba(34, 211, 238, 0.35)';
      mark.style.color = 'inherit';
      mark.style.borderRadius = '3px';
      mark.style.padding = '0 1px';
      mark.style.outline = '1px solid rgba(34, 211, 238, 0.7)';
      if (mid.parentNode) {
        mid.parentNode.replaceChild(mark, mid);
        mark.appendChild(mid);
      }
      // current حالا همان گرهٔ چپِ [0,start) است و حلقه، به سراغِ spanِ قبلی می‌رود.
    }
  }
}


export default function EpubViewer({ filePath }) {
  const setCurrentPage = useReaderStore((state) => state.setCurrentPage);
  const setEpubChapters = useReaderStore((state) => state.setEpubChapters);
  // مرحلهٔ ۴۲ §۲: زوم، همگام‌سازی totalPages و پرش targetPage.
  const setTotalPages = useReaderStore((state) => state.setTotalPages);
  const targetPage = useReaderStore((state) => state.targetPage);
  const clearTargetPage = useReaderStore((state) => state.clearTargetPage);
  const isAnnotationActive = useAppStore((state) => Boolean(state.isAnnotationActive));
  const showToast = useAppStore((state) => state.showToast);
  const isRightSidebarOpen = useAppStore((state) => state.isRightSidebarOpen);
  // مرحلهٔ ۴۰ §۵: سیگنالِ جستجویِ EPUB از TopBar.
  const epubSearchRequestId = useReaderStore((state) => state.epubSearchRequestId || 0);
  const epubSearchQueryFromStore = useReaderStore((state) => state.epubSearchQuery || '');
  // مرحلهٔ ۳۹ §۳: رنگ‌هایِ موردِ علاقه در منوهایِ هایلایت.
  const favoriteColors = useAppStore((s) => s.favoriteColors || []);
  // مرحلهٔ ۳۸ §۸: زومِ امن برای لایهٔ حاشیه‌نویسی (در EPUB امروز ۱
  // می‌ماند، چون زومِ EPUB اندازهٔ فونت است؛ سیم‌کشی برای سازگاری
  // و آینده است).
  const zoomLevel = useReaderStore((state) => state.zoomLevel);
  const safeZoom = Math.min(3.5, Math.max(0.4, Number(zoomLevel) || 1));
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const updateReadingProgress = useLibraryStore((state) => state.updateReadingProgress);
  // مرحلهٔ ۴۱ §۱/§۵/§۶: اشتراکِ currentPage (برایِ گاردِ حلقه) + حالتِ
  // نمایشِ EPUB و رنگِ پس‌زمینه — با fallback تا اگر فیلدِ جدیدِ استور
  // هنوز اضافه نشده بود، خواننده خراب نشود.
  const currentPage = useReaderStore((state) => state.currentPage);
  const epubViewMode = useReaderStore((state) => state.epubViewMode || 'vertical');
  const setEpubViewMode = useReaderStore((state) => state.setEpubViewMode);
  const readerBackdropColor = useSettingsStore((state) => state.readerBackdropColor || '#2b3038');
  // مرحلهٔ ۴۱ §۱: گاردِ بارگذاریِ دوبارهٔ کتاب — فقط وقتی فایل واقعاً عوض شده باشد.
  const loadedEpubFileRef = useRef(null);
  // مرحلهٔ ۴۱ §۳: موقعیتِ داکِ شناور (ذخیره در localStorage؛ پیش‌فرض همان جایِ فعلی).
  const [dockPos, setDockPos] = useState(() => {
    const v = readLs(EPUB_DOCK_POSITION_KEY, null);
    if (v && typeof v.x === 'number' && typeof v.y === 'number') {
      return clampEpubDockPosition(v.x, v.y, 264, typeof window !== 'undefined' ? window.innerWidth : 1200, typeof window !== 'undefined' ? window.innerHeight : 800);
    }
    return { x: 18, y: 82 };
  });
  const [isDockDragging, setIsDockDragging] = useState(false);
  const dockDragRef = useRef(null);
  const dockWasDraggedRef = useRef(false);
  useEffect(() => { writeLs(EPUB_DOCK_POSITION_KEY, dockPos); }, [dockPos]);
  // مرحلهٔ ۴۱ §۲/§۴: ورق زدنِ افقی + نشانگرِ انتقالِ فصل.
  const [flipDirection, setFlipDirection] = useState(0);
  const prevChapterIndexRef = useRef(0);
  const flipClearTimerRef = useRef(null);
  const flipRafRef = useRef(null);
  const wheelCooldownRef = useRef(0);
  // مرحلهٔ ۴۲ §۳: گیت دو مرحله‌ای لبه + نادیده گرفتن اسکرول برنامه‌ای.
  const edgeReachedAtRef = useRef(0);
  const programmaticScrollUntilRef = useRef(0);
  const [chapterTransitionNotice, setChapterTransitionNotice] = useState('');
  const transitionNoticeTimerRef = useRef(null);

  const [book, setBook] = useState(null);
  const [bookLoading, setBookLoading] = useState(true);
  const [bookError, setBookError] = useState('');
  const [chapterIndex, setChapterIndex] = useState(0);
  // مرحلهٔ ۴۱ §۱: آینهٔ refیِ فصلِ فعلی — گاردِ حلقهٔ currentPage ↔ chapterIndex.
  const chapterIndexRef = useRef(0);
  useEffect(() => { chapterIndexRef.current = chapterIndex; }, [chapterIndex]);
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
  const [tocQuery, setTocQuery] = useState('');
  // مرحلهٔ ۳۹ §۴: عرضِ ستون + ترازِ متن + داکِ عمودیِ تاشو (وضعیتِ
  // باز/بسته در localStorage می‌ماند).
  const [columnWidthId, setColumnWidthId] = useState(() => {
    const v = readLs('comicReader.epubColumnWidth.v1', 'standard');
    return COLUMN_WIDTHS[v] ? v : 'standard';
  });
  const [textAlignId, setTextAlignId] = useState(() => {
    const v = readLs('comicReader.epubTextAlign.v1', 'right');
    return TEXT_ALIGNS[v] ? v : 'right';
  });
  const [dockOpen, setDockOpen] = useState(() => readLs('comicReader.epubDockOpen.v1', false) === true);
  const [dockMounted, setDockMounted] = useState(() => readLs('comicReader.epubDockOpen.v1', false) === true);
  // مرحلهٔ ۴۲ §۴: آینهٔ refی باز بودن داک — افکت کلید ([]) وضعیت را از ref می‌خواند.
  const dockOpenRef = useRef(false);
  useEffect(() => { dockOpenRef.current = dockOpen; }, [dockOpen]);
  const dockCloseTimerRef = useRef(null);

  const [highlights, setHighlights] = useState([]);
  const [selMenu, setSelMenu] = useState(null);
  const [markMenu, setMarkMenu] = useState(null);
  const [annotationsByPage, setAnnotationsByPage] = useState({});
  // مرحلهٔ ۳۸ §۸: پشته‌های Undo/Redo به‌ازای هر فصل (کلید = شمارهٔ فصل).
  const [undoStacks, setUndoStacks] = useState({});
  const [redoStacks, setRedoStacks] = useState({});

  const contentRef = useRef(null);
  const chapterElRef = useRef(null);
  const pendingBookmarkScrollRef = useRef(null);
  // آینهٔ refی annotationsByPage — تا کامیت/Undo، prevItems را بدونِ
  // stale closure بخوانند (آینهٔ الگوی PdfViewer).
  const annotationsByPageRef = useRef({});

  const chapters = useMemo(() => (book && Array.isArray(book.chapters) ? book.chapters : []), [book]);
  const theme = THEMES[themeId] || THEMES.light;
  const columnWidth = COLUMN_WIDTHS[columnWidthId] || COLUMN_WIDTHS.standard;
  // مرحلهٔ ۴۲ §۲: زوم زنده — اندازهٔ فونت و عرض ستون با زوم مقیاس می‌گیرند.
  const effectiveFontSize = Math.round(Math.min(48, Math.max(11, fontSize * safeZoom)));
  const effectiveMaxWidth = columnWidthId === 'full' ? '100%' : `${Math.round(Math.min(1600, Math.max(420, (typeof columnWidth.maxWidth === 'number' ? columnWidth.maxWidth : 720) * Math.pow(safeZoom, 0.65))))}px`;
  const chapterHighlightCount = useMemo(
    () => (highlights || []).filter((h) => h.chapterIndex === chapterIndex).length,
    [highlights, chapterIndex],
  );
  const tocFilteredChapters = useMemo(() => {
    const q = normalizeSearchTextLoose(tocQuery || '');
    if (!q) return chapters;
    return chapters.filter((ch) => normalizeSearchTextLoose(ch.title || '').includes(q));
  }, [chapters, tocQuery]);
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
  const currentChapterAnnotations = annotationsByPage[String(chapterIndex + 1)] || EMPTY_PAGE_ANNOTATIONS;
  const shouldMountAnnotationLayer = isAnnotationActive || currentChapterAnnotations.length > 0;

  useEffect(() => { writeLs('comicReader.epubFontSize.v1', fontSize); }, [fontSize]);
  useEffect(() => { writeLs('comicReader.epubFont.v1', fontId); }, [fontId]);
  useEffect(() => { writeLs('comicReader.epubLineHeight.v1', lineHeight); }, [lineHeight]);
  useEffect(() => { writeLs('comicReader.epubTheme.v1', themeId); }, [themeId]);
  useEffect(() => { writeLs('comicReader.epubColumnWidth.v1', columnWidthId); }, [columnWidthId]);
  useEffect(() => { writeLs('comicReader.epubTextAlign.v1', textAlignId); }, [textAlignId]);
  useEffect(() => { writeLs('comicReader.epubDockOpen.v1', dockOpen); }, [dockOpen]);
  // مرحلهٔ ۳۹ §۴: باز/بسته کردنِ داک با انیمیشن — بستن، اول opacity و
  // transform را به صفر می‌برد و بعد از ۳۲۰ میلی‌ثانیه آنمانت می‌کند؛
  // باز کردن، اول مانت می‌کند و در فریمِ بعد، انیمیشنِ ورود را می‌زند.
  const openDock = useCallback(() => {
    if (dockCloseTimerRef.current) {
      clearTimeout(dockCloseTimerRef.current);
      dockCloseTimerRef.current = null;
    }
    setDockMounted(true);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setDockOpen(true));
      });
    } else {
      setDockOpen(true);
    }
  }, []);
  const closeDock = useCallback(() => {
    setDockOpen(false);
    if (dockCloseTimerRef.current) clearTimeout(dockCloseTimerRef.current);
    dockCloseTimerRef.current = setTimeout(() => {
      setDockMounted(false);
      dockCloseTimerRef.current = null;
    }, 320);
  }, []);
  useEffect(() => () => {
    if (dockCloseTimerRef.current) clearTimeout(dockCloseTimerRef.current);
    if (flipClearTimerRef.current) clearTimeout(flipClearTimerRef.current);
    if (flipRafRef.current) cancelAnimationFrame(flipRafRef.current);
    if (transitionNoticeTimerRef.current) clearTimeout(transitionNoticeTimerRef.current);
  }, []);

  // بارگذاریِ کتاب + شروعِ جلسهٔ مطالعه.
  useEffect(() => {
    if (!filePath) return undefined;
    // مرحلهٔ ۴۱ §۱: فقط وقتی فایل واقعاً عوض شده بارگذاری کن — تغییرِ
    // استیتِ داخلی هرگز باعثِ اجرایِ دوباره نمی‌شود.
    if (loadedEpubFileRef.current === filePath) return undefined;
    loadedEpubFileRef.current = filePath;
    let isMounted = true;
    setBookLoading(true);
    setBookError('');
    setBook(null);
    // مرحلهٔ ۴۳ فازِ سوم (F4): با باز شدنِ کتابِ تازه، نوارِ جستجویِ
    // کتابِ قبلی بسته می‌شود؛ افکتِ بستنِ نوار، نتایج و مارک‌ها را
    // خودش پاک می‌کند.
    setEpubSearchOpen(false);
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
      if (typeof setTotalPages === 'function') setTotalPages(list.length);
      epubFileMtimeRef.current = Number(res.sourceMtimeMs) || 0;
      epubChapterTextMemCacheRef.current.clear();
      const startPage = useReaderStore.getState().currentPage || 1;
      const startIdx = Math.max(0, Math.min(startPage - 1, list.length - 1));
      // مرحلهٔ ۴۱ §۱: گارد — فقط وقتی فصلِ شروع واقعاً فرق دارد بنویس.
      if (chapterIndexRef.current !== startIdx) setChapterIndex(startIdx);
      chapterIndexRef.current = startIdx;
      // مرحلهٔ ۴۱ §۶: پیش‌فرض‌هایِ EPUB موقعِ لودِ کتاب — حالتِ نمایش
      // از تنظیمات؛ زوم (درصد) به اندازهٔ فونت نگاشت می‌شود، فقط وقتی
      // کاربر تا حالا اندازهٔ فونت را خودش عوض نکرده باشد (کلیدِ
      // localStorage نباشد) تا انتخابِ دستیِ او رونویسی نشود. خواندن
      // با getState تا وابستگیِ افکت عوض نشود و کتاب دوباره لود نشود.
      try {
        const defaultMode = useSettingsStore.getState().epubDefaultViewMode === 'horizontal-paged' ? 'horizontal-paged' : 'vertical';
        const applyMode = useReaderStore.getState().setEpubViewMode;
        if (typeof applyMode === 'function' && useReaderStore.getState().epubViewMode !== defaultMode) applyMode(defaultMode);
        if (localStorage.getItem('comicReader.epubFontSize.v1') === null) {
          setFontSize(epubDefaultZoomToFontSize(useSettingsStore.getState().epubDefaultZoom));
        }
      } catch (_) {}
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
      loadedEpubFileRef.current = null;
      try { readingActivity.end(); } catch (_) {}
      setEpubChapters([]);
      if (typeof setTotalPages === 'function') setTotalPages(0);
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
        // مرحلهٔ ۴۰ §۵: متنِ خالصِ همین فصل را در حافظه و SQLite کش کن
        // تا جستجوهایِ بعدی، بی‌خواندنِ دوبارهٔ فایل انجام شوند.
        try {
          const plain = stripEpubHtmlToPlainText(res.html || '');
          if (plain.trim()) {
            setMemCache(chapterIndex, plain);
            coreApi.saveEpubChapterText(filePath, chapterIndex, epubFileMtimeRef.current, plain).catch(() => {});
          }
        } catch (_) {}
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
    // مرحلهٔ ۴۱ §۱: گاردِ حلقه — فقط وقتی currentPage واقعاً فرق دارد بنویس.
    if (useReaderStore.getState().currentPage !== chapterIndex + 1) setCurrentPage(chapterIndex + 1);
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
  // مرحلهٔ ۴۱ §۱: رفرنسِ پایدارِ goToChapter — افکت‌ها به‌جایِ خودِ تابع،
  // از این ref می‌خوانند تا تغییرِ رفرنسِ تابع هرگز افکتی را دوباره اجرا نکند.
  const goToChapterRef = useRef(goToChapter);
  useEffect(() => { goToChapterRef.current = goToChapter; }, [goToChapter]);
  // مرحلهٔ ۴۱ §۱: همگام‌سازیِ تغییرِ بیرونیِ currentPage (مثلاً setComicData
  // موقعِ باز شدنِ کتاب یا پرش از پنلِ راست) به فصلِ جاری — با گاردِ ref
  // تا حلقه نسازد: اگر فصلِ هدف همان فصلِ فعلی است، چیزی نوشته نمی‌شود.
  useEffect(() => {
    if (!book || chapters.length === 0) return;
    const target = Math.max(0, Math.min((Number(currentPage) || 1) - 1, chapters.length - 1));
    if (target !== chapterIndexRef.current) setChapterIndex(target);
  }, [currentPage, book, chapters]);
  // مرحلهٔ ۴۱ §۴: انیمیشنِ ورق زدنِ افقی — جهت از رویِ علامتِ تغییرِ فصل؛
  // در لودِ اول (هنوز chapterHtml خالی است) انیمیشنی پخش نمی‌شود. اول
  // به ۰ برمی‌گردد و در فریمِ بعد جهت را می‌گیرد تا ورق‌هایِ سریعِ
  // هم‌جهت هم انیمیشن را از اول پخش کنند.
  useEffect(() => {
    if (epubViewMode !== 'horizontal-paged') return undefined;
    if (!chapterHtml) { prevChapterIndexRef.current = chapterIndex; return undefined; }
    const prev = prevChapterIndexRef.current;
    if (chapterIndex === prev) return undefined;
    const dir = chapterIndex > prev ? 1 : -1;
    prevChapterIndexRef.current = chapterIndex;
    setFlipDirection(0);
    if (flipClearTimerRef.current) { clearTimeout(flipClearTimerRef.current); flipClearTimerRef.current = null; }
    if (flipRafRef.current) { cancelAnimationFrame(flipRafRef.current); flipRafRef.current = null; }
    flipRafRef.current = requestAnimationFrame(() => {
      flipRafRef.current = null;
      setFlipDirection(dir);
      flipClearTimerRef.current = setTimeout(() => { setFlipDirection(0); flipClearTimerRef.current = null; }, 340);
    });
    return () => {
      if (flipClearTimerRef.current) { clearTimeout(flipClearTimerRef.current); flipClearTimerRef.current = null; }
      if (flipRafRef.current) { cancelAnimationFrame(flipRafRef.current); flipRafRef.current = null; }
    };
  }, [chapterIndex, epubViewMode]);
  // مرحلهٔ ۴۱ §۲: نشانگرِ نرمِ انتقالِ فصل (خودکار بعد از ~۱٫۱ ثانیه پاک می‌شود).
  const showChapterTransitionNotice = useCallback((dir) => {
    if (transitionNoticeTimerRef.current) clearTimeout(transitionNoticeTimerRef.current);
    setChapterTransitionNotice(dir > 0 ? 'در حالِ رفتن به فصلِ بعد…' : 'در حالِ رفتن به فصلِ قبل…');
    transitionNoticeTimerRef.current = setTimeout(() => { setChapterTransitionNotice(''); transitionNoticeTimerRef.current = null; }, 1100);
  }, []);
  // مرحلهٔ ۴۱ §۲: رفتن به فصلِ بعدی/قبلی با اسکرول — عمودی: فقط در لبهٔ
  // بالا/پایین و با کول‌داونِ ۵۵۰ میلی‌ثانیه؛ افقی: هر چرخ، فصل را ورق می‌زند.
  // رفتن به فصل (از راهِ افکتِ فصل) scrollTop را صفر می‌کند، یعنی به ابتدایِ فصل.
  // مرحلهٔ ۴۲ §۲/§۳: چرخ ماوس — اول زوم با Ctrl، بعد گیت دو مرحله‌ای لبه.
  // چرخ اول در لبه فقط «رسیدن به لبه» را ثبت می‌کند؛ ورق زدن فقط وقتی
  // انجام می‌شود که چرخ بعدی، ۳۸۰ میلی‌ثانیه بعد و با دلتای بیش از ۳۵
  // برسد. اسکرول برنامه‌ای بعد از ورق، تا ۵۰۰ میلی‌ثانیه نادیده گرفته می‌شود.
  const handleContentWheel = (e) => {
    if (!chapters.length || !e) return;
    // (۱) چرخ+Ctrl را شنوندهٔ نیتیوِ پایین‌تر انجام می‌دهد؛ اینجا فقط نادیده گرفته می‌شود تا گیتِ لبه فصل را ورق نزند.
    if (e.ctrlKey || e.metaKey) return;
    // (۲) اسکرول برنامه‌ای بعد از ورق (دکمه/داک) را نادیده بگیر.
    if (Date.now() < programmaticScrollUntilRef.current) return;
    const sc = contentRef.current;
    if (!sc) return;
    const now = Date.now();
    const maxScrollTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
    const canScrollDown = sc.scrollTop < maxScrollTop - 2;
    const canScrollUp = sc.scrollTop > 2;
    // ورق زدن با گیت دو مرحله‌ای — چرخ اول فقط لبه را ثبت می‌کند.
    const flipWithGate = (dir) => {
      if (now - wheelCooldownRef.current < 550) return;
      if (edgeReachedAtRef.current === 0) {
        edgeReachedAtRef.current = now;
        return;
      }
      if (now - edgeReachedAtRef.current >= 380 && Math.abs(e.deltaY) > 35) {
        wheelCooldownRef.current = now;
        edgeReachedAtRef.current = 0;
        programmaticScrollUntilRef.current = now + 500;
        showChapterTransitionNotice(dir);
        goToChapter(chapterIndex + dir);
      }
    };
    if (epubViewMode === 'horizontal-paged') {
      // هنوز جای اسکرول هست — ریست کن و بگذار طبیعی اسکرول شود.
      if (e.deltaY > 0 && canScrollDown) { edgeReachedAtRef.current = 0; return; }
      if (e.deltaY < 0 && canScrollUp) { edgeReachedAtRef.current = 0; return; }
      // اسکرول افقی صریح — همان قرارداد قبلی: d > 25 یعنی فصل بعد.
      if (Math.abs(e.deltaX || 0) > Math.abs(e.deltaY) * 1.5) {
        const d = e.deltaX || 0;
        if (now - wheelCooldownRef.current < 550) return;
        if (d > 25 && chapterIndex < chapters.length - 1) {
          wheelCooldownRef.current = now;
          programmaticScrollUntilRef.current = now + 500;
          showChapterTransitionNotice(1);
          goToChapter(chapterIndex + 1);
        } else if (d < -25 && chapterIndex > 0) {
          wheelCooldownRef.current = now;
          programmaticScrollUntilRef.current = now + 500;
          showChapterTransitionNotice(-1);
          goToChapter(chapterIndex - 1);
        }
        return;
      }
      if (e.deltaY > 0 && !canScrollDown && chapterIndex < chapters.length - 1) { flipWithGate(1); return; }
      if (e.deltaY < 0 && !canScrollUp && chapterIndex > 0) { flipWithGate(-1); return; }
      return;
    }
    const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 15;
    const atTop = sc.scrollTop <= 5;
    if (e.deltaY > 0 && !atBottom) { edgeReachedAtRef.current = 0; return; }
    if (e.deltaY < 0 && !atTop) { edgeReachedAtRef.current = 0; return; }
    if (atBottom && e.deltaY > 0 && chapterIndex < chapters.length - 1) { flipWithGate(1); return; }
    if (atTop && e.deltaY < 0 && chapterIndex > 0) { flipWithGate(-1); return; }
  };
  // مرحلهٔ ۴۲ §۲: زوم با چرخ+Ctrl با شنوندهٔ نیتیوِ غیر-passive (الگوی PdfViewer).
  // شنوندهٔ onWheelِ ری‌اکت passive است و preventDefault در آن بی‌اثر می‌ماند؛
  // پس زومِ Ctrl+Wheel اینجا وصل می‌شود تا زومِ پیش‌فرضِ مرورگر هم‌زمان اجرا نشود.
  // مقدارِ زوم با getState خوانده می‌شود تا افکت وابستگی نداشته باشد.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return undefined;
    const handleNativeWheelZoom = (ev) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      const current = Number(useReaderStore.getState().zoomLevel) || 1;
      const next = Math.min(3.5, Math.max(0.4, current + (ev.deltaY < 0 ? 0.1 : -0.1)));
      if (Math.abs(next - current) >= 0.005) useReaderStore.getState().setZoomLevel(next);
    };
    el.addEventListener('wheel', handleNativeWheelZoom, { passive: false });
    return () => { el.removeEventListener('wheel', handleNativeWheelZoom); };
  }, []);

  // مرحلهٔ ۴۱ §۲: کلیدهایِ جهت‌نما در حالتِ افقی — راست‌به‌چپ: ArrowLeft
  // فصلِ بعد، ArrowRight فصلِ قبل (مثلِ دکمه‌هایِ داک). اگر useKeyboard
  // همین کلید را قبلاً گرفته باشد (defaultPrevented)، دخالت نمی‌کنیم.
  useEffect(() => {
    if (epubViewMode !== 'horizontal-paged') return undefined;
    const onKey = (e) => {
      if (!e || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const now = Date.now();
      if (now - wheelCooldownRef.current < 550) return;
      if (e.key === 'ArrowLeft' && chapterIndex < chapters.length - 1) {
        e.preventDefault();
        wheelCooldownRef.current = now;
        showChapterTransitionNotice(1);
        goToChapterRef.current(chapterIndex + 1);
      } else if (e.key === 'ArrowRight' && chapterIndex > 0) {
        e.preventDefault();
        wheelCooldownRef.current = now;
        showChapterTransitionNotice(-1);
        goToChapterRef.current(chapterIndex - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [epubViewMode, chapterIndex, chapters.length, showChapterTransitionNotice]);
  // مرحلهٔ ۴۱ §۳: درگِ داکِ شناور — هم دکمهٔ بستهٔ چرخ‌دنده و هم هدرِ پنلِ باز.
  // حرکتِ بیش از ۴ پیکسل یعنی درگ (wasDragged) و کلیکِ بعدی نادیده گرفته می‌شود.
  const startDockDrag = useCallback((e, width) => {
    if (!e || (typeof e.button === 'number' && e.button !== 0)) return;
    if (typeof e.preventDefault === 'function') e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    dockDragRef.current = { startX, startY, origX: dockPos.x, origY: dockPos.y, width: width || 264, moved: false };
    setIsDockDragging(true);
    const onMove = (ev) => {
      const st = dockDragRef.current;
      if (!st) return;
      const dx = ev.clientX - st.startX;
      const dy = ev.clientY - st.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) st.moved = true;
      setDockPos(clampEpubDockPosition(st.origX + dx, st.origY + dy, st.width, window.innerWidth, window.innerHeight));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const st = dockDragRef.current;
      dockDragRef.current = null;
      setIsDockDragging(false);
      if (st && st.moved) {
        dockWasDraggedRef.current = true;
        setTimeout(() => { dockWasDraggedRef.current = false; }, 0);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [dockPos]);
  // مرحلهٔ ۴۱ §۳: کلیکِ دکمهٔ چرخ‌دنده — اگر همین ژست درگ بوده، باز نشود.
  const handleDockButtonClick = useCallback(() => {
    if (dockWasDraggedRef.current) { dockWasDraggedRef.current = false; return; }
    openDock();
  }, [openDock]);
  // مرحلهٔ ۳۹ §۵: ویرایشِ مستقیمِ شمارهٔ فصل از رویِ نشانگرِ پایین-راست.
  const [isEditingPageHud, setIsEditingPageHud] = useState(false);
  const [pageHudDraft, setPageHudDraft] = useState('');
  const [pageHudHovered, setPageHudHovered] = useState(false);
  const commitHudJump = useCallback(() => {
    const n = Math.max(1, Math.min(chapters.length, Number(pageHudDraft) || 1));
    setIsEditingPageHud(false);
    goToChapter(n - 1);
  }, [chapters.length, pageHudDraft, goToChapter]);

  // مرحلهٔ ۳۹ §۶: جستجویِ درون‌متنِ EPUB — همهٔ فصل‌ها، با همان
  // گزینه‌هایِ PdfViewer (کلمهٔ کامل، پیش‌فرض روشن).
  const [epubSearchOpen, setEpubSearchOpen] = useState(false);
  const [epubSearchQuery, setEpubSearchQuery] = useState('');
  // مرحلهٔ ۴۲ §۴: آینهٔ refی باز بودن نوار جستجو — افکت کلید ([]) وضعیت را از ref می‌خواند.
  const epubSearchOpenRef = useRef(false);
  useEffect(() => { epubSearchOpenRef.current = epubSearchOpen; }, [epubSearchOpen]);

  // مرحلهٔ ۴۳ فازِ سوم (F5): پرچمِ سراسریِ باز بودنِ اورلیِ EPUB —
  // نوارِ جستجو یا داکِ چرخ‌دنده — تا useKeyboard در فازِ capture،
  // با Escape کتاب را نبندد و رویداد به هندلرِ حبابیِ همین فایل برسد؛
  // دقیقاً به سبکِ window.__isRecordingShortcut.
  useEffect(() => {
    window.__epubOverlayOpen = epubSearchOpen || dockOpen;
    return () => { window.__epubOverlayOpen = false; };
  }, [epubSearchOpen, dockOpen]);
  // مرحلهٔ ۴۰ §۵: ماندگاریِ تاگل‌هایِ جستجو در localStorage.
  const [epubSearchOptions, setEpubSearchOptions] = useState(() => {
    try {
      const raw = localStorage.getItem('comicReader.epubSearchOptions.v1');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        return {
          wholeWord: typeof parsed.wholeWord === 'boolean' ? parsed.wholeWord : true,
          caseSensitive: typeof parsed.caseSensitive === 'boolean' ? parsed.caseSensitive : false,
          prefix: typeof parsed.prefix === 'boolean' ? parsed.prefix : false,
        };
      }
    } catch (_) {}
    return { wholeWord: true, caseSensitive: false, prefix: false };
  });
  const [epubSearchResults, setEpubSearchResults] = useState([]);
  const [epubSearchScanning, setEpubSearchScanning] = useState(false);
  const [epubSearchMarkedChapter, setEpubSearchMarkedChapter] = useState(null);
  const epubSearchRunIdRef = useRef(0);
  const epubSearchInputRef = useRef(null);
  const scrollToSearchMarkRef = useRef(false);
  // مرحلهٔ ۴۰ §۵: کشِ متنِ خالصِ فصل‌ها — حافظه (per-book) + SQLite.
  const epubChapterTextMemCacheRef = useRef(new Map());
  const epubFileMtimeRef = useRef(0);
  // مرحلهٔ ۴۲ §۴: کلید ترکیبی کش (mtime کتاب + شمارهٔ فصل) تا کش کتاب
  // قبلی با کتاب جدید قاطی نشود؛ سقف ۶۰ فصل — قدیمی‌ترین ورودی اول حذف می‌شود.
  const cacheKey = (idx) => `${epubFileMtimeRef.current}:${idx}`;
  const setMemCache = (idx, text) => {
    const map = epubChapterTextMemCacheRef.current;
    map.set(cacheKey(idx), text);
    if (map.size > 60) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  };

  // Ctrl+F در نمایِ EPUB، نوارِ جستجو را باز می‌کند.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        // اگر نوار از قبل باز است، فقط ورودی را فوکوس کن.
        if (epubSearchInputRef.current) epubSearchInputRef.current.focus();
        if (epubSearchOpenRef.current) return;
        setEpubSearchOpen(true);
        setTimeout(() => { if (epubSearchInputRef.current) epubSearchInputRef.current.focus(); }, 0);
        return;
      }
      if (e.key === 'Escape') {
        if (epubSearchOpenRef.current) {
          setEpubSearchOpen(false);
        } else if (dockOpenRef.current) {
          closeDock();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // مرحلهٔ ۴۰ §۵: ماندگاریِ تاگل‌هایِ جستجو.
  useEffect(() => {
    try { localStorage.setItem('comicReader.epubSearchOptions.v1', JSON.stringify(epubSearchOptions)); } catch (_) {}
  }, [epubSearchOptions]);

  // مرحلهٔ ۴۰ §۵: سیگنالِ جستجو از TopBar — نوارِ جستجویِ EPUB را باز
  // و فوکوس کن (آینهٔ PdfViewer).
  useEffect(() => {
    if (!epubSearchRequestId) return;
    setEpubSearchOpen(true);
    setEpubSearchQuery(epubSearchQueryFromStore || '');
    setTimeout(() => { if (epubSearchInputRef.current) epubSearchInputRef.current.focus(); }, 0);
  }, [epubSearchRequestId, epubSearchQueryFromStore]);

  // مرحلهٔ ۴۰ §۵: متنِ خالصِ یک فصل — اول حافظه، بعد SQLite، بعد
  // خواندنِ فصل از EPUB. در صورتِ نبودنِ موتورِ SQLite یا عوض شدنِ
  // mtime، بی‌صدا به خواندنِ فصل برمی‌گردد.
  const getEpubChapterPlainText = useCallback(async (chapterIdx) => {
    const mem = epubChapterTextMemCacheRef.current.get(cacheKey(chapterIdx));
    if (typeof mem === 'string') return mem;
    try {
      const cached = await coreApi.getEpubChapterText(filePath, chapterIdx, epubFileMtimeRef.current);
      if (cached && cached.found && typeof cached.plainText === 'string') {
        setMemCache(chapterIdx, cached.plainText);
        return cached.plainText;
      }
    } catch (_) {}
    const ch = chapters[chapterIdx];
    if (!ch) return '';
    try {
      const res = await coreApi.loadEpubChapter(filePath, ch.id);
      const html = res && res.success ? (res.html || '') : '';
      const text = stripEpubHtmlToPlainText(html);
      setMemCache(chapterIdx, text);
      if (text.trim()) coreApi.saveEpubChapterText(filePath, chapterIdx, epubFileMtimeRef.current, text).catch(() => {});
      return text;
    } catch (_) {
      return '';
    }
  }, [filePath, chapters]);

  const runEpubSearch = useCallback(async (query, options) => {
    const runId = ++epubSearchRunIdRef.current;
    const q = (query || '').trim();
    if (!q || !filePath || chapters.length === 0) {
      setEpubSearchResults([]);
      setEpubSearchScanning(false);
      return;
    }
    setEpubSearchScanning(true);
    const found = [];
    const CHUNK = 2;
    for (let ci = 0; ci < chapters.length; ci += CHUNK) {
      if (epubSearchRunIdRef.current !== runId) return;
      for (let k = ci; k < Math.min(chapters.length, ci + CHUNK); k++) {
        if (epubSearchRunIdRef.current !== runId) return;
        const ch = chapters[k];
        if (epubSearchRunIdRef.current !== runId) return;
        const text = await getEpubChapterPlainText(k);
        if (epubSearchRunIdRef.current !== runId) return;
        const spans = findTextMatchSpans(text, q, options);
        if (spans.length > 0) {
          const first = spans[0];
          const snippet = text.slice(Math.max(0, first.start - 40), Math.min(text.length, first.end + 40)).replace(/\s+/g, ' ').trim();
          found.push({ chapterIndex: k, title: ch.title || ('فصل ' + (k + 1)), count: spans.length, snippet });
        }
      }
      if (ci + CHUNK < chapters.length) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
    if (epubSearchRunIdRef.current === runId) {
      setEpubSearchResults(found);
      setEpubSearchScanning(false);
    }
  }, [filePath, chapters, getEpubChapterPlainText]);

  // دیبانسِ ۲۵۰ میلی‌ثانیه‌ایِ تایپ.
  useEffect(() => {
    if (!epubSearchOpen) return;
    if (!epubSearchQuery.trim()) {
      epubSearchRunIdRef.current += 1;
      setEpubSearchResults([]);
      setEpubSearchScanning(false);
      return;
    }
    const t = setTimeout(() => { runEpubSearch(epubSearchQuery, epubSearchOptions); }, 250);
    return () => clearTimeout(t);
  }, [epubSearchOpen, epubSearchQuery, epubSearchOptions, runEpubSearch]);

  // بستنِ نوار: نتایج و مارک‌ها پاک می‌شوند.
  useEffect(() => {
    if (epubSearchOpen) return;
    epubSearchRunIdRef.current += 1;
    setEpubSearchResults([]);
    setEpubSearchMarkedChapter(null);
    const el = chapterElRef.current;
    if (el) unwrapSearchMarks(el);
  }, [epubSearchOpen]);

  const jumpToEpubSearchResult = useCallback((res) => {
    if (!res) return;
    scrollToSearchMarkRef.current = true;
    setEpubSearchMarkedChapter(res.chapterIndex);
    goToChapter(res.chapterIndex);
  }, [goToChapter]);

  // اعمالِ مارک‌هایِ جستجو رویِ فصلِ جاری (پس از رندرِ فصل).
  useEffect(() => {
    const el = chapterElRef.current;
    if (!el) return;
    unwrapSearchMarks(el);
    if (epubSearchMarkedChapter === chapterIndex && epubSearchQuery.trim()) {
      applySearchMarksToEl(el, epubSearchQuery, epubSearchOptions);
      if (scrollToSearchMarkRef.current) {
        scrollToSearchMarkRef.current = false;
        const first = el.querySelector('mark[data-search-mark]');
        if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, [chapterHtml, chapterIndex, epubSearchQuery, epubSearchOptions, epubSearchMarkedChapter]);
  // پرش از پنلِ راست (فصل‌ها).
  // پرش از پنلِ راست (فصل‌ها) — مرحلهٔ ۴۱ §۱: با goToChapterRef تا
  // تغییرِ رفرنسِ تابع، افکت را دوباره اجرا نکند.
  useEffect(() => {
    const onJump = (e) => {
      const idx = Number(e?.detail?.chapterIndex);
      if (Number.isFinite(idx)) goToChapterRef.current(idx);
    };
    window.addEventListener('app:epub-jump', onJump);
    return () => window.removeEventListener('app:epub-jump', onJump);
  }, []);
  // مرحلهٔ ۴۲ §۲: پرش به صفحهٔ هدف از استور (مثلأ از TopBar) — با گارد
  // ref تا حلقه نسازد؛ بعد از پرش، سیگنال پاک می‌شود.
  useEffect(() => {
    if (targetPage == null) return;
    const idx = (Number(targetPage) || 1) - 1;
    if (idx !== chapterIndexRef.current) goToChapterRef.current(idx);
    clearTargetPage();
  }, [targetPage]);

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
      annotationsByPageRef.current = merged.pages;
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
    // مرحلهٔ ۳۸ §۸: ورودیِ Undo (آینهٔ PdfViewer) — سقفِ ۳۰، و
    // با هر کامیت، Redoی همان فصل پاک می‌شود.
    const prevItems = annotationsByPageRef.current[pageKey] || [];
    annotationsByPageRef.current = { ...annotationsByPageRef.current, [pageKey]: nextPageItems };
    setUndoStacks((prev) => {
      const stack = prev[pageKey] || [];
      return { ...prev, [pageKey]: [...stack.slice(-29), { pageNum, prevItems, nextItems: nextPageItems }] };
    });
    setRedoStacks((prev) => ({ ...prev, [pageKey]: [] }));
    setAnnotationsByPage((prev) => ({ ...prev, [pageKey]: nextPageItems }));
    if (coreApi.isAvailable()) coreApi.savePageAnnotations(filePath, pageNum, nextPageItems).catch(() => {});
    annotationLocalBackup.writePageBackup(filePath, pageNum, nextPageItems);
  }, [filePath]);

  // مرحلهٔ ۳۸ §۸: Undo/Redoی فصلِ جاری — آینهٔ الگوی PdfViewer
  // (همان شکلِ اکشن؛ همان ذخیره‌سازیِ DB + آینهٔ محلی).
  const handleUndoAnnotation = useCallback(() => {
    const pageKey = String(chapterIndex + 1);
    const stack = undoStacks[pageKey] || [];
    if (stack.length === 0) return;
    const lastAction = stack[stack.length - 1];
    annotationsByPageRef.current = { ...annotationsByPageRef.current, [pageKey]: lastAction.prevItems };
    setAnnotationsByPage((prevMap) => ({ ...prevMap, [pageKey]: lastAction.prevItems }));
    setRedoStacks((prev) => ({ ...prev, [pageKey]: [...(prev[pageKey] || []), lastAction] }));
    setUndoStacks((prev) => ({ ...prev, [pageKey]: stack.slice(0, -1) }));
    if (coreApi.isAvailable()) coreApi.savePageAnnotations(filePath, lastAction.pageNum, lastAction.prevItems).catch(() => {});
    annotationLocalBackup.writePageBackup(filePath, lastAction.pageNum, lastAction.prevItems);
  }, [chapterIndex, filePath, undoStacks]);

  const handleRedoAnnotation = useCallback(() => {
    const pageKey = String(chapterIndex + 1);
    const stack = redoStacks[pageKey] || [];
    if (stack.length === 0) return;
    const nextAction = stack[stack.length - 1];
    annotationsByPageRef.current = { ...annotationsByPageRef.current, [pageKey]: nextAction.nextItems };
    setAnnotationsByPage((prevMap) => ({ ...prevMap, [pageKey]: nextAction.nextItems }));
    setUndoStacks((prev) => ({ ...prev, [pageKey]: [...(prev[pageKey] || []), nextAction] }));
    setRedoStacks((prev) => ({ ...prev, [pageKey]: stack.slice(0, -1) }));
    if (coreApi.isAvailable()) coreApi.savePageAnnotations(filePath, nextAction.pageNum, nextAction.nextItems).catch(() => {});
    annotationLocalBackup.writePageBackup(filePath, nextAction.pageNum, nextAction.nextItems);
  }, [chapterIndex, filePath, redoStacks]);

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

  // مرحلهٔ ۴۰ §۳: درگِ ۶۰ فریم — امضایِ جدید (id, ratio).
  const handleMoveBookmark = useCallback((id, ratio) => {
    if (!id || typeof ratio !== 'number') return;
    updateBookmark(filePath, id, { yRatio: ratio });
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
      <style>{`
        .epub-chapter-content img { max-width: 100%; height: auto; }
        .epub-chapter-content p { margin: 0 0 1em; }
        .epub-chapter-content h1, .epub-chapter-content h2, .epub-chapter-content h3, .epub-chapter-content h4 { line-height: 1.4; margin: 0.8em 0 0.5em; }
        .epub-chapter-content a { color: #22d3ee; }
        .epub-chapter-content table { max-width: 100%; border-collapse: collapse; }
        @keyframes epub-flip-next { from { opacity: 0; transform: translate3d(-32px, 0, 0) scale(0.97); } to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); } }
        @keyframes epub-flip-prev { from { opacity: 0; transform: translate3d(32px, 0, 0) scale(0.97); } to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); } }
        .epub-dock-gear { display: flex; transition: transform 0.4s ease; }
        .epub-dock-btn:hover .epub-dock-gear { transform: rotate(90deg); }
      `}</style>

      <AnnotationToolbar
        activePage={chapterIndex + 1}
        pageItemCount={currentChapterAnnotations.length}
        canUndo={(undoStacks[String(chapterIndex + 1)] || []).length > 0}
        canRedo={(redoStacks[String(chapterIndex + 1)] || []).length > 0}
        onUndo={handleUndoAnnotation}
        onRedo={handleRedoAnnotation}
        onClearPage={handleClearChapterAnnotations}
        isExportingPdf={false}
        pdfSaveState="idle"
      />

      {/* مرحلهٔ ۳۹ §۴: داکِ عمودیِ تاشو و شناورِ EPUB — در حالتِ بسته،
          کلِ پنل در یک دکمهٔ کوچکِ ۴۲ پیکسلی خلاصه می‌شود تا تمرکزِ
          مطالعه حفظ شود. */}
      {!dockMounted && (
        <button
          className="epub-dock-btn"
          type="button"
          onClick={handleDockButtonClick}
          onMouseDown={(e) => startDockDrag(e, 42)}
          title="تنظیماتِ مطالعه و فهرستِ فصل‌ها"
          style={{
            position: 'absolute', top: dockPos.y, left: dockPos.x, zIndex: 45,
            width: 42, height: 42, borderRadius: 12,
            background: 'rgba(13, 19, 26, 0.82)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid rgba(34, 211, 238, 0.35)',
            color: '#e2e8f0', cursor: isDockDragging ? 'grabbing' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Estedad', sans-serif", fontSize: 17, fontWeight: 700,
            boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
          }}
        >
          <span className="epub-dock-gear"><Icons.Settings size={20} /></span>
          <span style={{ position: 'absolute', top: -6, left: -6, minWidth: 18, height: 18, borderRadius: 9, background: '#22d3ee', color: '#0b1220', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', direction: 'ltr' }}>
            {chapterIndex + 1}
          </span>
        </button>
      )}
      {dockMounted && (
        <div
          dir="rtl"
          style={{
            position: 'absolute', top: dockPos.y, left: dockPos.x, zIndex: 45,
            width: 264, maxHeight: 'calc(100% - 110px)', overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 12,
            padding: 14, borderRadius: 16,
            background: 'rgba(13, 19, 26, 0.94)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(34, 211, 238, 0.3)',
            boxShadow: '0 12px 36px rgba(0,0,0,0.55)',
            opacity: dockOpen ? 1 : 0,
            transform: dockOpen ? 'scale(1) translateY(0)' : 'scale(0.94) translateY(-8px)',
            transformOrigin: 'top left',
            transition: 'all 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
            pointerEvents: dockOpen ? 'auto' : 'none',
          }}
        >
          <div
            onMouseDown={(e) => startDockDrag(e, 264)}
            title="برای جابه‌جاییِ پنل بکشید"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: isDockDragging ? 'grabbing' : 'grab', userSelect: 'none' }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>تنظیماتِ مطالعه</span>
            <button
              type="button"
              onClick={closeDock}
              title="جمع کردنِ پنل"
              style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" onClick={() => goToChapter(chapterIndex - 1)} disabled={chapterIndex <= 0} title="فصلِ قبلی" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, opacity: chapterIndex <= 0 ? 0.4 : 1 }}>
                <Icons.ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => goToChapter(chapterIndex + 1)} disabled={chapterIndex >= chapters.length - 1} title="فصلِ بعدی" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, opacity: chapterIndex >= chapters.length - 1 ? 0.4 : 1 }}>
                <Icons.ChevronLeft size={14} />
              </button>
              <button type="button" onClick={() => setTocOpen((v) => !v)} style={{ flex: 1, background: tocOpen ? 'rgba(34,211,238,0.16)' : 'rgba(255,255,255,0.06)', border: tocOpen ? '1px solid rgba(34,211,238,0.5)' : '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>
                فهرستِ فصل‌ها
              </button>
            </div>
            <span style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {chapter ? chapter.title : ''} · فصلِ {chapterIndex + 1} از {chapters.length}
            </span>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${chapters.length > 0 ? ((chapterIndex + 1) / chapters.length) * 100 : 0}%`, background: '#22d3ee', borderRadius: 3, transition: 'width 0.3s ease' }} />
            </div>
          </div>

          {tocOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                type="text"
                value={tocQuery}
                onChange={(e) => setTocQuery(e.target.value)}
                placeholder="جستجو در فصل‌ها…"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontFamily: 'inherit', fontSize: 12, padding: '7px 10px' }}
              />
              {book.coverUrl && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <img src={book.coverUrl} alt="" style={{ width: 44, height: 64, objectFit: 'cover', borderRadius: 6 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{book.title || 'بدونِ عنوان'}</div>
                    {book.creator && (<div style={{ fontSize: 11, color: 'var(--muted)' }}>{book.creator}</div>)}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                {tocFilteredChapters.map((ch) => {
                  const idx = chapters.indexOf(ch);
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => { goToChapter(idx); setTocOpen(false); }}
                      style={{
                        display: 'flex', gap: 8, alignItems: 'center', textAlign: 'right',
                        background: idx === chapterIndex ? 'rgba(34,211,238,0.12)' : 'transparent',
                        border: idx === chapterIndex ? '1px solid var(--accent)' : '1px solid transparent',
                        borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: idx === chapterIndex ? 'var(--accent)' : 'var(--text)',
                        fontFamily: 'inherit', fontSize: 12,
                      }}
                    >
                      <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 22 }}>{idx + 1}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title}</span>
                    </button>
                  );
                })}
                {tocFilteredChapters.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 4px' }}>فصلی با این نام پیدا نشد.</div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>اندازهٔ فونت</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" onClick={() => setFontSize((v) => Math.max(14, v - 2))} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 16 }}>−</button>
              <span style={{ flex: 1, textAlign: 'center', color: 'var(--text)', fontSize: 13 }}>{fontSize}</span>
              <button type="button" onClick={() => setFontSize((v) => Math.min(28, v + 2))} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 16 }}>+</button>
              <select value={fontId} onChange={(e) => setFontId(e.target.value)} style={{ background: 'var(--panel2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', fontFamily: 'inherit', fontSize: 12 }}>
                {FONT_OPTIONS.map((f) => (<option key={f.id} value={f.id}>{f.label}</option>))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>عرضِ ستونِ صفحه</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {Object.entries(COLUMN_WIDTHS).map(([id, w]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setColumnWidthId(id)}
                  style={{ flex: 1, background: columnWidthId === id ? 'rgba(34,211,238,0.16)' : 'rgba(255,255,255,0.06)', border: columnWidthId === id ? '1px solid rgba(34,211,238,0.5)' : '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 4px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11 }}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ترازبندیِ متن</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {Object.entries(TEXT_ALIGNS).map(([id, a]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTextAlignId(id)}
                  style={{ flex: 1, background: textAlignId === id ? 'rgba(34,211,238,0.16)' : 'rgba(255,255,255,0.06)', border: textAlignId === id ? '1px solid rgba(34,211,238,0.5)' : '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 4px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11 }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>فاصلهٔ خطوط</span>
            <select value={lineHeight} onChange={(e) => setLineHeight(Number(e.target.value))} style={{ background: 'var(--panel2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', fontFamily: 'inherit', fontSize: 12 }}>
              {LINE_HEIGHTS.map((lh) => (<option key={lh} value={lh}>{lh}</option>))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>تمِ کاغذ</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries(THEMES).map(([id, t]) => (
                <button
                  key={id}
                  type="button"
                  title={t.name}
                  onClick={() => setThemeId(id)}
                  style={{ flex: 1, height: 28, borderRadius: 8, background: t.paper, border: themeId === id ? '2px solid #22d3ee' : '1px solid rgba(255,255,255,0.3)', cursor: 'pointer', padding: 0 }}
                />
              ))}
            </div>
            <span style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>{(THEMES[themeId] || THEMES.light).name}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>حالتِ نمایش</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={() => { if (typeof setEpubViewMode === 'function') setEpubViewMode('vertical'); }}
                style={{ flex: 1, background: epubViewMode === 'vertical' ? 'rgba(34,211,238,0.16)' : 'rgba(255,255,255,0.06)', border: epubViewMode === 'vertical' ? '1px solid rgba(34,211,238,0.5)' : '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 4px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11 }}
              >
                عمودی
              </button>
              <button
                type="button"
                onClick={() => { if (typeof setEpubViewMode === 'function') setEpubViewMode('horizontal-paged'); }}
                style={{ flex: 1, background: epubViewMode === 'horizontal-paged' ? 'rgba(34,211,238,0.16)' : 'rgba(255,255,255,0.06)', border: epubViewMode === 'horizontal-paged' ? '1px solid rgba(34,211,238,0.5)' : '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 4px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11 }}
              >
                افقیِ صفحه‌ای
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button type="button" onClick={handleAddBookmark} title="افزودن بوک‌مارک در همین‌جا" style={{ height: '38px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '0 10px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>
              <Icons.Bookmark size={14} />
              بوک‌مارک
            </button>
            <button type="button" onClick={() => { setEpubSearchOpen(true); setTimeout(() => { if (epubSearchInputRef.current) epubSearchInputRef.current.focus(); }, 0); }} title="جستجویِ درون‌متنِ کتاب (Ctrl+F)" style={{ height: '38px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '0 10px', background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.4)', color: '#67e8f9', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>
              <Icons.Search size={14} />
              جستجو
            </button>
          </div>
          <span style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
              {`هایلایت‌هایِ این فصل: ${chapterHighlightCount}`}
            </span>
        </div>
      )}

      {/* مرحلهٔ ۳۹ §۶: نوارِ شناورِ جستجویِ درون‌متنِ EPUB (Ctrl+F) — فصلِ جاری + همهٔ فصل‌ها. */}
      {epubSearchOpen && (
        <div style={{ position: 'absolute', top: isAnnotationActive ? 132 : 64, left: '50%', transform: 'translateX(-50%)', zIndex: 60, display: 'flex', flexDirection: 'column', gap: 6, width: 460, maxWidth: 'calc(100vw - 32px)', background: 'rgba(13,19,26,0.95)', border: '1px solid rgba(34,211,238,0.35)', borderRadius: 12, padding: '8px 10px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} dir="rtl">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--muted)', display: 'flex' }}>
              <Icons.Search size={16} />
            </span>
            <input
              ref={epubSearchInputRef}
              type="text"
              value={epubSearchQuery}
              onChange={(e) => setEpubSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (epubSearchResults.length > 0) jumpToEpubSearchResult(epubSearchResults[0]);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setEpubSearchOpen(false);
                }
              }}
              placeholder="جستجو در این کتاب…"
              dir="auto"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 13.5, fontFamily: 'inherit', padding: '4px 2px' }}
            />
            <span style={{ display: 'flex', alignItems: 'center', gap: 2 }} dir="ltr">
              <button
                type="button"
                title="فقط کلمهٔ کامل (پیش‌فرض روشن) — ear را داخلِ near پیدا نمی‌کند"
                aria-pressed={epubSearchOptions.wholeWord}
                onClick={() => setEpubSearchOptions((o) => ({ ...o, wholeWord: !o.wholeWord }))}
                style={{ minWidth: 26, fontSize: 12, fontWeight: 800, fontFamily: 'inherit', border: epubSearchOptions.wholeWord ? '1px solid rgba(34,211,238,0.6)' : '1px solid transparent', backgroundColor: epubSearchOptions.wholeWord ? 'rgba(34,211,238,0.18)' : 'transparent', color: epubSearchOptions.wholeWord ? '#67e8f9' : 'var(--muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
              >
                W
              </button>
              <button
                type="button"
                title="حساس به حروفِ بزرگ و کوچک"
                aria-pressed={epubSearchOptions.caseSensitive}
                onClick={() => setEpubSearchOptions((o) => ({ ...o, caseSensitive: !o.caseSensitive }))}
                style={{ minWidth: 26, fontSize: 12, fontWeight: 800, fontFamily: 'inherit', border: epubSearchOptions.caseSensitive ? '1px solid rgba(34,211,238,0.6)' : '1px solid transparent', backgroundColor: epubSearchOptions.caseSensitive ? 'rgba(34,211,238,0.18)' : 'transparent', color: epubSearchOptions.caseSensitive ? '#67e8f9' : 'var(--muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
              >
                Aa
              </button>
              <button
                type="button"
                title="جستجویِ هوشمندِ پیشوندی/فازی — وقتی املایِ دقیق را نمی‌دانید"
                aria-pressed={epubSearchOptions.prefix}
                onClick={() => setEpubSearchOptions((o) => ({ ...o, prefix: !o.prefix }))}
                style={{ minWidth: 26, fontSize: 12, fontWeight: 800, fontFamily: 'inherit', border: epubSearchOptions.prefix ? '1px solid rgba(34,211,238,0.6)' : '1px solid transparent', backgroundColor: epubSearchOptions.prefix ? 'rgba(34,211,238,0.18)' : 'transparent', color: epubSearchOptions.prefix ? '#67e8f9' : 'var(--muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
              >
                {'\u2248'}
              </button>
            </span>
            <button
              type="button"
              title="بستن (Escape)"
              onClick={() => setEpubSearchOpen(false)}
              style={{ backgroundColor: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
            >
              <Icons.X size={16} />
            </button>
          </div>
          {epubSearchScanning && (
            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '2px 4px' }}>در حالِ جستجو در فصل‌ها…</div>
          )}
          {epubSearchResults.length > 0 && (
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {epubSearchResults.map((r) => (
                <button
                  key={r.chapterIndex}
                  type="button"
                  onClick={() => jumpToEpubSearchResult(r)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, background: 'rgba(255,255,255,0.04)', border: '1px solid transparent', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'right', color: 'var(--text)' }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{`${r.title} — ${r.count} نتیجه`}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{r.snippet}</span>
                </button>
              ))}
            </div>
          )}
          {epubSearchQuery.trim() && !epubSearchScanning && epubSearchResults.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '2px 4px' }}>یافت نشد</div>
          )}
        </div>
      )}

      {/* برگهٔ فصل */}
      {/* مرحلهٔ ۴۱ §۲: نشانگرِ نرمِ انتقالِ فصل با اسکرول. */}
      {chapterTransitionNotice && (
        <div style={{ position: 'absolute', top: 76, left: '50%', transform: 'translateX(-50%)', zIndex: 55, background: 'rgba(13, 19, 26, 0.9)', border: '1px solid rgba(34, 211, 238, 0.35)', color: '#e2e8f0', borderRadius: 999, padding: '6px 14px', fontSize: 12.5, boxShadow: '0 4px 16px rgba(0,0,0,0.45)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {chapterTransitionNotice}
        </div>
      )}
      <div ref={contentRef} data-reader-scroll-container="true" onWheel={handleContentWheel} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '28px 80px 24px', direction: 'rtl', background: readerBackdropColor }}>
        {chapterLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 32 }}>در حالِ بارگذاریِ فصل…</div>
        ) : (
          <div data-bookmark-page={chapterIndex + 1} style={{ position: 'relative', maxWidth: effectiveMaxWidth, margin: '0 auto', background: theme.paper, color: theme.text, borderRadius: 12, padding: '32px 36px', boxShadow: '0 8px 32px rgba(0,0,0,0.35)', animation: flipDirection === 1 ? 'epub-flip-next 340ms cubic-bezier(0.22, 1, 0.36, 1)' : flipDirection === -1 ? 'epub-flip-prev 340ms cubic-bezier(0.22, 1, 0.36, 1)' : undefined, willChange: 'transform, opacity' }}>
            <div
              ref={chapterElRef}
              className="epub-chapter-content"
              onMouseUp={handleContentMouseUp}
              onClick={handleContentClick}
              style={{ fontSize: effectiveFontSize, fontFamily, lineHeight, wordBreak: 'break-word', textAlign: textAlignId === 'justify' ? 'justify' : 'right' }}
              dangerouslySetInnerHTML={{ __html: chapterHtml }}
            />
            {shouldMountAnnotationLayer && (
              <AnnotationLayer
                pageNumber={chapterIndex + 1}
                items={currentChapterAnnotations}
                onCommitPageItems={handleCommitPageAnnotations}
                rotation={0}
                isNearViewport
                zoomLevel={safeZoom}
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
                  onMoveBookmark={handleMoveBookmark}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* مرحلهٔ ۳۷ §۳: نشانگرِ شناورِ «صفحهٔ X از Y» در پایین-راستِ
          محیطِ مطالعه — بدونِ هیچ تغییری در RightPanel. */}
      {chapters.length > 0 && (
        <div
          onClick={() => { if (!isEditingPageHud) { setPageHudDraft(String(chapterIndex + 1)); setIsEditingPageHud(true); } }}
          onMouseEnter={() => setPageHudHovered(true)}
          onMouseLeave={() => setPageHudHovered(false)}
          title="برای رفتن به صفحهٔ دلخواه کلیک کنید"
          style={{ position: 'absolute', bottom: '18px', right: isRightSidebarOpen ? '342px' : '22px', zIndex: 35, background: 'rgba(13, 19, 26, 0.86)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: pageHudHovered || isEditingPageHud ? '1px solid rgba(34, 211, 238, 0.7)' : '1px solid rgba(34, 211, 238, 0.25)', borderRadius: '10px', padding: '6px 14px', color: '#e2e8f0', fontSize: '12.5px', fontWeight: 700, direction: 'rtl', pointerEvents: 'auto', cursor: isEditingPageHud ? 'default' : 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.4)', transition: 'right 0.25s ease, border-color 0.2s ease', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          {chapters.length > 1 && (
            <button
              type="button"
              title="فصلِ قبلی"
              disabled={chapterIndex <= 0}
              onClick={(e) => { e.stopPropagation(); programmaticScrollUntilRef.current = Date.now() + 500; goToChapter(chapterIndex - 1); }}
              style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', cursor: chapterIndex <= 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0, opacity: chapterIndex <= 0 ? 0.35 : 1 }}
            >
              <Icons.ChevronRight size={16} />
            </button>
          )}
          {isEditingPageHud ? (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="number"
                min={1}
                max={chapters.length}
                value={pageHudDraft}
                autoFocus
                onFocus={(e) => e.target.select()}
                onChange={(e) => setPageHudDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitHudJump();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsEditingPageHud(false);
                  }
                }}
                onBlur={() => setIsEditingPageHud(false)}
                style={{ width: 58, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(34,211,238,0.6)', borderRadius: 6, color: '#e2e8f0', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '2px 6px', textAlign: 'center', direction: 'ltr' }}
              />
              <span>{`از ${chapters.length}`}</span>
              <button
                type="button"
                title="رفتن"
                onMouseDown={(e) => { e.preventDefault(); commitHudJump(); }}
                style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(34,211,238,0.18)', border: '1px solid rgba(34,211,238,0.5)', color: '#67e8f9', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', pointerEvents: 'none' }}><polyline points="20 6 9 17 4 12" /></svg>
              </button>
            </span>
          ) : (
            `فصل ${chapterIndex + 1} از ${chapters.length}`
          )}
          {chapters.length > 1 && (
            <button
              type="button"
              title="فصلِ بعدی"
              disabled={chapterIndex >= chapters.length - 1}
              onClick={(e) => { e.stopPropagation(); programmaticScrollUntilRef.current = Date.now() + 500; goToChapter(chapterIndex + 1); }}
              style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', cursor: chapterIndex >= chapters.length - 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0, opacity: chapterIndex >= chapters.length - 1 ? 0.35 : 1 }}
            >
              <Icons.ChevronLeft size={16} />
            </button>
          )}
        </div>
      )}
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
          {favoriteColors.length > 0 && (
            <span style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />
          )}
          {favoriteColors.slice(0, 6).map((hex) => (
            <button
              key={hex}
              type="button"
              title={`هایلایت با رنگِ موردِ علاقه ${hex}`}
              onClick={() => addHighlight(hex)}
              style={{ width: 18, height: 18, borderRadius: '50%', background: hex, border: '2px solid rgba(255,255,255,0.7)', cursor: 'pointer', padding: 0, flexShrink: 0 }}
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
            {HL_COLORS.map((c) => {
              // مرحلهٔ ۳۸ §۵: رنگِ فعلیِ همین هایلایت تیره + تیک می‌گیرد.
              const isCurrent = (highlights.find((h) => h.id === markMenu.id) || {}).color === c.bg;
              return (
                <button
                  key={c.id}
                  type="button"
                  title={`تغییر به ${c.label}`}
                  onClick={() => { updateHighlight(markMenu.id, { color: c.bg }); setMarkMenu(null); }}
                  style={{ width: 22, height: 22, borderRadius: '50%', background: c.bg, border: '2px solid rgba(255,255,255,0.7)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: isCurrent ? 'inset 0 0 0 999px rgba(0, 0, 0, 0.35), 0 0 0 2px #ffffff, 0 0 10px ' + c.bg : 'none' }}
                >
                  {isCurrent && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))', pointerEvents: 'none' }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          {favoriteColors.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {favoriteColors.slice(0, 8).map((hex) => {
                const isCurrentFav = (highlights.find((h) => h.id === markMenu.id) || {}).color === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    title={`تغییر به رنگِ موردِ علاقه ${hex}`}
                    onClick={() => { updateHighlight(markMenu.id, { color: hex }); setMarkMenu(null); }}
                    style={{ width: 22, height: 22, borderRadius: '50%', background: hex, border: '2px solid rgba(255,255,255,0.7)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: isCurrentFav ? 'inset 0 0 0 999px rgba(0, 0, 0, 0.35), 0 0 0 2px #ffffff, 0 0 10px ' + hex : 'none' }}
                  >
                    {isCurrentFav && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))', pointerEvents: 'none' }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
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
