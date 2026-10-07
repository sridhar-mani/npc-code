//!!! DO NOT modify, this file was COPIED from 'microsoft/vscode'

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This is a facade for the observable implementation. Only import from here!

export type {
	IObservable,
	IObservableWithChange,
	IObserver,
	IReader,
	ISettable,
	ISettableObservable,
	ITransaction,
} from "./base";
export { type IChangeContext, type IChangeTracker, recordChanges, recordChangesLazy } from "./changeTracker";
export { DebugLocation } from "./debugLocation";
export type { DebugOwner } from "./debugName";
export { derivedConstOnceDefined, latestChangedValue } from "./experimental/utils";
export { ObservableMap } from "./map";
export { constObservable } from "./observables/constObservable";
export {
	derived,
	derivedDisposable,
	derivedHandleChanges,
	derivedOpts,
	derivedWithSetter,
	derivedWithStore,
} from "./observables/derived";
export type { IDerivedReader } from "./observables/derivedImpl";
export { observableFromEvent, observableFromEventOpts } from "./observables/observableFromEvent";
export { type IObservableSignal, observableSignal } from "./observables/observableSignal";
export { observableSignalFromEvent } from "./observables/observableSignalFromEvent";
export { disposableObservableValue, observableValue } from "./observables/observableValue";
export { observableValueOpts } from "./observables/observableValueOpts";
export {
	autorun,
	autorunDelta,
	autorunHandleChanges,
	autorunIterableDelta,
	autorunOpts,
	autorunSelfDisposable,
	autorunWithStore,
	autorunWithStoreHandleChanges,
} from "./reactions/autorun";
export { ObservableSet } from "./set";
export { asyncTransaction, globalTransaction, subtransaction, TransactionImpl, transaction } from "./transaction";
export { ObservableLazy, ObservableLazyPromise, ObservablePromise, PromiseResult } from "./utils/promise";
export {
	type RemoveUndefined,
	runOnChange,
	runOnChangeWithCancellationToken,
	runOnChangeWithStore,
} from "./utils/runOnChange";
export {
	debouncedObservable,
	debouncedObservable2,
	derivedObservableWithCache,
	derivedObservableWithWritableCache,
	isObservable,
	keepObserved,
	mapObservableArrayCached,
	observableFromPromise,
	recomputeInitiallyAndOnChange,
	signalFromObservable,
	wasEventTriggeredRecently,
} from "./utils/utils";
export { derivedWithCancellationToken, waitForState } from "./utils/utilsCancellation";
export { observableFromValueWithChangeEvent, ValueWithChangeEventFromObservable } from "./utils/valueWithChangeEvent";

import { env } from "../process";
import { ConsoleObservableLogger, logObservableToConsole } from "./logging/consoleObservableLogger";
import { debugGetObservableGraph } from "./logging/debugGetDependencyGraph";
import { DevToolsLogger } from "./logging/debugger/devToolsLogger";
import { addLogger, setLogObservableFn } from "./logging/logging";
import { _setDebugGetObservableGraph } from "./observables/baseObservable";

_setDebugGetObservableGraph(debugGetObservableGraph);
setLogObservableFn(logObservableToConsole);

// Remove "//" in the next line to enable logging
const enableLogging = false;
// || Boolean("true") // done "weirdly" so that a lint warning prevents you from pushing this

if (enableLogging) {
	addLogger(new ConsoleObservableLogger());
}

if (env && env["VSCODE_DEV_DEBUG_OBSERVABLES"]) {
	// To debug observables you also need the extension "ms-vscode.debug-value-editor"
	addLogger(DevToolsLogger.getInstance());
}
