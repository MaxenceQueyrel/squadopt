<h1 align="center">
  <img src="docs/assets/squadopt-logo.svg" alt="SquadOpt" width="460">
</h1>

<p align="center"><em>Prescriptive analytics engine for team formation — blending HR management with Operations Research.</em></p>

Instead of guessing who works best where, SquadOpt treats team formation as a **multi-objective MILP**: it allocates each person's time, in 0.2-FTE steps, to the skills a project needs, and lets managers tune objective weights to reflect their priorities.

What the app covers:

- **Organizations** — every person, project, team, skill, role and assignment belongs to an organization; users create organizations and add registered users as members by email.
- **People** — skills and levels, growth targets, preferences, affinities, weekly working pattern, vacations and availability windows, CSV import/export, and a capacity timeline.
- **Projects** — per-skill FTE needs, optional phases, forced inclusions, exclusions, squads, an optional flexible start window, and CSV import/export.
- **Optimization** — an optimal team plus ranked alternatives, a coverage breakdown, an infeasibility report naming the conflicting constraints, and a batch mode that staffs several projects jointly by priority.
- **Staffing** — applying a proposed team replaces the project's assignments, which then count as committed load for every other project.

---

## Repository layout

```
squadopt/
├── frontend/          React 19 + TypeScript + Vite  (managed with bun)
├── backend/           Python 3.12 + FastAPI          (managed with uv)
├── optimizer/         Pure-Python OR engine          (managed with uv)
├── infra/
│   ├── docker-compose.dev.yml   local development
│   ├── docker-compose.yml       production
│   ├── docker-compose.e2e.yml   throwaway Postgres for the e2e suite
│   ├── docker/nginx/            nginx reverse-proxy config
│   ├── k8s/                     placeholder
│   └── terraform/               placeholder
├── scripts/
│   └── test-e2e.sh    runs Playwright against an isolated stack
├── .github/workflows/ci.yml   CI pipeline
├── lefthook.yml       git pre-commit hooks
├── pyproject.toml     uv workspace root (backend + optimizer)
└── Makefile           developer shortcuts
```

Each module has its own README:

- [frontend/README.md](frontend/README.md)
- [backend/README.md](backend/README.md)
- [optimizer/README.md](optimizer/README.md)
- [infra/README.md](infra/README.md)

---

## Prerequisites

