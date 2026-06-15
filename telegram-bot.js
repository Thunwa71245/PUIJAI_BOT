require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

const HISTORY_LIMIT = 12;
const ERROR_LOG_PATH = path.join(__dirname, "telegram-bot-error.log");
const ERROR_LOG_INTERVAL_MS = 60_000;
const DEBUG = process.env.DEBUG === "true";
const PERSONA_RESPONSE = `ผมชื่อ PUIJAI ครับ 😊
ผมเป็น AI ผู้ช่วยรับฟังและให้คำแนะนำด้านสุขภาพจิตเบื้องต้น
ผมไม่ใช่นักจิตวิทยาหรือแพทย์ แต่ผมพร้อมรับฟังและช่วยคุณค่อย ๆ มองปัญหาอย่างปลอดภัยครับ`;
const REPEATED_ANSWER_FALLBACK =
  "ผมอาจถามซ้ำไปหน่อย ขอโทษนะครับ 🙏 งั้นขอเริ่มจากสิ่งที่คุณเพิ่งเล่าล่าสุดนะครับ ตอนนี้อยากให้ผมช่วยมองเรื่องนี้ในมุมไหนมากที่สุดครับ?";

const histories = new Map();
const conversationStates = new Map();
const lastErrorLogTimes = new Map();

const TOPIC_KEYWORDS = {
  game: [
    "เกม",
    "เล่นเกม",
    "แพ้",
    "ชนะ",
    "ทีม",
    "แรงค์",
    "rov",
    "valorant",
    "lol",
    "dota",
  ],
  nutrition: [
    "โปรตีน",
    "อาหาร",
    "กิน",
    "เวย์",
    "อกไก่",
    "ไข่",
    "นม",
    "แคล",
    "ครีม",
    "ข้าว",
    "สารอาหาร",
  ],
  fitness: ["ออกกำลังกาย", "เวท", "ฟิตเนส", "กล้าม", "คาร์ดิโอ", "ลู่วิ่ง"],
  work: ["งาน", "ลาออก", "หัวหน้า", "เพื่อนร่วมงาน", "เงินเดือน", "บริษัท"],
  relationship: ["แฟน", "ความรัก", "เลิกกัน"],
  study: ["เรียน", "มหาลัย", "มหาวิทยาลัย", "สอบ", "อาจารย์"],
  family: ["พ่อ", "แม่", "ครอบครัว"],
  health: ["สุขภาพ", "ป่วย", "นอนไม่หลับ", "เครียด", "ซึมเศร้า"],
  music: ["เพลง", "ฟังเพลง", "pop lock", "เพลงช้า"],
};

const PERSONA_QUESTIONS = [
  "เธอคือใคร",
  "คุณคือใคร",
  "มีชื่อไหม",
  "ชื่ออะไร",
  "เป็นใคร",
];

const SHORT_REPLIES = [
  "ใช่",
  "ไม่ใช่",
  "ดี",
  "ไม่ดี",
  "โอเค",
  "อืม",
  "ครับ",
  "ค่ะ",
  "ใช่ครับ",
  "ใช่ค่ะ",
];

const CONTEXTUAL_REPLY_PATTERNS = [
  /^(?:ใช่(?:ครับ|ค่ะ)?|ไม่ใช่(?:ครับ|ค่ะ)?|โอเค|อืม)?(?:เธอว่า)?(?:มัน|แบบนี้)ดีไหม(?:ครับ|คะ|ค่ะ)?$/,
  /^(?:ใช่(?:ครับ|ค่ะ)?|ไม่ใช่(?:ครับ|ค่ะ)?)?(?:เธอว่า)?(?:มัน|แบบนี้)ไม่ดีใช่ไหม(?:ครับ|คะ|ค่ะ)?$/,
];

