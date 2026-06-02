import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cloud } from 'lucide-react';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const body = isLogin 
        ? { username, password }
        : { username, email, password };

      const res = await fetch(`http://localhost:4000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      localStorage.setItem('token', data.token);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050608] text-zinc-200 selection:bg-cyan-400/25">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(59,130,246,0.14),transparent_24%),radial-gradient(circle_at_bottom,rgba(14,165,233,0.10),transparent_30%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:72px_72px] opacity-20 [mask-image:radial-gradient(circle_at_center,black,transparent_78%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid w-full gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="flex flex-col justify-between rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-10 lg:p-12">
            <div className="max-w-xl space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-cyan-200">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.9)]" />
                Collaborative workspace
              </div>

              <div className="space-y-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/8 shadow-inner shadow-cyan-500/10">
                  <Cloud size={28} className="text-cyan-300" />
                </div>
                <div className="space-y-3">
                  <h1 className="max-w-lg text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                    Ship code faster with a workspace that feels calm and focused.
                  </h1>
                  <p className="max-w-xl text-base leading-7 text-zinc-400 sm:text-lg">
                    Sign in to pick up where you left off, or create a new account to start a fresh project with realtime syncing.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  'Realtime collaboration',
                  'Persistent workspace state',
                  'Fast auth flow',
                ].map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-10 grid gap-3 border-t border-white/10 pt-6 sm:grid-cols-3">
              {[
                ['Secure', 'Token-based access'],
                ['Fast', 'Quick session recovery'],
                ['Modern', 'Glassmorphism interface'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">{label}</div>
                  <div className="mt-2 text-sm text-zinc-200">{value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex items-center justify-center">
            <div className="w-full max-w-[32rem] rounded-[2rem] border border-white/10 bg-zinc-950/70 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:p-8">
              <div className="mb-8 flex flex-col items-center text-center">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <Cloud size={30} className="text-cyan-300" />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-white">
                  {isLogin ? 'Welcome back' : 'Create your account'}
                </h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-400">
                  {isLogin ? 'Enter your credentials to continue.' : 'Set up your workspace in a few quick steps.'}
                </p>
              </div>

              <form className="space-y-5" onSubmit={handleSubmit}>
                {error && (
                  <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300 shadow-[0_0_0_1px_rgba(239,68,68,0.04)] animate-in fade-in zoom-in-95 duration-300">
                    <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-red-400 shadow-[0_0_14px_rgba(248,113,113,0.85)]" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-zinc-300">
                      Username
                    </label>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="block w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition duration-200 hover:border-white/15 hover:bg-white/7 focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10"
                      placeholder="johndoe"
                    />
                  </div>

                  {!isLogin && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                      <label className="mb-2 block text-sm font-medium text-zinc-300">
                        Email address
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="block w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition duration-200 hover:border-white/15 hover:bg-white/7 focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10"
                        placeholder="you@example.com"
                      />
                    </div>
                  )}

                  <div>
                    <label className="mb-2 block text-sm font-medium text-zinc-300">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="block w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-white placeholder:text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition duration-200 hover:border-white/15 hover:bg-white/7 focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="group relative flex w-full items-center justify-center overflow-hidden rounded-2xl border border-cyan-300/20 bg-[linear-gradient(135deg,#06b6d4,#2563eb)] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(8,145,178,0.22)] transition duration-200 hover:shadow-[0_18px_36px_rgba(37,99,235,0.35)] focus:outline-none focus:ring-4 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.2),transparent)] translate-x-[-120%] opacity-0 transition duration-700 group-hover:translate-x-[120%] group-hover:opacity-100" />
                  <span className="relative flex items-center gap-2">
                    {isLoading ? (
                      <>
                        <svg className="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Processing...
                      </>
                    ) : (
                      isLogin ? 'Sign in' : 'Create account'
                    )}
                  </span>
                </button>
              </form>

              <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-center">
                <p className="text-sm text-zinc-400">
                  {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
                  <button
                    onClick={() => {
                      setIsLogin(!isLogin);
                      setError('');
                    }}
                    className="font-medium text-white underline decoration-white/20 underline-offset-4 transition hover:text-cyan-300 hover:decoration-cyan-300/50 focus:outline-none"
                  >
                    {isLogin ? 'Sign up for free' : 'Sign in instead'}
                  </button>
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}