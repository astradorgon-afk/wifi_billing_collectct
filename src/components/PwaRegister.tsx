"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/pwa";

/** Client-only component that registers the service worker after mount. */
export function PwaRegister() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
