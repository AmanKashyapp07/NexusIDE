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
    <div className="min-h-screen bg-[#0d1117] flex flex-col items-center justify-center py-12 sm:px-6 lg:px-8 text-[#c9d1d9] font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md flex flex-col items-center">
        <Cloud size={48} className="text-white mb-6" />
        <h2 className="text-center text-2xl font-semibold tracking-tight text-white">
          {isLogin ? 'Sign in to Sandbox IDE' : 'Create your account'}
        </h2>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-[20rem]">
        <div className="bg-[#161b22] py-6 px-4 shadow rounded-lg border border-[#30363d] sm:px-6">
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-[rgba(248,81,73,0.1)] border border-[rgba(248,81,73,0.4)] text-[#ff7b72] px-3 py-2 rounded-md text-sm">
                {error}
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-[#c9d1d9] mb-1">
                Username
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="appearance-none block w-full px-3 py-1.5 border border-[#30363d] rounded-md shadow-sm placeholder-[#8b949e] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-[#0d1117] text-white sm:text-sm"
              />
            </div>

            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-[#c9d1d9] mb-1">
                  Email address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none block w-full px-3 py-1.5 border border-[#30363d] rounded-md shadow-sm placeholder-[#8b949e] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-[#0d1117] text-white sm:text-sm"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[#c9d1d9] mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="appearance-none block w-full px-3 py-1.5 border border-[#30363d] rounded-md shadow-sm placeholder-[#8b949e] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-[#0d1117] text-white sm:text-sm"
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-[rgba(240,246,252,0.1)] rounded-md shadow-sm text-sm font-medium text-white bg-[#238636] hover:bg-[#2ea043] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#2ea043] disabled:opacity-50"
              >
                {isLoading ? 'Processing...' : isLogin ? 'Sign in' : 'Sign up'}
              </button>
            </div>
          </form>
        </div>
        
        <div className="mt-6 text-center border border-[#30363d] rounded-lg bg-[#161b22] px-4 py-4">
          <p className="text-sm text-[#8b949e]">
            {isLogin ? 'New to Sandbox IDE?' : 'Already have an account?'}{' '}
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
              }}
              className="font-medium text-[#58a6ff] hover:text-blue-400 focus:outline-none"
            >
              {isLogin ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
