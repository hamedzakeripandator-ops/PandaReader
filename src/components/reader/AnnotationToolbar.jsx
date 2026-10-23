import { useRef, useCallback } from 'react';
import useAppStore from '../../store/useAppStore';
import Icons from '../common/Icons';
import { PRESET_ANNOTATION_COLORS } from '../../utils/annotationEngine';

const STUDIO_TOOLS = [
  { id: 'select', label: 'انتخاب (V)', shortcut: 'V', Icon: Icons.MousePointer, isSelect: true },
  { id: 'box', label: 'کادربندی (B)', shortcut: 'B', Icon: Icons.Square },
  { id: 'highlighter', label: 'هایلایت (H)', shortcut: 'H', Icon: Icons.Highlighter },
  { id: 'pen', label: 'قلم نرم (P)', shortcut: 'P', Icon: Icons.PenTool },
  { id: 'arrow', label: 'فلش (A)', shortcut: 'A', Icon: Icons.ArrowUpRight },
  { id: 'text', label: 'متن (T)', shortcut: 'T', Icon: Icons.Type },
  { id: 'sticky', label: 'استیکی‌نوت', shortcut: 'N', Icon: Icons.StickyNote },
  { id: 'eraser', label: 'پاک‌کن (E)', shortcut: 'E', Icon: Icons.Eraser, isDanger: true },
];

const BOX_STYLES = [
  { id: 'cloud', label: 'کادر ابری' },
  { id: 'rect', label: 'مستطیل' },
  { id: 'round', label: 'گوشه گرد' },
];

const ARROW_STYLES = [
  { id: 'straight', label: 'فلش صاف' },
  { id: 'curved', label: 'فلش منحنی' },
];

// فونت‌های باندل‌شده آفلاین پروژه
const FONT_OPTIONS = [
  { id: "'Estedad', 'Vazirmatn', sans-serif", label: 'استعداد' },
  { id: "'Manrope', sans-serif", label: 'منروپ' },
  { id: "'JetBrains Mono', monospace", label: 'مونو' },
];

