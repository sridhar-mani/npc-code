/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SimulationStorageValue } from "./simulationStorage";

export enum TestSource {
	Local = 1,
	/** AML (Azure ML) runs */
	External = 2,
	/** NES external scenarios */
	NesExternal = 3,
}

export type TestSourceValue = SimulationStorageValue<TestSource>;
