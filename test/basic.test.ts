import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import envPaths from "env-paths";

// Utility to slice long outputs for cleaner logs
const sliceOutput = (output: string, maxLength = 500): string => {
	if (output.length <= maxLength) return output;
	const half = Math.floor(maxLength / 2);
	return `${output.slice(0, half)}... [${output.length - maxLength} chars truncated] ...${output.slice(-half)}`;
};

// Utility to extract key info from output
const extractKeyInfo = (stdout: string) => {
	const lines = stdout.split("\n");
	return lines
		.filter(
			(line) =>
				line.includes("🐦 TweetIngest CLI") ||
				line.includes("Scraping tweets") ||
				line.includes("Failed to scrape") ||
				line.includes("TWEETS_SAVED:") ||
				line.includes("Done! 🎉") ||
				line.includes("Error:"),
		)
		.join("\n");
};

describe("tweetingest CLI", () => {
	it("displays help with --help", () => {
		const cliPath = join(__dirname, "..", "index.ts");
		const result = spawnSync("pnpm", ["node", cliPath, "--help"], {
			encoding: "utf-8",
		});

		expect(result.status).toBe(0);
		const keyFeatures = [
			"--max-tweets",
			"--debug",
			"--pipe",
			"--no-editor",
			"--clipboard",
		];
		for (const feature of keyFeatures) {
			expect(result.stdout).toContain(feature);
		}
	});

	it("requires a username argument", () => {
		const cliPath = join(__dirname, "..", "index.ts");
		const result = spawnSync("pnpm", ["node", cliPath], {
			encoding: "utf-8",
			input: "\x03", // Send Ctrl+C to cancel the prompt
		});

		expect(result.status).toBe(0);
		console.log("Output:", sliceOutput(result.stdout));
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

		console.log("Key Info:", extractKeyInfo(result.stdout));

		const expectedMessages = [
			"🐦 TweetIngest CLI",
			"Scraping tweets",
			"Failed to scrape tweets",
			"page.goto: Timeout 1000ms exceeded",
		];

		for (const msg of expectedMessages) {
			expect(result.stdout).toContain(msg);
		}
	});

	it("attempts to scrape tweets and handles login wall", () => {
		const cliPath = join(__dirname, "..", "index.ts");
		const result = spawnSync(
			"pnpm",
			["node", cliPath, "johnlindquist", "-m", "1", "--debug"],
			{
				encoding: "utf-8",
				timeout: 30000,
			},
		);

		console.log("Test Output:", extractKeyInfo(result.stdout));

		const isSuccess = result.stdout.includes("Tweets scraped successfully");
		const isLoginWall = result.stdout.includes("Twitter is requiring login");
		const isBrowserWall = result.stdout.includes(
			"Twitter rejected our browser",
		);

		console.log("Status:", {
			isSuccess,
			isLoginWall,
			isBrowserWall,
		});

		expect(isSuccess || isLoginWall || isBrowserWall).toBe(true);

		if (isSuccess) {
			expect(result.stdout).toContain("Done! 🎉");
			const savedLine = result.stdout
				.split("\n")
				.find((line) => line.includes("TWEETS_SAVED:"));

			expect(savedLine).toBeDefined();

			if (savedLine) {
				const filePath = savedLine.split("TWEETS_SAVED:")[1].trim();
				const fileContent = readFileSync(filePath, "utf-8");
				console.log("File Content Preview:", sliceOutput(fileContent, 200));

				const requiredContent = ["# Tweets from @johnlindquist", "## Tweet 1"];
				for (const content of requiredContent) {
					expect(fileContent).toContain(content);
				}
				expect(fileContent).toMatch(
					/Generated: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/,
				);
			}
		} else if (isLoginWall) {
			const expectedErrors = [
				"Failed to scrape tweets",
				"Twitter is requiring login",
			];
			for (const error of expectedErrors) {
				expect(result.stdout).toContain(error);
			}
			expect(result.stdout).not.toContain("Done! 🎉");
		} else {
			const expectedErrors = [
				"Failed to scrape tweets",
				"Twitter rejected our browser",
			];
			for (const error of expectedErrors) {
				expect(result.stdout).toContain(error);
			}
			expect(result.stdout).not.toContain("Done! 🎉");
		}
	});
});
