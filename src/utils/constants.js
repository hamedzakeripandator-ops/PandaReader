// src/utils/constants.js

export const DEFAULTS = {
  ZOOM: 1,
  WEBTOON_ZOOM: 1,
  PDF_ZOOM: 1,
  FIT_MODE: 'fit-page',
  HALF_SCREEN: true,
  VIEW_MODE: 'webtoon',
  BRIGHTNESS: 100,
  CONTRAST: 100,
  SATURATION: 100,
  THEME_COLOR: '#ff6b35',
  AUTO_HIDE_DELAY: 3000,
  SIDEBAR_HIDE_DELAY: 5000,
  SIDEBAR_TRIGGER_ZONE: 50
}

export const FIT_MODES = {
  'fit-page': { maxWidth: '70%', maxHeight: '70%' },
  'fit-width': { maxWidth: '90%', maxHeight: 'none' },
  'fit-height': { maxWidth: 'none', maxHeight: '90%' },
  'original': { maxWidth: 'none', maxHeight: 'none' }
}

export const COLOR_PROFILES = {
  normal: '',
  sepia: 'sepia(0.8)',
  grayscale: 'grayscale(1)',
  warm: 'sepia(0.3) saturate(1.5)',
  cool: 'saturate(0.8) hue-rotate(10deg)'
}

export const THEME_COLORS = ['#ff6b35', '#4a9eff', '#ff4757', '#2ed573', '#ffa502', '#a55eea']

export const MENU_ITEMS = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'library', icon: '📚', label: 'Library' },
  { id: 'recent', icon: '', label: 'Recent' },
  { id: 'bookmarks', icon: '🔖', label: 'Bookmarks' },
  { id: 'favorites', icon: '❤️', label: 'Favorites' },
  { id: 'collections', icon: '📁', label: 'Collections' },
  { id: 'settings', icon: '️', label: 'Settings' }
]

export const SHORTCUTS = [
  { key: 'V', desc: 'Toggle Page/Webtoon' },
  { key: 'B', desc: 'Bookmark' },
  { key: 'I', desc: 'Invert colors' },
  { key: 'G', desc: 'Gallery' },
  { key: 'T', desc: 'Thumbnails' },
  { key: 'F', desc: 'Fullscreen' },
  { key: 'H', desc: 'Half/Full screen' },
  { key: 'N', desc: 'Next Comic' },
  { key: 'P', desc: 'Previous Comic' },
  { key: '+/-', desc: 'Zoom' },
  { key: '0', desc: 'Reset zoom' },
  { key: '?', desc: 'Shortcuts' },
  { key: 'Esc', desc: 'Close' }
]