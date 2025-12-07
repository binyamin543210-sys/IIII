// BNAPP Calendar – לוגיקה מלאה
// לוח שנה עברי–לועזי עם שבת, חגים, מזג אוויר, משימות, Waze וסנכרון Firebase

// אובייקט מרכזי
const BNAPP = {
  today: new Date(),
  viewYear: null,
  viewMonth: null,
  city: {
    name: "יבנה, ישראל",
    lat: 31.8928,
    lon: 34.8113,
    tzid: "Asia/Jerusalem"
  },
  bgIndex: 1,
  events: {},        // נתונים מה-Firebase
  holidays: {},      // חגים מ-Hebcal
  shabbat: {},       // כניסת/יציאת שבת מ-Hebcal
  weatherCache: {},  // cache ליום–יומיים כדי לא להציף API
  hebrewFormatter: new Intl.DateTimeFormat("he-IL-u-ca-hebrew", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }),
  hebrewDayFormatter: new Intl.DateTimeFormat("he-IL-u-ca-hebrew", {
    day: "numeric"
  }),
  gregWeekday: new Intl.DateTimeFormat("he-IL", { weekday: "long" }),
  gregDate: new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric"
  })
};

// Firebase (גרסת compat מה-scripts ב-HTML)
let db = null;
if (window.firebase) {
  try {
    db = firebase.database();
  } catch (e) {
    console.warn("Firebase database init failed:", e);
  }
}

// ------------------ פונקציות תאריך בסיסיות ------------------

function makeDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, delta) {
  const nd = new Date(d.getTime());
  nd.setDate(nd.getDate() + delta);
  return nd;
}

// ------------------ מספרים עבריים (יום בחודש) ------------------

const hebrewDigits = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];

function toHebrewNumber(num) {
  // טיפול מיוחד בט״ו / ט״ז
  if (num === 15) return "ט״ו";
  if (num === 16) return "ט״ז";

  let result = "";
  const tens = Math.floor(num / 10);
  const ones = num % 10;

  if (tens > 0) {
    const tensMap = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
    result += tensMap[tens] || "";
  }
  if (ones > 0) {
    result += hebrewDigits[ones];
  }

  if (result.length > 1) {
    // מוסיף גרשיים לפני האות האחרונה
    return result.slice(0, -1) + "״" + result.slice(-1);
  }
  return result || String(num);
}

function getHebrewDayNumber(d) {
  try {
    const parts = BNAPP.hebrewDayFormatter.formatToParts(d);
    const dayPart = parts.find(p => p.type === "day");
    const value = dayPart ? parseInt(dayPart.value, 10) : d.getDate();
    return toHebrewNumber(value);
  } catch {
    return toHebrewNumber(d.getDate());
  }
}

function getHebrewMonthLabel(d) {
  try {
    const parts = BNAPP.hebrewFormatter.formatToParts(d);
    const monthPart = parts.find(p => p.type === "month");
    const yearPart = parts.find(p => p.type === "year");
    if (!monthPart || !yearPart) return "";
    return monthPart.value + " " + yearPart.value;
  } catch {
    return "";
  }
}

// ------------------ שמירת עיר ורקע ב-localStorage ------------------

function loadCityFromStorage() {
  try {
    const raw = localStorage.getItem("bnapp.city");
    if (!raw) return;
    const c = JSON.parse(raw);
    if (c && typeof c.lat === "number" && typeof c.lon === "number") {
      BNAPP.city = c;
    }
  } catch (e) {
    console.warn("cannot load city", e);
  }
}

function saveCityToStorage() {
  try {
    localStorage.setItem("bnapp.city", JSON.stringify(BNAPP.city));
  } catch (e) {
    console.warn("cannot save city", e);
  }
}

function applyBackground() {
  const body = document.body;
  for (let i = 1; i <= 10; i++) {
    body.classList.remove("bg" + i);
  }
  body.classList.add("bg" + BNAPP.bgIndex);
}

function loadBackgroundFromStorage() {
  try {
    const raw = localStorage.getItem("bnapp.bgIndex");
    if (raw) {
      const v = parseInt(raw, 10);
      if (!Number.isNaN(v) && v >= 1 && v <= 10) {
        BNAPP.bgIndex = v;
      }
    }
  } catch (e) {
    console.warn("cannot load bg index", e);
  }
  applyBackground();
}

