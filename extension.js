const vscode = require('vscode');
const path = require('path');

/* ------------------------------------------------------------------ */
/* Status bar items                                                    */
/* ------------------------------------------------------------------ */

let targetStatusItem;
let buildTypeStatusItem;

let activeTarget = 'all';
let activeBuildType = 'Debug';

function createStatusBarItems(context) {
  const cfg = vscode.workspace.getConfiguration('cmakeProjectWizard');

  const targetPriority = cfg.get('statusBar.targetPriority', 10);
  const buildTypePriority = cfg.get('statusBar.buildTypePriority', 9);

  if (targetStatusItem) {
    targetStatusItem.dispose();
    targetStatusItem = undefined;
  }
  if (buildTypeStatusItem) {
    buildTypeStatusItem.dispose();
    buildTypeStatusItem = undefined;
  }

  targetStatusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    targetPriority
  );
  targetStatusItem.command = 'cmakeProjectWizard.selectActiveTarget';
  context.subscriptions.push(targetStatusItem);

  buildTypeStatusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    buildTypePriority
  );
  buildTypeStatusItem.command = 'cmakeProjectWizard.selectBuildType';
  context.subscriptions.push(buildTypeStatusItem);

  updateStatusBar();
}

function updateStatusBar() {
  const cfg = vscode.workspace.getConfiguration('cmakeProjectWizard');

  if (targetStatusItem) {
    if (cfg.get('statusBar.showTarget', true)) {
      targetStatusItem.text = `$(target) ${activeTarget}`;
      targetStatusItem.tooltip = 'CMake Project Wizard: active target';
      targetStatusItem.show();
    } else {
      targetStatusItem.hide();
    }
  }

  if (buildTypeStatusItem) {
    if (cfg.get('statusBar.showBuildType', true)) {
      buildTypeStatusItem.text = `$(gear) ${activeBuildType}`;
      buildTypeStatusItem.tooltip = 'CMake Project Wizard: build type';
      buildTypeStatusItem.show();
    } else {
      buildTypeStatusItem.hide();
    }
  }
}

async function selectActiveTarget() {
  const picked = await vscode.window.showInputBox({
    prompt: 'Active target name',
    value: activeTarget
  });
  if (picked) {
    activeTarget = picked;
    updateStatusBar();
  }
}

