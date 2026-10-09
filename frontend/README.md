# Frontend — Workflow Orchestration Engine

React + TypeScript + Vite frontend for the Multi-Tenant Distributed Workflow & Saga Orchestration Engine (Zaalima Project 1).

This README explains how to install and run **only the frontend**. No prior React experience is assumed.

## What is in this folder

| Path | Purpose |
| --- | --- |
| `index.html` | HTML entry point that Vite loads |
| `src/main.tsx` | Application entry point — mounts React into `index.html` |
| `src/App.tsx` | Root application component |
| `src/components/` | React components, grouped into subfolders |
| `src/assets/` | Static assets imported by components |
| `src/index.css`, `src/App.css` | Stylesheets |
| `public/` | Files served as-is and copied to the build output |
| `vite.config.ts` | Vite configuration |
| `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` | TypeScript configuration |
| `package.json` | Dependencies and the scripts listed below |
| `package-lock.json` | Locked dependency versions — do not edit or delete |

## Prerequisites

You need **Node.js** and **npm**. npm is installed automatically with Node.js.

Check that both are available:

```bash
node --version
npm --version
```

This frontend was verified with Node.js `v24.21.0` and npm `11.19.0`.

If either command prints "not recognized", Node.js is not installed. Install the Node.js LTS version from https://nodejs.org and then open a **new** terminal — a terminal opened before installing will not see it.

## Install and run

Run these commands from inside `frontend/`, not from the repository root:

```bash
cd frontend
npm ci
npm run dev
```

- `npm ci` installs the exact dependency versions recorded in `package-lock.json`. Use this for a clean, reproducible install.
- Use `npm install` instead only when you have changed `package.json` and need to update the lockfile.
- `npm run dev` starts the Vite development server and prints a local URL. It is normally:

  http://localhost:5173/

Open that URL in your browser. Always use the URL Vite actually prints — if the default port is busy, Vite may choose another.

## Available scripts

These come from `package.json`. Run them from inside `frontend/`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the development server with hot reload |
| `npm run build` | Type-checks with `tsc -b`, then builds for production into `dist/` |
| `npm run preview` | Serves the production build locally for a final check |
| `npm run lint` | Runs the Oxlint linter |

## Stopping the development server

Press `Ctrl + C` in the terminal running `npm run dev`.

The development server keeps its terminal busy, so use a second terminal for other commands.

## The backend is a separate folder

`backend/` is a separate Node.js and Express application with its own `package.json` and its own install step. **You do not need the backend running to start or view the frontend.**

## If something fails

Before asking for help, collect all three of these:

1. The exact command you ran.
2. The complete error message — copy the whole block, not a summary.
3. The output of:

```bash
git status
```

Common problems:

| Message | Likely cause |
| --- | --- |
| `'npm' is not recognized` | Node.js is not installed, or this terminal was opened before installing it. Install Node.js LTS, then open a new terminal. |
| `Cannot find module ...` | Dependencies are missing or stale. Run `npm ci` again from inside `frontend/`. |
| Vite prints a port other than 5173 | The default port was already in use. Open the URL Vite printed. |

Do not work around errors by deleting `package-lock.json`, installing new libraries, or discarding uncommitted work. Ask first.