function saveBackgroundToStorage() {
  try {
    localStorage.setItem("bnapp.bgIndex", String(BNAPP.bgIndex));
  } catch (e) {
    console.warn("cannot save bg index", e);
  }
}

// ------------------ חגים מ-Hebcal ------------------

function normalizeHolidayTitle(item) {
  return item.title || "";
}

async function fetchHolidaysForMonth(year, month) {
  const m = month + 1;
  const url =
    "https://www.hebcal.com/hebcal?cfg=json&v=1" +
    `&year=${year}&month=${m}` +
    "&maj=on&min=on&mod=on&nx=on&mf=on&ss=on&c=on" +
    `&geo=pos&latitude=${BNAPP.city.lat}&longitude=${BNAPP.city.lon}` +
    `&tzid=${encodeURIComponent(BNAPP.city.tzid)}` +
    "&lg=he";

  try {
    const res = await fetch(url);
    const data = await res.json();
    const map = {};
    (data.items || []).forEach(item => {
      if (!item.date || !item.title) return;
      const key = item.date.slice(0, 10);
      const t = normalizeHolidayTitle(item);
      if (!t) return;
      if (!map[key]) map[key] = [];
      map[key].push({
        title: t,
        category: item.category || item.className || ""
      });
    });
    return map;
  } catch (e) {
    console.warn("holiday fetch error", e);
    return {};
  }
}

// ------------------ זמני שבת מ-Hebcal ------------------

function extractTimeFromTitle(title) {
  if (!title) return "";
  const m = title.match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : title;
}

async function fetchShabbatForRange(startDate, endDate) {
  const startStr = makeDateKey(startDate);
  const endStr = makeDateKey(endDate);
  const url =
    "https://www.hebcal.com/shabbat?cfg=json" +
    `&start=${startStr}&end=${endStr}` +
    `&geo=pos&latitude=${BNAPP.city.lat}&longitude=${BNAPP.city.lon}` +
    `&tzid=${encodeURIComponent(BNAPP.city.tzid)}` +
    "&m=50&lg=he";

  try {
    const res = await fetch(url);
    const data = await res.json();
    const out = {};
    (data.items || []).forEach(item => {
      if (!item.category || !item.date) return;
      const key = item.date.slice(0, 10);
      if (!out[key]) out[key] = {};
      if (item.category === "candles") {
        out[key].candle = {
          time: extractTimeFromTitle(item.title),
          raw: item.title
        };
      } else if (item.category === "havdalah") {
        out[key].havdala = {
          time: extractTimeFromTitle(item.title),
          raw: item.title
        };
      }
    });
    return out;
  } catch (e) {
    console.warn("shabbat fetch error", e);
    return {};
  }
}

// ------------------ מזג אוויר מ-Open-Meteo ------------------

async function fetchWeatherForDay(dateKey) {
  if (BNAPP.weatherCache[dateKey]) return BNAPP.weatherCache[dateKey];
  const d = parseDateKey(dateKey);
  const start = makeDateKey(d);
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${BNAPP.city.lat}&longitude=${BNAPP.city.lon}` +
    "&hourly=temperature_2m,precipitation_probability" +
    "&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&current_weather=true&timezone=auto" +
    `&start_date=${start}&end_date=${start}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const current = data.current_weather || {};
    const hasDaily = data.daily && data.daily.time && data.daily.time.length;
    const daily = hasDaily
      ? {
          max: data.daily.temperature_2m_max[0],
          min: data.daily.temperature_2m_min[0],
          code: data.daily.weathercode[0],
          pop: data.daily.precipitation_probability_max[0]
        }
      : null;
    const pack = { current, daily };
    BNAPP.weatherCache[dateKey] = pack;
    return pack;
  } catch (e) {
    console.warn("weather error", e);
    return null;
  }
}

function weatherEmojiFromCode(code) {
  if (code === undefined || code === null) return "ℹ️";
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫";
  if (code <= 55) return "🌦";
  if (code <= 65) return "🌧";
  if (code <= 82) return "🌧";
  if (code <= 86) return "🌨";
  return "⛈";
}

// ------------------ אירועים אוטומטיים (עבודה + אוכל) ------------------

function generateAutoBlocksForDate(dateKey) {
  const d = parseDateKey(dateKey);
  const weekday = d.getDay(); // 0=ראשון
  // ראשון–חמישי בלבד
  if (weekday < 0 || weekday > 4) return [];
  return [
    {
      id: "__auto_work",
      title: "עבודה",
      kind: "auto",
      type: "event",
      owner: "both",
      start: "08:00",
      end: "17:00"
    },
    {
      id: "__auto_food",
      title: "אוכל ומקלחת",
      kind: "auto",
      type: "event",
      owner: "both",
      start: "17:00",
      end: "18:30"
    }
  ];
}

