"use client";

import { useState } from "react";

export default function KioskClock({
  deviceToken,
  kioskName,
}: {
  deviceToken: string;
  kioskName: string;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ action: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!/^\d{4,8}$/.test(pin)) {
      setError("Enter your 4 to 8 digit PIN.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);

    // Best-effort location: a device that denies permission or has none
    // (a desktop kiosk with no GPS) still clocks in, just without it.
    const coords = await new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 4000 },
      );
    });

    try {
      const res = await fetch("/api/kiosk/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceToken, pin, ...coords }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not clock in or out.");
        return;
      }
      setResult({ action: body.action });
      setTimeout(() => setResult(null), 3000);
    } finally {
      setBusy(false);
      setPin("");
    }
  }

  return (
    <div className="w-full max-w-xs text-center">
      <h1 className="mb-1 text-lg font-semibold">{kioskName}</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">Enter your PIN to clock in or out</p>

      <div className="mb-4 flex justify-center gap-2" aria-live="polite">
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className={`size-3 rounded-full border border-[var(--border)] ${
              i < pin.length ? "bg-[var(--accent)]" : ""
            }`}
          />
        ))}
      </div>

      {error && (
        <p className="mb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="animate-rise mb-3 text-sm font-medium text-[var(--success)]" role="status">
          {result.action === "clock_in" ? "Clocked in" : "Clocked out"}
        </p>
      )}

      <div className="mb-4 grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d, i) =>
          d === "" ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              className="card py-4 text-xl font-medium transition-colors hover:bg-[var(--bg-subtle)]"
              disabled={busy}
              onClick={() => {
                if (d === "⌫") return setPin((p) => p.slice(0, -1));
                if (pin.length < 8) setPin((p) => p + d);
              }}
            >
              {d}
            </button>
          ),
        )}
      </div>

      <button className="btn-primary w-full" disabled={busy || pin.length < 4} onClick={submit}>
        {busy ? "Working…" : "Clock in / out"}
      </button>
    </div>
  );
}
