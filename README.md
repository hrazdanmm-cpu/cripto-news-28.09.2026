# Chat Crypto — Telegram News Bot

Ավտոմատ կերպով հետևում է 15 crypto-news կայքերի RSS feed-երին և նոր հոդվածները
հրապարակում է քո Telegram ալիքում GitHub Actions-ի միջոցով։ Ոչ մի սերվեր պետք չէ։

## Ինչպես գործարկել (3 քայլ)

### 1. Ստեղծիր Telegram bot և ստացիր chat id
1. Telegram-ում գրիր **@BotFather**-ին → `/newbot` → ստացիր **bot token**
   (տեսքը՝ `123456789:AAExampleTokenHere`)
2. Ավելացրու bot-ը քո ալիքին որպես **admin** (որպեսզի կարողանա post անել)
3. Ալիքի chat id-ն ստանալու համար՝
   - Public ալիք՝ օգտագործիր `@channelusername` որպես `CHAT_ID`
   - Private ալիք՝ ուղարկիր մի հաղորդագրություն ալիքում, հետո բացիր
     `https://api.telegram.org/bot<TOKEN>/getUpdates` և վերցրու `"chat":{"id": -100...}` արժեքը

### 2. Ստեղծիր GitHub repo և վերբեռնիր այս ֆայլերը
Պահպանիր ֆայլային կառուցվածքն այնպես, ինչպես կա (`scripts/`, `data/`, `.github/workflows/`)։

### 3. Ավելացրու secrets
Repo-ում՝ **Settings → Secrets and variables → Actions → New repository secret**
- `BOT_TOKEN` = bot token-ը BotFather-ից
- `CHAT_ID` = քո ալիքի id-ն կամ username-ը

Վե՛րջ։ Workflow-ն ամեն 20 րոպեն մեկ ինքնաշխատ կստուգի feed-երը և նորը կհրապարակի։
Կարող ես նաև ձեռքով գործարկել՝ **Actions** ցանկից → **Post crypto news to Telegram** → **Run workflow**։

## Ինչպես է աշխատում dedup-ը
`data/posted.json`-ը պահում է ամեն աղբյուրի վերջին հրապարակված link-ը։ Ամեն
աշխատարկման ժամանակ script-ը համեմատում է feed-ի ամենավերջին հոդվածը այդ
պահված link-ի հետ. եթե տարբեր է՝ նոր հոդված է, հրապարակվում է, և JSON-ը
թարմացվում ու commit-վում է repo-ում (workflow-ն ինքն է անում git commit/push)։

## Աղբյուր ավելացնել/հեռացնել
Խմբագրիր `scripts/post-news.mjs`-ի `FEEDS` օբյեկտը՝ ավելացնելով/հեռացնելով
`"Անուն": "RSS URL"` զույգեր։ Անունը պետք է համընկնի `data/posted.json`-ի
`links`-ի key-ի հետ (եթե նոր աղբյուր է, ավտոմատ կավելանա առաջին run-ից հետո)։

## Հաճախականության փոփոխում
`.github/workflows/post-news.yml`-ում փոխիր `cron: '*/20 * * * *'` տողը
(օրինակ՝ `*/5 * * * *` = ամեն 5 րոպեն մեկ)։ Ուշադրություն. GitHub Actions
cron-ը երբեմն մի քանի րոպե ուշանում է busy ժամերին. սա նորմալ է։
