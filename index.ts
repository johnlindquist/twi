#!/usr/bin/env node

/* 
  tweetingest-cli.js

  Example usage:
    $ tweetingest --max-tweets 50 https://twitter.com/user
    $ tweetingest --debug --pipe @username
    $ tweetingest --clipboard username

  1) Installs required libs:
     pnpm add @clack/prompts conf env-paths date-fns puppeteer clipboardy

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
import puppeteer from "puppeteer";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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
	.help()
	.alias("h", "help")
	.parseSync();

/** Main CLI Logic *********************************/

(async function main() {
	p.intro("🐦 TweetIngest CLI");

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
	};

	if (flags.debug) {
		console.log("[DEBUG] User:", argv._[0]);
		console.log("[DEBUG] Flags:", flags);
	}

	const spinner = p.spinner();
	spinner.start("Scraping tweets...");

	let tweets: string[] = [];
	try {
		tweets = await scrapeTweets(String(argv._[0]), flags);
		spinner.stop("Tweets scraped successfully.");
	} catch (err) {
		spinner.stop("Failed to scrape tweets.");
		p.cancel(String(err));
		process.exit(1);
	}

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
})();

/** Tweet Scraping Logic ***************************/

async function scrapeTweets(
	username: string,
	flags: IngestFlags,
): Promise<string[]> {
	const browser = await puppeteer.launch({ headless: true });
	const page = await browser.newPage();

	try {
		await page.goto(`https://twitter.com/${username}`);
		// Wait for tweets to load
		await page.waitForSelector('article[data-testid="tweet"]', {
			timeout: 5000,
		});

		const tweets: string[] = [];
		let lastTweetCount = 0;

		while (tweets.length < flags.maxTweets) {
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
				}
			}

			if (tweets.length === lastTweetCount) {
				break; // No new tweets found after scrolling
			}

			lastTweetCount = tweets.length;
			await page.evaluate(() => {
				window.scrollBy(0, 1000);
			});
			await new Promise((resolve) => setTimeout(resolve, 1000));
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
