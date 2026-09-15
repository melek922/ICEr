# 🚀 ICE Register Bot - የተሟላ የቴሌግራም ቦት እና የክፍያ ስርዓት

ይህ ፕሮጀክት ለ **ICE Trading Psychology (35-Day Mastery Program)** የተዘጋጀ ዘመናዊ የቴሌግራም ቦት፣ የቴሌብር/ባንክ/ክሪፕቶ ክፍያ መቀበያ ዌብ አፕሊኬሽን (Telegram WebApp)፣ እና አውቶሜትድ የላይሰንስ ቁልፍ ማመንጫ እና ማሰራጫ ስርዓት ነው።

---

## 🌟 ዋና ዋና ገጽታዎች እና አሰራሮች (Core Features)

1. 📱 **Telegram WebApp (ስልጠናውን የመመዝገቢያ ፎርም)**፦
   - ተማሪው በቴሌግራም ቦቱ ውስጥ ሆነው በቀጥታ ጥቅል ይመርጣል (Standard ወይም VIP)።
   - የቴሌብር፣ የንግድ ባንክ (CBE) ወይም USDT (TRC20) የክፍያ መረጃዎችን ያገኛል።
   - የከፈለበትን ደረሰኝ ፎቶ (Receipt Screenshot) እና መረጃዎችን ሞልቶ ይልካል።

2. 👑 **የአድሚን ፈጣን ማጽደቂያ (Instant 1-Click Admin Approval)**፦
   - ተማሪው ደረሰኝ ሲልክ፣ ወዲያው ለአድሚኑ ቴሌግራም ላይ የደረሰኙ ፎቶ ከተማሪው መረጃ ጋር ይደርሳል።
   - አድሚኑ **[ ✅ አጽድቅ እና ላይሰንስ ላክ ]** የሚለውን ሲጫን፦
     - ሲስተሙ ራሱ አዲስ እና ልዩ የፍቃድ ቁልፍ (ለምሳሌ፡ `ITP-94821-KL783-92011`) ያመነጫል።
     - የተፈጠረውን ቁልፍ ከነ አጠቃቀሙ መመሪያ በቀጥታ ለተማሪው ቴሌግራም ላይ ይልክለታል።
     - ትዕዛዙን ወደ Google Sheets እና ዳታቤዝ ያዘምናል።

3. 🌐 **ከዌብሳይቱ (`ice-core.vercel.app`) ጋር ውህደት**፦
   - በዌብሳይቱ ላይ ማንም ሰው ማኑዋል ክፍያ ሲፈጽም፣ ዌብሳይቱ ጥሪ በማድረግ ለአድሚኖቹ ቴሌግራም ላይ የክፍያ ማሳወቂያ ይልካል።

4. 👥 **የሪፈራል እና የኮሚሽን ስርዓት (Referral & Payout System)**፦
   - እያንዳንዱ ተጠቃሚ የራሱ የሆነ ልዩ የሪፈራል ሊንክ አለው (`https://t.me/IceTradingBot?start=ref_xxxx`)።
   - ሰው ሲጋብዝ በሊንኩ ሲጀምር ማሳወቂያ ብቻ ይደርሰዋል (ምንም አይነት ኮሚሽን አስቀድሞ አይያዝለትም)።
   - **አድሚኑ ክፍያውን ሲያረጋግጥ እና ሲያጸድቅ ብቻ** ለጋባዡ የ **150 ETB ኮሚሽን** ወዲያው ገቢ ይደረግለታል፤ የቴሌግራም ደስታ መግለጫ መልዕክትም ይደርሰዋል።
   - ተጠቃሚው ከ 150 ብር ጀምሮ ያገኘውን ኮሚሽን በቴሌብር (Telebirr) ብር ማውጣት ይችላል።

5. 🔍 **የቀጥታ ደረሰኝ ማረጋገጫ (Live Transaction Verification)**፦
   - ለቴሌብር፦ የኢትዮ ቴሌኮም ኦፊሴላዊ ደረሰኝ ማረጋገጫ ሊንክ (`https://transactioninfo.ethiotelecom.et/receipt/<TxRef>`) በ 1-ክሊክ ይከፍታል።
   - ለ USDT፦ የ Tronscan Blockchain Explorer የቀጥታ ማረጋገጫ ሊንክ በ 1-ክሊክ ይከፍታል።