const INTENT_RULES = [
  {
    intent: "preparing_application",
    fact: "plan = preparing_job_application",
    keywords: [
      "ยื่นเอกสารสมัครงาน",
      "ยื่นสมัครงาน",
      "สมัครงาน",
      "เตรียมเอกสาร",
      "เรซูเม่",
      "resume",
      "cv",
    ],
  },
  {
    intent: "job_search_plan",
    fact: "plan = find_new_job_before_resign",
    keywords: [
      "กว่าจะได้งานก่อนค่อยออก",
      "ได้งานก่อนค่อยออก",
      "หางานใหม่ก่อนลาออก",
      "หางานก่อนลาออก",
      "หางานใหม่ก่อน",
      "ได้งานใหม่ก่อน",
    ],
  },
  {
    intent: "talk_to_boss_plan",
    fact: "plan = talk_to_manager",
    keywords: ["จะลองคุยกับหัวหน้า", "ลองคุยกับหัวหน้า", "คุยกับหัวหน้า"],
  },
  {
    intent: "rest_plan",
    fact: "plan = take_a_break",
    keywords: ["จะพักก่อน", "ขอพักก่อน", "พักก่อน"],
  },
  {
    intent: "discuss_finance",
    fact: "",
    keywords: ["การเงิน", "เงินเดือน", "ค่าใช้จ่าย", "หนี้", "เงิน"],
  },
];

function loadKnowledge() {
  const knowledgeDir = path.join(__dirname, "knowledge");

  if (!fs.existsSync(knowledgeDir)) {
    return "";
  }

  return fs
    .readdirSync(knowledgeDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => fs.readFileSync(path.join(knowledgeDir, file), "utf8"))
    .join("\n\n");
}

function searchKnowledge(question) {
  const content = loadKnowledge();

  if (!content) return "";

  const chunks = content
    .split(/\n\s*\n/)
    .map((text) => text.trim())
    .filter((text) => text.length > 30);
  const keywords = question
    .toLowerCase()
    .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 1);

  return chunks
    .map((chunk) => ({
      chunk,
      score: keywords.reduce(
        (score, word) => score + (chunk.toLowerCase().includes(word) ? 1 : 0),
        0
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => item.chunk)
    .join("\n\n");
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\u0E00-\u0E7Fa-z0-9]/g, "")
    .trim();
}

function cleanAnswer(answer) {
  let text = String(answer || "");

  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/<think>[\s\S]*/gi, "");
  text = text.trim();

  if (!text) {
    return "ขออภัยครับ ผมยังสรุปคำตอบได้ไม่ชัดเจน ลองพิมพ์ใหม่อีกครั้ง หรือบอกข้อมูลเพิ่มอีกนิดได้ไหมครับ";
  }

  return text;
}

function logError(error, key = "general") {
  const now = Date.now();
  const lastLoggedAt = lastErrorLogTimes.get(key) || 0;

  if (now - lastLoggedAt < ERROR_LOG_INTERVAL_MS) {
    return;
  }

  lastErrorLogTimes.set(key, now);
  const message = error instanceof Error ? error.message : String(error);
  const line = `[${new Date(now).toISOString()}] ${key}: ${message}\n`;

  fs.appendFile(ERROR_LOG_PATH, line, () => {});
}

function isPersonaQuestion(text) {
  const normalized = normalizeText(text);
  const politeSuffixPattern = "(?:ครับ|คะ|ค่ะ|นะ|หน่อย)?";

  return PERSONA_QUESTIONS.some((question) => {
    const normalizedQuestion = normalizeText(question);
    return new RegExp(`^${normalizedQuestion}${politeSuffixPattern}$`).test(
      normalized
    );
  });
}

function isShortReply(text) {
  const normalized = normalizeText(text);
  const hasTopicSignal =
    detectTopic(text) !== "unknown" || detectIntent(text).intent !== "unknown";

  if (hasTopicSignal) {
    return false;
  }

  const isExactShortReply = SHORT_REPLIES.some(
    (reply) => normalized === normalizeText(reply)
  );

  return (
    isExactShortReply ||
    CONTEXTUAL_REPLY_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

function detectTopic(text) {
  const normalized = text.toLowerCase();

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      return topic;
    }
  }

  return "unknown";
}

function detectIntent(text) {
  const normalized = text.toLowerCase();

  return (
    INTENT_RULES.find((rule) =>
      rule.keywords.some((keyword) => normalized.includes(keyword))
    ) || { intent: "unknown", fact: "", keywords: [] }
  );
}

