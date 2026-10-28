// src/components/common/Icons.jsx
// بانک یکپارچه آیکون‌ها — مبتنی بر پکیج lucide-react
//
// API عمومی دقیقاً مثل قبل حفظ شده تا هیچ مصرف‌کننده‌ای لازم نباشد تغییر کند:
//   import { Icons } from '../common/Icons';
//   <Icons.Home size={20} />
//   <Icons.Heart filled fillColor="#f85149" />
//   <Icons.Loader className="my-spinner" />
//
// تغییرات نسبت به نسخه قبلی:
// - حذف ~۶۰۰ خط path دستی SVG (حالا از پکیج نگهداری‌شده می‌آید)
// - فیکس باگ: Minimize قبلاً تکراریِ Minus بود؛ حالا آیکون واقعی Lucide است
// - حذف ایمپورت استفاده‌نشده React
// - دیفالت size=18 و استایل پایه قبلی حفظ شده (برابری بصری ۱:۱)

import {
  Home,
  Library,
  BookOpen,
  Clock,
  Heart,
  Download,
  Save,
  Rocket,
  Settings,
  SlidersHorizontal,
  User,
  Folder,
  FolderOpen,
  FolderPlus,
  Pin,
  FileText,
  FileArchive,
  Image,
  Search,
  Plus,
  Minus,
  Trash2,
  Check,
  X,
  RefreshCw,
  LoaderCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  MoveHorizontal,
  SkipForward,
  SkipBack,
  Play,
  Bookmark,
  BringToFront,
  Layers,
  MousePointer2,
  Cloud,
  ScanSearch,
  SendToBack,
  ZoomIn,
  ZoomOut,
  Eye,
  PenLine,
  Highlighter,
  PenTool,
  ArrowUpRight,
  Square,
  Circle,
  Type,
  StickyNote,
  Eraser,
  Undo2,
  Redo2,
  Camera,
  Scissors,
  Copy,
  Maximize,
  Minimize,
  RotateCw,
  Sparkles,
  Keyboard,
  Zap,
  Info,
  TriangleAlert,
} from 'lucide-react';

