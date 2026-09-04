"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const MIN_PASSWORD_LENGTH = 12;

function AuthFormInner({ mode }: { mode: "login" | "recover" | "reset" }) {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      if (mode === "login") {
        const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
        const data = await response.json();
        if (!response.ok) { setMessage(data.error ?? "Sign in failed."); return; }
        router.push("/admin");
        router.refresh();
        return;
      }

      if (mode === "recover") {
        const response = await fetch("/api/auth/request-reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
        const data = await response.json();
        setMessage(data.message ?? data.error ?? "If that address belongs to an owner account, a reset link is on its way.");
        setDone(response.ok);
        return;
      }

      if (password !== confirm) { setMessage("Both passwords must match."); return; }
      const response = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await response.json();
      if (!response.ok) { setMessage(data.error ?? "The password could not be updated."); return; }
      setMessage(data.message ?? "Your password was updated.");
      setDone(true);
    } catch {
      setMessage("The server could not be reached. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const heading = mode === "login" ? "Owner sign in" : mode === "recover" ? "Recover access" : "Set a new password";

  if (mode === "reset" && !token) {
    return <div className="auth-card">
      <span className="wordmark"><span>SHIP</span> PRINT <b>eSELL</b></span>
      <h1>Reset link required</h1>
      <p>Open the link from your reset email, or request a new one.</p>
      <Link className="auth-link" href="/admin/recover">Request a reset link</Link>
    </div>;
  }

  return <form className="auth-card" onSubmit={submit}>
    <span className="wordmark"><span>SHIP</span> PRINT <b>eSELL</b></span>
    <h1>{heading}</h1>
    <p>Managed account access for approved owners only.</p>

    {mode !== "reset" && <label>Email
      <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)}/>
    </label>}

    {mode !== "recover" && <label>{mode === "reset" ? "New password" : "Password"}
      <input required minLength={mode === "reset" ? MIN_PASSWORD_LENGTH : 1} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)}/>
      {mode === "reset" && <small>At least {MIN_PASSWORD_LENGTH} characters, with upper and lower case letters and a number.</small>}
    </label>}

    {mode === "reset" && <label>Confirm new password
      <input required minLength={MIN_PASSWORD_LENGTH} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)}/>
    </label>}

    <button className="submit" disabled={busy || done}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : mode === "recover" ? "Send recovery link" : "Update password"}</button>
    {message && <div className="notice" role="status">{message}</div>}
    {mode === "login" && <Link className="auth-link" href="/admin/recover">Forgot password?</Link>}
    {mode !== "login" && done && <Link className="auth-link" href="/admin/login">Return to sign in</Link>}
  </form>;
}

export function AuthForm({ mode }: { mode: "login" | "recover" | "reset" }) {
  return <Suspense fallback={<div className="auth-card"><p>Loading…</p></div>}>
    <AuthFormInner mode={mode}/>
  </Suspense>;
}
