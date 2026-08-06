import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchCurrentUser, type AuthUser } from '../api/auth';
import { getNexusToken, removeNexusToken } from '../lib/tokenStorage';

export type { AuthUser };

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
      const token = getNexusToken();
      if (!token) {
        navigate('/login');
        return;
      }

      try {
        const userData = await fetchCurrentUser(token);
        setUser(userData);
      } catch {
        removeNexusToken();
        navigate('/login');
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, [navigate]);

  const logout = useCallback(() => {
    removeNexusToken();
    navigate('/login');
  }, [navigate]);

  return { user, isLoading, logout };
}
