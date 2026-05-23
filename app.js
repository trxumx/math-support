/* ---------- State ---------- */
const STORAGE_KEY = "mo_sppr_progress_v1";
const THEME_KEY = "mo_sppr_theme";

const state = {
  mode: "reader",
  questions: [],
  theory: "",
  progress: {},                // { [id]: "known" | "review" | "unknown" }
  cards: {
    order: [],
    idx: 0,
    flipped: false,
    filter: "all",            // all | weak | unseen
  },
  exam: {
    phase: "start",          // start | active | results
    questions: [],
    idx: 0,
    grades: {},
    answerShown: false,
  },
};

/* ---------- Markdown / Math rendering ----------
 * Strategy: extract math segments BEFORE marked.js parses, render with KaTeX,
 * substitute placeholders back. This protects $x^*$, $a*b$, etc. from being
 * eaten as markdown italics.
 */
const KATEX_OPTS = {
  throwOnError: false,
  strict: false,
  errorColor: "#f87171",
  macros: { "\\R": "\\mathbb{R}", "\\eps": "\\varepsilon" },
};

function renderKatex(body, display) {
  try {
    return window.katex.renderToString(body, { ...KATEX_OPTS, displayMode: display });
  } catch {
    return `<span style="color:#f87171">[math: ${escapeHTML(body)}]</span>`;
  }
}

function renderMarkdown(target, text) {
  const maths = [];
  const ph = i => `xKMATHx${i}xENDx`;

  // 1. Protect $$...$$ (display)
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, body) => {
    maths.push({ display: true, body: body.trim() });
    return ph(maths.length - 1);
  });
  // 2. Protect \[...\] (display, MathJax style)
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, body) => {
    maths.push({ display: true, body: body.trim() });
    return ph(maths.length - 1);
  });
  // 3. Protect \(...\) (inline, MathJax style)
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, body) => {
    maths.push({ display: false, body: body.trim() });
    return ph(maths.length - 1);
  });
  // 4. Protect $...$ (inline). Non-greedy, can't cross blank line.
  text = text.replace(/\$([^\$\n]+?)\$/g, (_, body) => {
    maths.push({ display: false, body: body.trim() });
    return ph(maths.length - 1);
  });

  let html = window.marked.parse(text, { breaks: false, gfm: true });

  // 5. Restore math
  html = html.replace(/xKMATHx(\d+)xENDx/g, (_, idx) => {
    const m = maths[parseInt(idx)];
    return renderKatex(m.body, m.display);
  });

  target.innerHTML = html;
}

/* ---------- Progress storage ---------- */
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.progress = raw ? JSON.parse(raw) : {};
  } catch {
    state.progress = {};
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}

function setStatus(id, status) {
  if (status == null) delete state.progress[id];
  else state.progress[id] = status;
  saveProgress();
  updateProgressStats();
  updateTocStatuses();
  updateCardsStats();
  updateReaderMarkButtons();
}

function counts() {
  let known = 0, review = 0, unknown = 0;
  for (const id in state.progress) {
    if (state.progress[id] === "known") known++;
    else if (state.progress[id] === "review") review++;
    else if (state.progress[id] === "unknown") unknown++;
  }
  return { known, review, unknown };
}

/* ---------- Theme ---------- */
function applyTheme(theme) {
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = theme === "light" ? "🌙" : "☀️";
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(saved);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const next = current === "light" ? "dark" : "light";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

/* ---------- Tabs ---------- */
function initTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => switchMode(btn.dataset.mode));
  });
}

function switchMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(`view-${mode}`).classList.add("active");

  // На мобиле: ☰ показываем только в режимах с TOC
  document.body.classList.toggle("has-toc", mode === "reader" || mode === "theory");
  closeDrawer();

  if (mode === "reader" && !document.getElementById("reader-content").dataset.rendered) {
    renderReader();
  }
  if (mode === "cards" && state.cards.order.length === 0) {
    initCards();
  }
  if (mode === "theory" && !document.getElementById("theory-content").dataset.rendered) {
    renderTheory();
  }
}

