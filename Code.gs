/**
 * INBOX TRIAGE — автономная версия (публичная)
 * Apps Script + слой правил + Gemini API (free tier)
 * ------------------------------------------------------------
 * Категории и цвета ярлыков:
 *   Личное                 — розовый
 *   Карьера                — красный
 *   Счета и платежи        — жёлтый
 *   Аккаунты и безопасность— фиолетовый
 *   Поездки                — синий
 *   Рассылки               — серый (сюда же сервисные новости)
 *
 * Порядок классификации:
 *   1. PERSONAL_SENDERS → Личное (ваш ручной список, высший приоритет)
 *   2. SENDER_RULES     → категория по отправителю (0 токенов)
 *   3. Gemini           → всё неопознанное, одним батчем
 *
 * Уведомления в Telegram — только для писем свежее NOTIFY_MAX_AGE_HOURS,
 * чтобы разбор накопленного инбокса не завалил бота старой почтой.
 *
 * DRY_RUN = true: почта не трогается, только лог. Выключите после
 * проверки качества (см. инструкцию).
 * ------------------------------------------------------------
 */

// ==================== НАСТРОЙКИ ====================
const DRY_RUN = true;                  // false — боевой режим
const MAX_THREADS_PER_RUN = 30;
const SNIPPET_CHARS = 300;
const GEMINI_MODEL = 'gemini-3.1-flash-lite'; // check current names: run listModels()
const PROCESSED_LABEL = 'AI-Обработано'; // служебная метка «уже разобрано»
const NOTIFY_MAX_AGE_HOURS = 6;        // в Telegram — только письма свежее N часов

// ЛИЧНОЕ: впишите адреса или домены людей, чьи письма всегда идут в «Личное».
// Достаточно подстроки: 'ivanov@gmail.com' или просто 'ivanov'.
const PERSONAL_SENDERS = [
  // впишите адреса людей, чьи письма всегда идут в «Личное».
  // подстроки достаточно: 'ivanov@gmail.com' или просто 'ivanov'.
  // 'friend@example.com',
  // 'mom@example.com',
];

// Ярлыки: имя + цвет (палитра Gmail, менять можно только на цвета из неё)
const LABELS = {
  'ЛИЧНОЕ':   { name: 'Личное',                  bg: '#f691b3', text: '#000000' },
  'КАРЬЕРА':  { name: 'Карьера',                 bg: '#fb4c2f', text: '#ffffff' },
  'СЧЕТА':    { name: 'Счета и платежи',         bg: '#fad165', text: '#000000' },
  'АККАУНТЫ': { name: 'Аккаунты и безопасность', bg: '#a479e2', text: '#ffffff' },
  'ПОЕЗДКИ':  { name: 'Поездки',                 bg: '#4a86e8', text: '#ffffff' },
  'РАССЫЛКИ': { name: 'Рассылки',                bg: '#999999', text: '#ffffff' },
};

// Что делать с каждой категорией.
// Уведомления в Telegram — только для Личное, Карьера, Поездки.
const CATEGORY_ACTIONS = {
  'ЛИЧНОЕ':   { archive: false, telegram: true  },
  'КАРЬЕРА':  { archive: false, telegram: true  },
  'СЧЕТА':    { archive: false, telegram: false },
  'АККАУНТЫ': { archive: false, telegram: false },
  'ПОЕЗДКИ':  { archive: false, telegram: true  },
  'РАССЫЛКИ': { archive: true,  telegram: false },
  'НЕЯСНО':   { archive: false, telegram: false }, // остаётся в инбоксе нетронутым
};

// Архивировать можно ТОЛЬКО РАССЫЛКИ — защита от ошибок модели
const ARCHIVE_ALLOWED = ['РАССЫЛКИ'];

// Правила по отправителю (заполнено по вашей выгрузке; дополняйте)
const SENDER_RULES = {
  // Подстрока в адресе отправителя -> категория. Дополняйте под свой инбокс.
  // Примеры (замените на реальных отправителей из вашей почты):
  // NEWSLETTERS / рассылки
  'newsletter': 'РАССЫЛКИ',
  'noreply': 'РАССЫЛКИ',
  'promo': 'РАССЫЛКИ',
  // ACCOUNTS / аккаунты и безопасность
  'accounts.google.com': 'АККАУНТЫ',
  'security': 'АККАУНТЫ',
  // TRAVEL / поездки
  'booking.com': 'ПОЕЗДКИ',
  // BILLS / счета
  'invoice': 'СЧЕТА',
  'billing': 'СЧЕТА',
};
// ====================================================

