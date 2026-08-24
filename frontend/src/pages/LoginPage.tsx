import { useState, type FormEvent } from "react";

export function LoginPage({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      await onLogin(email.trim(), password);
    } catch {
      setError("Sign-in failed. Check your Supervisor email and password.");
    } finally {
      setPending(false);
    }
  }

  return <main className="login-page"><section className="login-panel">
    <div className="login-brand"><b>♲</b><div><strong>LITTERSPOT</strong><span>AI WASTE MONITOR</span></div></div>
    <div className="login-copy"><p className="eyebrow">OPERATIONS ACCESS</p><h1>Welcome back.</h1><p>Sign in to monitor camera feeds, review detection flags, and manage waste operations.</p></div>
    <form onSubmit={submit}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label><button className="primary" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in to dashboard"} <span>→</span></button></form>
    {error && <p className="login-demo" role="alert">{error}</p>}
  </section><aside className="login-visual"><div><span>LIVE OPERATIONS</span><strong>6</strong><p>camera zones ready for monitoring</p></div><i /><i /><i /></aside></main>;
}