// ------------------ Firebase – סנכרון ------------------

function subscribeEvents() {
  if (!db) return;
  db.ref("events").on("value", snap => {
    BNAPP.events = snap.val() || {};
    renderCalendar();
  });
}

function saveEvent(dateKey, evObj) {
  if (!db) return;
  const ref = db.ref("events").child(dateKey);
  if (!evObj.id) evObj.id = ref.push().key;
  ref.child(evObj.id).set(evObj);
}

function getUserEventsForDay(dateKey) {
  const dayMap = BNAPP.events[dateKey] || {};
  return Object.values(dayMap);
}

// ------------------ זמן חופשי ------------------

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(m) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function calcFreeTime(dateKey) {
  const blocks = [];
  const startDay = 7 * 60;
  const endDay = 23 * 60;

  generateAutoBlocksForDate(dateKey).forEach(b => {
    blocks.push([timeToMinutes(b.start), timeToMinutes(b.end)]);
  });

  getUserEventsForDay(dateKey).forEach(ev => {
    if (!ev.start) return;
    const s = timeToMinutes(ev.start);
    const e = ev.end ? timeToMinutes(ev.end) : s + 30;
    blocks.push([s, e]);
  });

  if (!blocks.length) {
    return [{ start: minutesToTime(startDay), end: minutesToTime(endDay) }];
  }

  blocks.sort((a, b) => a[0] - b[0]);
  const merged = [blocks[0].slice()];
  for (let i = 1; i < blocks.length; i++) {
    const last = merged[merged.length - 1];
    if (blocks[i][0] <= last[1]) {
      last[1] = Math.max(last[1], blocks[i][1]);
    } else {
      merged.push(blocks[i].slice());
    }
  }

  const free = [];
  let cur = startDay;
  merged.forEach(([bs, be]) => {
    if (bs > cur) free.push({ start: minutesToTime(cur), end: minutesToTime(bs) });
    cur = Math.max(cur, be);
  });
  if (cur < endDay) free.push({ start: minutesToTime(cur), end: minutesToTime(endDay) });
  return free;
}

// ------------------ טקסטים קטנים / אימוג'ים ------------------

function firstWord(text) {
  if (!text) return "";
  const parts = text.trim().split(/\s+/);
  return parts[0] || "";
}

function classifyEmoji(word) {
  if (!word) return "";
  const w = word;
  if (/רופא|מרפאה|בדיקה/.test(w)) return "🏥";
  if (/קניות|סופר|קניון/.test(w)) return "🛒";
  if (/טיסה|שדה|נתב"ג/.test(w)) return "✈️";
  if (/מסעדה|אוכל/.test(w)) return "🍽";
  if (/אימון|כושר|חדר/.test(w)) return "💪";
  if (/פגישה|ישיבה|כנס/.test(w)) return "📌";
  return "";
}

function holidayEmoji(title) {
  if (!title) return "";
  if (/חנוכה/.test(title)) return "🕎";
  if (/פסח/.test(title)) return "🍞";
  if (/סוכות/.test(title)) return "⛺";
  if (/שבועות/.test(title)) return "📜";
  if (/ראש השנה/.test(title)) return "📯";
  if (/יום הכיפורים/.test(title)) return "🤍";
  if (/פורים/.test(title)) return "🎭";
  if (/תשעה באב/.test(title)) return "🕯";
  if (/ט\"ו בשבט|ט״ו בשבט/.test(title)) return "🌳";
  if (/ראש חודש/.test(title)) return "🌙";
  return "✨";
}

// ------------------ בניית מטריצת חודש ------------------

async function loadMonthData(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  BNAPP.holidays = await fetchHolidaysForMonth(year, month);
  BNAPP.shabbat = await fetchShabbatForRange(addDays(first, -7), addDays(last, 7));
}

function buildMonthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const firstDayOfWeek = first.getDay(); // 0=ראשון
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const cells = [];

  // ימים מהחודש הקודם
  for (let i = 0; i < firstDayOfWeek; i++) {
    const day = prevMonthDays - firstDayOfWeek + 1 + i;
    cells.push({ date: new Date(year, month - 1, day), inMonth: false });
  }

  // ימים מהחודש הנוכחי
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }

  // השלמה לחלקי שבוע
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: addDays(last, 1), inMonth: false });
  }

  return cells;
}

