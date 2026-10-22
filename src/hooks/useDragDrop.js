import { useState, useEffect } from 'react';

export default function useDragDrop(onDropCallback) {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    // جلوگیری از رفتار پیش‌فرض مرورگر
    const preventDefaults = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDragOver = (e) => {
      preventDefaults(e);
      setIsDragging(true);
    };

    const handleDragEnter = (e) => {
      preventDefaults(e);
      setIsDragging(true);
    };

    const handleDragLeave = (e) => {
      preventDefaults(e);
      // فقط وقتی ماوس کاملاً از صفحه خارج شد رنگ رو برگردون
      if (e.clientX === 0 && e.clientY === 0) {
        setIsDragging(false);
      }
    };

    const handleDrop = (e) => {
      preventDefaults(e);
      setIsDragging(false);

      // استخراج امن آدرس فایل‌ها در الکترون
      const files = [];
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const path = e.dataTransfer.files[i].path;
          if (path) files.push(path);
        }
      }

      if (files.length > 0 && onDropCallback) {
        onDropCallback(files);
      }
    };

    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('drop', handleDrop);
    };
  }, [onDropCallback]);

  return { isDragging };
}