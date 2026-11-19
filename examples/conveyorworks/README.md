# Conveyor Works 0.2.0

A small Create-inspired conveyor fixture used to exercise Jar2Zeus packaging,
static API-contract validation, Lua syntax checks, and GitHub Actions artifact
generation for Eaglercraft 26.2.

## Contents

- Four directional conveyor block registrations
- Drive pulley, andesite shaft, and machine casing
- Belt wrench item registration
- Four shaped recipe registrations
- HUD registration
- A command-based dropped-item movement prototype

## Important limitations

This is **not** a port of the Create mod. It does not implement rotational
kinetics, connected belt rendering, animated models, robust item collision,
sorting, or multiplayer synchronization. The movement prototype uses
`commands.run` and is intended only as a local-world API smoke test. A
successful CI run proves packaging and static/syntax checks only; it does not
prove the exact target HTML exposes the APIs or that gameplay works.

The package is built by
`.github/workflows/conveyorworks.yml` and uploaded as a GitHub Actions
artifact named `conveyorworks-zeus-mod`.
