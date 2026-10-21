import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPullRequest, extractTaskIds, githubAuthMode, syncRepository } from '../../worker/services/github';
import type { Env } from '../../worker/types';

const baseEnv = { GITHUB_TOKEN: 'ghp_unit_test_token' } as unknown as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('outbound GitHub service', () => {
  it('reports the configured authentication mode', () => {
    expect(githubAuthMode({} as Env)).toBe('none');
    expect(githubAuthMode({ GITHUB_TOKEN: 'token' } as Env)).toBe('token');
    expect(githubAuthMode({
      GITHUB_APP_ID: '123',
      GITHUB_APP_PRIVATE_KEY: 'key',
      GITHUB_APP_INSTALLATION_ID: '456',
    } as Env)).toBe('app');
  });

  it('creates a pull request with token authentication and a JSON payload', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      number: 42,
      html_url: 'https://github.com/example/repo/pull/42',
      title: 'feat: telemetry',
      state: 'open',
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const pullRequest = await createPullRequest(baseEnv, {
      repository: 'example/repo',
      title: 'feat: telemetry',
      head: 'feature/telemetry',
      base: 'main',
      body: 'Linked task: task_1_1',
      draft: true,
    });

    expect(pullRequest.number).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/example/repo/pulls');
    expect(init.method).toBe('POST');
    const headers = init.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer ghp_unit_test_token');
    expect(headers.get('x-github-api-version')).toBe('2022-11-28');
    expect(JSON.parse(String(init.body))).toMatchObject({
      title: 'feat: telemetry',
      head: 'feature/telemetry',
      base: 'main',
      draft: true,
    });
  });

  it('loads repository, pull request and branch summaries', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/example/repo')) {
        return new Response(JSON.stringify({
          full_name: 'example/repo',
          html_url: 'https://github.com/example/repo',
          default_branch: 'main',
          open_issues_count: 3,
          private: true,
        }), { status: 200 });
      }
      if (url.includes('/pulls')) {
        return new Response(JSON.stringify([
          { number: 8, html_url: 'https://github.com/example/repo/pull/8', title: 'task_1_1 telemetry', state: 'open' },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([{ name: 'main' }, { name: 'feature' }]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await syncRepository(baseEnv, 'example/repo');
    expect(result.repository.full_name).toBe('example/repo');
    expect(result.repository.default_branch).toBe('main');
    expect(result.pullRequests).toHaveLength(1);
    expect(result.branchCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('extracts unique task references from GitHub text', () => {
    expect(extractTaskIds('task_1_1 fixes task_1_1 and task_2_3')).toEqual(['task_1_1', 'task_2_3']);
    expect(extractTaskIds('no task reference')).toEqual([]);
  });
});
