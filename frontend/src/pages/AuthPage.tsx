import React from 'react';

interface FeatureCardProps {
  icon: string;
  title: string;
  description: string;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, description }) => (
  <div className="group relative flex flex-col gap-2 rounded-2xl border border-white/[0.05] bg-white/[0.02] p-5 backdrop-blur-md transition-all duration-300 hover:border-purple-500/30 hover:bg-white/[0.04]">
    {/* Subtle gradient spot behind the card icon on hover */}
    <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-purple-500/10 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
    <span className="text-xl text-purple-400 relative z-10">{icon}</span>
    <h3 className="font-semibold text-sm text-neutral-200 tracking-tight relative z-10">{title}</h3>
    <p className="text-xs text-neutral-400 leading-relaxed relative z-10">{description}</p>
  </div>
);

export default function AuthPage() {
  const features = [
    { icon: '🛡️', title: 'Immutable Access', description: 'Isolated sandboxes running behind an advanced OAuth security layer.' },
    { icon: '⚡', title: 'High Availability', description: 'Zero-latency workspace initialization with sub-100ms recovery protocols.' },
    { icon: '📦', title: 'Decoupled UI', description: 'Engineered interfaces built to separate state rendering from processing units.' },
    { icon: '🔄', title: 'Real-time Sync', description: 'Conflict-free collaborative coding infrastructure powered by Yjs state trees.' },
  ];

  const handleGitHubLogin = () => {
    window.location.href = 'http://localhost:4000/api/auth/github';
  };

  return (
    <div className="relative min-h-screen w-full bg-[#070709] text-white overflow-x-hidden font-sans flex items-center justify-center">
      
      {/* ─── BACKGROUND MESH & GEOMETRIC GRID ─── */}
      <div className="absolute inset-0 z-0 bg-[linear-gradient(to_right,#1f1f2e_1px,transparent_1px),linear-gradient(to_bottom,#1f1f2e_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_60%,transparent_100%)] opacity-[0.25]" />
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[400px] h-[400px] bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none" />

      {/* ─── FLOATING TOP LOGO BRANDING ─── */}
      <header className="absolute top-0 left-0 w-full p-6 lg:p-8 z-20">
        <div className="max-w-7xl mx-auto flex items-center">
          <div className="flex items-center gap-2.5 font-bold text-lg tracking-tight select-none">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-md shadow-purple-500/20">
              <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </div>
            <span className="bg-gradient-to-r from-neutral-100 to-neutral-400 bg-clip-text text-transparent">DevSpace</span>
          </div>
        </div>
      </header>

      {/* ─── MAIN CONTAINER ─── */}
      <main className="relative z-10 w-full max-w-7xl mx-auto px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center pt-24 pb-12">
        
        {/* LEFT COLUMN: HERO DESCRIPTIVES & VALUE CARDS */}
        <div className="lg:col-span-7 space-y-12 max-w-2xl lg:max-w-none">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20 shadow-inner">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
              COLLABORATIVE CLOUD IDE
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1] text-neutral-100">
              Ship code faster in a workspace that feels{' '}
              <span className="bg-gradient-to-r from-purple-400 via-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                calm and focused.
              </span>
            </h1>
            <p className="text-neutral-400 text-base sm:text-lg leading-relaxed font-normal">
              Authenticate with your provider to access isolated containers, write robust applications alongside colleagues, and coordinate your development stack smoothly.
            </p>
          </div>

          {/* Grid Layout containing Product Features */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {features.map((feature, idx) => (
              <FeatureCard 
                key={idx}
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
              />
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN: PREMIUM GLASS AUTH MODULE */}
        <div className="lg:col-span-5 flex justify-center lg:justify-end w-full">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-[#0c0c10]/70 p-8 backdrop-blur-xl shadow-2xl shadow-black/50 relative group">
            {/* Soft inner container border-glow effect */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-purple-500/10 to-transparent opacity-50 pointer-events-none" />
            
            <div className="text-center space-y-2 mb-8 relative z-10">
              <h2 className="text-2xl font-bold tracking-tight text-neutral-100">Welcome back</h2>
              <p className="text-sm text-neutral-400">Securely log in to your developer environment.</p>
            </div>

            <div className="space-y-4 relative z-10">
              <button onClick={handleGitHubLogin} className="w-full flex items-center justify-center gap-3 bg-neutral-100 text-neutral-950 font-bold py-3 px-4 rounded-xl hover:bg-neutral-200 active:scale-[0.99] transition duration-200 shadow-md shadow-white/5">
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.008.069-.008 1.008.07 1.54 1.036 1.54 1.036.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
                Continue with GitHub
              </button>
            </div>

            {/* Visual Text Divider */}
            <div className="relative my-6 flex items-center justify-center relative z-10">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/[0.06]" />
              </div>
              <span className="relative bg-[#0d0d11] px-3.5 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                Secure Layer
              </span>
            </div>

            <p className="text-center text-[11px] leading-relaxed text-neutral-500 px-2 relative z-10 font-normal">
              By continuing, you agree to our{' '}
              <a href="#terms" className="text-neutral-400 underline decoration-neutral-600 underline-offset-2 hover:text-white transition">Terms of Service</a>{' '}
              and{' '}
              <a href="#privacy" className="text-neutral-400 underline decoration-neutral-600 underline-offset-2 hover:text-white transition">Privacy Policy</a>.
            </p>
          </div>
        </div>

      </main>
    </div>
  );
}