function detectConcern(text) {
  const normalized = text.toLowerCase();
  const concerns = {
    money: ["เงิน", "การเงิน", "เงินเดือน", "ค่าใช้จ่าย", "หนี้"],
    workload: ["งานหนัก", "ภาระงาน", "งานเยอะ"],
    manager: ["หัวหน้า", "เจ้านาย"],
    coworkers: ["เพื่อนร่วมงาน"],
    wellbeing: ["เครียด", "เหนื่อย", "สุขภาพใจ", "ไม่ไหว"],
  };

  for (const [concern, keywords] of Object.entries(concerns)) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      return concern;
    }
  }

  return "unknown";
}

function getMatchedKeywords(text) {
  const normalized = text.toLowerCase();
  const keywords = [
    ...Object.values(TOPIC_KEYWORDS).flat(),
    ...INTENT_RULES.flatMap((rule) => rule.keywords),
  ];

  return [...new Set(keywords.filter((keyword) => normalized.includes(keyword)))];
}

function createCleanState(sessionId = Date.now(), resetAt = null) {
  return {
    sessionId,
    topic: "unknown",
    previousTopic: "unknown",
    concern: "unknown",
    latestIntent: "unknown",
    latestFact: "",
    lastUserProblem: "",
    lastAssistantQuestion: "",
    knownKeywords: [],
    hasNewInformation: false,
    topicJustChanged: false,
    resetAt,
  };
}

function resetConversation(chatId) {
  const previousSessionId =
    conversationStates.get(chatId)?.sessionId || 0;
  const sessionId = Math.max(Date.now(), previousSessionId + 1);

  histories.delete(chatId);
  conversationStates.delete(chatId);
  histories.set(chatId, []);
  conversationStates.set(
    chatId,
    createCleanState(sessionId, Date.now())
  );
}

function getConversationState(chatId) {
  if (!conversationStates.has(chatId)) {
    conversationStates.set(chatId, createCleanState());
  }

  return conversationStates.get(chatId);
}

function updateConversationState(chatId, text, shortReply = false) {
  const state = getConversationState(chatId);
  const previousTopic = state.topic;
  const detectedTopic = detectTopic(text);
  const detectedConcern = detectConcern(text);
  const intentRule = detectIntent(text);
  const matchedKeywords = getMatchedKeywords(text);
  const newKeywords = matchedKeywords.filter(
    (keyword) => !state.knownKeywords.includes(keyword)
  );
  const hasNewInformation =
    normalizeText(text).length > 10 && newKeywords.length > 0;
  const topicJustChanged =
    detectedTopic !== "unknown" &&
    detectedTopic !== previousTopic;

  state.previousTopic = previousTopic;
  state.topicJustChanged = topicJustChanged;

  if (topicJustChanged) {
    state.topic = detectedTopic;
    state.concern = "unknown";
    state.latestIntent = "unknown";
    state.latestFact = "";
    state.lastAssistantQuestion = "";
    state.lastUserProblem = text.trim();
    state.knownKeywords = [];
  } else if (detectedTopic !== "unknown") {
    state.topic = detectedTopic;
  }

  if (detectedConcern !== "unknown") {
    state.concern = detectedConcern;
  }

  if (intentRule.intent !== "unknown") {
    state.latestIntent = intentRule.intent;
    state.latestFact = intentRule.fact;
  } else if (!shortReply) {
    state.latestIntent = hasNewInformation ? "provide_new_information" : "unknown";
    state.latestFact = "";
  }

  state.hasNewInformation = hasNewInformation;
  state.knownKeywords = [...new Set([...state.knownKeywords, ...matchedKeywords])];

  // New details and plans supersede the older problem even when they are brief.
  if ((!shortReply || hasNewInformation) && !isPersonaQuestion(text)) {
    state.lastUserProblem = text.trim();
  }

  return state;
}

