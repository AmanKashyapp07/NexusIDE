import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from '../lib/backendUrls';
import { setNexusToken } from '../lib/tokenStorage';
import {
  Terminal,
  Code2,
  Zap,
  Users,
  ArrowRight,
  ExternalLink,
  Box
} from 'lucide-react';

const GithubIcon: React.FC<{ className?: string }> = ({ className = "h-4 w-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.008.069-.008 1.008.07 1.54 1.036 1.54 1.036.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      clipRule="evenodd"
    />
  </svg>
);

interface FeatureCardProps {
  number: string;
  icon: React.ElementType;
  title: string;
  desc: string;
}

const FeatureCard: React.FC<FeatureCardProps> = ({
  number,
  icon: Icon,
  title,
  desc,
}) => (
  <div className="group relative rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-900/70 flex flex-col justify-between">
    <div>
      <div className="flex items-center justify-between">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700/60 bg-zinc-800/50 text-zinc-300 group-hover:border-zinc-600 group-hover:text-white transition-colors">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="font-mono text-xs text-zinc-600 group-hover:text-zinc-500 transition-colors">
          {number}
        </span>
      </div>
      <h3 className="mt-2 text-sm font-semibold tracking-tight text-zinc-100">
        {title}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
        {desc}
      </p>
    </div>
  </div>
);

export default function AuthPage() {
  const [testUsername, setTestUsername] = useState('');
  const [testPassword, setTestPassword] = useState('');
  const [testError, setTestError] = useState('');
  const [testLoading, setTestLoading] = useState(false);

  const navigate = useNavigate();

  const handleGitHubLogin = () => {
    window.location.href = apiUrl('/auth/github');
  };

  const handleDemoLogin = async () => {
    setTestError('');
    setTestLoading(true);

    const username = testUsername.trim() || 'demo';
    const password = testPassword || 'test';

    try {
      const res = await fetch(apiUrl('/auth/test-login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Demo login failed');
      }

      setNexusToken(data.token);
      navigate('/dashboard');
    } catch (err: any) {
      setTestError(err.message || 'Demo login failed');
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="relative h-screen overflow-y-auto bg-[#09090b] text-zinc-100 font-sans antialiased selection:bg-zinc-800 selection:text-white flex flex-col">
      {/* Background Subtle Grid */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(to_right,#808080_1px,transparent_1px),linear-gradient(to_bottom,#808080_1px,transparent_1px)] [background-size:36px_36px]" />

      {/* =========================================================
          HEADER
      ========================================================== */}
      <header className="relative z-30 border-b border-zinc-800/80 bg-[#09090b]/90 backdrop-blur-md shrink-0">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-6 sm:px-10 lg:px-12">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 font-bold shadow-sm">
              <Code2 className="h-4.5 w-4.5" />
            </div>
            <span className="font-mono text-base font-semibold tracking-tight text-white">
              Nexus<span className="text-zinc-400">IDE</span>
            </span>
            <span className="rounded bg-zinc-800/80 px-2 py-0.5 font-mono text-xs text-zinc-400 border border-zinc-700/50">
              v1.2.0
            </span>
          </div>

          {/* Operational Status & Links */}
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 px-3.5 py-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-mono text-xs text-zinc-400">Systems Operational</span>
            </div>

            <a
              href="https://github.com/AmanKashyapp07/NexusIDE"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-white"
            >
              <GithubIcon className="h-4 w-4" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </div>
        </div>
      </header>

      {/* =========================================================
          MAIN HERO & LOGIN
      ========================================================== */}
      <main className="mx-auto max-w-[1440px] w-full px-6 sm:px-10 lg:px-12 py-[2vh] flex-1 flex flex-col gap-[2vh]">
        
        {/* TOP ROW: HERO (Left) & PERFECTLY CENTERED LOGIN CARD (Right) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-10 items-center w-full">

          {/* LEFT COLUMN: Hero & IDE Preview Window */}
          <div className="lg:col-span-7 space-y-4">
            <div>
              {/* Eyebrow Tag */}
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/90 px-3 py-1 font-mono text-xs text-zinc-200 font-semibold">
                <Terminal className="h-3.5 w-3.5 text-zinc-100" />
                <span>COLLABORATIVE CLOUD DEVELOPMENT ENVIRONMENT</span>
              </div>

              {/* Prominent Hero Title */}
              <h1 className="mt-2.5 text-2xl sm:text-3xl xl:text-4xl font-bold tracking-tight text-white leading-[1.18]">
                Collaborative coding, without friction.
              </h1>

              {/* Subtitle */}
              <p className="mt-3 text-sm sm:text-base text-zinc-100 font-semibold leading-relaxed max-w-2xl">
                A production-grade web IDE featuring real-time Yjs CRDT synchronization, isolated Docker containers, interactive PTY bash terminals, and streaming LSP autocomplete.
              </p>

              {/* Tech Badges */}
              <div className="mt-3.5 flex flex-wrap gap-2 font-mono text-xs text-zinc-200 font-semibold">
                <span className="rounded bg-zinc-900 border border-zinc-700 px-2.5 py-1 text-zinc-100">Yjs CRDTs</span>
                <span className="rounded bg-zinc-900 border border-zinc-700 px-2.5 py-1 text-zinc-100">Docker PTY</span>
                <span className="rounded bg-zinc-900 border border-zinc-700 px-2.5 py-1 text-zinc-100">LSP Auto-complete</span>
                <span className="rounded bg-zinc-900 border border-zinc-700 px-2.5 py-1 text-zinc-100">Redis Cluster Mesh</span>
              </div>
            </div>

            {/* MOCK IDE PREVIEW (Sleek Window) */}
            <div className="rounded-xl border border-zinc-800/90 bg-[#0d0d10] shadow-2xl overflow-hidden font-mono text-xs sm:text-sm">
              {/* Window Bar */}
              <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                  <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                  <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                  <span className="ml-2 text-zinc-400 text-xs">workspace.ts — NexusIDE</span>
                </div>

                <div className="flex items-center gap-2 text-xs font-sans">
                  <span className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1 text-emerald-400 border border-emerald-500/20 font-mono text-xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    2 Active Peers
                  </span>
                </div>
              </div>

              {/* Code Body */}
              <div className="p-4 space-y-1.5 text-zinc-300 leading-relaxed bg-[#0c0c0e]">
                <div className="text-zinc-500">// Real-time CRDT sync & Docker terminal execution</div>
                <div>
                  <span className="text-purple-400">import</span> &#123; <span className="text-blue-400">createWorkspace</span> &#125; <span className="text-purple-400">from</span> <span className="text-emerald-400">'@nexus/core'</span>;
                </div>
                <div className="pt-1">
                  <span className="text-purple-400">export const</span> <span className="text-yellow-300">session</span> = <span className="text-purple-400">await</span> <span className="text-blue-400">createWorkspace</span>(&#123;
                </div>
                <div className="pl-4">
                  <span className="text-zinc-400">sandbox:</span> <span className="text-emerald-400">'docker://node-20-sandbox'</span>,
                </div>
                <div className="pl-4">
                  <span className="text-zinc-400">terminal:</span> <span className="text-emerald-400">'/dev/pts/1'</span>,
                </div>
                <div className="pl-4">
                  <span className="text-zinc-400">syncMode:</span> <span className="text-emerald-400">'yjs-crdt-binary'</span>
                </div>
                <div>&#125;);</div>
              </div>

              {/* Integrated PTY Terminal Drawer */}
              <div className="border-t border-zinc-800/80 bg-zinc-950 px-4 py-2 text-xs font-mono">
                <div className="flex items-center justify-between text-zinc-500 mb-0.5 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5 text-zinc-400" />
                    TERMINAL — bash
                  </span>
                  <span className="text-zinc-600">pts/1</span>
                </div>
                <div className="text-zinc-300">
                  <span className="text-emerald-400">user@nexus:~$</span> docker exec -it sandbox /bin/bash
                </div>
                <div className="text-zinc-500 text-[11px] mt-0.5">
                  [OK] Sandboxed container ready in 18ms. Listening on WS port 3000.
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Natural Height Login Box (No Empty Space) */}
          <div className="lg:col-span-5 flex flex-col justify-center">
            <div className="relative overflow-hidden rounded-2xl border border-zinc-800/90 bg-[#0d0d11]/80 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.7)] p-7 sm:p-8 space-y-5 group">
              
              {/* Subtle Ambient Border Top Accent */}
              <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-purple-500/40 via-indigo-500/40 to-transparent" />

              {/* Header */}
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold tracking-tight text-white font-sans">
                    Sign in to NexusIDE
                  </h2>
                  <span className="h-2 w-2 rounded-full bg-purple-400 animate-pulse shadow-[0_0_10px_rgba(168,85,247,0.8)]" />
                </div>
                <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
                  Launch your collaborative cloud workspace instantly.
                </p>
              </div>

              {/* GitHub OAuth Button */}
              <button
                onClick={handleGitHubLogin}
                className="group relative flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3.5 text-sm font-semibold text-zinc-950 transition-all duration-200 hover:bg-zinc-100 hover:shadow-[0_0_25px_rgba(255,255,255,0.15)] active:scale-[0.99] cursor-pointer shadow-md overflow-hidden"
              >
                <GithubIcon className="h-5 w-5" />
                <span>Continue with GitHub</span>
                <ArrowRight className="h-4 w-4 ml-auto text-zinc-400 group-hover:text-zinc-950 group-hover:translate-x-1 transition-all duration-200" />
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-zinc-800 to-zinc-800" />
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest px-1 font-semibold">
                  Or Demo Access
                </span>
                <div className="h-px flex-1 bg-gradient-to-r from-zinc-800 via-zinc-800 to-transparent" />
              </div>

              {/* Demo Form with Custom Credentials */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleDemoLogin();
                }}
                className="space-y-3.5"
              >
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Username / Handle
                  </label>
                  <input
                    type="text"
                    placeholder="Username (e.g. dev_user)"
                    value={testUsername}
                    onChange={(e) => setTestUsername(e.target.value)}
                    className="w-full rounded-lg border border-zinc-800/90 bg-[#070709] px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-all duration-200 focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/10 focus:bg-zinc-950"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Password
                  </label>
                  <input
                    type="password"
                    placeholder="Password"
                    value={testPassword}
                    onChange={(e) => setTestPassword(e.target.value)}
                    className="w-full rounded-lg border border-zinc-800/90 bg-[#070709] px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-all duration-200 focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/10 focus:bg-zinc-950"
                  />
                </div>

                {testError && (
                  <p className="text-xs text-rose-400 font-mono">
                    {testError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={testLoading}
                  className="group relative flex w-full items-center justify-center gap-2.5 rounded-lg border border-zinc-700/80 bg-zinc-800/90 hover:bg-zinc-700/90 hover:border-zinc-600 py-3 text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50 cursor-pointer shadow-lg active:scale-[0.99] overflow-hidden mt-1"
                >
                  {testLoading ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-white" />
                      <span>Launching workspace...</span>
                    </>
                  ) : (
                    <>
                      <span>Enter Demo Workspace</span>
                      <ArrowRight className="h-4 w-4 text-zinc-400 group-hover:text-white group-hover:translate-x-1 transition-all duration-200" />
                    </>
                  )}
                </button>
              </form>

              {/* Footer Note */}
              <p className="text-center text-xs text-zinc-400 flex items-center justify-center gap-1.5 pt-1">
                <span className="h-1 w-1 rounded-full bg-zinc-500" />
                Enter any username/password to test multi-user collaboration.
              </p>
            </div>
          </div>

        </div>

        {/* BOTTOM ROW: ALL 4 FEATURE BOXES HORIZONTAL IN 1 ROW */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full">
          <FeatureCard
            number="01"
            icon={Users}
            title="Multi-User CRDT"
            desc="Conflict-free real-time code editing with live peer cursors."
          />
          <FeatureCard
            number="02"
            icon={Box}
            title="Docker Sandboxes"
            desc="Isolated execution in resource-capped container environments."
          />
          <FeatureCard
            number="03"
            icon={Terminal}
            title="Persistent Terminals"
            desc="Interactive Linux PTY shell sessions directly in browser."
          />
          <FeatureCard
            number="04"
            icon={Zap}
            title="LSP Intelligence"
            desc="Streaming autocompletion & diagnostics for TS and Python."
          />
        </div>

      </main>

      {/* =========================================================
          DEMO FOOTER
      ========================================================== */}
      {/* =========================================================
          LONG DEMO FOOTER (Multi-Column IDE / Cloud Platform Footer)
      ========================================================== */}
      <footer className="border-t border-zinc-800/80 bg-zinc-950/95 pt-10 pb-8 px-6 sm:px-10 lg:px-12 shrink-0">
        <div className="mx-auto max-w-[1440px] space-y-8">
          
          {/* Main Footer Grid */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 text-xs">
            
            {/* Column 1: Brand & Overview */}
            <div className="col-span-2 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 font-bold">
                  <Code2 className="h-4 w-4" />
                </div>
                <span className="font-mono text-base font-bold text-white tracking-tight">
                  Nexus<span className="text-zinc-400">IDE</span>
                </span>
                <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-300 border border-zinc-700 font-bold">
                  v1.2.0
                </span>
              </div>
              <p className="text-zinc-300 leading-relaxed max-w-sm text-xs font-semibold">
                A high-performance, real-time collaborative cloud IDE architecture powered by Yjs CRDTs, isolated Docker sandboxes, Linux PTY terminals, and streaming LSP intelligence.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-mono text-emerald-400 font-bold">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Systems Operational
                </span>
              </div>
            </div>

            {/* Column 2: Core Architecture */}
            <div className="space-y-3">
              <h4 className="font-mono text-xs font-bold text-white uppercase tracking-wider">Architecture</h4>
              <ul className="space-y-2 text-zinc-300 font-semibold">
                <li><span className="hover:text-white transition-colors cursor-pointer">Yjs Binary CRDT Sync</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Docker Container PTY</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Streaming LSP Protocol</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Merkle DAG CAS Engine</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Redis 7 Pub/Sub Mesh</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">PostgreSQL 16 DB</span></li>
              </ul>
            </div>

            {/* Column 3: Platform Features */}
            <div className="space-y-3">
              <h4 className="font-mono text-xs font-bold text-white uppercase tracking-wider">Capabilities</h4>
              <ul className="space-y-2 text-zinc-300 font-semibold">
                <li><span className="hover:text-white transition-colors cursor-pointer">Multi-User Cursors</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Interactive Bash Shell</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Monaco Editor Core</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Snapshot Delta History</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Resource-Capped Limits</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">WebSockets Connection</span></li>
              </ul>
            </div>

            {/* Column 4: Links & Credits */}
            <div className="space-y-3">
              <h4 className="font-mono text-xs font-bold text-white uppercase tracking-wider">Project Links</h4>
              <ul className="space-y-2 text-zinc-300 font-semibold">
                <li>
                  <a href="https://github.com/AmanKashyapp07/NexusIDE" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white transition-colors">
                    <GithubIcon className="h-3.5 w-3.5" />
                    <span>GitHub Repository</span>
                  </a>
                </li>
                <li>
                  <a href="http://129.154.39.198/ide/login" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white transition-colors">
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Live Oracle Cloud Node</span>
                  </a>
                </li>
                <li>
                  <a href="https://github.com/AmanKashyapp07" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white transition-colors">
                    <span>Creator: Aman Kashyap</span>
                  </a>
                </li>
                <li className="pt-1 text-[11px] text-zinc-400 font-mono font-normal">
                  MIT License • Open Source
                </li>
              </ul>
            </div>

          </div>

          {/* Bottom Copyright & Credit Strip */}
          <div className="border-t border-zinc-800/80 pt-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400 font-mono">
            <div>
              © 2026 NexusIDE Cloud Platform. Open-source real-time IDE sandbox environment.
            </div>
            <div className="flex items-center gap-4">
              <span>Built by <a href="https://github.com/AmanKashyapp07" target="_blank" rel="noreferrer" className="text-white underline hover:text-purple-300 font-bold">Aman Kashyap</a></span>
            </div>
          </div>

        </div>
      </footer>
    </div>
  );
}