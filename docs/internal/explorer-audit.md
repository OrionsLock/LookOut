# Explorer & CLI audit (Step 0)

**Scope:** Read-only inventory of the **Lookout** repo as of this audit, cross-checked against the **authoritative system design** in the separate spec tree.

**Authoritative spec (frozen design):** `docs/spec/ARCHITECTURE.md` (vendored into this repo).

---

## 0. Spec vs implementation (`docs/spec/ARCHITECTURE.md`)

| Topic | Spec says (`docs/spec/ARCHITECTURE.md`) | Implementation today | Verdict |
|--------|------------------------------|------------------------|---------|
| Agent loop | **Perceive → plan → act → verify**, then record step and loop (**59–89**) | Same ordering; **verify** is not a named function—**step `recordIssue` + recorder/console/network/a11y passes + `verdict` on the step** implement the intent after `act` (`explorer.ts` **300–412**) | **Aligned in behavior**, naming differs |
| Action union | Eight kinds + `TargetRef` shape (**91–115**) | `packages/types/src/index.ts` **11–20** matches the same set; `navigate` uses `z.string().url()` (stricter than spec’s plain `string`) | **Aligned** (navigate typing stricter) |
| Resolver order | data-testid → role+name → label → text → fail + **ask LLM again** (**117–125**) | `resolver.ts` **17–56** matches **1–4**; step **5** is **implicit** (next `planAction` after `resolution-failed` + minor issue) | **Aligned** on order; **LLM retry** is loop-level, not inside resolver |
| Store diagram | Under `runs/<id>/`: **trace.json**, `report.html` “self-contained”, `a11y/*.json` (**36–41**, **233–249**) | **No** `trace.json`; **Playwright `trace*.zip`** when tracing on; a11y stored as **`.json.gz`** (`store/index.ts` **501–508**); `report.html` **links** to store files (`write-report.ts` **12–15** comment) | **Diverges** on trace format and report bundling |
| SQLite | “No migrations in v0.1” (**171**) | **Migrations exist** (`store/migrations.ts` **17–88**, `uq_steps_goal_idx`) | **Diverges** (implementation ahead of that sentence) |
| Goal ids | Example implies ULID goals (**185**) | Goals are often **`${runId}_${configGoalId}`** (`orchestrator.ts` **202**) | **Diverges** from diagram example; **by design** for config binding |
| CLI commands (diagram) | `init \| run \| report \| baseline \| ci \| generate-tests` (**9–12**) | Also **`policy`**, **`heal`**, **`verify-run`**, full **`runs`** subtree (`main.ts` **1002–1311**) | **Implementation superset** |
| Who writes `report.html` | Data flow step 8: orchestrator invokes reporter (**165–166**) | **CLI** calls `writeReport` after `orch.run()` returns (`main.ts` **194–196**, **265–266**) | **Diverges** on *caller*; same artifact |
| Emitter auto-run | If `emitters.playwright` enabled, orchestrator writes specs (**166**) | Emitter is **CLI-driven** (`runs emit-playwright`, `generate-tests`); not automatic at end of every run unless user runs it | **Diverges** from spec flow; **optional manual/CI step** today |

---

## 1. Explorer loop (`@lookout/core`)

### 1.1 Perceive → plan → act → verify vs `docs/spec/ARCHITECTURE.md`

**Spec reference:** state machine **63–89** (`docs/spec/ARCHITECTURE.md`).

| Phase | Spec wording | Where it happens (Lookout repo) | Evidence |
|--------|--------------|--------------------------------|----------|
| **Perceive** | “capture screenshot + a11y tree + url” (**65**) | `packages/core/src/explorer.ts` — local async `perceive()` | **212–221** (also `title`) |
| **Plan** | LLM returns one `Action` (**69–72**) | `llm.planAction({ goal, stepHistory, perception })` | **245–246** |
| **Act** | Playwright executes action; before/after shots; network + console during (**76–78**) | `act(page, action, …)` then screenshots before/after for the step | `act` **120–187**; capture **281–285** |
| **Verify** | “did URL change? did errors appear? did assertion pass? assign verdict.” (**82–83**) | **`assert`** verdict inside `act` (`evaluateAssert` **43–80**, **181–182**); **step `verdict`** from `actResult`; **console/network/axe** issue rows after the step (**313–410**) | No separate `verify()` identifier—matches spec’s **outcomes**, inlined after `act` |

