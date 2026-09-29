/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';

const REPO_ROOT = path.join(__dirname, '..', '..');
const MONO_ROOT = path.join(REPO_ROOT, '..', '..');

export async function copyStaticAssets(srcpaths: string[], dst: string): Promise<void> {
	await Promise.all(srcpaths.map(async srcpath => {
		let src = path.join(REPO_ROOT, srcpath);
		if (!fs.existsSync(src)) {
			const hoistedSrc = path.join(MONO_ROOT, srcpath);
			if (fs.existsSync(hoistedSrc)) {
				src = hoistedSrc;
			} else {
				const altSrc = hoistedSrc.includes('tree-sitter-c_sharp.wasm')
					? hoistedSrc.replace('tree-sitter-c_sharp.wasm', 'tree-sitter-c-sharp.wasm')
					: hoistedSrc.includes('tree-sitter-c-sharp.wasm')
						? hoistedSrc.replace('tree-sitter-c-sharp.wasm', 'tree-sitter-c_sharp.wasm')
						: null;
				if (altSrc && fs.existsSync(altSrc)) {
					src = altSrc;
				} else {
					console.warn(`[copyStaticAssets] Warning: source not found: ${srcpath}`);
					return;
				}
			}
		}
		const dest = path.join(REPO_ROOT, dst, path.basename(srcpath));
		await fs.promises.mkdir(path.dirname(dest), { recursive: true });
		await fs.promises.copyFile(src, dest);

		if (path.basename(srcpath).includes('c-sharp.wasm') || path.basename(srcpath).includes('c_sharp.wasm')) {
			await fs.promises.copyFile(src, path.join(REPO_ROOT, dst, 'tree-sitter-c-sharp.wasm'));
			await fs.promises.copyFile(src, path.join(REPO_ROOT, dst, 'tree-sitter-c_sharp.wasm'));
		}
	}));
}
