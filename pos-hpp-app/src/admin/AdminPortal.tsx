import React, { useState } from 'react';
import { AdminDashboardPage } from './AdminDashboardPage';
import { AdminLoginPage } from './AdminLoginPage';
import { loadAdminSession, type AdminSession } from './adminService';

export const AdminPortal: React.FC = () => {
  const [session, setSession] = useState<AdminSession | null>(() => loadAdminSession());

  if (!session) {
    return <AdminLoginPage onLoginSuccess={(s) => setSession(s)} />;
  }

  return <AdminDashboardPage session={session} onLogout={() => setSession(null)} />;
};
