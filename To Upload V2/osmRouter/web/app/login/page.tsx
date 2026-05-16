"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError, fetchCSRF } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api("/api/v1/auth/login", { method: "POST", body: { email, password } });
      await fetchCSRF().catch(() => {});
      router.push("/dashboard");
    } catch (err) {
      const e = err as ApiError;
      setError(e.message || "Unable to sign in");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell tagline="Welcome back.">
      <div className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] m-0">Sign in</h1>
        <div className="text-[13.5px] text-[var(--text-muted)] mt-1.5">
          Enter your credentials to access your dashboard.
        </div>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Email">
          <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <div className="mt-1.5 text-right">
            <Link
              href="/forgot-password"
              className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              Forgot password?
            </Link>
          </div>
        </Field>

        {error && <div className="text-xs text-[var(--danger)]">{error}</div>}

        <Button type="submit" variant="primary" disabled={submitting} full size="lg" className="mt-2">
          {submitting ? <><Spinner size={14} /> Signing in…</> : "Sign in"}
        </Button>
      </form>

      <div className="mt-5 text-center text-[13px] text-[var(--text-muted)]">
        New here? <Link href="/signup" className="text-[var(--text)] font-medium">Create an account</Link>
      </div>
    </AuthShell>
  );
}
