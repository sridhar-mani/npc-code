/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, type IDisposable } from "../../../util/vs/base/common/lifecycle";
import {
	IInstantiationService,
	type ServicesAccessor,
} from "../../../util/vs/platform/instantiation/common/instantiation";
import { NewWorkspaceInitializer } from "./newWorkspaceInitializer";

export function create(accessor: ServicesAccessor): IDisposable {
	const instantiationService = accessor.get(IInstantiationService);

	const disposableStore = new DisposableStore();
	disposableStore.add(instantiationService.createInstance(NewWorkspaceInitializer));

	return disposableStore;
}
