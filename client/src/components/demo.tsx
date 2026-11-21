"use client";

import { useState } from "react";
import { ShinyButton } from "./ui/shiny-button";

export default function DemoOne() {
  const [clicks, setClicks] = useState(0);
  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center gap-4">
      <ShinyButton onClick={() => setClicks((c) => c + 1)}>Get unlimited access</ShinyButton>
      {clicks > 0 && (
        <p className="text-[13px] text-white/60" role="status">
          Clicked {clicks} {clicks === 1 ? "time" : "times"}
        </p>
      )}
    </div>
  );
}