/* ---------- Drawer (TOC на мобильнике) ---------- */
function openDrawer() {
  document.body.classList.add("drawer-open");
  const bd = document.getElementById("drawer-backdrop");
  bd.hidden = false;
  // force reflow so transition kicks in next frame
  void bd.offsetWidth;
  bd.classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeDrawer() {
  document.body.classList.remove("drawer-open");
  document.body.style.overflow = "";
  const bd = document.getElementById("drawer-backdrop");
  bd.classList.remove("show");
  setTimeout(() => { if (!bd.classList.contains("show")) bd.hidden = true; }, 280);
}

function initDrawer() {
  document.getElementById("menu-btn").addEventListener("click", () => {
    if (document.body.classList.contains("drawer-open")) closeDrawer();
    else openDrawer();
  });
  document.getElementById("drawer-backdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && document.body.classList.contains("drawer-open")) closeDrawer();
  });
}

/* ---------- Reader ---------- */
function renderReader() {
  renderReaderTOC(state.questions);
  const container = document.getElementById("reader-content");
  container.innerHTML = "";
  for (const q of state.questions) {
    const block = document.createElement("section");
    block.className = "reader-question";
    block.id = `q-${q.id}`;
    block.dataset.qid = q.id;
    block.innerHTML = `
      <div class="q-header">
        <span class="q-num">№${q.id}</span>
        <h2>${escapeHTML(q.title)}</h2>
        <div class="q-mark" data-qid="${q.id}">
          <button data-status="known" title="Знаю">✓</button>
          <button data-status="review" title="Повторить">⟳</button>
          <button data-status="unknown" title="Не знаю">✗</button>
        </div>
      </div>
      <div class="q-body"></div>
    `;
    container.appendChild(block);
    const body = block.querySelector(".q-body");
    renderMarkdown(body, q.content);
  }
  container.dataset.rendered = "1";
  updateReaderMarkButtons();
  bindReaderEvents();
  updateProgressStats();
  updateTocStatuses();
}

function renderReaderTOC(questions) {
  const ol = document.getElementById("reader-toc");
  ol.innerHTML = "";
  for (const q of questions) {
    const li = document.createElement("li");
    li.dataset.qid = q.id;
    li.innerHTML = `<span class="toc-num">${q.id}</span><span class="toc-text">${escapeHTML(q.title)}</span><span class="toc-status" data-qid="${q.id}"></span>`;
    li.addEventListener("click", () => {
      closeDrawer();
      // Дать drawer-у закрыться, потом скроллить
      setTimeout(() => {
        document.getElementById(`q-${q.id}`).scrollIntoView({ behavior: "smooth", block: "start" });
      }, isMobile() ? 280 : 0);
      document.querySelectorAll("#reader-toc li").forEach(x => x.classList.remove("active"));
      li.classList.add("active");
    });
    ol.appendChild(li);
  }
}

function isMobile() {
  return window.matchMedia("(max-width: 700px)").matches;
}

function bindReaderEvents() {
  document.querySelectorAll(".q-mark").forEach(group => {
    group.addEventListener("click", e => {
      const btn = e.target.closest("button[data-status]");
      if (!btn) return;
      const qid = parseInt(group.dataset.qid);
      const status = btn.dataset.status;
      const current = state.progress[qid];
      setStatus(qid, current === status ? null : status);
    });
  });

  const search = document.getElementById("reader-search");
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll("#reader-toc li").forEach(li => {
      const text = li.textContent.toLowerCase();
      li.classList.toggle("hidden", q && !text.includes(q));
    });
  });
}

function updateReaderMarkButtons() {
  document.querySelectorAll(".q-mark").forEach(group => {
    const qid = parseInt(group.dataset.qid);
    const status = state.progress[qid];
    group.querySelectorAll("button").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.status === status);
      btn.classList.remove("known", "review", "unknown");
      if (btn.dataset.status === status) btn.classList.add(status);
    });
  });
}

function updateTocStatuses() {
  document.querySelectorAll(".toc-status").forEach(el => {
    const qid = parseInt(el.dataset.qid);
    const status = state.progress[qid];
    el.className = "toc-status";
    el.textContent = "";
    if (status === "known") { el.classList.add("known"); el.textContent = "✓"; }
    else if (status === "review") { el.classList.add("review"); el.textContent = "⟳"; }
    else if (status === "unknown") { el.classList.add("unknown"); el.textContent = "✗"; }
  });
}

function updateProgressStats() {
  const total = state.questions.length;
  const seen = Object.keys(state.progress).length;
  const text = document.getElementById("toc-progress-text");
  const fill = document.getElementById("toc-progress-fill");
  if (text) text.textContent = `${seen} / ${total} изучено`;
  if (fill) fill.style.width = `${(seen / total) * 100}%`;
}