// ------------------ רינדור הלוח החודשי ------------------

async function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  if (!grid) return;

  const year = BNAPP.viewYear;
  const month = BNAPP.viewMonth;
  if (year == null || month == null) return;

  await loadMonthData(year, month);

  const d0 = new Date(year, month, 1);
  document.getElementById("gregorianHeader").textContent =
    new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(d0);
  document.getElementById("hebrewHeader").textContent = getHebrewMonthLabel(d0);
  document.getElementById("locationLabel").textContent = BNAPP.city.name;
  document.getElementById("todayLabel").textContent =
    "היום: " + BNAPP.gregDate.format(BNAPP.today);

  const todayKey = makeDateKey(BNAPP.today);
  const cells = buildMonthMatrix(year, month);
  grid.innerHTML = "";

  cells.forEach(cell => {
    const d = cell.date;
    const key = makeDateKey(d);
    const weekday = d.getDay(); // 0=א', 6=שבת

    const div = document.createElement("div");
    div.className = "day-cell";
    if (!cell.inMonth) div.classList.add("other-month");
    if (key === todayKey) {
      const pill = document.createElement("div");
      pill.className = "today-pill";
      pill.textContent = "היום";
      div.appendChild(pill);
    }

    const header = document.createElement("div");
    header.className = "day-top";

    const left = document.createElement("div");
    left.className = "day-num-block";
    const num = document.createElement("div");
    num.className = "day-num";
    num.textContent = d.getDate();
    const heb = document.createElement("div");
    heb.className = "day-hebrew-num";
    heb.textContent = getHebrewDayNumber(d);
    left.appendChild(num);
    left.appendChild(heb);

    const tags = document.createElement("div");
    tags.className = "day-tags";

    header.appendChild(left);
    header.appendChild(tags);
    div.appendChild(header);

    const content = document.createElement("div");
    content.className = "day-content";

    // 1) שורת חג (אם יש)
    if (BNAPP.holidays[key] && BNAPP.holidays[key].length) {
      const mainHoliday = BNAPP.holidays[key][0].title;
      const row = document.createElement("div");
      row.className = "day-event-row";
      const em = document.createElement("span");
      em.className = "row-emoji";
      em.textContent = holidayEmoji(mainHoliday);
      const txt = document.createElement("span");
      txt.className = "label-text";
      txt.textContent = mainHoliday;
      row.appendChild(em);
      row.appendChild(txt);
      content.appendChild(row);
    }

    const shab = BNAPP.shabbat[key] || {};

    // 2) כניסת/יציאת שבת קצרה
    if (weekday === 5 && shab.candle && shab.candle.time) {
      const row = document.createElement("div");
      row.className = "day-event-row";
      const em = document.createElement("span");
      em.className = "row-emoji";
      em.textContent = "🕯";
      const txt = document.createElement("span");
      txt.className = "label-text";
      txt.textContent = shab.candle.time;
      row.appendChild(em);
      row.appendChild(txt);
      content.appendChild(row);
    }
    if (weekday === 6 && shab.havdala && shab.havdala.time) {
      const row = document.createElement("div");
      row.className = "day-event-row";
      const em = document.createElement("span");
      em.className = "row-emoji";
      em.textContent = "✨";
      const txt = document.createElement("span");
      txt.className = "label-text";
      txt.textContent = shab.havdala.time;
      row.appendChild(em);
      row.appendChild(txt);
      content.appendChild(row);
    }

    // 3) אירוע/משימה – מילה ראשונה + נקודה בצבע
    const userEvents = getUserEventsForDay(key);
    const primaryEvents = userEvents.slice(0, 1);

    primaryEvents.forEach(ev => {
      const row = document.createElement("div");
      row.className = "day-event-row";

      const dot = document.createElement("span");
      dot.className = "dot";
      if (ev.owner === "benjamin") dot.classList.add("dot-benjamin");
      else if (ev.owner === "nana") dot.classList.add("dot-nana");
      else dot.classList.add("dot-both");

      const fw = firstWord(ev.title || "");
      const em = document.createElement("span");
      em.className = "row-emoji";
      em.textContent = classifyEmoji(fw);

      const txt = document.createElement("span");
      txt.className = "label-text";
      txt.textContent = fw;

      row.appendChild(dot);
      if (em.textContent) row.appendChild(em);
      row.appendChild(txt);
      content.appendChild(row);
    });

    if (userEvents.length > 1) {
      const more = document.createElement("div");
      more.className = "day-event-row event-more";
      more.textContent = `+${userEvents.length - 1} נוספים`;
      content.appendChild(more);
      div.classList.add("glow");
    }

    div.appendChild(content);
    div.addEventListener("click", () => openDayModal(key));
    grid.appendChild(div);
  });
}

