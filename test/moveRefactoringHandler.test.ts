import { container } from "tsyringe";
import {
  CancellationToken,
  Disposable,
  RequestHandler,
  RequestType,
  WorkspaceEdit
} from "vscode-languageserver";
import { TextEdit } from "vscode-languageserver-textdocument";
import { Utils } from "vscode-uri";
import { IMoveDestinationsResponse, IMoveParams } from "../src/common/protocol";
import { FileEventsHandler } from "../src/common/providers/handlers/fileEventsHandler";
import { MoveRefactoringHandler } from "../src/common/providers/handlers/moveRefactoringHandler";
import { IProgram } from "../src/compiler/program";
import { getSourceFiles } from "./utils/sourceParser";
import { SourceTreeParser, srcUri } from "./utils/sourceTreeParser";

describe("moveRefactoringHandler", () => {
  const treeParser = new SourceTreeParser();

  let appliedWorkspaceEdit: WorkspaceEdit;

  let resolveCreateFiles: () => void;

  function onDidCreateFile(): void {
    resolveCreateFiles();
  }

  let requestHandlers: { [method: string]: any } = {};

  container.register("Connection", {
    useValue: {
      onRequest: <P, R, E>(type: RequestType<P, R, E>, handler: RequestHandler<P, R, E>): Disposable => {
        requestHandlers[type.method] = handler;
        return Disposable.create(() => { });
      },
      onDidChangeTextDocument: () => { },
      onDidCloseTextDocument: () => { },
      onDidOpenTextDocument: () => { },
      onDidSaveTextDocument: () => { },
      onDidChangeWatchedFiles: () => { },
      onExecuteCommand: () => { },
      workspace: {
        applyEdit: (edit: any) => { appliedWorkspaceEdit = edit },
        onDidCreateFiles: () => { },
        onDidRenameFiles: () => { },
        onDidDeleteFiles: () => { },
        onWillCreateFiles: () => { },
        onWillRenameFiles: () => { },
        onWillDeleteFiles: () => { },
      },
      console: {
        info: (...args: any[]) => { },
        error: (...args: any[]) => { console.log("error", ...args) },
      },
    },
  });

  async function createProgram(source: string): Promise<IProgram> {
    await treeParser.init();
    new FileEventsHandler(onDidCreateFile);
    new MoveRefactoringHandler();

    const program = await treeParser.getProgram(getSourceFiles(source));
    const workspaces = container.resolve<IProgram[]>("ElmWorkspaces");
    workspaces.splice(0, workspaces.length);
    workspaces.push(program);

    return program;
  }

  function uri(uri: string, src = srcUri): string {
    return Utils.joinPath(src, uri).toString();
  }

  it("moves a function definition", async () => {
    const program = await createProgram(`
--@ TestA.elm
module TestA exposing (..)

fun a = a

moreFun a = fun (fun a)

--@ TestB.elm
module TestB exposing (..)
`);

    const handler: ((params: IMoveParams, token?: CancellationToken) => Promise<IMoveDestinationsResponse>) =
      requestHandlers["elm/move"]

    const testAFile = program.getSourceFiles()[0];
    await handler({
      sourceUri: testAFile.uri,
      program,
      sourceFile: testAFile,
      params: {
        textDocument: { uri: testAFile.uri },
        range: { start: { line: 2, character: 1 }, end: { line: 2, character: 1 } },
        context: { diagnostics: [] },
      },
      destination: {
        name: "fun",
        path: uri("TestB.elm"),
        uri: uri("TestB.elm"),
      },

    })

    const edit = appliedWorkspaceEdit;

    expect(edit.changes).toEqual<{ [path: string]: TextEdit[] }>({
      [uri("TestA.elm")]: [
        {
          newText: "",
          range: { start: { line: 2, character: 0 }, end: { line: 2, character: 9 } },
        },
        {
          newText: "import TestB exposing (fun)\n",
          "range": { "start": { "character": 0, "line": 1 }, "end": { "character": 0, "line": 1 } },
        },
      ],
      [uri("TestB.elm")]: [{
        newText: "\n\nfun a = a",
        range: { start: { character: 0, line: 3 }, end: { character: 0, line: 3 } },
      }],
    });
  });
});
