import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import useAppStore from '../../store/useAppStore';
import useReaderStore from '../../store/useReaderStore';

import { AnnotationToolbar } from './AnnotationToolbar';
import {
  VIEWBOX_SIZE,
  clientToSvgPoint,
  generateCloudPath,
  generateArrowGeometry,
  pointsToSmoothSvgPath,
  getItemBounds,
  hitTestAnnotationItem,
  findTopAnnotationAtPoint,
  moveAnnotationByDelta,
  resizeAnnotationWithHandle,
  penPointsToOutlinePath,
  generateCurvedArrowGeometry,
  defaultCurveControl,
  storageToUniformItem,
  uniformToStorageItem,
} from '../../utils/annotationEngine';

// بازصادر کردن نوار ابزار برای سازگاری کامل با ایمپورت‌های PdfViewer و VerticalViewer
export { AnnotationToolbar };

// نرمالایز + تبدیل دیتابیس→یکنواخت (y در [0..1000*aspect])؛ فرمت DB دست نمی‌خورد
const normalizeItem = (raw, aspect = 1) => {
  if (!raw) return null;
  const tool = raw.tool || raw.type || 'box';
  const base = {
    ...raw,
    tool: tool === 'rect' ? 'box' : tool === 'note' ? 'sticky' : tool,
    boxStyle: raw.boxStyle || (raw.type === 'rect' ? 'rect' : 'cloud'),
    hasFill: typeof raw.hasFill === 'boolean' ? raw.hasFill : true,
    color: raw.color || '#06b6d4',
    strokeWidth: Number(raw.strokeWidth) || 4,
    opacity: typeof raw.opacity === 'number' ? raw.opacity : 0.85,
    arrowStyle: raw.arrowStyle === 'curved' ? 'curved' : 'straight',
    fontFamily: raw.fontFamily || null,
  };
  return storageToUniformItem(base, aspect);
};

