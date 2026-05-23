#!/usr/bin/env bash
# Идемпотентный деплой на GitHub Pages.
# Можно запускать сколько угодно раз — каждый шаг безопасен если уже сделан.
set -euo pipefail

cd "$(dirname "$0")"

OWNER="trxumx"
REPO="math-support"
REPO_FULL="${OWNER}/${REPO}"

echo "→ 1. Проверяю gh auth..."
if ! gh auth status 2>&1 | grep -q "Logged in"; then
  echo "⚠  Если ругается на keyring — введи пароль от связки ключей macOS, или запусти 'gh auth login'."
fi

echo "→ 2. Убеждаюсь, что репо ${REPO_FULL} существует..."
if gh repo view "${REPO_FULL}" >/dev/null 2>&1; then
  echo "   ✓ репо уже существует"
else
  echo "   создаю public репо..."
  gh repo create "${REPO}" --public --description "SPA для подготовки к сессии по курсу 'Математическое обеспечение СППР'"
fi

echo "→ 3. Настраиваю origin..."
REMOTE_URL="https://github.com/${REPO_FULL}.git"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "${REMOTE_URL}"
else
  git remote add origin "${REMOTE_URL}"
fi
echo "   origin → $(git remote get-url origin)"

echo "→ 4. Пушу main..."
if ! git push -u origin main 2>&1; then
  echo "⚠  Push не прошёл. Возможно, на удалённом репо уже есть коммиты (README/LICENSE из веба)."
  echo "   Попробуй: git pull origin main --rebase && ./deploy.sh"
  echo "   Или, если уверен что удалённое можно затереть: git push -u origin main --force"
  exit 1
fi

echo "→ 5. Включаю GitHub Pages из ветки main, папка / (root)..."
# POST если ещё не настроен, PUT если уже настроен
if ! gh api -X POST "repos/${REPO_FULL}/pages" \
     -f "source[branch]=main" -f "source[path]=/" 2>/dev/null; then
  gh api -X PUT "repos/${REPO_FULL}/pages" \
    -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 || true
fi

PAGES_URL="https://${OWNER}.github.io/${REPO}/"
echo
echo "✓ Готово! Сайт собирается, обычно 1-2 минуты."
echo "  URL: ${PAGES_URL}"
echo
echo "Проверить статус сборки:"
echo "  gh api repos/${REPO_FULL}/pages/builds/latest --jq '.status,.error.message // \"ok\"'"
