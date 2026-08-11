import { useState, type FormEvent } from "react";

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("operator@litterspot.local");
  const [password, setPassword] = useState("demo1234");
  function submit(event: FormEvent) { event.preventDefault(); if (email.trim() && password) onLogin(); }
  return <main className="login-page"><section className="login-panel">
    <div className="login-brand"><b>♲</b><div><strong>LITTERSPOT</strong><span>AI WASTE MONITOR</span></div></div>
    <div className="login-copy"><p className="eyebrow">OPERATIONS ACCESS</p><h1>Welcome back.</h1><p>Sign in to monitor camera feeds, review detection flags, and manage waste operations.</p></div>
    <form onSubmit={submit}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="primary" type="submit">Sign in to dashboard <span>→</span></button></form>
    <p className="login-demo">Demo access is pre-filled. No backend account is required.</p>
  </section><aside className="login-visual"><div><span>LIVE OPERATIONS</span><strong>6</strong><p>camera zones ready for monitoring</p></div><i /><i /><i /></aside></main>;
}
