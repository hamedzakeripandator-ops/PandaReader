import React, { useEffect, useRef, useState } from 'react';
import Icons from '../common/Icons';
import { BOOKMARK_TEMPLATE_MAP } from './bookmarkTemplates';

// مرحله ۱۳: مارکرِ بوک‌مارکِ دیجیتال — ابعادِ ثابتِ ۶۸×۲۷۰،
// عکس ۲۳۲ پیکسلی بالا + نام ۳۸ پیکسلی زیرِ عکس (هرگز رویِ عکس
// نیست) + دکمهٔ حذفِ ۲۲ پیکسلی که فقط در هاور دیده می‌شود.
// همهٔ انیمیشن‌ها فقط با transform/opacity/filter هستند و
// prefers-reduced-motion رعایت می‌شود. استایل‌ها یک بار در
// document.head تزریق می‌شوند تا :hover و keyframesها کار کنند
// (استایلِ درون‌خطی، hover ندارد).

const MARKER_CSS = `
.bm-marker{width:68px;height:270px;display:flex;flex-direction:column;background:#fff;filter:drop-shadow(0 6px 8px rgba(0,0,0,.2));cursor:pointer;position:relative;user-select:none;flex-shrink:0;transition:transform .3s ease,border-color .3s ease,box-shadow .3s ease,filter .3s ease}
.bm-img{height:232px;overflow:hidden;position:relative;flex-shrink:0;background:#f3f4f6}
.bm-img img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
.bm-ph{width:100%;height:100%;background:repeating-linear-gradient(45deg,#e5e7eb 0 10px,#f3f4f6 10px 20px)}
.bm-name{height:38px;min-height:38px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:#111827;background:#fff;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:0 4px;direction:rtl;font-family:var(--font-fa,inherit);box-sizing:border-box}
.bm-name-input{height:38px;min-height:38px;width:100%;box-sizing:border-box;border:1px solid #c9a227;outline:none;background:#fffbe6;color:#111827;font-size:11px;font-weight:bold;text-align:center;font-family:var(--font-fa,inherit);padding:0 4px}
.bm-x{position:absolute;top:-9px;left:50%;transform:translateX(-50%);width:22px;height:22px;border-radius:50%;background:#111827;color:#fff;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s ease;border:none;cursor:pointer;z-index:5;padding:0}
.bm-marker:hover .bm-x{opacity:1}
.bm--MARGIN{border:2px solid #c9a227;box-sizing:border-box}
.bm--MARGIN:hover{transform:translateY(-4px);border-color:#facc15}
.bm--SLANT{transform:rotate(3deg);transform-origin:top center}
.bm--SLANT:hover{transform:rotate(0deg)}
.bm--ARROW .bm-img{clip-path:polygon(0 0,100% 0,100% 82%,50% 100%,0 82%)}
@keyframes bm-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(6px)}}
.bm--ARROW:hover{animation:bm-bounce .6s ease-in-out infinite}
.bm--MIRROR .bm-img{height:160px}
.bm-reflect{height:72px;overflow:hidden;position:relative;flex-shrink:0}
.bm-reflect img{width:100%;height:100%;object-fit:cover;display:block;transform:scaleY(-1);opacity:.6;-webkit-mask-image:linear-gradient(to bottom,black,transparent);mask-image:linear-gradient(to bottom,black,transparent);transition:opacity .3s ease;pointer-events:none}
.bm--MIRROR:hover .bm-reflect img{opacity:1}
.bm--DIAGONAL .bm-img{clip-path:polygon(0 28px,100% 0,100% 100%,0 100%)}
.bm--DIAGONAL:hover{transform:translateY(-5px)}
.bm-back{position:absolute;top:12px;right:-6px;width:100%;height:232px;opacity:.45;filter:grayscale(1);background-size:cover;z-index:0;transition:transform .3s ease;pointer-events:none}
.bm--OFFSET .bm-img{position:relative;z-index:1}
.bm--OFFSET:hover .bm-back{transform:translate(-3px,-6px)}
.bm--FLIP{perspective:600px}
.bm-flip-inner{position:relative;width:100%;height:232px;transform-style:preserve-3d;transition:transform .6s ease;flex-shrink:0}
.bm-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden}
.bm-face img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
.bm-face-back{transform:rotateY(180deg);background:#111827}
.bm-face-back img{transform:scaleX(-1)}
.bm--FLIP:hover .bm-flip-inner{transform:rotateY(180deg)}
.bm--ZOOM .bm-img img{transition:transform .4s ease}
.bm--ZOOM:hover .bm-img img{transform:scale(1.18);transform-origin:center}
@keyframes bm-sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
.bm--SWAY{transform-origin:top center}
.bm--SWAY:hover{animation:bm-sway 1.2s ease-in-out infinite}
@keyframes bm-glow-pulse{0%,100%{box-shadow:0 0 24px 6px rgba(201,162,39,.55)}50%{box-shadow:0 0 12px 3px rgba(201,162,39,.3)}}
.bm--GLOW:hover{animation:bm-glow-pulse 1.6s ease-in-out infinite}
.bm--FLOAT:hover{transform:translateY(-10px);filter:drop-shadow(0 16px 14px rgba(0,0,0,.3))}
.bm--SLIDE .bm-img img{transition:transform .4s ease}
.bm--SLIDE:hover .bm-img img{transform:translateY(-12px) scale(1.05)}
.bm-slice{width:100%;height:33.3333%;background-size:100% 300%;background-repeat:no-repeat;transition:transform .3s ease}
.bm--SPLIT:hover .bm-slice-first{transform:translateX(-5px)}
.bm--SPLIT:hover .bm-slice-last{transform:translateX(5px)}
.bm--TILT:hover{transform:perspective(500px) rotateX(8deg) rotateY(-10deg)}
@keyframes bm-wave{0%,100%{transform:skewX(2deg)}50%{transform:skewX(-2deg)}}
.bm--WAVE:hover{animation:bm-wave .8s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.bm-marker,.bm-marker *{animation:none !important;transition:none !important}}
.bm-marker{touch-action:none}
.bm--side-right{border-top-right-radius:8px;border-bottom-right-radius:8px;border-top-left-radius:0;border-bottom-left-radius:0}
.bm--side-left{border-top-left-radius:8px;border-bottom-left-radius:8px;border-top-right-radius:0;border-bottom-right-radius:0}
.bm--side-right .bm-img,.bm--side-right .bm-flip-inner{border-top-right-radius:8px}
.bm--side-right .bm-name,.bm--side-right .bm-name-input{border-bottom-right-radius:8px}
.bm--side-left .bm-img,.bm--side-left .bm-flip-inner{border-top-left-radius:8px}
.bm--side-left .bm-name,.bm--side-left .bm-name-input{border-bottom-left-radius:8px}
.bm-spine{position:absolute;top:0;bottom:0;width:4px;z-index:2;pointer-events:none;background:linear-gradient(180deg,#f6d365,#c9a227 55%,#8a6d1b)}
.bm--side-right .bm-spine{left:0;box-shadow:inset 4px 0 6px -2px rgba(0,0,0,.35)}
.bm--side-left .bm-spine{right:0;box-shadow:inset -4px 0 6px -2px rgba(0,0,0,.35)}
/* مرحله ۱۹ — پلِ اتصال: نوارِ افقیِ ظریفِ ۱۰ پیکسلی که فاصلهٔ میانِ لبهٔ
   کاغذ و بدنهٔ بوک‌مارک را می‌بندد تا بوک‌مارک، با وجودِ بیرون بودن از
   صفحه، با یک آبجکتِ گرافیکی به برگه وصل باشد. داخلِ ریشهٔ مارکر است
   تا هنگامِ درگ، همراهِ مارکر حرکت کند؛ رویدادِ اشاره‌اش به ریشه
   می‌رسد (درگ از رویِ پل هم شروع می‌شود) و چون زیرِ .bm-marker است،
   پیمایشِ چهارجهته را مسدود نمی‌کند. */
.bm-bridge{position:absolute;top:18px;width:10px;height:3px;border-radius:2px;z-index:3;background:linear-gradient(90deg,#c9a227,#f6d365);box-shadow:0 1px 3px rgba(0,0,0,.45)}
.bm--side-right .bm-bridge{left:-10px}
.bm--side-left .bm-bridge{right:-10px;background:linear-gradient(270deg,#c9a227,#f6d365)}
`;

function ensureBookmarkStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('bm-marker-styles')) return;
  const style = document.createElement('style');
  style.id = 'bm-marker-styles';
  style.textContent = MARKER_CSS;
  document.head.appendChild(style);
}

function focalToObjectPosition(focalPoint) {
  if (focalPoint === 'top') return 'center top';
  if (focalPoint === 'bottom') return 'center bottom';
  return 'center';
}

// مرحلهٔ ۴۰ §۳: محاسبهٔ خالصِ نسبتِ عمودیِ درگ — همان فرمولِ پرامپت
// (کلمپِ 0.02 تا 0.92)؛ برایِ تستِ واحد، export شده است.
export function computeBookmarkDragRatio(clientY, rectTop, rectHeight, grabOffsetY) {
  return Math.min(0.92, Math.max(0.02, (clientY - rectTop - grabOffsetY) / Math.max(1, rectHeight)));
}

export default function BookmarkMarker({ bookmark, imageUrl, onOpen, onDelete, onRename, onMove, onMoveBookmark }) {
  useEffect(() => {
    ensureBookmarkStyles();
  }, []);
  // مرحله ۱۶: ویرایشِ درجایِ نام — همهٔ هوک‌ها پیش از returnِ
  // زودهنگام‌اند (قانونِ همیشگی: هوک، هرگز پس از return).
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const skipBlurCommitRef = useRef(false);
  const inputRef = useRef(null);
  // مرحلهٔ ۴۰ §۳ — درگِ ۶۰ فریمِ بوک‌مارک: همهٔ هوک‌ها، پیش از returnِ
  // زودهنگام‌اند (قانونِ همیشگی). جابه‌جاییِ دیداری، مستقیم رویِ
  // style.topِ کادرِ والد با requestAnimationFrame انجام می‌شود
  // (بدونِ ری‌رندرِ React در هر پیکسل)؛ ذخیره، فقط در pointerup.
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  if (!bookmark) return null;
  const template = bookmark.template || 'MARGIN';
  const label = bookmark.name || (BOOKMARK_TEMPLATE_MAP[template]?.faLabel || template);
  const focal = focalToObjectPosition(bookmark.focalPoint);

  const imgEl = imageUrl ? (
    <img src={imageUrl} alt="" draggable={false} style={{ objectPosition: focal }} />
  ) : (
    <div className="bm-ph" />
  );

  let imageArea = null;
  if (template === 'MIRROR') {
    imageArea = (
      <>
        <div className="bm-img">{imgEl}</div>
        <div className="bm-reflect">
          {imageUrl ? (
            <img src={imageUrl} alt="" draggable={false} style={{ objectPosition: focal }} />
          ) : (
            <div className="bm-ph" />
          )}
        </div>
      </>
    );
  } else if (template === 'SPLIT') {
    const slices = imageUrl ? (
      <>
        <div className="bm-slice bm-slice-first" style={{ backgroundImage: `url("${imageUrl}")`, backgroundPosition: `center 0%` }} />
        <div className="bm-slice" style={{ backgroundImage: `url("${imageUrl}")`, backgroundPosition: `center 50%` }} />
        <div className="bm-slice bm-slice-last" style={{ backgroundImage: `url("${imageUrl}")`, backgroundPosition: `center 100%` }} />
      </>
    ) : (
      <div className="bm-ph" />
    );
    imageArea = <div className="bm-img">{slices}</div>;
  } else if (template === 'FLIP') {
    imageArea = (
      <div className="bm-flip-inner">
        <div className="bm-face">{imgEl}</div>
        <div className="bm-face bm-face-back">
          {imageUrl ? (
            <img src={imageUrl} alt="" draggable={false} style={{ objectPosition: focal }} />
          ) : (
            <div className="bm-ph" />
          )}
        </div>
      </div>
    );
  } else if (template === 'OFFSET') {
    imageArea = (
      <>
        {imageUrl ? (
          <div className="bm-back" style={{ backgroundImage: `url("${imageUrl}")`, backgroundPosition: focal }} />
        ) : null}
        <div className="bm-img">{imgEl}</div>
      </>
    );
  } else {
    imageArea = <div className="bm-img">{imgEl}</div>;
  }

  // باگ ۳: در حینِ تایپ، استور لمس نمی‌شود؛ فقط در ثبتِ نهایی.
  const commitEditing = () => {
    if (!bookmark) return;
    const stored = bookmark.name || '';
    const finalName = draftName.trim().slice(0, 30);
    setIsEditing(false);
    if (finalName !== stored && onRename) onRename(bookmark, finalName);
  };
  const cancelEditing = () => {
    // باگ ۴: پرچم، پیش از آنمانت شدنِ اینپوت ست می‌شود تا onBlurِ
    // پس از آن، لغو را دوباره ذخیره نکند.
    skipBlurCommitRef.current = true;
    setIsEditing(false);
  };
  const stopKey = (e) => {
    // باگ ۱: کلیدها به شورت‌کات‌هایِ سراسری نمی‌رسند (useKeyboard
    // خودش هم INPUT را نادیده می‌گیرد؛ این، کمربندِ دوم است).
    e.stopPropagation();
    if (e.nativeEvent && typeof e.nativeEvent.stopImmediatePropagation === 'function') {
      e.nativeEvent.stopImmediatePropagation();
    }
  };
  const handleInputKeyDown = (e) => {
    stopKey(e);
    if (e.key === 'Enter') {
      e.preventDefault();
      skipBlurCommitRef.current = true;
      commitEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    }
  };
  const handleInputBlur = () => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }
    commitEditing();
  };
  const startEditing = (e) => {
    if (e) e.stopPropagation();
    if (!onRename) return;
    skipBlurCommitRef.current = false;
    setDraftName(label);
    setIsEditing(true);
  };

  // مرحلهٔ ۴۰ §۳ — موتورِ درگِ ۶۰ فریم با آپدیتِ مستقیمِ DOM:
  // به‌جایِ setState در هر پیکسل (ری‌رندرِ React)، موقعیتِ کادرِ
  // والدِ مارکر (که top آن، همان فرمولِ calc(yRatio*100% - 12px)
  // است) مستقیم با requestAnimationFrame به‌روز می‌شود. صفحه، با
  // زنجیرهٔ [data-page-number] / [data-bookmark-page] /
  // .comic-page-item / .pdf-page-wrapper / .comic-page-frame پیدا
  // می‌شود (دو کلاسِ آخر در این کدبیس نیستند، ولی برایِ سازگاری در
  // زنجیره مانده‌اند). نسبت، همان فرمولِ پرامپت است
  // (کلمپِ 0.02 تا 0.92) و ذخیره، فقط در pointerup با (id, ratio).
  // تغییرِ سمت (چپ/راست) در این موتور نیست؛ سمت، از استودیو عوض می‌شود.
  const handleMarkerPointerDown = (e) => {
    // توقفِ فوریِ رویداد پیش از هر گارد، تا useDragPan یا لایهٔ
    // صفحه آن را نگیرد.
    e.stopPropagation();
    const moveFn = onMoveBookmark || onMove;
    if (!moveFn || isEditing) return;
    if (e.button !== 0) return;
    const tgt = e.target;
    if (tgt && typeof tgt.closest === 'function' && tgt.closest('.bm-name, .bm-name-input, .bm-x')) return;
    const markerEl = e.currentTarget;
    const pageEl = markerEl.closest('[data-page-number]')
      || markerEl.closest('[data-bookmark-page]')
      || markerEl.closest('.comic-page-item')
      || markerEl.closest('.pdf-page-wrapper')
      || markerEl.closest('.comic-page-frame')
      || markerEl.parentElement;
    if (!pageEl) return;
    e.preventDefault();
    suppressClickRef.current = false;
    const markerRect = markerEl.getBoundingClientRect();
    const grabOffsetY = e.clientY - markerRect.top;
    // عنصرِ موقعیت‌دار، کادرِ والدِ مارکر است؛ style.top رویِ خودِ
    // مارکر (position:relative) درصد را نسبت به کادرِ ۲۷۰ پیکسلی
    // حساب می‌کرد، نه نسبت به صفحه.
    const posEl = markerEl.parentElement;
    if (!posEl) return;
    const dragState = {
      startX: e.clientX,
      startY: e.clientY,
      grabOffsetY,
      hasMoved: false,
      movedPx: 0,
      lastRatio: typeof bookmark.yRatio === 'number' ? bookmark.yRatio : 0,
      rafId: 0,
      pendingRatio: null,
    };
    dragRef.current = dragState;
    try { markerEl.setPointerCapture(e.pointerId); } catch (_) {}
    markerEl.style.cursor = 'grabbing';
    const applyRatio = (ratio) => {
      posEl.style.top = `calc(${ratio * 100}% - 12px)`;
    };
    const scheduleApply = (ratio) => {
      dragState.pendingRatio = ratio;
      if (dragState.rafId) return;
      dragState.rafId = requestAnimationFrame(() => {
        dragState.rafId = 0;
        if (dragState.pendingRatio !== null) applyRatio(dragState.pendingRatio);
      });
    };
    const handleMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (dist > d.movedPx) d.movedPx = dist;
      if (!d.hasMoved && d.movedPx > 3) d.hasMoved = true;
      const rect = pageEl.getBoundingClientRect();
      if (!rect.height) return;
      const nextRatio = computeBookmarkDragRatio(ev.clientY, rect.top, rect.height, d.grabOffsetY);
      d.lastRatio = nextRatio;
      scheduleApply(nextRatio);
    };
    const cleanupDragListeners = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
    };
    const finishDrag = (commit) => {
      cleanupDragListeners();
      const d = dragRef.current;
      dragRef.current = null;
      if (dragState.rafId) cancelAnimationFrame(dragState.rafId);
      markerEl.style.cursor = '';
      if (!d) return;
      if (commit && d.hasMoved) {
        suppressClickRef.current = true;
        // topِ مستقیم، همان مقدارِ نهایی است؛ React با همان فرمولِ
        // calc دوباره رندر می‌کند، پس نیازی به پاک کردن نیست.
        const fn = onMoveBookmark || onMove;
        if (fn) fn(bookmark.id, d.lastRatio);
      } else {
        posEl.style.top = '';
      }
    };
    const handleUp = () => { finishDrag(true); };
    const handleCancel = () => { finishDrag(false); };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
  };

  return (
    <div
      className={`bm-marker bm--${template} bm--side-${bookmark.side === 'left' ? 'left' : 'right'}`}
      title={label}
      onPointerDown={handleMarkerPointerDown}
      onMouseDown={(e) => { e.stopPropagation(); }}
      onClick={(e) => {
        e.stopPropagation();
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        if (onOpen) onOpen(bookmark);
      }}
    >
      {onDelete ? (
        <button
          type="button"
          className="bm-x"
          title="حذف بوک‌مارک"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(bookmark);
          }}
        >
          <Icons.X size={12} />
        </button>
      ) : null}
      <div className="bm-spine" />
      <div className="bm-bridge" />
      {imageArea}
      {isEditing ? (
        <input
          ref={inputRef}
          className="bm-name-input"
          type="text"
          value={draftName}
          maxLength={30}
          dir="auto"
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onKeyUp={stopKey}
          onKeyPress={stopKey}
          onBlur={handleInputBlur}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className="bm-name"
          onMouseDown={(e) => { if (onRename) e.stopPropagation(); }}
          onPointerDown={(e) => { if (onRename) e.stopPropagation(); }}
          onClick={(e) => { if (onRename) { e.stopPropagation(); startEditing(e); } }}
          onDoubleClick={(e) => { if (onRename) e.stopPropagation(); }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
