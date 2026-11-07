import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { Ref, SVGAttributes } from "react";
import { useImperativeHandle } from "react";

import { cn } from "@/lib/utils";

export interface SparklesIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SparklesIconProps extends SVGAttributes<SVGSVGElement> {
  ref?: Ref<SparklesIconHandle>;
  size?: number;
}

const SPARKLE_VARIANTS: Variants = {
  hover: {
    fill: "currentColor",
    transition: {
      bounce: 0.3,
      delay: 0.15,
      duration: 0.7,
    },
    y: [0, -1, 0, 0],
  },
  initial: {
    fill: "none",
    y: 0,
  },
};

const STAR_VARIANTS: Variants = {
  blink: () => ({
    opacity: [0, 1],
    scale: [0.7, 1],
    transition: {
      duration: 0.25,
      ease: [0.22, 1, 0.36, 1],
    },
  }),
  initial: {
    opacity: 1,
    scale: 1,
    x: 0,
    y: 0,
  },
};

const SparklesIcon = ({
  className,
  size = 28,
  ref,
  ...props
}: SparklesIconProps) => {
  const starControls = useAnimation();
  const sparkleControls = useAnimation();

  useImperativeHandle(ref, () => ({
    startAnimation: () => {
      starControls.start("blink");
      sparkleControls.start("hover");
    },
    stopAnimation: () => {
      sparkleControls.start("initial");
      starControls.start("initial");
    },
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
      <motion.path
        animate={sparkleControls}
        d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
        variants={SPARKLE_VARIANTS}
      />
      <motion.path
        animate={starControls}
        d="M20 3v4"
        variants={STAR_VARIANTS}
      />
      <motion.path
        animate={starControls}
        d="M22 5h-4"
        variants={STAR_VARIANTS}
      />
      <motion.path
        animate={starControls}
        d="M4 17v2"
        variants={STAR_VARIANTS}
      />
      <motion.path
        animate={starControls}
        d="M5 18H3"
        variants={STAR_VARIANTS}
      />
    </svg>
  );
};

export { SparklesIcon };
