#!/usr/bin/env node

/* 
  tweetingest-cli.js

  Example usage:
    $ tweetingest --max-tweets 50 https://twitter.com/user
    $ tweetingest --debug --pipe @username
    $ tweetingest --clipboard username
    $ tweetingest --install (installs required browser)

  1) Installs required libs:
     pnpm add @clack/prompts conf env-paths date-fns playwright clipboardy

  2) Make executable and run:
     chmod +x tweetingest-cli.js
     ./tweetingest-cli.js [options] username
*/

import { hideBin } from "yargs/helpers";
import yargs from "yargs";
import * as p from "@clack/prompts";
import { format } from "date-fns";
import envPaths from "env-paths";
import { fileURLToPath } from "node:url";
import clipboard from "clipboardy";
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

// Read package.json for version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packagePath = join(__dirname, "..", "package.json");

interface PackageJson {
	version: string;
}

const packageJson: PackageJson = existsSync(packagePath)
	? JSON.parse(readFileSync(packagePath, "utf8"))
	: { version: "0.0.0" };

/** Constants/Helpers ******************************/

const RESULTS_SAVED_MARKER = "TWEETS_SAVED:";
const DEFAULT_SEARCHES_DIR = envPaths("tweetingest").config;

type IngestFlags = {
	maxTweets: number;
	pipe?: boolean;
	debug?: boolean;
	noEditor?: boolean;
	clipboard?: boolean;
	install?: boolean;
	timeout?: number;
};

/** YARGS Setup ************************************/

const argv = yargs(hideBin(process.argv))
	.scriptName("tweetingest")
	.usage("$0 [options] <username>")
	.version("version", "Show version number", packageJson.version)
	.alias("version", "v")
	.option("max-tweets", {
		alias: "m",
		type: "number",
		default: 50,
		describe: "Maximum number of tweets to scrape",
	})
	.option("timeout", {
		alias: "t",
		type: "number",
		default: 30,
		describe: "Timeout in seconds for initial page load",
	})
	.option("debug", {
		type: "boolean",
		default: false,
		describe: "Enable debug logging",
	})
	.option("pipe", {
		alias: "p",
		type: "boolean",
		default: false,
		describe: "Print final results to stdout",
	})
	.option("no-editor", {
		alias: "n",
		type: "boolean",
		default: false,
		describe: "Don't open results in an editor",
	})
	.option("clipboard", {
		alias: "y",
		type: "boolean",
		default: false,
		describe: "Copy final output to clipboard",
	})
	.option("install", {
		type: "boolean",
		default: false,
		describe: "Install required browser",
	})
	.help()
	.alias("h", "help")
	.parseSync();

/** Main CLI Logic *********************************/

async function checkBrowserInstallation() {
	try {
		const browser = await chromium.launch();
		await browser.close();
		return true;
	} catch (err) {
		return false;
	}
}

async function installBrowser() {
	try {
		p.note("Installing Chromium browser...");
		execSync("playwright install chromium", { stdio: "inherit" });
		p.note("Browser installed successfully!");
		return true;
	} catch (err) {
		p.cancel(`Failed to install browser: ${err}`);
		return false;
	}
}

(async function main() {
	p.intro("🐦 TweetIngest CLI");

	// Handle --install flag
	if (argv.install) {
		await installBrowser();
		process.exit(0);
	}

	// Check browser installation
	const isBrowserInstalled = await checkBrowserInstallation();
	if (!isBrowserInstalled) {
		p.note(`
Chromium browser is not installed. You can install it by:

1. Running this command:
   twi --install

2. Or manually running:
   pnpm rebuild -g @johnlindquist/twi

The browser is required for scraping tweets.
		`);
		process.exit(1);
	}

	const username = argv._[0];
	if (!username) {
		const val = await p.text({
			message: "Enter a Twitter username (without @):",
			validate: (v) => (v ? undefined : "Please provide a username"),
		});
		if (p.isCancel(val)) {
			p.cancel("Operation cancelled.");
			process.exit(0);
		}
		argv._[0] = val;
	}

	const flags: IngestFlags = {
		maxTweets: argv["max-tweets"],
		debug: argv.debug,
		pipe: argv.pipe,
		noEditor: argv["no-editor"],
		clipboard: argv.clipboard,
		install: argv.install,
		timeout: argv.timeout,
	};

	if (flags.debug) {
		console.log("[DEBUG] User:", argv._[0]);
		console.log("[DEBUG] Flags:", flags);
	}

	const spinner = p.spinner();
	spinner.start("Scraping tweets...");

	let tweets: string[] = [];
	try {
		tweets = await scrapeTweets(String(argv._[0]), flags, (progress) => {
			spinner.message(`Scraping tweets... Found ${progress} tweets so far`);
		});
		spinner.stop("Tweets scraped successfully!");

		// Build final output
		const markdown = generateMarkdown(String(argv._[0]), tweets);
		const fileName = `tweetingest-${argv._[0]}-${Date.now()}.md`;
		const filePath = join(DEFAULT_SEARCHES_DIR, fileName);
		writeFileSync(filePath, markdown, "utf8");

		// Possibly copy to clipboard
		if (flags.clipboard) {
			try {
				await clipboard.write(markdown);
				p.note("Output copied to clipboard!");
			} catch (err) {
				p.note(`Failed to copy to clipboard: ${(err as Error).message}`);
			}
		}

		// Print results path
		if (flags.pipe) {
			console.log(markdown);
		} else {
			console.log(`${RESULTS_SAVED_MARKER} ${filePath}`);
		}

		p.outro("Done! 🎉");
	} catch (err) {
		spinner.stop("Failed to scrape tweets.");
		if (err instanceof Error && err.message.includes("Timeout")) {
			p.cancel(
				`${err.message}\nTry increasing the timeout with --timeout flag`,
			);
		} else {
			p.cancel(String(err));
		}
		process.exit(1);
	}
})();

