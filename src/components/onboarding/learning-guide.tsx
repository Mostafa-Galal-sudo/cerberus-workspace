import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  filterTourSteps,
  roleRecap,
  TOUR_STEPS,
  type TourContext,
  type TourStep,
} from '../../lib/onboarding';
import { Button } from '../ui';

interface LearningGuideProps {
  onClose: (finished: boolean) => void;
  mode: 'member' | 'admin' | 'supervisor';
  roles: string[];
}

interface Placement {
  spotlight: { top: number; left: number; width: number; height: number; radius: number } | null;
  card: { top: number; left: number };
  cardAlign: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

const CARD_WIDTH = 330;
const VIEWPORT_MARGIN = 16;
const SPOTLIGHT_PAD = 8;

/** Interactive first-run walkthrough: highlights real UI, navigates real routes.
 *  Mounted only while active — unmounting resets the tour to its first step. */
export function LearningGuide({ onClose, mode, roles }: LearningGuideProps) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement>({
    spotlight: null,
    card: { top: 0, left: 0 },
    cardAlign: 'center',
  });
  const runIdRef = useRef(0);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);

  const context = useMemo<TourContext>(() => ({ mode, roles }), [mode, roles]);
  const steps = useMemo(() => filterTourSteps(TOUR_STEPS, context), [context]);
  const step = steps[index];
  const isLast = index === steps.length - 1;

  const measure = useCallback((currentStep: TourStep | undefined) => {
    if (!currentStep?.selector) {
      setPlacement({ spotlight: null, card: { top: 0, left: 0 }, cardAlign: 'center' });
      return;
    }
    const target = document.querySelector(currentStep.selector);
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spot = {
      top: Math.max(0, rect.top - SPOTLIGHT_PAD),
      left: Math.max(0, rect.left - SPOTLIGHT_PAD),
      width: Math.min(vw, rect.width + SPOTLIGHT_PAD * 2),
      height: rect.height + SPOTLIGHT_PAD * 2,
      radius: 10,
    };

    // Popover placement: prefer the requested side, fall back to whatever fits.
    let cardAlign: Placement['cardAlign'] = currentStep.align ?? 'bottom';
    const fitsRight = rect.right + CARD_WIDTH + VIEWPORT_MARGIN <= vw;
    const fitsLeft = rect.left - CARD_WIDTH - VIEWPORT_MARGIN >= 0;
    const fitsBelow = rect.bottom + 280 <= vh;
    const fitsAbove = rect.top - 280 >= 0;
    if (cardAlign === 'bottom' && !fitsBelow && fitsAbove) cardAlign = 'top';
    if (cardAlign === 'top' && !fitsAbove && fitsBelow) cardAlign = 'bottom';
    if (cardAlign === 'right' && !fitsRight) cardAlign = fitsLeft ? 'left' : fitsBelow ? 'bottom' : 'top';
    if (cardAlign === 'left' && !fitsLeft) cardAlign = fitsRight ? 'right' : fitsBelow ? 'bottom' : 'top';
    if ((cardAlign === 'bottom' || cardAlign === 'top') && !fitsBelow && !fitsAbove) {
      cardAlign = fitsRight ? 'right' : 'left';
    }

    const cardTop =
      cardAlign === 'bottom' ? rect.bottom + 12
      : cardAlign === 'top' ? Math.max(VIEWPORT_MARGIN, rect.top - 12)
      : Math.max(VIEWPORT_MARGIN, Math.min(vh - 300, rect.top));
    const cardLeft =
      cardAlign === 'right' ? rect.right + 12
      : cardAlign === 'left' ? Math.max(VIEWPORT_MARGIN, rect.left - CARD_WIDTH - 12)
      : Math.max(VIEWPORT_MARGIN, Math.min(vw - CARD_WIDTH - VIEWPORT_MARGIN, rect.left));

    setPlacement({ spotlight: spot, card: { top: cardTop, left: cardLeft }, cardAlign });
  }, []);

  // Resolve the current step: navigate if needed, wait for data-driven targets,
  // auto-skip steps whose target does not exist for this user.
  useLayoutEffect(() => {
    const runId = ++runIdRef.current;
    const currentStep = steps[index];
    if (!currentStep) {
      onClose(false);
      return;
    }

    let cancelled = false;
    const go = async () => {
      if (currentStep.route) {
        navigate(currentStep.route);
      }
      if (!currentStep.selector) {
        setPlacement({ spotlight: null, card: { top: 0, left: 0 }, cardAlign: 'center' });
        return;
      }
      const budget = currentStep.waitMillis ?? 1500;
      const started = Date.now();
      for (;;) {
        if (cancelled || runIdRef.current !== runId) return;
        const target = document.querySelector(currentStep.selector);
        if (target instanceof HTMLElement) {
          target.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
          await new Promise((resolve) => setTimeout(resolve, 60));
          if (cancelled || runIdRef.current !== runId) return;
          measure(currentStep);
          return;
        }
        if (Date.now() - started >= budget) {
          // Target never appeared — jump past this step.
          if (isLast) {
            onClose(false);
            return;
          }
          setIndex((i) => i + 1);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    };
    void go();
    return () => {
      cancelled = true;
    };
    // steps/isLast derive from index and context; onClose is stable at the call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Keep the spotlight glued to the target while scrolling, resizing, or when
  // the hover-expanding sidebar pushes the layout.
  useEffect(() => {
    if (!step?.selector) return;
    let raf = 0;
    const remeasure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => measure(step));
    };
    const observer = new ResizeObserver(remeasure);
    observer.observe(document.body);
    window.addEventListener('resize', remeasure);
    window.addEventListener('scroll', remeasure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure, true);
      cancelAnimationFrame(raf);
    };
  }, [step, measure]);

  // Keyboard: Escape skips, arrows move. Focus lands on the primary action.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose(false);
      } else if (event.key === 'ArrowRight' && !isLast) {
        setIndex((i) => Math.min(i + 1, steps.length - 1));
      } else if (event.key === 'ArrowLeft' && index > 0) {
        setIndex((i) => i - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    const focusTimer = setTimeout(() => nextButtonRef.current?.focus(), 80);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(focusTimer);
    };
  }, [index, isLast, steps.length, onClose]);

  if (!step) return null;

  const goNext = () => {
    if (isLast) onClose(true);
    else setIndex((current) => Math.min(current + 1, steps.length - 1));
  };
  const goBack = () => setIndex((current) => Math.max(0, current - 1));

  const body = step.id === 'finish' ? roleRecap(context) : step.body;
  const centered = placement.spotlight === null;

  return (
    <div className="learning-guide" role="dialog" aria-modal="true" aria-label="Learning guide">
      {/* Blocking backdrop */}
      <div className="learning-guide-backdrop" onClick={() => onClose(false)} />

      {/* Spotlight cut-out */}
      {placement.spotlight && (
        <div
          className="learning-guide-spotlight"
          style={{
            top: placement.spotlight.top,
            left: placement.spotlight.left,
            width: placement.spotlight.width,
            height: placement.spotlight.height,
            borderRadius: placement.spotlight.radius,
          }}
        />
      )}

      {/* Explanation card */}
      <div
        className={`learning-guide-card align-${placement.cardAlign}${centered ? ' is-centered' : ''}`}
        style={centered ? undefined : { top: placement.card.top, left: placement.card.left }}
      >
        <div className="learning-guide-head">
          <span className="learning-guide-kicker">Learning guide</span>
          <span className="learning-guide-count">
            {index + 1} / {steps.length}
          </span>
          <button type="button" className="learning-guide-close" onClick={() => onClose(false)} aria-label="Skip the learning guide" title="Skip tour">
            ×
          </button>
        </div>
        <h2 className="learning-guide-title">{step.title}</h2>
        <p className="learning-guide-body">{body}</p>
        <div className="learning-guide-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <i key={s.id} className={i === index ? 'is-active' : i < index ? 'is-done' : ''} />
          ))}
        </div>
        <div className="learning-guide-actions">
          <Button variant="ghost" size="sm" onClick={goBack} disabled={index === 0}>
            Previous
          </Button>
          <Button ref={nextButtonRef} variant="primary" size="sm" onClick={goNext}>
            {isLast ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