// ------------------ חלון יום ------------------

async function openDayModal(dateKey) {
  const modal = document.getElementById("dayModal");
  if (!modal) return;

  const d = parseDateKey(dateKey);
  document.getElementById("dayModalHebrew").textContent =
    BNAPP.gregWeekday.format(d) + " • " + getHebrewDayNumber(d);
  document.getElementById("dayModalGreg").textContent = BNAPP.gregDate.format(d);

  const holidayBox = document.getElementById("dayModalHoliday");
  if (BNAPP.holidays[dateKey] && BNAPP.holidays[dateKey].length) {
    holidayBox.textContent = BNAPP.holidays[dateKey]
      .map(h => h.title)
      .join(" • ");
  } else {
    holidayBox.textContent = "";
  }

  // שורות שבת
  const shabInfo = document.getElementById("dayShabbatInfo");
  const shab = BNAPP.shabbat[dateKey] || {};
  const weekday = d.getDay();
  if (weekday === 5 && shab.candle && shab.candle.time) {
    shabInfo.textContent = "🕯 כניסת שבת: " + (shab.candle.raw || shab.candle.time);
  } else if (weekday === 6 && shab.havdala && shab.havdala.time) {
    shabInfo.textContent = "✨ יציאת שבת: " + (shab.havdala.raw || shab.havdala.time);
  } else {
    shabInfo.textContent = "";
  }

  // שעות בצד (בדסקטופ)
  const hoursCol = document.getElementById("hoursColumn");
  if (hoursCol) {
    hoursCol.innerHTML = "";
    for (let h = 7; h <= 23; h++) {
      const div = document.createElement("div");
      div.className = "hour-slot";
      div.textContent = `${String(h).padStart(2, "0")}:00`;
      hoursCol.appendChild(div);
    }
  }

  const list = document.getElementById("dayEventsList");
  list.innerHTML = "";

  const userEvents = getUserEventsForDay(dateKey)
    .slice()
    .sort((a, b) => (a.start || "") < (b.start || "") ? -1 : 1);
  const autoBlocks = generateAutoBlocksForDate(dateKey);

  function addEventRow(ev, isAuto = false) {
    const row = document.createElement("div");
    row.className = "event-pill";
    if (isAuto) row.classList.add("auto");
    else {
      if (ev.owner === "benjamin") row.classList.add("benjamin");
      else if (ev.owner === "nana") row.classList.add("nana");
      else row.classList.add("both");
    }

    const title = document.createElement("div");
    title.className = "event-pill-title";
    title.textContent = ev.title;

    const meta = document.createElement("div");
    meta.className = "event-pill-meta";
    const who =
      ev.owner === "benjamin" ? "בנימין" :
      ev.owner === "nana" ? "ננה" : "משותף";
    const kind = ev.kind === "task" ? "משימה" : "אירוע";
    meta.textContent =
      `${ev.start || ""}${ev.end ? "–" + ev.end : ""} • ${kind} • ${who}`;

    row.appendChild(title);
    row.appendChild(meta);

    if (ev.address) {
      const addr = document.createElement("div");
      addr.className = "event-pill-meta";
      addr.textContent = ev.address;
      row.appendChild(addr);

      const btn = document.createElement("button");
      btn.className = "btn tiny primary-soft";
      btn.textContent = "פתח ב-Waze";
      btn.addEventListener("click", e => {
        e.stopPropagation();
        window.open("https://waze.com/ul?q=" + encodeURIComponent(ev.address), "_blank");
      });
      row.appendChild(btn);
    }

    list.appendChild(row);
  }

  // אוטומטיים + ידניים
  autoBlocks.forEach(b => addEventRow(b, true));
  userEvents.forEach(ev => addEventRow(ev, false));

  // מזג אוויר בראש
  const weatherInline = document.getElementById("dayWeatherInline");
  if (weatherInline) {
    weatherInline.textContent = "טוען מזג אוויר...";
    fetchWeatherForDay(dateKey).then(w => {
      if (!w || !w.current) {
        weatherInline.textContent = "";
        return;
      }
      const emoji = weatherEmojiFromCode(w.daily && w.daily.code);
      const temp = Math.round(
        w.current.temperature || (w.daily && w.daily.max) || 0
      );
      const max = Math.round((w.daily && w.daily.max) || w.current.temperature || 0);
      const min = Math.round((w.daily && w.daily.min) || w.current.temperature || 0);
      weatherInline.textContent =
        `${emoji} ${temp}°C  •  מקס' ${max}° / מינ' ${min}°`;
    });
  }

  const addBtn = document.getElementById("addEventFromDayBtn");
  if (addBtn) {
    addBtn.onclick = () => openEventModal(dateKey);
  }

  modal.classList.remove("hidden");
}

