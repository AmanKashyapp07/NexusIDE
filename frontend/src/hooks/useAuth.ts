import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from '../lib/backendUrls';

export interface AuthUser {
  id: string;
  username: string;
  avatar_url?: string;
}

interface UseAuthReturn {
  user: AuthUser | null;
  isLoading: boolean;
  logout: () => void;
}

/**
 * Custom Hook: useAuth
 * Encapsulates token validation, user fetch (/auth/me), and logout.
 * Automatically redirects to /login on auth failure.
 */
export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const init = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        navigate('/login');
        return;
      }

      try {
        const res = await fetch(apiUrl('/auth/me'), {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          localStorage.removeItem('token');
          navigate('/login');
          return;
        }

        const data = await res.json();
        setUser(data.user);
      } catch {
        localStorage.removeItem('token');
        navigate('/login');
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, [navigate]);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    navigate('/login');
  }, [navigate]);

  return { user, isLoading, logout };
}
