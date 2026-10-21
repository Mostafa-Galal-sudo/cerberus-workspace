export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV: string;
  APP_ORIGIN?: string;
  SETUP_TOKEN?: string;
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_TOKEN?: string;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
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
