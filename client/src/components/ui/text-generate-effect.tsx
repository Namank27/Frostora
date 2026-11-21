"use client";

import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";

export const TextGenerateEffect = ({
  words,
  className,
  filter = true,
  duration = 0.5,
}: {
  words: string;
  className?: string;
  filter?: boolean;
  duration?: number;
}) => {
  let wordsArray = words.split(" ");
  // Deviation from the supplied source, verified necessary in
  // the audit probe: the source drives the reveal with motion's
  // scoped `animate("span", …)` from `useAnimate`. In this
  // React 19 + motion v14 stack that animation never applied —
  // with both the source's `[scope.current]` dependency and a
  // stable-refs retry, the words stayed at opacity-0 forever
  // (probe evidence: the demo text was present in the DOM and
  // accessibility tree but invisible in captures, even
  // brightened 4×, while CSS animations on the same page ran
  // normally). The reveal is therefore driven by CSS
  // transitions on the same spans instead: identical start and
  // end values (opacity 0 → 1, blur(10px) → blur(0px)), the
  // same 0.2s per-word stagger and the same duration (the
  // `duration` prop, defaulting to 1 when falsy, as in the
  // source). Markup, classes and the component API are
  // unchanged from the source.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // Two frames so the hidden state paints first and the
    // transition actually animates instead of snapping.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  const renderWords = () => {
    return (
      <div>
        {wordsArray.map((word, idx) => {
          return (
            <span
              key={word + idx}
              className="dark:text-white text-black opacity-0"
              style={{
                opacity: shown ? 1 : 0,
                filter: filter ? (shown ? "blur(0px)" : "blur(10px)") : "none",
                transition: filter
                  ? `opacity ${duration ? duration : 1}s ease ${idx * 0.2}s, filter ${duration ? duration : 1}s ease ${idx * 0.2}s`
                  : `opacity ${duration ? duration : 1}s ease ${idx * 0.2}s`,
              }}
            >
              {word}{" "}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div className={cn("font-bold", className)}>
      <div className="mt-4">
        <div className=" dark:text-white text-black text-2xl leading-snug tracking-wide">
          {renderWords()}
        </div>
      </div>
    </div>
  );
};