**Conclusion:** The implementation matches the **`docs/spec/ARCHITECTURE.md`** loop **semantically**. The spec draws **VERIFY** as its own box; the code implements verify as **(a)** action-level verdicts including **`assert`**, plus **(b)** passive recorder aggregation and **(c)** `recordStep` before the next **PERCEIVE**.

### 1.2 Supported `Action` kinds today

**Schema source:** `packages/types/src/index.ts` — `ActionSchema` discriminated union **11–20**.

| `kind` | In schema? | Handled in `act()` (`explorer.ts`)? |
|--------|--------------|-------------------------------------|
| `click` | Yes | Yes — **126–135** |
| `fill` | Yes | Yes — **136–145** |
| `select` | Yes | Yes — **146–155** |
| `navigate` | Yes | Yes — **156–174** (+ allowlist) |
| `wait` | Yes | Yes — **175–179** |
| `assert` | Yes | Yes — **181–182** (`evaluateAssert`) |
| `complete` | Yes | **Handled in loop**, not in `act` switch: early return **264–266**; `act` treats as no-op **184–186** |
| `stuck` | Yes | **Handled in loop**, not in `act` switch: issue + goal update **268–278**; `act` no-op **184–186** |

**Match to your list:** The codebase matches **click, fill, select, navigate, wait, assert, complete, stuck** — same eight kinds as in `ActionSchema`. **No divergence** in the enum set.

**Target shape:** `TargetRefSchema` (`types/index.ts` **3–8**) matches **`docs/spec/ARCHITECTURE.md` `TargetRef`** (**106–114**) field-for-field at the TypeScript level.

### 1.3 How `stuck` is detected

There are **three** distinct paths to a stuck goal:

1. **LLM explicitly returns `{ kind: "stuck", reason }`** — treated before `act`; records a flow issue and sets goal `stuck` (**268–278**).
2. **Step budget exhausted** — `for` loop runs `budget` times (**244**); if no `complete`/`stuck`, after the loop: issue “Goal exceeded step budget”, goal `stuck` (**416–425**).
3. **Invalid / zero budget** — upfront guard: issue + goal `stuck` without entering the loop (**225–240**).

Additionally, **`planAction` failure** sets goal **`error`**, not `stuck` (**247–260**). **`resolution-failed`** / **`error`** from `act` record issues but **do not** by themselves set goal stuck; the loop continues until budget or LLM `stuck`/`complete`.

**Conclusion:** `stuck` is **not** a single heuristic beyond “LLM said stuck” or “**hit `budget`**” (plus the zero-budget guard). There is **no** separate stuck-detector (e.g. entropy, duplicate actions) besides those.

---

## 2. Goal invocation & entry points

### 2.1 How a goal starts

1. **Orchestrator** creates a run (`store.createRun`) and goals from **config** (`config.crawl.goals` → `store.createGoal` with ids `${run.id}_${configGoal.id}`) — `packages/core/src/orchestrator.ts` **200–208**.
2. For each goal, orchestrator opens a context/page, **`page.goto(config.baseUrl, …)`** (**232–233** sequential path; similar **285–286**), then **`createExplorer({ page, goal, budget: config.crawl.maxStepsPerGoal, llm, store, … })`** and **`await explorer.run()`** — **234–244** / **287–297**.

The explorer **never** chooses the starting URL; orchestrator always navigates to **`config.baseUrl`** first. Mid-run **`navigate` actions** can change URL subject to allowlist.

### 2.2 `{ url, goal }` standalone vs CI-shaped

**CLI:**

- **`lookout run`** — `packages/cli/src/main.ts` **1020–1057** registers the command; **`cmdRun`** **132–206**.
  - Loads config from disk (**144**).
  - Optional **`--url`** overrides **`config.baseUrl`** (**150–151**).
  - Optional **`--goal <id>`** filters **`config.crawl.goals`** to the goal whose **`id`** matches (**161–167**) — this is a **config goal id** (kebab-case in schema), **not** a free-form goal string.
  - Then **dynamic import** `@lookout/core`, **`createOrchestrator`**, **`orch.run()`** (**170–187**).

