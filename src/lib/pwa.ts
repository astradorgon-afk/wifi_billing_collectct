/** Registers the service worker and exposes install/online status helpers. */

export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") {
    // SW in dev can serve stale chunks; enable only for production builds.
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("SW registration failed:", err);
    });
  });
}

export function promptInstallPWA(): Promise<boolean> {
  return new Promise((resolve) => {
    const ev = (window as never as { deferredInstall?: Event }).deferredInstall;
    if (!ev) {
      resolve(false);
      return;
    }
    window.addEventListener("appinstalled", () => resolve(true), { once: true });
    (ev as never as { prompt: () => void }).prompt();
  });
}

export function captureInstallPrompt(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    (window as never as { deferredInstall?: Event }).deferredInstall = e;
  });
}
