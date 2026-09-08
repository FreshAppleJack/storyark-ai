import type { ReactElement, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useApp } from '../InteractionContent/AppContext';

interface ProtectedRouteProps {
  children: ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps): ReactElement {
  const { user } = useApp();
  const location = useLocation();

  if (!user?.isAuthenticated) {
    // Preserve the requested location and replace the blocked history entry.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
