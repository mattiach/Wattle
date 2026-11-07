import type { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent } from "@/components/ui/popover";

const TourContext = createContext<{
  start: (tourId: string) => void;
  close: () => void;
} | null>(null);

function useTour() {
  const context = useContext(TourContext);
  if (!context) {
    throw new Error("useTour must be used within a TourProvider");
  }
  return context;
}

interface Step {
  align?: PopoverPrimitive.Positioner.Props["align"];
  alignOffset?: PopoverPrimitive.Positioner.Props["alignOffset"];
  className?: string;
  content: ReactNode;
  /**
   * Matched against `data-tour-step-id` with a *substring* selector, so no id
   * may be a substring of another: `home` would also spotlight
   * `home-timeline`. Prefix per page and keep siblings distinct.
   */
  id: string;
  // Required: this is a primitive in `components/ui/`, and nothing in here owns
  // copy or reaches for i18n. The words come from the caller that already has
  // them.
  nextLabel: ReactNode;
  nextRoute?: string;
  previousLabel: ReactNode;
  previousRoute?: string;
  side?: PopoverPrimitive.Positioner.Props["side"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
  title: ReactNode;
}

interface Tour {
  id: string;
  steps: Step[];
}

/** A rectangle the popover can be positioned against. */
interface Target {
  key: string;
  radius: number;
  rect: DOMRect;
}

/**
 * Breathing room between the spotlight and what it points at.
 *
 * A cut-out sitting exactly on an element's box reads as a border drawn *on*
 * it rather than around it, and the card then sits flush against the thing it
 * is describing. Applied to the measured rectangle rather than to the drawing,
 * so the mask, the ring and the popover anchor all agree on one shape.
 */
const SPOTLIGHT_PADDING = 10;

/**
 * The tour speaks in the opposite colours to the page it is explaining, the
 * same inversion `tooltip.tsx` uses: ink on paper becomes paper on ink, and
 * flips with the theme because both halves are theme tokens. It is the one
 * surface here that is *about* the screen rather than part of it, so it must
 * not read as another card.
 *
 * The controls need their own overrides - `Button`'s variants are painted for
 * an ordinary surface, and on an inverted one `default` would be dark on dark
 * and `ghost` would vanish entirely.
 */
const TOUR_CARD = "border-transparent bg-foreground text-background";
const TOUR_CLOSE =
  "text-background/70 hover:bg-background/15 hover:text-background";
const TOUR_PREVIOUS =
  "border-background/30 bg-transparent text-background hover:bg-background/15 hover:text-background dark:border-background/30 dark:bg-transparent dark:hover:bg-background/15";
const TOUR_NEXT = "bg-background text-foreground hover:bg-background/85";

const padRect = (rect: DOMRect): DOMRect =>
  new DOMRect(
    rect.left - SPOTLIGHT_PADDING,
    rect.top - SPOTLIGHT_PADDING,
    rect.width + SPOTLIGHT_PADDING * 2,
    rect.height + SPOTLIGHT_PADDING * 2
  );

/**
 * The part of a rectangle that is on screen.
 *
 * What the card is positioned against, and only that: a step pointing at a
 * whole settings section is pointing at something taller than the window, and
 * anchoring to the true rectangle asks Base UI to put a card below a bottom
 * edge that is hundreds of pixels past the fold. It obliges by shoving the card
 * back into view, which lands it on top of the very thing it is describing. The
 * mask still cuts the whole shape - the spotlight is allowed to run off the
 * screen, the card is not.
 */
const clipToViewport = (rect: DOMRect): DOMRect => {
  const top = Math.max(rect.top, 0);
  const left = Math.max(rect.left, 0);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  const right = Math.min(rect.right, window.innerWidth);
  return new DOMRect(
    left,
    top,
    Math.max(right - left, 0),
    Math.max(bottom - top, 0)
  );
};

function TourProvider({
  tours,
  children,
  closeLabel,
  stepLabel,
  onTourEnd,
}: {
  tours: Tour[];
  children: ReactNode;
  /** Accessible name for the dismiss control. */
  closeLabel: string;
  /** Renders "step 2 of 4". A function, because only the caller has the words. */
  stepLabel: (current: number, total: number) => string;
  /**
   * Called once when a tour stops, however it stopped. Without this the
   * provider's state is a closed loop and nothing outside can record that a
   * tour has been seen - which is the whole of its persistence.
   */
  onTourEnd?: (tourId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const activeTour = tours.find((tour) => tour.id === activeTourId);
  const steps = activeTour?.steps || [];

  // Reaching the last step and giving up partway are the same outcome: the tour
  // was offered and is done being offered. Treating a dismissal as "not seen"
  // would show it again next visit, which is what dismissing it said no to.
  const close = useCallback(() => {
    setIsOpen(false);
    setCurrentStepIndex(0);
    setActiveTourId(null);
    if (activeTourId) {
      onTourEnd?.(activeTourId);
    }
  }, [activeTourId, onTourEnd]);

  const next = useCallback(() => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
      return;
    }
    close();
  }, [close, currentStepIndex, steps.length]);

  const previous = useCallback(() => {
    setCurrentStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const start = useCallback(
    (tourId: string) => {
      const tour = tours.find((candidate) => candidate.id === tourId);
      if (tour && tour.steps.length > 0) {
        setActiveTourId(tourId);
        setIsOpen(true);
        setCurrentStepIndex(0);
      }
    },
    [tours]
  );

  return (
    <TourContext.Provider
      value={{
        close,
        start,
      }}
    >
      {children}
      {isOpen && activeTour && steps.length > 0 && (
        <TourOverlay
          closeLabel={closeLabel}
          currentStepIndex={currentStepIndex}
          onClose={close}
          onNext={next}
          onPrevious={previous}
          step={steps[currentStepIndex]}
          stepLabel={stepLabel}
          totalSteps={steps.length}
        />
      )}
    </TourContext.Provider>
  );
}

function TourOverlay({
  closeLabel,
  step,
  stepLabel,
  currentStepIndex,
  totalSteps,
  onNext,
  onPrevious,
  onClose,
}: {
  closeLabel: string;
  step: Step;
  stepLabel: (current: number, total: number) => string;
  currentStepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}) {
  // Kept with the step it was taken for, so a measurement can be told apart
  // from "not measured yet" - the difference between a step that has nothing
  // to point at and one whose effect has simply not run.
  const [measured, setMeasured] = useState<{
    stepId: string;
    targets: Target[];
  } | null>(null);

  useLayoutEffect(() => {
    let needsScroll = true;

    function updatePosition() {
      const elements = Array.from(
        document.querySelectorAll(`[data-tour-step-id*='${step.id}']`)
      ).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 || rect.height > 0;
      });

      const nextTargets = elements.map((element, index) => {
        // `getComputedStyle` gives a length with a unit - "8px" - and
        // `Number("8px")` is NaN, so the original always fell through to the
        // fallback and no spotlight ever matched a real corner.
        const { borderRadius } = window.getComputedStyle(element);
        const radius = Number.parseFloat(borderRadius);

        return {
          key: `${step.id}-${index}`,
          // Grown with the box, so a padded spotlight around a rounded
          // control stays concentric with it instead of pinching in.
          radius: (Number.isNaN(radius) ? 4 : radius) + SPOTLIGHT_PADDING,
          rect: padRect(element.getBoundingClientRect()),
        };
      });

      if (elements.length > 0 && needsScroll) {
        needsScroll = false;
        // Scrolled before it is measured, not after. Measuring first published
        // the rectangle the target had *before* the page moved, and left the
        // card correct only if a scroll event happened to arrive and correct
        // it. And the jump is instant rather than smooth for the same reason:
        // there is no frame in which the spotlight is somewhere the target is
        // not.
        //
        // The page is unlocked around it: this overlay holds the document at
        // `overflow: hidden` for as long as it is up, and a locked document
        // does not scroll for anyone, this included. That is why every step
        // after the first used to point off the bottom of the screen.
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "";
        elements[0].scrollIntoView({
          behavior: "instant",
          // A target taller than the window has no centre worth aiming at:
          // centring it puts its first line above the fold, which is the line
          // the step is usually about.
          block:
            elements[0].getBoundingClientRect().height > window.innerHeight
              ? "start"
              : "center",
        });
        document.body.style.overflow = previousOverflow;
        updatePosition();
        return;
      }

      setMeasured({ stepId: step.id, targets: nextTargets });
    }

    document.body.style.overflow = "hidden";
    updatePosition();
    const handleResizeOrScroll = () => updatePosition();

    window.addEventListener("resize", handleResizeOrScroll);
    window.addEventListener("scroll", handleResizeOrScroll, true);

    // ponytail: re-measures on any mutation anywhere in the body, which is
    // heavy but only while a tour is on screen. Coalesce into a rAF if it ever
    // shows up in a profile.
    const observer = new MutationObserver(updatePosition);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(document.body);

    return () => {
      window.removeEventListener("resize", handleResizeOrScroll);
      window.removeEventListener("scroll", handleResizeOrScroll, true);
      observer.disconnect();
      resizeObserver.disconnect();
      document.body.style.overflow = "";
    };
  }, [step]);

  const targets = measured?.stepId === step.id ? measured.targets : null;

  // A step whose element is not on this screen is stepped over, not shown as
  // nothing.
  //
  // Drawing nothing was a dead end: the card is what carries Next and Close, so
  // a tour that stopped on a step it could not point at could never be finished
  // - and a tour that never finishes is never recorded as seen, which is why it
  // started again on every visit. An empty journal has no timeline, and leaving
  // the page mid-tour takes every remaining target with it, so both of those
  // now walk to the end and end the tour.
  useEffect(() => {
    if (targets?.length === 0) {
      onNext();
    }
  }, [targets, onNext]);

  if (!targets || targets.length === 0) {
    return null;
  }

  // A virtual element: Base UI positions against anything that can report a
  // rectangle, so the spotlighted element does not have to be a trigger.
  const anchorElement = {
    getBoundingClientRect: () => clipToViewport(targets[0].rect),
  };

  return createPortal(
    <div className="fixed inset-0 z-50">
      <svg aria-hidden="true" className="absolute inset-0 size-full">
        <defs>
          <mask id="tour-mask">
            <rect fill="white" height="100%" width="100%" x="0" y="0" />
            {targets.map((target) => (
              <rect
                fill="black"
                height={target.rect.height}
                key={target.key}
                rx={target.radius}
                width={target.rect.width}
                x={target.rect.left}
                y={target.rect.top}
              />
            ))}
          </mask>
        </defs>
        <rect
          className="fill-black opacity-20"
          height="100%"
          mask="url(#tour-mask)"
          width="100%"
        />
        {targets.map((target) => (
          <rect
            className="fill-none stroke-2 stroke-wattle"
            height={target.rect.height}
            key={target.key}
            rx={target.radius}
            width={target.rect.width}
            x={target.rect.left}
            y={target.rect.top}
          />
        ))}
      </svg>
      <Popover key={step.id} open={true}>
        {/* Base UI has no Anchor part: the positioner takes a virtual element
            instead, which is exactly the measured rectangle. */}
        <PopoverContent
          align={step.align}
          alignOffset={step.alignOffset}
          anchor={anchorElement}
          className={cn("w-80 px-0", TOUR_CARD, step.className)}
          // The step is read where the reader is already looking; pulling focus
          // into the popup would move them off the thing being pointed at.
          finalFocus={false}
          initialFocus={false}
          render={<Card />}
          side={step.side}
          // Measured from the padded rectangle, so this is clearance from the
          // ring rather than from the element inside it.
          sideOffset={step.sideOffset ?? 10}
        >
          {/* Plain markup rather than a Card component family: this project's
              Card is a surface, and `dialog.tsx` builds its header and footer
              the same way. */}
          <div className="flex items-start justify-between gap-3 px-4 pt-4">
            <div className="min-w-0">
              <p className="font-heading font-medium text-base leading-none">
                {step.title}
              </p>
              <p className="mt-1.5 text-background/60 text-meta tabular-nums">
                {stepLabel(currentStepIndex + 1, totalSteps)}
              </p>
            </div>
            <Button
              aria-label={closeLabel}
              className={cn("-mt-1 -mr-1 shrink-0", TOUR_CLOSE)}
              onClick={onClose}
              size="icon-sm"
              variant="ghost"
            >
              <XIcon />
            </Button>
          </div>
          <div className="px-4 py-3 text-background/75 text-sm leading-relaxed">
            {step.content}
          </div>
          <div className="flex items-center justify-between gap-2 px-4 pb-4">
            {currentStepIndex > 0 &&
              (step.previousRoute ? (
                <Button
                  className={TOUR_PREVIOUS}
                  nativeButton={false}
                  onClick={onPrevious}
                  render={<Link to={step.previousRoute} />}
                  variant="outline"
                >
                  {step.previousLabel}
                </Button>
              ) : (
                <Button
                  className={TOUR_PREVIOUS}
                  onClick={onPrevious}
                  variant="outline"
                >
                  {step.previousLabel}
                </Button>
              ))}
            {step.nextRoute ? (
              <Button
                className={cn("ml-auto", TOUR_NEXT)}
                nativeButton={false}
                onClick={onNext}
                render={<Link to={step.nextRoute} />}
              >
                {step.nextLabel}
              </Button>
            ) : (
              <Button className={cn("ml-auto", TOUR_NEXT)} onClick={onNext}>
                {step.nextLabel}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>,
    document.body
  );
}

export { TourProvider, useTour, type Step, type Tour };
