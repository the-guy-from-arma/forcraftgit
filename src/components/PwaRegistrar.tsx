"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PwaRegistrar() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      const registerServiceWorker = () => {
        void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
          console.warn("[pwa] service worker registration failed", error);
        });
      };

      if (document.readyState === "complete") registerServiceWorker();
      else window.addEventListener("load", registerServiceWorker, { once: true });
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };

    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches || Boolean((window.navigator as any).standalone);
    setShowIosHint(isIos && !isStandalone);

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", () => {
      setInstallPrompt(null);
      setShowIosHint(false);
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, []);

  if (dismissed) return null;

  if (showIosHint && !installPrompt) {
    return (
      <div className="pwa-ios-hint" role="status">
        <strong>Add CoreOne website to iPhone</strong>
        <span>In Safari, open Share, then choose Add to Home Screen. This stays a website PWA.</span>
        <button onClick={() => setDismissed(true)}>Got it</button>
      </div>
    );
  }

  if (!installPrompt) return null;

  return (
    <button
      className="pwa-install-button"
      onClick={async () => {
        await installPrompt.prompt();
        await installPrompt.userChoice;
        setInstallPrompt(null);
      }}
    >
      Add Website
    </button>
  );
}
