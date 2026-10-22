import React, { useState, useRef, useEffect } from 'react';

/**
 * کامپوننت هوشمند متحرک‌سازی متن‌های طولانی (Marquee Animation)
 * - در صورت کوتاه بودن متن، به صورت استاتیک و بدون انیمیشن نمایش می‌یابد (حفظ ۰٪ CPU)
 * - در صورت طولانی بودن متن و سرریز شدن، به صورت خودکار با شتاب سخت‌افزاری GPU (transform3d)
 *   به صورت رفت و برگشتی نرم حرکت می‌کند.
 */
export default function MarqueeText({
  text = '',
  speed = 28, // پیکسل بر ثانیه
  delay = 1400, // مکث در ابتدا و انتهای پیمایش (میلی‌ثانیه)
  style = {},
  className = '',
  title = '',
  direction = 'ltr'
}) {
  const containerRef = useRef(null);
  const textRef = useRef(null);

  const [overflowDistance, setOverflowDistance] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const checkOverflow = () => {
      if (containerRef.current && textRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const textWidth = textRef.current.scrollWidth;
        const diff = textWidth - containerWidth;
        setOverflowDistance(diff > 4 ? diff : 0);
      }
    };

    checkOverflow();

    const resizeObserver = new ResizeObserver(checkOverflow);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [text]);

  const duration = useMemo(() => {
    if (overflowDistance <= 0) return 0;
    return Math.max(3, overflowDistance / speed);
  }, [overflowDistance, speed]);

  const isOverflowing = overflowDistance > 0;

  // استایل انیمیشن شتاب‌یافته سخت‌افزاری
  const animationStyle = isOverflowing
    ? {
        animationName: 'marquee-scroll-pingpong',
        animationDuration: `${duration}s`,
        animationTimingFunction: 'ease-in-out',
        animationIterationCount: 'infinite',
        animationDirection: 'alternate',
        animationDelay: `${delay}ms`,
        animationPlayState: 'running',
        willChange: 'transform',
      }
    : {};

  return (
    <div
      ref={containerRef}
      title={title || text}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        ...styles.wrapper,
        direction: direction,
        ...style,
      }}
      className={className}
    >
      <span
        ref={textRef}
        style={{
          ...styles.textSpan,
          ...animationStyle,
          // در صورت بزرگ بودن، مسافت جابه‌جایی روی متغیر CSS قرار می‌گیرد
          '--marquee-translate': direction === 'rtl' ? `${overflowDistance}px` : `-${overflowDistance}px`,
        }}
      >
        {text}
      </span>

      {/* تزریق امن کی‌فریم انیمیشن سبک بدون نیاز به تغییر دستی index.css */}
      <style>{`
        @keyframes marquee-scroll-pingpong {
          0%, 15% {
            transform: translate3d(0, 0, 0);
          }
          85%, 100% {
            transform: translate3d(var(--marquee-translate), 0, 0);
          }
        }
      `}</style>
    </div>
  );
}

import { useMemo } from 'react';

const styles = {
  wrapper: {
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    maxWidth: '100%',
    maskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
    WebkitMaskImage: 'linear-gradient(to right, black 85%, transparent 100%)',
  },
  textSpan: {
    display: 'inline-block',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: 'transform 0.1s linear',
  },
};
