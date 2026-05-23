#!/usr/bin/env bash
# Запусти, когда сеть до GitHub снова стабильна и keychain разблокирован.
# Создаёт публичный репо trxumx/math-support, пушит main и включает GitHub Pages.
set -euo pipefail

cd "$(dirname "$0")"

echo "→ 1. Проверяю gh auth..."
if ! gh auth status 2>&1 | grep -q "Logged in"; then
  echo "⚠  Если ругается на keyring — введи пароль от связки ключей macOS, или запусти 'gh auth login'."
fi

echo "→ 2. Создаю репо math-support (public)..."
gh repo create math-support \
  --public \
  --source=. \
  --remote=origin \
  --description "SPA для подготовки к сессии по курсу 'Математическое обеспечение СППР'" \
  --push

echo "→ 3. Включаю GitHub Pages из ветки main, папка / (root)..."
gh api -X POST "repos/trxumx/math-support/pages" \
  -f "source[branch]=main" \
  -f "source[path]=/" 2>/dev/null || \
gh api -X PUT "repos/trxumx/math-support/pages" \
  -f "source[branch]=main" \
  -f "source[path]=/"

echo "→ 4. Готово! Через 1-2 минуты сайт будет здесь:"
echo "   https://trxumx.github.io/math-support/"
echo
echo "Проверить статус сборки можно так:"
echo "   gh api repos/trxumx/math-support/pages/builds/latest --jq '.status,.error.message'"
