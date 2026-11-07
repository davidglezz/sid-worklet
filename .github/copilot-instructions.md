<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

---

# SID Worklet — Project-Specific Instructions

A Commodore 64 SID chip emulator running as a Web Audio API `AudioWorklet`. Derived from [jsSID](https://github.com/og2t/jsSID).

## Architecture

```
src/cpu.ts             — 6502 CPU emulator
src/sid-device.ts      — SID chip hardware emulator (registers, voices, envelope, filters)
src/sid.ts             — SIDPlayer: combines CPU + SID, parses .sid files, exposes play()/seek()
src/sid-worklet.ts     — AudioWorkletProcessor (audio thread — NOT the main thread)
src/sid-node.ts        — AudioWorkletNode (main thread; typed message bridge to worklet)
src/audio-player.ts    — High-level EventTarget API: load/play/pause/seek/volume/events
src/audio-visualizer.ts — Canvas waveform/spectrum visualizer
src/main.ts            — Demo UI (not unit-tested)
```

See [README.md](../README.md) for the public `AudioPlayer` API and seek behaviour details.

## Key Constraints

- **`sid-worklet.ts` runs in `AudioWorkletGlobalScope`** (audio thread), not the main thread. APIs unavailable there (e.g. `TextDecoder`) must be polyfilled at the top of that file.
- **Typed message passing**: add new cross-thread messages to `InputMessagesMap` / `OutputMessagesMap` in `sid-worklet.ts`.
- **Last-wins seek**: `pendingSeek` stores only the last `setPosition` call per audio block to prevent backlog on rapid scrubbing.
- **Sample rate is fixed** at 44100 Hz (`AudioContext({ sampleRate: 44100 })`).
- **Base path**: `/sid-worklet/` (configured in `vite.config.ts`).
- `.sid` test fixtures live in `test-songs/`.
- Use **single quotes** (enforced by formatter).
