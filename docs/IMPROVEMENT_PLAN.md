# Genesis HQ — Plan de mejora

Revision honesta del estado actual y hoja de ruta priorizada. Este plan parte
del codigo y la documentacion existentes, no de aspiraciones.

---

## A. Marco de exito

La estrella norte sigue siendo `docs/VISION.md`: al abrir Genesis HQ, en menos
de 3 segundos el operador debe entender que agentes trabajan, en que trabajan y
si algo necesita atencion humana, sin depender de tablas numericas.

Por eso las mejoras se ordenan por este criterio:

1. La oficina debe representar el estado real del sistema, no un teatro local.
2. El agente debe correr de forma continua para que existan trades resueltos y
   aprendizaje acumulado.
3. La logica de capital, riesgo y SkillOpt debe tener pruebas antes de crecer.
4. Las promesas externas deben ser explicitas: paper trading en SQLite, no CLOB
   on-chain; Kalshi solo si esta configurado.

---

## B. Estado actual

### Real y funcionando

- **Frontend operativo**: React + Vite + TypeScript, oficina pixel en canvas,
  modulos de dashboard, mercados, marketing, wallet, integraciones y consola.
- **Backend local**: servidor HTTP en `server/index.mjs`, SQLite con
  `better-sqlite3`, endpoints para trading, senales, skills, marketing,
  comandos y salud.
- **Trading paper**: pipeline SCAN -> VETO -> DEBATE -> EXECUTE en
  `server/trading/workflow.mjs`, con datos reales de Polymarket y ejecucion
  persistida en SQLite.
- **Riesgo y tesoreria**: sizing, drawdown pause, metricas y vetoes en
  `server/trading/treasury.mjs`, `server/trading/riskManager.mjs` y
  `server/memory/mistakePrevention.mjs`.
- **Investigacion y memoria**: senales de noticias/HN/Reddit, lessons,
  scoring y trajectorias para SkillOpt.
- **Superficies live ya avanzadas**: dashboard, mercados, historial, marketing,
  skills y senales tienen rutas o hooks conectados al backend tras los cambios
  recientes del 2026-06-01.

### Brechas principales

1. **Dos fuentes de verdad**: la oficina HQ y el life loop visual usan
   `src/state/genesisStore.ts` + `localStorage`, mientras el agente real vive
   en SQLite y en endpoints `/api/*`. La pantalla central puede no reflejar lo
   que el backend esta haciendo.
2. **Logica critica sin tests**: no hay suite detectada para tesoreria, riesgo,
   workflow, validacion de skills ni contratos API.
3. **Operacion 24/7 fragil**: `render.yaml` existe, pero usa plan free con
   sleep. Si el proceso duerme, los markets no se resuelven a tiempo y SkillOpt
   Phase 2 no acumula ground truth.
4. **Kalshi incompleto**: sigue siendo dependiente de `KALSHI_API_KEY` y puede
   devolver vacio. La UI y la documentacion deben tratarlo como proveedor no
   configurado cuando aplique.
5. **Sin CEO/Sentinel autonomos**: `org-state` existe, pero no hay un
   `server/agents/` que supervise salud, stale trades, drawdown y prioridades.
6. **Documentacion desalineada**: `docs/MIGRATION_PLAN.md` y
   `docs/AI_HANDOFF.md` describen estados de bootstrap ya superados; `README.md`
   aun menciona versiones antiguas.

---

## C. Roadmap priorizado

### P0 — Verdad operativa en la oficina

**Objetivo:** que la pantalla principal muestre el sistema real, no solo una
simulacion local paralela.

1. **Crear un adaptador de estado live para HQ**
   - Unificar `useAgentData`, `useLiveTrading` y `genesisStore` en una capa de
     lectura que traduzca backend -> agentes visuales -> tareas visibles.
   - Mantener `genesisStore` solo para estado UI/local que no pretenda ser dato
     operativo real.
   - Mostrar estado offline explicito: "Backend offline — npm run start".

2. **Hacer que `PixelOfficeCanvas` refleje el backend**
   - Mapear trades abiertos, debates recientes, senales y org-state a
     `agent.status`, `currentTask`, burbujas y alertas visuales.
   - Si el backend esta online, los agentes clave deben derivar su estado de
     SQLite/API; si esta offline, la UI debe degradar a empty/offline state.

3. **Eliminar restos de trading simulado en el store**
   - Auditar `capital`, `positions`, `closedPositions`, `capitalHistory` y
     `tradingEngine.ts`.
   - Retirar o aislar cualquier dato local que pueda confundirse con capital,
     PnL o posiciones reales.

4. **Corregir claims de proveedores**
   - Donde Kalshi no este configurado, mostrar "Provider not configured".
   - Mantener claro que Polymarket CLOB real-money no existe todavia; la
     ejecucion actual es agent-managed en SQLite.

**Verificacion esperada:** con backend online, una accion del agente cambia el
estado visible en dashboard, mercados y oficina; con backend offline, no se
inventan agentes trabajando ni metricas.

---

### P1 — Confiabilidad de capital y API

**Objetivo:** proteger la logica que decide cuanto arriesgar, cuando vetar y que
se expone a la UI.

1. **Introducir suite de tests minima**
   - Cubrir `server/trading/treasury.mjs`: sizing, drawdown, capital available.
   - Cubrir `server/trading/riskManager.mjs`: caps, max open trades, vetoes.
   - Cubrir `server/skills/validateSkill.mjs`: bloqueo de hard constraints.
   - Cubrir `server/index.mjs`: contratos basicos de `/api/health`,
     `/api/trading/dashboard`, `/api/agent/trades`, `/api/agent/skills`.

