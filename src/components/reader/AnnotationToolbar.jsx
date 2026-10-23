// ============================================================================
// AnnotationToolbar.jsx — فاز ۱: یکپارچه‌سازی با والد
// ساختار تمیز نسخه ۳ حفظ شده + اتصال props از PdfViewer
// قرارداد:
//   - اگر onUndo/onRedo/onClearPage از والد آمد → آن‌ها صدا زده می‌شوند
//   - در غیر این صورت → fallback به رویدادهای window
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import useAppStore from '../../store/useAppStore';
import Icons from '../common/Icons';

const TOOLS = [
  { id: 'pen', label: 'قلم (P)', shortcut: 'P', Icon: Icons.PenTool },
  { id: 'box', label: 'کادربندی (B)', shortcut: 'B', Icon: Icons.Square },
  { id: 'highlighter', label: 'هایلایت (H)', shortcut: 'H', Icon: Icons.Highlighter },
  { id: 'eraser', label: 'پاک‌کن (E)', shortcut: 'E', Icon: Icons.Eraser, danger: true },
];

const COLORS = [
  { hex: '#facc15', label: 'زرد' },
  { hex: '#22d3ee', label: 'فیروزه‌ای' },
  { hex: '#4ade80', label: 'سبز' },
  { hex: '#fb7185', label: 'قرمز' },
  { hex: '#c084fc', label: 'بنفش' },
  { hex: '#fb923c', label: 'نارنجی' },
  { hex: '#f8fafc', label: 'سفید' },
  { hex: '#0f172a', label: 'مشکی' },
];

const SIZES = [1, 2, 4, 7, 11];

// فاز ۲: استایل‌های کادربندی
const BOX_STYLES = [
  { id: 'cloud', label: 'ابری' },
  { id: 'rect', label: 'مستطیل' },
  { id: 'round', label: 'گوشه‌گرد' },
];

const btnBase = {
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s, color 0.15s, outline 0.15s',
};

