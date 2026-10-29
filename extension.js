const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/* ============================================================
 * Utilities
 * ============================================================ */

function toValidIdentifier(name) {
  let cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_');
  if (/^[0-9]/.test(cleaned)) {
    cleaned = 'proj_' + cleaned;
  }
  return cleaned;
}

function getConfig() {
  return vscode.workspace.getConfiguration('clionSuite');
}

function primaryWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
}

/* ============================================================
 * CMake / Source Templates
 * ============================================================ */

function getSubprojectCMakeLists(projectName, language, standard, projectType) {
  const isCpp = language === 'C++';
  const langKey = isCpp ? 'CXX' : 'C';
  const stdDirective = isCpp
    ? `set(CMAKE_CXX_STANDARD ${standard})\nset(CMAKE_CXX_STANDARD_REQUIRED ON)\nset(CMAKE_CXX_EXTENSIONS OFF)`
    : `set(CMAKE_C_STANDARD ${standard})\nset(CMAKE_C_STANDARD_REQUIRED ON)\nset(CMAKE_C_EXTENSIONS OFF)`;

  const globPattern = isCpp ? 'src/*.cpp' : 'src/*.c';

  let targetBlock = '';
  if (projectType === 'Executable') {
    targetBlock = `add_executable(\${PROJECT_NAME} \${SOURCES})`;
  } else if (projectType === 'Static Library') {
    targetBlock = `add_library(\${PROJECT_NAME} STATIC \${SOURCES})`;
  } else {
    targetBlock = `add_library(\${PROJECT_NAME} SHARED \${SOURCES})`;
  }

  // CLion-style per-target output directory layout
  const outputBlock =
    projectType === 'Executable'
      ? `set_target_properties(\${PROJECT_NAME} PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/${projectName}"
)`
      : `set_target_properties(\${PROJECT_NAME} PROPERTIES
    ARCHIVE_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/${projectName}"
    LIBRARY_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/${projectName}"
)`;

  return `cmake_minimum_required(VERSION 3.15)
project(${projectName} LANGUAGES ${langKey})

${stdDirective}

file(GLOB_RECURSE SOURCES "${globPattern}")

${targetBlock}

${outputBlock}

target_include_directories(\${PROJECT_NAME} PUBLIC
    \${CMAKE_CURRENT_SOURCE_DIR}/include
)
`;
}

function getHeaderTemplate(identifier, isCpp) {
  return `#pragma once

${isCpp ? `namespace ${identifier} {\nvoid hello();\n}` : '/* C Interface */\nvoid hello(void);'}
`;
}

function getSourceTemplate(projectName, identifier, language, projectType) {
  const isCpp = language === 'C++';
  const headerExt = isCpp ? 'hpp' : 'h';
  const headerInclude = `#include "../include/${projectName}.${headerExt}"`;

  if (projectType !== 'Executable') {
    if (isCpp) {
      return `${headerInclude}
#include <iostream>

namespace ${identifier} {
void hello() {
    std::cout << "Library [${projectName}] initialized." << std::endl;
}
}
`;
    }
    return `${headerInclude}
#include <stdio.h>

void hello(void) {
    printf("Library [${projectName}] initialized.\\n");
}
`;
  }

  if (isCpp) {
    return `${headerInclude}
#include <iostream>

namespace ${identifier} {
void hello() {
    std::cout << "Hello from ${projectName}!" << std::endl;
}
}

int main(int argc, char* argv[]) {
    ${identifier}::hello();
    return 0;
}
`;
  }

  return `${headerInclude}
#include <stdio.h>

void hello(void) {
    printf("Hello from ${projectName}!\\n");
}

int main(int argc, char* argv[]) {
    hello();
    return 0;
}
`;
}

/* ============================================================
 * Root CMakeLists Wiring
 * ============================================================ */

