import type { Transition, Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { Ref, SVGAttributes } from "react";
import { useImperativeHandle } from "react";

import { cn } from "@/lib/utils";

export interface HomeIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface HomeIconProps extends SVGAttributes<SVGSVGElement> {
  ref?: Ref<HomeIconHandle>;
  size?: number;
}

const DEFAULT_TRANSITION: Transition = {
  duration: 0.6,
  opacity: { duration: 0.2 },
};

const PATH_VARIANTS: Variants = {
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
  },
  normal: {
    opacity: 1,
    pathLength: 1,
  },
};

const HomeIcon = ({ className, size = 28, ref, ...props }: HomeIconProps) => {
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
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <motion.path
        animate={controls}
        d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"
        transition={DEFAULT_TRANSITION}
        variants={PATH_VARIANTS}
      />
    </svg>
  );
};

export { HomeIcon };