/* ---------- Theory ---------- */
function renderTheory() {
  const container = document.getElementById("theory-content");
  renderMarkdown(container, state.theory);
  container.dataset.rendered = "1";

  // Build TOC from h2/h3
  const toc = document.getElementById("theory-toc");
  toc.innerHTML = "";
  let counter = 0;
  container.querySelectorAll("h2, h3").forEach(h => {
    counter++;
    const id = `theory-h-${counter}`;
    h.id = id;
    const li = document.createElement("li");
    li.innerHTML = `<span class="toc-num">${h.tagName === "H2" ? "§" : "·"}</span><span class="toc-text">${escapeHTML(h.textContent)}</span>`;
    if (h.tagName === "H3") li.style.paddingLeft = "26px";
    li.addEventListener("click", () => {
      closeDrawer();
      setTimeout(() => {
        h.scrollIntoView({ behavior: "smooth", block: "start" });
      }, isMobile() ? 280 : 0);
      document.querySelectorAll("#theory-toc li").forEach(x => x.classList.remove("active"));
      li.classList.add("active");
    });
    toc.appendChild(li);
  });

  const search = document.getElementById("theory-search");
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll("#theory-toc li").forEach(li => {
      const text = li.textContent.toLowerCase();
      li.classList.toggle("hidden", q && !text.includes(q));
    });
  });
}

/* ---------- Cards ---------- */
function initCards() {
  state.cards.order = state.questions.map(q => q.id);
  state.cards.idx = 0;
  state.cards.flipped = false;

  const fc = document.getElementById("flashcard");
  fc.addEventListener("click", flipCard);
  attachSwipe(fc, {
    onSwipeLeft: () => moveCard(1),
    onSwipeRight: () => moveCard(-1),
  });
  document.getElementById("card-prev").addEventListener("click", () => moveCard(-1));
  document.getElementById("card-next").addEventListener("click", () => moveCard(1));
  document.getElementById("cards-shuffle").addEventListener("click", shuffleCards);
  document.getElementById("cards-reset").addEventListener("click", () => {
    if (confirm("Сбросить ВЕСЬ прогресс изучения?")) {
      state.progress = {};
      saveProgress();
      updateProgressStats();
      updateTocStatuses();
      updateCardsStats();
      updateReaderMarkButtons();
      renderCard();
    }
  });
  document.getElementById("cards-filter").addEventListener("click", cycleFilter);
  document.querySelectorAll("#grade-buttons .grade").forEach(b => {
    b.addEventListener("click", e => {
      const grade = b.dataset.grade;
      const q = currentCardQuestion();
      if (q) setStatus(q.id, grade);
      moveCard(1);
    });
  });

  renderCard();
  updateCardsStats();
}

function currentCardQuestion() {
  const id = state.cards.order[state.cards.idx];
  return state.questions.find(q => q.id === id);
}

function cycleFilter() {
  const order = ["all", "weak", "unseen"];
  const labels = { all: "Все", weak: "Слабые", unseen: "Новые" };
  const cur = state.cards.filter;
  const next = order[(order.indexOf(cur) + 1) % order.length];
  state.cards.filter = next;
  const btn = document.getElementById("cards-filter");
  btn.textContent = labels[next];
  btn.dataset.filter = next;

  let pool;
  if (next === "weak") {
    pool = state.questions.filter(q => state.progress[q.id] === "unknown" || state.progress[q.id] === "review");
  } else if (next === "unseen") {
    pool = state.questions.filter(q => !(q.id in state.progress));
  } else {
    pool = state.questions.slice();
  }
  if (pool.length === 0) {
    alert(`В фильтре «${labels[next]}» пусто. Сначала пройди карточки.`);
    state.cards.filter = "all";
    btn.textContent = "Все";
    btn.dataset.filter = "all";
    return;
  }
  state.cards.order = pool.map(q => q.id);
  state.cards.idx = 0;
  state.cards.flipped = false;
  renderCard();
}

function shuffleCards() {
  for (let i = state.cards.order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.cards.order[i], state.cards.order[j]] = [state.cards.order[j], state.cards.order[i]];
  }
  state.cards.idx = 0;
  state.cards.flipped = false;
  renderCard();
}

function moveCard(dir) {
  const len = state.cards.order.length;
  state.cards.idx = (state.cards.idx + dir + len) % len;
  state.cards.flipped = false;
  renderCard();
}

