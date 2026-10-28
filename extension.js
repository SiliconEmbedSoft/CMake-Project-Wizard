const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function toValidIdentifier(name) {
  let cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_');
  if (/^[0-9]/.test(cleaned)) {
    cleaned = 'proj_' + cleaned;
  }
  return cleaned;
}

function getSubprojectCMakeLists(projectName, language, standard, projectType) {
  const isCpp = language === 'C++';
  const langKey = isCpp ? 'CXX' : 'C';
  const stdDirective = isCpp
    ? `set(CMAKE_CXX_STANDARD ${standard})\nset(CMAKE_CXX_STANDARD_REQUIRED ON)`
    : `set(CMAKE_C_STANDARD ${standard})\nset(CMAKE_C_STANDARD_REQUIRED ON)`;

  const globPattern = isCpp ? 'src/*.cpp' : 'src/*.c';

  let targetBlock = '';
  if (projectType === 'Executable') {
    targetBlock = `add_executable(\${PROJECT_NAME} \${SOURCES})`;
  } else if (projectType === 'Static Library') {
    targetBlock = `add_library(\${PROJECT_NAME} STATIC \${SOURCES})`;
  } else {
    targetBlock = `add_library(\${PROJECT_NAME} SHARED \${SOURCES})`;
  }

  return `cmake_minimum_required(VERSION 3.15)
project(${projectName} LANGUAGES ${langKey})

${stdDirective}

file(GLOB_RECURSE SOURCES "${globPattern}")

${targetBlock}

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

function linkParentCMakeLists(parentDir, subprojectName) {
  const parentCMakePath = path.join(parentDir, 'CMakeLists.txt');
  const addSubdirLine = `add_subdirectory(${subprojectName})\n`;

  if (!fs.existsSync(parentCMakePath)) {
    const exactWorkspaceName = toValidIdentifier(path.basename(parentDir)) || 'WorkspaceRoot';
    const parentTemplate = `cmake_minimum_required(VERSION 3.15)
project(${exactWorkspaceName} LANGUAGES C CXX)

# Export compilation commands for clangd
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

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

/**
 * Removes add_subdirectory line from root CMakeLists.txt when a directory is deleted
 */
function cleanupParentCMakeLists(parentDir, folderName) {
  const parentCMakePath = path.join(parentDir, 'CMakeLists.txt');
  if (!fs.existsSync(parentCMakePath)) return;

  try {
    let content = fs.readFileSync(parentCMakePath, 'utf8');
    const targetRegex = new RegExp(`[\\t ]*add_subdirectory\\(\\s*["']?${folderName}["']?\\s*\\)[\\r\\n]*`, 'gi');
    if (targetRegex.test(content)) {
      content = content.replace(targetRegex, '');
      fs.writeFileSync(parentCMakePath, content, 'utf8');
    }
  } catch (err) {
    console.error(`Failed to clean CMakeLists.txt: ${err.message}`);
  }
}

/**
 * Cleans up debug targets in launch.json when a subproject folder is deleted
 */
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

/**
 * Directs clangd to compile_commands.json and disables Microsoft IntelliSense
 * to prevent conflicting autocomplete, high CPU usage, and duplicate squigglies.
 */
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

  // Turn off Microsoft's engine so clangd operates cleanly
  if (settings['C_Cpp.intelliSenseEngine'] !== 'disabled') {
    settings['C_Cpp.intelliSenseEngine'] = 'disabled';
    modified = true;
  }

  // Supply compilation commands to clangd
  if (!settings['clangd.arguments']) {
    settings['clangd.arguments'] = [
      '--compile-commands-dir=${workspaceFolder}/build',
      '--header-insertion=iwyu',
      '--completion-style=detailed'
    ];
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }
}

/**
 * Registers a standard verified Microsoft cppdbg configuration in .vscode/launch.json.
 */
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
    } catch {
      launchConfig = { version: '0.2.0', configurations: [] };
    }
  }

  const configName = `Debug Subproject: ${projectName}`;
  const alreadyExists = launchConfig.configurations.some((c) => c.name === configName);

  if (!alreadyExists) {
    const isWindows = process.platform === 'win32';
    const binaryExt = isWindows ? '.exe' : '';

    launchConfig.configurations.push({
      name: configName,
      type: 'cppdbg',
      request: 'launch',
      program: `\${workspaceFolder}/build/${projectName}/${projectName}${binaryExt}`,
      args: [],
      stopAtEntry: false,
      cwd: `\${workspaceFolder}`,
      environment: [],
      externalConsole: false,
      MIMode: isWindows ? undefined : 'gdb',
      setupCommands: isWindows
        ? undefined
        : [
            {
              description: 'Enable pretty-printing for gdb',
              text: '-enable-pretty-printing',
              ignoreFailures: true
            }
          ]
    });

    fs.writeFileSync(launchPath, JSON.stringify(launchConfig, null, 2), 'utf8');
  }
}

function activate(context) {
  // Sync workspace settings on launch for all open folders
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    vscode.workspace.workspaceFolders.forEach((folder) => {
      ensureWorkspaceSettings(folder.uri.fsPath);
    });
  }

  // File watcher to clean up deleted directories from CMakeLists.txt and launch.json
  const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
  fileWatcher.onDidDelete((uri) => {
    const deletedPath = uri.fsPath;
    const parentDir = path.dirname(deletedPath);
    const folderName = path.basename(deletedPath);

    cleanupParentCMakeLists(parentDir, folderName);
    cleanupLaunchConfiguration(parentDir, folderName);
  });
  context.subscriptions.push(fileWatcher);

  // Command registration
  const disposable = vscode.commands.registerCommand(
    'quickCMakeWizard.newSubproject',
    async (uri) => {
      let targetDir;
      if (uri && uri.fsPath) {
        const stats = fs.statSync(uri.fsPath);
        targetDir = stats.isDirectory() ? uri.fsPath : path.dirname(uri.fsPath);
      } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        targetDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
      } else {
        vscode.window.showErrorMessage('CMake Wizard: No active workspace folder found.');
        return;
      }

      const subprojectName = await vscode.window.showInputBox({
        title: 'New CMake Subproject',
        prompt: 'Enter project name (must start with a letter or underscore)',
        placeHolder: 'e.g., testing_02 or my_project',
        validateInput: (value) => {
          if (!value || value.trim() === '') {
            return 'Project name cannot be empty.';
          }
          const trimmed = value.trim();
          if (/^[0-9]/.test(trimmed)) {
            return 'C/C++ project names cannot start with a number (e.g. use "project_02" instead of "02_project").';
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

      const standardOptions = language === 'C++' ? ['17', '20', '23', '14'] : ['11', '99', '17'];
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

        const sourceFileName = projectType === 'Executable' ? `main${sourceExt}` : `${trimmedName}${sourceExt}`;
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

        const textDoc = await vscode.workspace.openTextDocument(sourcePath);
        await vscode.window.showTextDocument(textDoc, { preview: false });

        vscode.window.showInformationMessage(
          `CMake ${projectType} "${trimmedName}" created successfully.`
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Wizard Error: ${err.message}`);
      }
    }
  );

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
