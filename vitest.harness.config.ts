import { defineConfig } from "vitest/config";

/** See `vitest.config.ts` for why the pi base packages resolve from `node_modules`. */
export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		include: ["test/harness/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: ["src/harness/**/*.ts", "src/agent.ts", "src/agent-loop.ts"],
			exclude: ["src/**/*.d.ts"],
			reporter: ["text", "html", "lcov"],
			reportsDirectory: "coverage/harness",
		},
	},
	resolve: {
		alias: [{ find: /^@taco-ai\/pi-harness$/, replacement: new URL("./src/index.ts", import.meta.url).pathname }],
	},
});
