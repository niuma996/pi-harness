import { defineConfig } from "vitest/config";

/**
 * Resolves the pi base packages from `node_modules` (the published 1.x builds),
 * not from sibling monorepo source. That is deliberate: this package's whole
 * reason to exist is to prove the 0.99.2 harness runs against the *published*
 * latest pi-ai/chord/pi-telemetry, so the tests must exercise those artifacts.
 */
export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
		silent: "passed-only",
	},
	resolve: {
		alias: [{ find: /^@taco-ai\/pi-harness$/, replacement: new URL("./src/index.ts", import.meta.url).pathname }],
	},
});