/** Tweet Scraping Logic ***************************/

async function scrapeTweets(
	username: string,
	flags: IngestFlags,
	onProgress: (count: number) => void,
): Promise<string[]> {
	const browser = await chromium.launch({
		headless: process.env.VITEST !== "1", // Show browser during tests
		args: [
			"--window-size=1920,1080",
			"--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		],
	});
	const page = await browser.newPage();
	const tweets: string[] = [];

	try {
		// Set viewport to match window size
		await page.setViewportSize({ width: 1920, height: 1080 });

		// Slow down operations in debug mode or during tests
		if (flags.debug || process.env.VITEST === "1") {
			await page.setDefaultTimeout(0); // No timeout in debug/test
			await page.setDefaultNavigationTimeout(0); // No navigation timeout in debug/test
		} else {
			await page.setDefaultTimeout((flags.timeout || 30) * 1000);
			await page.setDefaultNavigationTimeout((flags.timeout || 30) * 1000);
		}

		// Go to Twitter and wait for network to be idle
		await page.goto(`https://twitter.com/${username}`, {
			waitUntil: "networkidle",
		});

		if (flags.debug) {
			const content = await page.content();
			console.log("[DEBUG] Page Content:", content);
		}

		// First check for login wall
		const loginWall = await page.$('div[data-testid="loginButton"]');
		if (loginWall) {
			if (flags.debug) {
				console.log("[DEBUG] Found login wall, attempting to bypass...");
			}
			// Try to close the login dialog if it exists
			const closeButton = await page.$('div[aria-label="Close"]');
			if (closeButton) {
				await closeButton.click();
				await page.waitForTimeout(1000);
			}
		}

		try {
			// Wait for tweets to load with user-specified timeout
			await page.waitForSelector('article[data-testid="tweet"]', {
				timeout: (flags.timeout || 30) * 1000,
				state: "attached", // Wait for element to be actually attached to DOM
			});

			if (flags.debug) {
				const tweets = await page.$$eval(
					'article[data-testid="tweet"]',
					(elements) => {
						return elements.map((el) => ({
							html: el.innerHTML,
							text: el.textContent,
						}));
					},
				);
				console.log("[DEBUG] Found Tweets:", tweets);
			}

			let lastTweetCount = 0;
			let retryCount = 0;
			const maxRetries = 3;
			let noNewTweetsTime = Date.now();

			while (tweets.length < flags.maxTweets && retryCount < maxRetries) {
				// Wait a bit for dynamic content to load
				await page.waitForTimeout(2000);

				const newTweets = await page.$$eval(
					'article[data-testid="tweet"]',
					(elements) => {
						return elements.map((el) => {
							const text =
								el.querySelector('div[data-testid="tweetText"]')?.textContent ||
								"";
							const time =
								el.querySelector("time")?.getAttribute("datetime") || "";
							return { text, time };
						});
					},
				);

				for (const t of newTweets) {
					if (!tweets.some((existing) => existing === t.text)) {
						tweets.push(t.text);
						onProgress(tweets.length);
						noNewTweetsTime = Date.now(); // Reset timer when we find new tweets
					}
				}

				if (tweets.length === lastTweetCount) {
					retryCount++;
					// If we haven't found new tweets in 10 seconds, break
					if (Date.now() - noNewTweetsTime > 10000) {
						break;
					}
					if (retryCount < maxRetries) {
						// Try scrolling more
						await page.evaluate(() => window.scrollBy(0, 2000));
						await page.waitForTimeout(2000);
					}
				} else {
					retryCount = 0;
				}

				lastTweetCount = tweets.length;

				if (flags.debug) {
					console.log(`[DEBUG] Found ${tweets.length} tweets so far...`);
				}
			}
		} catch (err) {
			if (err instanceof Error && err.message.includes("Timeout")) {
				// Try to get any tweets that loaded before timeout
				const pageContent = await page.content();
				const partialTweets = await page.$$eval(
					'article[data-testid="tweet"]',
					(elements) => {
						return elements.map((el) => {
							const text =
								el.querySelector('div[data-testid="tweetText"]')?.textContent ||
								"";
							return text;
						});
					},
				);

				tweets.push(
					...partialTweets.filter((text) => text && !tweets.includes(text)),
				);

				onProgress(tweets.length);

				if (tweets.length === 0) {
					if (flags.debug) {
						console.log("[DEBUG] Page Content at Error:", pageContent);
					}

					// Check if we got the unsupported browser error
					if (pageContent.includes("This browser is no longer supported")) {
						throw new Error(
							"Twitter rejected our browser. Try updating the user agent string or using a different browser profile.",
						);
					}

					// Check for login wall
					if (await page.$('div[data-testid="loginButton"]')) {
						throw new Error(
							"Twitter is requiring login. Try increasing the timeout or using a different browser profile.",
						);
					}

					throw new Error(
						"No tweets could be loaded before timeout. Try increasing the timeout with --timeout flag",
					);
				}
			} else {
				throw err;
			}
		}

		return tweets.slice(0, flags.maxTweets);
	} finally {
		await browser.close();
	}
}

function generateMarkdown(username: string, tweets: string[]): string {
	const timestamp = format(new Date(), "yyyy-MM-dd HH:mm:ss");
	return `# Tweets from @${username}
Generated: ${timestamp}

${tweets.map((tweet, i) => `## Tweet ${i + 1}\n${tweet}\n`).join("\n")}`;
}
