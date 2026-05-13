"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = passwordStrength(password);
  const canSubmit = email.includes("@") && password.length >= 8 && /\d/.test(password) && agree && !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      type RegisterResp = { user_id: string; email: string; dev_otp?: string };
      const res = await api<RegisterResp>("/api/v1/auth/register", {
        method: "POST",
        body: { email, password, name },
      });
      const params = new URLSearchParams({ email: res.email });
      if (res.dev_otp) params.set("dev_otp", res.dev_otp);
      router.push(`/verify?${params.toString()}`);
    } catch (err) {
      const e = err as ApiError;
      setError(e.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell tagline="Pin a public hostname to anything running locally.">
      <div className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] m-0">Create your account</h1>
        <div className="text-[13.5px] text-[var(--text-muted)] mt-1.5">
          Start routing local services through your own domains in under 90 seconds.
        </div>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Name (optional)">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </Field>
        <Field label="Email">
          <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" hint={password ? `${strength}/4` : null}>
          <Input
            type="password"
            placeholder="At least 8 characters, with a digit"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {password && (
            <div className="flex gap-1 mt-2">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className={`flex-1 h-[3px] rounded-full ${
                    n <= strength
                      ? strength <= 1
                        ? "bg-[var(--danger)]"
                        : strength === 2
                        ? "bg-[var(--warn)]"
                        : "bg-[var(--success)]"
                      : "bg-[var(--bg-sunken)]"
                  }`}
                />
              ))}
            </div>
          )}
        </Field>

        <label className="flex items-start gap-2.5 text-[12.5px] text-[var(--text-muted)] mt-1 cursor-pointer">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>I agree to the <a className="text-[var(--text)] border-b border-[var(--border-strong)]">Terms</a> and <a className="text-[var(--text)] border-b border-[var(--border-strong)]">Privacy Policy</a></span>
        </label>

        {error && <div className="text-xs text-[var(--danger)]">{error}</div>}

        <Button type="submit" variant="primary" disabled={!canSubmit} full size="lg" className="mt-2">
          {submitting ? <><Spinner size={14} /> Creating account…</> : "Create account"}
        </Button>
      </form>

      <div className="mt-5 text-center text-[13px] text-[var(--text-muted)]">
        Already have an account? <Link href="/login" className="text-[var(--text)] font-medium">Sign in</Link>
      </div>
    </AuthShell>
  );
}

function passwordStrength(p: string) {
  let s = 0;
  if (p.length >= 8) s++;
  if (/[A-Z]/.test(p)) s++;
  if (/[0-9]/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return s;
}
