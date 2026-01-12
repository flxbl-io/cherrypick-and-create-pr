// Mock the modules BEFORE importing the module under test
const mockGetInput = jest.fn();
const mockSetOutput = jest.fn();
const mockSetFailed = jest.fn();
const mockSetSecret = jest.fn();
const mockInfo = jest.fn();
const mockWarning = jest.fn();
const mockError = jest.fn();

jest.mock('@actions/core', () => ({
  getInput: mockGetInput,
  setOutput: mockSetOutput,
  setFailed: mockSetFailed,
  setSecret: mockSetSecret,
  info: mockInfo,
  warning: mockWarning,
  error: mockError
}));

const mockExec = jest.fn();
jest.mock('@actions/exec', () => ({
  exec: mockExec
}));

const mockGetOctokit = jest.fn();
jest.mock('@actions/github', () => ({
  getOctokit: mockGetOctokit
}));

// Now import the module under test
import { run } from '../index';

describe('cherrypick-and-create-pr', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function setupDefaultMocks() {
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'commits': 'abc1234',
        'target-branch': 'release/1.0',
        'new-branch': '',
        'pr-title': '',
        'pr-body': '',
        'gh-token': 'test-token',
        'repository': 'test-owner/test-repo',
        'author-name': 'github-actions[bot]',
        'author-email': 'github-actions[bot]@users.noreply.github.com',
        'draft': 'false',
        'labels': ''
      };
      return inputs[name] || '';
    });

    mockExec.mockResolvedValue(0);

    const mockOctokit = {
      rest: {
        pulls: {
          create: jest.fn().mockResolvedValue({
            data: {
              html_url: 'https://github.com/test-owner/test-repo/pull/42',
              number: 42
            }
          })
        },
        issues: {
          addLabels: jest.fn().mockResolvedValue({})
        }
      }
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    return mockOctokit;
  }

  describe('input validation', () => {
    it('should fail if no commits are specified', async () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'commits') return '';
        if (name === 'target-branch') return 'release/1.0';
        if (name === 'gh-token') return 'test-token';
        if (name === 'repository') return 'test-owner/test-repo';
        return '';
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('No commits specified');
    });

    it('should fail if repository is not set', async () => {
      delete process.env.GITHUB_REPOSITORY;
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'commits') return 'abc1234';
        if (name === 'target-branch') return 'release/1.0';
        if (name === 'gh-token') return 'test-token';
        if (name === 'repository') return '';
        return '';
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(
        'Repository not specified and GITHUB_REPOSITORY not set'
      );
    });
  });

  describe('git operations', () => {
    it('should configure git with author info', async () => {
      setupDefaultMocks();

      await run();

      expect(mockExec).toHaveBeenCalledWith(
        'git',
        ['config', 'user.name', 'github-actions[bot]'],
        expect.any(Object)
      );
      expect(mockExec).toHaveBeenCalledWith(
        'git',
        ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'],
        expect.any(Object)
      );
    });

    it('should fetch the target branch', async () => {
      setupDefaultMocks();

      await run();

      expect(mockExec).toHaveBeenCalledWith(
        'git',
        ['fetch', 'origin', 'release/1.0'],
        expect.any(Object)
      );
    });

    it('should checkout the target branch', async () => {
      setupDefaultMocks();

      await run();

      expect(mockExec).toHaveBeenCalledWith(
        'git',
        ['checkout', 'origin/release/1.0'],
        expect.any(Object)
      );
    });

    it('should cherry-pick the specified commits', async () => {
      setupDefaultMocks();

      await run();

      expect(mockExec).toHaveBeenCalledWith(
        'git',
        ['cherry-pick', 'abc1234', '--no-commit'],
        expect.any(Object)
      );
    });

    it('should push the branch after cherry-pick', async () => {
      setupDefaultMocks();

      await run();

      // Find the push call
      const pushCalls = mockExec.mock.calls.filter(
        (call: any[]) => call[0] === 'git' && call[1]?.[0] === 'push'
      );
      expect(pushCalls.length).toBeGreaterThan(0);
    });
  });

  describe('PR creation', () => {
    it('should create a pull request', async () => {
      const mockOctokit = setupDefaultMocks();

      await run();

      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test-owner',
          repo: 'test-repo',
          base: 'release/1.0',
          draft: false
        })
      );
    });

    it('should set PR outputs', async () => {
      setupDefaultMocks();

      await run();

      expect(mockSetOutput).toHaveBeenCalledWith(
        'pr-url',
        'https://github.com/test-owner/test-repo/pull/42'
      );
      expect(mockSetOutput).toHaveBeenCalledWith('pr-number', '42');
    });

    it('should create draft PR when draft input is true', async () => {
      mockGetInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          'commits': 'abc1234',
          'target-branch': 'release/1.0',
          'gh-token': 'test-token',
          'repository': 'test-owner/test-repo',
          'draft': 'true',
          'author-name': 'github-actions[bot]',
          'author-email': 'github-actions[bot]@users.noreply.github.com',
          'new-branch': '',
          'pr-title': '',
          'pr-body': '',
          'labels': ''
        };
        return inputs[name] || '';
      });

      mockExec.mockResolvedValue(0);

      const mockOctokit = {
        rest: {
          pulls: {
            create: jest.fn().mockResolvedValue({
              data: { html_url: 'https://github.com/test/test/pull/1', number: 1 }
            })
          },
          issues: { addLabels: jest.fn() }
        }
      };
      mockGetOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({
          draft: true
        })
      );
    });

    it('should add labels when specified', async () => {
      mockGetInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          'commits': 'abc1234',
          'target-branch': 'release/1.0',
          'gh-token': 'test-token',
          'repository': 'test-owner/test-repo',
          'labels': 'backport,urgent',
          'draft': 'false',
          'author-name': 'github-actions[bot]',
          'author-email': 'github-actions[bot]@users.noreply.github.com',
          'new-branch': '',
          'pr-title': '',
          'pr-body': ''
        };
        return inputs[name] || '';
      });

      mockExec.mockResolvedValue(0);

      const mockOctokit = {
        rest: {
          pulls: {
            create: jest.fn().mockResolvedValue({
              data: { html_url: 'https://github.com/test/test/pull/42', number: 42 }
            })
          },
          issues: { addLabels: jest.fn() }
        }
      };
      mockGetOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test-owner',
          repo: 'test-repo',
          issue_number: 42,
          labels: ['backport', 'urgent']
        })
      );
    });
  });

  describe('conflict handling', () => {
    it('should detect and handle merge conflicts', async () => {
      mockGetInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          'commits': 'abc1234',
          'target-branch': 'release/1.0',
          'gh-token': 'test-token',
          'repository': 'test-owner/test-repo',
          'draft': 'false',
          'author-name': 'github-actions[bot]',
          'author-email': 'github-actions[bot]@users.noreply.github.com',
          'new-branch': '',
          'pr-title': '',
          'pr-body': '',
          'labels': ''
        };
        return inputs[name] || '';
      });

      mockExec.mockImplementation(async (cmd: string, args: string[], options?: any) => {
        // Simulate conflict on cherry-pick
        if (cmd === 'git' && args[0] === 'cherry-pick' && args[1] !== '--abort') {
          return 1; // Non-zero exit code
        }

        // Simulate conflict markers in status
        if (cmd === 'git' && args[0] === 'status' && args[1] === '--porcelain') {
          if (options?.listeners?.stdout) {
            options.listeners.stdout(Buffer.from('UU conflicted-file.txt\n'));
          }
          return 0;
        }

        return 0;
      });

      const mockOctokit = {
        rest: {
          pulls: { create: jest.fn() },
          issues: { addLabels: jest.fn() }
        }
      };
      mockGetOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(mockSetOutput).toHaveBeenCalledWith('cherry-pick-status', 'conflict');
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('Merge conflict')
      );
    });
  });

  describe('multiple commits', () => {
    it('should handle multiple commits', async () => {
      mockGetInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          'commits': 'abc1234,def5678,ghi9012',
          'target-branch': 'release/1.0',
          'gh-token': 'test-token',
          'repository': 'test-owner/test-repo',
          'draft': 'false',
          'author-name': 'github-actions[bot]',
          'author-email': 'github-actions[bot]@users.noreply.github.com',
          'new-branch': '',
          'pr-title': '',
          'pr-body': '',
          'labels': ''
        };
        return inputs[name] || '';
      });

      mockExec.mockResolvedValue(0);

      const mockOctokit = {
        rest: {
          pulls: {
            create: jest.fn().mockResolvedValue({
              data: { html_url: 'https://github.com/test/test/pull/1', number: 1 }
            })
          },
          issues: { addLabels: jest.fn() }
        }
      };
      mockGetOctokit.mockReturnValue(mockOctokit);

      await run();

      // Should cherry-pick each commit
      expect(mockExec).toHaveBeenCalledWith(
        'git',
        ['cherry-pick', 'abc1234', '--no-commit'],
        expect.any(Object)
      );
      expect(mockExec).toHaveBeenCalledWith(
        'git',
        ['cherry-pick', 'def5678', '--no-commit'],
        expect.any(Object)
      );
      expect(mockExec).toHaveBeenCalledWith(
        'git',
        ['cherry-pick', 'ghi9012', '--no-commit'],
        expect.any(Object)
      );
    });
  });

  describe('branch naming', () => {
    it('should use custom branch name when provided', async () => {
      mockGetInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          'commits': 'abc1234',
          'target-branch': 'release/1.0',
          'gh-token': 'test-token',
          'repository': 'test-owner/test-repo',
          'new-branch': 'custom-branch-name',
          'draft': 'false',
          'author-name': 'github-actions[bot]',
          'author-email': 'github-actions[bot]@users.noreply.github.com',
          'pr-title': '',
          'pr-body': '',
          'labels': ''
        };
        return inputs[name] || '';
      });

      mockExec.mockResolvedValue(0);

      const mockOctokit = {
        rest: {
          pulls: {
            create: jest.fn().mockResolvedValue({
              data: { html_url: 'https://github.com/test/test/pull/1', number: 1 }
            })
          },
          issues: { addLabels: jest.fn() }
        }
      };
      mockGetOctokit.mockReturnValue(mockOctokit);

      await run();

      expect(mockExec).toHaveBeenCalledWith(
        'git',
        ['checkout', '-b', 'custom-branch-name'],
        expect.any(Object)
      );
    });

    it('should auto-generate branch name when not provided', async () => {
      setupDefaultMocks();

      await run();

      // Check that checkout -b was called with an auto-generated branch name
      const checkoutCall = mockExec.mock.calls.find(
        (call: any[]) => call[0] === 'git' && call[1]?.[0] === 'checkout' && call[1]?.[1] === '-b'
      );
      expect(checkoutCall).toBeDefined();
      expect(checkoutCall?.[1]?.[2]).toMatch(/^cherrypick\/release-1\.0\/abc1234-\d+$/);
    });
  });

  describe('token handling', () => {
    it('should mark the token as secret', async () => {
      setupDefaultMocks();

      await run();

      expect(mockSetSecret).toHaveBeenCalledWith('test-token');
    });
  });
});
