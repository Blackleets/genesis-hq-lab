# Cómo poner Genesis HQ en internet (sin saber programar)

Tu app tiene **dos partes**:
1. **Pantalla** (React) → Vercel — gratis
2. **Cerebro** (agente + trades) → Render — gratis con limitaciones

---

## Paso 1 — GitHub (código en la nube)

Ya está en: **https://github.com/Blackleets/genesis-hq-lab**

Cada vez que alguien actualice el código, GitHub guarda la versión nueva.

---

## Paso 2 — Backend en Render (agente 24/7)

1. Entra en **https://dashboard.render.com** (cuenta gratis con GitHub).
2. Click **New +** → **Blueprint**.
3. Conecta el repo `Blackleets/genesis-hq-lab`.
4. Render lee `render.yaml` y crea el servicio `genesis-hq-backend`.
5. (Opcional) Añade `ANTHROPIC_API_KEY` en Environment si tienes clave de Claude.
6. Espera el deploy (~5 min). Copia la URL, algo como:
   `https://genesis-hq-backend.onrender.com`

Prueba en el navegador: `https://TU-URL.onrender.com/api/health`  
Debe decir `"ok": true`.

---

## Paso 3 — Frontend en Vercel (la web que ves)

1. Entra en **https://vercel.com** (cuenta gratis con GitHub).
2. **Add New Project** → importa `Blackleets/genesis-hq-lab`.
3. Framework: **Vite** (auto-detectado).
4. En **Environment Variables** añade:

   | Nombre | Valor |
   |--------|--------|
   | `VITE_API_BASE` | `https://genesis-hq-backend.onrender.com` (tu URL de Render) |

5. Click **Deploy**.

Tu web quedará en algo como: `https://genesis-hq-lab.vercel.app`

---

## Paso 4 — Probar

Abre tu URL de Vercel. Arriba debe decir **"Agente live"** (verde), no "Backend offline".

Si dice offline:
- Render puede estar dormido (plan gratis) — espera 30 s y recarga.
- Revisa que `VITE_API_BASE` en Vercel sea exactamente la URL de Render (sin `/` al final).

---

## En tu PC (desarrollo local)

```bash
npm install
npm run start
```

Abre **http://localhost:5173**

---

## Resumen

| Dónde | Qué hace | URL |
|-------|----------|-----|
| Vercel | La interfaz visual | `*.vercel.app` |
| Render | Agente, trades, SQLite | `*.onrender.com` |
| GitHub | Código fuente | github.com/Blackleets/genesis-hq-lab |

**No mueve dinero real on-chain todavía.** El agente opera con datos reales de Polymarket y guarda trades en base de datos.
