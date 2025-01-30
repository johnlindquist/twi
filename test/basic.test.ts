import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import envPaths from "env-paths";

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

	it("handles timeout errors gracefully", () => {
		const cliPath = join(__dirname, "..", "index.ts");
		const result = spawnSync(
			"pnpm",
			["node", cliPath, "johnlindquist", "--timeout", "1"],
			{
				encoding: "utf-8",
			},
		);

		expect(result.stdout).toContain("🐦 TweetIngest CLI");
		expect(result.stdout).toContain("Scraping tweets");
		expect(result.stdout).toContain("Failed to scrape tweets");
		expect(result.stdout).toContain("page.goto: Timeout 1000ms exceeded");
		expect(result.stdout).toContain(
			"Try increasing the timeout with --timeout flag",
		);
	});

	it("attempts to scrape tweets and handles login wall", () => {
		const cliPath = join(__dirname, "..", "index.ts");
		const result = spawnSync(
			"pnpm",
			["node", cliPath, "johnlindquist", "-m", "1", "--debug"],
			{
				encoding: "utf-8",
				timeout: 30000, // 30 second timeout for the test itself
			},
		);

		// Check for initial messages
		expect(result.stdout).toContain("🐦 TweetIngest CLI");
		expect(result.stdout).toContain("Scraping tweets");

		// The test should pass if we either:
		// 1. Successfully scrape tweets
		// 2. Hit a login wall
		// 3. Hit a browser detection wall
		const isSuccess = result.stdout.includes("Tweets scraped successfully");
		const isLoginWall = result.stdout.includes("Twitter is requiring login");
		const isBrowserWall = result.stdout.includes(
			"Twitter rejected our browser",
		);

		expect(isSuccess || isLoginWall || isBrowserWall).toBe(true);

		if (isSuccess) {
			expect(result.stdout).toContain("Done! 🎉");

			// Extract saved file path
			const lines = result.stdout.split("\n");
			const savedLine = lines.find((line) => line.includes("TWEETS_SAVED:"));
			expect(savedLine).toBeDefined();

			if (savedLine) {
				const filePath = savedLine.split("TWEETS_SAVED:")[1].trim();
				const fileContent = readFileSync(filePath, "utf-8");

				// Verify file content
				expect(fileContent).toContain("# Tweets from @johnlindquist");
				expect(fileContent).toContain("## Tweet 1");
				expect(fileContent).toMatch(
					/Generated: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/,
				);
			}
		} else if (isLoginWall) {
			expect(result.stdout).toContain("Failed to scrape tweets");
			expect(result.stdout).toContain("Twitter is requiring login");
			expect(result.stdout).not.toContain("Done! 🎉"); // Should not show success message
		} else {
			expect(result.stdout).toContain("Failed to scrape tweets");
			expect(result.stdout).toContain("Twitter rejected our browser");
			expect(result.stdout).not.toContain("Done! 🎉"); // Should not show success message
		}
	});
});
