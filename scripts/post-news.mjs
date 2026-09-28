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

// ---- Summary limits (full sentences only, never cut mid-sentence) ----
const MAX_SUMMARY_LINES = 15;   // hard limit on number of lines
const MAX_SUMMARY_CHARS = 480;  // ~15 wrapped lines on a phone screen
const MIN_SUMMARY_CHARS = 300;  // ~10 lines; below this we pull in extra text sources
const MIN_SENTENCES = 2;

// ---- Image quality rules ----
const MIN_IMAGE_WIDTH = 800;
const MIN_IMAGE_HEIGHT = 400;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// true  = skip the article (no post) if no good image is found
// false = post the news without an image
const REQUIRE_IMAGE = false;

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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': UA } });

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

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
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&#8220;|&ldquo;/g, '“')
    .replace(/&#8221;|&rdquo;/g, '”')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function htmlToText(html = '') {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Removes RSS leftovers: "[…]", "The post X appeared first on Y", etc.
function cleanText(t = '') {
  return t
    .replace(/The post .{0,300}? appeared first on .{0,100}?(\.|$)/gi, ' ')
    .replace(/\[(…|\.\.\.)\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BOILERPLATE =
  /subscribe|newsletter|cookie|follow us|read more|sign up|advertis|appeared first on|all rights reserved|disclaimer|not financial advice|getty images|image source|photo:|click here|download the app|join our|telegram channel|copyright|©/i;

// ------------------------------------------------------------------
// Image handling: find candidates, measure real size, reject bad ones
// ------------------------------------------------------------------

const BAD_IMAGE_URL =
  /(?<![a-z])(logo|favicon|sprite|avatar|icons?|placeholder|gravatar|default|pixel|blank|spacer)(?![a-z])|1x1|\.svg(\?|$)/i;

function rssImage(item) {
  const html = item['content:encoded'] || item.content || '';
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m) return decodeEntities(m[1]);
  if (item.enclosure?.url && /image/i.test(item.enclosure.type || 'image')) return item.enclosure.url;
  if (item['media:content']?.$?.url) return item['media:content'].$.url;
  return null;
}

function getImageSize(b) {
  try {
    // PNG
    if (b.length > 24 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') {
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    }
    // GIF
    if (b.toString('ascii', 0, 3) === 'GIF') {
      return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    }
    // JPEG
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        }
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
    // WebP
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const type = b.toString('ascii', 12, 16);
      if (type === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (type === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (type === 'VP8X') {
        return {
          w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
          h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
        };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function detectType(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null; // GIF and anything else is rejected
}

// Returns { url, buf, type } for a good image, otherwise null
async function isGoodImage(url) {
  if (!url || BAD_IMAGE_URL.test(url)) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'image/*' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    if (/^text\//i.test(res.headers.get('content-type') || '')) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > MAX_IMAGE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES || buf.length < 15000) return null; // too small = low quality
    const type = detectType(buf);
    if (!type) return null;
    const size = getImageSize(buf);
    if (!size) return null;
    const ratio = size.w / size.h;
    const ok =
      size.w >= MIN_IMAGE_WIDTH &&
      size.h >= MIN_IMAGE_HEIGHT &&
      ratio >= 0.7 &&
      ratio <= 3.2 &&
      size.w + size.h <= 10000; // Telegram photo limit
    return ok ? { url, buf, type } : null;
  } catch {
    return null;
  }
}

async function pickImage(candidates) {
  const seen = new Set();
  for (const c of candidates) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    const img = await isGoodImage(c);
    if (img) return img;
  }
  return null;
}

// ------------------------------------------------------------------
// Article fetching
// ------------------------------------------------------------------

async function fetchArticle(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (!res.ok) return { images: [], text: '', desc: '' };
    const html = await res.text();

    const abs = (u) => {
      try { return new URL(decodeEntities(u), url).toString(); } catch { return null; }
    };

    const images = [];
    const metaPatterns = [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ];
    for (const p of metaPatterns) {
      const m = html.match(p);
      if (m) images.push(abs(m[1]));
    }

    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<(nav|footer|aside|header|form)[\s\S]*?<\/\1>/gi, '');

    const getParas = (scopeHtml) =>
      [...scopeHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((x) => cleanText(htmlToText(x[1])))
        .filter((t) => t.length > 50 && /[.!?”"’')]$/.test(t) && !BOILERPLATE.test(t));
    const size = (paras) => paras.join(' ').length;

    // Check every <article> block and keep the one with the most real text
    // (the first <article> on a page is often just a teaser card)
    let best = { scope: cleaned, paras: [] };
    for (const m of cleaned.matchAll(/<article[\s\S]*?<\/article>/gi)) {
      const paras = getParas(m[0]);
      if (size(paras) > size(best.paras)) best = { scope: m[0], paras };
    }
    // No good <article>? Use every paragraph on the page
    if (size(best.paras) < 300) {
      const paras = getParas(cleaned);
      if (size(paras) > size(best.paras)) best = { scope: cleaned, paras };
    }

    // Extra image candidates from the article body
    for (const m of [...best.scope.matchAll(/<img[^>]+(?:data-src|data-lazy-src|src)=["']([^"']+)["']/gi)].slice(0, 8)) {
      images.push(abs(m[1]));
    }

    // JSON-LD "articleBody" (many sites include the full text there)
    let ld = '';
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      const mm = m[1].match(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (mm) {
        try { ld = cleanText(htmlToText(JSON.parse(`"${mm[1]}"`))); } catch { /* ignore */ }
      }
    }

    // Meta description as an extra source of one good sentence
    const dm =
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const desc = dm ? cleanText(decodeEntities(dm[1])) : '';

    const bodyText = best.paras.join(' ');
    const text = (ld.length > bodyText.length ? ld : bodyText).slice(0, 20000);
    return { images: images.filter(Boolean), text, desc };
  } catch {
    return { images: [], text: '', desc: '' };
  }
}

// ------------------------------------------------------------------
// Summary: extractive "key facts" selection, whole sentences only
// ------------------------------------------------------------------

const ABBR = ['U.S.', 'U.K.', 'U.N.', 'E.U.', 'Inc.', 'Ltd.', 'Corp.', 'Co.', 'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'vs.', 'St.', 'No.', 'Jr.', 'Sr.', 'a.m.', 'p.m.'];

function splitSentences(text) {
  let t = text.replace(/\s+/g, ' ');
  ABBR.forEach((a, i) => { t = t.split(a).join(a.replace(/\./g, `§${i}§`)); });
  const parts = t.split(/(?<=[.!?]["”’']?)\s+(?=["“‘(]?[A-Z0-9$€£#@])/);
  return parts
    .map((s) => s.replace(/§\d+§/g, '.').trim())
    .filter((s) => /[.!?]["”’']?$/.test(s)); // drop anything that ends mid-sentence
}

const STOP = new Set('the a an and or of to in on for with at by from as is are was were be been it its this that these those has have had will would can could may might after before over about into than then also more most not but'.split(' '));

function words(s) {
  return (s.toLowerCase().match(/[a-z0-9$%.]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
}

function summarize(text, title = '') {
  const sentences = [...new Set(splitSentences(cleanText(text)))]
    .filter((s) => s.length >= 40 && s.length <= 350 && !BOILERPLATE.test(s));
  if (!sentences.length) return [];

  const titleWords = new Set(words(title));
  const scored = sentences.map((s, idx) => {
    let score = 0;
    if (idx === 0) score += 6;
    else if (idx < 4) score += 3 - idx * 0.5;
    score += Math.min(4, (s.match(/\d[\d,.]*|\$|%/g) || []).length) * 1.2;      // numbers, amounts, %
    score += Math.min(4, (s.match(/(?<!^)\b[A-Z][a-zA-Z]{2,}/g) || []).length) * 0.6; // names / entities
    score += words(s).filter((w) => titleWords.has(w)).length * 1.5;              // relates to headline
    if (/\b(said|says|announced|launched|approved|filed|plans|reported|according to|will)\b/i.test(s)) score += 1.5;
    if (/^["“]/.test(s)) score -= 1; // pure quotes are less informative
    return { s, idx, score };
  });

  const chosen = [];
  let chars = 0;
  for (const item of [...scored].sort((a, b) => b.score - a.score)) {
    if (chosen.length >= MAX_SUMMARY_LINES) break;
    if (chars + item.s.length + 1 > MAX_SUMMARY_CHARS) {
      if (chosen.length >= MIN_SENTENCES) continue;
      if (chars > 0) continue;
    }
    chosen.push(item);
    chars += item.s.length + 1;
  }
  // Keep the article's natural order so it reads like a story
  return chosen.sort((a, b) => a.idx - b.idx).map((c) => c.s);
}

// Fallback when the article page could not be read: cut RSS snippet at a full sentence
function fallbackLines(item) {
  const raw = cleanText(htmlToText(item.contentSnippet || item.summary || item.content || ''));
  const sents = splitSentences(raw);
  const out = [];
  let chars = 0;
  for (const s of sents) {
    if (chars + s.length > MAX_SUMMARY_CHARS || out.length >= MAX_SUMMARY_LINES) break;
    out.push(s);
    chars += s.length + 1;
  }
  return out;
}

// ------------------------------------------------------------------
// Message + Telegram
// ------------------------------------------------------------------

function nextAd(state) {
  if (typeof state.adIndex !== 'number' || state.adIndex < 0) state.adIndex = 0;
  const ad = AD_TEMPLATES[state.adIndex % AD_TEMPLATES.length];
  state.adIndex = (state.adIndex + 1) % AD_TEMPLATES.length;
  return ad;
}

const TRADE_LINE = 'Before starting a trade, use the futures calculator.';
const CAPTION_LIMIT = 1000; // Telegram allows 1024 visible characters in a photo caption

// Layout (one message): [photo] / CRYPTO NEWS / bold headline / summary / Source /
// trade sentence / ad sentence as a clickable link
function buildMessage(title, lines, source, ad) {
  const build = (body) => ({
    html:
      `CRYPTO NEWS\n\n<b>${escapeHtml(title)}</b>\n\n` +
      `${body.map(escapeHtml).join('\n')}\n\n` +
      `Source: ${escapeHtml(source)}\n\n` +
      `${TRADE_LINE}\n<a href="${MINI_APP_URL}">${escapeHtml(ad)}</a>`,
    plain:
      `CRYPTO NEWS\n\n${title}\n\n${body.join('\n')}\n\nSource: ${source}\n\n${TRADE_LINE}\n${ad}`,
  });
  const body = [...lines];
  let m = build(body);
  // Drop the least important trailing sentence until the caption fits
  while (m.plain.length > CAPTION_LIMIT && body.length > 1) {
    body.pop();
    m = build(body);
  }
  return m.html;
}

async function tgJson(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function sendPost(text, image) {
  if (image) {
    // 1) Upload the downloaded image as a real Telegram photo (opens inside Telegram when tapped)
    try {
      const ext = image.type.includes('png') ? 'png' : image.type.includes('webp') ? 'webp' : 'jpg';
      const form = new FormData();
      form.append('chat_id', String(CHAT_ID));
      form.append('caption', text);
      form.append('parse_mode', 'HTML');
      form.append('photo', new Blob([image.buf], { type: image.type }), `news.${ext}`);
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (data.ok) return;
      console.error(`sendPhoto (upload) failed: ${data.description}`);
    } catch (e) {
      console.error(`sendPhoto (upload) error: ${e.message}`);
    }
    // 2) Let Telegram download the image from its URL
    const d2 = await tgJson('sendPhoto', {
      chat_id: CHAT_ID,
      photo: image.url,
      caption: text,
      parse_mode: 'HTML',
    });
    if (d2.ok) return;
    console.error(`sendPhoto (url) failed: ${d2.description}`);
  }
  // 3) Text only, no link preview frame
  const data = await tgJson('sendMessage', {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
  if (!data.ok) throw new Error(`Telegram API error: ${JSON.stringify(data)}`);
}

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------

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

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

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

          // 1) Best image: first candidate that is really >= 800px wide and not a logo
          const image = await pickImage([...art.images, rssImage(item)]);
          if (!image && REQUIRE_IMAGE) {
            console.log(`[${source}] skipped (no good image): ${item.title}`);
            seen.add(link);
            continue;
          }

          // 2) Summary: key facts, whole sentences, max 15 lines
          const rssText = cleanText(htmlToText(item['content:encoded'] || item.content || item.summary || ''));
          let text = art.text.length > rssText.length ? art.text : rssText;
          if (text.length < MIN_SUMMARY_CHARS * 2) {
            text = [art.text, art.desc, rssText].filter(Boolean).join(' ');
          }
          let lines = summarize(text, item.title || '');
          if (!lines.length) lines = fallbackLines(item);

          const title = cleanText(item.title || '');
          await sendPost(buildMessage(title, lines, source, nextAd(state)), image);
          seen.add(link);
          state.totalPostedCount += 1;
          posted += 1;
          console.log(`[${source}] posted: ${item.title} | image: ${image ? 'yes' : 'no'} | lines: ${lines.length}`);
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
