# Cherry-pick and Create PR

GitHub Action to cherry-pick commits to a target branch and automatically create a pull request.

## Usage

```yaml
- uses: flxbl-io/cherrypick-and-create-pr@v1
  with:
    commits: "abc1234,def5678"
    target-branch: "release/1.0"
    gh-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `commits` | Yes | - | Comma-separated list of commit SHAs to cherry-pick |
| `target-branch` | Yes | - | Target branch to cherry-pick onto |
| `new-branch` | No | auto-generated | Name for the new branch |
| `pr-title` | No | auto-generated | Title for the pull request |
| `pr-body` | No | auto-generated | Body for the pull request |
| `gh-token` | Yes | - | GitHub token for creating PR |
| `repository` | No | `${{ github.repository }}` | Repository name (owner/repo) |
| `author-name` | No | `github-actions[bot]` | Git author name |
| `author-email` | No | `github-actions[bot]@users.noreply.github.com` | Git author email |
| `draft` | No | `false` | Create PR as draft |
| `labels` | No | - | Comma-separated list of labels |

## Outputs

| Output | Description |
|--------|-------------|
| `pr-url` | URL of the created pull request |
| `pr-number` | Number of the created pull request |
| `branch-name` | Name of the branch that was created |
| `cherry-pick-status` | Status: `success`, `conflict`, or `failed` |

## Examples

### Single commit cherry-pick

```yaml
- uses: flxbl-io/cherrypick-and-create-pr@v1
  with:
    commits: "abc1234def5678"
    target-branch: "release/2.0"
    gh-token: ${{ secrets.GITHUB_TOKEN }}
```

### Multiple commits with custom PR title

```yaml
- uses: flxbl-io/cherrypick-and-create-pr@v1
  with:
    commits: "abc1234,def5678,ghi9012"
    target-branch: "hotfix/urgent-fix"
    pr-title: "Backport: Critical bug fixes"
    labels: "backport,urgent"
    gh-token: ${{ secrets.GITHUB_TOKEN }}
```

### Cherry-pick to release branch as draft

```yaml
- uses: flxbl-io/cherrypick-and-create-pr@v1
  with:
    commits: ${{ github.event.inputs.commits }}
    target-branch: ${{ github.event.inputs.release_branch }}
    draft: "true"
    gh-token: ${{ secrets.GITHUB_TOKEN }}
```

## Conflict Handling

If a merge conflict occurs during cherry-pick:
- The action will abort the cherry-pick
- `cherry-pick-status` output will be `conflict`
- The action will fail with an error message
- No PR will be created

You can handle conflicts in your workflow:

```yaml
- uses: flxbl-io/cherrypick-and-create-pr@v1
  id: cherrypick
  continue-on-error: true
  with:
    commits: "abc1234"
    target-branch: "release/1.0"
    gh-token: ${{ secrets.GITHUB_TOKEN }}

- name: Handle conflict
  if: steps.cherrypick.outputs.cherry-pick-status == 'conflict'
  run: echo "Manual intervention required for cherry-pick"
```

## License

Proprietary - flxbl.io