2. **Separar test fixtures de datos vivos**
   - Crear fixtures pequenas y deterministas para trades, markets, lessons y
     skill versions.
   - Evitar depender de red externa para los tests de riesgo/capital.

3. **Definir contratos de respuesta**
   - Documentar shape de endpoints criticos en `docs/` o tipos compartidos.
   - Garantizar que los estados de error dicen la verdad: provider missing,
     backend offline, no data yet.

**Verificacion esperada:** build, lint y tests cubren los limites de riesgo que
no pueden romperse por refactor.

---

### P2 — Runtime continuo y observabilidad

**Objetivo:** que el agente pueda acumular resultados reales de forma continua y
que el operador vea si el sistema esta sano.

1. **Endurecer deploy Render/Vercel**
   - Revisar `render.yaml`: plan, branch, disco persistente, health check y
     variables sync false.
   - Confirmar que `VITE_API_BASE` apunta al backend correcto y que el frontend
     muestra estado de conexion.

2. **Agregar health operacional**
   - Extender `/api/health` con ultimo tick, uptime, ultima ejecucion de agent,
     cantidad de open trades, errores recientes y provider configuration.
   - Mostrar esos campos en una superficie pequena de operador.

3. **Registrar eventos estructurados**
   - Normalizar logs del agent runner, workflow, research, skill validation y
     command executor.
   - Registrar errores persistentes sin filtrar secretos.

4. **Definir rutina de resolucion de markets**
   - Verificar que trades abiertos se cierran cuando el mercado resuelve.
   - Hacer visible cuando un trade queda stale o no pudo resolverse.

**Verificacion esperada:** el operador puede abrir la app y saber si backend,
agent loop, DB, proveedores y aprendizaje estan vivos.

---

### P3 — CEO y Sentinel autonomos

**Objetivo:** cerrar el ciclo de coordinacion sin depender solo de comandos del
founder.

1. **Sentinel sin IA**
   - Nuevo agente determinista que lea risk metrics, open trades, last tick,
     stale trades y drawdown.
   - Debe emitir eventos y flags visibles, no ejecutar trades ni relajar riesgo.

2. **CEO orchestrator por reglas**
   - Leer capital, drawdown, win rate, senales y workload.
   - Ajustar foco de departamentos en `org-state` con reglas auditables.
   - Dejar IA como mejora posterior, no requisito inicial.

3. **Superficie de intervencion humana**
   - Mostrar alertas accionables: pausar, revisar stale trades, proveedor no
     configurado, falta de ground truth SkillOpt.
   - Evitar botones sin accion real.

**Verificacion esperada:** el sistema detecta estados anormales y los hace
legibles en la oficina sin simular autonomia que no existe.

---

### P4 — SkillOpt Phase 2 y aprendizaje

**Objetivo:** activar aprendizaje semanal cuando existan suficientes trayectorias
resueltas.

1. **Gate por datos**
   - No ejecutar optimizacion hasta tener el minimo de trades resueltos por
     agente definido en `docs/SKILLOPT_INTEGRATION.md`.
   - Mostrar progreso hacia ese umbral.

2. **Export y validation loop**
   - Consolidar `skills:export`, `skills:validate` y version ledger.
   - Rechazar cualquier skill que toque hard constraints de riesgo.

3. **Revision y rollback**
   - Registrar version, metricas, razon de aceptacion/rechazo y ruta de rollback.
   - Exponer historial de skills de forma legible en UI.

**Verificacion esperada:** ninguna skill cambia en runtime sin gate, metrica y
rollback trazable.

---

### P5 — Limpieza documental y deuda de UX

**Objetivo:** reducir friccion para humanos y futuros agentes.

1. **Actualizar documentos obsoletos**
   - Reescribir o archivar `docs/MIGRATION_PLAN.md`.
   - Mantener `docs/AI_HANDOFF.md` con estado real de rama, gaps y siguiente
     tarea.
   - Alinear `README.md` con versiones y deploy actuales.

2. **Accesibilidad y rendimiento**
   - Auditar el canvas y paneles para navegacion basica, contraste y labels.
   - Code-split si el bundle vuelve a afectar carga inicial.

3. **Inventario de modulos**
   - Revisar `src/data/moduleRegistry.ts` y marcar cada modulo como ready,
     visual-only o locked con copy honesta.

**Verificacion esperada:** un agente nuevo puede arrancar, entender estado,
ejecutar checks y no repetir trabajo viejo.

---

## D. Secuencia recomendada

1. **Primero P0.1-P0.4**: sin una oficina que diga la verdad, el resto no es
   visible.
2. **Luego P1.1-P1.3**: antes de tocar mas dinero/riesgo, crear red de tests.
3. **Despues P2.1-P2.4**: asegurar que el agente corre y acumula ground truth.
4. **Luego P3**: agregar Sentinel/CEO sobre datos ya confiables.
5. **Finalmente P4-P5**: aprendizaje avanzado y limpieza sostenida.

---

## E. Criterios de aceptacion del plan

- No hay capital, PnL, posiciones ni trades inventados en UI.
- La oficina central refleja el backend cuando esta online y muestra offline
  state cuando no lo esta.
- Los limites de riesgo criticos tienen pruebas automatizadas.
- El deploy tiene health observable y persistencia clara para SQLite.
- Kalshi y Anthropic se presentan como configurados/no configurados sin
  fallback silencioso.
- SkillOpt solo evoluciona skills con trades resueltos, validacion y rollback.

---

## F. Lo mas importante

La mejora de mayor impacto es **unificar la oficina HQ con el estado real del
backend** y despues **proteger capital/riesgo con tests**. Genesis HQ ya tiene
pantallas; ahora necesita que su pantalla principal sea una ventana fiel al
sistema operativo real.