6. 📊 **Google Sheets 2-Way Data Sync (ዳታ እንዳይጠፋ ጥበቃ)**፦
   - አገልጋዩ (Server) ቢጠፋ ወይም ሪስታርት ቢሆን እንኳን፣ ከGoogle Sheets ጋር ተመሳስሎ ስለሚሰራ ምንም አይነት የተማሪ ወይም የክፍያ መረጃ አይጠፋទេ។

---

## 🛠️ አጀማመር እና አጠቃቀም (Quick Start)

### 1. ፓኬጆችን መጫን (Install Dependencies)
```bash
npm install
```

### 2. `.env` ፋይል ማዘጋጀት
በፎልደሩ ውስጥ `.env.example` ፋይልን ወደ `.env` በመቀየር የሚከተሉትን ይሙሉ፦
```env
BOT_TOKEN=8123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxx
BOT_USERNAME=IceTradingBot
ADMIN_IDS=123456789
WEB_URL=https://your-bot-domain.onrender.com
WEBSITE_URL=https://ice-core.vercel.app
TELEBIRR_NUMBER=0941550511
TELEBIRR_NAME=ICE Trading Academy
GOOGLE_SHEET_URL=https://script.google.com/macros/s/xxxx/exec
```

### 3. ሰርቨሩን ማስነሳት
```bash
npm start
```

---

## 🤖 የቦቱ ዋና ዋና ኮማንዶች (Bot Commands)

### 👤 ለተማሪዎች እና ተጠቃሚዎች፦
- `💎 Enroll / Verify Payment (WebApp)` - የክፍያ እና የምዝገባ ፎርሙን በቦቱ ውስጥ ይከፍታል።
- `👥 Referral Link / የእኔ ሪፈራል ሊንክ` - የግብዣ ሊንክ ማውጫ።
- `💰 My Balance / የእኔ ባላንስ` - የተገኘውን ኮሚሽን ማያ።
- `📥 Withdraw Commission / ብር ማውጫ` - የቴሌብር ብር ማውጫ ጥያቄ መላኪያ።
- `🔑 My License Key / የእኔ ላይሰንስ ኪ` - የነቃውን License Key ማያ።
- `📞 Support / ድጋፍ ሰጪ` - የአድሚን የቴሌግራም አድራሻ (@ic_ethiopia)።

### 👑 ለአድሚኖች ብቻ (Admin Commands)፦
- `/approve [order_id / user_id / email]` ወይም `/approved` — ትዕዛዙን ያጸድቃል፣ ላይሰንስ ኪ ያመነጫል፣ ለጋባዡ 150 ETB ኮሚሽን ገቢ ያደርጋል፣ ለተማሪውም የላይሰንስ ኮዱን እና የአጠቃቀም መመሪያውን በቴሌግራም ይልካል። *(ምንም መለያ ካልተጻፈ የመጨረሻውን በመጠባበቅ ላይ ያለውን ትዕዛዝ ራሱ ያጸድቃል)*
- `/reject [order_id / user_id]` — ትዕዛዙን ውድቅ ያደርጋል፤ ለተማሪውም ማስታወቂያ ይልካል።
- `/pending` ወይም `/orders` — ያልተረጋገጡ እና በመጠባበቅ ላይ ያሉ ሁሉንም ትዕዛዞች በዝርዝር ያሳያል።
- `/stats` — አጠቃላይ የተጠቃሚዎችን ብዛት፣ የገዙትን እና የጸደቁትን ትዕዛዞች ስታትስቲክስ ያሳያል።
- `/license <email>` — በእጅ አዲስ License Key አዘጋጅቶ ያወጣል።
- `/reply <user_id> <መልዕክት>` — ለተማሪው በቦቱ በኩል ቀጥታ መልዕክት ይልካል።
- `/broadcast <መልዕክት>` — ለሁሉም የቦቱ ተጠቃሚዎች በአንድ ጊዜ የቴሌግራም መልዕክት ይልካል።
- `/admin` ወይም `/help` — የአድሚን ትዕዛዞችን ዝርዝር መመሪያ ያሳያል።