function flipCard() {
  state.cards.flipped = !state.cards.flipped;
  document.getElementById("flashcard").classList.toggle("flipped", state.cards.flipped);
  document.getElementById("grade-buttons").hidden = !state.cards.flipped;
}

function renderCard() {
  const q = currentCardQuestion();
  if (!q) return;
  document.getElementById("card-position").textContent = `${state.cards.idx + 1} / ${state.cards.order.length}`;
  document.getElementById("card-front-num").textContent = `№${q.id}`;
  document.getElementById("card-front-title").textContent = q.title;
  document.getElementById("card-back-num").textContent = `№${q.id}`;
  document.getElementById("card-back-title").textContent = q.title;
  const ans = document.getElementById("card-answer");
  renderMarkdown(ans, q.content);
  const fc = document.getElementById("flashcard");
  fc.classList.toggle("flipped", state.cards.flipped);
  document.getElementById("grade-buttons").hidden = !state.cards.flipped;
}

function updateCardsStats() {
  const c = counts();
  const k = document.getElementById("stat-known");
  const r = document.getElementById("stat-review");
  const u = document.getElementById("stat-unknown");
  if (k) k.textContent = c.known;
  if (r) r.textContent = c.review;
  if (u) u.textContent = c.unknown;
}

/* ---------- Exam ---------- */
function initExam() {
  document.getElementById("exam-start-btn").addEventListener("click", startExam);
  document.getElementById("exam-show-answer").addEventListener("click", showExamAnswer);
  document.querySelectorAll("#exam-grade .grade").forEach(b => {
    b.addEventListener("click", () => gradeExam(b.dataset.grade));
  });
  document.getElementById("exam-restart").addEventListener("click", showExamStart);
  document.getElementById("exam-review").addEventListener("click", () => {
    switchMode("cards");
    state.cards.filter = "all";
    cycleFilter();
    cycleFilter();
  });
}

function showExamStart() {
  state.exam = { phase: "start", questions: [], idx: 0, grades: {}, answerShown: false };
  document.getElementById("exam-start").hidden = false;
  document.getElementById("exam-active").hidden = true;
  document.getElementById("exam-results").hidden = true;
}

