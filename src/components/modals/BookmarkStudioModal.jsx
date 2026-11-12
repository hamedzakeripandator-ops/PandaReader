import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useBookmarkStore, { normalizeBookKey } from '../../store/useBookmarkStore';
import useAppStore from '../../store/useAppStore';
import { coreApi } from '../../services/coreApi';
import BookmarkMarker from '../reader/BookmarkMarker';
import {
  BOOKMARK_TEMPLATES,
  BOOKMARK_TEMPLATE_MAP,
  clampYRatio,
  resolveBookmarkImage,
} from '../reader/bookmarkTemplates';
import Icons from '../common/Icons';

// مرحله ۱۳: «استودیوی بوک‌مارک» — مودالِ اختصاصیِ هم‌تم با برنامه.
// گالری، از مرحله ۱۵ فقط عکس‌هایِ پوشهٔ bookmark-backgroundsِ
// همراهِ نرم‌افزار را نشان می‌دهد (والپیپرهایِ داخلی حذف شدند)؛
// دیالوگِ showOpenDialog الکترون، هرگز باز نمی‌شود. دکمهٔ
// «+ افزودن عکس به پوشه»، از انتخاب‌گرِ فایلِ استانداردِ وب
// (input[type=file]) استفاده می‌کند، نه showOpenDialog.
// با createPortal در document.body مانت می‌شود تا زیرِ هیچ
// اورلیِ دیگری نماند (همان الگویِ مودال‌هایِ دیگرِ برنامه).

const FOCAL_OPTIONS = [
  { id: 'center', label: 'وسط' },
  { id: 'top', label: 'بالا' },
  { id: 'bottom', label: 'پایین' },
];

