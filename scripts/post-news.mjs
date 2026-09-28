import Parser from 'rss-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'posted.json');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const BACKFILL_COUNT = 2;
const HISTORY_LIMIT = 100;
const MAX_POSTS_PER_RUN = 10;
const MAX_SUMMARY_LINES = 15;

// If the Mini App has a short name: https://t.me/Block_News_Crypto_bot/<short_name>
const MINI_APP_URL = 'https://t.me/Block_News_Crypto_bot';

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

const AD_TEMPLATES = [
  "📊 If you are trading, using Futures Calculator is essential; it is impossible to succeed without calculating your risks in advance.",
  "⚡ Professional traders never open trades blindly; always check your liquidation price with Futures Calculator before entering.",
  "🎯 Want to avoid liquidation? Futures Calculator is your #1 tool to keep your risks 100% under control.",
  "💡 The biggest mistake in futures trading is choosing an improper leverage; calculate the exact size in Futures Calculator.",
  "📈 Trading is pure mathematics; use Futures Calculator so that every Take Profit and Stop Loss is mathematically justified.",
  "🔥 If you are serious about your capital, Futures Calculator should be your primary daily trading tool.",
  "🛡️ Protect your deposit from unpredictable market volatility; calculate your breakeven price before making a trade.",
  "🚀 The key to your trading success is the risk/margin ratio; verify it with Futures Calculator and execute with confidence.",
  "💎 Don't leave your money to chance; Futures Calculator gives you a clear picture of the trade before you hit Buy or Sell.",
  "🧠 Trading without risk management is pure gambling; elevate your trades to a professional level with Futures Calculator.",
  "⚡ Precise signals and automated scanner; use the Signal Scanner in Futures Calculator to find trades with 70%+ win probability.",
  "📉 Avoid costly mistakes; calculating your position size in Futures Calculator will save your account from liquidation.",
  "🔮 Unsure when to enter the market? Check the Fear & Greed index and Long/Short ratio in Futures Calculator right now.",
  "📊 Using a DCA strategy? Calculate your exact average entry price with our precise calculator.",
  "💸 Every trader needs to know their actual Funding Rate and potential risks; check them instantly in Futures Calculator.",
  "🏆 Control your emotions; when numbers and calculations are accurate, trading becomes predictable and profitable.",
  "🔎 Find the highest-potential Binance pairs in seconds using the built-in tools inside Futures Calculator.",
  "📝 Keep track of all your trades in the Trading Journal and analyze your growth using Futures Calculator.",
  "💣 10x, 20x, or 50x leverage? Know exactly how much risk you take using the Leverage Simulator in Futures Calculator.",
  "📊 See the whole market overview with Market Heatmap and make smart, data-driven decisions inside Futures Calculator.",
  "🛑 Liquidation isn't bad luck—it's a calculation error; use Futures Calculator to eliminate it.",
  "💰 Calculate compound interest growth and see how your deposit can grow over time with Futures Calculator.",
  "🔔 Never miss sharp market movements; set up Price Alerts directly in Futures Calculator.",
  "📲 Generate sleek PnL cards after profitable trades and share your success using Futures Calculator.",
  "✨ If you truly want to make consistent profits in futures trading, Futures Calculator is your indispensable assistant."
];

const UA = 'Mozilla/5.0 (compatible; ChatCryptoBot/1.0)';
const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': UA } });

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

function escapeHtml(s = '') {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeEntities(s = '') {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function htmlToText(html = '') {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function rssImage(item) {
  const html = item['content:encoded'] || item.content || '';
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m) return decodeEntities(m[1]);
  if (item.enclosure?.url && /image/i.test(item.enclosure.type || 'image')) return item.enclosure.url;
  return null;
}

async function fetchArticle(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (!res.ok) return { image: null, text: '' };
    const html = await res.text();

    const m =
      html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    let image = m ? decodeEntities(m[1]) : null;
    if (image) {
      try { image = new URL(image, url).toString(); } catch { image = null; }
    }

    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');
    const paras = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((x) => htmlToText(x[1]))
      .filter((t) => t.length > 50);
    return { image, text: paras.join(' ').slice(0, 8000) };
  } catch {
    return { image: null, text: '' };
  }
}

// Free, key-less summary: picks up to 15 informative sentences from the article body.
function summarize(text) {
  const sentences = (text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+(?=\s|$)/g) || [])
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 400)
    .filter((s) => !/subscribe|newsletter|cookie|follow us|read more|sign up|advertis/i.test(s));
  const unique = [...new Set(sentences)];
  return unique.slice(0, MAX_SUMMARY_LINES);
}

