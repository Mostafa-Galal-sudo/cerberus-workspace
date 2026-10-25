export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ATTACHMENTS?: R2Bucket;
  APP_ENV: string;
  APP_ORIGIN?: string;
  SETUP_TOKEN?: string;
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_TOKEN?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL?: { send: (message: { to: string; from: string; subject: string; text?: string; html?: string }) => Promise<unknown> };
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  SESSION_IDLE_MINUTES?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  specialization: string | null;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
}

export type Variables = { user: AuthUser; sessionId: string; csrfToken: string };