export function AnnotationToolbar({
  activePage = 1,
  pageItemCount = 0,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onClearPage,
} = {}) {
  const isAnnotationActive = useAppStore((s) => Boolean(s.isAnnotationActive));
  const annotationTool = useAppStore((s) => s.annotationTool || 'pen');
  const setAnnotationTool = useAppStore((s) => s.setAnnotationTool);
  const annotationColor = useAppStore((s) => s.annotationColor || '#22d3ee');
  const setAnnotationColor = useAppStore((s) => s.setAnnotationColor);
  const annotationStrokeWidth = useAppStore((s) => s.annotationStrokeWidth || 4);
  const setAnnotationStrokeWidth = useAppStore((s) => s.setAnnotationStrokeWidth);
  // فاز ۲: استیت‌های باکس
  const annotationBoxStyle = useAppStore((s) => s.annotationBoxStyle || 'cloud');
  const setAnnotationBoxStyle = useAppStore((s) => s.setAnnotationBoxStyle);
  const annotationHasFill = useAppStore((s) => Boolean(s.annotationHasFill));
  const toggleAnnotationFill = useAppStore((s) => s.toggleAnnotationFill);

  // تایید دو مرحله‌ای برای پاک کردن همه (بدون window.confirm زشت)
  const [armClear, setArmClear] = useState(false);
  useEffect(() => {
    if (!armClear) return;
    const t = setTimeout(() => setArmClear(false), 3000);
    return () => clearTimeout(t);
  }, [armClear]);

  // --- فاز ۱: Undo با اولویت prop والد ---
  const doUndo = useCallback(() => {
    if (typeof onUndo === 'function') {
      onUndo();
    } else {
      // fallback: رویداد window (اگر والد onUndo نداده باشد)
      window.dispatchEvent(new CustomEvent('annotation:undo'));
    }
  }, [onUndo]);

  // --- فاز ۱: Redo با اولویت prop والد ---
  const doRedo = useCallback(() => {
    if (typeof onRedo === 'function') {
      onRedo();
    } else {
      // fallback: رویداد window
      window.dispatchEvent(new CustomEvent('annotation:redo'));
    }
  }, [onRedo]);

  // --- فاز ۱: پاک‌سازی با اولویت prop والد ---
  const doClear = useCallback(() => {
    if (!armClear) {
      setArmClear(true);
      return;
    }
    setArmClear(false);
    if (typeof onClearPage === 'function') {
      onClearPage();
    } else {
      // fallback: رویداد window
      window.dispatchEvent(new CustomEvent('annotation:clear'));
    }
  }, [armClear, onClearPage]);

  // میانبرها — هماهنگ با onUndo/onRedo
  useEffect(() => {
    if (!isAnnotationActive) return;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'p') setAnnotationTool('pen');
      else if (k === 'b') setAnnotationTool('box');
      else if (k === 'h') setAnnotationTool('highlighter');
      else if (k === 'e') setAnnotationTool('eraser');
      else if ((e.ctrlKey || e.metaKey) && k === 'z') {
        // فاز ۱-مرحله ۳: فقط وقتی هندلر والد موجود است
        // (جلوگیری از تداخل با Undo/Redo نیتیو فیلدهای متنی)
        if (typeof onUndo !== 'function' && typeof onRedo !== 'function') return;
        e.preventDefault();
        if (e.shiftKey) {
          doRedo(); // Ctrl+Shift+Z → Redo
        } else {
          doUndo(); // Ctrl+Z → Undo
        }
      } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
        if (typeof onRedo !== 'function') return;
        e.preventDefault();
        doRedo(); // Ctrl+Y → Redo
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAnnotationActive, setAnnotationTool, doUndo, doRedo, onUndo, onRedo]);

  if (!isAnnotationActive) return null;

  const activeId = TOOLS.some((t) => t.id === annotationTool) ? annotationTool : 'pen';
  const divider = <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />;

  // استایل دکمه غیرفعال
  const disabledStyle = (disabled) => ({
    opacity: disabled ? 0.35 : 1,
    cursor: disabled ? 'default' : 'pointer',
  });

  return (
    <div
      dir="rtl"
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 10px',
        borderRadius: 16,
        background: 'rgba(8, 12, 16, 0.92)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        userSelect: 'none',
        maxWidth: 'calc(100% - 24px)',
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {/* ابزارها */}
      {TOOLS.map(({ id, label, Icon, danger }) => {
        const active = activeId === id;
        return (
          <button
            key={id}
            title={label}
            onClick={() => setAnnotationTool(id)}
            style={{
              ...btnBase,
              width: 38,
              height: 38,
              borderRadius: 11,
              background: active
                ? danger ? 'rgba(244,63,94,0.25)' : 'rgba(34,211,238,0.22)'
                : 'transparent',
              color: active
                ? danger ? '#fda4af' : '#67e8f9'
                : 'rgba(255,255,255,0.6)',
              outline: active ? `1.5px solid ${danger ? '#f43f5e' : '#22d3ee'}` : 'none',
              outlineOffset: -1,
            }}
          >
            <Icon size={18} />
          </button>
        );
      })}

      {/* فاز ۲: زیرمنوی کادربندی — فقط وقتی ابزار box فعال است */}
      {annotationTool === 'box' && (
        <>
          {divider}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {BOX_STYLES.map((bs) => {
              const active = annotationBoxStyle === bs.id;
              return (
                <button
                  key={bs.id}
                  title={`استایل کادر: ${bs.label}`}
                  onClick={() => setAnnotationBoxStyle(bs.id)}
                  style={{
                    ...btnBase,
                    height: 32,
                    padding: '0 10px',
                    borderRadius: 9,
                    fontSize: 12,
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                    background: active ? 'rgba(34,211,238,0.20)' : 'transparent',
                    color: active ? '#67e8f9' : 'rgba(255,255,255,0.6)',
                    outline: active ? '1.5px solid #22d3ee' : 'none',
                    outlineOffset: -1,
                  }}
                >
                  {bs.label}
                </button>
              );
            })}
            {/* دکمه تاگل پر کردن داخل کادر */}
            <button
              title={annotationHasFill ? 'رنگ داخل: روشن (کلیک برای خاموش)' : 'رنگ داخل: خاموش (کلیک برای روشن)'}
              onClick={() => toggleAnnotationFill()}
              style={{
                ...btnBase,
                height: 32,
                padding: '0 10px',
                borderRadius: 9,
                fontSize: 12,
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                background: annotationHasFill ? 'rgba(34,211,238,0.20)' : 'transparent',
                color: annotationHasFill ? '#67e8f9' : 'rgba(255,255,255,0.4)',
                outline: annotationHasFill ? '1.5px solid #22d3ee' : '1px dashed rgba(255,255,255,0.2)',
                outlineOffset: -1,
              }}
            >
              {annotationHasFill ? '◉ توپر' : '○ توخالی'}
            </button>
          </div>
        </>
      )}

      {divider}

      {/* رنگ‌ها */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '0 2px' }}>
        {COLORS.map((c) => {
          const active = annotationColor.toLowerCase() === c.hex.toLowerCase();
          return (
            <button
              key={c.hex}
              title={c.label}
              onClick={() => setAnnotationColor(c.hex)}
              style={{
                ...btnBase,
                width: active ? 24 : 20,
                height: active ? 24 : 20,
                borderRadius: '50%',
                background: c.hex,
                border: c.hex === '#f8fafc' ? '1px solid rgba(0,0,0,0.2)' : 'none',
                boxShadow: active
                  ? '0 0 0 2px rgba(8,12,16,1), 0 0 0 4px #22d3ee'
                  : '0 0 0 1px rgba(255,255,255,0.2)',
              }}
            />
          );
        })}
      </div>

      {divider}

      {/* اندازه */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {SIZES.map((v) => {
          const active = annotationStrokeWidth === v;
          const dot = Math.min(18, 5 + v * 1.2);
          return (
            <button
              key={v}
              title={`ضخامت ${v}`}
              onClick={() => setAnnotationStrokeWidth(v)}
              style={{
                ...btnBase,
                width: 32,
                height: 32,
                borderRadius: 9,
                background: active ? 'rgba(34,211,238,0.20)' : 'transparent',
                outline: active ? '1.5px solid #22d3ee' : 'none',
                outlineOffset: -1,
              }}
            >
              <span
                style={{
                  width: dot,
                  height: dot,
                  borderRadius: '50%',
                  background: active ? '#67e8f9' : 'rgba(255,255,255,0.5)',
                  flexShrink: 0,
                }}
              />
            </button>
          );
        })}
      </div>

      {divider}

      {/* Undo — فاز ۱: prop با fallback */}
      <button
        title="برگردان (Ctrl+Z)"
        onClick={doUndo}
        disabled={typeof onUndo !== 'function' || !canUndo}
        style={{
          ...btnBase,
          width: 38,
          height: 38,
          borderRadius: 11,
          background: 'transparent',
          color: 'rgba(255,255,255,0.6)',
          ...disabledStyle(typeof onUndo !== 'function' || !canUndo),
        }}
      >
        <Icons.Undo size={17} />
      </button>

      {/* Redo — فاز ۱: دکمه جدید */}
      <button
        title="ازنو (Ctrl+Y)"
        onClick={doRedo}
        disabled={typeof onRedo !== 'function' || !canRedo}
        style={{
          ...btnBase,
          width: 38,
          height: 38,
          borderRadius: 11,
          background: 'transparent',
          color: 'rgba(255,255,255,0.6)',
          ...disabledStyle(typeof onRedo !== 'function' || !canRedo),
        }}
      >
        <Icons.Redo size={17} />
      </button>

      {/* پاک کردن همه — دو مرحله‌ای، فاز ۱: prop با fallback */}
      {pageItemCount > 0 && (
        <button
          title={armClear ? 'برای تایید دوباره بزن' : `پاک کردن همه خط‌های صفحه ${activePage}`}
          onClick={doClear}
          style={{
            ...btnBase,
            minWidth: 38,
            height: 38,
            padding: armClear ? '0 10px' : 0,
            borderRadius: 11,
            background: armClear ? 'rgba(244,63,94,0.30)' : 'transparent',
            color: armClear ? '#fecdd3' : 'rgba(244,63,94,0.75)',
            outline: armClear ? '1.5px solid #f43f5e' : 'none',
            outlineOffset: -1,
            fontSize: 12,
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          {armClear ? 'مطمئنی؟' : <Icons.Trash size={17} />}
        </button>
      )}
    </div>
  );
}

export default AnnotationToolbar;
