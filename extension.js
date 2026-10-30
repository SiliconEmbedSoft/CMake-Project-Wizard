const vscode = require('vscode');
const path = require('path');

/* ------------------------------------------------------------------ */
/* Status bar items                                                    */
/* ------------------------------------------------------------------ */

let targetStatusItem;
let buildTypeStatusItem;

// Simple in-memory state. Replace with your real target/build-type source
// if you already track these elsewhere.
let activeTarget = 'all';
let activeBuildType = 'Debug';

function createStatusBarItems(context) {
  const cfg = vscode.workspace.getConfiguration('cmakeProjectWizard');

  const targetPriority = cfg.get('statusBar.targetPriority', 50);
  const buildTypePriority = cfg.get('statusBar.buildTypePriority', 49);

  // Dispose any previous items (e.g. after a settings change) before recreating,
  // since priority is only applied at creation time.
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
  // Replace with real target discovery if you have it.
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

/**
 * A folder "already has subprojects" if its root CMakeLists.txt contains
 * add_subdirectory(...) calls (after stripping comments).
 */
async function hasSubprojects(folderUri) {
  const rootCmake = vscode.Uri.joinPath(folderUri, 'CMakeLists.txt');
  try {
    const bytes = await vscode.workspace.fs.readFile(rootCmake);
    const text = Buffer.from(bytes).toString('utf8');
    const stripped = text.replace(/#.*$/gm, '');
    return /\badd_subdirectory\s*\(/.test(stripped);
  } catch {
    // No root CMakeLists.txt yet -> no subprojects.
    return false;
  }
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
`;
}

function buildPresets(projectName, cfg) {
  const generator = cfg.get('presets.generator', 'Ninja');
  const binaryDir = cfg.get('presets.binaryDir', '${sourceDir}/build');
  const buildType = cfg.get('cmake.defaultBuildType', 'Debug');

  return JSON.stringify(
    {
      version: 3,
      cmakeMinimumRequired: {
        major: 3,
        minor: 21,
        patch: 0
      },
      configurePresets: [
        {
          name: 'default',
          displayName: `${projectName} (${generator})`,
          generator,
          binaryDir,
          cacheVariables: {
            CMAKE_BUILD_TYPE: buildType
          }
        }
      ]
    },
    null,
    2
  ) + '\n';
}

async function convertToSingleProject(folderUri) {
  const cfg = vscode.workspace.getConfiguration('cmakeProjectWizard');

  // Guard: refuse if the folder already contains subprojects.
  if (await hasSubprojects(folderUri)) {
    vscode.window.showErrorMessage(
      'This folder already uses add_subdirectory(). ' +
      'Remove subprojects before converting it to a single project.'
    );
    return;
  }

  const projectName = path.basename(folderUri.fsPath);
  const rootCmake = vscode.Uri.joinPath(folderUri, 'CMakeLists.txt');

  // Settings are scaffolding defaults only: never silently overwrite
  // a hand-edited file. Confirm first.
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

  // Ensure src/main.cpp exists so the project builds immediately.
  const srcDir = vscode.Uri.joinPath(folderUri, 'src');
  const mainCpp = vscode.Uri.joinPath(srcDir, 'main.cpp');
  if (!(await fileExists(mainCpp))) {
    await vscode.workspace.fs.createDirectory(srcDir);
    const stub = 'int main() { return 0; }\n';
    await vscode.workspace.fs.writeFile(mainCpp, Buffer.from(stub, 'utf8'));
  }

  // Root CMakeLists.txt
  const cmakeContents = buildRootCmakeLists(projectName, cfg);
  await vscode.workspace.fs.writeFile(
    rootCmake,
    Buffer.from(cmakeContents, 'utf8')
  );

  // CMakePresets.json (only create if missing, to respect hand edits).
  const presetsUri = vscode.Uri.joinPath(folderUri, 'CMakePresets.json');
  if (!(await fileExists(presetsUri))) {
    const presetsContents = buildPresets(projectName, cfg);
    await vscode.workspace.fs.writeFile(
      presetsUri,
      Buffer.from(presetsContents, 'utf8')
    );
  }

  vscode.window.showInformationMessage(
    `Initialized "${projectName}" as a single CMake project.`
  );

  // Trigger a configure so the CMake side bar appears without a reload.
  try {
    await vscode.commands.executeCommand('cmake.configure');
  } catch {
    // CMake Tools may not be ready; safe to ignore.
  }
}

/* ------------------------------------------------------------------ */
/* Subproject creation (existing flow)                                 */
/* ------------------------------------------------------------------ */

async function createSubproject(folderUri) {
  // NOTE: paste your existing subproject scaffolding logic here.
  // It should add the subproject folder and wire an add_subdirectory(...)
  // entry into the root CMakeLists.txt, using the same cfg defaults
  // (cmake.cxxStandard, cmake.cStandard, etc.) read from:
  //   const cfg = vscode.workspace.getConfiguration('cmakeProjectWizard');
  //
  // Kept as a stub so this file stays consistent and complete.
  vscode.window.showInformationMessage(
    `Add subproject under: ${folderUri ? folderUri.fsPath : '(workspace root)'}`
  );
}

/* ------------------------------------------------------------------ */
/* Activation                                                          */
/* ------------------------------------------------------------------ */

function activate(context) {
  createStatusBarItems(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cmakeProjectWizard.selectActiveTarget',
      selectActiveTarget
    ),
    vscode.commands.registerCommand(
      'cmakeProjectWizard.selectBuildType',
      selectBuildType
    ),
    vscode.commands.registerCommand(
      'cmakeProjectWizard.createSubproject',
      async (resource) => {
        const folderUri = resource
          || (vscode.workspace.workspaceFolders &&
              vscode.workspace.workspaceFolders[0].uri);
        if (!folderUri) {
          vscode.window.showErrorMessage('No folder selected.');
          return;
        }
        await createSubproject(folderUri);
      }
    ),
    vscode.commands.registerCommand(
      'cmakeProjectWizard.convertToSingleProject',
      async (resource) => {
        const folderUri = resource
          || (vscode.workspace.workspaceFolders &&
              vscode.workspace.workspaceFolders[0].uri);
        if (!folderUri) {
          vscode.window.showErrorMessage('No folder selected.');
          return;
        }
        await convertToSingleProject(folderUri);
      }
    )
  );

  // Recreate status bar items when relevant settings change, so new
  // priorities and visibility take effect.
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