function nextAd(state) {
  if (typeof state.adIndex !== 'number' || state.adIndex < 0) state.adIndex = 0;
  const ad = AD_TEMPLATES[state.adIndex % AD_TEMPLATES.length];
  state.adIndex = (state.adIndex + 1) % AD_TEMPLATES.length;
  return ad;
}

function buildMessage(title, lines, ad) {
  const head = `<b>${escapeHtml(title)}</b>\n\n`;
  const tail = `\n\n${escapeHtml(ad)}\n<a href="${MINI_APP_URL}">Futures Calculator ⬇️</a>`;
  const body = lines.map((l) => `• ${escapeHtml(l)}`);
  let msg = head + body.join('\n') + tail;
  while (msg.length > 4000 && body.length > 1) {
    body.pop();
    msg = head + body.join('\n') + tail;
  }
  return msg;
}

async function sendPost(text, image) {
  const payload = { chat_id: CHAT_ID, text, parse_mode: 'HTML' };
  payload.link_preview_options = image
    ? { url: image, prefer_large_media: true, show_above_text: true }
    : { is_disabled: true };
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API error: ${JSON.stringify(data)}`);
}

async function loadState() {
  try {
    const p = JSON.parse(await fs.readFile(DATA_PATH, 'utf-8'));
    if (!p.sources) p.sources = {};
    if (typeof p.totalPostedCount !== 'number') p.totalPostedCount = 0;
    if (typeof p.adIndex !== 'number') p.adIndex = 0;
    return p;
  } catch {
    return { sources: {}, totalPostedCount: 0, adIndex: 0 };
  }
}

async function saveState(state) {
  await fs.writeFile(DATA_PATH, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

async function main() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('Missing BOT_TOKEN or CHAT_ID.');
    process.exit(1);
  }
  const state = await loadState();
  let posted = 0;

  outer: for (const [source, feedUrl] of Object.entries(FEEDS)) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const items = (feed.items || []).filter((i) => i.link);
      if (!items.length) continue;

      const seen = new Set(state.sources[source] || []);
      const isFirst = seen.size === 0;
      const candidates = isFirst
        ? items.slice(0, BACKFILL_COUNT).reverse()
        : items.filter((i) => !seen.has(stripUtm(i.link))).reverse();

      for (const item of candidates) {
        if (posted >= MAX_POSTS_PER_RUN) {
          state.sources[source] = [...seen].slice(-HISTORY_LIMIT);
          break outer;
        }
        const link = stripUtm(item.link);
        if (seen.has(link)) continue;

        try {
          const art = await fetchArticle(link);
          const image = art.image || rssImage(item);
          const rssText = htmlToText(item['content:encoded'] || item.content || item.summary || '');
          const text = art.text.length > rssText.length ? art.text : rssText;
          let lines = summarize(text);
          if (!lines.length) lines = [htmlToText(item.contentSnippet || item.title || '')];

          await sendPost(buildMessage(item.title || '', lines, nextAd(state)), image);
          seen.add(link);
          state.totalPostedCount += 1;
          posted += 1;
          console.log(`[${source}] posted: ${item.title}`);
          await new Promise((r) => setTimeout(r, 1500));
        } catch (err) {
          console.error(`[${source}] item error: ${err.message}`);
        }
      }
      state.sources[source] = [...seen].slice(-HISTORY_LIMIT);
    } catch (err) {
      console.error(`[${source}] feed error: ${err.message}`);
    }
  }

  await saveState(state);
  console.log(`Done. Posted ${posted}. Next ad index: ${state.adIndex}`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
