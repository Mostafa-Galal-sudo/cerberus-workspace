/* eslint-disable react-refresh/only-export-components */
import { Navigate, createBrowserRouter } from 'react-router-dom';
import { useAuth } from './auth-context';
import { AdminGate } from './route-guards';
import { AppShell } from '../components/app-shell';
import { PageSkeleton } from '../components/ui';
import { ActivationPage } from '../features/auth/activation-page';
import { ForgotPasswordPage } from '../features/auth/forgot-password-page';
import { LoginPage } from '../features/auth/login-page';
import { ChangePasswordPage } from '../features/auth/change-password-page';
import { ResetPasswordPage } from '../features/auth/reset-password-page';
import { DashboardPage } from '../features/dashboard/dashboard-page';
import { ReviewQueuePage } from '../features/tasks/review-queue-page';
import { TaskDetailPage } from '../features/tasks/task-detail-page';
import { TasksPage } from '../features/tasks/tasks-page';
import { PlanningPage } from '../features/planning/planning-page';
import { MembersPage } from '../features/members/members-page';
import { ChatPage } from '../features/collaboration/chat-page';
import { AnnouncementsPage } from '../features/collaboration/announcements-page';
import { NotificationsPage } from '../features/collaboration/notifications-page';
import { WikiPage } from '../features/workspace/wiki-page';
import { IssuesPage } from '../features/workspace/issues-page';
import { HardwarePage } from '../features/workspace/hardware-page';
import { ExperimentsPage } from '../features/workspace/experiments-page';
import { DecisionsPage } from '../features/workspace/decisions-page';
import { WorklogsPage } from '../features/workspace/worklogs-page';
import { GithubPage } from '../features/integrations/github-page';
import { AdminCommandCenterPage } from '../features/admin/admin-command-center-page';
import { AssistantPage } from '../features/assistant/assistant-page';
import { ReportsPage } from '../features/reports/reports-page';

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <div className="boot-screen"><PageSkeleton /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <ChangePasswordPage />;
  return <AppShell />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/activate', element: <ActivationPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    path: '/',
    element: <Protected />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'tasks/:taskId', element: <TaskDetailPage /> },
      { path: 'planning', element: <PlanningPage /> },
      {
        element: <AdminGate />,
        children: [
          { path: 'reviews', element: <ReviewQueuePage /> },
          { path: 'admin', element: <AdminCommandCenterPage /> },
          { path: 'settings', element: <AdminCommandCenterPage /> },
        ],
      },
      { path: 'members', element: <MembersPage /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'announcements', element: <AnnouncementsPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'wiki', element: <WikiPage /> },
      { path: 'wiki/:slug', element: <WikiPage /> },
      { path: 'issues', element: <IssuesPage /> },
      { path: 'hardware', element: <HardwarePage /> },
      { path: 'experiments', element: <ExperimentsPage /> },
      { path: 'decisions', element: <DecisionsPage /> },
      { path: 'worklogs', element: <WorklogsPage /> },
      { path: 'integrations/github', element: <GithubPage /> },
      { path: 'assistant', element: <AssistantPage /> },
      { path: 'reports', element: <ReportsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
