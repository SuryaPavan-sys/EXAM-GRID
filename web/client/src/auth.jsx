import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    api('/me').then(setUser).catch(() => setToken(null)).finally(() => setChecking(false));
  }, []);

  const login = async (role, username, password) => {
    const { token, user: u } = await api('/auth/login', { method: 'POST', body: { role, username, password } });
    setToken(token);
    setUser(u);
    return u;
  };
  const logout = () => { setToken(null); setUser(null); };

  return <AuthContext.Provider value={{ user, checking, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
