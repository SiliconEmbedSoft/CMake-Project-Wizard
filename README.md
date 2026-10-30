# CMake Project Wizard

Scaffold modular C/C++ CMake subprojects with a CLion-style workflow — multi-target management, `clangd` IntelliSense, and modern LLVM native debugging via `lldb-dap` — directly inside Visual Studio Code.

[![Version](https://img.shields.io/badge/version-1.2.9-blue.svg)](https://github.com/SiliconEmbedSoft/CMake-Project-Wizard)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.75.0-007ACC.svg)](https://code.visualstudio.com/)

---

## Overview

**CMake Project Wizard** brings CLion's modular project ergonomics to VS Code. It scaffolds structured C/C++ CMake subprojects, wires up `clangd` as the single language-server source of truth, generates `lldb-dap` debug configurations, and keeps your workspace hygienic with an automatic file watcher that cleans up stale CMake and launch entries when folders are deleted.

It is an **orchestration layer**, not a reimplementation. The heavy lifting (AST analysis, builds, debugging) is delegated to the best-in-class LLVM and Microsoft extensions it bundles.

---

## Features

### 🧱 CLion-Style Project Scaffolding
- Right-click any folder in the Explorer → **New CMake Subproject...**
- Interactive wizard prompts for:
  - **Subproject identifier** (validated against strict C/C++ naming rules)
  - **Target type** — Executable, Static Library, or Shared Library
  - **Language** — C++ or C
  - **Standard** — C++14/17/20/23 or C99/11/17/23 (your configured default is offered first)
- Generates a clean, modular layout:

  ```text
  <target_name>/
  ├── CMakeLists.txt
  ├── include/
  │   └── <target_name>.hpp (or .h)
  └── src/
      └── main.cpp (or <target_name>.cpp)
  ```

- Automatically wires the root `CMakeLists.txt` with `add_subdirectory(<target_name>)` and ensures `set(CMAKE_EXPORT_COMPILE_COMMANDS ON)`.

### 🧠 Clangd IntelliSense (Zero Config)
On workspace load, `.vscode/settings.json` is configured to make `clangd` the authoritative engine:
- Disables Microsoft IntelliSense (`C_Cpp.intelliSenseEngine: "disabled"`) to prevent duplicate squigglies and CPU spikes.
- Sets `clangd.arguments`:
  - `--compile-commands-dir=${workspaceFolder}/build`
  - `--header-insertion=iwyu`
  - `--completion-style=detailed`
  - `--background-index`
  - `--clang-tidy`
- Points `cmake.buildDirectory` at `${workspaceFolder}/build` and exports compile commands.

### 🐞 LLDB-DAP Debugging
- Launch configurations use modern `type: "lldb-dap"` for native LLVM debugging.
- Binary paths auto-map to `${workspaceFolder}/build/<target>/<target>`.
- Each executable target gets a `Debug Subproject: <target>` entry in `.vscode/launch.json`.

### 🎯 Active Target & Build Type (Status Bar)
- CLion-style status bar controls for the **active target** and **build type**.
- Build types: `Debug`, `Release`, `RelWithDebInfo`, `MinSizeRel`.
- Build / Run / Debug commands act on the active target.

### 🧹 Dynamic Synchronizer & Auto-Cleanup
- A `FileSystemWatcher` monitors workspace changes.
- When a subproject folder is deleted, it automatically:
  - Strips the matching `add_subdirectory(...)` from the parent `CMakeLists.txt`.
  - Removes the obsolete `lldb-dap` debug target from `launch.json`.
  - Resets the active target if it was the deleted one.
- Toggle with `cmakeProjectWizard.autoCleanupOnDelete`.

### 📦 Git Hygiene Automation
Auto-maintains a sensible `.gitignore`:

```gitignore
build/
bin/
cmake-build-*/
.idea/
.vscode/*
compile_commands.json
!.vscode/launch.json
!.vscode/settings.json
```

---

## Bundled Extensions

CMake Project Wizard installs and depends on the following via `extensionDependencies`:

| Extension | Role |
|-----------|------|
| `llvm-vs-code-extensions.vscode-clangd` | Primary language server / AST engine |
| `llvm-vs-code-extensions.lldb-dap` | Core native debugger (LLDB-DAP) |
| `ms-vscode.cmake-tools` | CMake build integration & driver |
| `ms-vscode.cpp-devtools` | C/C++ architecture & developer tools |
| `ms-vscode.cpptools-themes` | C/C++ syntax highlighting & themes |

---

## Requirements

- **VS Code** `^1.75.0`
- **CMake** `>= 3.15` on your `PATH`
- A working **LLVM toolchain** (`clang`, `clangd`, `lldb-dap`) for full functionality
- The bundled extensions are installed automatically on first activation

---

## Getting Started

1. Install **CMake Project Wizard** from the Marketplace (dependencies install automatically).
2. Open an empty folder as your workspace root.
3. Right-click the folder in the Explorer → **New CMake Subproject...**
4. Follow the wizard (name → type → language → standard).
5. Run **CMake Project Wizard: Configure CMake Project** from the Command Palette.
6. Use the status bar to pick your active target and build type, then **Build**, **Run**, or **Debug**.

---

## Commands

All commands are available under the **CMake Project Wizard** category in the Command Palette (`Ctrl/Cmd+Shift+P`).

| Command | ID | Description |
|---------|----|-----|
| New CMake Subproject... | `cmakeProjectWizard.newSubproject` | Scaffold a new modular subproject (also in Explorer context menu) |
| Configure CMake Project | `cmakeProjectWizard.configure` | Trigger a CMake configure via cmake-tools |
| Build Target | `cmakeProjectWizard.buildTarget` | Build the active target |
| Run Target | `cmakeProjectWizard.runTarget` | Run the active target's binary in a terminal |
| Debug Target | `cmakeProjectWizard.debugTarget` | Launch an `lldb-dap` debug session |
| Select Active Target | `cmakeProjectWizard.selectActiveTarget` | Choose the active CMake target |
| Select Build Type | `cmakeProjectWizard.selectBuildType` | Switch between Debug/Release/etc. |
| Sync Workspace Configuration | `cmakeProjectWizard.syncWorkspace` | Re-apply settings & `.gitignore` |

---

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `cmakeProjectWizard.defaultCppStandard` | `20` | C++ standard offered first in the wizard (`14`/`17`/`20`/`23`) |
| `cmakeProjectWizard.defaultCStandard` | `17` | C standard offered first in the wizard (`99`/`11`/`17`/`23`) |
| `cmakeProjectWizard.defaultBuildType` | `Debug` | Default CMake build type |
| `cmakeProjectWizard.autoCleanupOnDelete` | `true` | Auto-strip CMake/launch entries on folder deletion |

---

## Known Limitations

- **Target discovery is lightweight.** It parses `add_subdirectory()` from the root `CMakeLists.txt` rather than the CMake File API, so targets defined via nested globbing or generator expressions may not appear.
- **`preLaunchTask` assumes a matching task.** Debug configs reference `CMake: build <target>`; ensure a corresponding task exists or remove the line.
- **`cmake-tools` command IDs vary by version.** `cmake.setBuildType` is wrapped in a try/catch — the status bar remains authoritative if the API differs.
- **The file watcher is broad** (`**/*`). On large monorepos you may want to narrow its scope.
- Full CLion parity (proprietary refactoring/analysis) is **not** reimplemented — it is delegated to `clangd`, `cmake-tools`, and `lldb-dap`.

---

## Contributing

Issues and pull requests are welcome on the [GitHub repository](https://github.com/SiliconEmbedSoft/CMake-Project-Wizard).

---

## License

Released under the [MIT License](LICENSE).

---

## Author

**Nikhil Chaurasia**
Publisher: `siliconembedsoft-hq`
GitHub: [SiliconEmbedSoft](https://github.com/SiliconEmbedSoft)
