const APP_VERSION = "4.0.0";
const STATE_SCHEMA = 1;
const DB_NAME = "oq-python-academy";
const DB_VERSION = 1;
const STORE_NAME = "academy";
const STATE_KEY = "progress";
const PHASES = ["teach", "check", "guided", "independent", "exam"];
const PHASE_LABELS = {
  teach: "1. Erklären",
  check: "2. Verstehen",
  guided: "3. Geführt üben",
  independent: "4. Selbstständig",
  exam: "5. Klausur",
};

let curriculum = [];
let glossary = [];
let state = null;
let db = null;
let saveTimer = null;
let currentView = "academy";
let selectedGlossaryTerm = null;
let deferredInstallPrompt = null;
let serviceWorkerRegistration = null;
let updateCheckTime = null;

const $ = (id) => document.getElementById(id);

function createDefaultState(levelCount = 10) {
  return {
    schemaVersion: STATE_SCHEMA,
    currentLevel: 0,
    currentPhase: "teach",
    maxPhaseByLevel: Array(levelCount).fill(0),
    unlockedLevel: 0,
    completedLevels: [],
    xp: 0,
    attempts: {},
    hintPositions: {},
    drafts: {},
    checkResults: {},
    examHistory: [],
    examScores: {},
    weaknesses: {},
    favorites: [],
    notes: {},
    lastSubmission: null,
    lastSavedAt: null,
  };
}

function normalizeState(input, levelCount) {
  const base = createDefaultState(levelCount);
  if (!input || typeof input !== "object") return base;

  const merged = { ...base, ...input };
  merged.schemaVersion = STATE_SCHEMA;
  merged.currentLevel = clamp(Number(merged.currentLevel) || 0, 0, levelCount - 1);
  merged.currentPhase = PHASES.includes(merged.currentPhase) ? merged.currentPhase : "teach";
  merged.unlockedLevel = clamp(Number(merged.unlockedLevel) || 0, 0, levelCount - 1);
  merged.maxPhaseByLevel = Array.isArray(merged.maxPhaseByLevel)
    ? merged.maxPhaseByLevel.slice(0, levelCount).map((value) => clamp(Number(value) || 0, 0, 4))
    : base.maxPhaseByLevel;
  while (merged.maxPhaseByLevel.length < levelCount) merged.maxPhaseByLevel.push(0);
  merged.completedLevels = Array.isArray(merged.completedLevels)
    ? [...new Set(merged.completedLevels.map(Number).filter((value) => value >= 0 && value < levelCount))]
    : [];
  merged.xp = Math.max(0, Number(merged.xp) || 0);
  merged.attempts = isPlainObject(merged.attempts) ? merged.attempts : {};
  merged.hintPositions = isPlainObject(merged.hintPositions) ? merged.hintPositions : {};
  merged.drafts = isPlainObject(merged.drafts) ? merged.drafts : {};
  merged.checkResults = isPlainObject(merged.checkResults) ? merged.checkResults : {};
  merged.examHistory = Array.isArray(merged.examHistory) ? merged.examHistory : [];
  merged.examScores = isPlainObject(merged.examScores) ? merged.examScores : {};
  merged.weaknesses = isPlainObject(merged.weaknesses) ? merged.weaknesses : {};
  merged.favorites = Array.isArray(merged.favorites) ? [...new Set(merged.favorites)] : [];
  merged.notes = isPlainObject(merged.notes) ? merged.notes : {};
  merged.lastSubmission = isPlainObject(merged.lastSubmission) ? merged.lastSubmission : null;
  return merged;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nowLabel() {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
}

function rankFromXp(xp) {
  if (state?.completedLevels?.length === curriculum.length && curriculum.length) return "Software-Architekt";
  if (xp >= 6000) return "Senior Developer";
  if (xp >= 3500) return "Developer";
  if (xp >= 1700) return "Junior Developer";
  if (xp >= 550) return "Code-Schüler";
  return "Neuling";
}

function currentMastery() {
  if (!state) return 0;
  if (state.completedLevels.includes(state.currentLevel)) return 100;
  const max = state.maxPhaseByLevel[state.currentLevel] ?? 0;
  return [10, 25, 55, 80, 90][max] ?? 0;
}

function phaseKey(phase = state.currentPhase) {
  return `${state.currentLevel}:${phase}`;
}

function currentLevelData() {
  return curriculum[state.currentLevel];
}

function currentPracticeData() {
  const level = currentLevelData();
  return state.currentPhase === "guided" ? level.guided : level.independent;
}

async function openDatabase() {
  if (!("indexedDB" in window)) return null;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadState() {
  try {
    db = await openDatabase();
    if (db) {
      const stored = await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (stored) return stored;
    }
  } catch (error) {
    console.warn("IndexedDB konnte nicht gelesen werden:", error);
  }

  try {
    const fallback = localStorage.getItem(STATE_KEY);
    return fallback ? JSON.parse(fallback) : null;
  } catch (error) {
    console.warn("Fallback-Speicher konnte nicht gelesen werden:", error);
    return null;
  }
}

async function persistState() {
  if (!state) return;
  state.lastSavedAt = new Date().toISOString();
  setSaveIndicator("Speichert …", "");

  try {
    if (db) {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(structuredClone(state), STATE_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } else {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    }
    setSaveIndicator(`Gespeichert · ${nowLabel()}`, "saved");
  } catch (error) {
    console.error("Speichern fehlgeschlagen:", error);
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      setSaveIndicator(`Lokal gespeichert · ${nowLabel()}`, "saved");
    } catch (fallbackError) {
      console.error("Fallback-Speichern fehlgeschlagen:", fallbackError);
      setSaveIndicator("Speichern fehlgeschlagen", "error");
    }
  }
}

function scheduleSave(delay = 250) {
  clearTimeout(saveTimer);
  setSaveIndicator("Änderungen …", "");
  saveTimer = setTimeout(() => persistState(), delay);
}

function setSaveIndicator(text, statusClass) {
  const indicator = $("saveIndicator");
  indicator.textContent = text;
  indicator.className = `status-pill ${statusClass}`.trim();
}

async function loadContent() {
  const versionToken = encodeURIComponent(APP_VERSION);
  const [curriculumResponse, glossaryResponse] = await Promise.all([
    fetch(`./data/curriculum.json?v=${versionToken}`),
    fetch(`./data/glossary.json?v=${versionToken}`),
  ]);

  if (!curriculumResponse.ok || !glossaryResponse.ok) {
    throw new Error("Unterrichtsdaten konnten nicht geladen werden.");
  }

  const curriculumData = await curriculumResponse.json();
  const glossaryData = await glossaryResponse.json();
  curriculum = curriculumData.levels;
  glossary = glossaryData.terms;
}

function teacher(message, status = "Unterricht") {
  $("teacherMessage").innerHTML = message;
  $("teacherStatus").textContent = status;
}

function updateMetrics() {
  const level = currentLevelData();
  $("metricLevel").textContent = String(state.currentLevel + 1);
  $("metricLevelName").textContent = level?.title ?? "–";
  $("metricPhase").textContent = PHASE_LABELS[state.currentPhase].replace(/^\d\.\s/, "");
  $("metricMastery").textContent = `${currentMastery()} %`;
  $("masteryBar").style.width = `${currentMastery()}%`;
  $("metricRank").textContent = rankFromXp(state.xp);
  $("metricXp").textContent = `${state.xp} XP`;
  renderLevelMap();
  renderPhaseNavigation();
  renderProgressView();
}

function renderLevelMap() {
  const container = $("levelMap");
  container.innerHTML = curriculum.map((level, index) => {
    const locked = index > state.unlockedLevel;
    const completed = state.completedLevels.includes(index);
    const active = index === state.currentLevel;
    const icon = locked ? "🔒" : completed ? "✅" : active ? "▶" : "○";
    return `
      <button type="button" class="level-button ${active ? "active" : ""}" data-level="${index}" ${locked ? "disabled" : ""}>
        <div class="level-topline"><span>${icon} Level ${index + 1}</span><span>${completed ? "Bestanden" : ""}</span></div>
        <div class="level-name">${escapeHtml(level.title)}</div>
      </button>`;
  }).join("");

  container.querySelectorAll("[data-level]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = Number(button.dataset.level);
      if (target > state.unlockedLevel) return;
      state.currentLevel = target;
      const maxPhase = state.maxPhaseByLevel[target] ?? 0;
      state.currentPhase = PHASES[Math.min(maxPhase, 4)];
      state.lastSubmission = null;
      scheduleSave();
      showPhase(state.currentPhase);
    });
  });
}