function linkParentCMakeLists(parentDir, subprojectName) {
  const parentCMakePath = path.join(parentDir, 'CMakeLists.txt');
  const addSubdirLine = `add_subdirectory(${subprojectName})\n`;

  if (!fs.existsSync(parentCMakePath)) {
    const exactWorkspaceName = toValidIdentifier(path.basename(parentDir)) || 'WorkspaceRoot';
    const parentTemplate = `cmake_minimum_required(VERSION 3.15)
project(${exactWorkspaceName} LANGUAGES C CXX)

# Export compilation commands for clangd
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Default build type (CLion-style) if not specified
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Debug CACHE STRING "Build type" FORCE)
endif()

${addSubdirLine}`;
    fs.writeFileSync(parentCMakePath, parentTemplate, 'utf8');
    return;
  }

  let existingContent = fs.readFileSync(parentCMakePath, 'utf8');
  if (!existingContent.includes('CMAKE_EXPORT_COMPILE_COMMANDS')) {
    existingContent = `set(CMAKE_EXPORT_COMPILE_COMMANDS ON)\n` + existingContent;
  }

  const targetRegex = new RegExp(`add_subdirectory\\(\\s*["']?${subprojectName}["']?\\s*\\)`, 'i');
  if (!targetRegex.test(existingContent)) {
    const trailingNewline = existingContent.endsWith('\n') ? '' : '\n';
    existingContent += `${trailingNewline}${addSubdirLine}`;
  }

  fs.writeFileSync(parentCMakePath, existingContent, 'utf8');
}

function cleanupParentCMakeLists(parentDir, folderName) {
  const parentCMakePath = path.join(parentDir, 'CMakeLists.txt');
  if (!fs.existsSync(parentCMakePath)) return;

  try {
    let content = fs.readFileSync(parentCMakePath, 'utf8');
    const targetRegex = new RegExp(
      `[\\t ]*add_subdirectory\\(\\s*["']?${folderName}["']?\\s*\\)[\\r\\n]*`,
      'gi'
    );
    if (targetRegex.test(content)) {
      content = content.replace(targetRegex, '');
      fs.writeFileSync(parentCMakePath, content, 'utf8');
    }
  } catch (err) {
    console.error(`[CLion Suite] Failed to clean CMakeLists.txt: ${err.message}`);
  }
}

/* ============================================================
 * launch.json (lldb-dap)
 * ============================================================ */

function registerLaunchConfiguration(rootFolder, projectName) {
  const vscodeDir = path.join(rootFolder, '.vscode');
  const launchPath = path.join(vscodeDir, 'launch.json');

  if (!fs.existsSync(vscodeDir)) {
    fs.mkdirSync(vscodeDir, { recursive: true });
  }

  let launchConfig = { version: '0.2.0', configurations: [] };

  if (fs.existsSync(launchPath)) {
    try {
      launchConfig = JSON.parse(fs.readFileSync(launchPath, 'utf8'));
      if (!Array.isArray(launchConfig.configurations)) {
        launchConfig.configurations = [];
      }
    } catch {
      launchConfig = { version: '0.2.0', configurations: [] };
    }
  }

  const configName = `Debug Subproject: ${projectName}`;
  const alreadyExists = launchConfig.configurations.some((c) => c.name === configName);

  if (!alreadyExists) {
    const isWindows = process.platform === 'win32';
    const binaryExt = isWindows ? '.exe' : '';

    // Modern LLVM native debugging via lldb-dap
    launchConfig.configurations.push({
      name: configName,
      type: 'lldb-dap',
      request: 'launch',
      program: `\${workspaceFolder}/build/${projectName}/${projectName}${binaryExt}`,
      args: [],
      cwd: `\${workspaceFolder}`,
      env: [],
      stopOnEntry: false,
      // Ensure the target is built before debugging (requires a matching task if used)
      preLaunchTask: `CMake: build ${projectName}`
    });

    fs.writeFileSync(launchPath, JSON.stringify(launchConfig, null, 2), 'utf8');
  }

  return configName;
}

