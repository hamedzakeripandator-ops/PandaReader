import React from 'react';

// هِلپر پایه با رعایت ۱۰۰٪ فرمت استاندارد Lucide SVG
const SvgBase = ({
  size = 18,
  fill = 'none',
  stroke = 'currentColor',
  className = '',
  style = {},
  children,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill={fill}
    stroke={stroke}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
  >
    {children}
  </svg>
);

export const Icons = {
  // ۱. منوهای اصلی و ناوبری
  Home: (props) => (
    <SvgBase {...props}>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </SvgBase>
  ),

  Library: (props) => (
    <SvgBase {...props}>
      <path d="m16 6 4 14" />
      <path d="M12 6v14" />
      <path d="M8 8v12" />
      <path d="M4 4v16" />
    </SvgBase>
  ),

  BookOpen: (props) => (
    <SvgBase {...props}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </SvgBase>
  ),

  Clock: (props) => (
    <SvgBase {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </SvgBase>
  ),

  Heart: ({ filled = false, fillColor = '#f85149', ...props }) => (
    <SvgBase
      {...props}
      fill={filled ? fillColor : 'none'}
      stroke={filled ? fillColor : 'currentColor'}
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </SvgBase>
  ),

  Download: (props) => (
    <SvgBase {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </SvgBase>
  ),

  Rocket: (props) => (
    <SvgBase {...props}>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </SvgBase>
  ),

  Settings: (props) => (
    <SvgBase {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </SvgBase>
  ),

  Sliders: (props) => (
    <SvgBase {...props}>
      <line x1="4" x2="4" y1="21" y2="14" />
      <line x1="4" x2="4" y1="10" y2="3" />
      <line x1="12" x2="12" y1="21" y2="12" />
      <line x1="12" x2="12" y1="8" y2="3" />
      <line x1="20" x2="20" y1="21" y2="16" />
      <line x1="20" x2="20" y1="12" y2="3" />
      <line x1="2" x2="6" y1="14" y2="14" />
      <line x1="10" x2="14" y1="8" y2="8" />
      <line x1="18" x2="22" y1="16" y2="16" />
    </SvgBase>
  ),

  User: (props) => (
    <SvgBase {...props}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </SvgBase>
  ),

  // ۲. فایل‌ها، پوشه‌ها و پین کتابخانه
  Folder: ({ filled = false, fillColor = 'currentColor', ...props }) => (
    <SvgBase
      {...props}
      fill={filled ? fillColor : 'none'}
      stroke={filled ? fillColor : 'currentColor'}
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </SvgBase>
  ),

  FolderOpen: (props) => (
    <SvgBase {...props}>
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </SvgBase>
  ),

  FolderPlus: (props) => (
    <SvgBase {...props}>
      <path d="M12 10v6" />
      <path d="M9 13h6" />
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </SvgBase>
  ),

  Pin: ({ filled = false, fillColor = '#22d3ee', ...props }) => (
    <SvgBase
      {...props}
      fill={filled ? fillColor : 'none'}
      stroke={filled ? fillColor : 'currentColor'}
    >
      <line x1="12" x2="12" y1="17" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </SvgBase>
  ),

  FileText: (props) => (
    <SvgBase {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </SvgBase>
  ),

  FileArchive: (props) => (
    <SvgBase {...props}>
      <path d="M10 12v-1" />
      <path d="M10 18v-2" />
      <path d="M10 7V6" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M15.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v16a2 2 0 0 0 .274 1.01" />
      <circle cx="10" cy="20" r="2" />
    </SvgBase>
  ),

  Image: (props) => (
    <SvgBase {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </SvgBase>
  ),

  // ۳. جستجو، فیلتر و اکشن‌ها
  Search: (props) => (
    <SvgBase {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </SvgBase>
  ),

  Plus: (props) => (
    <SvgBase {...props}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </SvgBase>
  ),

  Minus: (props) => (
    <SvgBase {...props}>
      <path d="M5 12h14" />
    </SvgBase>
  ),

  Trash: (props) => (
    <SvgBase {...props}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </SvgBase>
  ),

  Check: (props) => (
    <SvgBase {...props}>
      <path d="M20 6 9 17l-5-5" />
    </SvgBase>
  ),

  X: (props) => (
    <SvgBase {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </SvgBase>
  ),

  RefreshCw: (props) => (
    <SvgBase {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </SvgBase>
  ),

  Loader: ({ className = '', ...props }) => (
    <SvgBase {...props} className={`icon-spin ${className}`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </SvgBase>
  ),

  // ۴. جهت‌ها و کنترل‌های ریدر و اسلایدر
  ChevronLeft: (props) => (
    <SvgBase {...props}>
      <path d="m15 18-6-6 6-6" />
    </SvgBase>
  ),

  ChevronRight: (props) => (
    <SvgBase {...props}>
      <path d="m9 18 6-6-6-6" />
    </SvgBase>
  ),

  ChevronDown: (props) => (
    <SvgBase {...props}>
      <path d="m6 9 6 6 6-6" />
    </SvgBase>
  ),

  ChevronUp: (props) => (
    <SvgBase {...props}>
      <path d="m18 15-6-6-6 6" />
    </SvgBase>
  ),

  ArrowUpDown: (props) => (
    <SvgBase {...props}>
      <path d="m21 16-4 4-4-4" />
      <path d="M17 20V4" />
      <path d="m3 8 4-4 4 4" />
      <path d="M7 4v16" />
    </SvgBase>
  ),

  MoveHorizontal: (props) => (
    <SvgBase {...props}>
      <polyline points="18 8 22 12 18 16" />
      <polyline points="6 8 2 12 6 16" />
      <line x1="2" x2="22" y1="12" y2="12" />
    </SvgBase>
  ),

  SkipForward: (props) => (
    <SvgBase {...props}>
      <polygon points="5 4 15 12 5 20 5 4" />
      <line x1="19" x2="19" y1="5" y2="19" />
    </SvgBase>
  ),

  SkipBack: (props) => (
    <SvgBase {...props}>
      <polygon points="19 20 9 12 19 4 19 20" />
      <line x1="5" x2="5" y1="19" y2="5" />
    </SvgBase>
  ),

  Play: (props) => (
    <SvgBase {...props}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </SvgBase>
  ),

  Bookmark: ({ filled = false, fillColor = '#22d3ee', ...props }) => (
    <SvgBase
      {...props}
      fill={filled ? fillColor : 'none'}
      stroke={filled ? fillColor : 'currentColor'}
    >
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </SvgBase>
  ),

  Layers: (props) => (
    <SvgBase {...props}>
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </SvgBase>
  ),

  // ۵. ابزارهای استودیو ویرایش، کادر ابری و زوم باکسی
  MousePointer: (props) => (
    <SvgBase {...props}>
      <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
      <path d="m13 13 6 6" />
    </SvgBase>
  ),

  Cloud: (props) => (
    <SvgBase {...props}>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </SvgBase>
  ),

  ScanSearch: (props) => (
    <SvgBase {...props}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
      <path d="m16 16-1.9-1.9" />
    </SvgBase>
  ),

  ZoomIn: (props) => (
    <SvgBase {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" x2="16.65" y1="21" y2="16.65" />
      <line x1="11" x2="11" y1="8" y2="14" />
      <line x1="8" x2="14" y1="11" y2="11" />
    </SvgBase>
  ),

  ZoomOut: (props) => (
    <SvgBase {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" x2="16.65" y1="21" y2="16.65" />
      <line x1="8" x2="14" y1="11" y2="11" />
    </SvgBase>
  ),

  Eye: (props) => (
    <SvgBase {...props}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </SvgBase>
  ),

  Edit3: (props) => (
    <SvgBase {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </SvgBase>
  ),

  Highlighter: (props) => (
    <SvgBase {...props}>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </SvgBase>
  ),

  PenTool: (props) => (
    <SvgBase {...props}>
      <path d="m12 19 7-7 3 3-7 7-3-3z" />
      <path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="m2 2 7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </SvgBase>
  ),

  ArrowUpRight: (props) => (
    <SvgBase {...props}>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </SvgBase>
  ),

  Square: (props) => (
    <SvgBase {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </SvgBase>
  ),

  Circle: (props) => (
    <SvgBase {...props}>
      <circle cx="12" cy="12" r="10" />
    </SvgBase>
  ),

  Type: (props) => (
    <SvgBase {...props}>
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" x2="15" y1="20" y2="20" />
      <line x1="12" x2="12" y1="4" y2="20" />
    </SvgBase>
  ),

  StickyNote: (props) => (
    <SvgBase {...props}>
      <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z" />
      <polyline points="15 3 15 9 21 9" />
    </SvgBase>
  ),

  Eraser: (props) => (
    <SvgBase {...props}>
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </SvgBase>
  ),

  Undo: (props) => (
    <SvgBase {...props}>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </SvgBase>
  ),

  Redo: (props) => (
    <SvgBase {...props}>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
    </SvgBase>
  ),

  // ۶. ابزارهای اسکرین‌شات، زوم و سیستم
  Camera: (props) => (
    <SvgBase {...props}>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </SvgBase>
  ),

  Scissors: (props) => (
    <SvgBase {...props}>
      <circle cx="6" cy="6" r="3" />
      <path d="M8.12 8.12 12 12" />
      <path d="M20 4 8.12 15.88" />
      <circle cx="6" cy="18" r="3" />
      <path d="M14.8 14.8 20 20" />
    </SvgBase>
  ),

  Copy: (props) => (
    <SvgBase {...props}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </SvgBase>
  ),

  Maximize: (props) => (
    <SvgBase {...props}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </SvgBase>
  ),

  Minimize: (props) => (
    <SvgBase {...props}>
      <path d="M5 12h14" />
    </SvgBase>
  ),

  RotateCw: (props) => (
    <SvgBase {...props}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </SvgBase>
  ),

  Sparkles: (props) => (
    <SvgBase {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </SvgBase>
  ),

  Keyboard: (props) => (
    <SvgBase {...props}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M6 8h.001" />
      <path d="M10 8h.001" />
      <path d="M14 8h.001" />
      <path d="M18 8h.001" />
      <path d="M8 12h.001" />
      <path d="M12 12h.001" />
      <path d="M16 12h.001" />
      <path d="M7 16h10" />
    </SvgBase>
  ),

  Zap: (props) => (
    <SvgBase {...props}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </SvgBase>
  ),

  Info: (props) => (
    <SvgBase {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </SvgBase>
  ),

  AlertTriangle: (props) => (
    <SvgBase {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </SvgBase>
  ),
};

export default Icons;