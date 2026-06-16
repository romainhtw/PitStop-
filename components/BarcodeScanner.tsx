"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type ScanOutcome = "found" | "duplicate" | "notfound";

export interface ScanResult {
  outcome: ScanOutcome;
  label: string;
  matchedOn?: string;
  // Duplicate confirmation (Task 9) — when present, the result bar shows Add/Skip buttons
  currentCount?: number;
  onAddAnyway?: () => void;
  onSkip?: () => void;
}

interface BarcodeScannerProps {
  onDetected: (code: string) => void;
  onClose: () => void;
  scanResult?: ScanResult | null;
  totalCounted: number;
}

// ── Audio (created once) ──────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null;
function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") audioCtx = new AudioContext();
  return audioCtx;
}
function playTone(type: ScanOutcome) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const cfg = {
      found:     { freq: 1200, dur: 0.10, vol: 0.22 },
      duplicate: { freq: 880,  dur: 0.08, vol: 0.15 },
      notfound:  { freq: 280,  dur: 0.28, vol: 0.18 },
    }[type];
    osc.frequency.value = cfg.freq;
    gain.gain.setValueAtTime(cfg.vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + cfg.dur);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + cfg.dur);
  } catch {}
}
function vibrate(type: ScanOutcome) {
  if (!("vibrate" in navigator)) return;
  const patterns: Record<ScanOutcome, number[]> = {
    found:     [180],
    duplicate: [60],
    notfound:  [100, 60, 100],
  };
  navigator.vibrate(patterns[type]);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function BarcodeScanner({ onDetected, onClose, scanResult, totalCounted }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<ScanOutcome | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const lastCodeRef = useRef<string>("");
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const handleRaw = useCallback((code: string) => {
    if (code === lastCodeRef.current) return;
    lastCodeRef.current = code;
    if (cooldownRef.current) clearTimeout(cooldownRef.current);
    cooldownRef.current = setTimeout(() => { lastCodeRef.current = ""; }, 1600);
    onDetected(code);
  }, [onDetected]);

  // Flash + haptic when parent reports result
  useEffect(() => {
    if (!scanResult) return;
    playTone(scanResult.outcome);
    vibrate(scanResult.outcome);
    setFlash(scanResult.outcome);
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [scanResult]);

  // Start camera — getUserMedia owns the stream, ZXing only decodes
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    setError(null);

    // Open a camera with a forgiving fallback chain — never throws on a fixable constraint.
    async function openCamera(): Promise<MediaStream> {
      const attempts: MediaStreamConstraints[] = [
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        { video: { facingMode: "environment" }, audio: false },
        { video: true, audio: false },
      ];
      let lastErr: unknown = new Error("No camera");
      for (const c of attempts) {
        try { return await navigator.mediaDevices.getUserMedia(c); }
        catch (e) {
          lastErr = e;
          // A permission denial won't be fixed by another constraint — bail immediately
          if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "PermissionDeniedError")) throw e;
        }
      }
      throw lastErr;
    }

    // Best-effort: avoid a "Virtual Camera" (phone-as-webcam) on desktop. NEVER fatal.
    async function pickBestDeviceId(): Promise<string | undefined> {
      try {
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        if (devices.length <= 1) return undefined;
        const lbl = (d: MediaDeviceInfo) => d.label.toLowerCase();
        const isVirtual = (d: MediaDeviceInfo) => /virtual|obs\b|snap camera|droidcam|iriun|epoccam|manycam/.test(lbl(d));
        const rear = devices.find((d) => !isVirtual(d) && /back|rear|environment|world/.test(lbl(d)));
        const real = devices.find((d) => !isVirtual(d));
        return (rear ?? real)?.deviceId || undefined;
      } catch {
        return undefined;
      }
    }

    async function start() {
      try {
        // 1. Open camera (also unlocks device labels for the switch below)
        stream = await openCamera();
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

        // 2. If we landed on a virtual camera but a real one exists, switch — but if the
        //    switch fails for any reason, KEEP the original stream (don't error out).
        try {
          const bestId = await pickBestDeviceId();
          const currentId = stream.getVideoTracks()[0]?.getSettings().deviceId;
          if (bestId && currentId && bestId !== currentId) {
            const better = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: bestId } }, audio: false });
            stream.getTracks().forEach((t) => t.stop());
            stream = better;
            if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
          }
        } catch { /* keep the original stream */ }

        const video = videoRef.current;
        if (!video || cancelled) return;

        // 3. Show the live feed
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.muted = true;
        await video.play().catch(() => {});

        // 4a. Native BarcodeDetector — fast & reliable on Android Chrome
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const BD: any = (window as any).BarcodeDetector;
        if (BD) {
          let formats: string[] = ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code", "data_matrix", "itf"];
          try {
            const supported: string[] = await BD.getSupportedFormats?.();
            if (Array.isArray(supported) && supported.length) formats = formats.filter((f) => supported.includes(f));
          } catch { /* use default list */ }
          const detector = new BD({ formats });
          const interval = setInterval(async () => {
            if (cancelled || video.readyState < 2) return;
            try {
              const codes = await detector.detect(video);
              if (codes && codes.length && codes[0].rawValue) handleRaw(String(codes[0].rawValue));
            } catch { /* transient frame error — ignore */ }
          }, 250);
          stopRef.current = () => { clearInterval(interval); stream?.getTracks().forEach((t) => t.stop()); };
          return;
        }

        // 4b. Fallback — ZXing decodes the already-playing video element
        const { BrowserMultiFormatReader, BarcodeFormat } = await import("@zxing/browser");
        const { DecodeHintType } = await import("@zxing/library");
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
          BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
          BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.ITF,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        hints.set(DecodeHintType.ASSUME_GS1, true);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100, delayBetweenScanSuccess: 1600 });
        if (cancelled) return;
        const controls = await reader.decodeFromStream(stream, video, (result) => {
          if (cancelled || !result) return;
          handleRaw(result.getText());
        });
        stopRef.current = () => { controls.stop(); stream?.getTracks().forEach((t) => t.stop()); };
      } catch (e) {
        if (cancelled) return;
        stream?.getTracks().forEach((t) => t.stop());
        const name = e instanceof DOMException ? e.name : "";
        setError(name === "NotAllowedError" || name === "PermissionDeniedError" ? "permission_denied" : "retry");
      }
    }

    start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach(t => t.stop());
      stopRef.current?.();
    };
  }, [handleRaw, retryKey]);

  const borderCls =
    flash === "found"     ? "border-green-400"  :
    flash === "duplicate" ? "border-yellow-400" :
    flash === "notfound"  ? "border-red-500"    :
    "border-brand-green/50";

  const overlayBg =
    flash === "found"     ? "bg-green-400/10"  :
    flash === "duplicate" ? "bg-yellow-400/10" :
    flash === "notfound"  ? "bg-red-500/10"    :
    "bg-transparent";

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-4 shrink-0">
        <div>
          <p className="text-white font-semibold text-sm">Scanning</p>
          <p className="text-gray-400 text-xs mt-0.5">Point at any barcode, QR or label</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Live counter */}
          <div className="bg-brand-green text-white rounded-full w-12 h-12 flex flex-col items-center justify-center shadow-lg">
            <span className="text-lg font-bold leading-none">{totalCounted}</span>
            <span className="text-[8px] opacity-75 uppercase tracking-wide">items</span>
          </div>
          <button onClick={onClose} className="text-white text-2xl leading-none hover:text-gray-300 transition-colors w-9 h-9 flex items-center justify-center">
            &times;
          </button>
        </div>
      </div>

      {/* Viewfinder */}
      <div className={`relative flex-1 border-4 transition-colors duration-150 ${borderCls}`}>
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 text-center px-8 gap-4">
            {error === "permission_denied" ? (
              <>
                <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <div>
                  <p className="text-white font-semibold text-sm mb-1">Camera access blocked</p>
                  <p className="text-gray-400 text-xs leading-relaxed">
                    Allow camera access in your browser settings.
                  </p>
                </div>
                <div className="bg-gray-800 rounded-lg px-4 py-3 text-left max-w-xs w-full">
                  <p className="text-gray-300 text-xs font-semibold mb-1.5">To enable:</p>
                  <ol className="text-gray-400 text-xs space-y-1 list-decimal list-inside">
                    <li>Tap the <span className="text-white font-medium">lock icon</span> in the address bar</li>
                    <li>Select <span className="text-white font-medium">Camera → Allow</span></li>
                    <li>Come back and tap Retry</li>
                  </ol>
                </div>
                <button
                  onClick={() => setRetryKey((k) => k + 1)}
                  className="mt-1 px-5 py-2 bg-accent text-white text-sm font-semibold rounded-lg"
                >
                  Retry
                </button>
              </>
            ) : (
              <>
                <svg className="w-10 h-10 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <p className="text-white font-semibold text-sm">Camera couldn&apos;t start</p>
                <p className="text-gray-400 text-xs">The camera may be in use by another app.</p>
                <button
                  onClick={() => setRetryKey((k) => k + 1)}
                  className="mt-1 px-5 py-2 bg-accent text-white text-sm font-semibold rounded-lg"
                >
                  Try again
                </button>
              </>
            )}

            {/* Manual entry fallback — keep counting even if the camera won't start */}
            <div className="w-full max-w-xs mt-2">
              <p className="text-gray-500 text-[11px] mb-1.5">or type / paste a barcode</p>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Enter barcode or SKU…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (v) { handleRaw(v); (e.target as HTMLInputElement).value = ""; }
                  }
                }}
                className="w-full px-3 py-2 text-sm rounded-lg bg-gray-800 border border-gray-700 text-white placeholder:text-gray-500 focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        ) : (
          <>
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted autoPlay />
            <div className={`absolute inset-0 pointer-events-none transition-colors duration-150 ${overlayBg}`} />
            {/* Target guide */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-72 h-44">
                {["top-0 left-0 border-t-2 border-l-2", "top-0 right-0 border-t-2 border-r-2",
                  "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"]
                  .map((cls, i) => <div key={i} className={`absolute w-6 h-6 border-white/60 ${cls}`} />)}
                <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-px bg-brand-green/70 animate-pulse" />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Always-available manual entry — for printed text codes / SKUs that aren't barcodes */}
      {!error && (
        <div className="shrink-0 px-4 py-2 bg-gray-950 border-t border-gray-800">
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="Or type / paste an item code or SKU, then Enter"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) { handleRaw(v); (e.target as HTMLInputElement).value = ""; }
              }
            }}
            className="w-full px-3 py-2 text-sm rounded-lg bg-gray-800 border border-gray-700 text-white placeholder:text-gray-500 focus:outline-none focus:border-accent"
          />
        </div>
      )}

      {/* Result bar */}
      <div className="shrink-0 min-h-[60px] flex items-center px-5 py-3 bg-gray-950">
        {scanResult ? (
          scanResult.outcome === "duplicate" && scanResult.onAddAnyway ? (
            /* Re-scan confirmation (Task 9) */
            <div className="flex items-center gap-3 w-full">
              <span className="text-xl leading-none font-bold text-yellow-400 shrink-0">⚠</span>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{scanResult.label}</p>
                <p className="text-[11px] mt-0.5 text-yellow-500/90">
                  Already counted{scanResult.currentCount != null ? ` (qty ${scanResult.currentCount})` : ""} — duplicate?
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => scanResult.onSkip?.()}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"
                >
                  Skip
                </button>
                <button
                  onClick={() => scanResult.onAddAnyway?.()}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white hover:bg-accent-dim"
                >
                  Add anyway +1
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 w-full">
              <span className={`text-xl leading-none font-bold ${
                scanResult.outcome === "found"     ? "text-green-400"  :
                scanResult.outcome === "duplicate" ? "text-yellow-400" : "text-red-400"
              }`}>
                {scanResult.outcome === "found" ? "✓" : scanResult.outcome === "duplicate" ? "↑" : "✗"}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{scanResult.label}</p>
                <p className="text-[10px] mt-0.5">
                  {scanResult.outcome === "found"     && <span className="text-gray-500 uppercase tracking-wide">matched on {scanResult.matchedOn}</span>}
                  {scanResult.outcome === "duplicate" && <span className="text-yellow-500/70">Already scanned — qty incremented</span>}
                  {scanResult.outcome === "notfound"  && <span className="text-red-400/70">No match — check SKU or add to catalog</span>}
                </p>
              </div>
            </div>
          )
        ) : (
          <p className="text-gray-600 text-xs mx-auto">Waiting for scan…</p>
        )}
      </div>
    </div>
  );
}
