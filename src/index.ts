import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';

const VERSION = '1.0.0';
const ACTION_NAME = 'cherrypick-and-create-pr';

interface ExecOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface Inputs {
  commits: string[];
  targetBranch: string;
  newBranch: string;
  prTitle: string;
  prBody: string;
  ghToken: string;
  repository: string;
  authorName: string;
  authorEmail: string;
  draft: boolean;
  labels: string[];
}

interface CherryPickResult {
  status: 'success' | 'conflict' | 'failed';
  successfulCommits: string[];
  failedCommit?: string;
  error?: string;
}

function printHeader(inputs: Inputs): void {
  const line = '-'.repeat(90);
  console.log(line);
  console.log(`flxbl-actions  -- ❤️  by flxbl.io ❤️  -Version:${VERSION}`);
  console.log(line);
  console.log(`Action        : ${ACTION_NAME}`);
  console.log(`Repository    : ${inputs.repository}`);
  console.log(`Target Branch : ${inputs.targetBranch}`);
  console.log(`Commits       : ${inputs.commits.join(', ')}`);
  console.log(`New Branch    : ${inputs.newBranch || '(auto-generated)'}`);
  console.log(line);
  console.log();
}

async function execCommand(
  command: string,
  args: string[],
  options: { silent?: boolean; ignoreReturnCode?: boolean; maxBuffer?: number } = {}
): Promise<ExecOutput> {
  let stdout = '';
  let stderr = '';

  const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024; // 10MB default
  let stdoutTruncated = false;
  let stderrTruncated = false;

  const exitCode = await exec.exec(command, args, {
    silent: options.silent ?? false,
    listeners: {
      stdout: (data: Buffer) => {
        if (!stdoutTruncated) {
          stdout += data.toString();
          if (stdout.length > maxBuffer) {
            stdout = stdout.substring(0, maxBuffer) + '\n... [output truncated]';
            stdoutTruncated = true;
          }
        }
      },
      stderr: (data: Buffer) => {
        if (!stderrTruncated) {
          stderr += data.toString();
          if (stderr.length > maxBuffer) {
            stderr = stderr.substring(0, maxBuffer) + '\n... [output truncated]';
            stderrTruncated = true;
          }
        }
      }
    },
    ignoreReturnCode: options.ignoreReturnCode ?? true
  });

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function configureGit(authorName: string, authorEmail: string): Promise<void> {
  core.info('Configuring git...');
  await execCommand('git', ['config', 'user.name', authorName]);
  await execCommand('git', ['config', 'user.email', authorEmail]);
}

async function fetchBranch(branch: string): Promise<void> {
  core.info(`Fetching branch: ${branch}`);
  const result = await execCommand('git', ['fetch', 'origin', branch]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to fetch branch ${branch}: ${result.stderr}`);
  }
}

async function createBranch(branchName: string, baseBranch: string): Promise<void> {
  core.info(`Creating branch ${branchName} from origin/${baseBranch}`);

  // Checkout the target branch first
  let result = await execCommand('git', ['checkout', `origin/${baseBranch}`]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to checkout origin/${baseBranch}: ${result.stderr}`);
  }

  // Create and checkout new branch
  result = await execCommand('git', ['checkout', '-b', branchName]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create branch ${branchName}: ${result.stderr}`);
  }
}

async function cherryPickCommits(commits: string[]): Promise<CherryPickResult> {
  const successfulCommits: string[] = [];

  for (const commit of commits) {
    core.info(`Cherry-picking commit: ${commit}`);

    const result = await execCommand('git', ['cherry-pick', commit, '--no-commit'], {
      ignoreReturnCode: true
    });

    if (result.exitCode !== 0) {
      // Check if it's a conflict
      const statusResult = await execCommand('git', ['status', '--porcelain']);
      const hasConflict = statusResult.stdout.includes('UU') ||
                          statusResult.stdout.includes('AA') ||
                          statusResult.stdout.includes('DD');

      if (hasConflict) {
        core.warning(`Conflict detected while cherry-picking ${commit}`);
        // Abort the cherry-pick
        await execCommand('git', ['cherry-pick', '--abort'], { ignoreReturnCode: true });
        return {
          status: 'conflict',
          successfulCommits,
          failedCommit: commit,
          error: `Merge conflict while cherry-picking commit ${commit}`
        };
      }

      return {
        status: 'failed',
        successfulCommits,
        failedCommit: commit,
        error: result.stderr || result.stdout
      };
    }

    // Commit the cherry-picked changes
    const commitResult = await execCommand('git', ['commit', '-m', `Cherry-pick: ${commit}`]);
    if (commitResult.exitCode !== 0 && !commitResult.stdout.includes('nothing to commit')) {
      return {
        status: 'failed',
        successfulCommits,
        failedCommit: commit,
        error: `Failed to commit cherry-pick: ${commitResult.stderr}`
      };
    }

    successfulCommits.push(commit);
    core.info(`Successfully cherry-picked: ${commit}`);
  }

  return {
    status: 'success',
    successfulCommits
  };
}

async function pushBranch(branchName: string): Promise<void> {
  core.info(`Pushing branch: ${branchName}`);
  const result = await execCommand('git', ['push', 'origin', branchName]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to push branch: ${result.stderr}`);
  }
}

async function getCommitMessage(commit: string): Promise<string> {
  const result = await execCommand('git', ['log', '-1', '--format=%s', commit], { silent: true });
  return result.stdout;
}

