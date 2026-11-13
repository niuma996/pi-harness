import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
// Match publication: remove outputs of deleted sources before compiling.
rmSync(join(root, "dist"), { recursive: true, force: true });
execFileSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", join(root, "tsconfig.build.json")], {
	cwd: root, stdio: "inherit",
});
const consumer = mkdtempSync(join(tmpdir(), "pi-harness-consumer-"));
try {
	const [pack] = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", consumer], {
		cwd: root, encoding: "utf8",
	}));
	const files = new Set(pack.files.map((file) => file.path));
	for (const path of ["docs/telemetry-schema.md", "LICENSE", "LICENSE.upstream", "README.md", "README.zh-CN.md", `docs/releases/${manifest.version}.md`]) {
		if (!files.has(path)) throw new Error(`Package is missing ${path}`);
	}
	for (const entry of Object.values(manifest.exports)) {
		if (typeof entry !== "object") continue;
		for (const field of ["types", "import"]) {
			const target = entry[field];
			if (!target || !files.has(target.replace(/^\.\//, ""))) {
				throw new Error(`Packed export is missing ${field}: ${target}`);
			}
		}
	}
	writeFileSync(join(consumer, "package.json"), JSON.stringify({
		private: true,
		type: "module",
		dependencies: { [manifest.name]: `file:${join(consumer, pack.filename)}`, ...manifest.peerDependencies },
		// genai's public declarations require its optional MCP peer and browser types.
		devDependencies: { "@types/node": manifest.devDependencies["@types/node"], "@modelcontextprotocol/sdk": "1.30.0" },
	}));
	try {
		execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
			cwd: consumer, encoding: "utf8", stdio: "pipe", timeout: 300_000,
		});
	} catch (error) {
		process.stderr.write(String(error.stdout ?? "") + String(error.stderr ?? ""));
		throw error;
	}
	const exports = Object.keys(manifest.exports).filter((path) => path !== "./package.json")
		.map((path) => path === "." ? manifest.name : `${manifest.name}${path.slice(1)}`);
	writeFileSync(join(consumer, "consumer.ts"), exports.map((name, index) =>
		`import * as entry${index} from ${JSON.stringify(name)};\nvoid entry${index};`,
	).join("\n") + `
import { BACKGROUND_CONTEXT, type Context, type JsonValue } from ${JSON.stringify(manifest.name)};
import { type ConversationViewPublisher, type ChordViewBridge, createConversationViewPublisher } from ${JSON.stringify(`${manifest.name}/experimental/pico3`)};
const context: Context = BACKGROUND_CONTEXT;
const signal: AbortSignal | undefined = context.abortSignal;
const json: JsonValue = { nested: [true, null, "value"] };
type Publisher = ConversationViewPublisher & { subscribe(listener: () => void): () => void };
function observe(bridge: ChordViewBridge<Publisher>) { return bridge.view.subscribe(() => {}); }
void [signal, json, observe, createConversationViewPublisher];
`);
	writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({
		compilerOptions: {
			target: "ES2024", module: "NodeNext", moduleResolution: "NodeNext",
			lib: ["ES2024", "DOM"], types: ["node"], strict: true, skipLibCheck: false, noEmit: true,
		},
		files: ["consumer.ts"],
	}));
	try {
		execFileSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", join(consumer, "tsconfig.json")], {
			cwd: consumer, encoding: "utf8", stdio: "pipe",
		});
	} catch (error) {
		process.stderr.write(String(error.stdout ?? "") + String(error.stderr ?? ""));
		throw error;
	}
	writeFileSync(join(consumer, "smoke.mjs"), `
import assert from "node:assert/strict";
import { createModels } from "@earendil-works/pi-ai/compat";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AgentHarness, BACKGROUND_CONTEXT, MemorySessionRepo, NOOP_TELEMETRY_CONTEXT } from ${JSON.stringify(manifest.name)};
for (const name of ${JSON.stringify(exports)}) await import(name);
assert.equal(BACKGROUND_CONTEXT.telemetry, NOOP_TELEMETRY_CONTEXT);
const faux = fauxProvider();
faux.setResponses([fauxAssistantMessage("packed consumer works")]);
const models = createModels();
models.setProvider(faux.provider);
const session = await new MemorySessionRepo().create({}, BACKGROUND_CONTEXT);
let harness;
try {
  ({ harness } = await AgentHarness.create({ session, models, model: faux.getModel() }, BACKGROUND_CONTEXT));
  const lane = await harness.lane("main", BACKGROUND_CONTEXT);
  const result = await lane.prompt("hello", undefined, BACKGROUND_CONTEXT);
  assert.ok(result.ok);
  assert.equal(result.value.status, "completed");
} finally {
  await harness?.close(BACKGROUND_CONTEXT);
  await session.close(BACKGROUND_CONTEXT);
}
`);
	execFileSync(process.execPath, [join(consumer, "smoke.mjs")], { cwd: consumer, stdio: "inherit" });
	console.log(`Packed consumer verified: ${exports.length} exports, strict declarations with GenAI type prerequisites (DOM and MCP SDK), model round trip.`);
} finally {
	rmSync(consumer, { recursive: true, force: true });
}
