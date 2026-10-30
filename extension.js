const vscode = require('vscode');
const path = require('path');

/* ------------------------------------------------------------------ */
/* Status bar items                                                    */
/* ------------------------------------------------------------------ */

let targetStatusItem;
let buildTypeStatusItem;

let activeTarget = '';
let activeBuildType = 'Debug';

async function createStatusBarItems(context) {
  const cfg = vscode.workspace.getConfiguration('cmakeProjectWizard');

  const targetPriority = cfg.get('statusBar.targetPriority', 49);
  const buildTypePriority = cfg.get('statusBar.buildTypePriority', 49);

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

  await discoverTargets();
  updateStatusBar();
}

function updateStatusBar() {
  const cfg = vscode.workspace.getConfiguration('cmakeProjectWizard');

  if (targetStatusItem) {
    if (cfg.get('statusBar.showTarget', true) && activeTarget) {
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

/* ------------------------------------------------------------------ */
/* Target discovery for the dropdown                                   */
/* ------------------------------------------------------------------ */

/**
 * Collect candidate targets by scanning CMakeLists.txt files for
 * add_executable(<name> ...) and add_library(<name> ...).
 * Includes 'all' only when subprojects exist.
 */
async function discoverTargets() {
  const rootUri = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri;
  const folderType = rootUri ? await classifyFolder(rootUri) : 'none';

  const targets = new Set(folderType === 'subprojects' ? ['all'] : []);

  const files = await vscode.workspace.findFiles(
    '**/CMakeLists.txt',
    '**/build/**'
  );

  const re = /\badd_(?:executable|library)\s*\(\s*([A-Za-z0-9_]+)/g;

  for (const file of files) {
    try {
      const bytes = await vscode.workspace.fs.readFile(file);
      const text = Buffer.from(bytes).toString('utf8').replace(/#.*$/gm, '');
      let m;
      while ((m = re.exec(text)) !== null) {
        targets.add(m[1]);
      }
    } catch {
      // ignore unreadable file
    }
  }

  const result = Array.from(targets);

  if (folderType === 'single') {
    if (!activeTarget || activeTarget === 'all' || !result.includes(activeTarget)) {
      activeTarget = result[0] || '';
    }
  } else if (folderType === 'subprojects') {
    if (!activeTarget || (!result.includes(activeTarget) && activeTarget !== 'all')) {
      activeTarget = 'all';
    }
  }

  return result;
}

async function selectActiveTarget() {
  const targets = await discoverTargets();

  if (targets.length === 0) {
    vscode.window.showInformationMessage('No CMake targets found.');
    return;
  }

  const picked = await vscode.window.showQuickPick(targets, {
    placeHolder: 'Select active target',
    matchOnDescription: true
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

function sanitizeName(name) {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

/**
 * Classify a folder:
 *   'subprojects' -> root uses add_subdirectory() or has nested CMakeLists.txt
 *   'single'      -> root CMakeLists.txt defines project()/targets but no subdirs
 *   'none'        -> no CMake structure yet
 */
async function classifyFolder(folderUri) {
  const rootCmake = vscode.Uri.joinPath(folderUri, 'CMakeLists.txt');

  let rootText = null;
  try {
    rootText = (await readText(rootCmake)).replace(/#.*$/gm, '');
  } catch {
    rootText = null;
  }

  if (rootText && /\badd_subdirectory\s*\(/.test(rootText)) {
    return 'subprojects';
  }

  // Nested CMakeLists.txt in any immediate child folder => subprojects.
  try {
    const entries = await vscode.workspace.fs.readDirectory(folderUri);
    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory && name !== 'build') {
        const childCmake = vscode.Uri.joinPath(folderUri, name, 'CMakeLists.txt');
        if (await fileExists(childCmake)) {
          return 'subprojects';
        }
      }
    }
  } catch {
    // ignore
  }

  if (rootText) {
    const isProject = /\bproject\s*\(/.test(rootText);
    const hasTarget = /\badd_(?:executable|library)\s*\(/.test(rootText);
    if (isProject || hasTarget) {
      return 'single';
    }
  }

  return 'none';
}

/**
 * Automatically cleans up stale add_subdirectory(...) entries in root CMakeLists.txt
 * if a subproject directory was removed.
 */
async function cleanupDeletedSubdirectory(deletedUri) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(deletedUri);
  if (!workspaceFolder) {
    return;
  }

  const rootCmakeUri = vscode.Uri.joinPath(workspaceFolder.uri, 'CMakeLists.txt');
  if (!(await fileExists(rootCmakeUri))) {
    return;
  }

  const dirName = path.basename(deletedUri.fsPath);
  const content = await readText(rootCmakeUri);

  const regex = new RegExp(`^[ \\t]*add_subdirectory\\s*\\(\\s*${dirName}\\b[^)]*\\)\\r?\\n?`, 'gm');

  if (regex.test(content)) {
    const updated = content.replace(regex, '');
    await writeText(rootCmakeUri, updated);

    await discoverTargets();
    updateStatusBar();

    try {
      await vscode.commands.executeCommand('cmake.configure');
    } catch {
      // ignore
    }
  }
}

/* ------------------------------------------------------------------ */
/* Language selection                                                  */
/* ------------------------------------------------------------------ */

async function pickLanguage() {
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'C++', value: 'cpp' },
      { label: 'C', value: 'c' }
    ],
    { placeHolder: 'Select language' }
  );
  return picked ? picked.value : undefined;
}

/* ------------------------------------------------------------------ */
/* Single-project conversion                                           */
/* ------------------------------------------------------------------ */

function buildRootCmakeLists(projectName, lang, cfg) {
  const minReq = cfg.get('cmake.minimumRequired', '3.21');
  const cxx = cfg.get('cmake.cxxStandard', '20');
  const c = cfg.get('cmake.cStandard', '17');
  const buildType = cfg.get('cmake.defaultBuildType', 'Debug');

  const languages = lang === 'c' ? 'C' : 'C CXX';
  const mainFile = lang === 'c' ? 'src/main.c' : 'src/main.cpp';

  const stdBlock =
    lang === 'c'
      ? `set(CMAKE_C_STANDARD ${c})\nset(CMAKE_C_STANDARD_REQUIRED ON)`
      : `set(CMAKE_C_STANDARD ${c})\nset(CMAKE_C_STANDARD_REQUIRED ON)\nset(CMAKE_CXX_STANDARD ${cxx})\nset(CMAKE_CXX_STANDARD_REQUIRED ON)`;

  return `cmake_minimum_required(VERSION ${minReq})

project(${projectName} LANGUAGES ${languages})

${stdBlock}

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE ${buildType} CACHE STRING "Build type" FORCE)
endif()

add_executable(${projectName}
  ${mainFile}
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

const SAMPLE_MAIN_C =
`#include <stdio.h>

int main(void) {
    printf("Hello, CMake!\\n");
    return 0;
}
`;

async function scaffoldSrcAndInclude(folderUri, projectName, lang) {
  const srcDir = vscode.Uri.joinPath(folderUri, 'src');
  const mainFile = vscode.Uri.joinPath(
    srcDir,
    lang === 'c' ? 'main.c' : 'main.cpp'
  );
  if (!(await fileExists(mainFile))) {
    await vscode.workspace.fs.createDirectory(srcDir);
    await writeText(mainFile, lang === 'c' ? SAMPLE_MAIN_C : SAMPLE_MAIN_CPP);
  }

  const includeDir = vscode.Uri.joinPath(folderUri, 'include', projectName);
  const headerExt = lang === 'c' ? 'h' : 'hpp';
  const header = vscode.Uri.joinPath(includeDir, `${projectName}.${headerExt}`);
  if (!(await fileExists(header))) {
    await vscode.workspace.fs.createDirectory(includeDir);
    const guard = sanitizeName(projectName).toUpperCase() + '_' + headerExt.toUpperCase();
    await writeText(
      header,
      `#ifndef ${guard}\n#define ${guard}\n\n// Public API for ${projectName}\n\n#endif // ${guard}\n`
    );
  }
}

async function convertToSingleProject(folderUri) {
  const cfg = vscode.workspace.getConfiguration('cmakeProjectWizard');

  const kind = await classifyFolder(folderUri);
  if (kind === 'subprojects') {
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

  const lang = await pickLanguage();
  if (!lang) {
    return;
  }

  await scaffoldSrcAndInclude(folderUri, projectName, lang);
  await writeText(rootCmake, buildRootCmakeLists(projectName, lang, cfg));

  const presetsUri = vscode.Uri.joinPath(folderUri, 'CMakePresets.json');
  if (!(await fileExists(presetsUri))) {
    await writeText(presetsUri, buildPresets(projectName, cfg));
  }

  vscode.window.showInformationMessage(
    `Initialized "${projectName}" as a single ${lang === 'c' ? 'C' : 'C++'} project.`
  );

  await discoverTargets();
  updateStatusBar();

  try {
    await vscode.commands.executeCommand('cmake.configure');
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* Subproject creation                                                 */
/* ------------------------------------------------------------------ */

function buildSubprojectCmakeLists(name, lang, cfg) {
  const cxx = cfg.get('cmake.cxxStandard', '20');
  const c = cfg.get('cmake.cStandard', '17');
  const mainFile = lang === 'c' ? 'src/main.c' : 'src/main.cpp';

  const props =
    lang === 'c'
      ? `  C_STANDARD ${c}\n  C_STANDARD_REQUIRED ON`
      : `  C_STANDARD ${c}\n  C_STANDARD_REQUIRED ON\n  CXX_STANDARD ${cxx}\n  CXX_STANDARD_REQUIRED ON`;

  return `add_executable(${name}
  ${mainFile}
)

set_target_properties(${name} PROPERTIES
${props}
)

target_include_directories(${name} PRIVATE include)
`;
}

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

  const kind = await classifyFolder(parentFolderUri);
  if (kind === 'single') {
    vscode.window.showErrorMessage(
      'This folder is already a single CMake project. ' +
      'Subprojects cannot be added to a single-project folder. ' +
      'Nothing was changed.'
    );
    return;
  }

  const rawName = await vscode.window.showInputBox({
    prompt: 'Subproject name',
    validateInput: (v) =>
      v && v.trim().length ? null : 'Name cannot be empty'
  });
  if (!rawName) {
    return;
  }
  const name = sanitizeName(rawName.trim());

  const lang = await pickLanguage();
  if (!lang) {
    return;
  }

  const subFolder = vscode.Uri.joinPath(parentFolderUri, name);
  if (await fileExists(subFolder)) {
    vscode.window.showErrorMessage(
      `A folder named "${name}" already exists here.`
    );
    return;
  }

  await vscode.workspace.fs.createDirectory(subFolder);
  await writeText(
    vscode.Uri.joinPath(subFolder, 'CMakeLists.txt'),
    buildSubprojectCmakeLists(name, lang, cfg)
  );
  await scaffoldSrcAndInclude(subFolder, name, lang);

  await wireAddSubdirectory(parentFolderUri, name, cfg);

  const presetsUri = vscode.Uri.joinPath(parentFolderUri, 'CMakePresets.json');
  if (!(await fileExists(presetsUri))) {
    const rootName = sanitizeName(path.basename(parentFolderUri.fsPath));
    await writeText(presetsUri, buildPresets(rootName, cfg));
  }

  vscode.window.showInformationMessage(
    `Created ${lang === 'c' ? 'C' : 'C++'} subproject "${name}".`
  );

  await discoverTargets();
  updateStatusBar();

  try {
    await vscode.commands.executeCommand('cmake.configure');
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* New File commands                                                   */
/* ------------------------------------------------------------------ */

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

async function promptFileName(defaultName) {
  return vscode.window.showInputBox({
    prompt: 'File name',
    value: defaultName,
    validateInput: (v) =>
      v && v.trim().length ? null : 'Name cannot be empty'
  });
}

function headerGuard(fileName) {
  return sanitizeName(fileName).toUpperCase().replace(/__+/g, '_');
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

async function newSource(resource) {
  const lang = await pickLanguage();
  if (!lang) {
    return;
  }
  if (lang === 'c') {
    await createFileFromTemplate(
      resource,
      'source.c',
      () => `#include <stdio.h>\n\n`
    );
  } else {
    await createFileFromTemplate(
      resource,
      'source.cpp',
      () => `#include <iostream>\n\n`
    );
  }
}

async function newHeader(resource) {
  const lang = await pickLanguage();
  if (!lang) {
    return;
  }
  const defaultName = lang === 'c' ? 'header.h' : 'header.hpp';
  await createFileFromTemplate(
    resource,
    defaultName,
    (name) => {
      const guard = headerGuard(name) + '_';
      return `#ifndef ${guard}\n#define ${guard}\n\n\n\n#endif // ${guard}\n`;
    }
  );
}

async function newLibraryTarget(resource) {
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

  const lang = await pickLanguage();
  if (!lang) {
    return;
  }

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
  const c = cfg.get('cmake.cStandard', '17');
  const srcExt = lang === 'c' ? 'c' : 'cpp';
  const headerExt = lang === 'c' ? 'h' : 'hpp';

  const stdProps =
    lang === 'c'
      ? `  C_STANDARD ${c}\n  C_STANDARD_REQUIRED ON`
      : `  CXX_STANDARD ${cxx}\n  CXX_STANDARD_REQUIRED ON`;

  let cmakeBody;
  if (kind === 'INTERFACE') {
    cmakeBody =
`add_library(${name} INTERFACE)
target_include_directories(${name} INTERFACE include)
`;
  } else {
    cmakeBody =
`add_library(${name} ${kind}
  src/${name}.${srcExt}
)

set_target_properties(${name} PROPERTIES
${stdProps}
)

target_include_directories(${name} PUBLIC include)
`;
  }
  await writeText(vscode.Uri.joinPath(libFolder, 'CMakeLists.txt'), cmakeBody);

  const incDir = vscode.Uri.joinPath(libFolder, 'include', name);
  await vscode.workspace.fs.createDirectory(incDir);
  const guard = name.toUpperCase() + '_' + headerExt.toUpperCase();
  await writeText(
    vscode.Uri.joinPath(incDir, `${name}.${headerExt}`),
    `#ifndef ${guard}\n#define ${guard}\n\n#endif // ${guard}\n`
  );

  if (kind !== 'INTERFACE') {
    const srcDir = vscode.Uri.joinPath(libFolder, 'src');
    await vscode.workspace.fs.createDirectory(srcDir);
    await writeText(
      vscode.Uri.joinPath(srcDir, `${name}.${srcExt}`),
      `#include "${name}/${name}.${headerExt}"\n`
    );
  }

  await wireAddSubdirectory(parent, name, cfg);
  vscode.window.showInformationMessage(
    `Created ${kind} ${lang === 'c' ? 'C' : 'C++'} library "${name}".`
  );

  await discoverTargets();
  updateStatusBar();

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

  // Auto-remove add_subdirectory when subproject folders are deleted
  const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  fileWatcher.onDidDelete((uri) => {
    cleanupDeletedSubdirectory(uri);
  });
  context.subscriptions.push(fileWatcher);

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
      'cmakeProjectWizard.newSource', newSource),
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
