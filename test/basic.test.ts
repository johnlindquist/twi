import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

describe("tweetingest CLI", () => {
	it("displays help with --help", () => {
		const cliPath = join(__dirname, "..", "index.ts");
		const result = spawnSync("pnpm", ["node", cliPath, "--help"], {
			encoding: "utf-8",
		});

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("tweetingest [options] <username>");
		expect(result.stdout).toContain("--max-tweets");
		expect(result.stdout).toContain("--debug");
		expect(result.stdout).toContain("--pipe");
		expect(result.stdout).toContain("--no-editor");
		expect(result.stdout).toContain("--clipboard");
	});

	it("requires a username argument", () => {
		const cliPath = join(__dirname, "..", "index.ts");
		const result = spawnSync("pnpm", ["node", cliPath], {
			encoding: "utf-8",
			input: "\x03", // Send Ctrl+C to cancel the prompt
		});

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Enter a Twitter username");
	});
});
