import type { Transition, Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { Ref, SVGAttributes } from "react";
import { useImperativeHandle } from "react";

import { cn } from "@/lib/utils";

export interface BotIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface BotIconProps extends SVGAttributes<SVGSVGElement> {
  ref?: Ref<BotIconHandle>;
  size?: number;
}

const BLINK_TRANSITION: Transition = {
  duration: 0.18,
  ease: [0.4, 0, 0.2, 1],
};

const EYE_VARIANTS: Variants = {
  animate: {
    transition: {
      duration: 0.32,
      ease: [0.4, 0, 0.2, 1],
      times: [0, 0.35, 0.45, 0.62, 0.72, 1],
    },
    y1: [13, 13.8, 14, 14, 13.8, 13],
    y2: [15, 14.2, 14, 14, 14.2, 15],
  },
  normal: {
    y1: 13,
    y2: 15,
  },
};

const BotIcon = ({ className, size = 28, ref, ...props }: BotIconProps) => {
  const controls = useAnimation();

  useImperativeHandle(ref, () => ({
    startAnimation: () => controls.start("animate"),
    stopAnimation: () => controls.start("normal"),
  }));

  return (
    <svg
      aria-hidden="true"
      className={cn(className)}
      {...props}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 8V4H8" />
      <rect height="12" rx="2" width="16" x="4" y="8" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <motion.line
        animate={controls}
        initial="normal"
        transition={BLINK_TRANSITION}
        variants={EYE_VARIANTS}
        x1={9}
        x2={9}
      />
      <motion.line
        animate={controls}
        initial="normal"
        transition={BLINK_TRANSITION}
        variants={EYE_VARIANTS}
        x1={15}
        x2={15}
      />
    </svg>
  );
};

export { BotIcon };
