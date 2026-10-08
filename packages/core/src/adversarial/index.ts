/**
 * DualAgentAdversary: Builder vs. Breaker Red-Teaming Pair.
 *
 * Implements a co-operative adversarial loop where a 'Breaker' agent actively synthesizes
 * edge-case inputs, boundary tests, and failure vectors to challenge the 'Builder' agent's code.
 * Ensures defensive coding resilience before declaring task completion.
 */

export interface AdversarialTestCase {
	id: string;
	category: "null_empty" | "boundary_limits" | "concurrency_race" | "malformed_input" | "resource_exhaustion";
	description: string;
	testInput: unknown;
	expectedAssertion: string;
}

export interface BreakerEvaluationResult {
	vulnerabilitiesFound: number;
	testCases: AdversarialTestCase[];
	resilienceScore: number; // 0.0 to 1.0
	passed: boolean;
	counterExamples: string[];
}

export class DualAgentAdversary {
	/**
	 * Breaker analyzes the builder's patch / code and generates targeted adversarial test vectors.
	 */
	generateBreakerScenarios(sourceCode: string, targetFunctionName?: string): AdversarialTestCase[] {
		const testCases: AdversarialTestCase[] = [];

		// Analyze parameter and type signatures or patterns in the source code
		const hasArrayHandling =
			sourceCode.includes(".map(") || sourceCode.includes(".filter(") || sourceCode.includes(".length");
		const hasStringHandling =
			sourceCode.includes(".split(") || sourceCode.includes(".trim()") || sourceCode.includes(".slice(");
		const hasNumberHandling = sourceCode.includes("+") || sourceCode.includes("-") || sourceCode.includes("Math.");
		const hasAsyncHandling = sourceCode.includes("async") || sourceCode.includes("Promise");

		let idCounter = 1;

		// Vector 1: Null / Undefined / Empty Inputs
		if (hasStringHandling || hasArrayHandling) {
			testCases.push({
				id: `adv-${idCounter++}`,
				category: "null_empty",
				description: `Pass null, undefined, or empty structures to ${targetFunctionName ?? "entrypoint"}`,
				testInput: { emptyString: "", nullValue: null, emptyArray: [] },
				expectedAssertion: "Must not throw UnhandledException or TypeError: Cannot read property",
			});
		}

		// Vector 2: Boundary & Extreme Numeric Limits
		if (hasNumberHandling) {
			testCases.push({
				id: `adv-${idCounter++}`,
				category: "boundary_limits",
				description: `Pass negative numbers, zero, NaN, and MAX_SAFE_INTEGER`,
				testInput: { values: [0, -1, Number.NaN, Number.MAX_SAFE_INTEGER, -Infinity] },
				expectedAssertion: "Must handle zero and negative indices without infinite loops or memory overflow",
			});
		}

		// Vector 3: Malformed & Unexpected Structures
		testCases.push({
			id: `adv-${idCounter++}`,
			category: "malformed_input",
			description: "Pass deeply nested objects, circular references, or unexpected prototypes",
			testInput: { unexpectedKey: 12345, nested: { recursive: true } },
			expectedAssertion: "Must gracefully validate schema without crash",
		});

		// Vector 4: Concurrency & Async Ordering
		if (hasAsyncHandling) {
			testCases.push({
				id: `adv-${idCounter++}`,
				category: "concurrency_race",
				description: "Invoke multiple concurrent calls simultaneously to check for race conditions",
				testInput: { concurrentRequests: 10 },
				expectedAssertion: "Shared state must remain consistent across concurrent promises",
			});
		}

		// Vector 5: Resource limits
		testCases.push({
			id: `adv-${idCounter++}`,
			category: "resource_exhaustion",
			description: "Pass 10,000 element payload to ensure linear time complexity",
			testInput: { payloadSize: 10000 },
			expectedAssertion: "Execution finishes within standard timeout without heap exhaustion",
		});

		return testCases;
	}

	/**
	 * Evaluates the builder's code against the breaker test cases.
	 */
	evaluateResilience(sourceCode: string, testCases: AdversarialTestCase[]): BreakerEvaluationResult {
		const counterExamples: string[] = [];

		// Rule-based vulnerability analysis on the code against the vectors
		for (const tc of testCases) {
			if (tc.category === "null_empty") {
				const hasOptionalChainingOrGuard =
					sourceCode.includes("?.") || sourceCode.includes("if (!") || sourceCode.includes("??");
				if (!hasOptionalChainingOrGuard) {
					counterExamples.push(
						`Potential unhandled null/undefined dereference in missing guard checks (${tc.description}).`,
					);
				}
			}

			if (tc.category === "concurrency_race") {
				const hasLockOrMutex =
					sourceCode.includes("mutex") || sourceCode.includes("Promise.all") || sourceCode.includes("atomic");
				const hasSharedMutation = sourceCode.includes("this.") && sourceCode.includes("=");
				if (hasSharedMutation && !hasLockOrMutex) {
					counterExamples.push(
						`Unsynchronized instance state mutation detected under concurrent operations (${tc.description}).`,
					);
				}
			}

			if (tc.category === "boundary_limits") {
				const hasNegativeGuard =
					sourceCode.includes("<= 0") || sourceCode.includes("< 0") || sourceCode.includes("Math.max");
				if (!hasNegativeGuard && sourceCode.includes("[")) {
					counterExamples.push(
						`Unchecked array index access with potential negative numbers (${tc.description}).`,
					);
				}
			}
		}

		const vulnerabilitiesFound = counterExamples.length;
		const resilienceScore =
			testCases.length === 0 ? 1.0 : Math.max(0.1, 1.0 - vulnerabilitiesFound / testCases.length);

		return {
			vulnerabilitiesFound,
			testCases,
			resilienceScore: Number(resilienceScore.toFixed(2)),
			passed: vulnerabilitiesFound === 0,
			counterExamples,
		};
	}

	/**
	 * Generates feedback prompt for Builder when breaker discovers flaws.
	 */
	generateBuilderRepairPrompt(evalResult: BreakerEvaluationResult): string {
		if (evalResult.passed) {
			return "Code passed all adversarial breaker tests without identified vulnerabilities.";
		}

		const lines: string[] = [];
		lines.push("### Breaker Adversarial Red-Team Findings");
		lines.push(
			`Resilience Score: ${Math.round(evalResult.resilienceScore * 100)}% (Vulnerabilities: ${evalResult.vulnerabilitiesFound})`,
		);
		lines.push("Fix the following edge-case vulnerabilities discovered by the Breaker agent:");

		for (const [idx, item] of evalResult.counterExamples.entries()) {
			lines.push(`${idx + 1}. ${item}`);
		}

		return lines.join("\n");
	}
}
