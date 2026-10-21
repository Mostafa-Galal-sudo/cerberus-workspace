import { SignJWT, importPKCS8 } from 'jose';
import type { Env } from '../types';

export type GithubAuthMode = 'app' | 'token' | 'none';

export interface GithubPullRequest {
  number: number;
  html_url: string;
  title: string;
  body?: string | null;
  state: string;
  head?: { ref: string };
  base?: { ref: string };
}

export interface GithubRepositorySummary {
  full_name: string;
  html_url: string;
  default_branch: string;
  open_issues_count: number;
  private: boolean;
}

export interface GithubSyncResult {
  repository: GithubRepositorySummary;
  pullRequests: GithubPullRequest[];
  branchCount: number;
}

export class GithubApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'GithubApiError';
  }
}

export function githubAuthMode(env: Env): GithubAuthMode {
  if (env.GITHUB_TOKEN) return 'token';
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_APP_INSTALLATION_ID) return 'app';
  return 'none';
}

interface InstallationToken {
  token: string;
  expiresAt: number;
}

let cachedInstallationToken: InstallationToken | null = null;

function normalizePrivateKey(value: string): string {
  return value.includes('\\n') ? value.replaceAll('\\n', '\n') : value;
}

async function getInstallationToken(env: Env): Promise<string> {
  if (cachedInstallationToken && cachedInstallationToken.expiresAt - 60 > Math.floor(Date.now() / 1000)) {
    return cachedInstallationToken.token;
  }

  const appId = env.GITHUB_APP_ID!;
  const installationId = env.GITHUB_APP_INSTALLATION_ID!;
  const privateKey = await importPKCS8(normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY!), 'RS256');
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(appId)
    .setExpirationTime('10m')
    .sign(privateKey);

  const response = await fetch(`https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cerberus-workspace',
    },
  });

  if (!response.ok) {
    throw new GithubApiError(response.status, `GitHub App installation token failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }

  const body = await response.json() as { token: string; expires_at: string };
  cachedInstallationToken = {
    token: body.token,
    expiresAt: Math.floor(new Date(body.expires_at).getTime() / 1000),
  };
  return body.token;
}

async function githubFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const mode = githubAuthMode(env);
  if (mode === 'none') throw new GithubApiError(503, 'GitHub App or token credentials are not configured');

  const token = mode === 'app' ? await getInstallationToken(env) : env.GITHUB_TOKEN!;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('X-GitHub-Api-Version', '2022-11-28');
  headers.set('User-Agent', 'cerberus-workspace');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`https://api.github.com${path}`, { ...init, headers });
  if (!response.ok) {
    throw new GithubApiError(response.status, `GitHub API request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  return response;
}

export async function createPullRequest(env: Env, input: {
  repository: string;
  title: string;
  head: string;
  base: string;
  body: string;
  draft?: boolean;
}): Promise<GithubPullRequest> {
  const response = await githubFetch(env, `/repos/${input.repository}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body,
      draft: Boolean(input.draft),
    }),
  });
  return response.json() as Promise<GithubPullRequest>;
}

export async function syncRepository(env: Env, repository: string): Promise<GithubSyncResult> {
  const [repositoryResponse, pullsResponse, branchesResponse] = await Promise.all([
    githubFetch(env, `/repos/${repository}`),
    githubFetch(env, `/repos/${repository}/pulls?state=open&per_page=50&sort=updated&direction=desc`),
    githubFetch(env, `/repos/${repository}/branches?per_page=100`),
  ]);

  const repositoryData = await repositoryResponse.json() as GithubRepositorySummary;
  const pullRequests = await pullsResponse.json() as GithubPullRequest[];
  const branches = await branchesResponse.json() as Array<{ name: string }>;

  return {
    repository: repositoryData,
    pullRequests,
    branchCount: Array.isArray(branches) ? branches.length : 0,
  };
}

export function extractTaskIds(text: string): string[] {
  return [...new Set(text.match(/task_[a-zA-Z0-9_-]+/g) ?? [])];
}
