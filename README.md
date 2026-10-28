# CMake Subproject Wizard (CLion-Style)

[![VS Code Marketplace](https://img.shields.io/badge/VS_Code-Extension-blueviolet.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#)

Bring CLion’s modular, multi-target C/C++ workflow to Visual Studio Code. Scaffold nested CMake subprojects directly from your Explorer sidebar with zero terminal configuration, automatic `compile_commands.json` export for `clangd`, and instant CodeLLDB debug targets.

---

## 🚀 Features

- **Sidebar Explorer Context Menu**: Right-click any workspace directory to add a nested subproject in seconds.
- **Dynamic Workspace Root Integration**: Master `CMakeLists.txt` automatically takes the exact name of your root workspace folder (rather than generic placeholders) and appends `add_subdirectory(...)`.
- **Clangd-Ready by Default**: Automatically sets `CMAKE_EXPORT_COMPILE_COMMANDS ON` and configures `.vscode/settings.json` so `clangd` immediately indexes all subprojects with zero manual configuration.
- **Pure CodeLLDB Debug Targets**: Executables automatically generate corresponding `lldb` targets in `.vscode/launch.json` for one-click `F5` debugging without relying on Microsoft's heavy IntelliSense engine.
- **Strict Identifier Validation**: Rejects names starting with numbers, spaces, or illegal characters, preventing invalid C++ namespaces and build errors.
- **Clean Interface Architecture (`include/` & `src/`)**: Subprojects are scaffolded with relative include paths (`#include "../include/..."`) so code works immediately out of the box.
- **Git & Build Hygiene**: Automatically configures `.gitignore` for `build/`, `compile_commands.json`, `.idea/`, and `cmake-build-*/`.

---

## 📂 Layout Pattern Example

When you right-click inside a workspace directory named `modern_cpp` and create an executable named `network_engine`:

```text
modern_cpp/
├── .gitignore                      # Configured build/IDE ignore rules
├── CMakeLists.txt                  # project(modern_cpp) + add_subdirectory(network_engine)
├── .vscode/
│   ├── settings.json               # Auto-configured compile_commands-dir for clangd
│   └── launch.json                 # Pre-configured "Debug Subproject: network_engine" (CodeLLDB)
└── network_engine/
    ├── CMakeLists.txt              # Target build definitions and include paths
    ├── include/
    │   └── network_engine.hpp      # Starter header with namespace guards
    └── src/
        └── main.cpp                # Starter entry file linked with standard library
