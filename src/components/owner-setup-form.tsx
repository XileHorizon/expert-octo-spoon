"use client";

import Link from "next/link";
import { useState } from "react";

export function OwnerSetupForm({ available }: { available: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!available) return <div className="auth-card"><span className="wordmark"><span>SHIP</span> PRINT <b>eSELL</b></span><h1>Owner setup closed</h1><p>The first owner has already been created, or setup is unavailable.</p><Link className="auth-link" href="/admin/login">Return to sign in</Link></div>;

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    if (password !== confirm) return setMessage("Both passwords must match.");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, setupSecret }) });
      const data = await response.json();
      setMessage(data.message ?? data.error ?? "Setup failed.");
      setDone(response.ok);
    } catch { setMessage("The server could not be reached. Try again."); }
    finally { setBusy(false); }
  }

  return <form className="auth-card" onSubmit={submit}>
    <span className="wordmark"><span>SHIP</span> PRINT <b>eSELL</b></span>
    <h1>Create the first owner</h1>
    <p>This one-time setup closes permanently after account creation.</p>
    <label>Owner email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label>
    <label>Deployment setup secret<input required type="password" autoComplete="off" value={setupSecret} onChange={(event) => setSetupSecret(event.target.value)}/><small>Enter the secret configured privately by the deployment owner.</small></label>
    <label>Password<input required minLength={12} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)}/><small>At least 12 characters, with upper and lower case letters and a number.</small></label>
    <label>Confirm password<input required minLength={12} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)}/></label>
    <button className="submit" disabled={busy || done}>{busy ? "Creating…" : "Create owner"}</button>
    {message && <div className="notice" role="status">{message}</div>}
    {done && <Link className="auth-link" href="/admin/login">Sign in</Link>}
  </form>;
}
