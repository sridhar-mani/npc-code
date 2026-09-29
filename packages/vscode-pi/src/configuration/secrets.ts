import * as vscode from 'vscode';

export class PiSecretStorage {
	private static readonly SECRET_PREFIX = 'pi.apiKey.';

	constructor(private readonly _secrets: vscode.SecretStorage) {}

	public async getApiKey(providerId: string): Promise<string | undefined> {
		return this._secrets.get(`${PiSecretStorage.SECRET_PREFIX}${providerId}`);
	}

	public async setApiKey(providerId: string, apiKey: string): Promise<void> {
		if (!apiKey) {
			await this.deleteApiKey(providerId);
			return;
		}
		await this._secrets.store(`${PiSecretStorage.SECRET_PREFIX}${providerId}`, apiKey);
	}

	public async deleteApiKey(providerId: string): Promise<void> {
		await this._secrets.delete(`${PiSecretStorage.SECRET_PREFIX}${providerId}`);
	}
}