function renderPhaseNavigation() {
  const container = $("phaseNavigation");
  const max = state.maxPhaseByLevel[state.currentLevel] ?? 0;
  const levelCompleted = state.completedLevels.includes(state.currentLevel);
  container.innerHTML = PHASES.map((phase, index) => {
    const unlocked = levelCompleted || index <= max;
    return `
      <button type="button" class="phase-button ${phase === state.currentPhase ? "active" : ""}" data-phase="${phase}" ${unlocked ? "" : "disabled"}>
        ${unlocked ? "○" : "🔒"} ${PHASE_LABELS[phase]}
      </button>`;
  }).join("");

  container.querySelectorAll("[data-phase]").forEach((button) => {
    button.addEventListener("click", () => {
      const phase = button.dataset.phase;
      const index = PHASES.indexOf(phase);
      if (index <= max || levelCompleted) showPhase(phase);
    });
  });
}

function hidePhasePanels() {
  ["lessonPanel", "checkPanel", "practicePanel", "submissionPanel", "examPanel"].forEach((id) => $(id).classList.add("hidden"));
}

function showPhase(phase) {
  state.currentPhase = phase;
  state.lastSubmission = null;
  hidePhasePanels();
  if (phase === "teach") renderLesson();
  if (phase === "check") renderKnowledgeCheck();
  if (phase === "guided" || phase === "independent") renderPractice();
  if (phase === "exam") renderExam();
  updateMetrics();
  scheduleSave();
}