function saveHistory(chatId, role, content) {
  const state = getConversationState(chatId);
  const history = getSessionHistory(chatId);
  history.push({ role, content, sessionId: state.sessionId });
  histories.set(chatId, history.slice(-HISTORY_LIMIT));
}

function getSessionHistory(chatId) {
  const state = getConversationState(chatId);
  const history = histories.get(chatId) || [];

  return history.filter((message) => message.sessionId === state.sessionId);
}

function getLastAssistantAnswer(chatId) {
  const history = getSessionHistory(chatId);
  return [...history].reverse().find((message) => message.role === "assistant")
    ?.content;
}

function extractLastQuestion(answer) {
  const parts = answer
    .split(/\n|(?<=[?!?])/)
    .map((part) => part.trim())
    .filter(Boolean);
  const questionWords = ["ไหม", "อะไร", "อย่างไร", "ยังไง", "หรือ", "เท่าไร"];

  return (
    [...parts]
      .reverse()
      .find(
        (part) =>
          /[?？]$/.test(part) ||
          questionWords.some((questionWord) => part.includes(questionWord))
      ) || ""
  );
}

function getRecentAssistantQuestions(chatId, messageLimit = 5) {
  const history = getSessionHistory(chatId);

  return history
    .slice(-messageLimit)
    .filter((message) => message.role === "assistant")
    .map((message) => extractLastQuestion(message.content))
    .filter(Boolean);
}

function characterBigrams(text) {
  const normalized = normalizeText(text);
  const bigrams = new Set();

  for (let index = 0; index < normalized.length - 1; index++) {
    bigrams.add(normalized.slice(index, index + 2));
  }

  return bigrams;
}

function isTooSimilar(answer, previousAnswer) {
  if (!previousAnswer) return false;

  const normalizedAnswer = normalizeText(answer);
  const normalizedPrevious = normalizeText(previousAnswer);

  if (!normalizedAnswer || !normalizedPrevious) return false;
  if (normalizedAnswer === normalizedPrevious) return true;

  const answerBigrams = characterBigrams(answer);
  const previousBigrams = characterBigrams(previousAnswer);
  const intersection = [...answerBigrams].filter((item) =>
    previousBigrams.has(item)
  ).length;
  const diceScore =
    (2 * intersection) / (answerBigrams.size + previousBigrams.size || 1);

  return diceScore >= 0.95;
}

function areQuestionsSimilar(question, previousQuestion) {
  const normalizedQuestion = normalizeText(question);
  const normalizedPrevious = normalizeText(previousQuestion);

  if (!normalizedQuestion || !normalizedPrevious) return false;
  if (
    normalizedQuestion.includes(normalizedPrevious) ||
    normalizedPrevious.includes(normalizedQuestion)
  ) {
    return true;
  }

  const questionBigrams = characterBigrams(question);
  const previousBigrams = characterBigrams(previousQuestion);
  const intersection = [...questionBigrams].filter((item) =>
    previousBigrams.has(item)
  ).length;
  const diceScore =
    (2 * intersection) / (questionBigrams.size + previousBigrams.size || 1);

  return diceScore >= 0.78;
}

function replaceRepeatedQuestion(answer, recentQuestions, state) {
  const answerQuestion = extractLastQuestion(answer);
  const isRepeated = recentQuestions.some((question) =>
    areQuestionsSimilar(answerQuestion, question)
  );

  if (!answerQuestion || !isRepeated) {
    return answer;
  }

  const reflection = answer.replace(answerQuestion, "").trim();
  const intentSteps = {
    job_search_plan:
      "สำหรับแผนนี้ งานใหม่แบบไหนจึงจะคุ้มพอให้คุณตัดสินใจย้ายครับ?",
    preparing_application:
      "ตอนนี้ส่วนไหนของการสมัครที่คุณอยากเริ่มก่อน ระหว่างเรซูเม่ เอกสาร หรือตำแหน่งเป้าหมายครับ?",
    talk_to_boss_plan:
      "คุณอยากให้การคุยกับหัวหน้าครั้งนี้ได้ผลลัพธ์อะไรชัดที่สุดครับ?",
    rest_plan:
      "คุณคิดว่าต้องพักประมาณไหนจึงจะรู้สึกว่าได้ฟื้นจริง ๆ ครับ?",
    discuss_finance:
      "ตัวเลขไหนที่คุณอยากเห็นชัดก่อนตัดสินใจ เช่น รายจ่ายจำเป็นหรือเงินสำรองครับ?",
  };
  const smallStep =
    intentSteps[state.latestIntent] ||
    "จากสิ่งที่คุณเพิ่งเล่า อยากให้ผมช่วยมองส่วนไหนต่อมากที่สุดครับ?";

  return [reflection, smallStep].filter(Boolean).join("\n");
}

