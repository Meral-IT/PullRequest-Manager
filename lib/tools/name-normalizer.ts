export function normalizeBranchName(branch: string): string {
    return branch.startsWith('refs/heads/') ? branch.substring('refs/heads/'.length) : branch;
}