const AnnotationLayer = React.memo(function AnnotationLayer({
  pageNumber,
  items = [],
  onCommitPageItems,
}) {
  const isAnnotationActive = useAppStore((state) => Boolean(state.isAnnotationActive));
  const annotationTool = useAppStore((state) => state.annotationTool || 'box');
  const annotationBoxStyle = useAppStore((state) => state.annotationBoxStyle || 'cloud');
  const annotationHasFill = useAppStore((state) => Boolean(state.annotationHasFill));
  const annotationColor = useAppStore((state) => state.annotationColor || '#06b6d4');
  const annotationStrokeWidth = useAppStore((state) => state.annotationStrokeWidth || 4);
  const annotationOpacity = useAppStore((state) => state.annotationOpacity ?? 0.85);
  const annotationFontFamily = useAppStore((state) => state.annotationFontFamily);
  const annotationFontSize = useAppStore((state) => state.annotationFontSize ?? 22);
  const annotationArrowStyle = useAppStore((state) => state.annotationArrowStyle || 'straight');

  const selectedAnnotationId = useAppStore((state) => state.selectedAnnotationId);
  const selectedAnnotationPage = useAppStore((state) => state.selectedAnnotationPage);
  const setSelectedAnnotation = useAppStore((state) => state.setSelectedAnnotation);
  const syncToolbarWithSelectedItem = useAppStore((state) => state.syncToolbarWithSelectedItem);
  const setAnnotationTool = useAppStore((state) => state.setAnnotationTool);

  const [draftShape, setDraftShape] = useState(null);
  const [liveItemsOverride, setLiveItemsOverride] = useState(null);
  const [textEditorState, setTextEditorState] = useState(null); // { x, y, value, editId, fontSize, color }
  const [stickyDrafts, setStickyDrafts] = useState({}); // متن تایپ‌شده ولی هنوز کامیت‌نشده
  const stickyTimers = useRef({});
  const stickyDraftsRef = useRef({});
  const itemsRef = useRef([]);

  // کامیت debounceشده متن استیکی: هر کلید = رندر محلی، ذخیره DB هر ۶۰۰ms یا با blur
  const flushStickyDraft = useCallback((id) => {
    const t = stickyTimers.current[id];
    if (t) { clearTimeout(t); delete stickyTimers.current[id]; }
    if (!(id in stickyDraftsRef.current)) return;
    const val = stickyDraftsRef.current[id];
    delete stickyDraftsRef.current[id];
    setStickyDrafts((prev) => { const n = { ...prev }; delete n[id]; return n; });
    const list = itemsRef.current.map((i) => (i.id === id ? { ...i, text: val } : i));
    const storageList = (list || []).map((it) => uniformToStorageItem(it, pageAspectRef.current));
    commitItems(storageList);
  }, [pageNumber, onCommitPageItems]);

  const handleStickyTextChange = useCallback((id, val) => {
    stickyDraftsRef.current[id] = val;
    setStickyDrafts((prev) => ({ ...prev, [id]: val }));
    const t = stickyTimers.current[id];
    if (t) clearTimeout(t);
    stickyTimers.current[id] = setTimeout(() => flushStickyDraft(id), 600);
  }, [flushStickyDraft]);

  useEffect(() => () => { Object.values(stickyTimers.current).forEach(clearTimeout); }, []);

  const wrapperRef = useRef(null);
  // نسبت ارتفاع به عرض صفحه — مبنای مختصات یکنواخت تطبیقی
  const [pageAspect, setPageAspect] = useState(1);
  const pageAspectRef = useRef(1);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => {
      let r = 0;
      const img = el.parentElement?.querySelector('img');
      if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
        r = img.naturalHeight / img.naturalWidth;
      } else {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) r = rect.height / rect.width;
      }
      if (r >= 0.05 && r <= 20) {
        pageAspectRef.current = r;
        setPageAspect((prev) => (Math.abs(prev - r) < 0.001 ? prev : r));
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const img = el.parentElement?.querySelector('img');
    if (img) img.addEventListener('load', update);
    return () => {
      ro.disconnect();
      if (img) img.removeEventListener('load', update);
    };
  }, []);

  // لاگ تشخیصی برای بررسی لود perfect-freehand (DevTools → Console)
  useEffect(() => {
    try {
      const probe = penPointsToOutlinePath([{ x: 0, y: 0 }, { x: 10, y: 10 }], 4);
      console.info('[annotation] perfect-freehand:', probe ? 'OK (' + probe.outline.length + ' pts)' : 'FALLBACK (smooth path)');
    } catch (err) {
      console.warn('[annotation] perfect-freehand probe failed:', err?.message);
    }
  }, []);
  const interactionRef = useRef({
    mode: null, // 'draw' | 'move' | 'resize' | 'erase_sweep'
    handle: null,
    startPt: null,
    originalItem: null,
    workingItems: null,
  });
  const draftRef = useRef(null);
  const textAreaRef = useRef(null);

  const normalizedItems = useMemo(() => {
    const source = liveItemsOverride || items || [];
    return source.map((it) => normalizeItem(it, pageAspect)).filter(Boolean);
  }, [items, liveItemsOverride, pageAspect]);
  itemsRef.current = normalizedItems;

  const isSelectedOnThisPage =
    isAnnotationActive &&
    selectedAnnotationPage === pageNumber &&
    Boolean(selectedAnnotationId);

  const selectedItem = useMemo(() => {
    if (!isSelectedOnThisPage) return null;
    return normalizedItems.find((it) => it.id === selectedAnnotationId) || null;
  }, [isSelectedOnThisPage, normalizedItems, selectedAnnotationId]);

  useEffect(() => {
    setLiveItemsOverride(null);
  }, [items]);

  useEffect(() => {
    if (textEditorState && textAreaRef.current) {
      textAreaRef.current.focus();
    }
  }, [textEditorState]);

  // کامیت یکپارچه: تبدیل مختصات یکنواخت به فرمت دیتابیس، بعد ارسال به والد
  const commitItems = useCallback((list) => {
    const storageList = (list || []).map((it) => uniformToStorageItem(it, pageAspectRef.current));
    onCommitPageItems?.(pageNumber, storageList);
  }, [onCommitPageItems, pageNumber]);

  // ۱. دریافت تغییرات زنده رنگ، ضخامت، شفافیت و نوع کادر از AnnotationToolbar برای شکل انتخاب‌شده
  useEffect(() => {
    if (!isSelectedOnThisPage || !selectedAnnotationId) return;

    const handleUpdateSelected = (e) => {
      const patch = e.detail;
      if (!patch) return;

      const updatedList = normalizedItems.map((it) => {
        if (it.id !== selectedAnnotationId) return it;
        const next = { ...it, ...patch };
        if (it.tool === 'text' && patch.strokeWidth) {
          next.fontSize = Math.max(14, patch.strokeWidth * 5);
        }
        return next;
      });

      commitItems(updatedList);
    };

    window.addEventListener('annotation:update-selected', handleUpdateSelected);
    return () => window.removeEventListener('annotation:update-selected', handleUpdateSelected);
  }, [isSelectedOnThisPage, selectedAnnotationId, normalizedItems, pageNumber, onCommitPageItems]);

  // ۲. درج تصویر از طریق دکمه نوار ابزار یا پیست از کلیپ‌بورد (Ctrl + V) در صفحه فعال
  const insertImageItem = useCallback(
    (dataUrl) => {
      if (!dataUrl) return;
      const newImg = {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tool: 'image',
        dataUrl,
        startX: 220,
        startY: 220,
        endX: 620,
        endY: 520,
        color: annotationColor,
        strokeWidth: annotationStrokeWidth,
        opacity: annotationOpacity,
      };
      const next = [...normalizedItems, newImg];
      commitItems(next);
      setAnnotationTool('select');
      setSelectedAnnotation(newImg.id, pageNumber, 'image');
    },
    [
      annotationColor,
      annotationStrokeWidth,
      annotationOpacity,
      normalizedItems,
      pageNumber,
      onCommitPageItems,
      setAnnotationTool,
      setSelectedAnnotation,
    ]
  );

  useEffect(() => {
    if (!isAnnotationActive) return;

    const handleInsertEvent = (e) => {
      if (e.detail?.pageNumber === pageNumber && e.detail?.dataUrl) {
        insertImageItem(e.detail.dataUrl);
      }
    };

    const handlePasteImage = (e) => {
      const currentActivePage = useReaderStore.getState().currentPage || 1;
      if (currentActivePage !== pageNumber) return;

      const clipItems = e.clipboardData?.items;
      if (!clipItems) return;

      for (const item of clipItems) {
        if (item.type.indexOf('image') !== -1) {
          const blob = item.getAsFile();
          if (!blob) continue;
          const reader = new FileReader();
          reader.onload = (ev) => {
            if (typeof ev.target?.result === 'string') {
              insertImageItem(ev.target.result);
            }
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    };

    window.addEventListener('annotation:insert-image', handleInsertEvent);
    window.addEventListener('paste', handlePasteImage);
    return () => {
      window.removeEventListener('annotation:insert-image', handleInsertEvent);
      window.removeEventListener('paste', handlePasteImage);
    };
  }, [isAnnotationActive, pageNumber, insertImageItem]);

  // ۳. اکشن‌های شکل انتخاب‌شده (حذف، تکثیر، تغییر لایه و جابه‌جایی با کیبورد)
  const handleDeleteSelected = useCallback(() => {
    if (!selectedItem) return;
    const next = normalizedItems.filter((it) => it.id !== selectedItem.id);
    setSelectedAnnotation(null, null);
    commitItems(next);
  }, [selectedItem, normalizedItems, pageNumber, onCommitPageItems, setSelectedAnnotation]);

  const handleDuplicateSelected = useCallback(() => {
    if (!selectedItem) return;
    const cloned = JSON.parse(JSON.stringify(selectedItem));
    cloned.id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const shifted = moveAnnotationByDelta(cloned, cloned, 28, 28);
    const next = [...normalizedItems, shifted];
    commitItems(next);
    setSelectedAnnotation(shifted.id, pageNumber, shifted.tool);
  }, [selectedItem, normalizedItems, pageNumber, onCommitPageItems, setSelectedAnnotation]);

  const handleMoveLayer = useCallback(
    (dir) => {
      if (!selectedItem) return;
      const idx = normalizedItems.findIndex((it) => it.id === selectedItem.id);
      if (idx < 0) return;
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= normalizedItems.length) return;

      const copy = [...normalizedItems];
      const temp = copy[idx];
      copy[idx] = copy[targetIdx];
      copy[targetIdx] = temp;
      commitItems(copy);
    },
    [selectedItem, normalizedItems, pageNumber, onCommitPageItems]
  );

  useEffect(() => {
    if (!isSelectedOnThisPage || !selectedItem) return;

    const handleKeyDown = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        handleDeleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        e.stopPropagation();
        handleDuplicateSelected();
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        const step = e.shiftKey ? 12 : 2;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;

        const moved = moveAnnotationByDelta(selectedItem, selectedItem, dx, dy);
        const next = normalizedItems.map((it) => (it.id === moved.id ? moved : it));
        commitItems(next);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    isSelectedOnThisPage,
    selectedItem,
    normalizedItems,
    pageNumber,
    onCommitPageItems,
    handleDeleteSelected,
    handleDuplicateSelected,
  ]);

  const getSvgCoords = useCallback((clientX, clientY) => {
    const el = wrapperRef.current;
    if (!el) return { x: 0, y: 0 };
    return clientToSvgPoint(clientX, clientY, el.getBoundingClientRect(), pageAspectRef.current);
  }, []);

  // ۴. پاک‌کن جارویی و کلیکی بدون مسدود شدن توسط PointerCapture
  const sweepEraseAtPoint = useCallback(
    (pt) => {
      const currentList = interactionRef.current.workingItems || normalizedItems;
      const remaining = currentList.filter((it) => !hitTestAnnotationItem(it, pt, 16));

      if (remaining.length !== currentList.length) {
        interactionRef.current.workingItems = remaining;
        setLiveItemsOverride(remaining);
        if (selectedAnnotationId && !remaining.some((r) => r.id === selectedAnnotationId)) {
          setSelectedAnnotation(null, null);
        }
        commitItems(remaining);
      }
    },
    [normalizedItems, pageNumber, onCommitPageItems, selectedAnnotationId, setSelectedAnnotation]
  );

  // ۵. شروع تعامل ماوس (انتخاب، تغییر اندازه، پاک‌کن، متن، استیکی‌نوت یا رسم پیوسته)
  const handlePointerDown = (e) => {
    if (!isAnnotationActive || e.button !== 0) return;
    if (textEditorState) return;

    e.stopPropagation();
    const pt = getSvgCoords(e.clientX, e.clientY);

    // الف: کلیک روی هندل‌های تغییر سایز Gizmo
    const handleType = e.target?.dataset?.handle;
    if (handleType && selectedItem) {
      interactionRef.current = {
        mode: 'resize',
        handle: handleType,
        startPt: pt,
        originalItem: JSON.parse(JSON.stringify(selectedItem)),
        workingItems: normalizedItems,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (_) {}
      return;
    }

    // ب: حالت پاک‌کن (کلیکی و جارویی)
    if (annotationTool === 'eraser') {
      interactionRef.current = {
        mode: 'erase_sweep',
        handle: null,
        startPt: pt,
        originalItem: null,
        workingItems: normalizedItems,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (_) {}
      sweepEraseAtPoint(pt);
      return;
    }

    // ج: حالت انتخاب و ویرایش شکل (Select Tool)
    if (annotationTool === 'select') {
      const hitItem = findTopAnnotationAtPoint(normalizedItems, pt, 14);
      if (hitItem) {
        setSelectedAnnotation(hitItem.id, pageNumber, hitItem.tool);
        syncToolbarWithSelectedItem(hitItem);
        interactionRef.current = {
          mode: 'move',
          handle: null,
          startPt: pt,
          originalItem: JSON.parse(JSON.stringify(hitItem)),
          workingItems: normalizedItems,
        };
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch (_) {}
      } else {
        setSelectedAnnotation(null, null);
      }
      return;
    }

    // د: درج متن برداری روی صفحه
    if (annotationTool === 'text') {
      setTextEditorState({
        x: pt.x,
        y: pt.y,
        value: '',
        editId: null,
        fontSize: annotationFontSize,
        color: annotationColor,
        fontFamily: annotationFontFamily,
      });
      return;
    }

    // هـ: درج کارت استیکی‌نوت
    if (annotationTool === 'sticky') {
      const newSticky = {
        id: `sticky_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tool: 'sticky',
        x: Math.min(760, Math.max(20, pt.x - 90)),
        y: Math.min(800, Math.max(20, pt.y - 40)),
        width: 210,
        height: 170,
        color: annotationColor,
        opacity: annotationOpacity,
        text: '',
      };
      const next = [...normalizedItems, newSticky];
      commitItems(next);
      setAnnotationTool('select');
      setSelectedAnnotation(newSticky.id, pageNumber);
      return;
    }

    // و: رسم پیوسته کادر ابری/مستطیل، هایلایت، قلم نرم یا فلش
    interactionRef.current = {
      mode: 'draw',
      handle: null,
      startPt: pt,
      originalItem: null,
      workingItems: normalizedItems,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}

    const newDraft = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tool: annotationTool,
      arrowStyle: annotationTool === 'arrow' ? annotationArrowStyle : 'straight',
      boxStyle: annotationBoxStyle,
      hasFill: annotationHasFill,
      color: annotationColor,
      strokeWidth: annotationStrokeWidth,
      opacity: annotationOpacity,
      startX: pt.x,
      startY: pt.y,
      endX: pt.x,
      endY: pt.y,
      points: [pt],
    };

    draftRef.current = newDraft;
    setDraftShape(newDraft);
  };

  // ۶. حرکت ماوس (پاک‌کن جارویی، تغییر سایز، جابه‌جایی یا رسم زنده)
  const handlePointerMove = (e) => {
    const mode = interactionRef.current.mode;
    if (!mode || !isAnnotationActive) return;

    const pt = getSvgCoords(e.clientX, e.clientY);

    if (mode === 'erase_sweep') {
      sweepEraseAtPoint(pt);
      return;
    }

    if (mode === 'resize' && selectedAnnotationId && interactionRef.current.originalItem) {
      const resized = resizeAnnotationWithHandle(
        selectedItem || interactionRef.current.originalItem,
        interactionRef.current.handle,
        pt,
        interactionRef.current.originalItem
      );
      const nextList = normalizedItems.map((it) =>
        it.id === selectedAnnotationId ? resized : it
      );
      interactionRef.current.workingItems = nextList;
      setLiveItemsOverride(nextList);
      return;
    }

    if (mode === 'move' && selectedAnnotationId && interactionRef.current.originalItem) {
      const dx = pt.x - interactionRef.current.startPt.x;
      const dy = pt.y - interactionRef.current.startPt.y;
      const moved = moveAnnotationByDelta(
        selectedItem || interactionRef.current.originalItem,
        interactionRef.current.originalItem,
        dx,
        dy
      );
      const nextList = normalizedItems.map((it) =>
        it.id === selectedAnnotationId ? moved : it
      );
      interactionRef.current.workingItems = nextList;
      setLiveItemsOverride(nextList);
      return;
    }

    if (mode === 'draw' && draftRef.current) {
      const currentDraft = draftRef.current;

      if (currentDraft.tool === 'highlighter' || currentDraft.tool === 'pen') {
        if (e.shiftKey && currentDraft.points.length > 0) {
          const p0 = currentDraft.points[0];
          const dx = Math.abs(pt.x - p0.x);
          const dy = Math.abs(pt.y - p0.y);
          const snapped = dx >= dy ? { x: pt.x, y: p0.y } : { x: p0.x, y: pt.y };
          const updated = { ...currentDraft, points: [p0, snapped] };
          draftRef.current = updated;
          setDraftShape(updated);
          return;
        }

        const lastPt = currentDraft.points[currentDraft.points.length - 1];
        if (Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y) < 2) return;

        const updated = {
          ...currentDraft,
          points: [...currentDraft.points, pt],
        };
        draftRef.current = updated;
        setDraftShape(updated);
      } else {
        let ex = pt.x;
        let ey = pt.y;
        if (e.shiftKey && currentDraft.tool === 'box') {
          const side = Math.max(
            Math.abs(pt.x - currentDraft.startX),
            Math.abs(pt.y - currentDraft.startY)
          );
          ex = currentDraft.startX + (pt.x >= currentDraft.startX ? side : -side);
          ey = currentDraft.startY + (pt.y >= currentDraft.startY ? side : -side);
        }
        const updated = { ...currentDraft, endX: ex, endY: ey };
        // پیش‌نمایش زنده خمیدگی برای فلش منحنی
        if (currentDraft.tool === 'arrow' && currentDraft.arrowStyle === 'curved') {
          const cc = defaultCurveControl(currentDraft.startX, currentDraft.startY, ex, ey);
          updated.cx = cc.x;
          updated.cy = cc.y;
        }
        draftRef.current = updated;
        setDraftShape(updated);
      }
    }
  };

  // ۷. پایان حرکت ماوس و ذخیره در دیتابیس (بدون خروج اجباری از ابزار رسم)
  const handlePointerUp = (e) => {
    const mode = interactionRef.current.mode;
    if (!mode) return;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}

    if ((mode === 'move' || mode === 'resize') && interactionRef.current.workingItems) {
      commitItems(interactionRef.current.workingItems);
    }

    if (mode === 'draw' && draftRef.current) {
      const finished = draftRef.current;
      draftRef.current = null;
      setDraftShape(null);

      const isValid =
        finished.tool === 'highlighter' || finished.tool === 'pen'
          ? finished.points.length >= 2
          : Math.hypot(finished.endX - finished.startX, finished.endY - finished.startY) >= 8;

      if (isValid) {
        const finalItem = { ...finished };
        if (finalItem.tool === 'arrow') {
          if (!finalItem.arrowStyle) finalItem.arrowStyle = annotationArrowStyle || 'straight';
          if (finalItem.arrowStyle === 'curved' && !Number.isFinite(finalItem.cx)) {
            const cc = defaultCurveControl(finalItem.startX, finalItem.startY, finalItem.endX, finalItem.endY);
            finalItem.cx = cc.x;
            finalItem.cy = cc.y;
          }
        }
        const next = [...normalizedItems, finalItem];
        commitItems(next);
      }
    }

    interactionRef.current = {
      mode: null,
      handle: null,
      startPt: null,
      originalItem: null,
      workingItems: null,
    };
  };

  // ۸. ثبت متن برداری
  const commitTextEditor = () => {
    if (!textEditorState) return;
    const clean = (textEditorState.value || '').trim();
    if (!clean) {
      setTextEditorState(null);
      return;
    }

    if (textEditorState.editId) {
      const next = normalizedItems.map((it) =>
        it.id === textEditorState.editId ? { ...it, text: clean } : it
      );
      commitItems(next);
    } else {
      const newText = {
        id: `txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tool: 'text',
        text: clean,
        startX: textEditorState.x,
        startY: textEditorState.y,
        color: textEditorState.color || annotationColor,
        fontFamily: textEditorState.fontFamily || annotationFontFamily,
        fontSize: textEditorState.fontSize || annotationFontSize,
        strokeWidth: annotationStrokeWidth,
        opacity: annotationOpacity,
      };
      const next = [...normalizedItems, newText];
      commitItems(next);
      setAnnotationTool('select');
      setSelectedAnnotation(newText.id, pageNumber, 'text');
    }

    setTextEditorState(null);
  };

  // ۹. رندر هر شکل برداری در بوم SVG
  const renderVectorShape = (item) => {
    if (!item || item.tool === 'sticky') return null;

    const strokeW = Number(item.strokeWidth) || 4;
    const opacity = typeof item.opacity === 'number' ? item.opacity : 0.85;
    const fillHex = item.hasFill ? item.color : 'none';
    const fillAlpha = item.hasFill ? Math.max(0.08, opacity * 0.18) : 0;

    // ۱. ماژیک هایلایت طبیعی با perfect-freehand و ترکیب رنگی Multiply
    if (item.tool === 'highlighter') {
      const hlOutline = penPointsToOutlinePath(item.points, strokeW, {
        thinning: 0,
        size: Math.max(10, strokeW * 4.4),
        smoothing: 0.7,
        streamline: 0.6,
      });
      const d = hlOutline ? hlOutline.path : pointsToSmoothSvgPath(item.points);
      return (
        <g key={item.id} data-id={item.id}>
          <path
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(22, strokeW * 5)}
          />
          {hlOutline ? (
            <path
              d={hlOutline.path}
              fill={item.color}
              opacity={opacity * 0.45}
              style={{ mixBlendMode: 'multiply' }}
            />
          ) : (
            <path
              d={d}
              fill="none"
              stroke={item.color}
              strokeWidth={strokeW * 4.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={opacity * 0.45}
              style={{ mixBlendMode: 'multiply' }}
            />
          )}
        </g>
      );
    }

    // ۲. قلم نرم آزاد — رندر پهنای متغیر با perfect-freehand
    if (item.tool === 'pen') {
      const outline = penPointsToOutlinePath(item.points, strokeW);
      const d = outline ? outline.path : pointsToSmoothSvgPath(item.points);
      return (
        <g key={item.id} data-id={item.id}>
          <path
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(18, strokeW + 12)}
          />
          {outline ? (
            <path d={outline.path} fill={item.color} opacity={opacity} />
          ) : (
            <path
              d={d}
              fill="none"
              stroke={item.color}
              strokeWidth={strokeW}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={opacity}
            />
          )}
        </g>
      );
    }

    // ۳. کادربندی (کادر ابری، مستطیل، گوشه گرد)
    if (item.tool === 'box') {
      const x = Math.min(item.startX, item.endX);
      const y = Math.min(item.startY, item.endY);
      const w = Math.max(2, Math.abs(item.endX - item.startX));
      const h = Math.max(2, Math.abs(item.endY - item.startY));

      return (
        <g key={item.id} data-id={item.id}>
          {/* ماسک نامرئی جهت انتخاب‌پذیری ۱۰۰٪ حتی در کادرهای توخالی */}
          <rect x={x} y={y} width={w} height={h} fill="rgba(0,0,0,0.001)" />
          {item.boxStyle === 'cloud' ? (
            <path
              d={generateCloudPath(item.startX, item.startY, item.endX, item.endY, strokeW)}
              fill={fillHex}
              fillOpacity={fillAlpha}
              stroke={item.color}
              strokeWidth={strokeW}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={opacity}
            />
          ) : (
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={item.boxStyle === 'round' ? 14 : 2}
              ry={item.boxStyle === 'round' ? 14 : 2}
              fill={fillHex}
              fillOpacity={fillAlpha}
              stroke={item.color}
              strokeWidth={strokeW}
              opacity={opacity}
            />
          )}
        </g>
      );
    }

    // ۴. فلش اشاره‌گر مهندسی (صاف یا منحنی ۳ نقطه‌ای)
    if (item.tool === 'arrow') {
      const isCurved =
        item.arrowStyle === 'curved' &&
        Number.isFinite(item.cx) &&
        Number.isFinite(item.cy);
      if (isCurved) {
        const cgeom = generateCurvedArrowGeometry(
          item.startX,
          item.startY,
          item.cx,
          item.cy,
          item.endX,
          item.endY,
          strokeW
        );
        return (
          <g key={item.id} data-id={item.id}>
            <path
              d={cgeom.shaftPath}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(20, strokeW + 14)}
            />
            <path
              d={cgeom.shaftPath}
              fill="none"
              stroke={item.color}
              strokeWidth={strokeW}
              strokeLinecap="round"
              opacity={opacity}
            />
            <polygon
              points={cgeom.headPoints}
              fill={item.color}
              opacity={opacity}
              strokeLinejoin="round"
            />
          </g>
        );
      }
      const geom = generateArrowGeometry(
        item.startX,
        item.startY,
        item.endX,
        item.endY,
        strokeW
      );
      return (
        <g key={item.id} data-id={item.id}>
          <line
            x1={item.startX}
            y1={item.startY}
            x2={item.endX}
            y2={item.endY}
            stroke="transparent"
            strokeWidth={Math.max(20, strokeW + 14)}
          />
          {geom.shaft && (
            <>
              <line
                x1={geom.shaft.x1}
                y1={geom.shaft.y1}
                x2={geom.shaft.x2}
                y2={geom.shaft.y2}
                stroke={item.color}
                strokeWidth={strokeW}
                strokeLinecap="round"
                opacity={opacity}
              />
              <polygon
                points={geom.headPoints}
                fill={item.color}
                opacity={opacity}
                strokeLinejoin="round"
              />
            </>
          )}
        </g>
      );
    }

    // ۵. تصویر درج‌شده روی صفحه
    if (item.tool === 'image' && item.dataUrl) {
      const x = Math.min(item.startX, item.endX);
      const y = Math.min(item.startY, item.endY);
      const w = Math.max(20, Math.abs(item.endX - item.startX));
      const h = Math.max(20, Math.abs(item.endY - item.startY));
      return (
        <g key={item.id} data-id={item.id}>
          <image
            href={item.dataUrl}
            x={x}
            y={y}
            width={w}
            height={h}
            preserveAspectRatio="none"
            opacity={opacity}
          />
        </g>
      );
    }

    // ۶. متن برداری روی صفحه (با قابلیت دوکلیک برای ویرایش مجدد)
    if (item.tool === 'text') {
      const fontSize = Math.max(14, Number(item.fontSize) || strokeW * 5 || 22);
      const lines = String(item.text || '').split('\n');
      const sx = Number(item.startX ?? item.x ?? 100);
      const sy = Number(item.startY ?? item.y ?? 100);
      const b = getItemBounds(item);

      return (
        <g
          key={item.id}
          data-id={item.id}
          onDoubleClick={(e) => {
            if (!isAnnotationActive) return;
            e.stopPropagation();
            setTextEditorState({
              x: sx,
              y: sy,
              value: item.text,
              editId: item.id,
              fontSize,
              color: item.color,
            });
          }}
        >
          <rect
            x={b.x}
            y={b.y}
            width={b.width}
            height={b.height}
            fill="rgba(0,0,0,0.001)"
          />
          <text
            x={sx}
            y={sy}
            fill={item.color}
            fontSize={fontSize}
            opacity={opacity}
            style={{
              fontFamily: item.fontFamily || 'var(--font-fa), sans-serif',
              fontWeight: 800,
              direction: 'rtl',
              userSelect: 'none',
            }}
          >
            {lines.map((lineText, idx) => (
              <tspan key={idx} x={sx} dy={idx === 0 ? 0 : '1.3em'}>
                {lineText}
              </tspan>
            ))}
          </text>
        </g>
      );
    }

    return null;
  };

  // ۱۰. رندر کادر انتخاب (Gizmo) با ۸ هندل تغییر سایز یا ۲ هندل سر و ته فلش
  const renderSelectionGizmo = () => {
    if (!selectedItem || annotationTool !== 'select') return null;

    if (selectedItem.tool === 'arrow') {
      const curveX = Number.isFinite(selectedItem.cx)
        ? selectedItem.cx
        : (selectedItem.startX + selectedItem.endX) / 2;
      const curveY = Number.isFinite(selectedItem.cy)
        ? selectedItem.cy
        : (selectedItem.startY + selectedItem.endY) / 2;
      return (
        <g>
          <line
            x1={selectedItem.startX}
            y1={selectedItem.startY}
            x2={selectedItem.endX}
            y2={selectedItem.endY}
            stroke="#22d3ee"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            pointerEvents="none"
          />
          <circle
            cx={selectedItem.startX}
            cy={selectedItem.startY}
            r="8"
            fill="#0a0f13"
            stroke="#22d3ee"
            strokeWidth="2.5"
            data-handle="tail"
            style={{ cursor: 'move' }}
          />
          <circle
            cx={selectedItem.endX}
            cy={selectedItem.endY}
            r="8"
            fill="#0a0f13"
            stroke="#22d3ee"
            strokeWidth="2.5"
            data-handle="head"
            style={{ cursor: 'move' }}
          />
          {/* هندل خمیدگی فلش منحنی — کشیدن آن فلش را خمیده می‌کند */}
          <rect
            x={curveX - 7}
            y={curveY - 7}
            width="14"
            height="14"
            rx="3"
            transform={`rotate(45 ${curveX} ${curveY})`}
            fill="#0a0f13"
            stroke="#facc15"
            strokeWidth="2.5"
            data-handle="curve"
            style={{ cursor: 'move' }}
          >
            <title>خمیدگی فلش</title>
          </rect>
        </g>
      );
    }

    const b = getItemBounds(selectedItem);
    const handles = [
      { id: 'nw', x: b.x, y: b.y, cursor: 'nwse-resize' },
      { id: 'n', x: b.x + b.width / 2, y: b.y, cursor: 'ns-resize' },
      { id: 'ne', x: b.x + b.width, y: b.y, cursor: 'nesw-resize' },
      { id: 'e', x: b.x + b.width, y: b.y + b.height / 2, cursor: 'ew-resize' },
      { id: 'se', x: b.x + b.width, y: b.y + b.height, cursor: 'nwse-resize' },
      { id: 's', x: b.x + b.width / 2, y: b.y + b.height, cursor: 'ns-resize' },
      { id: 'sw', x: b.x, y: b.y + b.height, cursor: 'nesw-resize' },
      { id: 'w', x: b.x, y: b.y + b.height / 2, cursor: 'ew-resize' },
    ];
    const hs = 11;

    return (
      <g>
        <rect
          x={b.x}
          y={b.y}
          width={b.width}
          height={b.height}
          fill="none"
          stroke="#22d3ee"
          strokeWidth="1.8"
          strokeDasharray="5 4"
          pointerEvents="none"
        />
        {handles.map((h) => (
          <rect
            key={h.id}
            x={h.x - hs / 2}
            y={h.y - hs / 2}
            width={hs}
            height={hs}
            rx="2.5"
            fill="#0a0f13"
            stroke="#22d3ee"
            strokeWidth="2"
            data-handle={h.id}
            style={{ cursor: h.cursor }}
          />
        ))}
      </g>
    );
  };

  const hasAnyContent =
    normalizedItems.length > 0 || Boolean(draftShape) || Boolean(textEditorState);
  if (!isAnnotationActive && !hasAnyContent) {
    return null;
  }

  const stickyItems = normalizedItems.filter((it) => it.tool === 'sticky');
  const selectedBounds = selectedItem ? getItemBounds(selectedItem) : null;

  return (
    <div
      ref={wrapperRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        ...styles.overlayRoot,
        pointerEvents: isAnnotationActive ? 'auto' : 'none',
        cursor: !isAnnotationActive
          ? 'default'
          : annotationTool === 'select'
          ? 'default'
          : annotationTool === 'eraser'
          ? 'cell'
          : annotationTool === 'text'
          ? 'text'
          : 'crosshair',
      }}
    >
      {/* ۱. لایه برداری SVG با مختصات نرمال‌شده 1000x1000 */}
      <svg
        viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE * pageAspect}`}
        preserveAspectRatio="none"
        style={styles.svgCanvas}
      >
        <g>{normalizedItems.map((it) => renderVectorShape(it))}</g>
        <g>{draftShape && renderVectorShape(draftShape)}</g>
        <g>{isSelectedOnThisPage && renderSelectionGizmo()}</g>
      </svg>

      {/* ۲. کارت‌های استیکی‌نوت روی صفحه */}
      {stickyItems.map((st) => {
        const leftPct = `${((st.x ?? 100) / 10).toFixed(2)}%`;
        const topPct = `${((st.y ?? 100) / (10 * pageAspect)).toFixed(2)}%`;
        const widthPct = `${((st.width || 210) / 10).toFixed(2)}%`;
        const heightPct = `${((st.height || 170) / (10 * pageAspect)).toFixed(2)}%`;

        return (
          <div
            key={st.id}
            style={{
              ...styles.stickyCard,
              left: leftPct,
              top: topPct,
              width: widthPct,
              height: heightPct,
              backgroundColor: st.color || '#fef08a',
              opacity: st.opacity ?? 0.95,
              pointerEvents: isAnnotationActive ? 'auto' : 'none',
            }}
            onPointerDown={(e) => {
              if (!isAnnotationActive) return;
              if (e.target.tagName === 'TEXTAREA') return;
              e.stopPropagation();

              if (annotationTool === 'eraser') {
                const next = normalizedItems.filter((i) => i.id !== st.id);
                commitItems(next);
                return;
              }

              setAnnotationTool('select');
              setSelectedAnnotation(st.id, pageNumber, 'sticky');
              syncToolbarWithSelectedItem(st);

              const pt = getSvgCoords(e.clientX, e.clientY);
              interactionRef.current = {
                mode: 'move',
                handle: null,
                startPt: pt,
                originalItem: JSON.parse(JSON.stringify(st)),
                workingItems: normalizedItems,
              };
              try {
                wrapperRef.current?.setPointerCapture(e.pointerId);
              } catch (_) {}
            }}
          >
            <div style={styles.stickyHeader}>
              <div style={styles.stickyPinDot} />
              <span style={styles.stickyHeaderTitle}>یادداشت</span>
              {isAnnotationActive && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = normalizedItems.filter((i) => i.id !== st.id);
                    if (selectedAnnotationId === st.id) setSelectedAnnotation(null, null);
                    commitItems(next);
                  }}
                  style={styles.stickyDeleteBtn}
                  title="حذف استیکی‌نوت"
                >
                  ×
                </button>
              )}
            </div>
            <textarea
              value={stickyDrafts[st.id] ?? st.text ?? ''}
              placeholder="نکته را بنویسید..."
              onChange={(e) => handleStickyTextChange(st.id, e.target.value)}
              onBlur={() => flushStickyDraft(st.id)}
              style={styles.stickyTextarea}
            />
          </div>
        );
      })}

      {/* ۳. مینی‌داک عملیاتی شناور بالای شکل انتخاب‌شده */}
      {isSelectedOnThisPage && selectedBounds && annotationTool === 'select' && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            ...styles.contextPillMenu,
            left: `${Math.min(88, Math.max(12, (selectedBounds.x + selectedBounds.width / 2) / 10))}%`,
            top: `${
              selectedBounds.y < 85 * pageAspect
                ? Math.min(92, (selectedBounds.y + selectedBounds.height + 28) / (10 * pageAspect))
                : Math.max(4, (selectedBounds.y - 16) / (10 * pageAspect))
            }%`,
          }}
        >
          <button
            type="button"
            onClick={handleDuplicateSelected}
            style={styles.contextPillBtn}
            title="تکثیر شکل (Ctrl + D)"
          >
            تکثیر
          </button>
          <button
            type="button"
            onClick={() => handleMoveLayer(1)}
            style={styles.contextPillBtn}
            title="آوردن به لایه رویی"
          >
            جلو
          </button>
          <button
            type="button"
            onClick={() => handleMoveLayer(-1)}
            style={styles.contextPillBtn}
            title="فرستادن به لایه زیرین"
          >
            عقب
          </button>
          <button
            type="button"
            onClick={handleDeleteSelected}
            style={{ ...styles.contextPillBtn, ...styles.contextPillDanger }}
            title="حذف شکل (Delete)"
          >
            حذف
          </button>
        </div>
      )}

      {/* ۴. ادیتور موضعی تایپ مستقیم متن روی صفحه */}
      {textEditorState && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            ...styles.inlineEditorBox,
            left: `${Math.min(74, Math.max(8, textEditorState.x / 10))}%`,
            top: `${Math.min(82, Math.max(8, textEditorState.y / (10 * pageAspect)))}%`,
          }}
        >
          <textarea
            ref={textAreaRef}
            rows={2}
            value={textEditorState.value}
            onChange={(e) =>
              setTextEditorState((prev) => ({ ...prev, value: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitTextEditor();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setTextEditorState(null);
              }
            }}
            placeholder="متن را تایپ کنید (Enter = ثبت)..."
            style={{
              ...styles.inlineEditorTextarea,
              color: textEditorState.color || annotationColor,
            }}
          />
          <div style={styles.inlineEditorActions}>
            <button
              type="button"
              onClick={() => setTextEditorState(null)}
              style={styles.editorCancelBtn}
            >
              لغو
            </button>
            <button
              type="button"
              onClick={commitTextEditor}
              style={styles.editorCommitBtn}
            >
              ثبت متن
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

const styles = {
  overlayRoot: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    zIndex: 18,
    userSelect: 'none',
    touchAction: 'none',
  },
  svgCanvas: {
    width: '100%',
    height: '100%',
    display: 'block',
    overflow: 'visible',
  },
  stickyCard: {
    position: 'absolute',
    minWidth: '130px',
    minHeight: '105px',
    borderRadius: '10px',
    padding: '8px',
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.45)',
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    boxSizing: 'border-box',
    cursor: 'move',
    direction: 'rtl',
    zIndex: 22,
  },
  stickyHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px dashed rgba(0, 0, 0, 0.18)',
    paddingBottom: '3px',
  },
  stickyPinDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  stickyHeaderTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '10px',
    fontWeight: 800,
    color: 'rgba(0, 0, 0, 0.55)',
  },
  stickyDeleteBtn: {
    background: 'transparent',
    border: 'none',
    color: 'rgba(0, 0, 0, 0.6)',
    fontSize: '14px',
    fontWeight: 800,
    cursor: 'pointer',
    lineHeight: 1,
    padding: '0 2px',
  },
  stickyTextarea: {
    flex: 1,
    width: '100%',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    resize: 'none',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    lineHeight: 1.5,
    color: '#0f172a',
    cursor: 'text',
  },
  contextPillMenu: {
    position: 'absolute',
    transform: 'translate(-50%, -100%)',
    zIndex: 45,
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    backgroundColor: 'rgba(13, 18, 24, 0.96)',
    backdropFilter: 'blur(14px)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.4)',
    borderRadius: '10px',
    boxShadow: '0 10px 26px rgba(0, 0, 0, 0.7)',
    direction: 'rtl',
  },
  contextPillBtn: {
    height: '24px',
    padding: '0 8px',
    borderRadius: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    color: '#e2e8f0',
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  contextPillDanger: {
    color: '#f85149',
    borderColor: 'rgba(248, 81, 73, 0.3)',
  },
  inlineEditorBox: {
    position: 'absolute',
    width: '220px',
    backgroundColor: 'rgba(13, 18, 24, 0.96)',
    backdropFilter: 'blur(16px)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#22d3ee',
    borderRadius: '10px',
    padding: '8px',
    boxShadow: '0 14px 36px rgba(0, 0, 0, 0.8)',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    direction: 'rtl',
    zIndex: 55,
  },
  inlineEditorTextarea: {
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: '7px',
    padding: '6px 8px',
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 700,
    outline: 'none',
    resize: 'none',
    direction: 'rtl',
  },
  inlineEditorActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '6px',
  },
  editorCancelBtn: {
    background: 'transparent',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    color: '#94a3b8',
    borderRadius: '6px',
    padding: '3px 9px',
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    cursor: 'pointer',
  },
  editorCommitBtn: {
    backgroundColor: '#22d3ee',
    border: 'none',
    color: '#0a0f13',
    borderRadius: '6px',
    padding: '3px 10px',
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    fontWeight: 700,
    cursor: 'pointer',
  },
};

export default AnnotationLayer;