| Tool | Minimum version | Purpose |
|------|----------------|---------|
| [Docker](https://docs.docker.com/get-docker/) + [Compose](https://docs.docker.com/compose/) | Docker 24 | Full stack, Postgres, e2e tests |
| [uv](https://docs.astral.sh/uv/getting-started/installation/) | 0.5 | Python workspace (backend + optimizer) |
| [bun](https://bun.sh/) | 1.1 | Frontend package manager & dev server |
| [lefthook](https://lefthook.dev/installation/) | 2.1 | Git pre-commit hooks (ruff, ty, biome) |
| Python | 3.12 | Required by uv — installed automatically |

---

## Quickstart with Docker (recommended)

```bash
# 1. Clone
git clone <repo-url> squadopt
cd squadopt

# 2. Start the full stack with hot-reload (frontend, backend, Postgres)
make dev

# 3. In a second terminal, once the stack is up — create the auth schema
docker compose -f infra/docker-compose.dev.yml exec backend uv run alembic upgrade head
```

| Service  | URL |
|----------|-----|
| Frontend | <http://localhost:3000> |
| Backend  | <http://localhost:8000> |
| API docs | <http://localhost:8000/docs> |
| Postgres | `localhost:5432` |

Open the frontend, register an account (new accounts get the `manager` role), then create an organization: all other pages are scoped to the active organization.

```bash
# Stop
make down
```

See [infra/README.md](infra/README.md) for production and advanced Docker usage.

---

## Quickstart without Docker

Postgres still runs in Docker; the API and frontend run on your machine.

```bash
# 1. Clone & enter
git clone <repo-url> squadopt
cd squadopt

# 2. Install Python dependencies (backend + optimizer)
make install-backend

# 3. Install frontend dependencies
make install-frontend

# 4. Install git pre-commit hooks (lefthook: ruff, ty, biome)
make hooks-install

# 5. In a first terminal — Postgres on :5432
make infra

# 6. Create the auth schema
cd backend && uv run alembic upgrade head && cd ..

# 7. In a second terminal — API server
make run-backend      # runs on http://localhost:8000

# 8. In a third terminal — Frontend dev server
make run-frontend     # runs on http://localhost:3000
```

The Vite dev server proxies `/api` to `http://localhost:8000`, so the frontend needs no extra configuration.

---

## All Make targets

```
make dev                 Start full stack in dev mode (Docker, hot-reload)
make build               Build production images without starting them
make prod                Build and start production stack (Docker)
make down                Stop dev containers
make down-prod           Stop production containers
make logs                Tail dev container logs
make infra               Start only Postgres (for local backend/frontend dev)
make down-infra          Stop the Postgres container

make sync                Sync the whole Python workspace from the lockfile (all groups)
make install-backend     Install backend + optimizer dependencies (uv sync)
make install-frontend    Install frontend dependencies (bun install)
make hooks-install       Install git pre-commit hooks (lefthook)
make run-backend         Run API server locally with hot-reload
make run-frontend        Run frontend dev server locally

make test                Run all tests (optimizer + API)
make test-optimizer      Run optimizer unit tests only
make test-api            Run backend API tests only (needs migrated Postgres)
make test-e2e            Run frontend Playwright end-to-end tests
make test-e2e-headed     Run e2e tests with the browser window visible
make test-e2e-ui         Run e2e tests in Playwright's interactive UI mode

make lint-backend        Lint optimizer + backend with ruff
make format-backend      Format optimizer + backend with ruff
make typecheck-optimizer Type-check the optimizer with ty
make typecheck-backend   Type-check the backend with ty
make lint-frontend       Lint frontend with biome
make format-frontend     Format frontend with biome

make help                List targets with their descriptions
make clean               Remove caches and build artifacts
```

### End-to-end tests run in their own stack

`make test-e2e` (and its `-headed` / `-ui` variants) never touches the app you run by hand, so you can keep `make run-backend` + `make run-frontend` up while it runs:

| | Manual app | E2E run |
|---|---|---|
| Frontend (Vite) | `:3000` | `:3001` |
| Backend (uvicorn) | `:8000` | `:8001` |
| Postgres | `:5432`, persistent volume | `:5433`, `tmpfs` ([infra/docker-compose.e2e.yml](infra/docker-compose.e2e.yml)), removed after the run |
| JSON data | `backend/data/` | temporary copy, removed after the run |

[scripts/test-e2e.sh](scripts/test-e2e.sh) starts the e2e Postgres, applies the Alembic migrations, runs the backend on `:8001` and lets Playwright start its own Vite on `:3001`. Docker must be running.

---

## Continuous integration

Every pull request (and every push to `main`/`dev`) runs [.github/workflows/ci.yml](.github/workflows/ci.yml), which mirrors the Makefile targets above as independent, parallel jobs:

| Job | What it runs |
|-----|--------------|
| `lint-backend` | `make lint-backend` (ruff) |
| `format-backend` | `ruff format --check` over `optimizer/src` and `backend/src` |
| `typecheck-optimizer` | `make typecheck-optimizer` (ty) |
| `typecheck-backend` | `make typecheck-backend` (ty) |
| `test-optimizer` | `make test-optimizer` (pytest) |
| `test-api` | Applies Alembic migrations against a Postgres service container, then `make test-api` (pytest) |
| `lint-frontend` | `make lint-frontend` (biome) |
| `format-frontend` | `biome format` check (no `--write`) over the frontend source |
| `build-frontend` | `bun run build` (`tsc -b && vite build`) |
| `e2e` | `make test-e2e` (Playwright), which provisions its own Postgres — only on pushes to `main` or a manual [workflow dispatch](../../actions/workflows/ci.yml), since it spins up the full stack |

A job failing blocks the PR from merging once branch protection on `main`/`dev` requires these checks (Settings → Branches → Branch protection rules → "Require status checks to pass").

---

## Configuration

The defaults match the local stack, so no configuration is needed to get started. [.env.example](.env.example) lists every variable:

```dotenv
# Backend
DATA_DIR=./backend/data      # directory of the JSON data files
DEBUG=false
CORS_ORIGINS=http://localhost:3000
DATABASE_URL=postgresql+psycopg://team_manager:team_manager@localhost:5432/team_manager
JWT_SECRET=change-me
JWT_ACCESS_TTL_MINUTES=15
REFRESH_TTL_DAYS=30

# Frontend (VITE_ prefix exposes the value to the browser build)
VITE_API_URL=http://localhost:8000
```

To override a value, export it as an environment variable. The backend also reads a `.env` file from the directory it runs in, which is `backend/` for `make run-backend`: paths in that file are then relative to `backend/`, so `DATA_DIR` would be `./data`. Vite reads its own `.env` from `frontend/`. The Docker stacks set their variables in the compose files.

Data is split across two stores:

- **Postgres** (`DATABASE_URL`) holds users, roles, permissions, refresh tokens, organizations and organization members, managed with SQLAlchemy + Alembic — see [backend/README.md](backend/README.md#database-auth-schema).
- **JSON files** in `DATA_DIR` hold people, projects, teams, skills, roles and assignments, each record tagged with its `organization_id`. The directory is gitignored and the files are created empty on first use.

---

## Optimization model

The solver (`optimizer/`) formulates team formation as a **Mixed-Integer Linear Program (MILP)** solved with [PuLP](https://coin-or.github.io/pulp/) / CBC. It decides how many days per week each person gives to each required skill. A **scope** is either a project without phases or one phase of a phased project. The model below describes one scope; phases, alternatives, start windows and portfolios extend it.

### Allocation grid

Every allocation is a whole number of **steps** of 0.2 FTE, one working day per week; 5 steps make one full-time person. Each skill requirement $k$ has:

- a minimum level $m_k \in [0, 5]$,
- an FTE need $f_k \in [0.2, 5]$ on the grid, i.e. $D_k = 5 f_k$ steps,
- a split limit $n_k$ (`max_people`) between $\lceil f_k \rceil$ and $D_k$, defaulting to $\lceil f_k \rceil$, so the need goes to as few people as possible.

Because of the grid, 1 FTE across two people is 0.8 + 0.2 or 0.6 + 0.4, never 0.5 + 0.5.

### Sets and indices

| Symbol | Definition |
|--------|-----------|
| $P$ | Feasible candidates of the scope (see [Availability and feasibility](#availability-and-feasibility)) |
| $K$ | Skill requirements of the scope |
| $P_k \subseteq P$ | Candidates qualified for skill $k$: $l_{ik} \geq m_k$ |
| $\mathcal{F}$ | Forced inclusions — persons who must be assigned |
| $\mathcal{Q}$ | Squads; each $Q \in \mathcal{Q}$ is a group of persons selected all-or-nothing |
| $i, j$ | Indices over persons in $P$ |
| $k$ | Index over skills in $K$ |

### Parameters

| Symbol | Definition |
|--------|-----------|
| $D_k,\, n_k,\, m_k$ | Steps needed, split limit and minimum level of skill $k$ |
| $A_i$ | Person $i$'s availability in steps: $\lfloor 5 \cdot \min(\text{avail}_i, 1) \rfloor$ |
| $l_{ik}$ | Person $i$'s proficiency in skill $k$, from 0 to 5 (0 if absent) |
| $e_i$ | Person $i$'s years of professional experience |
| $G_i,\, R_i$ | Skill IDs person $i$ wants to grow in, and prefers to work on |
| $a_{ij}$ | Affinity between persons $i$ and $j$, in $[-5, +5]$ |
| $N$ | Steps the scope must staff (see [Need](#need)) |
| $w_\text{perf},\, w_\text{chem},\, w_\text{grow},\, w_\text{cost},\, w_\text{pref},\, w_\text{hand}$ | Objective weights in $[0, 1]$ (defaults 0.25, 0.25, 0.25, 0.25, 0, 0) |
| $\varepsilon$ | Headcount tie-break, $10^{-3}$ |

### Decision variables

$$d_{ik} \in \{0, \dots, \min(A_i, D_k)\} \quad \forall k \in K,\; i \in P_k \qquad \text{(steps person } i \text{ gives to skill } k\text{)}$$

$$y_{ik} \in \{0, 1\} \quad \forall k \in K,\; i \in P_k \qquad \text{(1 if person } i \text{ fills skill } k \text{ at all)}$$

$$x_i \in \{0, 1\} \quad \forall i \in P \qquad \text{(1 if person } i \text{ is selected)}$$

$$w_{ij} \geq 0 \quad \forall i < j,\; a_{ij} > 0 \qquad \text{(FTE the pair shares; only when } N > 5\text{)}$$

$$z_{ij} \geq 0 \quad \forall i < j,\; a_{ij} < 0 \qquad \text{(1 when both are selected)}$$

People below a skill's minimum level get no variable for it, so `min_level` is a hard rule.

### Per-share score

Each step a person gives to a skill earns:

$$\sigma_{ik} = w_\text{perf} \cdot \frac{l_{ik}}{5} \;+\; w_\text{grow} \cdot [k \in G_i] \;+\; w_\text{cost} \cdot \Bigl(1 - \min\!\bigl(\tfrac{e_i}{20},\, 1\bigr)\Bigr) \;+\; w_\text{pref} \cdot [k \in R_i]$$

The performance term rewards higher levels in the skill actually filled. The cost term favours adequately qualified over over-qualified staff.

### Objective function (maximisation)

$$\max \quad \underbrace{\sum_{k \in K} \sum_{i \in P_k} \sigma_{ik} \cdot \tfrac{d_{ik}}{5} \;+\; w_\text{chem} \!\!\sum_{a_{ij} > 0}\!\! a_{ij}\, w_{ij} \;+\; w_\text{chem} \!\!\sum_{a_{ij} < 0}\!\! a_{ij}\, z_{ij}}_{\text{quality (the reported score)}} \;-\; \varepsilon \Bigl(\sum_{i} x_i + \sum_{i,k} y_{ik}\Bigr)$$

Scores are weighted by FTE, so the score reflects the capacity delivered, not headcount. Every quality term is headcount-neutral, so the small $\varepsilon$ penalty breaks ties towards fewer people and fewer, fuller shares, without ever overriding quality.

### Constraints

**Allocation** — linking, skill need, split limit and personal capacity:

$$y_{ik} \leq d_{ik} \leq \min(A_i, D_k) \cdot y_{ik} \qquad \forall k,\; i \in P_k$$
$$\sum_{i \in P_k} d_{ik} \leq D_k \qquad\qquad \sum_{i \in P_k} y_{ik} \leq n_k \qquad \forall k \in K$$
$$\sum_{k \,:\, i \in P_k} d_{ik} \leq A_i \qquad \forall i \in P$$

One person may fill several skills; their shares add up within their availability.

**Selection** — a person is selected exactly when they fill at least one skill:

$$y_{ik} \leq x_i \leq \sum_{k \,:\, i \in P_k} y_{ik}$$

So a forced member who qualifies for no required skill makes the scope infeasible.

**Staffing** — the scope staffs exactly its need:

$$\sum_{k \in K} \sum_{i \in P_k} d_{ik} = N$$

**Forced inclusions:**

$$x_i = 1 \qquad \forall i \in \mathcal{F} \cap P$$

**Squad co-selection** — the feasible members of each squad move together:

$$x_i = x_j \qquad \forall\, i, j \in Q \cap P,\;\; \forall\, Q \in \mathcal{Q}$$

A squad member who is infeasible in the scope is skipped, so the remaining members still bind to one another. Forcing in one squad member pulls in the whole squad.

**Chemistry** — positive affinity rewards the FTE two people share, with each person's shared FTE over all their pairs capped by their own allocation:

$$\sum_{j \,:\, a_{ij} > 0} w_{ij} \leq \frac{1}{5} \sum_{k} d_{ik} \qquad \forall i \in P$$

Total positive chemistry is therefore bounded by $N/10$ FTE and saturates at the smallest team, so adding people never creates extra pairs to reward. A need of at most one FTE ($N \leq 5$) is ideally one person, so it earns no chemistry bonus; otherwise friends would be rewarded for splitting it. Negative affinity is friction that doesn't shrink with a part-time share, so it is penalised whenever both people are selected:

$$z_{ij} \geq x_i + x_j - 1$$

$a_{ij}$ is read from the affinities of whichever of the two persons comes first in the candidate list.

### Need

The need $N$ is not simply $\sum_k D_k$: each skill is capped by what its qualified people can supply. It is computed by an auxiliary MILP that maximises $\sum d_{ik}$ under the allocation constraints only. It is solved jointly because one person's availability may be claimed by several skills. A short supply therefore becomes partial coverage instead of an error. Squads and forced members are left out of this computation, so a need they can't fit shows up as an infeasibility attributed to them.

The result reports, per scope, the required, staffed and available FTE and each skill's covered FTE. It is `fully_covered` when every scope staffs its required FTE and meets every skill's FTE. `max_score` is an upper bound for the weights: every per-share factor at 1 over the whole need, plus all shared FTE at maximum affinity.

### Availability and feasibility

A person is feasible for a scope if they are not in the project's exclusion list (unless exclusions are ignored) and their availability over the scope's dates, floored to the grid, is at least one step.

Availability is the day-weighted average of the person's daily ratio over the scope's dates:

$$\text{avail}_i = \frac{\displaystyle\sum_{d \in \mathcal{D}} \text{ratio}_i(d)}{|\mathcal{D}|}$$

where $\mathcal{D}$ is the union of the scope's date-range days, and $\text{ratio}_i(d)$ is resolved in order:

1. 0 on the person's `vacations` days;
2. otherwise the lowest ratio of the `availability_windows` covering $d$;
3. otherwise the base ratio $\min(\text{working\_days\_per\_week} / 5,\, 1)$ minus the person's committed assignments on other projects that day, floored at 0.

A scope without dates uses the base ratio.

### Phased projects

Each phase $t$ is its own scope, with its own skill requirements and date range, and it inherits the project's exclusions, forced inclusions and squads. All phases are solved in a **single MILP**. Variables become phase-indexed ($d_{ikt}$, $x_{it}$, …), and every phase keeps its own constraints and need $N_t$.

With $w_\text{hand} = 0$ the objective is separable, so the optimum equals solving each phase alone. With $w_\text{hand} > 0$, the FTE a person keeps between consecutive phases is rewarded, for every person feasible in both:

$$h_{it} \geq 0, \qquad h_{it} \leq \frac{1}{5} \sum_k d_{ikt}, \qquad h_{it} \leq \frac{1}{5} \sum_k d_{ik,t+1}$$

$$\max \quad \sum_t \text{quality}_t \;+\; w_\text{hand} \sum_{t} \sum_{i} h_{it} \;-\; \varepsilon \cdot \text{headcount}$$

At the optimum $h_{it} = \min(a_{it}, a_{i,t+1})$, the smaller of the person's two allocations. Rewarding retained FTE rather than retained people avoids rewarding a need split across more people. Retention is rewarded, not required: the solver keeps someone across phases when they remain a good-enough fit, trading marginal per-phase quality for team stability.

### Alternatives

`solve_pool` returns the optimum and up to `n_alternatives` (default 2) ranked alternatives. After each solve, a no-good cut over the selected (phase, person) picks $S$ forces the next team to drop at least $\delta$ of them (`min_difference`, default 2):

$$\sum_{(i,t) \in S} x_{it} \leq |S| - \min(\delta, |S|)$$

Alternatives therefore differ in people, not merely in allocations, and phased projects are ranked by total project score.

### Flexible start window

When a project has a `start_window`, `solve_pool_over_starts` also picks the start date. Candidate starts are weekly from the window's start to its end; the API caps the window at 52 candidates. At each candidate, the whole schedule (every date range, including phases) is shifted rigidly so its earliest date lands on the candidate, and the optimum is solved there. Candidates rank fully covered first, then highest score, then earliest start. The full pool of alternatives is built at the best start only.

### Portfolio (batch) solve

`solve_portfolio` staffs several projects that compete for the same people in **one model**:

- each scope may be staffed **below** its need ($\sum d \leq N$), so competing projects trade staffing instead of making the model infeasible;
- for each person and each period where two or more of their scopes overlap, their allocations to those scopes must fit their availability over that period (a scope without dates overlaps everything);
- the objective is **lexicographic** over priority tiers (`critical`, `high`, `medium`, `low`): first the staffed steps of critical projects are maximised and held as a floor, then those of the next tier, and so on, and finally the summed quality of every project minus the headcount tie-break. A higher tier is never short-staffed to benefit a lower one.

Chemistry and handover only count within a project. In the API's batch mode, the selected projects' own assignments are freed and re-optimised, and every other project's assignments count as committed load; projects with a start window are solved at their planned dates.

### Infeasibility diagnosis

When the hard constraints admit no team, the solver relaxes them one at a time to name the cause for each phase:

| Reason | Meaning |
|--------|---------|
| `squad_conflict` | Dropping the listed squads makes the phase solvable |
| `forced_member_conflict` | Un-forcing the listed members makes the phase solvable |
| `squad_and_forced_member_conflict` | Only dropping the squads and un-forcing the members together does |
| `cross_project_forced_conflict` | Portfolio only: a person is forced into more overlapping scopes than they have steps over the overlap |
| `fte_not_reachable` | No relaxation helps; not expected, since the need is sized to what the pool can staff |

---

## License

The source code is released under the [MIT License](LICENSE).

## Trademark

<img src="docs/assets/squadopt-icon.svg" alt="SquadOpt icon" width="64" align="right">

"SquadOpt" and the SquadOpt logo are trademarks of Maxence Queyrel. The MIT License covers the code only and grants no right to use the name or logo. You may fork and modify the code, but a redistributed or hosted fork must use a different name and logo and must not suggest that it is endorsed by the SquadOpt project.
