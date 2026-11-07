"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { Ref, SVGAttributes } from "react";
import { useImperativeHandle } from "react";

import { cn } from "@/lib/utils";

export interface MailIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface MailIconProps extends SVGAttributes<SVGSVGElement> {
  ref?: Ref<MailIconHandle>;
  size?: number;
}

const FLAP_VARIANTS: Variants = {
  animate: {
    scaleY: [1, 0.92, 1],
    transition: {
      duration: 0.45,
      ease: [0.22, 1, 0.36, 1],
    },
    y: [0, -1.2, 0],
  },
  normal: {
    scaleY: 1,
    y: 0,
  },
};

const MailIcon = ({ className, size = 28, ref, ...props }: MailIconProps) => {
  const flapControls = useAnimation();

  useImperativeHandle(ref, () => ({
    startAnimation: () => flapControls.start("animate"),
    stopAnimation: () => flapControls.start("normal"),
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
      <rect height="16" rx="2" width="20" x="2" y="4" />
      <motion.path
        animate={flapControls}
        d="m2 7 8.97 5.7a1.94 1.94 0 0 0 2.06 0L22 7"
        initial="normal"
        style={{ transformOrigin: "center" }}
        variants={FLAP_VARIANTS}
      />
    </svg>
  );
};

export { MailIcon };