// ------------------ חלון אירוע חדש ------------------

function openEventModal(dateKey) {
  const modal = document.getElementById("eventModal");
  if (!modal) return;

  const form = document.getElementById("eventForm");

  document.getElementById("eventModalTitle").textContent = "אירוע חדש";
  document.getElementById("eventTitle").value = "";
  document.getElementById("eventDate").value = dateKey || makeDateKey(BNAPP.today);
  document.getElementById("eventStart").value = "10:00";
  document.getElementById("eventEnd").value = "";
  document.getElementById("eventAddress").value = "";
  document.getElementById("eventKind").value = "event";
  document.getElementById("eventOwner").value = "both";
  document.getElementById("eventNotify").checked = true;
  document.getElementById("eventNotifyMinutes").value = "60";

  form.onsubmit = e => {
    e.preventDefault();
    const ev = {
      title: document.getElementById("eventTitle").value.trim(),
      date: document.getElementById("eventDate").value,
      start: document.getElementById("eventStart").value,
      end: document.getElementById("eventEnd").value,
      address: document.getElementById("eventAddress").value.trim(),
      kind:
        document.getElementById("eventKind").value === "task"
          ? "task"
          : "event",
      type: "event",
      owner: document.getElementById("eventOwner").value,
      notify: document.getElementById("eventNotify").checked,
      notifyMinutes:
        parseInt(
          document.getElementById("eventNotifyMinutes").value,
          10
        ) || 60
    };

    if (!ev.title || !ev.date || !ev.start) return;
    saveEvent(ev.date, ev);
    modal.classList.add("hidden");
  };

  modal.classList.remove("hidden");
}

// ------------------ זמן חופשי ------------------

function openFreeTimeModal() {
  const modal = document.getElementById("freeTimeModal");
  if (!modal) return;
  const content = document.getElementById("freeTimeContent");
  const key = makeDateKey(BNAPP.today);
  const free = calcFreeTime(key);

  if (!free.length) {
    content.textContent = "אין זמן חופשי היום 😅";
  } else {
    content.innerHTML = free
      .map(r => `• ${r.start}–${r.end}`)
      .join("<br>");
  }

  modal.classList.remove("hidden");
}

// ------------------ משימות לחודש ------------------

function openTasksModal() {
  const modal = document.getElementById("tasksModal");
  if (!modal) return;
  const content = document.getElementById("tasksContent");
  const todayKey = makeDateKey(BNAPP.today);
  const today = parseDateKey(todayKey);
  const limit = addDays(today, 31);
  const tasks = [];

  Object.keys(BNAPP.events || {}).forEach(dateKey => {
    const d = parseDateKey(dateKey);
    if (d < today || d > limit) return;
    const dayEvents = Object.values(BNAPP.events[dateKey] || {});
    dayEvents.forEach(ev => {
      if (ev.kind === "task") tasks.push({ dateKey, d, ev });
    });
  });

  tasks.sort((a, b) => a.d - b.d);

  if (!tasks.length) {
    content.textContent = "אין משימות לחודש הקרוב.";
  } else {
    content.innerHTML = "";
    tasks.forEach(item => {
      const div = document.createElement("div");
      div.className = "task-item";
      div.textContent = `${item.dateKey} • ${item.ev.title}`;
      div.addEventListener("click", () => {
        modal.classList.add("hidden");
        openDayModal(item.dateKey);
      });
      content.appendChild(div);
    });
  }

  modal.classList.remove("hidden");
}

// ------------------ חלון מזג אוויר ------------------