export function AnnotationToolbar({
  activePage = 1,
  pageItemCount = 0,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onClearPage,
  onInsertImage,
}) {
  // فقط زمانی که کاربر از TopBar دکمه «استودیو ویرایش» را روشن کرده باشد نمایش داده می‌شود
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
  const selectedAnnotationTool = useAppStore((state) => state.selectedAnnotationTool);

  const setAnnotationTool = useAppStore((state) => state.setAnnotationTool);
  const setAnnotationBoxStyle = useAppStore((state) => state.setAnnotationBoxStyle);
  const toggleAnnotationFill = useAppStore((state) => state.toggleAnnotationFill);
  const setAnnotationColor = useAppStore((state) => state.setAnnotationColor);
  const setAnnotationStrokeWidth = useAppStore((state) => state.setAnnotationStrokeWidth);
  const setAnnotationOpacity = useAppStore((state) => state.setAnnotationOpacity);
  const setAnnotationFontFamily = useAppStore((state) => state.setAnnotationFontFamily);
  const setAnnotationFontSize = useAppStore((state) => state.setAnnotationFontSize);
  const setAnnotationArrowStyle = useAppStore((state) => state.setAnnotationArrowStyle);
  const setIsAnnotationActive = useAppStore((state) => state.setIsAnnotationActive);
  const showToast = useAppStore((state) => state.showToast);

  const fileInputRef = useRef(null);

  // ارسال رویداد تغییر زنده ویژگی‌ها به شکل انتخاب‌شده (Two-Way Binding)
  const broadcastSelectedPropertyPatch = useCallback((patch) => {
    if (!useAppStore.getState().selectedAnnotationId) return;
    window.dispatchEvent(
      new CustomEvent('annotation:update-selected', {
        detail: patch,
      })
    );
  }, []);

  const handleSelectColor = useCallback(
    (hex) => {
      setAnnotationColor(hex);
      broadcastSelectedPropertyPatch({ color: hex });
    },
    [setAnnotationColor, broadcastSelectedPropertyPatch]
  );

  const handleStrokeChange = useCallback(
    (e) => {
      const val = parseInt(e.target.value, 10) || 4;
      setAnnotationStrokeWidth(val);
      broadcastSelectedPropertyPatch({ strokeWidth: val });
    },
    [setAnnotationStrokeWidth, broadcastSelectedPropertyPatch]
  );

  const handleFontFamilySelect = useCallback(
    (fontId) => {
      setAnnotationFontFamily(fontId);
      broadcastSelectedPropertyPatch({ fontFamily: fontId });
    },
    [setAnnotationFontFamily, broadcastSelectedPropertyPatch]
  );

  const handleFontSizeChange = useCallback(
    (e) => {
      const val = Math.max(14, Math.min(76, parseInt(e.target.value, 10) || 22));
      setAnnotationFontSize(val);
      broadcastSelectedPropertyPatch({ fontSize: val });
    },
    [setAnnotationFontSize, broadcastSelectedPropertyPatch]
  );

  const handleArrowStyleSelect = useCallback(
    (styleId) => {
      setAnnotationArrowStyle(styleId);
      broadcastSelectedPropertyPatch({ arrowStyle: styleId });
    },
    [setAnnotationArrowStyle, broadcastSelectedPropertyPatch]
  );

  const handleOpacityChange = useCallback(
    (e) => {
      const pct = parseInt(e.target.value, 10) || 85;
      const norm = Number((pct / 100).toFixed(2));
      setAnnotationOpacity(norm);
      broadcastSelectedPropertyPatch({ opacity: norm });
    },
    [setAnnotationOpacity, broadcastSelectedPropertyPatch]
  );

  const handleBoxStyleSelect = useCallback(
    (styleId) => {
      setAnnotationBoxStyle(styleId);
      broadcastSelectedPropertyPatch({ boxStyle: styleId });
    },
    [setAnnotationBoxStyle, broadcastSelectedPropertyPatch]
  );

  const handleToggleFill = useCallback(() => {
    const nextFill = !useAppStore.getState().annotationHasFill;
    toggleAnnotationFill();
    broadcastSelectedPropertyPatch({ hasFill: nextFill });
  }, [toggleAnnotationFill, broadcastSelectedPropertyPatch]);

  const handleImageFileChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result;
        if (typeof dataUrl === 'string') {
          if (onInsertImage) {
            onInsertImage(dataUrl, activePage);
          } else {
            window.dispatchEvent(
              new CustomEvent('annotation:insert-image', {
                detail: { dataUrl, pageNumber: activePage },
              })
            );
          }
          showToast('تصویر روی صفحه درج شد (با ابزار انتخاب تغییر سایز دهید)', {
            type: 'success',
          });
        }
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    },
    [activePage, onInsertImage, showToast]
  );

  if (!isAnnotationActive) return null;

  const opacityPercent = Math.round(annotationOpacity * 100);
  const strokeFillPct = ((annotationStrokeWidth - 1) / 23) * 100;
  const opacityFillPct = ((opacityPercent - 15) / 85) * 100;
  const showBoxSubOptions =
    annotationTool === 'box' || selectedAnnotationTool === 'box';
  const showArrowSubOptions =
    annotationTool === 'arrow' || selectedAnnotationTool === 'arrow';
  const showTextSubOptions =
    annotationTool === 'text' || selectedAnnotationTool === 'text';
  const fontSizeFillPct = ((annotationFontSize - 14) / 62) * 100;

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={styles.toolbarWrapper}
    >
      {/* ۱. گروه ابزارهای اصلی */}
      <div style={styles.group}>
        {STUDIO_TOOLS.map((t) => {
          const IconComp = t.Icon || Icons.Edit3;
          const isActive = annotationTool === t.id;

          let activeStyle = {};
          if (isActive) {
            if (t.isSelect) {
              activeStyle = styles.toolBtnSelectActive;
            } else if (t.isDanger) {
              activeStyle = styles.toolBtnEraserActive;
            } else {
              activeStyle = styles.toolBtnActive;
            }
          }

          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setAnnotationTool(t.id)}
              style={{
                ...styles.toolBtn,
                ...activeStyle,
              }}
              title={`${t.label} (کلید میانبر ${t.shortcut})`}
            >
              <IconComp size={14} />
              <span>{t.label}</span>
            </button>
          );
        })}

        {/* دکمه افزودن عکس */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={styles.toolBtn}
          title="درج تصویر از حافظه (یا پیست مستقیم با Ctrl+V)"
        >
          <Icons.Image size={14} />
          <span>عکس</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleImageFileChange}
        />
      </div>

      <div style={styles.divider} />

      {/* ۲. زیرمجموعه استایل کادربندی (کادر ابری، مستطیل، گوشه گرد + رنگ درون) */}
      {showBoxSubOptions && (
        <>
          <div style={styles.group}>
            <div style={styles.subStylePills}>
              {BOX_STYLES.map((b) => {
                const isSelected = annotationBoxStyle === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handleBoxStyleSelect(b.id)}
                    style={{
                      ...styles.pillOpt,
                      ...(isSelected ? styles.pillOptActive : {}),
                    }}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleToggleFill}
              style={{
                ...styles.fillToggleBtn,
                ...(annotationHasFill ? styles.fillToggleBtnActive : {}),
              }}
              title="روشن/خاموش کردن رنگ پس‌زمینه داخل کادر"
            >
              {annotationHasFill ? 'رنگ درون: روشن' : 'رنگ درون: خاموش'}
            </button>
          </div>

          <div style={styles.divider} />
        </>
      )}

      {/* ۲ب. زیرمجموعه استایل فلش (صاف / منحنی) */}
      {showArrowSubOptions && (
        <>
          <div style={styles.group}>
            <div style={styles.subStylePills}>
              {ARROW_STYLES.map((a) => {
                const isSelected = annotationArrowStyle === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => handleArrowStyleSelect(a.id)}
                    style={{
                      ...styles.pillOpt,
                      ...(isSelected ? styles.pillOptActive : {}),
                    }}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={styles.divider} />
        </>
      )}

      {/* ۲ج. زیرمجموعه فونت متن (خانواده + اندازه) */}
      {showTextSubOptions && (
        <>
          <div style={styles.group}>
            <div style={styles.subStylePills}>
              {FONT_OPTIONS.map((f) => {
                const isSelected = annotationFontFamily === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleFontFamilySelect(f.id)}
                    style={{
                      ...styles.pillOpt,
                      ...(isSelected ? styles.pillOptActive : {}),
                    }}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
            <div style={styles.sliderUnit} title="اندازه فونت متن">
              <span style={styles.sliderTitle}>فونت:</span>
              <input
                type="range"
                min="14"
                max="76"
                value={annotationFontSize}
                onChange={handleFontSizeChange}
                style={{
                  ...styles.customRange,
                  background: `linear-gradient(to left, #22d3ee 0%, #22d3ee ${fontSizeFillPct}%, rgba(255,255,255,0.14) ${fontSizeFillPct}%, rgba(255,255,255,0.14) 100%)`,
                }}
              />
              <span style={styles.sliderBadge}>{annotationFontSize}px</span>
            </div>
          </div>
          <div style={styles.divider} />
        </>
      )}

      {/* ۳. پالت رنگ + انتخابگر رنگ سفارشی */}
      <div style={styles.group}>
        <div style={styles.colorSwatches}>
          {PRESET_ANNOTATION_COLORS.map((c) => {
            const isSelected = annotationColor.toLowerCase() === c.hex.toLowerCase();
            return (
              <button
                key={c.hex}
                type="button"
                onClick={() => handleSelectColor(c.hex)}
                title={c.label}
                style={{
                  ...styles.colorDot,
                  backgroundColor: c.hex,
                  transform: isSelected ? 'scale(1.26)' : 'scale(1)',
                  borderColor: isSelected ? '#ffffff' : 'transparent',
                  boxShadow: isSelected ? `0 0 10px ${c.hex}` : 'none',
                }}
              />
            );
          })}
        </div>

        <label style={styles.customColorWrap} title="انتخاب رنگ سفارشی">
          <input
            type="color"
            value={annotationColor}
            onChange={(e) => handleSelectColor(e.target.value)}
            style={styles.customColorInput}
          />
        </label>
      </div>

      <div style={styles.divider} />

      {/* ۴. اسلایدرهای اختصاصی ضخامت و شفافیت با بج مونو */}
      <div style={styles.group}>
        <div style={styles.sliderUnit} title="ضخامت خط و کادر">
          <span style={styles.sliderTitle}>ضخامت:</span>
          <input
            type="range"
            min="1"
            max="24"
            value={annotationStrokeWidth}
            onChange={handleStrokeChange}
            style={{
              ...styles.customRange,
              background: `linear-gradient(to left, #22d3ee 0%, #22d3ee ${strokeFillPct}%, rgba(255,255,255,0.14) ${strokeFillPct}%, rgba(255,255,255,0.14) 100%)`,
            }}
          />
          <span style={styles.sliderBadge}>{annotationStrokeWidth}px</span>
        </div>

        <div style={styles.sliderUnit} title="درجه شفافیت (Transparency)">
          <span style={styles.sliderTitle}>شفافیت:</span>
          <input
            type="range"
            min="15"
            max="100"
            value={opacityPercent}
            onChange={handleOpacityChange}
            style={{
              ...styles.customRange,
              background: `linear-gradient(to left, #22d3ee 0%, #22d3ee ${opacityFillPct}%, rgba(255,255,255,0.14) ${opacityFillPct}%, rgba(255,255,255,0.14) 100%)`,
            }}
          />
          <span style={styles.sliderBadge}>{opacityPercent}%</span>
        </div>
      </div>

      <div style={styles.divider} />

      {/* ۵. دکمه‌های واگرد، ازنو، پاک‌سازی صفحه و بستن استودیو */}
      <div style={styles.group}>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          style={{
            ...styles.iconActionBtn,
            opacity: canUndo ? 1 : 0.35,
            cursor: canUndo ? 'pointer' : 'default',
          }}
          title="واگرد (Ctrl + Z)"
        >
          <Icons.Undo size={14} />
        </button>

        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          style={{
            ...styles.iconActionBtn,
            opacity: canRedo ? 1 : 0.35,
            cursor: canRedo ? 'pointer' : 'default',
          }}
          title="ازنو (Ctrl + Y)"
        >
          <Icons.Redo size={14} />
        </button>

        {pageItemCount > 0 && (
          <button
            type="button"
            onClick={onClearPage}
            style={{ ...styles.toolBtn, color: 'var(--danger)' }}
            title={`پاک کردن تمام یادداشت‌های صفحه ${activePage}`}
          >
            <Icons.Trash size={13} />
            <span>پاک‌سازی ({pageItemCount})</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setIsAnnotationActive(false)}
          style={styles.closeStudioBtn}
          title="بستن استودیو ویرایش (Esc)"
        >
          <Icons.X size={14} />
        </button>
      </div>
    </div>
  );
}

export default AnnotationToolbar;

const styles = {
  toolbarWrapper: {
    position: 'absolute',
    top: '62px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 85,
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    padding: '7px 14px',
    backgroundColor: 'rgba(13, 18, 24, 0.95)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.32)',
    borderRadius: '18px',
    boxShadow: '0 16px 45px rgba(0, 0, 0, 0.78), 0 0 20px rgba(34, 211, 238, 0.14)',
    maxWidth: '96vw',
    flexWrap: 'wrap',
    direction: 'rtl',
    userSelect: 'none',
  },
  group: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  divider: {
    width: '1px',
    height: '24px',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    margin: '0 2px',
  },
  toolBtn: {
    height: '34px',
    padding: '0 10px',
    borderRadius: '9px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    color: '#94a3b8',
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    transition: 'all 0.16s ease',
    outline: 'none',
    whiteSpace: 'nowrap',
  },
  toolBtnActive: {
    backgroundColor: 'rgba(34, 211, 238, 0.18)',
    borderColor: '#22d3ee',
    color: '#22d3ee',
    boxShadow: '0 0 12px rgba(34, 211, 238, 0.2)',
  },
  toolBtnSelectActive: {
    backgroundColor: 'rgba(167, 139, 250, 0.22)',
    borderColor: '#a78bfa',
    color: '#a78bfa',
    boxShadow: '0 0 12px rgba(167, 139, 250, 0.24)',
  },
  toolBtnEraserActive: {
    backgroundColor: 'rgba(248, 81, 73, 0.2)',
    borderColor: '#f85149',
    color: '#f85149',
    boxShadow: '0 0 12px rgba(248, 81, 73, 0.22)',
  },
  subStylePills: {
    display: 'flex',
    gap: '3px',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    padding: '3px',
    borderRadius: '9px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  pillOpt: {
    padding: '4px 9px',
    borderRadius: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    color: '#8b949e',
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  pillOptActive: {
    backgroundColor: '#22d3ee',
    color: '#0a0f13',
    borderColor: '#22d3ee',
    fontWeight: 700,
  },
  fillToggleBtn: {
    padding: '4px 9px',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    color: '#cbd5e1',
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  fillToggleBtnActive: {
    backgroundColor: 'rgba(34, 211, 238, 0.16)',
    borderColor: '#22d3ee',
    color: '#22d3ee',
    fontWeight: 700,
  },
  colorSwatches: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  colorDot: {
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    borderWidth: '2px',
    borderStyle: 'solid',
    cursor: 'pointer',
    padding: 0,
    transition: 'transform 0.15s ease',
  },
  customColorWrap: {
    position: 'relative',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    overflow: 'hidden',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 255, 255, 0.35)',
    cursor: 'pointer',
    display: 'inline-block',
  },
  customColorInput: {
    position: 'absolute',
    top: '-10px',
    left: '-10px',
    width: '40px',
    height: '40px',
    cursor: 'pointer',
    border: 'none',
    padding: 0,
  },
  sliderUnit: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
    padding: '4px 8px',
    borderRadius: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  sliderTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    color: '#94a3b8',
    fontWeight: 600,
  },
  sliderBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 700,
    color: '#22d3ee',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    padding: '1px 6px',
    borderRadius: '5px',
    minWidth: '38px',
    textAlign: 'center',
    direction: 'ltr',
  },
  customRange: {
    width: '66px',
    height: '5px',
    borderRadius: '3px',
    appearance: 'none',
    WebkitAppearance: 'none',
    outline: 'none',
    cursor: 'pointer',
  },
  iconActionBtn: {
    width: '30px',
    height: '30px',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    color: '#e2e8f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    outline: 'none',
  },
  closeStudioBtn: {
    width: '30px',
    height: '30px',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(248, 81, 73, 0.35)',
    backgroundColor: 'rgba(248, 81, 73, 0.14)',
    color: '#f85149',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    outline: 'none',
  },
};