import { request, type APIRequestContext } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const setupToken = process.env.E2E_SETUP_TOKEN ?? 'e2e-setup-token';
const authDir = path.resolve('tests/e2e/.auth');
const credentialsPath = path.join(authDir, 'initial-credentials.json');
const preparedPath = path.join(authDir, 'prepared.json');

interface InitialCredential {
  name: string;
  email: string;
  temporaryPassword: string;
}

interface PreparedAccount {
  email: string;
  password: string;
}

interface PreparedState {
  admin: PreparedAccount;
  member: PreparedAccount;
  temp: PreparedAccount;
  storage: { admin: string; member: string };
}

interface LoginData {
  csrfToken: string;
  mustChangePassword: boolean;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

async function login(api: APIRequestContext, email: string, password: string): Promise<LoginData> {
  const response = await api.post('/api/v1/auth/login', { data: { email, password } });
  if (!response.ok()) {
    throw new Error(`E2E login failed for ${email}: ${response.status()} ${await response.text()}`);
  }
  const payload = await response.json() as { data: LoginData };
  return payload.data;
}

async function changePassword(api: APIRequestContext, csrfToken: string, currentPassword: string, newPassword: string) {
  const response = await api.post('/api/v1/auth/change-password', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { currentPassword, newPassword },
  });
  if (!response.ok()) {
    throw new Error(`E2E password change failed: ${response.status()} ${await response.text()}`);
  }
}

async function prepareFreshAccount(
  context: APIRequestContext,
  credential: InitialCredential,
  newPassword: string,
  storagePath: string,
): Promise<PreparedAccount> {
  const session = await login(context, credential.email, credential.temporaryPassword);
  if (session.mustChangePassword) {
    await changePassword(context, session.csrfToken, credential.temporaryPassword, newPassword);
  }
  await context.storageState({ path: storagePath });
  return { email: credential.email, password: newPassword };
}

export default async function globalSetup() {
  mkdirSync(authDir, { recursive: true });

  const bootstrap = await request.newContext({ baseURL });
  const setup = await bootstrap.post('/api/v1/setup/initialize', {
    headers: { Authorization: `Bearer ${setupToken}` },
  });

  let credentials: InitialCredential[] | null = null;
  if (setup.status() === 201) {
    const payload = await setup.json() as { data: { initialCredentials: InitialCredential[] } };
    credentials = payload.data.initialCredentials;
    writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
  } else if (setup.status() === 409) {
    if (!existsSync(credentialsPath) && !existsSync(preparedPath)) {
      throw new Error('The E2E database is already initialized and no saved credentials are available. Remove .wrangler/e2e-state and retry.');
    }
  } else {
    throw new Error(`E2E setup failed: ${setup.status()} ${await setup.text()}`);
  }
  await bootstrap.dispose();

  const adminStorage = path.join(authDir, 'admin-state.json');
  const memberStorage = path.join(authDir, 'member-state.json');

  if (credentials) {
    const adminCredential = credentials.find((item) => item.email === 'mostafa@cerberus.local');
    const memberCredential = credentials.find((item) => item.email === 'wessam@cerberus.local');
    const tempCredential = credentials.find((item) => item.email === 'nabil@cerberus.local');
    if (!adminCredential || !memberCredential || !tempCredential) {
      throw new Error('E2E setup did not return the expected account roster');
    }

    const adminContext = await request.newContext({ baseURL });
    const memberContext = await request.newContext({ baseURL });
    const admin = await prepareFreshAccount(adminContext, adminCredential, 'E2e!Admin2026', adminStorage);
    const member = await prepareFreshAccount(memberContext, memberCredential, 'E2e!Member2026', memberStorage);
    await adminContext.dispose();
    await memberContext.dispose();

    const prepared: PreparedState = {
      admin,
      member,
      temp: { email: tempCredential.email, password: tempCredential.temporaryPassword },
      storage: { admin: adminStorage, member: memberStorage },
    };
    writeFileSync(preparedPath, JSON.stringify(prepared, null, 2));
    return;
  }

  if (!existsSync(preparedPath)) {
    throw new Error('No prepared E2E credentials found after an already-initialized database');
  }

  const prepared = readJson<PreparedState>(preparedPath);
  for (const [account, storagePath] of [
    [prepared.admin, adminStorage],
    [prepared.member, memberStorage],
  ] as Array<[PreparedAccount, string]>) {
    const context = await request.newContext({ baseURL });
    await login(context, account.email, account.password);
    await context.storageState({ path: storagePath });
    await context.dispose();
  }
  writeFileSync(preparedPath, JSON.stringify(prepared, null, 2));
}