/** ГЛАВНАЯ ФУНКЦИЯ — на неё вешается триггер */
function triageInbox() {
  const threads = GmailApp.search('in:inbox -label:' + PROCESSED_LABEL, 0, MAX_THREADS_PER_RUN)
    .filter(t => !t.getLabels().some(l => l.getName() === PROCESSED_LABEL));
  if (threads.length === 0) return;

  const items = threads.map(t => {
    const msg = t.getMessages()[t.getMessageCount() - 1];
    return {
      thread: t, id: t.getId(),
      from: msg.getFrom(),
      subject: msg.getSubject() || '(без темы)',
      snippet: safeSnippet_(msg),
      date: msg.getDate(),
      category: null, priority: 'P3', summary: '', needsReply: false, source: '',
    };
  });

  // 1) Личный список — высший приоритет
  // 2) Правила по отправителю
  const unknown = [];
  items.forEach(it => {
    if (isPersonal_(it.from)) {
      it.category = 'ЛИЧНОЕ'; it.summary = '(личный список)'; it.source = 'personal';
    } else {
      const rule = matchRule_(it.from);
      if (rule) { it.category = rule; it.summary = '(по правилу)'; it.source = 'rule'; }
      else unknown.push(it);
    }
  });

  // 3) Gemini — одним батчем
  if (unknown.length > 0) {
    try {
      const results = classifyWithGemini_(unknown);
      unknown.forEach(it => {
        const r = results[it.id];
        if (r) {
          it.category = normalizeCategory_(r.category);
          it.priority = ['P1', 'P2', 'P3'].includes(r.priority) ? r.priority : 'P3';
          it.summary = String(r.summary || '').slice(0, 200);
          it.needsReply = r.needs_reply === true;
          it.source = 'gemini';
        } else { it.category = 'НЕЯСНО'; it.source = 'gemini-miss'; }
      });
    } catch (e) {
      unknown.forEach(it => { it.category = 'НЕЯСНО'; it.summary = 'Gemini error: ' + e.message; it.source = 'error'; });
    }
  }

  // Исполнение
  const processedLabel = getOrCreateLabel_(PROCESSED_LABEL);
  items.forEach(it => {
    const act = CATEGORY_ACTIONS[it.category] || CATEGORY_ACTIONS['НЕЯСНО'];
    const doArchive = act.archive && ARCHIVE_ALLOWED.includes(it.category);
    const doTelegram = act.telegram && isRecent_(it.date); // свежие Личное / Карьера / Поездки

    if (!DRY_RUN) {
      const labelCfg = LABELS[it.category];
      if (labelCfg) getOrCreateLabel_(labelCfg.name).addToThread(it.thread);
      if (doArchive) it.thread.moveToArchive();
      if (doTelegram) sendTelegram_(buildAlert_(it));
      if (it.category !== 'НЕЯСНО') processedLabel.addToThread(it.thread);
    }
    log_(it, doArchive, doTelegram);
  });
}

/** Создать все ярлыки с цветами. Запустить ОДИН РАЗ.
 *  Требует включённого сервиса Gmail API (см. инструкцию, шаг 4). */
function setupLabels() {
  const existing = Gmail.Users.Labels.list('me').labels || [];
  const byName = {};
  existing.forEach(l => { byName[l.name] = l; });

  Object.keys(LABELS).forEach(key => {
    const cfg = LABELS[key];
    const body = {
      name: cfg.name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
      color: { backgroundColor: cfg.bg, textColor: cfg.text },
    };
    if (byName[cfg.name]) {
      Gmail.Users.Labels.patch(body, 'me', byName[cfg.name].id);
      Logger.log('Обновлён цвет: ' + cfg.name);
    } else {
      Gmail.Users.Labels.create(body, 'me');
      Logger.log('Создан ярлык: ' + cfg.name);
    }
  });
  // служебная метка без цвета, скрытая из списка писем
  if (!byName[PROCESSED_LABEL]) {
    Gmail.Users.Labels.create({
      name: PROCESSED_LABEL,
      labelListVisibility: 'labelHide',
      messageListVisibility: 'hide',
    }, 'me');
    Logger.log('Создана служебная метка: ' + PROCESSED_LABEL);
  }
  Logger.log('Готово. Проверьте цвета в Gmail.');
}