function isRiskMessage(text) {
  const riskWords = [
    "อยากตาย",
    "ฆ่าตัวตาย",
    "ไม่อยากอยู่แล้ว",
    "ทำร้ายตัวเอง",
    "ไม่อยากมีชีวิต",
    "อยากหายไป",
    "จบชีวิต",
  ];

  return riskWords.some((word) => text.includes(word));
}

function buildStateContext(state, shortReply) {
  return `conversationState:
- sessionId = ${state.sessionId}
- topic = ${state.topic}
- previousTopic = ${state.previousTopic}
- concern = ${state.concern}
- latestIntent = ${state.latestIntent}
- latestFact = ${state.latestFact || "ยังไม่มี"}
- lastUserProblem = ${state.lastUserProblem || "ยังไม่มี"}
- lastAssistantQuestion = ${state.lastAssistantQuestion || "ยังไม่มี"}
- hasNewInformation = ${state.hasNewInformation ? "true" : "false"}
- topicJustChanged = ${state.topicJustChanged ? "true" : "false"}
- resetAt = ${state.resetAt || "ยังไม่เคย reset"}
- isShortReply = ${shortReply ? "true" : "false"}`;
}

function buildSafePromptContext(chatId, text) {
  const state = getConversationState(chatId);
  const sessionHistory = getSessionHistory(chatId);
  const isFirstMessageAfterReset =
    Boolean(state.resetAt) && sessionHistory.length === 0;
  const useLatestMessageOnly =
    isFirstMessageAfterReset || state.topicJustChanged;

  return {
    state,
    history: useLatestMessageOnly ? [] : sessionHistory.slice(-6),
    isFirstMessageAfterReset,
    useLatestMessageOnly,
    latestMessage: text,
  };
}