function renderLesson() {
  const level = currentLevelData();
  const panel = $("lessonPanel");
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="lesson-header">
      <div>
        <div class="eyebrow">Level ${state.currentLevel + 1} · Vollständige Unterrichtseinheit</div>
        <h1 class="large-title">${escapeHtml(level.title)}</h1>
        <p class="muted">${escapeHtml(level.summary)}</p>
      </div>
      <span class="badge">Erklärung</span>
    </div>
    <div class="objective-box">
      <strong>Nach dieser Einheit kannst du:</strong>
      <ul class="objective-list">${level.objectives.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
    <div class="lesson-sections">
      ${level.sections.map((section, index) => `
        <article class="lesson-section">
          <div class="section-title-row"><span class="section-number">${index + 1}</span><h2>${escapeHtml(section.title)}</h2></div>
          <p>${escapeHtml(section.body)}</p>
        </article>`).join("")}
    </div>
    <div class="code-box">
      <div class="code-caption">Vollständig erklärtes Beispiel</div>
      <pre>${escapeHtml(level.example)}</pre>
      <ul class="example-notes">${level.exampleNotes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
    <div class="form-footer">
      <span class="muted small">Die folgende Kontrolle enthält ausschließlich Inhalte aus dieser Erklärung.</span>
      <button id="finishLessonButton" class="button primary" type="button">Zur Verständniskontrolle</button>
    </div>`;

  $("finishLessonButton").addEventListener("click", () => {
    state.maxPhaseByLevel[state.currentLevel] = Math.max(state.maxPhaseByLevel[state.currentLevel], 1);
    state.xp += 25;
    showPhase("check");
  });

  teacher(`Wir behandeln jeden Begriff, der später in Level ${state.currentLevel + 1} abgefragt wird. Lies die Abschnitte und gehe das Beispiel Zeile für Zeile durch.`, "Erklärung");
}

function renderKnowledgeCheck() {
  const level = currentLevelData();
  const panel = $("checkPanel");
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="lesson-header">
      <div><div class="eyebrow">Verständniskontrolle</div><h1 class="large-title">Erst verstehen, dann programmieren</h1></div>
      <span class="badge">100 % nötig</span>
    </div>
    <div class="question-list">
      ${level.check.map((question, questionIndex) => `
        <fieldset class="question-card">
          <legend>${questionIndex + 1}. ${escapeHtml(question.question)}</legend>
          <div class="option-list">
            ${question.options.map((option, optionIndex) => `
              <label class="option-row">
                <input type="radio" name="check-${questionIndex}" value="${optionIndex}">
                <span>${escapeHtml(option)}</span>
              </label>`).join("")}
          </div>
          <div id="checkExplanation-${questionIndex}" class="explanation hidden"></div>
        </fieldset>`).join("")}
    </div>
    <div id="checkSummary" class="result-box hidden"></div>
    <div class="form-footer">
      <button id="backToLessonButton" class="button secondary" type="button">Zur Erklärung</button>
      <button id="submitCheckButton" class="button primary" type="button">Antworten prüfen</button>
    </div>`;

  $("backToLessonButton").addEventListener("click", () => showPhase("teach"));
  $("submitCheckButton").addEventListener("click", submitKnowledgeCheck);
  teacher("Diese Fragen prüfen nur Stoff, der direkt zuvor erklärt wurde. Falsche Antworten erhalten sofort die passende Begründung.", "Verständniskontrolle");
}

function submitKnowledgeCheck() {
  const level = currentLevelData();
  let correct = 0;
  let answered = 0;

  level.check.forEach((question, index) => {
    const selected = document.querySelector(`input[name="check-${index}"]:checked`);
    if (selected) answered += 1;
    const isCorrect = selected && Number(selected.value) === question.answer;
    if (isCorrect) correct += 1;
    const explanation = $(`checkExplanation-${index}`);
    explanation.classList.remove("hidden", "correct", "incorrect");
    explanation.classList.add(isCorrect ? "correct" : "incorrect");
    explanation.textContent = isCorrect
      ? `✅ Richtig. ${question.explanation}`
      : `❌ Richtig ist: ${question.options[question.answer]}. ${question.explanation}`;
  });

  const percent = Math.round((correct / level.check.length) * 100);
  const summary = $("checkSummary");
  summary.classList.remove("hidden");
  summary.innerHTML = `
    <strong>${percent === 100 ? "✅ Verständnis bestätigt" : "📚 Noch einmal festigen"}: ${percent} %</strong>
    <p class="muted small">${answered} von ${level.check.length} Fragen beantwortet. Für die geführte Praxis müssen alle Antworten richtig sein.</p>
    ${percent === 100 ? '<button id="openGuidedButton" class="button primary" type="button">Geführte Übung öffnen</button>' : ""}`;

  state.checkResults[state.currentLevel] = { percent, at: new Date().toISOString() };
  if (percent === 100) {
    const wasLocked = state.maxPhaseByLevel[state.currentLevel] < 2;
    state.maxPhaseByLevel[state.currentLevel] = Math.max(state.maxPhaseByLevel[state.currentLevel], 2);
    if (wasLocked) state.xp += 50;
    $("openGuidedButton").addEventListener("click", () => showPhase("guided"));
    teacher("Alle Grundlagen sitzen. Die geführte Übung ist jetzt freigeschaltet.", "Bestanden");
  } else {
    teacher("Noch nicht alle Grundlagen sitzen. Lies die roten Erklärungen und gehe bei Bedarf über die Phasennavigation zurück zum Unterricht.", "Nachunterricht");
  }
  updateMetrics();
  scheduleSave();
}

function renderPractice() {
  const practice = currentPracticeData();
  const key = phaseKey();
  const panel = $("practicePanel");
  const draft = state.drafts[key] ?? practice.starter;
  const attempts = state.attempts[key] ?? 0;
  const hintPosition = clamp(Number(state.hintPositions[key]) || 0, 0, practice.hints.length - 1);
  state.hintPositions[key] = hintPosition;

  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="practice-header">
      <div>
        <div class="eyebrow">${state.currentPhase === "guided" ? "Geführte Unterrichtsaufgabe" : "Selbstständige Transferaufgabe"}</div>
        <h1 class="large-title">${escapeHtml(practice.title)}</h1>
      </div>
      <span class="badge">Versuch ${attempts + 1}</span>
    </div>
    <p>${escapeHtml(practice.task)}</p>
    <div class="allowed-box"><strong>Zulässiges Wissen</strong><p class="muted small">${escapeHtml(practice.allowed)}</p></div>
    <div class="requirements-box"><strong>Anforderungen</strong><ul class="requirements-list">${practice.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    <label class="field-label" for="codeEditor">Dein Python-Code</label>
    <textarea id="codeEditor" class="text-input code-editor" spellcheck="false">${escapeHtml(draft)}</textarea>
    <div class="button-row">
      <button id="evaluatePracticeButton" class="button primary" type="button">Code auswerten</button>
      <button id="openHintsButton" class="button secondary" type="button">💡 Hinweise</button>
      <button id="resetCodeButton" class="button secondary" type="button">Zurücksetzen</button>
    </div>
    <section id="hintPanel" class="hint-panel hidden">
      <div class="hint-nav">
        <div><div class="muted small">Lehrerhinweis</div><strong id="hintCounter"></strong></div>
        <div class="button-row">
          <button id="previousHintButton" class="button secondary" type="button">← Vorheriger</button>
          <button id="nextHintButton" class="button secondary" type="button">Nächster →</button>
        </div>
      </div>
      <div id="hintText" class="hint-text"></div>
    </section>`;

  const editor = $("codeEditor");
  editor.addEventListener("input", () => {
    state.drafts[key] = editor.value;
    scheduleSave(400);
  });
  editor.addEventListener("keydown", handleEditorTab);
  $("evaluatePracticeButton").addEventListener("click", evaluatePractice);
  $("openHintsButton").addEventListener("click", () => {
    $("hintPanel").classList.remove("hidden");
    updateHintPanel();
  });
  $("previousHintButton").addEventListener("click", () => changeHint(-1));
  $("nextHintButton").addEventListener("click", () => changeHint(1));
  $("resetCodeButton").addEventListener("click", () => {
    state.drafts[key] = practice.starter;
    editor.value = practice.starter;
    scheduleSave();
  });
  updateHintPanel();

  teacher(
    state.currentPhase === "guided"
      ? "Löse die Aufgabe mit Vorlage und gestuften Hinweisen. Nach der Abgabe bleiben Code, Ausgabevorschau und Korrektur sichtbar."
      : "Übertrage den Stoff jetzt ohne Vorlage. Ein Wechsel zur Klausur geschieht erst, nachdem du deine bestandene Abgabe selbst geprüft und bestätigt hast.",
    state.currentPhase === "guided" ? "Geführte Praxis" : "Transfer",
  );
}

function handleEditorTab(event) {
  if (event.key !== "Tab") return;
  event.preventDefault();
  const textarea = event.currentTarget;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = `${textarea.value.slice(0, start)}    ${textarea.value.slice(end)}`;
  textarea.selectionStart = textarea.selectionEnd = start + 4;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function updateHintPanel() {
  const panel = $("hintPanel");
  if (!panel) return;
  const practice = currentPracticeData();
  const key = phaseKey();
  const index = clamp(Number(state.hintPositions[key]) || 0, 0, practice.hints.length - 1);
  state.hintPositions[key] = index;
  $("hintCounter").textContent = `Hinweis ${index + 1} von ${practice.hints.length}`;
  $("hintText").textContent = practice.hints[index];
  $("previousHintButton").disabled = index === 0;
  $("nextHintButton").disabled = index === practice.hints.length - 1;
}

function changeHint(direction) {
  const practice = currentPracticeData();
  const key = phaseKey();
  const current = Number(state.hintPositions[key]) || 0;
  state.hintPositions[key] = clamp(current + direction, 0, practice.hints.length - 1);
  updateHintPanel();
  scheduleSave();
}

function runStructuralTests(code, tests) {
  return tests.map((test) => {
    let passed = false;
    try {
      passed = new RegExp(test.pattern, "i").test(code);
    } catch (error) {
      console.error("Ungültiger Testausdruck:", test, error);
    }
    return { label: test.label, passed };
  });
}

function evaluatePractice() {
  const practice = currentPracticeData();
  const key = phaseKey();
  const code = $("codeEditor").value;
  state.drafts[key] = code;
  state.attempts[key] = (state.attempts[key] ?? 0) + 1;
  const tests = runStructuralTests(code, practice.tests);
  const passedCount = tests.filter((test) => test.passed).length;
  const percent = Math.round((passedCount / tests.length) * 100);
  const passed = passedCount === tests.length;

  updateWeaknesses(tests);
  state.lastSubmission = {
    type: state.currentPhase,
    level: state.currentLevel,
    title: practice.title,
    code,
    output: previewPythonOutput(code),
    tests,
    percent,
    passed,
    createdAt: new Date().toISOString(),
  };
  scheduleSave();
  renderSubmission();
}

function updateWeaknesses(tests) {
  tests.filter((test) => !test.passed).forEach((test) => {
    state.weaknesses[test.label] = (state.weaknesses[test.label] ?? 0) + 1;
  });
}

function previewPythonOutput(code) {
  const lines = code.split(/\r?\n/);
  const variables = {};
  const output = [];
  let advancedDetected = false;

  function evaluateValue(raw) {
    const expression = raw.trim();
    if (/^["'][\s\S]*["']$/.test(expression)) return expression.slice(1, -1);
    if (/^-?\d+(\.\d+)?$/.test(expression)) return Number(expression);
    if (expression === "True") return true;
    if (expression === "False") return false;
    if (expression === "None") return null;
    if (Object.prototype.hasOwnProperty.call(variables, expression)) return variables[expression];

    const safeExpression = expression.replace(/\b[A-Za-z_]\w*\b/g, (name) => {
      if (Object.prototype.hasOwnProperty.call(variables, name) && typeof variables[name] === "number") {
        return String(variables[name]);
      }
      return name;
    });
    if (/^[\d\s+\-*/%.()]+$/.test(safeExpression)) {
      try {
        // Only arithmetic characters are accepted by the guard above.
        return Function(`"use strict"; return (${safeExpression});`)();
      } catch {
        return `[nicht berechenbar: ${expression}]`;
      }
    }

    const fString = expression.match(/^f(["'])([\s\S]*)\1$/);
    if (fString) {
      return fString[2].replace(/\{(\w+)\}/g, (_, name) => String(variables[name] ?? `{${name}}`));
    }
    return `[nicht sicher simulierbar: ${expression}]`;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^(def|class|for|while|if|elif|else|try|except|with|import|from|async|await)\b/.test(line)) {
      advancedDetected = true;
    }

    const assignment = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (assignment && !line.includes("==")) {
      variables[assignment[1]] = evaluateValue(assignment[2]);
      continue;
    }

    const augmented = line.match(/^(\w+)\s*\+=\s*(.+)$/);
    if (augmented && Object.prototype.hasOwnProperty.call(variables, augmented[1])) {
      const addition = evaluateValue(augmented[2]);
      if (typeof variables[augmented[1]] === "number" && typeof addition === "number") {
        variables[augmented[1]] += addition;
      }
      continue;
    }

    const printMatch = line.match(/^print\s*\((.*)\)$/);
    if (printMatch) {
      const parts = splitArguments(printMatch[1]).map((part) => evaluateValue(part));
      output.push(parts.map(formatPreviewValue).join(" "));
    }
  }

  if (output.length) {
    return {
      text: output.join("\n"),
      mode: advancedDetected ? "partial" : "simple",
      note: advancedDetected
        ? "Teilweise Vorschau: Komplexe Kontrollflüsse werden in dieser Basisversion nicht nativ ausgeführt."
        : "Vorschau einfacher Zuweisungen, Rechnungen und print()-Ausgaben.",
    };
  }

  if (advancedDetected) {
    return {
      text: "Keine direkte Terminalausgabe erkannt. Der Code definiert oder steuert komplexere Abläufe.",
      mode: "definition",
      note: "Die Basisversion führt Python nicht nativ im Browser aus. Eine spätere Pyodide-Erweiterung kann echte Ausführung ergänzen.",
    };
  }

  return {
    text: "Keine sichtbare print()-Ausgabe erkannt.",
    mode: "none",
    note: "Funktionen liefern möglicherweise Werte zurück, ohne sie im Terminal anzuzeigen.",
  };
}

function splitArguments(text) {
  const parts = [];
  let current = "";
  let quote = null;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      current += character;
      if (character === quote && text[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function formatPreviewValue(value) {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  return String(value);
}

function renderSubmission() {
  const submission = state.lastSubmission;
  if (!submission) {
    showPhase(state.currentPhase);
    return;
  }
  hidePhasePanels();
  const panel = $("submissionPanel");
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="submission-header">
      <div><div class="eyebrow">Abgabeprotokoll</div><h1 class="large-title">${escapeHtml(submission.title)}</h1></div>
      <div><div class="score-large">${submission.percent} %</div><span class="badge">${submission.passed ? "Bestanden" : "Überarbeiten"}</span></div>
    </div>
    <div class="submission-grid">
      <div class="code-box">
        <div class="code-caption">Deine Abgabe</div>
        <pre>${escapeHtml(submission.code || "(keine Eingabe)")}</pre>
      </div>
      <div class="output-box">
        <div class="code-caption">Ausgabevorschau</div>
        <pre>${escapeHtml(submission.output?.text ?? "Keine Ausgabe")}</pre>
        <p class="muted small">${escapeHtml(submission.output?.note ?? "")}</p>
      </div>
    </div>
    <div class="result-box">
      <strong>Automatische Prüfungen</strong>
      <div class="test-list">
        ${submission.tests.map((test) => `<div class="test-row ${test.passed ? "pass" : "fail"}"><span>${test.passed ? "✅" : "❌"}</span><span>${escapeHtml(test.label)}</span></div>`).join("")}
      </div>
    </div>
    <div class="result-box">
      <strong>Lehrerbewertung</strong>
      <p>${submission.passed
        ? "Alle vorgesehenen Anforderungen sind erfüllt. Prüfe Code und Ausgabevorschau in Ruhe. Erst dein Klick auf Weiter schaltet die nächste Phase frei."
        : "Die rot markierten Anforderungen fehlen oder wurden von der Strukturprüfung nicht erkannt. Überarbeite den Code und gib ihn erneut ab."}</p>
    </div>
    <div class="form-footer">
      <button id="returnToSubmissionCodeButton" class="button secondary" type="button">Code überarbeiten</button>
      <button id="continueSubmissionButton" class="button primary" type="button" ${submission.passed ? "" : "disabled"}>Weiter</button>
    </div>`;

  $("returnToSubmissionCodeButton").addEventListener("click", returnFromSubmission);
  $("continueSubmissionButton").addEventListener("click", continueAfterSubmission);
  updateMetrics();
  teacher(
    "Deine Abgabe wurde angehalten. Prüfe jetzt den vollständigen Code, die Ausgabevorschau und jede einzelne Anforderung. Es findet kein automatischer Wechsel statt.",
    submission.passed ? "Abgabe bestanden" : "Korrektur",
  );
}

function returnFromSubmission() {
  const submission = state.lastSubmission;
  if (!submission) return;
  const targetPhase = submission.type === "exam" ? "exam" : submission.type;
  state.currentPhase = targetPhase;
  const savedCode = submission.code;
  state.lastSubmission = null;
  if (targetPhase === "exam") {
    const key = phaseKey("exam");
    const draft = state.drafts[key] ?? {};
    state.drafts[key] = { ...draft, code: savedCode };
  } else {
    state.drafts[phaseKey(targetPhase)] = savedCode;
  }
  showPhase(targetPhase);
}

function continueAfterSubmission() {
  const submission = state.lastSubmission;
  if (!submission?.passed) return;

  if (submission.type === "guided") {
    const firstUnlock = state.maxPhaseByLevel[state.currentLevel] < 3;
    state.maxPhaseByLevel[state.currentLevel] = Math.max(state.maxPhaseByLevel[state.currentLevel], 3);
    if (firstUnlock) state.xp += 125;
    state.lastSubmission = null;
    showPhase("independent");
    return;
  }

  if (submission.type === "independent") {
    const firstUnlock = state.maxPhaseByLevel[state.currentLevel] < 4;
    state.maxPhaseByLevel[state.currentLevel] = Math.max(state.maxPhaseByLevel[state.currentLevel], 4);
    if (firstUnlock) state.xp += 200;
    state.lastSubmission = null;
    showPhase("exam");
    return;
  }

  if (submission.type === "exam") {
    const levelIndex = state.currentLevel;
    if (!state.completedLevels.includes(levelIndex)) {
      state.completedLevels.push(levelIndex);
      state.xp += 400 + levelIndex * 50;
    }
    state.maxPhaseByLevel[levelIndex] = 4;
    state.unlockedLevel = Math.max(state.unlockedLevel, Math.min(curriculum.length - 1, levelIndex + 1));
    state.lastSubmission = null;
    scheduleSave();
    updateMetrics();

    if (levelIndex < curriculum.length - 1) {
      teacher(`Level ${levelIndex + 1} ist bestanden. Level ${levelIndex + 2} wurde freigeschaltet.`, "Levelaufstieg");
      state.currentLevel = levelIndex + 1;
      state.currentPhase = "teach";
      showPhase("teach");
    } else {
      teacher("Du hast die Masterprüfung bestanden und den vollständigen Lernpfad abgeschlossen.", "Master-Abschluss");
      showPhase("exam");
    }
  }
}

function renderExam() {
  const level = currentLevelData();
  const exam = level.exam;
  const key = phaseKey("exam");
  const draft = isPlainObject(state.drafts[key]) ? state.drafts[key] : { code: "", answers: {} };
  const panel = $("examPanel");
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="exam-header">
      <div>
        <div class="eyebrow">Level-Abschlussklausur</div>
        <h1 class="large-title">Level ${state.currentLevel + 1}: ${escapeHtml(level.title)}</h1>
        <p class="muted">Theorie zählt 40 %, die Programmieraufgabe 60 %. Bestehensgrenze: 80 %.</p>
      </div>
      <span class="badge">Keine Hinweise</span>
    </div>
    <div class="question-list">
      ${exam.questions.map((question, questionIndex) => `
        <fieldset class="question-card">
          <legend>${questionIndex + 1}. ${escapeHtml(question.question)}</legend>
          <div class="option-list">
            ${question.options.map((option, optionIndex) => `
              <label class="option-row">
                <input type="radio" name="exam-${questionIndex}" value="${optionIndex}" ${Number(draft.answers?.[questionIndex]) === optionIndex ? "checked" : ""}>
                <span>${escapeHtml(option)}</span>
              </label>`).join("")}
          </div>
        </fieldset>`).join("")}
    </div>
    <div class="requirements-box">
      <div class="eyebrow">Programmieraufgabe</div>
      <h2>${escapeHtml(exam.title)}</h2>
      <p>${escapeHtml(exam.task)}</p>
      <strong>Anforderungen</strong>
      <ul class="requirements-list">${exam.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
    <label class="field-label" for="examEditor">Dein Klausurcode</label>
    <textarea id="examEditor" class="text-input code-editor" spellcheck="false">${escapeHtml(draft.code ?? "")}</textarea>
    <div class="form-footer">
      <span class="muted small">Nach der Abgabe siehst du Code, Ausgabevorschau und Bewertung, bevor ein Levelaufstieg erfolgt.</span>
      <button id="evaluateExamButton" class="button primary" type="button">Klausur auswerten</button>
    </div>`;

  $("examEditor").addEventListener("input", saveExamDraft);
  $("examEditor").addEventListener("keydown", handleEditorTab);
  panel.querySelectorAll('input[type="radio"]').forEach((input) => input.addEventListener("change", saveExamDraft));
  $("evaluateExamButton").addEventListener("click", evaluateExam);
  teacher("Die Klausur enthält ausschließlich Inhalte dieses und früherer Level. Nach der Abgabe bleibt die vollständige Auswertung sichtbar.", "Prüfungsaufsicht");
}

function saveExamDraft() {
  const key = phaseKey("exam");
  const answers = {};
  currentLevelData().exam.questions.forEach((_, index) => {
    const selected = document.querySelector(`input[name="exam-${index}"]:checked`);
    if (selected) answers[index] = Number(selected.value);
  });
  state.drafts[key] = {
    code: $("examEditor")?.value ?? state.drafts[key]?.code ?? "",
    answers,
  };
  scheduleSave(400);
}

function evaluateExam() {
  saveExamDraft();
  const level = currentLevelData();
  const exam = level.exam;
  const draft = state.drafts[phaseKey("exam")];
  let theoryCorrect = 0;
  exam.questions.forEach((question, index) => {
    if (Number(draft.answers?.[index]) === question.answer) theoryCorrect += 1;
  });

  const tests = runStructuralTests(draft.code ?? "", exam.tests);
  const codeCorrect = tests.filter((test) => test.passed).length;
  const theoryPercent = (theoryCorrect / exam.questions.length) * 40;
  const codePercent = (codeCorrect / tests.length) * 60;
  const total = Math.round(theoryPercent + codePercent);
  const passed = total >= 80;
  const theoryTest = {
    label: `Theorie: ${theoryCorrect} von ${exam.questions.length} richtig`,
    passed: theoryCorrect === exam.questions.length,
  };

  updateWeaknesses(tests);
  if (theoryCorrect < exam.questions.length) {
    state.weaknesses["Theoriefragen des Levels"] = (state.weaknesses["Theoriefragen des Levels"] ?? 0) + 1;
  }

  const historyEntry = {
    level: state.currentLevel,
    score: total,
    passed,
    theoryCorrect,
    theoryTotal: exam.questions.length,
    codeCorrect,
    codeTotal: tests.length,
    at: new Date().toISOString(),
  };
  state.examHistory.push(historyEntry);
  state.examScores[state.currentLevel] = total;
  state.lastSubmission = {
    type: "exam",
    level: state.currentLevel,
    title: `Klausur Level ${state.currentLevel + 1}`,
    code: draft.code ?? "",
    output: previewPythonOutput(draft.code ?? ""),
    tests: [theoryTest, ...tests],
    percent: total,
    passed,
    createdAt: new Date().toISOString(),
  };
  scheduleSave();
  renderSubmission();
}

function addChatMessage(role, text) {
  const article = document.createElement("article");
  article.className = `chat-message ${role}`;
  const heading = document.createElement("strong");
  heading.textContent = role === "student" ? "👤 Du" : "🧑‍🏫 Lehrer";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  article.append(heading, paragraph);
  $("teacherChat").appendChild(article);
  article.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function answerStudentQuestion(question) {
  const normalized = question.toLowerCase();
  const level = currentLevelData();
  let answer;

  if (normalized.includes("code") || normalized.includes("fehler") || normalized.includes("falsch") || normalized.includes("funktioniert")) {
    if (state.currentPhase === "guided" || state.currentPhase === "independent") {
      const code = $("codeEditor")?.value ?? state.drafts[phaseKey()] ?? "";
      const tests = runStructuralTests(code, currentPracticeData().tests);
      const missing = tests.filter((test) => !test.passed).map((test) => test.label);
      answer = missing.length
        ? `Die Strukturprüfung erkennt noch nicht: ${missing.join(", ")}. Arbeite diese Punkte einzeln ab. Die Prüfung kann einen inhaltlich richtigen, aber ungewöhnlich formulierten Code übersehen.`
        : "Dein Code erfüllt alle strukturell prüfbaren Anforderungen. Prüfe zusätzlich die Ausgabevorschau und reale Randfälle.";
    } else if (state.currentPhase === "exam") {
      answer = "Während der Klausur gebe ich keine inhaltliche Lösung. Prüfe jede Anforderung einzeln und kontrolliere, ob sie sichtbar im Code umgesetzt ist.";
    } else {
      answer = "Öffne eine Übungsphase, damit ich den dortigen Code mit den Anforderungen vergleichen kann.";
    }
  } else if (normalized.includes("beispiel")) {
    answer = `Ein weiteres Ausgangsbeispiel für dieses Level:\n\n${level.example}\n\nVerändere einen Wert und sage vor dem Ausführen voraus, wie sich die Ausgabe verändert.`;
  } else if (normalized.includes("klausur") || normalized.includes("prüfung")) {
    answer = "Die Klausur prüft nur Lernziele dieses und früherer Level. Theorie zählt 40 %, Code 60 %. Ab 80 % ist sie bestanden.";
  } else if (normalized.includes("glossar")) {
    answer = "Das Glossar enthält alle 155 Begriffe. Bereits erreichte Inhalte sind als gelernt markiert; zukünftige Begriffe bleiben zum Nachschlagen sichtbar, werden im Unterricht aber noch nicht vorausgesetzt.";
  } else if (normalized.includes("speicher") || normalized.includes("fortschritt")) {
    answer = "Dein Lernstand wird nach jeder relevanten Aktion automatisch in IndexedDB unter dieser Website-Adresse gespeichert. Ein manuelles Backup ist nur optional.";
  } else if (normalized.includes("warum") || normalized.includes("erklär") || normalized.includes("verstehe") || normalized.includes("was ist")) {
    answer = `Dieses Level verfolgt diese Lernziele: ${level.objectives.join("; ")}. Nenne den konkreten Begriff oder die Codezeile, die ich noch einmal anders erklären soll.`;
  } else {
    answer = `Wir befinden uns in Level ${state.currentLevel + 1}: ${level.title}. Formuliere möglichst konkret, welcher Begriff, welche Zeile oder welcher erwartete Ablauf unklar ist.`;
  }
  setTimeout(() => addChatMessage("teacher", answer), 180);
}

function askTeacher() {
  const textarea = $("studentQuestion");
  const question = textarea.value.trim();
  if (!question) return;
  addChatMessage("student", question);
  textarea.value = "";
  answerStudentQuestion(question);
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach((element) => element.classList.add("hidden"));
  $(`${view}View`).classList.remove("hidden");
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  if (view === "glossary") renderGlossary();
  if (view === "progress") renderProgressView();
  if (view === "settings") renderSettingsView();
}

function isTermLearned(term) {
  const levelIndex = term.level - 1;
  if (levelIndex < state.currentLevel) return true;
  if (levelIndex > state.currentLevel) return state.completedLevels.includes(levelIndex);
  return (state.maxPhaseByLevel[levelIndex] ?? 0) >= 1 || state.completedLevels.includes(levelIndex);
}

function renderGlossary() {
  const categorySelect = $("glossaryCategory");
  if (!categorySelect.options.length) {
    const categories = ["Alle", ...new Set(glossary.map((term) => term.category))];
    categorySelect.innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
  }

  const query = $("glossarySearch").value.trim().toLowerCase();
  const category = categorySelect.value || "Alle";
  const visibility = $("glossaryVisibility").value;
  const filtered = glossary.filter((term) => {
    const learned = isTermLearned(term);
    const favorite = state.favorites.includes(term.term);
    const haystack = `${term.term} ${term.category} ${term.definition} ${term.example} ${term.pitfall}`.toLowerCase();
    return (!query || haystack.includes(query))
      && (category === "Alle" || term.category === category)
      && (visibility === "all"
        || (visibility === "learned" && learned)
        || (visibility === "future" && !learned)
        || (visibility === "favorites" && favorite));
  });

  $("glossaryCount").textContent = String(filtered.length);
  $("glossaryList").innerHTML = filtered.length
    ? filtered.map((term) => `
      <button type="button" class="glossary-item ${selectedGlossaryTerm === term.term ? "active" : ""}" data-term="${encodeURIComponent(term.term)}">
        <div class="glossary-term-line"><span>${escapeHtml(term.term)}</span><span>${isTermLearned(term) ? "✅" : "🔒"}</span></div>
        <div class="glossary-meta">${escapeHtml(term.category)} · Level ${term.level}</div>
      </button>`).join("")
    : '<p class="muted small">Keine passenden Begriffe gefunden.</p>';

  $("glossaryList").querySelectorAll("[data-term]").forEach((button) => {
    button.addEventListener("click", () => showGlossaryTerm(decodeURIComponent(button.dataset.term)));
  });

  if (!selectedGlossaryTerm || !filtered.some((term) => term.term === selectedGlossaryTerm)) {
    selectedGlossaryTerm = filtered[0]?.term ?? null;
  }
  if (selectedGlossaryTerm) showGlossaryTerm(selectedGlossaryTerm, false);
}

function showGlossaryTerm(termName, rerenderList = true) {
  const term = glossary.find((entry) => entry.term === termName);
  if (!term) return;
  selectedGlossaryTerm = termName;
  const learned = isTermLearned(term);
  const favorite = state.favorites.includes(termName);
  $("glossaryDetail").innerHTML = `
    <div class="glossary-title-row">
      <div><div class="eyebrow">${escapeHtml(term.category)} · Level ${term.level}</div><h1 class="large-title">${escapeHtml(term.term)}</h1></div>
      <button id="favoriteTermButton" class="button secondary" type="button">${favorite ? "★ Favorit" : "☆ Favorisieren"}</button>
    </div>
    <div class="callout ${learned ? "success" : "warning"}">
      <strong>${learned ? "Bereits gelernt" : "Späterer Lernstoff"}</strong>
      <p>${learned ? "Dieser Begriff gehört zu deinem bisher erreichten Lernstand." : "Du darfst ihn bereits nachschlagen; im Unterricht wird er erst später vorausgesetzt."}</p>
    </div>
    <section class="detail-section"><h2>Erklärung</h2><p>${escapeHtml(term.definition)}</p></section>
    <section class="detail-section code-box"><h2>Syntax oder Beispiel</h2><pre>${escapeHtml(term.example)}</pre></section>
    <section class="detail-section"><h2>Wichtiger Praxispunkt</h2><p>${escapeHtml(term.pitfall)}</p></section>
    <section class="detail-section">
      <label class="field-label" for="termNote">Persönliche Notiz</label>
      <textarea id="termNote" class="text-input note-area" placeholder="Eigene Merkhilfe …">${escapeHtml(state.notes[termName] ?? "")}</textarea>
    </section>`;

  $("favoriteTermButton").addEventListener("click", () => {
    if (state.favorites.includes(termName)) {
      state.favorites = state.favorites.filter((item) => item !== termName);
    } else {
      state.favorites.push(termName);
    }
    scheduleSave();
    showGlossaryTerm(termName);
  });
  $("termNote").addEventListener("input", (event) => {
    state.notes[termName] = event.target.value;
    scheduleSave(500);
  });
  if (rerenderList) renderGlossaryListOnly();
}

function renderGlossaryListOnly() {
  const active = selectedGlossaryTerm;
  $("glossaryList").querySelectorAll("[data-term]").forEach((button) => {
    button.classList.toggle("active", decodeURIComponent(button.dataset.term) === active);
  });
}

function renderProgressView() {
  if (!state || !glossary.length) return;
  const learnedTerms = glossary.filter(isTermLearned).length;
  $("progressCompleted").textContent = `${state.completedLevels.length} / ${curriculum.length}`;
  $("progressTerms").textContent = `${learnedTerms} / ${glossary.length}`;
  const scores = state.examHistory.map((entry) => Number(entry.score)).filter(Number.isFinite);
  $("progressAverage").textContent = scores.length
    ? `${Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)} %`
    : "–";

  $("examHistory").innerHTML = state.examHistory.length
    ? [...state.examHistory].reverse().map((entry) => `
      <article class="history-item">
        <div class="history-item-main">
          <div class="history-item-title">Level ${entry.level + 1}: ${escapeHtml(curriculum[entry.level]?.title ?? "Unbekannt")}</div>
          <div class="history-item-subtitle">${new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.at))} · Theorie ${entry.theoryCorrect}/${entry.theoryTotal} · Code ${entry.codeCorrect}/${entry.codeTotal}</div>
        </div>
        <span class="badge">${entry.score} % ${entry.passed ? "✅" : "❌"}</span>
      </article>`).join("")
    : '<p class="muted small">Noch keine Klausur abgegeben.</p>';

  const weaknesses = Object.entries(state.weaknesses).sort((a, b) => b[1] - a[1]).slice(0, 12);
  $("weaknessList").innerHTML = weaknesses.length
    ? weaknesses.map(([label, count]) => `
      <article class="history-item"><div class="history-item-title">${escapeHtml(label)}</div><span class="badge">${count}× nicht erkannt</span></article>`).join("")
    : '<p class="muted small">Noch keine Fehlerschwerpunkte erkannt.</p>';
}

function renderSettingsView() {
  $("settingsVersion").textContent = APP_VERSION;
  $("lastUpdateCheck").textContent = updateCheckTime ? new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "medium" }).format(updateCheckTime) : "Noch nicht geprüft";
}

async function exportBackup() {
  await persistState();
  const payload = {
    app: "OQ Python Academy",
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `oq-python-academy-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("backupStatus").textContent = "Backup wurde erstellt.";
}

async function importBackup(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const imported = payload.state ?? payload;
    state = normalizeState(imported, curriculum.length);
    await persistState();
    showPhase(state.currentPhase);
    renderGlossary();
    renderProgressView();
    $("backupStatus").textContent = "Backup wurde erfolgreich importiert.";
  } catch (error) {
    console.error(error);
    $("backupStatus").textContent = `Import fehlgeschlagen: ${error.message}`;
  }
}

