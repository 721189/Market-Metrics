/**
 * Shared motion primitives for the Market-Metrics UI.
 *
 * `motion` (v12, the framer-motion successor) is already a project dependency;
 * these wrappers keep animation consistent, professional, and accessible:
 *
 *  - `MotionConfig reducedMotion="user"` is applied once at the app root, so
 *    every transform/opacity animation below automatically respects the OS
 *    "reduce motion" setting (no per-component gating needed).
 *  - `AnimatedNumber` tweens a value only when motion is allowed; under
 *    reduced motion it renders the final number immediately.
 *
 * Kept intentionally subtle — an evidence-first tool should feel precise and
 * calm, not playful. Palette stays slate/cyan to match the existing design.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  motion,
  AnimatePresence,
  MotionConfig,
  useReducedMotion,
  useInView,
  animate,
  type Variants,
} from 'motion/react';

// A short, calm entrance used for view content and individual cards.
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
};

// Parent variant that staggers its `staggerItem` children.
export const listStagger: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.03 },
  },
};

// Child variant for `listStagger`.
export const listItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: 'easeOut' } },
};

export { motion, AnimatePresence, MotionConfig };

/**
 * Counts up to `value` when it first scrolls into view. Renders the final
 * value immediately when the user prefers reduced motion.
 */
export const AnimatedNumber: React.FC<{
  value: number;
  duration?: number;
  className?: string;
  suffix?: string;
}> = ({ value, duration = 1.1, className, suffix = '' }) => {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [display, setDisplay] = useState(reduceMotion ? value : 0);

  useEffect(() => {
    if (reduceMotion) {
      setDisplay(value);
      return;
    }
    if (!inView) return;
    const controls = animate(0, value, {
      duration,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, inView, reduceMotion, duration]);

  return (
    <span ref={ref} className={className}>
      {display}
      {suffix}
    </span>
  );
};