export default function BookmarkStudioModal() {
  const studioOpen = useBookmarkStore((state) => state.studioOpen);
  const studioTarget = useBookmarkStore((state) => state.studioTarget);
  const closeStudio = useBookmarkStore((state) => state.closeStudio);
  const bookmarksByFile = useBookmarkStore((state) => state.bookmarksByFile);
  const preferences = useBookmarkStore((state) => state.preferences);
  const loadPreferences = useBookmarkStore((state) => state.loadPreferences);
  const addBookmark = useBookmarkStore((state) => state.addBookmark);
  const updateBookmark = useBookmarkStore((state) => state.updateBookmark);
  const deleteBookmark = useBookmarkStore((state) => state.deleteBookmark);
  const savePreferences = useBookmarkStore((state) => state.savePreferences);
  const backgrounds = useBookmarkStore((state) => state.backgrounds);
  const backgroundsDir = useBookmarkStore((state) => state.backgroundsDir);
  const loadBackgrounds = useBookmarkStore((state) => state.loadBackgrounds);
  const deleteBookmarkBackground = useBookmarkStore((state) => state.deleteBookmarkBackground);
  const showToast = useAppStore((state) => state.showToast);

  const [selectedTemplate, setSelectedTemplate] = useState('MARGIN');
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageTouched, setImageTouched] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [side, setSide] = useState('right');
  const [focalPoint, setFocalPoint] = useState('center');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // مرحله ۱۴: درگ‌واندراپِ مستقیمِ عکس (بدونِ دیالوگِ ویندوز).
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  const target = studioTarget || {};
  const editingBookmark = useMemo(() => {
    if (!target.bookmarkId || !target.filePath) return null;
    const list = (bookmarksByFile || {})[normalizeBookKey(target.filePath)] || [];
    return list.find((b) => b.id === target.bookmarkId) || null;
  }, [target.bookmarkId, target.filePath, bookmarksByFile]);

  // هر بار که استودیو با هدفِ تازه‌ای باز می‌شود، پیش‌نویس از
  // هدف (یا بوک‌مارکِ در حالِ ویرایش) ساخته می‌شود.
  useEffect(() => {
    if (!studioOpen) return;
    loadPreferences();
    loadBackgrounds();
    if (editingBookmark) {
      setSelectedTemplate(editingBookmark.template);
      setSelectedImage(editingBookmark.image || null);
      setImageTouched(Boolean(editingBookmark.image));
      setNameInput(editingBookmark.name || '');
      setSide(editingBookmark.side || 'right');
      setFocalPoint(editingBookmark.focalPoint || 'center');
    } else {
      setSelectedTemplate(preferences.defaultTemplate || 'MARGIN');
      setSelectedImage(null);
      setImageTouched(false);
      setNameInput('');
      setSide(preferences.defaultSide || 'right');
      setFocalPoint('center');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioOpen, target.bookmarkId, target.filePath, editingBookmark]);

  useEffect(() => {
    if (!studioOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeStudio();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [studioOpen, closeStudio]);

  if (!studioOpen) return null;

  const page = Math.max(1, Math.floor(Number(target.page) || 1));
  const yRatio = clampYRatio(target.yRatio);
  const yPercent = Math.round(yRatio * 100);
  const draftBookmark = {
    id: 'preview',
    page,
    yRatio,
    side,
    template: selectedTemplate,
    image: imageTouched ? selectedImage : null,
    focalPoint,
    name: nameInput.trim(),
  };
  const previewImage =
    (imageTouched ? selectedImage : null) ||
    resolveBookmarkImage(draftBookmark, preferences);

  const handlePickImage = (url) => {
    setSelectedImage(url);
    setImageTouched(true);
  };

  const handleSave = async () => {
    if (!target.filePath || saving) return;
    setSaving(true);
    try {
      const payload = {
        filePath: target.filePath,
        page,
        yRatio,
        template: selectedTemplate,
        image: imageTouched ? selectedImage : null,
        focalPoint,
        name: nameInput.trim(),
        side,
      };
      if (editingBookmark) {
        const updated = await updateBookmark(target.filePath, editingBookmark.id, payload);
        if (updated) {
          showToast('بوک‌مارک به‌روز شد.', { type: 'success' });
          closeStudio();
        }
      } else {
        const created = await addBookmark(payload);
        if (created) {
          showToast('بوک‌مارک ساخته شد.', { type: 'success' });
          closeStudio();
        }
      }
    } finally {
      setSaving(false);
    }
  };

  // مرحلهٔ ۵۸، مأموریت ۱ — مودال، فقط وقتی بسته می‌شود که حذف در
  // دیتابیس واقعاً تأیید شده باشد؛ در شکست، توستِ خطا را استور
  // می‌دهد و مودال باز می‌ماند تا کاربر دوباره تلاش کند.
  const handleDelete = async () => {
    if (!editingBookmark) return;
    const deleted = await deleteBookmark(target.filePath, editingBookmark.id);
    if (deleted) closeStudio();
  };

  // مرحله ۱۵: افزودنِ عکس با انتخاب‌گرِ فایلِ وب — همان منطقِ
  // درگ‌واندراپ، با همان پیام‌ها؛ مقصد، پوشهٔ نرم‌افزار است.
  const handleAddFilesFromInput = async (e) => {
    const files = Array.from((e.target && e.target.files) || []);
    if (e.target) e.target.value = '';
    if (files.length === 0) return;
    const paths = files.map((f) => {
      try {
        return coreApi.getFilePath ? coreApi.getFilePath(f) : (f.path || '');
      } catch (_) {
        return f.path || '';
      }
    }).filter(Boolean);
    if (paths.length === 0) {
      showToast('مسیرِ فایل‌ها خوانده نشد.', { type: 'error' });
      return;
    }
    setImporting(true);
    try {
      const res = await coreApi.importBookmarkBackgroundFiles(paths);
      if (res && res.success) {
        const n = (res.imported || []).length;
        const s = (res.skipped || []).length;
        if (n > 0) showToast(`${n} عکس واردِ پوشه شد.`, { type: 'success' });
        if (s > 0) showToast(`${s} فایل رد شد (فقط عکس‌هایِ مجاز وارد می‌شوند).`, { type: 'info' });
        if (n === 0 && s === 0) showToast('فایلی وارد نشد.', { type: 'info' });
        await loadBackgrounds(true);
      } else {
        showToast((res && res.error) || 'وارد کردنِ عکس‌ها انجام نشد.', { type: 'error' });
      }
    } catch (_) {
      showToast('وارد کردنِ عکس‌ها انجام نشد.', { type: 'error' });
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteBackground = async (bg) => {
    if (!bg || bg.source !== 'folder') return;
    const ok = await deleteBookmarkBackground(bg.name);
    if (ok) showToast('عکس از پوشه حذف شد.', { type: 'success' });
  };

  const handleRefreshGallery = async () => {
    setRefreshing(true);
    try {
      await loadBackgrounds(true);
    } finally {
      setRefreshing(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      const res = await coreApi.openBookmarkBackgroundsFolder();
      if (!res || !res.success) {
        showToast((res && res.error) || 'باز کردنِ پوشه انجام نشد.', { type: 'error' });
      } else {
        showToast('پوشهٔ تصاویر باز شد.', { type: 'success' });
      }
    } catch (_) {
      showToast('باز کردنِ پوشه انجام نشد.', { type: 'error' });
    }
  };

  // مرحله ۱۴: رها کردنِ فایل‌هایِ عکس از ویندوز، مستقیم به
  // پوشهٔ bookmark-backgrounds. مسیرِ هر فایل، از راهِ
  // getFilePath (webUtils) خوانده می‌شود؛ هیچ دیالوگی باز
  // نمی‌شود و پس از کپی، گالری تازه می‌شود.
  const handleDropFiles = async (e) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (files.length === 0) return;
    const paths = files.map((f) => {
      try {
        return coreApi.getFilePath ? coreApi.getFilePath(f) : (f.path || '');
      } catch (_) {
        return f.path || '';
      }
    }).filter(Boolean);
    if (paths.length === 0) {
      showToast('مسیرِ فایل‌ها خوانده نشد.', { type: 'error' });
      return;
    }
    setImporting(true);
    try {
      const res = await coreApi.importBookmarkBackgroundFiles(paths);
      if (res && res.success) {
        const n = (res.imported || []).length;
        const s = (res.skipped || []).length;
        if (n > 0) showToast(`${n} عکس واردِ پوشه شد.`, { type: 'success' });
        if (s > 0) showToast(`${s} فایل رد شد (فقط عکس‌هایِ مجاز وارد می‌شوند).`, { type: 'info' });
        if (n === 0 && s === 0) showToast('فایلی وارد نشد.', { type: 'info' });
        await loadBackgrounds(true);
      } else {
        showToast((res && res.error) || 'وارد کردنِ عکس‌ها انجام نشد.', { type: 'error' });
      }
    } catch (_) {
      showToast('وارد کردنِ عکس‌ها انجام نشد.', { type: 'error' });
    } finally {
      setImporting(false);
    }
  };

  const panelStyle = {
    position: 'fixed',
    inset: 0,
    zIndex: 100010,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    direction: 'rtl',
    fontFamily: 'var(--font-fa)',
    color: 'var(--text)',
    padding: '16px',
    boxSizing: 'border-box',
  };

  const cardStyle = {
    width: 'min(880px, 100%)',
    maxHeight: '88vh',
    overflowY: 'auto',
    backgroundColor: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: '16px',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)',
    padding: '20px',
    boxSizing: 'border-box',
  };

  const sectionTitle = { fontSize: '13px', fontWeight: 800, marginBottom: '10px', color: 'var(--text)' };
  const btnStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    borderRadius: '10px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--panel2)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: 'pointer',
  };

  return createPortal(
    <div style={panelStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) closeStudio(); }}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: 'var(--accent)', display: 'flex' }}>
              <Icons.Bookmark size={20} />
            </span>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 800 }}>استودیوی بوک‌مارک</div>
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                {editingBookmark ? 'ویرایشِ بوک‌مارک' : 'بوک‌مارکِ تازه'} • صفحه {page.toLocaleString('fa-IR')} • {yPercent.toLocaleString('fa-IR')}٪ از بالایِ صفحه
              </div>
            </div>
          </div>
          <button type="button" onClick={closeStudio} style={{ ...btnStyle, padding: '7px 10px' }} title="بستن">
            <Icons.X size={15} />
          </button>
        </div>

        <div style={sectionTitle}>۱. حالتِ قاب و انیمیشن (۱۵ تمپلیت)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '18px' }}>
          {BOOKMARK_TEMPLATES.map((t) => {
            const isActive = selectedTemplate === t.id;
            const cellImage =
              (imageTouched ? selectedImage : null) ||
              (preferences.templateImages && preferences.templateImages[t.id]) ||
              preferences.globalImage ||
              null;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTemplate(t.id)}
                style={{
                  border: isActive ? '2px solid var(--accent)' : '1px solid var(--border)',
                  borderRadius: '12px',
                  backgroundColor: isActive ? 'rgba(34, 211, 238, 0.08)' : 'var(--panel2)',
                  padding: '8px 4px 6px',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-fa)',
                }}
              >
                <div style={{ height: '118px', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
                  <div style={{ transform: 'scale(0.42)', transformOrigin: 'top center', height: '270px' }}>
                    <BookmarkMarker
                      bookmark={{ id: 'cell', page, yRatio: 0, side: 'right', template: t.id, image: cellImage, focalPoint, name: '' }}
                      imageUrl={cellImage}
                      onOpen={() => setSelectedTemplate(t.id)}
                      onDelete={null}
                    />
                  </div>
                </div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginTop: '2px' }}>{t.faLabel}</div>
                <div style={{ fontSize: '10.5px', color: 'var(--muted)', lineHeight: 1.6 }}>{t.desc}</div>
              </button>
            );
          })}
        </div>

        <div style={sectionTitle}>۲. گالریِ تصاویرِ پوشهٔ نرم‌افزار</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
          <button type="button" onClick={handleRefreshGallery} disabled={refreshing} style={btnStyle}>
            <Icons.RefreshCw size={14} />
            <span>{refreshing ? 'در حالِ تازه‌سازی…' : 'تازه‌سازیِ پوشه'}</span>
          </button>
          <button type="button" onClick={handleOpenFolder} style={btnStyle}>
            <Icons.FolderOpen size={14} />
            <span>باز کردنِ پوشه در اکسپلورر</span>
          </button>
          <button type="button" onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={importing} style={btnStyle}>
            <Icons.Plus size={14} />
            <span>+ افزودن عکس به پوشه</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleAddFilesFromInput}
            style={{ display: 'none' }}
          />
          <span style={{ fontSize: '11.5px', color: 'var(--muted)', direction: 'ltr', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '420px' }}>
            {backgroundsDir && (backgroundsDir.appDir || backgroundsDir.dataDir) ? (backgroundsDir.appDir || backgroundsDir.dataDir) : '—'}
          </span>
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDropFiles}
          style={{
            border: dragActive ? '2px dashed var(--accent)' : '1px dashed var(--border)',
            borderRadius: '12px',
            padding: '14px',
            textAlign: 'center',
            fontSize: '12.5px',
            lineHeight: 1.9,
            color: dragActive ? 'var(--accent)' : 'var(--muted)',
            backgroundColor: dragActive ? 'rgba(34, 211, 238, 0.08)' : 'transparent',
            marginBottom: '12px',
          }}
        >
          {importing ? 'در حالِ وارد کردنِ عکس‌ها…' : 'عکس‌ها را از ویندوز اینجا رها کنید تا مستقیم واردِ پوشهٔ بوک‌مارک شوند (بدونِ دیالوگِ ویندوز)'}
        </div>
        <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '18px' }}>
          <button
            type="button"
            onClick={() => handlePickImage(null)}
            style={{
              minWidth: '72px',
              border: imageTouched && selectedImage === null ? '2px solid var(--accent)' : '1px solid var(--border)',
              borderRadius: '10px',
              background: 'repeating-linear-gradient(45deg,#e5e7eb 0 10px,#f3f4f6 10px 20px)',
              height: '100px',
              cursor: 'pointer',
              color: '#374151',
              fontFamily: 'var(--font-fa)',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            بدونِ عکس
          </button>
          {backgrounds.map((bg) => {
            const isActive = imageTouched && selectedImage === bg.url;
            return (
              <div key={bg.id} style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => handlePickImage(bg.url)}
                  title={bg.name}
                  style={{
                    minWidth: '72px',
                    border: isActive ? '2px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    padding: 0,
                    cursor: 'pointer',
                    backgroundColor: 'var(--panel2)',
                  }}
                >
                  <img src={bg.url} alt={bg.name} draggable={false} style={{ width: '72px', height: '100px', objectFit: 'cover', display: 'block' }} />
                  <div style={{ fontSize: '10.5px', color: 'var(--muted)', padding: '3px 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '72px', fontFamily: 'var(--font-fa)' }}>
                    {bg.name}
                  </div>
                </button>
                {bg.source === 'folder' ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDeleteBackground(bg); }}
                    title="حذفِ این عکس از پوشه"
                    style={{
                      position: 'absolute',
                      top: '4px',
                      left: '4px',
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      border: 'none',
                      backgroundColor: 'rgba(17, 24, 39, 0.85)',
                      color: '#f87171',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <Icons.Trash size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div style={sectionTitle}>۳. نقطهٔ تمرکزِ عکس</div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
          {FOCAL_OPTIONS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFocalPoint(f.id)}
              style={{
                ...btnStyle,
                border: focalPoint === f.id ? '2px solid var(--accent)' : '1px solid var(--border)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={sectionTitle}>۴. تخصیصِ عکس</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
          <button
            type="button"
            onClick={() => {
              if (!selectedImage) { showToast('اول یک عکس از گالری انتخاب کن.', { type: 'info' }); return; }
              savePreferences({ templateImages: { ...(preferences.templateImages || {}), [selectedTemplate]: selectedImage } });
              showToast(`عکس، تصویرِ پیش‌فرضِ تمپلیتِ ${BOOKMARK_TEMPLATE_MAP[selectedTemplate]?.faLabel || selectedTemplate} شد.`, { type: 'success' });
            }}
            style={btnStyle}
          >
            ست به‌عنوانِ تصویرِ پیش‌فرضِ این تمپلیت
          </button>
          <button
            type="button"
            onClick={() => {
              if (!selectedImage) { showToast('اول یک عکس از گالری انتخاب کن.', { type: 'info' }); return; }
              savePreferences({ globalImage: selectedImage });
              showToast('عکس، تصویرِ سراسریِ همهٔ تمپلیت‌ها شد.', { type: 'success' });
            }}
            style={btnStyle}
          >
            ست به‌عنوانِ تصویرِ سراسری
          </button>
          <button
            type="button"
            onClick={() => {
              savePreferences({ defaultTemplate: selectedTemplate });
              showToast(`تمپلیتِ ${BOOKMARK_TEMPLATE_MAP[selectedTemplate]?.faLabel || selectedTemplate}، پیش‌فرض شد.`, { type: 'success' });
            }}
            style={btnStyle}
          >
            ست به‌عنوانِ تمپلیتِ پیش‌فرض
          </button>
        </div>

        <div style={sectionTitle}>۵. مشخصاتِ این بوک‌مارک</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '18px' }}>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="نامِ دلخواه (اختیاری؛ خالی یعنی نامِ تمپلیت)"
            style={{
              flex: '1 1 220px',
              padding: '9px 12px',
              borderRadius: '10px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--panel2)',
              color: 'var(--text)',
              fontFamily: 'var(--font-fa)',
              fontSize: '13px',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              { id: 'right', label: 'حاشیهٔ راست' },
              { id: 'left', label: 'حاشیهٔ چپ' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSide(s.id)}
                style={{ ...btnStyle, border: side === s.id ? '2px solid var(--accent)' : '1px solid var(--border)' }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ width: '68px', transform: 'scale(0.72)', transformOrigin: 'top right', height: '194px', overflow: 'hidden', flexShrink: 0 }}>
            <BookmarkMarker bookmark={draftBookmark} imageUrl={previewImage} onOpen={null} onDelete={null} />
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{ ...btnStyle, backgroundColor: 'var(--accent)', color: '#0a0f13', border: '1px solid var(--accent)', padding: '10px 18px', fontSize: '13.5px' }}
            >
              {saving ? 'در حالِ ذخیره…' : editingBookmark ? 'ذخیرهٔ تغییرها' : 'ساختِ بوک‌مارک'}
            </button>
            {editingBookmark ? (
              <button type="button" onClick={handleDelete} style={{ ...btnStyle, border: '1px solid rgba(239, 68, 68, 0.45)', color: '#ef4444' }}>
                <Icons.Trash size={14} />
                <span>حذفِ این بوک‌مارک</span>
              </button>
            ) : null}
            <button type="button" onClick={closeStudio} style={btnStyle}>
              انصراف
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
