"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw !== pw2) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/api/v1/auth/reset-password", {
        method: "POST",
        body: { email, code, new_password: pw },
      });
      setDone(true);
      // Wait a beat so the user sees the success state, then send them to sign in.
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      const e = err as ApiError;
      setError(e.message || "Reset failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="text-center py-4">
        <div className="text-[22px] font-semibold tracking-[-0.02em] mb-2">Password updated</div>
        <div className="text-[13.5px] text-[var(--text-muted)]">
          All existing sessions were invalidated. Redirecting you to sign in…
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <Field label="Email">
        <Input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>
      <Field label="6-digit code from your email">
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          required
          autoFocus
        />
      </Field>
      <Field label="New password" hint="At least 8 characters, with a digit">
        <Input
          type="password"
          placeholder="New password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          required
          minLength={8}
        />
      </Field>
      <Field label="Confirm new password">
        <Input
          type="password"
          placeholder="Confirm password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          required
        />
      </Field>

      {error && <div className="text-xs text-[var(--danger)]">{error}</div>}

      <Button type="submit" variant="primary" disabled={submitting} full size="lg" className="mt-2">
        {submitting ? <><Spinner size={14} /> Updating password…</> : "Update password"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell tagline="One last step.">
      <div className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] m-0">Choose a new password</h1>
        <div className="text-[13.5px] text-[var(--text-muted)] mt-1.5">
          The 6-digit code expires in 10 minutes. Resetting also signs out every
          existing session for your account.
        </div>
      </div>

      {/* useSearchParams must be inside a Suspense boundary in the App Router. */}
      <Suspense fallback={<div className="text-sm text-[var(--text-muted)]">Loading…</div>}>
        <ResetForm />
      </Suspense>

      <div className="mt-5 text-center text-[13px] text-[var(--text-muted)]">
        Need a new code? <Link href="/forgot-password" className="text-[var(--text)] font-medium">Send another</Link>
      </div>
    </AuthShell>
  );
}