function cleanupLaunchConfiguration(rootFolder, folderName) {
  const launchPath = path.join(rootFolder, '.vscode', 'launch.json');
  if (!fs.existsSync(launchPath)) return;

  try {
    const launchConfig = JSON.parse(fs.readFileSync(launchPath, 'utf8'));
    const targetConfigName = `Debug Subproject: ${folderName}`;

    if (Array.isArray(launchConfig.configurations)) {
      const originalCount = launchConfig.configurations.length;
      launchConfig.configurations = launchConfig.configurations.filter(
        (cfg) => cfg.name !== targetConfigName
      );

      if (launchConfig.configurations.length !== originalCount) {
        fs.writeFileSync(launchPath, JSON.stringify(launchConfig, null, 2), 'utf8');
      }
    }
  } catch {
    // Ignore JSON parsing errors
  }
}

/* ============================================================
 * .gitignore + workspace settings (clangd wiring)
 * ============================================================ */

function ensureGitignore(rootFolder) {
  const gitignorePath = path.join(rootFolder, '.gitignore');
  const entries = [
    'build/',
    'bin/',
    'cmake-build-*/',
    '.idea/',
    '.vscode/*',
    'compile_commands.json',
    '!.vscode/launch.json',
    '!.vscode/settings.json'
  ];

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, entries.join('\n') + '\n', 'utf8');
    return;
  }

  let content = fs.readFileSync(gitignorePath, 'utf8');
  let appended = false;
  for (const entry of entries) {
    if (!content.includes(entry)) {
      content += (content.endsWith('\n') ? '' : '\n') + entry;
      appended = true;
    }
  }
  if (appended) {
    fs.writeFileSync(gitignorePath, content + '\n', 'utf8');
  }
}

function ensureWorkspaceSettings(rootFolder) {
  const vscodeDir = path.join(rootFolder, '.vscode');
  const settingsPath = path.join(vscodeDir, 'settings.json');

  if (!fs.existsSync(vscodeDir)) {
    fs.mkdirSync(vscodeDir, { recursive: true });
  }

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      settings = {};
    }
  }

  let modified = false;

  // Disable Microsoft IntelliSense so clangd is the single source of truth
  if (settings['C_Cpp.intelliSenseEngine'] !== 'disabled') {
    settings['C_Cpp.intelliSenseEngine'] = 'disabled';
    modified = true;
  }

  if (!settings['clangd.arguments']) {
    settings['clangd.arguments'] = [
      '--compile-commands-dir=${workspaceFolder}/build',
      '--header-insertion=iwyu',
      '--completion-style=detailed',
      '--background-index',
      '--clang-tidy'
    ];
    modified = true;
  }

  // Ensure cmake-tools exports compile_commands into the build dir clangd reads
  if (settings['cmake.buildDirectory'] === undefined) {
    settings['cmake.buildDirectory'] = '${workspaceFolder}/build';
    modified = true;
  }
  if (settings['cmake.configureSettings'] === undefined) {
    settings['cmake.configureSettings'] = { CMAKE_EXPORT_COMPILE_COMMANDS: 'ON' };
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }
}

/* ============================================================
 * Target discovery (CLion-style target dropdown)
 * ============================================================ */

