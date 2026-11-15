import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_CONTEXT } from "../../src/harness/context.ts";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { getOrThrow } from "../../src/harness/types.ts";
import { createTempDir } from "./session-test-utils.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, readdir: vi.fn(actual.readdir), lstat: vi.fn(actual.lstat) };
});

afterEach(() => vi.restoreAllMocks());

describe("NodeExecutionEnv.listDir concurrent changes", () => {
	it("keeps other entries when an atomic publish renames a file after readdir", async () => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		const temporary = join(root, "session.jsonl.tmp");
		await fs.writeFile(temporary, "{}\n");
		await fs.writeFile(join(root, "stable.jsonl"), "{}\n");
		const actual = await vi.importActual<typeof fs>("node:fs/promises");
		const readdir = vi.mocked<(path: string, options: { withFileTypes: true }) => Promise<Dirent[]>>(fs.readdir);
		readdir.mockImplementationOnce(async () => {
			const snapshot = await actual.readdir(root, { withFileTypes: true });
			await fs.rename(temporary, join(root, "session.jsonl"));
			return snapshot;
		});

		const entries = getOrThrow(await env.listDir(".", BACKGROUND_CONTEXT));
		expect(entries.map((entry) => entry.name)).toEqual(["stable.jsonl"]);
		expect(getOrThrow(await env.readTextFile("session.jsonl", BACKGROUND_CONTEXT))).toBe("{}\n");
	});

	it("returns not_found when the requested directory does not exist", async () => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		expect(await env.listDir("missing", BACKGROUND_CONTEXT)).toMatchObject({
			ok: false,
			error: { code: "not_found", path: join(root, "missing") },
		});
	});

	it.each(["EACCES", "EPERM", "EIO", "ENOTDIR"])("preserves a child lstat %s error", async (code) => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		const path = join(root, "session.jsonl");
		await fs.writeFile(path, "{}\n");
		const cause = Object.assign(new Error(`lstat failed: ${code}`), { code, path });
		vi.mocked(fs.lstat).mockRejectedValueOnce(cause);
		expect(await env.listDir(".", BACKGROUND_CONTEXT)).toMatchObject({
			ok: false,
			error: { path, cause, message: cause.message },
		});
	});
});
