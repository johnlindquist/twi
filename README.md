# TweetIngest CLI

A CLI tool to scrape and gather tweets from a Twitter (X) user's timeline (without the official API).

## Installation

```bash
pnpm install -g @johnlindquist/twi
```

## Usage

```bash
twi [options] <username>
```

### Examples

```bash
# Scrape 50 tweets from Elon
twi elonmusk

# Scrape up to 150 tweets, no editor
twi jack --max-tweets 150 --no-editor

# Print everything to console (still saves file)
twi yourUser --pipe
```

### Options

- `--max-tweets, -m`: Maximum number of tweets to scrape (default 50).
- `--debug`: Log verbose debug information.
- `--pipe, -p`: Print final output to stdout.
- `--no-editor, -n`: Save results but do not open in default editor.
- `--clipboard, -y`: Copy output to the clipboard.

### Disclaimer

This script uses Puppeteer to load Twitter's web interface and scroll the timeline. It may break if Twitter changes. For large accounts with thousands of tweets, you may need repeated runs or an official API solution.

### Development

```bash
# Install deps
pnpm install

# Start in dev mode
pnpm dev -- your_username

# Build
pnpm build

# Link CLI
pnpm link --global
twi your_username
```

MIT License 