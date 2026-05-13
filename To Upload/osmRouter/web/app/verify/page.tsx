"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError, fetchCSRF } from "@/lib/api";

function VerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const devOtp = params.get("dev_otp") ?? "";

  const [digits, setDigits] = useState<string[]>(devOtp ? devOtp.split("").slice(0, 6) : ["", "", "", "", "", ""]);
  const [timer, setTimer] = useState(45);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (timer <= 0) return;
    const t = setTimeout(() => setTimer((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [timer]);

  const tryVerify = async (code: string) => {
    setVerifying(true);
    setError(false);
    try {
      await api("/api/v1/auth/verify-otp", { method: "POST", body: { email, code } });
      await fetchCSRF().catch(() => {});
      router.push("/dashboard");
    } catch (err) {
      const e = err as ApiError;
      setError(true);
      setVerifying(false);
      console.warn("verify failed", e);
    }
  };

  const setDigit = (i: number, val: string) => {
    if (!/^[0-9]?$/.test(val)) return;
    setError(false);
    const next = [...digits];
    next[i] = val;
    setDigits(next);
    if (val && i < 5) refs.current[i + 1]?.focus();
    if (next.every((d) => d) && !verifying) {
      void tryVerify(next.join(""));
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const txt = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (txt.length === 6) {
      e.preventDefault();
      setDigits(txt.split(""));
      void tryVerify(txt);
    }
  };

  // Auto-submit if dev_otp was passed (E2E convenience)
  useEffect(() => {
    if (devOtp.length === 6 && email) {
      void tryVerify(devOtp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthShell tagline="A 6-digit code is on its way.">
      <div className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] m-0">Verify your email</h1>
        <div className="text-[13.5px] text-[var(--text-muted)] mt-1.5">
          We sent a code to <span className="text-[var(--text)] mono">{email}</span>
        </div>
      </div>

      <div className="flex gap-2 mb-4.5" onPaste={onPaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            value={d}
            onChange={(e) => setDigit(i, e.target.value.slice(-1))}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
            }}
            maxLength={1}
            inputMode="numeric"
            disabled={verifying}
            className={`w-[50px] h-14 text-center text-[22px] font-medium mono bg-[var(--bg-panel)] rounded-xl outline-0 text-[var(--text)] transition-all border ${
              error ? "border-[var(--danger)]" : d ? "border-[var(--accent-line)]" : "border-[var(--border)]"
            } focus:shadow-[0_0_0_3px_var(--accent-soft)]`}
          />
        ))}
      </div>

      {verifying && (
        <div className="flex items-center gap-2 text-[13px] text-[var(--accent)] mb-3">
          <Spinner size={12} /> Verifying…
        </div>
      )}
      {error && !verifying && (
        <div className="text-[13px] text-[var(--danger)] mb-3">That code didn&apos;t match. Try again.</div>
      )}

      <div className="text-[12.5px] text-[var(--text-muted)]">
        {timer > 0 ? (
          <>Didn&apos;t get it? Resend in <span className="mono">{timer}s</span></>
        ) : (
          <a className="cursor-pointer text-[var(--text)] font-medium" onClick={() => setTimer(45)}>Resend code</a>
        )}
      </div>
    </AuthShell>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Spinner size={18} /></div>}>
      <VerifyInner />
    </Suspense>
  );
}