async function createPullRequest(
  inputs: Inputs,
  branchName: string,
  cherryPickResult: CherryPickResult
): Promise<{ url: string; number: number }> {
  const octokit = github.getOctokit(inputs.ghToken);
  const [owner, repo] = inputs.repository.split('/');

  // Generate PR title if not provided
  let title = inputs.prTitle;
  if (!title) {
    if (inputs.commits.length === 1) {
      title = await getCommitMessage(inputs.commits[0]);
      title = `Cherry-pick: ${title}`;
    } else {
      title = `Cherry-pick ${inputs.commits.length} commits to ${inputs.targetBranch}`;
    }
  }

  // Generate PR body if not provided
  let body = inputs.prBody;
  if (!body) {
    body = `## Cherry-pick PR\n\n`;
    body += `**Target branch:** \`${inputs.targetBranch}\`\n\n`;
    body += `### Commits cherry-picked:\n`;
    for (const commit of cherryPickResult.successfulCommits) {
      const msg = await getCommitMessage(commit);
      body += `- \`${commit.substring(0, 7)}\` ${msg}\n`;
    }
    body += `\n---\n`;
    body += `Generated by [flxbl-actions/cherrypick-and-create-pr](https://github.com/flxbl-io/cherrypick-and-create-pr)`;
  }

  core.info('Creating pull request...');
  const response = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head: branchName,
    base: inputs.targetBranch,
    draft: inputs.draft
  });

  core.info(`Pull request created: ${response.data.html_url}`);

  // Add labels if specified
  if (inputs.labels.length > 0) {
    core.info(`Adding labels: ${inputs.labels.join(', ')}`);
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: response.data.number,
      labels: inputs.labels
    });
  }

  return {
    url: response.data.html_url,
    number: response.data.number
  };
}

function generateBranchName(targetBranch: string, commits: string[]): string {
  const timestamp = Date.now();
  const shortSha = commits[0].substring(0, 7);
  const sanitizedTarget = targetBranch.replace(/\//g, '-');
  return `cherrypick/${sanitizedTarget}/${shortSha}-${timestamp}`;
}

function printSummary(
  inputs: Inputs,
  branchName: string,
  cherryPickResult: CherryPickResult,
  prUrl?: string,
  prNumber?: number
): void {
  console.log('');
  const line = '-'.repeat(90);
  console.log(line);
  console.log('Cherry-pick Summary');
  console.log(line);
  console.log(`Target Branch    : ${inputs.targetBranch}`);
  console.log(`New Branch       : ${branchName}`);
  console.log(`Commits Requested: ${inputs.commits.length}`);
  console.log(`Commits Applied  : ${cherryPickResult.successfulCommits.length}`);
  console.log(`Status           : ${cherryPickResult.status}`);
  if (cherryPickResult.failedCommit) {
    console.log(`Failed Commit    : ${cherryPickResult.failedCommit}`);
  }
  if (prUrl) {
    console.log(`PR URL           : ${prUrl}`);
    console.log(`PR Number        : #${prNumber}`);
  }
  console.log(line);
}

export async function run(): Promise<void> {
  try {
    const inputs: Inputs = {
      commits: core.getInput('commits', { required: true }).split(',').map(c => c.trim()),
      targetBranch: core.getInput('target-branch', { required: true }),
      newBranch: core.getInput('new-branch') || '',
      prTitle: core.getInput('pr-title') || '',
      prBody: core.getInput('pr-body') || '',
      ghToken: core.getInput('gh-token', { required: true }),
      repository: core.getInput('repository') || process.env.GITHUB_REPOSITORY || '',
      authorName: core.getInput('author-name') || 'github-actions[bot]',
      authorEmail: core.getInput('author-email') || 'github-actions[bot]@users.noreply.github.com',
      draft: core.getInput('draft') === 'true',
      labels: core.getInput('labels') ? core.getInput('labels').split(',').map(l => l.trim()) : []
    };

    if (!inputs.repository) {
      throw new Error('Repository not specified and GITHUB_REPOSITORY not set');
    }

    if (inputs.commits.length === 0 || (inputs.commits.length === 1 && inputs.commits[0] === '')) {
      throw new Error('No commits specified');
    }

    // Mark token as secret
    core.setSecret(inputs.ghToken);

    printHeader(inputs);

    // Generate branch name if not provided
    const branchName = inputs.newBranch || generateBranchName(inputs.targetBranch, inputs.commits);
    core.info(`Using branch name: ${branchName}`);

    // Configure git
    await configureGit(inputs.authorName, inputs.authorEmail);

    // Fetch target branch
    await fetchBranch(inputs.targetBranch);

    // Create new branch from target
    await createBranch(branchName, inputs.targetBranch);

    // Cherry-pick commits
    const cherryPickResult = await cherryPickCommits(inputs.commits);
    core.setOutput('cherry-pick-status', cherryPickResult.status);
    core.setOutput('branch-name', branchName);

    if (cherryPickResult.status === 'failed') {
      printSummary(inputs, branchName, cherryPickResult);
      throw new Error(`Cherry-pick failed: ${cherryPickResult.error}`);
    }

    if (cherryPickResult.status === 'conflict') {
      printSummary(inputs, branchName, cherryPickResult);
      core.warning(`Cherry-pick had conflicts. Manual intervention required.`);
      core.setFailed(`Merge conflict while cherry-picking commit ${cherryPickResult.failedCommit}`);
      return;
    }

    // Push the branch
    await pushBranch(branchName);

    // Create PR
    const pr = await createPullRequest(inputs, branchName, cherryPickResult);
    core.setOutput('pr-url', pr.url);
    core.setOutput('pr-number', pr.number.toString());

    printSummary(inputs, branchName, cherryPickResult, pr.url, pr.number);

    core.info('Cherry-pick and PR creation completed successfully!');

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('Unknown error occurred');
    }
  }
}

if (require.main === module) {
  run();
}
