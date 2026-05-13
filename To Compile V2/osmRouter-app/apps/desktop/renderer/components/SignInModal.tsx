"use client";

import { useEffect, useRef, useState } from "react";

/**
 * SignInModal — the paste-API-key flow.
 *
 * UX is two-step inside one modal:
 *   1) Click "Open dashboard" → the system browser opens the Devices page
 *      on app.osmrouter.com where the user generates a device API key.
 *   2) Paste the key in the field → click Connect → main process validates
 *      against /api/v1/auth/exchange-device-key. On success the app
 *      becomes signed-in and the modal closes.
 *
 * This is the simplest desktop-auth pattern that actually works against
 * the existing backend. PKCE / browser redirects aren't wired (no
 * osmrouter:// scheme registered, no token-exchange endpoint specific to
 * the desktop client). Paste-key is the same UX as fly.io, Linear,
 * Vercel, Tailscale CLIs.
 */
export function SignInModal({ open, onClose, onSignedIn }: { open: boolean; onClose: () => void; onSignedIn: (email: string) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setApiKey("");
      setError(null);
      setSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (!window.osmAPI) {
      setError("IPC bridge unavailable — relaunch the app.");
      return;
    }
    const trimmed = apiKey.trim();
    if (trimmed.length < 20) {
      setError("That doesn't look like a valid API key (too short).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await window.osmAPI.auth.signInWithKey(trimmed);
      if (res.ok) {
        onSignedIn(res.email);
        onClose();
      } else {
        setError(humanise(res.error));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxWidth: "92vw",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "22px 24px",
          boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
          color: "var(--text)",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Sign in to osmRouter</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55, marginBottom: 16 }}>
          The desktop app authenticates with a device API key. Generate one on the web dashboard, then paste it here.
        </div>

        {/* Step 1 — open dashboard */}
        <ol style={{ margin: "0 0 14px 18px", padding: 0, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
          <li>
            Open the dashboard and go to <b style={{ color: "var(--text)" }}>Devices → Add device</b>.
            <div style={{ marginTop: 6 }}>
              <button
                onClick={() => void window.osmAPI?.sys.openExternal("https://app.osmrouter.com/devices")}
                style={{
                  padding: "5px 10px",
                  fontSize: 12,
                  fontWeight: 500,
                  background: "var(--bg-chip)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  cursor: "pointer",
                }}
              >
                Open dashboard →
              </button>
            </div>
          </li>
          <li style={{ marginTop: 10 }}>Copy the API key shown after creating the device.</li>
          <li style={{ marginTop: 10 }}>Paste it below and click Connect.</li>
        </ol>

        {/* Step 3 — paste field */}
        <label htmlFor="osm-api-key" style={{ display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-subtle)", marginBottom: 6 }}>
          API key
        </label>
        <input
          ref={inputRef}
          id="osm-api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="osm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          className="mono"
          style={{
            width: "100%",
            padding: "8px 10px",
            fontSize: 12.5,
            background: "var(--bg-panel)",
            color: "var(--text)",
            border: `1px solid ${error ? "var(--error)" : "var(--border-input)"}`,
            borderRadius: 6,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        {error && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--error)" }} role="alert">
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: "7px 14px",
              fontSize: 12.5,
              background: "transparent",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: submitting ? "default" : "pointer",
              opacity: submitting ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || apiKey.trim().length < 20}
            style={{
              padding: "7px 16px",
              fontSize: 12.5,
              fontWeight: 500,
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: submitting || apiKey.trim().length < 20 ? "default" : "pointer",
              opacity: submitting || apiKey.trim().length < 20 ? 0.55 : 1,
            }}
          >
            {submitting ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

function humanise(code: string): string {
  switch (code) {
    case "api-key-empty":
      return "Please paste your API key.";
    case "api-key-invalid-or-revoked":
      return "That API key was rejected. It may have been revoked — generate a new one in the dashboard.";
    case "network-unreachable":
      return "Couldn't reach the osmRouter API. Check your internet connection.";
    case "server-response-malformed":
      return "Got an unexpected response from the server. Try again, or contact support.";
    default:
      if (code.startsWith("server-error-")) return `Server responded with ${code.replace("server-error-", "HTTP ")}. Try again in a moment.`;
      return code;
  }
}
