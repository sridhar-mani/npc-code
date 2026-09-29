import * as vscode from 'vscode';

export class GitContext {
	static async getGitState(): Promise<{ branch?: string; changesCount: number }> {
		try {
			const gitExtension = vscode.extensions.getExtension('vscode.git');
			if (gitExtension) {
				const git = gitExtension.isActive ? gitExtension.exports.getAPI(1) : (await gitExtension.activate())?.getAPI(1);
				if (git && git.repositories && git.repositories.length > 0) {
					const repo = git.repositories[0];
					const branch = repo.state?.HEAD?.name;
					const changes = (repo.state?.workingTreeChanges?.length || 0) + (repo.state?.indexChanges?.length || 0);
					return { branch, changesCount: changes };
				}
			}
		} catch {
			// Optional integration
		}
		return { changesCount: 0 };
	}
}
