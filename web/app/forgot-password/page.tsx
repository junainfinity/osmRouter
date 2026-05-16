"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api("/api/v1/auth/forgot-password", { method: "POST", body: { email } });
      // On success, jump straight to the reset page with the email pre-filled.
      router.push(`/reset-password?email=${encodeURIComponent(email)}`);
    } catch (err) {
      const e = err as ApiError;
      // The server returns EMAIL_NOT_REGISTERED with a clear message — pass it through.
      setError(e.message || "Unable to send reset code");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell tagline="Lost your password? Let's fix that.">
      <div className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] m-0">Reset your password</h1>
        <div className="text-[13.5px] text-[var(--text-muted)] mt-1.5">
          Enter the email you signed up with. We&apos;ll send a 6-digit reset code.
        </div>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Email">
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </Field>

        {error && <div className="text-xs text-[var(--danger)]">{error}</div>}

        <Button type="submit" variant="primary" disabled={submitting} full size="lg" className="mt-2">
          {submitting ? <><Spinner size={14} /> Sending code…</> : "Send reset code"}
        </Button>
      </form>

      <div className="mt-5 text-center text-[13px] text-[var(--text-muted)]">
        Remembered it? <Link href="/login" className="text-[var(--text)] font-medium">Back to sign in</Link>
      </div>
    </AuthShell>
  );
}
