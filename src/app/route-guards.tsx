import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './auth-context';

export function AdminGate() {
  const { user } = useAuth();
  if (!user?.roles.includes('super_admin')) return <Navigate to="/" replace />;
  return <Outlet />;
}