async function selectBuildType() {
  const picked = await vscode.window.showQuickPick(
    ['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel'],
    { placeHolder: 'Select build type' }
  );
  if (picked) {
    activeBuildType = picked;
    updateStatusBar();
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function fileExists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function readText(uri) {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

async function writeText(uri, text) {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
}

/**
 * Returns true if folder root CMakeLists.txt uses add_subdirectory(),
 * OR if any immediate child folder contains its own CMakeLists.txt.
 * Either is a strong signal that this folder hosts subprojects and must
 * NOT be converted to a single project.
 */
async function hasSubprojects(folderUri) {
  const rootCmake = vscode.Uri.joinPath(folderUri, 'CMakeLists.txt');
  try {
    const text = await readText(rootCmake);
    const stripped = text.replace(/#.*$/gm, '');
    if (/\badd_subdirectory\s*\(/.test(stripped)) {
      return true;
    }
  } catch {
    // no root CMakeLists.txt; keep checking children below
  }

  try {
    const entries = await vscode.workspace.fs.readDirectory(folderUri);
    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory) {
        const childCmake = vscode.Uri.joinPath(folderUri, name, 'CMakeLists.txt');
        if (await fileExists(childCmake)) {
          return true;
        }
      }
    }
  } catch {
    // ignore
  }

  return false;
}

function sanitizeName(name) {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

/* ------------------------------------------------------------------ */
/* Single-project conversion                                           */
/* ------------------------------------------------------------------ */

function buildRootCmakeLists(projectName, cfg) {
  const minReq = cfg.get('cmake.minimumRequired', '3.21');
  const cxx = cfg.get('cmake.cxxStandard', '20');
  const c = cfg.get('cmake.cStandard', '17');
  const buildType = cfg.get('cmake.defaultBuildType', 'Debug');

  return `cmake_minimum_required(VERSION ${minReq})

project(${projectName} LANGUAGES C CXX)

set(CMAKE_C_STANDARD ${c})
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD ${cxx})
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE ${buildType} CACHE STRING "Build type" FORCE)
endif()

add_executable(${projectName}
  src/main.cpp
)

target_include_directories(${projectName} PRIVATE include)
`;
}

function buildPresets(projectName, cfg) {
  const generator = cfg.get('presets.generator', 'Ninja');
  const binaryDir = cfg.get('presets.binaryDir', '${sourceDir}/build');
  const buildType = cfg.get('cmake.defaultBuildType', 'Debug');

  return JSON.stringify(
    {
      version: 3,
      cmakeMinimumRequired: { major: 3, minor: 21, patch: 0 },
      configurePresets: [
        {
          name: 'default',
          displayName: `${projectName} (${generator})`,
          generator,
          binaryDir,
          cacheVariables: { CMAKE_BUILD_TYPE: buildType }
        }
      ]
    },
    null,
    2
  ) + '\n';
}

const SAMPLE_MAIN_CPP =
`#include <iostream>

int main() {
    std::cout << "Hello, CMake!" << std::endl;
    return 0;
}
`;

async function scaffoldSrcAndInclude(folderUri, projectName) {
  // src/main.cpp
  const srcDir = vscode.Uri.joinPath(folderUri, 'src');
  const mainCpp = vscode.Uri.joinPath(srcDir, 'main.cpp');
  if (!(await fileExists(mainCpp))) {
    await vscode.workspace.fs.createDirectory(srcDir);
    await writeText(mainCpp, SAMPLE_MAIN_CPP);
  }

  // include/<projectName>/<projectName>.hpp
  const includeDir = vscode.Uri.joinPath(folderUri, 'include', projectName);
  const header = vscode.Uri.joinPath(includeDir, `${projectName}.hpp`);
  if (!(await fileExists(header))) {
    await vscode.workspace.fs.createDirectory(includeDir);
    const guard = sanitizeName(projectName).toUpperCase() + '_HPP';
    await writeText(
      header,
      `#ifndef ${guard}\n#define ${guard}\n\n// Public API for ${projectName}\n\n#endif // ${guard}\n`
    );
  }
}

async function convertToSingleProject(folderUri) {
  const cfg = vscode.workspace.getConfiguration('cmakeProjectWizard');

  // GUARD FIRST: bail out before writing anything if subprojects exist.
  if (await hasSubprojects(folderUri)) {
    vscode.window.showErrorMessage(
      'This folder already contains subprojects (add_subdirectory or nested ' +
      'CMakeLists.txt). It cannot be converted to a single project. ' +
      'Nothing was changed.'
    );
    return;
  }

  const projectName = sanitizeName(path.basename(folderUri.fsPath));
  const rootCmake = vscode.Uri.joinPath(folderUri, 'CMakeLists.txt');

  if (await fileExists(rootCmake)) {
    const choice = await vscode.window.showWarningMessage(
      'A CMakeLists.txt already exists. Overwrite it with a single-project template?',
      { modal: true },
      'Overwrite'
    );
    if (choice !== 'Overwrite') {
      return;
    }
  }

  await scaffoldSrcAndInclude(folderUri, projectName);

  await writeText(rootCmake, buildRootCmakeLists(projectName, cfg));

  const presetsUri = vscode.Uri.joinPath(folderUri, 'CMakePresets.json');
  if (!(await fileExists(presetsUri))) {
    await writeText(presetsUri, buildPresets(projectName, cfg));
  }

  vscode.window.showInformationMessage(
    `Initialized "${projectName}" as a single CMake project.`
  );

  try {
    await vscode.commands.executeCommand('cmake.configure');
  } catch {
    // CMake Tools not ready; safe to ignore.
  }
}

/* ------------------------------------------------------------------ */
/* Subproject creation (restored full flow)                            */
/* ------------------------------------------------------------------ */

function buildSubprojectCmakeLists(name, cfg) {
  const cxx = cfg.get('cmake.cxxStandard', '20');
  const c = cfg.get('cmake.cStandard', '17');

  return `add_executable(${name}
  src/main.cpp
)

set_target_properties(${name} PROPERTIES
  C_STANDARD ${c}
  C_STANDARD_REQUIRED ON
  CXX_STANDARD ${cxx}
  CXX_STANDARD_REQUIRED ON
)

target_include_directories(${name} PRIVATE include)
`;
}

/**
 * Append add_subdirectory(<name>) to the root CMakeLists.txt if not present.
 * Creates a minimal root if none exists.
 */
async function wireAddSubdirectory(rootFolderUri, name, cfg) {
  const rootCmake = vscode.Uri.joinPath(rootFolderUri, 'CMakeLists.txt');
  const line = `add_subdirectory(${name})`;

  if (await fileExists(rootCmake)) {
    const text = await readText(rootCmake);
    const stripped = text.replace(/#.*$/gm, '');
    const already = new RegExp(
      `\\badd_subdirectory\\s*\\(\\s*${name}\\s*\\)`
    ).test(stripped);
    if (!already) {
      const newline = text.endsWith('\n') ? '' : '\n';
      await writeText(rootCmake, text + newline + line + '\n');
    }
  } else {
    const minReq = cfg.get('cmake.minimumRequired', '3.21');
    const rootName = sanitizeName(path.basename(rootFolderUri.fsPath));
    const buildType = cfg.get('cmake.defaultBuildType', 'Debug');
    const content =
`cmake_minimum_required(VERSION ${minReq})

project(${rootName} LANGUAGES C CXX)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE ${buildType} CACHE STRING "Build type" FORCE)
endif()

${line}
`;
    await writeText(rootCmake, content);
  }
}

async function createSubproject(parentFolderUri) {
  const cfg = vscode.workspace.getConfiguration('cmakeProjectWizard');

  const rawName = await vscode.window.showInputBox({
    prompt: 'Subproject name',
    validateInput: (v) =>
      v && v.trim().length ? null : 'Name cannot be empty'
  });
  if (!rawName) {
    return;
  }
  const name = sanitizeName(rawName.trim());

  const subFolder = vscode.Uri.joinPath(parentFolderUri, name);
  if (await fileExists(subFolder)) {
    vscode.window.showErrorMessage(
      `A folder named "${name}" already exists here.`
    );
    return;
  }

  // Scaffold subproject: CMakeLists.txt, src/main.cpp, include/<name>/
  await vscode.workspace.fs.createDirectory(subFolder);
  await writeText(
    vscode.Uri.joinPath(subFolder, 'CMakeLists.txt'),
    buildSubprojectCmakeLists(name, cfg)
  );
  await scaffoldSrcAndInclude(subFolder, name);

  // Wire into the root CMakeLists.txt.
  await wireAddSubdirectory(parentFolderUri, name, cfg);

  // Create root CMakePresets.json if missing.
  const presetsUri = vscode.Uri.joinPath(parentFolderUri, 'CMakePresets.json');
  if (!(await fileExists(presetsUri))) {
    const rootName = sanitizeName(path.basename(parentFolderUri.fsPath));
    await writeText(presetsUri, buildPresets(rootName, cfg));
  }

  vscode.window.showInformationMessage(`Created subproject "${name}".`);

  try {
    await vscode.commands.executeCommand('cmake.configure');
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* New File commands                                                   */
/* ------------------------------------------------------------------ */

async function promptFileName(defaultName) {
  return vscode.window.showInputBox({
    prompt: 'File name',
    value: defaultName,
    validateInput: (v) =>
      v && v.trim().length ? null : 'Name cannot be empty'
  });
}

function resolveTargetDir(resource) {
  // If the right-clicked resource is a file, use its parent directory.
  if (resource) {
    return resource.with
      ? vscode.Uri.joinPath(resource, '..') // placeholder; corrected below
      : resource;
  }
  return undefined;
}

async function dirForResource(resource) {
  if (!resource) {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders[0] ? folders[0].uri : undefined;
  }
  try {
    const stat = await vscode.workspace.fs.stat(resource);
    if (stat.type === vscode.FileType.Directory) {
      return resource;
    }
    return vscode.Uri.joinPath(resource, '..');
  } catch {
    return resource;
  }
}

async function createFileFromTemplate(resource, defaultName, content) {
  const dir = await dirForResource(resource);
  if (!dir) {
    vscode.window.showErrorMessage('No folder selected.');
    return;
  }
  const name = await promptFileName(defaultName);
  if (!name) {
    return;
  }
  const fileUri = vscode.Uri.joinPath(dir, name.trim());
  if (await fileExists(fileUri)) {
    vscode.window.showErrorMessage(`"${name}" already exists.`);
    return;
  }
  await writeText(fileUri, content(name.trim()));
  const doc = await vscode.workspace.openTextDocument(fileUri);
  await vscode.window.showTextDocument(doc);
}

function headerGuard(fileName) {
  return sanitizeName(fileName).toUpperCase().replace(/__+/g, '_');
}

async function newCSource(resource) {
  await createFileFromTemplate(
    resource,
    'source.c',
    () => `#include <stdio.h>\n\n`
  );
}

async function newCppSource(resource) {
  await createFileFromTemplate(
    resource,
    'source.cpp',
    () => `#include <iostream>\n\n`
  );
}

async function newHeader(resource) {
  await createFileFromTemplate(
    resource,
    'header.hpp',
    (name) => {
      const guard = headerGuard(name) + '_';
      return `#ifndef ${guard}\n#define ${guard}\n\n\n\n#endif // ${guard}\n`;
    }
  );
}

async function newLibraryTarget(resource) {
  // Scaffolds a library subfolder: CMakeLists.txt + src + include.
  const parent = await dirForResource(resource);
  if (!parent) {
    vscode.window.showErrorMessage('No folder selected.');
    return;
  }
  const cfg = vscode.workspace.getConfiguration('cmakeProjectWizard');

  const rawName = await vscode.window.showInputBox({
    prompt: 'Library target name',
    validateInput: (v) =>
      v && v.trim().length ? null : 'Name cannot be empty'
  });
  if (!rawName) {
    return;
  }
  const name = sanitizeName(rawName.trim());

  const kind = await vscode.window.showQuickPick(
    ['STATIC', 'SHARED', 'INTERFACE'],
    { placeHolder: 'Library type' }
  );
  if (!kind) {
    return;
  }

  const libFolder = vscode.Uri.joinPath(parent, name);
  if (await fileExists(libFolder)) {
    vscode.window.showErrorMessage(`"${name}" already exists.`);
    return;
  }

  await vscode.workspace.fs.createDirectory(libFolder);

  const cxx = cfg.get('cmake.cxxStandard', '20');
  let cmakeBody;
  if (kind === 'INTERFACE') {
    cmakeBody =
`add_library(${name} INTERFACE)
target_include_directories(${name} INTERFACE include)
`;
  } else {
    cmakeBody =
`add_library(${name} ${kind}
  src/${name}.cpp
)

set_target_properties(${name} PROPERTIES
  CXX_STANDARD ${cxx}
  CXX_STANDARD_REQUIRED ON
)

target_include_directories(${name} PUBLIC include)
`;
  }
  await writeText(vscode.Uri.joinPath(libFolder, 'CMakeLists.txt'), cmakeBody);

  // include header
  const incDir = vscode.Uri.joinPath(libFolder, 'include', name);
  await vscode.workspace.fs.createDirectory(incDir);
  const guard = name.toUpperCase() + '_HPP';
  await writeText(
    vscode.Uri.joinPath(incDir, `${name}.hpp`),
    `#ifndef ${guard}\n#define ${guard}\n\n#endif // ${guard}\n`
  );

  // source (not for INTERFACE)
  if (kind !== 'INTERFACE') {
    const srcDir = vscode.Uri.joinPath(libFolder, 'src');
    await vscode.workspace.fs.createDirectory(srcDir);
    await writeText(
      vscode.Uri.joinPath(srcDir, `${name}.cpp`),
      `#include "${name}/${name}.hpp"\n`
    );
  }

  await wireAddSubdirectory(parent, name, cfg);
  vscode.window.showInformationMessage(`Created ${kind} library "${name}".`);

  try {
    await vscode.commands.executeCommand('cmake.configure');
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* Activation                                                          */
/* ------------------------------------------------------------------ */

function withFolder(handler) {
  return async (resource) => {
    const folderUri = resource
      || (vscode.workspace.workspaceFolders &&
          vscode.workspace.workspaceFolders[0].uri);
    if (!folderUri) {
      vscode.window.showErrorMessage('No folder selected.');
      return;
    }
    await handler(folderUri);
  };
}

function activate(context) {
  createStatusBarItems(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cmakeProjectWizard.selectActiveTarget', selectActiveTarget),
    vscode.commands.registerCommand(
      'cmakeProjectWizard.selectBuildType', selectBuildType),
    vscode.commands.registerCommand(
      'cmakeProjectWizard.createSubproject', withFolder(createSubproject)),
    vscode.commands.registerCommand(
      'cmakeProjectWizard.convertToSingleProject', withFolder(convertToSingleProject)),
    vscode.commands.registerCommand(
      'cmakeProjectWizard.newCSource', newCSource),
    vscode.commands.registerCommand(
      'cmakeProjectWizard.newCppSource', newCppSource),
    vscode.commands.registerCommand(
      'cmakeProjectWizard.newHeader', newHeader),
    vscode.commands.registerCommand(
      'cmakeProjectWizard.newLibraryTarget', newLibraryTarget)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cmakeProjectWizard.statusBar')) {
        createStatusBarItems(context);
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
