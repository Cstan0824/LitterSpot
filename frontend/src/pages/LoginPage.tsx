import { useState, type FormEvent } from "react";
import { loginErrorMessage } from "../services/v2/errors";
import loginSiteMap from "../assets/login-site-map.png";

export function LoginPage({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      await onLogin(email.trim(), password);
    } catch (reason) {
      setError(loginErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }

  return <main className="login-page"><aside className="login-visual" aria-hidden="true"><img src={loginSiteMap} alt="" /></aside><section className="login-panel">
    <div className="login-brand"><strong>LitterSpot</strong></div>
    <div className="login-copy"><h1>Welcome back</h1></div>
    <form onSubmit={submit}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="name@site.com" required /></label><label>Password<span className="login-password-input"><input type={passwordVisible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="••••••••" required /><button type="button" aria-label={passwordVisible ? "Hide password" : "Show password"} onClick={() => setPasswordVisible((visible) => !visible)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-5.5 9.5-5.5S21.5 12 21.5 12 18.1 17.5 12 17.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.7" />{!passwordVisible && <path d="m4 4 16 16" />}</svg></button></span></label><div className="login-form-options"><label><input type="checkbox" />Remember this device</label><a href="mailto:admin@litterspot.local?subject=Password%20help">Forgot password?</a></div><button className="primary" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"} <span aria-hidden="true">→</span></button></form>
    {error && <p className="login-demo" role="alert">{error}</p>}
  </section></main>;
}
