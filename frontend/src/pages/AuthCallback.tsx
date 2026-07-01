import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Zap } from 'lucide-react';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');
    
    if (token) {
      localStorage.setItem('token', token);
      navigate('/dashboard');
    } else {
      navigate('/');
    }
  }, [searchParams, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#07060b]">
      <div className="flex flex-col items-center space-y-4">
        <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-2xl border border-violet-400/15 bg-violet-400/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <Zap size={30} className="text-violet-300" />
        </div>
        <p className="text-sm text-zinc-400">Authenticating with GitHub...</p>
      </div>
    </div>
  );
}