// استایل پایه‌ای که قبلاً در SvgBase هاردکد شده بود — در چیدمان نقش دارد
const BASE_STYLE = { flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' };

// آیکون معمولی با حفظ دیفالت‌های قبلی (size=18)
const withBase = (LucideIcon, displayName) => {
  const Wrapped = ({ size = 18, style = {}, ...props }) => (
    <LucideIcon size={size} style={{ ...BASE_STYLE, ...style }} {...props} />
  );
  Wrapped.displayName = displayName;
  return Wrapped;
};

// آیکون‌های دارای حالت filled (رفتار قبلی: مقادیر صریح fill/color برنده‌اند)
const withFill = (LucideIcon, defaultFillColor, displayName) => {
  const Wrapped = ({
    filled = false,
    fillColor = defaultFillColor,
    size = 18,
    style = {},
    ...props
  }) => (
    <LucideIcon
      size={size}
      style={{ ...BASE_STYLE, ...style }}
      {...props}
      fill={filled ? fillColor : 'none'}
      color={filled ? fillColor : 'currentColor'}
    />
  );
  Wrapped.displayName = displayName;
  return Wrapped;
};

// لودر چرخان — به کلاس icon-spin در index.css وابسته است
const Loader = ({ className = '', size = 18, style = {}, ...props }) => (
  <LoaderCircle
    size={size}
    style={{ ...BASE_STYLE, ...style }}
    className={`icon-spin${className ? ` ${className}` : ''}`}
    {...props}
  />
);
Loader.displayName = 'Icons.Loader';

export const Icons = {
  // ۱. منوهای اصلی و ناوبری
  Home: withBase(Home, 'Icons.Home'),
  Library: withBase(Library, 'Icons.Library'),
  BookOpen: withBase(BookOpen, 'Icons.BookOpen'),
  Clock: withBase(Clock, 'Icons.Clock'),
  Heart: withFill(Heart, '#f85149', 'Icons.Heart'),
  Download: withBase(Download, 'Icons.Download'),
  Save: withBase(Save, 'Icons.Save'), // lucide: save — مرحله ۵ بخش ب: دکمهٔ ذخیرهٔ درجا
  Rocket: withBase(Rocket, 'Icons.Rocket'),
  Settings: withBase(Settings, 'Icons.Settings'),
  Sliders: withBase(SlidersHorizontal, 'Icons.Sliders'), // lucide: sliders-horizontal
  User: withBase(User, 'Icons.User'),

  // ۲. فایل‌ها، پوشه‌ها و پین کتابخانه
  Folder: withFill(Folder, 'currentColor', 'Icons.Folder'),
  FolderOpen: withBase(FolderOpen, 'Icons.FolderOpen'),
  FolderPlus: withBase(FolderPlus, 'Icons.FolderPlus'),
  Pin: withFill(Pin, '#22d3ee', 'Icons.Pin'),
  FileText: withBase(FileText, 'Icons.FileText'),
  FileArchive: withBase(FileArchive, 'Icons.FileArchive'),
  Image: withBase(Image, 'Icons.Image'),

  // ۳. جستجو، فیلتر و اکشن‌ها
  Search: withBase(Search, 'Icons.Search'),
  Plus: withBase(Plus, 'Icons.Plus'),
  Minus: withBase(Minus, 'Icons.Minus'),
  Trash: withBase(Trash2, 'Icons.Trash'), // lucide: trash-2
  Check: withBase(Check, 'Icons.Check'),
  X: withBase(X, 'Icons.X'),
  RefreshCw: withBase(RefreshCw, 'Icons.RefreshCw'),
  Loader,

  // ۴. جهت‌ها و کنترل‌های ریدر و اسلایدر
  ChevronLeft: withBase(ChevronLeft, 'Icons.ChevronLeft'),
  ChevronRight: withBase(ChevronRight, 'Icons.ChevronRight'),
  ChevronDown: withBase(ChevronDown, 'Icons.ChevronDown'),
  ChevronUp: withBase(ChevronUp, 'Icons.ChevronUp'),
  ArrowUpDown: withBase(ArrowUpDown, 'Icons.ArrowUpDown'),
  MoveHorizontal: withBase(MoveHorizontal, 'Icons.MoveHorizontal'),
  SkipForward: withBase(SkipForward, 'Icons.SkipForward'),
  SkipBack: withBase(SkipBack, 'Icons.SkipBack'),
  Play: withBase(Play, 'Icons.Play'),
  Bookmark: withFill(Bookmark, '#22d3ee', 'Icons.Bookmark'),
  Layers: withBase(Layers, 'Icons.Layers'),

  // ۵. ابزارهای استودیو ویرایش، کادر ابری و زوم باکسی
  MousePointer: withBase(MousePointer2, 'Icons.MousePointer'), // lucide: mouse-pointer-2
  Cloud: withBase(Cloud, 'Icons.Cloud'),
  ScanSearch: withBase(ScanSearch, 'Icons.ScanSearch'),
  ZoomIn: withBase(ZoomIn, 'Icons.ZoomIn'),
  ZoomOut: withBase(ZoomOut, 'Icons.ZoomOut'),
  Eye: withBase(Eye, 'Icons.Eye'),
  Edit3: withBase(PenLine, 'Icons.Edit3'), // lucide: pen-line (ex edit-3)
  Highlighter: withBase(Highlighter, 'Icons.Highlighter'),
  PenTool: withBase(PenTool, 'Icons.PenTool'),
  ArrowUpRight: withBase(ArrowUpRight, 'Icons.ArrowUpRight'),
  Square: withBase(Square, 'Icons.Square'),
  Circle: withBase(Circle, 'Icons.Circle'),
  Type: withBase(Type, 'Icons.Type'),
  StickyNote: withBase(StickyNote, 'Icons.StickyNote'),
  Eraser: withBase(Eraser, 'Icons.Eraser'),
  Undo: withBase(Undo2, 'Icons.Undo'), // lucide: undo-2
  Redo: withBase(Redo2, 'Icons.Redo'), // lucide: redo-2
  BringToFront: withBase(BringToFront, 'Icons.BringToFront'),
  SendToBack: withBase(SendToBack, 'Icons.SendToBack'),

  // ۶. ابزارهای اسکرین‌شات، زوم و سیستم
  Camera: withBase(Camera, 'Icons.Camera'),
  Scissors: withBase(Scissors, 'Icons.Scissors'),
  Copy: withBase(Copy, 'Icons.Copy'),
  Maximize: withBase(Maximize, 'Icons.Maximize'),
  // فیکس: نسخه قبلی تکراریِ Minus بود — حالا آیکون واقعی minimize
  Minimize: withBase(Minimize, 'Icons.Minimize'),
  RotateCw: withBase(RotateCw, 'Icons.RotateCw'),
  Sparkles: withBase(Sparkles, 'Icons.Sparkles'),
  Keyboard: withBase(Keyboard, 'Icons.Keyboard'),
  Zap: withBase(Zap, 'Icons.Zap'),
  Info: withBase(Info, 'Icons.Info'),
  AlertTriangle: withBase(TriangleAlert, 'Icons.AlertTriangle'), // lucide: triangle-alert
};

export default Icons;