async function openWeatherModal() {
  const modal = document.getElementById("weatherModal");
  if (!modal) return;

  const content = document.getElementById("weatherContent");
  const key = makeDateKey(BNAPP.today);
  content.textContent = "טוען...";

  const pack = await fetchWeatherForDay(key);
  if (!pack || !pack.current) {
    content.textContent = "לא הצלחתי לטעון מזג אוויר.";
    modal.classList.remove("hidden");
    return;
  }

  const cur = pack.current;
  const daily = pack.daily || {};
  const emoji = weatherEmojiFromCode(daily.code);

  content.innerHTML = "";

  const hero = document.createElement("div");
  hero.className = "weather-hero";

  const heroMain = document.createElement("div");
  heroMain.className = "weather-hero-main";

  const t = document.createElement("div");
  t.className = "weather-hero-temp";
  t.textContent = `${Math.round(cur.temperature)}°C`;

  const desc = document.createElement("div");
  desc.className = "weather-hero-desc";
  desc.textContent = `היום ב${BNAPP.city.name}`;

  const sub = document.createElement("div");
  sub.className = "weather-subline";
  sub.textContent =
    `מקסימום ${Math.round(daily.max || cur.temperature)}° / ` +
    `מינימום ${Math.round(daily.min || cur.temperature)}° • ` +
    `סיכוי גשם ${daily.pop || 0}%`;

  heroMain.appendChild(t);
  heroMain.appendChild(desc);
  heroMain.appendChild(sub);

  const icon = document.createElement("div");
  icon.className = "weather-hero-icon";
  icon.textContent = emoji;

  hero.appendChild(heroMain);
  hero.appendChild(icon);

  content.appendChild(hero);

  const note = document.createElement("div");
  note.className = "weather-subline";
  note.textContent = "הנתונים מסופקים ע\"י Open-Meteo – הערכה בלבד.";
  content.appendChild(note);

  modal.classList.remove("hidden");
}

// ------------------ בחירת עיר ------------------

async function searchCity(query) {
  const status = document.getElementById("citySearchStatus");
  const resultsDiv = document.getElementById("cityResults");
  status.textContent = "מחפש...";
  resultsDiv.innerHTML = "";

  if (!query || query.length < 2) {
    status.textContent = "תכתוב לפחות 2 אותיות.";
    return;
  }

  try {
    const url =
      "https://geocoding-api.open-meteo.com/v1/search" +
      `?name=${encodeURIComponent(query)}` +
      "&count=8&language=he&format=json";
    const res = await fetch(url);
    const data = await res.json();
    const results = data.results || [];
    if (!results.length) {
      status.textContent = "לא נמצאו ערים.";
      return;
    }
    status.textContent = "";
    resultsDiv.innerHTML = "";
    results.forEach(r => {
      const div = document.createElement("div");
      div.className = "city-item";
      const label = [r.name, r.admin1, r.country].filter(Boolean).join(", ");
      div.textContent = label;
      div.addEventListener("click", () => {
        BNAPP.city = {
          name: label,
          lat: r.latitude,
          lon: r.longitude,
          tzid: r.timezone || "UTC"
        };
        saveCityToStorage();
        document.getElementById("cityModal").classList.add("hidden");
        BNAPP.weatherCache = {};
        renderCalendar();
      });
      resultsDiv.appendChild(div);
    });
  } catch (e) {
    console.warn("city search error", e);
    status.textContent = "שגיאה בחיפוש עיר.";
  }
}

function openCityModal() {
  const modal = document.getElementById("cityModal");
  if (!modal) return;
  document.getElementById("citySearchInput").value = "";
  document.getElementById("citySearchStatus").textContent = "";
  document.getElementById("cityResults").innerHTML = "";
  modal.classList.remove("hidden");
}

// ------------------ חיפוש אירועים ------------------

function openSearchModal() {
  const modal = document.getElementById("searchModal");
  if (!modal) return;
  document.getElementById("searchQuery").value = "";
  document.getElementById("searchStatus").textContent = "";
  document.getElementById("searchResults").innerHTML = "";
  modal.classList.remove("hidden");
}