function startExam() {
  const count = parseInt(document.getElementById("exam-count").value);
  const source = document.getElementById("exam-source").value;
  let pool;
  if (source === "weak") {
    pool = state.questions.filter(q => state.progress[q.id] === "unknown" || state.progress[q.id] === "review");
  } else if (source === "unseen") {
    pool = state.questions.filter(q => !(q.id in state.progress));
  } else {
    pool = state.questions.slice();
  }
  if (pool.length === 0) {
    alert("В выбранном источнике нет вопросов");
    return;
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  state.exam.questions = pool.slice(0, Math.min(count, pool.length));
  state.exam.idx = 0;
  state.exam.grades = {};
  state.exam.phase = "active";
  state.exam.answerShown = false;
  document.getElementById("exam-start").hidden = true;
  document.getElementById("exam-active").hidden = false;
  document.getElementById("exam-results").hidden = true;
  renderExamQuestion();
}

function renderExamQuestion() {
  const q = state.exam.questions[state.exam.idx];
  document.getElementById("exam-current").textContent = state.exam.idx + 1;
  document.getElementById("exam-total").textContent = state.exam.questions.length;
  document.getElementById("exam-progress-fill").style.width = `${(state.exam.idx / state.exam.questions.length) * 100}%`;
  document.getElementById("exam-q-number").textContent = `№${q.id}`;
  document.getElementById("exam-q-title").textContent = q.title;
  document.getElementById("exam-answer").hidden = true;
  document.getElementById("exam-grade").hidden = true;
  document.getElementById("exam-show-answer").hidden = false;
  state.exam.answerShown = false;
}

function showExamAnswer() {
  const q = state.exam.questions[state.exam.idx];
  const ans = document.getElementById("exam-answer");
  renderMarkdown(ans, q.content);
  ans.hidden = false;
  document.getElementById("exam-grade").hidden = false;
  document.getElementById("exam-show-answer").hidden = true;
  state.exam.answerShown = true;
}

function gradeExam(grade) {
  const q = state.exam.questions[state.exam.idx];
  state.exam.grades[q.id] = grade;
  // Sync to global progress
  if (grade === "good") setStatus(q.id, "known");
  else if (grade === "ok") setStatus(q.id, "review");
  else setStatus(q.id, "unknown");

  if (state.exam.idx + 1 >= state.exam.questions.length) {
    showExamResults();
  } else {
    state.exam.idx++;
    renderExamQuestion();
  }
}

function showExamResults() {
  document.getElementById("exam-active").hidden = true;
  document.getElementById("exam-results").hidden = false;
  document.getElementById("exam-progress-fill").style.width = "100%";

  let good = 0, ok = 0, bad = 0;
  for (const id in state.exam.grades) {
    const g = state.exam.grades[id];
    if (g === "good") good++;
    else if (g === "ok") ok++;
    else bad++;
  }
  const total = state.exam.questions.length;
  const summary = document.getElementById("results-summary");
  summary.innerHTML = `
    <div class="stat-block good"><div class="stat-num">${good}</div><div class="stat-label">Хорошо</div></div>
    <div class="stat-block ok"><div class="stat-num">${ok}</div><div class="stat-label">Частично</div></div>
    <div class="stat-block bad"><div class="stat-num">${bad}</div><div class="stat-label">Не ответил</div></div>
  `;

  const weak = document.getElementById("results-weak");
  weak.innerHTML = "";
  const weakList = state.exam.questions.filter(q => {
    const g = state.exam.grades[q.id];
    return g === "bad" || g === "ok";
  });
  if (weakList.length === 0) {
    weak.innerHTML = `<li>🎉 Все вопросы на «хорошо» — ты молодец!</li>`;
  } else {
    for (const q of weakList) {
      const g = state.exam.grades[q.id];
      const li = document.createElement("li");
      li.className = g === "ok" ? "ok" : "";
      li.innerHTML = `<span class="rn">№${q.id}</span><span>${escapeHTML(q.title)}</span>`;
      weak.appendChild(li);
    }
  }
}

/* ---------- Keyboard ---------- */
function initKeys() {
  document.addEventListener("keydown", e => {
    if (e.target.matches("input, select, textarea")) return;
    if (state.mode === "cards") {
      if (e.key === "ArrowLeft") moveCard(-1);
      else if (e.key === "ArrowRight") moveCard(1);
      else if (e.key === " ") { e.preventDefault(); flipCard(); }
      else if (state.cards.flipped) {
        if (e.key === "1") { const q = currentCardQuestion(); if (q) setStatus(q.id, "unknown"); moveCard(1); }
        else if (e.key === "2") { const q = currentCardQuestion(); if (q) setStatus(q.id, "review"); moveCard(1); }
        else if (e.key === "3") { const q = currentCardQuestion(); if (q) setStatus(q.id, "known"); moveCard(1); }
      }
    } else if (state.mode === "exam" && state.exam.phase === "active") {
      if (e.key === " " && !state.exam.answerShown) { e.preventDefault(); showExamAnswer(); }
      else if (state.exam.answerShown) {
        if (e.key === "1") gradeExam("bad");
        else if (e.key === "2") gradeExam("ok");
        else if (e.key === "3") gradeExam("good");
      }
    }
  });
}

/* ---------- Helpers ---------- */
function escapeHTML(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Tap vs horizontal swipe — vertical scroll is allowed.
   swipeHandled flag stops the subsequent click from also firing. */
function attachSwipe(el, { onSwipeLeft, onSwipeRight, threshold = 50 } = {}) {
  let startX = 0, startY = 0, startT = 0, swipeFired = false;

  el.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
    startT = Date.now();
    swipeFired = false;
  }, { passive: true });

  el.addEventListener("touchend", e => {
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const dt = Date.now() - startT;
    if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.3 && dt < 600) {
      swipeFired = true;
      if (dx < 0 && onSwipeLeft) onSwipeLeft();
      else if (dx > 0 && onSwipeRight) onSwipeRight();
    }
  }, { passive: true });

  el.addEventListener("click", e => {
    if (swipeFired) { e.stopPropagation(); e.preventDefault(); swipeFired = false; }
  }, true);
}

/* ---------- Bootstrap ---------- */
function boot() {
  if (!window.APP_DATA) {
    document.body.innerHTML = "<p style='padding:32px;color:#f87171'>Не удалось загрузить data.js. Запусти build.py.</p>";
    return;
  }
  state.questions = window.APP_DATA.questions;
  state.theory = window.APP_DATA.theory;
  loadProgress();
  initTheme();
  initTabs();
  initDrawer();
  initExam();
  initKeys();
  renderReader();
  updateProgressStats();
  // Стартовая вьюшка — Reader, имеет TOC
  document.body.classList.add("has-toc");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