function discoverTargets(rootFolder) {
  // Lightweight discovery: each immediate subfolder with a CMakeLists.txt
  // that is referenced by the root CMakeLists via add_subdirectory().
  const rootCMake = path.join(rootFolder, 'CMakeLists.txt');
  const targets = [];
  if (!fs.existsSync(rootCMake)) return targets;

  let rootContent = '';
  try {
    rootContent = fs.readFileSync(rootCMake, 'utf8');
  } catch {
    return targets;
  }

  const subdirRegex = /add_subdirectory\(\s*["']?([a-zA-Z0-9_\-/]+)["']?\s*\)/g;
  let match;
  while ((match = subdirRegex.exec(rootContent)) !== null) {
    const name = match[1];
    const subCMake = path.join(rootFolder, name, 'CMakeLists.txt');
    if (fs.existsSync(subCMake)) {
      targets.push(name);
    }
  }
  return targets;
}

/* ============================================================
 * Status bar: active target + build type (CLion-style)
 * ============================================================ */

let targetStatusItem;
let buildTypeStatusItem;

function updateStatusBar(context) {
  const target = context.workspaceState.get('clionSuite.activeTarget', '(no target)');
  const buildType = context.workspaceState.get(
    'clionSuite.buildType',
    getConfig().get('defaultBuildType', 'Debug')
  );

  if (targetStatusItem) {
    targetStatusItem.text = `$(target) ${target}`;
    targetStatusItem.tooltip = 'CLion Suite: Active CMake Target';
    targetStatusItem.show();
  }
  if (buildTypeStatusItem) {
    buildTypeStatusItem.text = `$(gear) ${buildType}`;
    buildTypeStatusItem.tooltip = 'CLion Suite: CMake Build Type';
    buildTypeStatusItem.show();
  }
}

/* ============================================================
 * Command Implementations
 * ============================================================ */

async function cmdSelectActiveTarget(context) {
  const root = primaryWorkspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('CLion Suite: No workspace folder open.');
    return;
  }
  const targets = discoverTargets(root);
  if (targets.length === 0) {
    vscode.window.showWarningMessage('CLion Suite: No CMake subproject targets found.');
    return;
  }
  const pick = await vscode.window.showQuickPick(targets, {
    title: 'Select Active CMake Target',
    placeHolder: 'Choose the target to build/run/debug'
  });
  if (!pick) return;
  await context.workspaceState.update('clionSuite.activeTarget', pick);
  updateStatusBar(context);
}

async function cmdSelectBuildType(context) {
  const pick = await vscode.window.showQuickPick(
    ['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel'],
    { title: 'Select CMake Build Type', placeHolder: 'CLion-style configuration' }
  );
  if (!pick) return;
  await context.workspaceState.update('clionSuite.buildType', pick);

  // Delegate to cmake-tools to apply the variant where possible
  try {
    await vscode.commands.executeCommand('cmake.setBuildType', pick);
  } catch {
    // cmake-tools may expose this differently across versions; status bar still reflects choice
  }
  updateStatusBar(context);
}

async function cmdConfigure() {
  try {
    await vscode.commands.executeCommand('cmake.configure');
  } catch (err) {
    vscode.window.showErrorMessage(`CLion Suite: Configure failed. ${err.message}`);
  }
}

async function resolveActiveTarget(context) {
  let target = context.workspaceState.get('clionSuite.activeTarget', null);
  if (!target) {
    await cmdSelectActiveTarget(context);
    target = context.workspaceState.get('clionSuite.activeTarget', null);
  }
  return target;
}

async function cmdBuildTarget(context) {
  const target = await resolveActiveTarget(context);
  if (!target) return;
  try {
    // Prefer cmake-tools driver; builds the whole project (clangd-friendly).
    await vscode.commands.executeCommand('cmake.build');
    vscode.window.showInformationMessage(`CLion Suite: Build triggered (target: ${target}).`);
  } catch (err) {
    vscode.window.showErrorMessage(`CLion Suite: Build failed. ${err.message}`);
  }
}

async function cmdRunTarget(context) {
  const root = primaryWorkspaceRoot();
  const target = await resolveActiveTarget(context);
  if (!root || !target) return;

  const isWindows = process.platform === 'win32';
  const binaryExt = isWindows ? '.exe' : '';
  const binaryPath = path.join(root, 'build', target, `${target}${binaryExt}`);

  if (!fs.existsSync(binaryPath)) {
    vscode.window.showWarningMessage(
      `CLion Suite: Binary not found for "${target}". Build it first.`
    );
    return;
  }

  const terminal = vscode.window.createTerminal({ name: `Run: ${target}`, cwd: root });
  terminal.show();
  terminal.sendText(`"${binaryPath}"`);
}

async function cmdDebugTarget(context) {
  const root = primaryWorkspaceRoot();
  const target = await resolveActiveTarget(context);
  if (!root || !target) return;

  const configName = `Debug Subproject: ${target}`;
  registerLaunchConfiguration(root, target); // ensure the lldb-dap config exists

  const folder = vscode.workspace.workspaceFolders[0];
  const started = await vscode.debug.startDebugging(folder, configName);
  if (!started) {
    vscode.window.showErrorMessage(
      `CLion Suite: Could not start lldb-dap session "${configName}".`
    );
  }
}

async function cmdSyncWorkspace() {
  const folders = vscode.workspace.workspaceFolders || [];
  for (const folder of folders) {
    const root = folder.uri.fsPath;
    ensureWorkspaceSettings(root);
    ensureGitignore(root);
  }
  vscode.window.showInformationMessage('CLion Suite: Workspace configuration synced.');
}

async function cmdNewSubproject(context, uri) {
  let targetDir;
  if (uri && uri.fsPath) {
    const stats = fs.statSync(uri.fsPath);
    targetDir = stats.isDirectory() ? uri.fsPath : path.dirname(uri.fsPath);
  } else if (primaryWorkspaceRoot()) {
    targetDir = primaryWorkspaceRoot();
  } else {
    vscode.window.showErrorMessage('CLion Suite: No active workspace folder found.');
    return;
  }

  const subprojectName = await vscode.window.showInputBox({
    title: 'New CMake Subproject',
    prompt: 'Enter project name (must start with a letter or underscore)',
    placeHolder: 'e.g., core_engine or my_app',
    validateInput: (value) => {
      if (!value || value.trim() === '') return 'Project name cannot be empty.';
      const trimmed = value.trim();
      if (/^[0-9]/.test(trimmed)) {
        return 'C/C++ project names cannot start with a number (use "project_02" instead of "02_project").';
      }
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
        return 'Only letters, numbers, and underscores are allowed (no spaces or special symbols).';
      }
      return null;
    }
  });
  if (!subprojectName) return;

  const trimmedName = subprojectName.trim();
  const identifier = toValidIdentifier(trimmedName);
  const projectFolder = path.join(targetDir, trimmedName);

  if (fs.existsSync(projectFolder)) {
    vscode.window.showErrorMessage(`Directory "${trimmedName}" already exists in this folder.`);
    return;
  }

  const projectType = await vscode.window.showQuickPick(
    ['Executable', 'Static Library', 'Shared Library'],
    { title: 'Project Artifact Type', placeHolder: 'Select target type' }
  );
  if (!projectType) return;

  const language = await vscode.window.showQuickPick(['C++', 'C'], {
    title: 'Programming Language',
    placeHolder: 'Select language'
  });
  if (!language) return;

  const cfg = getConfig();
  let standardOptions;
  if (language === 'C++') {
    standardOptions = ['17', '20', '23', '14'];
    const def = cfg.get('defaultCppStandard', '20');
    standardOptions = [def, ...standardOptions.filter((s) => s !== def)];
  } else {
    standardOptions = ['11', '17', '99', '23'];
    const def = cfg.get('defaultCStandard', '17');
    standardOptions = [def, ...standardOptions.filter((s) => s !== def)];
  }

  const standard = await vscode.window.showQuickPick(standardOptions, {
    title: `${language} Standard`,
    placeHolder: `Select ${language} standard`
  });
  if (!standard) return;

  try {
    const includeDir = path.join(projectFolder, 'include');
    const srcDir = path.join(projectFolder, 'src');
    fs.mkdirSync(includeDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    const isCpp = language === 'C++';
    const headerExt = isCpp ? '.hpp' : '.h';
    const sourceExt = isCpp ? '.cpp' : '.c';

    fs.writeFileSync(
      path.join(projectFolder, 'CMakeLists.txt'),
      getSubprojectCMakeLists(trimmedName, language, standard, projectType),
      'utf8'
    );

    const headerPath = path.join(includeDir, `${trimmedName}${headerExt}`);
    fs.writeFileSync(headerPath, getHeaderTemplate(identifier, isCpp), 'utf8');

    const sourceFileName =
      projectType === 'Executable' ? `main${sourceExt}` : `${trimmedName}${sourceExt}`;
    const sourcePath = path.join(srcDir, sourceFileName);
    fs.writeFileSync(
      sourcePath,
      getSourceTemplate(trimmedName, identifier, language, projectType),
      'utf8'
    );

    linkParentCMakeLists(targetDir, trimmedName);
    ensureGitignore(targetDir);
    ensureWorkspaceSettings(targetDir);

    if (projectType === 'Executable') {
      registerLaunchConfiguration(targetDir, trimmedName);
    }

    // Set as active target for immediate build/run/debug
    await context.workspaceState.update('clionSuite.activeTarget', trimmedName);
    updateStatusBar(context);

    const textDoc = await vscode.workspace.openTextDocument(sourcePath);
    await vscode.window.showTextDocument(textDoc, { preview: false });

    vscode.window.showInformationMessage(
      `CLion Suite: ${projectType} "${trimmedName}" created and set as active target.`
    );
  } catch (err) {
    vscode.window.showErrorMessage(`CLion Suite Error: ${err.message}`);
  }
}

/* ============================================================
 * Lifecycle
 * ============================================================ */

function activate(context) {
  // Sync settings/gitignore for every open workspace folder on launch
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    folders.forEach((folder) => {
      ensureWorkspaceSettings(folder.uri.fsPath);
      ensureGitignore(folder.uri.fsPath);
    });
  }

  // Status bar items (CLion-style active target + build type)
  targetStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  targetStatusItem.command = 'clionSuite.selectActiveTarget';
  buildTypeStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  buildTypeStatusItem.command = 'clionSuite.selectBuildType';
  context.subscriptions.push(targetStatusItem, buildTypeStatusItem);
  updateStatusBar(context);

  // File watcher: auto-cleanup on delete (configurable)
  const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
  fileWatcher.onDidDelete((uri) => {
    if (!getConfig().get('autoCleanupOnDelete', true)) return;

    const deletedPath = uri.fsPath;
    const parentDir = path.dirname(deletedPath);
    const folderName = path.basename(deletedPath);

    cleanupParentCMakeLists(parentDir, folderName);
    cleanupLaunchConfiguration(parentDir, folderName);

    // If the deleted folder was the active target, reset it
    const active = context.workspaceState.get('clionSuite.activeTarget', null);
    if (active === folderName) {
      context.workspaceState.update('clionSuite.activeTarget', null);
      updateStatusBar(context);
    }
  });
  context.subscriptions.push(fileWatcher);

  // Command registration
  context.subscriptions.push(
    vscode.commands.registerCommand('clionSuite.newSubproject', (uri) =>
      cmdNewSubproject(context, uri)
    ),
    vscode.commands.registerCommand('clionSuite.configure', () => cmdConfigure()),
    vscode.commands.registerCommand('clionSuite.buildTarget', () => cmdBuildTarget(context)),
    vscode.commands.registerCommand('clionSuite.runTarget', () => cmdRunTarget(context)),
    vscode.commands.registerCommand('clionSuite.debugTarget', () => cmdDebugTarget(context)),
    vscode.commands.registerCommand('clionSuite.selectActiveTarget', () =>
      cmdSelectActiveTarget(context)
    ),
    vscode.commands.registerCommand('clionSuite.selectBuildType', () =>
      cmdSelectBuildType(context)
    ),
    vscode.commands.registerCommand('clionSuite.syncWorkspace', () => cmdSyncWorkspace())
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
