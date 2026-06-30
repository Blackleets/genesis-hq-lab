# Deploy — pasos finales para dejar el sistema operando

Todo el código está listo y desplegándose solo. Solo faltan **2 cosas** que
requieren tu cuenta (no se pueden automatizar desde fuera). Cuando tengas
acceso a la computadora, sigue esto y el sistema queda funcionando.

---

## Paso 1 — Activar el backend (Railway)

El backend (servidor + agente + optimizador) se despliega automáticamente a
Railway en cada push a `feat/genesis-life-os`. Hoy NO se despliega porque falta
un secret en GitHub.

1. Abre tu repo en GitHub → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**
2. Crea este secret:
   - **Name:** `RAILWAY_TOKEN`
   - **Value:** el token de Railway que tienes en tu archivo local `.env.local`
     (línea `RAILWAY_TOKEN=...`). Si lo perdiste: Railway dashboard → tu
     proyecto → **Settings → Tokens → Create token** (tipo *project token*).
3. Dispara el deploy: GitHub → **Actions** → **Deploy to Railway** →
   **Run workflow** (o simplemente haz cualquier push a `feat/genesis-life-os`).

Cuando el workflow quede en verde, el backend está online.

---

## Paso 2 — Encender el cerebro (variables en Railway)

El backend arranca sin estas, pero NO usa Claude ni guarda datos entre
reinicios hasta configurarlas. En el dashboard de Railway → tu servicio →
pestaña **Variables**, agrega:

| Variable | Dónde obtenerla | Para qué |
|----------|-----------------|----------|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys → Create | Activa el motor de decisiones y el aprendizaje (lecciones + skills) |
| `DATABASE_URL` | Supabase → Settings → Database → Connection string (URI) | Persistencia: los trades y lo aprendido sobreviven a cada reinicio |
| `GENESIS_RUNNER_TOKEN` | el mismo valor que usan las edge functions | Auth entre componentes |
| `DB_MODE` | escribe `hybrid` | Replicación SQLite ↔ Supabase |

Opcionales (gratis, mejoran resiliencia del LLM):
- `GROQ_API_KEY` → console.groq.com
- `GEMINI_API_KEY` → aistudio.google.com/apikey

---

## Paso 3 — (opcional) Telegram para alertas

GitHub → Settings → Secrets → Actions:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Luego dispara **Supabase Deploy (edge functions)** una vez para propagarlos.

---

## Qué pasa después

1. Backend online → el agente empieza a tickear cada 5 min.
2. Tras ~10 trades cerrados, la **calibración de pesos** empieza a ajustar
   sola cada 30 min (esto aprende aunque no haya API key).
3. Con `ANTHROPIC_API_KEY` además se activan las **lecciones** (Claude analiza
   cada trade cerrado) y la **optimización de skills**.

Todo es **paper trading** (`live_mode=false`) — dinero simulado, sin riesgo real.

---

## Verificar que quedó funcionando

- Backend vivo: abre `https://<tu-backend>.railway.app/api/health` → debe
  devolver `{"ok":true,...}`.
- Aprendizaje activo: `…/api/crypto/diagnostics` → mira `training.winRate`.
- Profit actual: el mismo endpoint, campo de PnL / equity.