/** Батч-классификация через Gemini (ответ строго JSON) */
function classifyWithGemini_(items) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Нет GEMINI_API_KEY в Script Properties');

  const emailsBlock = items.map(it =>
    JSON.stringify({ id: it.id, from: it.from, subject: it.subject, snippet: it.snippet })
  ).join('\n');

  const prompt = [
    'Ты классифицируешь письма личного почтового ящика. Категории:',
    'ЛИЧНОЕ — письма от живых людей: друзья, семья, знакомые (не компании и не роботы).',
    'КАРЬЕРА — ответы рекрутеров/работодателей, приглашения на интервью, статусы откликов. НЕ массовые рассылки джобсайтов.',
    'СЧЕТА — платежи, счета, коммунальные услуги, банки, подтверждения оплат.',
    'АККАУНТЫ — безопасность, входы в аккаунты, коды, верификации, смены пароля.',
    'ПОЕЗДКИ — брони жилья/билетов, сообщения хостов и отелей.',
    'РАССЫЛКИ — маркетинг, дайджесты, продуктовые новости сервисов, обновления политик, холодные продажи.',
    'НЕЯСНО — если уверенности нет.',
    '',
    'Приоритет: P1 — реагировать сегодня (КАРЬЕРА, вопрос от человека или хоста, тревожное оповещение безопасности вроде незнакомого входа), P2 — 1-2 дня, P3 — не требует реакции.',
    'needs_reply: true, если в письме есть вопрос или просьба, ожидающая ответа.',
    'summary: суть одной короткой фразой на русском.',
    '',
    'Письма (JSON, по одному в строке):',
    emailsBlock,
    '',
    'Верни JSON-массив объектов: {"id","category","priority","summary","needs_reply"}. Только массив, без пояснений.',
  ].join('\n');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey;
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) throw new Error('Gemini HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));

  const data = JSON.parse(resp.getContentText());
  const arr = JSON.parse(data.candidates[0].content.parts[0].text);
  const map = {};
  arr.forEach(r => { map[r.id] = r; });
  return map;
}

// ==================== ХЕЛПЕРЫ ====================

/** Письмо свежее порога? Старое разбирается по ярлыкам, но без уведомления.
 *  Нужно, чтобы первый прогон по накопленному инбоксу не завалил Telegram. */
function isRecent_(date) {
  if (!date) return false;
  const ageHours = (Date.now() - date.getTime()) / 36e5;
  return ageHours <= NOTIFY_MAX_AGE_HOURS;
}

function isPersonal_(from) {
  const f = from.toLowerCase();
  return PERSONAL_SENDERS.some(p => p && f.indexOf(p.toLowerCase()) !== -1);
}

function matchRule_(from) {
  const f = from.toLowerCase();
  for (const key in SENDER_RULES) {
    if (f.indexOf(key.toLowerCase()) !== -1) return SENDER_RULES[key];
  }
  return null;
}

function normalizeCategory_(c) {
  const cat = String(c || '').toUpperCase().trim();
  return CATEGORY_ACTIONS.hasOwnProperty(cat) ? cat : 'НЕЯСНО';
}

function safeSnippet_(msg) {
  try { return msg.getPlainBody().replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS); }
  catch (e) { return ''; }
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function buildAlert_(it) {
  const icon = it.category === 'КАРЬЕРА' ? '🔥' : (it.category === 'АККАУНТЫ' ? '⚠' : '📬');
  return icon + ' ' + (LABELS[it.category] ? LABELS[it.category].name : it.category) + ' · ' + it.priority + '\n' +
    'От: ' + it.from + '\n' +
    'Тема: ' + it.subject + '\n' +
    'Суть: ' + it.summary;
}

function sendTelegram_(text) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TELEGRAM_TOKEN');
  const chatId = props.getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return;
  UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: text }),
    muteHttpExceptions: true,
  });
}

function log_(it, archived, notified) {
  const ss = getLogSpreadsheet_();
  const sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp', 'mode', 'source', 'from', 'subject', 'category', 'priority', 'summary', 'archived', 'telegram', 'thread_id']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    new Date(), DRY_RUN ? 'DRY_RUN' : 'LIVE', it.source, it.from, it.subject,
    it.category, it.priority, it.summary, archived ? 'да' : '', notified ? 'да' : '', it.id,
  ]);
}

function getLogSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('LOG_SPREADSHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* пересоздадим */ } }
  const ss = SpreadsheetApp.create('Inbox Triage — Лог');
  props.setProperty('LOG_SPREADSHEET_ID', ss.getId());
  return ss;
}

// ==================== СЛУЖЕБНЫЕ ====================

/** Запустить один раз: триггер каждые 30 минут */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'triageInbox') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('triageInbox').timeBased().everyMinutes(30).create();
  Logger.log('Триггер установлен: triageInbox каждые 30 минут.');
}

/** Ручной запуск + ссылка на лог */
function testRun() {
  triageInbox();
  const id = PropertiesService.getScriptProperties().getProperty('LOG_SPREADSHEET_ID');
  Logger.log('Готово. Лог: https://docs.google.com/spreadsheets/d/' + id);
}


// ==================== САМОДИАГНОСТИКА ====================

/** Проверка связки с Telegram: шлёт тестовое сообщение напрямую. */
function testTelegram() {
  sendTelegram_('Проверка связи: Inbox Triage на месте.');
}

/** Список моделей, доступных вашему ключу (если GEMINI_MODEL даёт 404). */
function listModels() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const resp = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey,
    { muteHttpExceptions: true }
  );
  const data = JSON.parse(resp.getContentText());
  (data.models || []).forEach(m => {
    if ((m.supportedGenerationMethods || []).indexOf('generateContent') !== -1) {
      Logger.log(m.name);
    }
  });
}
