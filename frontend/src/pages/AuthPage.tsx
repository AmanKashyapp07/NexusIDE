import { Zap } from 'lucide-react';

export default function AuthPage() {
  const handleGithubLogin = () => {
    window.location.href = 'http://localhost:4000/api/auth/github';
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07060b] text-zinc-200 selection:bg-violet-400/25">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="nx-orb nx-orb-1" />
        <div className="nx-orb nx-orb-2" />
        <div className="nx-orb nx-orb-3" />
      </div>

      <div className="absolute inset-0 nx-grid-overlay opacity-40" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid w-full gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="flex flex-col justify-between rounded-[2rem] nx-glass-strong p-8 shadow-[0_30px_80px_rgba(0,0,0,0.45)] sm:p-10 lg:p-12">
            <div className="max-w-xl space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-violet-200">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400 shadow-[0_0_18px_rgba(139,92,246,0.9)]" />
                Collaborative Cloud IDE
              </div>

              <div className="space-y-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] shadow-inner shadow-violet-500/10">
                  <Zap size={28} className="text-violet-300" />
                </div>
                <div className="space-y-3">
                  <h1 className="max-w-lg text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                    Ship code faster with a workspace that feels{' '}
                    <span className="nx-text-gradient">calm and focused.</span>
                  </h1>
                  <p className="max-w-xl text-base leading-7 text-zinc-400 sm:text-lg">
                    Authenticate with GitHub to access your active projects and start building in isolated, real-time environments.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  'Conflict-Free Concurrency',
                  'Persistent Session States',
                  'Isolated Sandboxes',
                ].map((item) => (
                  <div key={item} className="rounded-2xl border border-violet-500/10 bg-violet-500/[0.04] px-4 py-3 text-sm text-zinc-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:border-violet-500/20 hover:bg-violet-500/[0.08]">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-10 grid gap-3 border-t border-white/10 pt-6 sm:grid-cols-3">
              {[
                ['Immutable Access', 'GitHub OAuth security layer'],
                ['High Availability', 'Sub-100ms environment recovery'],
                ['Decoupled UI', 'Engineered glassmorphism interface'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.06]">
                  <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">{label}</div>
                  <div className="mt-2 text-sm text-zinc-200">{value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex items-center justify-center">
            <div className="w-full max-w-[32rem] rounded-[2rem] nx-glass-strong p-6 shadow-[0_24px_90px_rgba(0,0,0,0.5),0_0_60px_rgba(139,92,246,0.06)] sm:p-8">
              <div className="mb-8 flex flex-col items-center text-center">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-400/15 bg-violet-400/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <Zap size={30} className="text-violet-300" />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-white">
                  Developer Authentication
                </h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-400">
                  Securely log in with your GitHub account to manage workspaces.
                </p>
              </div>

              <div className="space-y-5">
                <button
                  onClick={handleGithubLogin}
                  className="nx-btn-shimmer group relative flex w-full items-center justify-center gap-3 rounded-2xl border border-zinc-700 bg-[#24292e] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(0,0,0,0.2)] transition duration-200 hover:bg-[#2f363d] focus:outline-none focus:ring-4 focus:ring-violet-400/20"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="css-i6dzq1"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                  <span>Continue with GitHub</span>
                </button>
              </div>

              <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-center">
                <p className="text-sm text-zinc-400">
                  By signing in, you agree to the Terms of Service.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// this is just basic authentication page that allows users to log in with their GitHub account. It has a button that redirects the user to the GitHub OAuth flow. Once authenticated, the user will be redirected back to the application with a token.