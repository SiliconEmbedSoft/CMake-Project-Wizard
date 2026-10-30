# CMake Project Wizard

Scaffold modular C/C++ CMake subprojects with a CLion-style workflow, clangd IntelliSense, and modern LLVM native debugging directly inside Visual Studio Code.

[![Version](https://img.shields.io/badge/version-1.3.0-blue.svg)](https://github.com/SiliconEmbedSoft/CMake-Project-Wizard)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.75.0-007ACC.svg)](https://code.visualstudio.com/)

---

## Overview

**CMake Project Wizard** brings CLion-style modular CMake project ergonomics to VS Code. It scaffolds structured C/C++ CMake subprojects, library targets, and standalone single projects, configures `CMakePresets.json`, provides real-time status bar target management, and keeps your workspace clean with automatic file deletion synchronization.

---

## Features

### 🧱 Modular CMake Subprojects & Single Projects
- Right-click any workspace folder in Explorer:
  - **Add CMake Subproject**: Generates an isolated subproject folder (`CMakeLists.txt`, `src/`, `include/`) and automatically appends `add_subdirectory(...)` to the parent `CMakeLists.txt`.
  - **Convert to Single CMake Project**: Converts an empty folder into a dedicated, standalone C/C++ CMake executable.
- Guardrails ensure that standalone single-project directories cannot be corrupted with accidental subprojects.

### 📚 Target & File Generation
- Right-click in the Explorer context menu under **CMake Wizard: New**:
  - **Source File (C / C++)**: Creates boilerplate `.cpp` or `.c` files.
  - **Header File (C / C++)**: Generates `.hpp` or `.h` files complete with uppercase include guards.
  - **Library Target (C / C++)**: Scaffolds `STATIC`, `SHARED`, or `INTERFACE` library targets with standard include paths and wiring.

### 🎯 Dynamic Status Bar Controls
- **Target Selection**: Switches between CMake targets. When managing subprojects, an **`all`** target is provided; in standalone single projects, only the primary executable target is selected.
- **Build Type Selector**: Easily toggle between `Debug`, `Release`, `RelWithDebInfo`, and `MinSizeRel`.

### 🧹 Auto-Cleanup Watcher
- When any subproject folder is removed from disk, the background `FileSystemWatcher` immediately cleans up the corresponding `add_subdirectory(...)` entry in the root `CMakeLists.txt` and triggers a clean reconfigure.

---

## Bundled Extension Dependencies

Installing **CMake Project Wizard** automatically pulls in the official tooling stack:

| Extension | Identifier | Role |
|-----------|------------|------|
| Clangd | `llvm-vs-code-extensions.vscode-clangd` | Language server & AST analysis |
| LLDB DAP | `llvm-vs-code-extensions.lldb-dap` | Native debugger driver |
| CMake Tools | `ms-vscode.cmake-tools` | CMake configure and build orchestration |
| C/C++ DevTools | `ms-vscode.cpp-devtools` | Language support utilities |
| C/C++ Themes | `ms-vscode.cpptools-themes` | Syntax theme enhancements |

---

## Commands

All commands are available via the Command Palette (`Ctrl/Cmd+Shift+P`):

| Command | Identifier | Description |
|---|---|---|
| Add CMake Subproject | `cmakeProjectWizard.createSubproject` | Scaffold a new CMake subproject |
| Convert to Single CMake Project | `cmakeProjectWizard.convertToSingleProject` | Set up a root standalone project |
| Source File (C / C++) | `cmakeProjectWizard.newSource` | Create a new `.cpp` or `.c` file |
| Header File (C / C++) | `cmakeProjectWizard.newHeader` | Create a new `.hpp` or `.h` file |
| Library Target (C / C++) | `cmakeProjectWizard.newLibraryTarget` | Create static, shared, or interface library |
| Select Active Target | `cmakeProjectWizard.selectActiveTarget` | Choose the active target |
| Select Build Type | `cmakeProjectWizard.selectBuildType` | Choose the active build configuration |

---

## Extension Settings

All settings are grouped cleanly inside the Settings UI (`Ctrl+,` -> `CMake Project Wizard`):

| Section | Setting | Default | Description |
|---|---|---|---|
| **General** | `cmakeProjectWizard.general.defaultLicense` | `MIT` | Default license identifier |
| **General** | `cmakeProjectWizard.general.commitLockfiles` | `false` | Whether to include lockfiles in `.gitignore` |
| **General** | `cmakeProjectWizard.autoCleanupOnDelete` | `true` | Auto-strip `add_subdirectory(...)` when folder is deleted |
| **CMakeLists.txt Defaults** | `cmakeProjectWizard.cmake.cxxStandard` | `20` | Default C++ standard (`11`, `14`, `17`, `20`, `23`) |
| **CMakeLists.txt Defaults** | `cmakeProjectWizard.cmake.cStandard` | `17` | Default C standard (`99`, `11`, `17`, `23`) |
| **CMakeLists.txt Defaults** | `cmakeProjectWizard.cmake.minimumRequired` | `3.21` | Minimum required CMake version |
| **CMakeLists.txt Defaults** | `cmakeProjectWizard.cmake.defaultBuildType` | `Debug` | Default build configuration |
| **CMakePresets.json Defaults** | `cmakeProjectWizard.presets.generator` | `Ninja` | Build generator |
| **CMakePresets.json Defaults** | `cmakeProjectWizard.presets.binaryDir` | `${sourceDir}/build` | Build directory path |
| **Status Bar** | `cmakeProjectWizard.statusBar.showTarget` | `true` | Show active target in the status bar |
| **Status Bar** | `cmakeProjectWizard.statusBar.showBuildType` | `true` | Show build type in the status bar |
| **Status Bar** | `cmakeProjectWizard.statusBar.targetPriority` | `49` | Target status bar priority |
| **Status Bar** | `cmakeProjectWizard.statusBar.buildTypePriority` | `49` | Build type status bar priority |

---

## License

Released under the [MIT License](LICENSE).

---

## Author

**Nikhil Chaurasia**  
Publisher: `siliconembedsoft-hq`  
GitHub: [SiliconEmbedSoft](https://github.com/SiliconEmbedSoft)