async function askPathumma(question, chatId, state, shortReply) {
  const knowledgeQuery = shortReply
    ? `${state.lastUserProblem} ${question}`.trim()
    : question;
  const context = searchKnowledge(knowledgeQuery);
  const safeContext = buildSafePromptContext(chatId, question);
  const recentHistory = safeContext.history;
  const recentAssistantQuestions = safeContext.useLatestMessageOnly
    ? []
    : getRecentAssistantQuestions(chatId);
  const contextInstruction = safeContext.isFirstMessageAfterReset
    ? "นี่คือข้อความแรกหลัง /reset ให้ตอบจากข้อความล่าสุดเท่านั้น ห้ามใช้บริบทใด ๆ ก่อน reset"
    : state.topicJustChanged
    ? "ผู้ใช้เพิ่งเปลี่ยนหัวข้อจากบริบทเดิม ให้ตอบจากข้อความล่าสุดเท่านั้น ห้ามย้อนกลับไปหัวข้อก่อนหน้า"
    : shortReply
    ? `ข้อความนี้เป็นการตอบต่อจากบริบทก่อนหน้า ห้ามตีความเป็นประเด็นใหม่:
- topic = ${state.topic}
- lastUserProblem = ${state.lastUserProblem || "ยังไม่มี"}
- lastAssistantQuestion = ${state.lastAssistantQuestion || "ยังไม่มี"}
ให้ตอบต่อเนื่องจากปัญหาเดิม และอย่าถาม lastAssistantQuestion ซ้ำ`
    : "ข้อความนี้ไม่ใช่คำตอบสั้น ให้ตีความร่วมกับประวัติการสนทนา";

  const response = await fetch("http://thaillm.or.th/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.THAILLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: "pathumma",
      messages: [
        {
          role: "system",
          content: `คุณคือ PUIJAI AI ผู้ช่วยรับฟังและให้คำแนะนำด้านสุขภาพจิตเบื้องต้น

Priority การตีความ:
1. ข้อความล่าสุดของผู้ใช้
2. topic ใหม่ ถ้ามีการเปลี่ยนหัวข้อ
3. conversation history 3-6 ข้อความล่าสุด
4. conversationState
5. knowledge context

ข้อกำหนด:
1. ห้ามใช้ conversationState แทนหรือขัดกับข้อความล่าสุดของผู้ใช้ ข้อมูลใหม่ต้องมี priority สูงกว่า state เดิม
2. ใช้ conversationState และ history เพื่อเข้าใจข้อความสั้นที่ไม่มีข้อมูลใหม่เท่านั้น
3. latestIntent สำคัญกว่า concern เดิม ถ้าผู้ใช้เสนอแผนใหม่ ให้ตอบต่อยอดแผนนั้น
4. ห้ามถามคำถามเดิมหรือคำถามความหมายใกล้เคียงที่อยู่ใน recentAssistantQuestions
5. ถ้าผู้ใช้มีแผน เช่น หางานใหม่ก่อนลาออก ยื่นสมัครงาน พักก่อน หรือคุยกับหัวหน้า ให้สะท้อนข้อดีและข้อควรระวังของแผน แล้วเสนอคำถามใหม่หรือ small step ห้ามย้อนถามปัญหาเดิม
6. ถ้าผู้ใช้ถามว่า "มันดีไหม" หรือคำใกล้เคียง ให้ประเมินจากบริบทล่าสุด ห้ามตอบแบบกว้าง ๆ
7. ถ้าบริบทเป็นเรื่องงานและการลาออก อย่าตัดสินทันทีว่าดีหรือไม่ดี ให้ช่วยชั่งน้ำหนักสาเหตุ แผนสำรอง การเงิน สุขภาพใจ และความปลอดภัย
8. ตอบด้วย Reflection สั้น ๆ + คำตอบตามบริบทล่าสุด + คำถามต่อที่มีประโยชน์ 1 ข้อ
9. ตอบภาษาไทยอย่างอบอุ่น กระชับ ไม่เกิน 6 บรรทัด
10. ห้ามวินิจฉัยโรค ห้ามสั่งยา และห้ามอ้างว่าตนเป็นนักจิตวิทยา แพทย์ หรือผู้เชี่ยวชาญ
11. ใช้ข้อมูลอ้างอิงเมื่อเกี่ยวข้องเท่านั้น และห้ามแต่งข้อมูลว่าอยู่ในเอกสาร
12. เมื่อ hasNewInformation = true ต้องกล่าวถึงหรือต่อยอดข้อมูลใหม่ในข้อความล่าสุด
13. เมื่อ topicJustChanged = true ผู้ใช้เพิ่งเปลี่ยนหัวข้อ ให้ตอบจากข้อความล่าสุดเป็นหลักและห้ามย้อนกลับไปหัวข้อก่อนหน้า
14. ถ้าข้อความล่าสุดเกี่ยวกับอาหาร โปรตีน การออกกำลังกาย หรือสุขภาพกาย ห้ามโยงกลับไปเรื่องงาน เงิน หรือความสัมพันธ์ เว้นแต่ผู้ใช้เชื่อมโยงเองอย่างชัดเจน
15. ต้องคงสไตล์ถามต่อ 1 คำถามเสมอ แต่คำถามต้องเกี่ยวกับหัวข้อปัจจุบันและไม่ซ้ำคำถามเดิม
16. ห้ามแสดง <think>, reasoning, chain of thought หรือข้อความวิเคราะห์ภายใน
17. ตอบเฉพาะคำตอบสุดท้ายที่ต้องการให้ผู้ใช้เห็น
18. คำตอบสุดท้ายต้องเป็นภาษาไทยเท่านั้น ห้ามใช้ภาษาอังกฤษ ยกเว้นชื่อเฉพาะที่จำเป็น
19. ห้ามใช้บริบทหรือข้อความจาก session ก่อน /reset โดยเด็ดขาด
20. ถ้าผู้ใช้เปลี่ยนหัวข้อชัดเจน ห้ามพูดถึงหัวข้อเก่า เว้นแต่ผู้ใช้เชื่อมโยงเองอย่างชัดเจน
21. ตอบเพียงประเด็นเดียวตามข้อความล่าสุด ห้ามรวมสองบริบทในคำตอบเดียว
22. ถ้า topic = game ให้ตอบเรื่องเกมเท่านั้น สะท้อนความหงุดหงิดหรือผิดหวัง แล้วถามต่อ 1 คำถามเกี่ยวกับทีมเวิร์ก จังหวะการเล่น ความกดดัน หรือความเหนื่อย
23. เมื่อ topic = game ห้ามพูดถึงงาน หัวหน้า HR ความสัมพันธ์ หรือการเงิน
24. กรณี workplace injustice หรือ unfair treatment เช่น หัวหน้าไม่ตรวจเอกสาร โยนความผิด ถูก blame ทั้งที่ไม่ใช่ความผิดของผู้ใช้ หรือ KPI เสียเพราะผู้อื่นไม่ทำหน้าที่ ให้ทำตามลำดับนี้:
   - Validate ก่อนว่าเหตุการณ์ฟังดูไม่ยุติธรรม และผู้ใช้มีเหตุผลที่จะรู้สึกไม่พอใจ เหนื่อยใจ หรือผิดหวัง
   - ถ้าบริบทชัดว่าผู้ใช้ทำส่วนของตนแล้ว ห้ามผลักภาระกลับไปให้ผู้ใช้ เช่น ถามให้เช็กเอกสารหรือส่งซ้ำโดยไม่มีเหตุผล
   - แยกให้ชัดว่าสิ่งที่เกิดขึ้นอาจไม่ใช่ความผิดของผู้ใช้ และไม่ควรถูกโยนเป็นความรับผิดของผู้ใช้คนเดียว
   - จากนั้นเสนอทางเลือกเพื่อปกป้องตนเอง เช่น เก็บหลักฐาน ส่ง follow-up เป็นลายลักษณ์อักษร นัดคุยกับหัวหน้า หรือปรึกษา HR/ผู้บังคับบัญชาที่เกี่ยวข้อง
   - ปิดท้ายด้วยคำถาม 1 ข้อที่ช่วยประเมินทางเลือกหรือหลักฐาน ห้ามถามในลักษณะให้ผู้ใช้รับผิดแทนผู้อื่น
25. กฎ workplace injustice มี priority สูงกว่าคำแนะนำเรื่องงานทั่วไปเมื่อบริบทตรงตามเงื่อนไข

recentAssistantQuestions ภายใน 5 messages ล่าสุด:
${
  safeContext.useLatestMessageOnly
    ? "ไม่ต้องนำคำถามจากบริบทเดิมมาใช้"
    : recentAssistantQuestions.length
    ? recentAssistantQuestions.join("\n")
    : "ยังไม่มี"
}

${buildStateContext(state, shortReply)}`,
        },
        ...recentHistory,
        {
          role: "user",
          content: `ข้อมูลอ้างอิงจากเอกสาร:
${context || "ไม่มีข้อมูลอ้างอิงที่เกี่ยวข้อง"}

${contextInstruction}

ข้อความล่าสุดจากผู้ใช้:
${question}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 700,
    }),
  });

  if (!response.ok) {
    throw new Error(`Pathumma API error: ${response.status}`);
  }

  const data = await response.json();
  const answer = data?.choices?.[0]?.message?.content;

  if (typeof answer !== "string") {
    logError("Pathumma response has no message content", "pathumma_content");
  }

  return cleanAnswer(answer);
}

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true,
});

async function safeSendMessage(chatId, text) {
  const message = String(text || "").trim();

  if (!message) {
    return bot.sendMessage(
      chatId,
      "ขออภัยครับ ระบบยังไม่มีข้อความตอบกลับ ลองพิมพ์ใหม่อีกครั้งนะครับ"
    );
  }

  return bot.sendMessage(chatId, message);
}

bot.on("polling_error", (error) => {
  const key = error?.response?.body?.error_code === 409
    ? "polling_conflict"
    : "polling_error";
  logError(error, key);
});

bot.on("webhook_error", (error) => {
  logError(error, "webhook_error");
});

bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
  await safeSendMessage(
    msg.chat.id,
    `สวัสดีครับ 😊

ผมคือ PUIJAI AI

สามารถพูดคุย ปรึกษา และรับคำแนะนำด้านสุขภาพจิตเบื้องต้นได้

พิมพ์ข้อความที่ต้องการได้เลยครับ`
  );
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text || /^\/start(?:@\w+)?$/.test(text)) return;

  if (/^\/reset(?:@\w+)?$/.test(text)) {
    resetConversation(chatId);
    await safeSendMessage(
      chatId,
      "ล้างประวัติการสนทนาและบริบทเรียบร้อยแล้วครับ เริ่มคุยกันใหม่ได้เลย 😊"
    );
    return;
  }

  let typingInterval;

  try {
    const shortReply = isShortReply(text);
    const state = updateConversationState(chatId, text, shortReply);
    const requestSessionId = state.sessionId;

    if (DEBUG) {
      console.log({
        chatId,
        topic: state.topic,
        previousTopic: state.previousTopic,
        topicJustChanged: state.topicJustChanged,
        historyLength: getSessionHistory(chatId).length,
      });
    }

    if (isRiskMessage(text)) {
      const riskResponse = `ผมเป็นห่วงคุณนะครับ ❤️

หากคุณกำลังคิดทำร้ายตัวเอง หรือรู้สึกไม่ปลอดภัยในขณะนี้

• ติดต่อสายด่วนสุขภาพจิต 1323
• ติดต่อคนใกล้ชิดที่ไว้ใจได้
• หรือไปยังสถานพยาบาลใกล้บ้านทันที

คุณไม่จำเป็นต้องเผชิญเรื่องนี้เพียงลำพังนะครับ`;
      saveHistory(chatId, "user", text);
      saveHistory(chatId, "assistant", riskResponse);
      await safeSendMessage(chatId, riskResponse);
      return;
    }

    if (isPersonaQuestion(text)) {
      saveHistory(chatId, "user", text);
      saveHistory(chatId, "assistant", PERSONA_RESPONSE);
      state.lastAssistantQuestion = "";
      await safeSendMessage(chatId, PERSONA_RESPONSE);
      return;
    }

    typingInterval = setInterval(() => {
      bot
        .sendChatAction(chatId, "typing")
        .catch((error) => logError(error, "chat_action"));
    }, 4000);
    await bot.sendChatAction(chatId, "typing");

    const previousAssistantAnswer = getLastAssistantAnswer(chatId);
    const recentAssistantQuestions = getRecentAssistantQuestions(chatId);
    let answer = await askPathumma(text, chatId, state, shortReply);

    if (getConversationState(chatId).sessionId !== requestSessionId) {
      return;
    }

    if (
      !state.topicJustChanged &&
      isTooSimilar(answer, previousAssistantAnswer)
    ) {
      answer = REPEATED_ANSWER_FALLBACK;
    }

    if (!state.topicJustChanged) {
      answer = replaceRepeatedQuestion(answer, recentAssistantQuestions, state);
    }

    answer = cleanAnswer(answer);

    saveHistory(chatId, "user", text);
    saveHistory(chatId, "assistant", answer);
    state.lastAssistantQuestion = extractLastQuestion(answer);

    await safeSendMessage(chatId, answer);
  } catch (error) {
    logError(error, "message_handler");
    await safeSendMessage(
      chatId,
      "ขออภัยครับ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งภายหลัง"
    );
  } finally {
    if (typingInterval) {
      clearInterval(typingInterval);
    }
  }
});

async function shutdown() {
  try {
    await bot.stopPolling();
  } catch (error) {
    logError(error, "shutdown");
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log("PUIJAI Telegram Bot is running...");
