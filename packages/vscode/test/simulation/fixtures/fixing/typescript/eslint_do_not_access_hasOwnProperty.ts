/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

function f() {
	const controller = {};
	const initialControllerProperties = {};
	for (const k in controller) {
		if (Object.hasOwn(controller, k)) {
			initialControllerProperties[k] = controller[k];
		}
	}
}
