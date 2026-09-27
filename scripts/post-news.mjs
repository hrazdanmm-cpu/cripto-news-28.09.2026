// scripts/post-news.mjs
//
// Reads a list of crypto-news RSS feeds, checks each source's articles
// against data/posted.json, and posts anything new to a Telegram channel via
// a bot. Updates data/posted.json so the same article is never posted twice.
//
// On the very first run for a source (no history yet), it backfills the
// latest BACKFILL_COUNT articles (oldest -> newest) so the channel isn't empty.
// After that, only genuinely new articles are posted.
//
// Required environment variables (set as GitHub Actions secrets):
//   BOT_TOKEN  - Telegram bot token from @BotFather
//   CHAT_ID    - Telegram channel/chat id the bot should post to (e.g. @mychannel or -100123456789)

import Parser from 'rss-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'posted.json');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// How many articles to backfill the first time a source is seen.
const BACKFILL_COUNT = 5;

// How many old links to remember per source (keeps the state file small).
const HISTORY_LIMIT = 30;

// Source name -> RSS feed URL. Names must match the keys already used in
// data/posted.json so dedup state lines up correctly.
const FEEDS = {
  'Cointelegraph': 'https://cointelegraph.com/rss',
  'CoinDesk': 'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'Decrypt': 'https://decrypt.co/feed',
  'The Block': 'https://www.theblock.co/rss.xml',
  'CryptoSlate': 'https://cryptoslate.com/feed/',
  'Bitcoinist': 'https://bitcoinist.com/feed/',
  'NewsBTC': 'https://www.newsbtc.com/feed/',
  'Bitcoin.com News': 'https://news.bitcoin.com/feed/',
  'CryptoPotato': 'https://cryptopotato.com/feed/',
  'Crypto News': 'https://crypto.news/feed/',
  'CoinJournal': 'https://coinjournal.net/feed/',
  'Crypto Daily': 'https://cryptodaily.co.uk/feed',
  'TheNewsCrypto': 'https://thenewscrypto.com/feed/',
  'Crypto Briefing': 'https://cryptobriefing.com/feed/',
  'ZyCrypto': 'https://zycrypto.com/feed/',
};

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChatCryptoBot/1.0)' },
});

function stripUtm(url) {
  try {
    const u = new URL(url);
    [...u.searchParams.keys()]
      .filter((k) => k.toLowerCase().startsWith('utm_'))
      .forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return url;
  }
}

async function loadState() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.sources) parsed.sources = {};
    if (typeof parsed.totalPostedCount !== 'number') parsed.totalPostedCount = 0;
    return parsed;
  } catch {
    return { sources: {}, totalPostedCount: 0 };
  }
}

async function saveState(state) {
  await fs.writeFile(DATA_PATH, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

async function sendToTelegram(source, title, link) {
  const text =
    `🟠 <b>${escapeHtml(source)}</b>\n\n` +
    `${escapeHtml(title)}\n\n` +
    `<a href="${link}">Կարդալ ամբողջը</a>`;

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram API error for "${source}": ${JSON.stringify(data)}`);
  }
}

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function main() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('Missing BOT_TOKEN or CHAT_ID environment variables.');
    process.exit(1);
  }

  const state = await loadState();
  let posted = 0;

  for (const [source, feedUrl] of Object.entries(FEEDS)) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const items = (feed.items || []).filter((i) => i.link);

      if (items.length === 0) {
        console.log(`[${source}] no items found, skipping.`);
        continue;
      }

      const seenLinks = new Set(state.sources[source] || []);
      const isFirstRun = seenLinks.size === 0;

      // Items come newest-first from the feed; take what we need and post
      // oldest -> newest so the channel reads in chronological order.
      const candidates = isFirstRun
        ? items.slice(0, BACKFILL_COUNT).reverse()
        : items.filter((i) => !seenLinks.has(stripUtm(i.link))).reverse();

      if (candidates.length === 0) {
        console.log(`[${source}] no new article.`);
        continue;
      }

      for (const item of candidates) {
        const cleanLink = stripUtm(item.link);
        if (seenLinks.has(cleanLink)) continue; // safety net against duplicates within this run

        await sendToTelegram(source, item.title || '(no title)', cleanLink);
        seenLinks.add(cleanLink);
        state.totalPostedCount += 1;
        posted += 1;
        console.log(`[${source}] posted: ${item.title}`);

        // small delay so we don't hit Telegram's rate limits
        await new Promise((r) => setTimeout(r, 1200));
      }

      // Keep only the most recent HISTORY_LIMIT links for this source.
      state.sources[source] = [...seenLinks].slice(-HISTORY_LIMIT);
    } catch (err) {
      console.error(`[${source}] error: ${err.message}`);
      // keep going with the other sources even if one feed fails
    }
  }

  if (posted > 0) {
    await saveState(state);
    console.log(`Done. Posted ${posted} new article(s). Total: ${state.totalPostedCount}`);
  } else {
    console.log('Done. Nothing new to post.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});