function showConfirmation(title, text, onConfirm) {
  const dialog = $("confirmDialog");
  $("confirmTitle").textContent = title;
  $("confirmText").textContent = text;
  const handler = () => {
    if (dialog.returnValue === "confirm") onConfirm();
    dialog.removeEventListener("close", handler);
  };
  dialog.addEventListener("close", handler);
  dialog.showModal();
}

async function resetProgress() {
  state = createDefaultState(curriculum.length);
  await persistState();
  selectedGlossaryTerm = null;
  showPhase("teach");
  renderGlossary();
  renderProgressView();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  } catch (error) {
    console.warn("Service Worker konnte nicht registriert werden:", error);
  }
}

async function checkForUpdates(showNoUpdateMessage = false) {
  updateCheckTime = new Date();
  renderSettingsView();
  try {
    const response = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remote = await response.json();
    if (remote.version !== APP_VERSION) {
      $("updateBanner").classList.remove("hidden");
      $("updateText").textContent = `Installiert: ${APP_VERSION} · Neu: ${remote.version}. Dein lokaler Lernstand bleibt erhalten.`;
      await serviceWorkerRegistration?.update();
      return true;
    }
    $("updateBanner").classList.add("hidden");
    if (showNoUpdateMessage) {
      $("backupStatus").textContent = `Version ${APP_VERSION} ist aktuell.`;
      teacher(`Version ${APP_VERSION} ist aktuell.`, "Updateprüfung");
    }
    return false;
  } catch (error) {
    if (showNoUpdateMessage) {
      $("backupStatus").textContent = `Updateprüfung nicht möglich: ${error.message}`;
      teacher("Die Updateprüfung war nicht möglich. Die installierte App funktioniert weiterhin offline.", "Offline");
    }
    return false;
  }
}