- **`lookout ci`** — **1169–1201** / **`cmdCi`** **208–332**: same **`createOrchestrator` + `orch.run()``** (**223–243**), with JSON stderr, retries, JUnit — **behavioral wrapper**, not a different explorer.

**Answer:** There **is** a **standalone** path: **`lookout run`** (and anything else that calls `createOrchestrator().run()`). It is **not** `{ arbitraryUrl, arbitraryGoalText }` alone — it requires a **Lookout config file** with at least one goal; CLI can override **base URL** and **filter to one goal by id**. There is **no** `lookout explore` command today.

**Where explorer runs:** Only inside **`createOrchestrator` → `createExplorer` → `explorer.run()`** in `packages/core/src/orchestrator.ts` (**234–244**, **287–297**, **`runPool`** path **223–272** / **326**).

---

## 3. Store output (`.lookout/` and `runs/<id>/`)

### 3.1 SQLite (`runs.db`)

**Path:** `.lookout/runs.db` (sibling of `runs/`), created in `packages/store/src/index.ts` **157–158**, opened **157–159**.

**Tables (initial migration):** `packages/store/src/migrations.ts` **22–75** — `runs`, `goals`, `steps`, `issues`, `baselines`; migration **2** adds unique index `uq_steps_goal_idx` **80–86**.

**Per run:** rows in `runs` (id, timestamps, base_url, commit_sha, verdict, summary_json); `goals` for that `run_id`; `steps` per goal (`action_json`, screenshots paths, verdict, duration_ms, …); `issues` for the run.

### 3.2 Files under `.lookout/runs/<runId>/`

| Artifact | How it gets there | Code reference |
|----------|-------------------|----------------|
| **`screens/*.png`** | `putScreenshot` → `runs/<runId>/screens/<name>` | `packages/store/src/index.ts` **475–481** |
| **`a11y/*.json.gz`** | `putA11yTree` | **501–508** |
| **`report.html`** | CLI writes via `writeReport` after orchestrator success (`cmdRun` **194–196**; `cmdCi` **265–266**) | `packages/reporter/src/write-report.ts` **63–68** (path passed in by caller) |
| **`trace*.zip`** | Playwright tracing when `config.report.traceOnFailure` | `packages/core/src/orchestrator.ts` **262–268**, **316–322** (sequential vs per-goal parallel) |

**Also under `.lookout/` (not per-run id):**

- **`auth/storage.json`** — written when `credentials` auth bootstraps — `orchestrator.ts` **182–197**.
- **`baseline/*.png`** — visual regression baselines — store **532–548**; optional diff overlay names passed to `putScreenshot` for a run — `packages/analyzers/src/analyze-run.ts` **69–77**.

### 3.3 Trace shape

- **Sequential goals (`maxParallelAgents` implicit ≤1 path):** single context trace → **`.lookout/runs/<id>/trace.zip`** on failure — **316–322**.
- **Parallel goals (`runPool`):** per-goal **`trace-${goal.id}.zip`** when non-complete — **262–267**.

Export bundle lists `trace*.zip` under the run directory — `packages/store/src/run-export.ts` **12–21**, **45**.

### 3.4 Match vs `docs/spec/ARCHITECTURE.md` storage / layout

**Spec:** `docs/spec/ARCHITECTURE.md` **169–250** (SQL sketch + filesystem tree with `trace.json`, plain `a11y/*.json`, self-contained `report.html`).

**Reality (contract):** `packages/store/src/migrations.ts` **22–75** (+ migration 2 **80–86**); per-run artifacts in §3.2–3.3 above; export bundle `RunExportBundleV2` in `run-export.ts` **37–46**.

**Standing rule:** Where spec and repo disagree on **persisted shape**, **reality wins** for shipped behavior; record intentional deviations in notes per the spec’s rule at **4–5** when changing the store.

---

## 4. CLI structure (`packages/cli/src/main.ts`)

### 4.1 Line count

**1320 lines** total (file ends **1316–1319** with `main` catch + newline).

### 4.2 Registered commands

**Top-level** (`main()` **998–1311**):

| Command | Registration lines | Handler / notes |
|---------|---------------------|-----------------|
| `init` | **1002–1008** | `cmdInit` **608–644** |
| `policy` | **1010–1018** | `cmdPolicy` **569–607** |
| `run` | **1020–1057** | `cmdRun` **132–206** |
| `ci` | **1169–1201** | `cmdCi` **208–332** |
| `report` | **1203–1216** | **inline** handler (open latest `report.html`) |
| `baseline` | **1218–1225** | `cmdBaseline` **645–704** |
| `heal` | **1227–1273** | `cmdHeal` **705–910** |
| `verify-run` | **1275–1291** | `cmdVerifyRun` **938–996** |
| `generate-tests` | **1293–1311** | `cmdGenerateTests` **911–936** |

**Nested `runs` subcommand** (**1059** parent):

| Subcommand | Lines | Handler |
|------------|-------|---------|
| `runs list` | **1061–1073** | `cmdRunsList` **334–356** |
| `runs diff` | **1075–1089** | `cmdRunsDiff` **358–405** |
| `runs export` | **1091–1105** | `cmdRunsExport` **442–459** |
| `runs diagnose-flake` | **1107–1135** | `cmdRunsDiagnoseFlake` **461–551** |
| `runs parse-flake-stderr` | **1137–1143** | `cmdRunsParseFlakeStderr` **553–567** |
| `runs emit-playwright` | **1145–1167** | `cmdRunsEmitPlaywright` **407–440** |

### 4.3 Natural split points (for Step 1 refactor)

Suggested groupings aligned to **handler boundaries** above:

- **`commands/_shared.ts`** — imports already shared: `emitAuthFromConfig`, `llmClientConfig`, `createTrackedLlm`, `Telemetry` type, `formatHealMarkdown`, **`exitCodeFor` / `parseFailLevel`** (**27–130**), `buildFlakeSuspectedPayload` import site, chalk helpers as needed.
- **`commands/run.ts`** — `cmdRun`.
- **`commands/ci.ts`** — `cmdCi` + flake stderr payload (`ci-flake-diagnostics` already separate module).
- **`commands/runs/*.ts`** — one file per subcommand (`list`, `diff`, `export`, `diagnose-flake`, `parse-flake-stderr`, `emit-playwright`) + `runs/index.ts` to attach the group.
- **`commands/verify-run.ts`**, **`commands/heal.ts`**, **`commands/policy.ts`**, **`commands/init.ts`**, **`commands/baseline.ts`**, **`commands/generate-tests.ts`**.
- **`commands/report.ts`** — thin wrapper for the current inline `report` action.
- **`main.ts`** — `Command()` setup, `version`, register only (**target &lt; 200 lines** after extractions per your Step 1 plan).

**Already extracted modules** (keep importing): `packages/cli/src/ci-flake-diagnostics.ts`, `apply-heal-diff.ts`, `flake-stderr-parse.ts`.

---

## 5. Target resolver

**File:** `packages/core/src/resolver.ts` **16–59** (`resolveTarget`).

**Order implemented:**

1. **`data-testid`** — if `selectorHint` starts with `data-testid=` — **17–23**.
2. **`getByRole(role, { name })`** — if both `role` and `name` — **25–33**.
3. **`getByLabel(name)`** — if `name` only — **35–42**.
4. **`getByText(name, { exact: true })`** — **43–48**.
5. **`getByText(name)`** (substring) — **49–56**.

**“Ask LLM to retry”:** **Not in `resolver.ts`.** On unresolved target, `act` returns **`resolution-failed`** (`explorer.ts` **127–128**, etc.); the explorer **records a minor issue** (**322–333**) and **continues the loop** — the **next** `planAction` may choose a different action. So retry is **implicit via replanning**, not a dedicated resolver step.

**Match to your priority list:** **Same order** as data-testid → role → label → text; **no** explicit fifth step besides **LLM replan** on a later iteration.

---

## 6. LLM client shape (`@lookout/llm`)

### 6.1 Interface

**`LLMClient`** — `packages/llm/src/types.ts` **14–17**:

- `planAction(input: PlanInput): Promise<Result<Action, LLMError>>`
- `scoreUX(input: UXScoreInput): Promise<Result<UXScore, LLMError>>`

### 6.2 Multi-provider adapter

**`createClient`** — `packages/llm/src/client.ts` **16–51** switches on `config.provider`:

- `anthropic`, `openai`, `ollama`, `google`, `mock`

**Re-exports:** `packages/llm/src/index.ts` **1–28**.

### 6.3 Anthropic-only?

**No.** Anthropic is one of several; default **provider/model** in user-facing config schema is set in `packages/config/src/schema.ts` **97–99** (`anthropic` default, `claude-sonnet-4-5`).

### 6.4 Sprinkled through `core`?

**No.** `packages/core/src/explorer.ts` imports **`LLMClient` type only** from `@lookout/llm` (**4**). `orchestrator.ts` uses **`LLMClient` type** (**8**). All provider SDK calls live under **`packages/llm/src/*`**.

---

## 7. Reporter & emitter

### 7.1 HTML reporter vs explorer-produced runs

**`writeReport`** loads run, goals, steps, issues from the **same `Store` API** — `packages/reporter/src/write-report.ts` **19–57**, **63–68**. It does **not** branch on “CI vs interactive”. **`cmdRun`** and **`cmdCi`** both call **`writeReport`** after a successful orchestrator result (**194–196**, **265–266**).

**Conclusion:** Any run that populates the store consistently (goals/steps/issues) is consumable by the reporter. **Explorer/orchestrator** is the writer; **source of invocation does not matter**.

### 7.2 `runs emit-playwright` / `generate-tests` vs run source

**Emitter:** `packages/emitter-playwright/src/index.ts` **`emitAll`** **132–177** — loads **`goals` for `runId`**, skips any goal where **`g.status !== "complete"`**, loads **`listStepsForGoal`**, emits specs.

**No CI-only path.** The **delta** between **`lookout runs emit-playwright <runId> --out …`** (**cmdRunsEmitPlaywright** **407–440**) and **`lookout generate-tests`** (**911–936**) is **CLI-only**:

- `emit-playwright` requires explicit **`<runId>`** and **`--out`**.
- `generate-tests` defaults **latest run** and **output dir** from **`config.emitters.playwright.outDir`** if `--out` omitted (**927–934**).

**Working `.spec.ts`:** Depends on step **`verdict === "ok"`** and resolved selectors for click/fill/select (**emitter** **111–120**). Runs that never **`complete`** a goal emit **no** spec for that goal (**145–146**). That is **data-dependent**, not **workflow-dependent**.

---

## 8. Step 2 planning hint (from audit)

- **Explorer is standalone-capable** today via **`lookout run`** + config; **gap** for your desired UX is mainly **CLI naming** (`explore`) and **ergonomics** (`--goal` as id vs free-text goal, always starting from `config.baseUrl` with optional `--url` override).
- **No** storage schema change needed for a thin **`lookout explore`** if it maps onto **`createOrchestrator`** with a synthetic config or the same patterns as **`cmdRun`**.
- **`stuck`** detection is **budget + LLM explicit stuck**; closing “smarter stuck” would be **new behavior**, not wiring-only.

---

## Open Questions

1. **Should `lookout explore` accept raw goal text without a full `lookout.config`?** Current **`cmdRun`** requires goals from config (`main.ts` **161–167**). Step 2 requirements should state whether a **minimal generated config** is acceptable.
2. **Default provider for Step 2:** Repo already supports **multiple** LLM providers; your standing rules mention **Anthropic only** for a future phase — confirm whether **`lookout explore`** must **force** `anthropic` or respect **`lookout.config`**.

---

## Audit metadata

- **Audited packages:** `core`, `types`, `store`, `cli`, `llm`, `reporter`, `emitter-playwright`, `analyzers` (partial), `config` (schema snippet).
- **Tests not re-run** as part of this write-only audit document; last known state from development: full Vitest suite was green in a prior session.