function runSearch() {
  const q = document.getElementById("searchQuery").value.trim();
  const status = document.getElementById("searchStatus");
  const resultsDiv = document.getElementById("searchResults");
  resultsDiv.innerHTML = "";
  if (!q) {
    status.textContent = "תכתוב משהו לחיפוש.";
    return;
  }
  status.textContent = "מחפש...";

  const out = [];
  Object.entries(BNAPP.events || {}).forEach(([dateKey, dayMap]) => {
    Object.values(dayMap || {}).forEach(ev => {
      if (ev.title && ev.title.includes(q)) out.push({ dateKey, ev });
    });
  });

  if (!out.length) {
    status.textContent = "לא נמצאו תוצאות.";
    return;
  }

  status.textContent = `${out.length} תוצאות נמצאו`;
  out.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  out.forEach(item => {
    const div = document.createElement("div");
    div.className = "search-item";
    div.textContent = `${item.dateKey} • ${item.ev.title}`;
    div.addEventListener("click", () => {
      document.getElementById("searchModal").classList.add("hidden");
      openDayModal(item.dateKey);
    });
    resultsDiv.appendChild(div);
  });
}

// ------------------ Theme, Modals, Nav, כפתורים ------------------

function initThemeToggle() {
  const toggle = document.getElementById("themeToggle");
  if (!toggle) return;
  // ברירת מחדל – מצב יום (בהיר)
  document.body.classList.add("light");
  toggle.checked = false;
  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      document.body.classList.remove("light");
    } else {
      document.body.classList.add("light");
    }
  });
}

function initModalClose() {
  document.querySelectorAll(".close-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const parent = btn.closest(".modal");
      if (parent) parent.classList.add("hidden");
    });
  });
  document.querySelectorAll(".modal").forEach(m => {
    m.addEventListener("click", e => {
      if (e.target === m) m.classList.add("hidden");
    });
  });
}

function initMonthNav() {
  document.getElementById("prevMonthBtn").addEventListener("click", () => {
    const d = new Date(BNAPP.viewYear, BNAPP.viewMonth, 1);
    d.setMonth(d.getMonth() - 1);
    BNAPP.viewYear = d.getFullYear();
    BNAPP.viewMonth = d.getMonth();
    renderCalendar();
  });
  document.getElementById("nextMonthBtn").addEventListener("click", () => {
    const d = new Date(BNAPP.viewYear, BNAPP.viewMonth, 1);
    d.setMonth(d.getMonth() + 1);
    BNAPP.viewYear = d.getFullYear();
    BNAPP.viewMonth = d.getMonth();
    renderCalendar();
  });
  document.getElementById("todayBtn").addEventListener("click", () => {
    const t = BNAPP.today;
    BNAPP.viewYear = t.getFullYear();
    BNAPP.viewMonth = t.getMonth();
    renderCalendar();
  });
}

function initButtons() {
  const freeBtn = document.getElementById("freeTimeBtn");
  if (freeBtn) freeBtn.addEventListener("click", openFreeTimeModal);

  const tasksBtn = document.getElementById("tasksBtn");
  if (tasksBtn) tasksBtn.addEventListener("click", openTasksModal);

  const weatherBtn = document.getElementById("weatherBtn");
  if (weatherBtn) weatherBtn.addEventListener("click", openWeatherModal);

  const cityBtn = document.getElementById("cityBtn");
  if (cityBtn) cityBtn.addEventListener("click", openCityModal);

  const searchBtn = document.getElementById("searchBtn");
  if (searchBtn) searchBtn.addEventListener("click", openSearchModal);

  const citySearchBtn = document.getElementById("citySearchBtn");
  if (citySearchBtn) {
    citySearchBtn.addEventListener("click", () => {
      const q = document.getElementById("citySearchInput").value.trim();
      searchCity(q);
    });
  }

  const searchRunBtn = document.getElementById("searchRunBtn");
  if (searchRunBtn) searchRunBtn.addEventListener("click", runSearch);

  const bgBtn = document.getElementById("bgBtn");
  if (bgBtn) {
    bgBtn.addEventListener("click", () => {
      BNAPP.bgIndex = (BNAPP.bgIndex % 10) + 1;
      applyBackground();
      saveBackgroundToStorage();
    });
  }
}

function initServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("service-worker.js")
      .catch(err => console.warn("SW reg failed", err));
  }
}

// ------------------ INIT ------------------

window.addEventListener("DOMContentLoaded", () => {
  loadCityFromStorage();
  loadBackgroundFromStorage();

  BNAPP.today = new Date();
  BNAPP.viewYear = BNAPP.today.getFullYear();
  BNAPP.viewMonth = BNAPP.today.getMonth();

  initThemeToggle();
  initModalClose();
  initMonthNav();
  initButtons();
  initServiceWorker();
  subscribeEvents();
  renderCalendar();
});