async function applyUpdate() {
  $("applyUpdateButton").disabled = true;
  $("applyUpdateButton").textContent = "Aktualisiere …";
  try {
    await serviceWorkerRegistration?.update();
    if (serviceWorkerRegistration?.waiting) {
      serviceWorkerRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    setTimeout(() => window.location.reload(), 1000);
  } catch (error) {
    $("applyUpdateButton").disabled = false;
    $("applyUpdateButton").textContent = "Erneut versuchen";
  }
}

function configureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $("installButton").classList.remove("hidden");
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    $("installButton").classList.add("hidden");
  });
}

async function installApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("installButton").classList.add("hidden");
}

function updateOnlineStatus() {
  $("onlineStatus").textContent = navigator.onLine ? "Online" : "Offline · lokaler Lernstand verfügbar";
}

function bindStaticEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  $("askTeacherButton").addEventListener("click", askTeacher);
  $("studentQuestion").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      askTeacher();
    }
  });
  $("glossarySearch").addEventListener("input", renderGlossary);
  $("glossaryCategory").addEventListener("change", renderGlossary);
  $("glossaryVisibility").addEventListener("change", renderGlossary);
  $("forceSaveButton").addEventListener("click", persistState);
  $("exportBackupButton").addEventListener("click", exportBackup);
  $("importBackupInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importBackup(file);
    event.target.value = "";
  });
  $("resetProgressButton").addEventListener("click", () => {
    showConfirmation(
      "Fortschritt wirklich zurücksetzen?",
      "Alle Level, XP, Klausurergebnisse, Notizen und Favoriten werden in diesem Browser gelöscht.",
      resetProgress,
    );
  });
  $("updateButton").addEventListener("click", () => checkForUpdates(true));
  $("settingsUpdateButton").addEventListener("click", () => checkForUpdates(true));
  $("applyUpdateButton").addEventListener("click", applyUpdate);
  $("installButton").addEventListener("click", installApp);
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdates(false);
  });
}

async function init() {
  $("appVersion").textContent = APP_VERSION;
  configureInstallPrompt();
  updateOnlineStatus();
  bindStaticEvents();

  try {
    await loadContent();
    const storedState = await loadState();
    state = normalizeState(storedState, curriculum.length);
    setSaveIndicator(
      state.lastSavedAt ? `Gespeichert · ${new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date(state.lastSavedAt))}` : "Automatisches Speichern aktiv",
      "saved",
    );
    await registerServiceWorker();
    showPhase(state.currentPhase);
    renderGlossary();
    renderProgressView();
    renderSettingsView();
    switchView("academy");
    checkForUpdates(false);
    setInterval(() => checkForUpdates(false), 15 * 60 * 1000);
  } catch (error) {
    console.error(error);
    document.querySelector(".app-shell").innerHTML = `
      <section class="panel">
        <h1>Die Akademie konnte nicht gestartet werden</h1>
        <p>${escapeHtml(error.message)}</p>
        <p class="muted">Prüfe, ob alle Dateien vollständig im GitHub-Repository liegen und GitHub Pages aktiviert ist.</p>
      </section>`;
    setSaveIndicator("Startfehler", "error");
  }
}

init();
