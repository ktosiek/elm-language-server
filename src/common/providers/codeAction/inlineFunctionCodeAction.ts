import { CodeActionKind, Range, TextEdit } from "vscode-languageserver";
import { SyntaxNode } from "web-tree-sitter";
import { getSpaces } from "../../util/refactorEditUtils";
import { TreeUtils } from "../../util/treeUtils";
import {
  CodeActionProvider,
  IRefactorCodeAction,
  IRefactorEdit,
} from "../codeActionProvider";
import { ICodeActionParams } from "../paramsExtensions";
import { References } from "../../../compiler/references";
import { PositionUtil } from "../../positionUtil";

const refactorName = "inline_function";
CodeActionProvider.registerRefactorAction(refactorName, {
  getAvailableActions: (params: ICodeActionParams): IRefactorCodeAction[] => {
    const result: IRefactorCodeAction[] = [];

    const node = TreeUtils.getNamedDescendantForRange(
      params.sourceFile,
      params.range,
    );

    const call = TreeUtils.findParentOfType("function_call_expr", node);
    if (call) {
      result.push({
        title: "Inline function and remove definition",
        kind: CodeActionKind.RefactorInline,
        data: {
          actionName: "inline_function",
          refactorName,
          uri: params.sourceFile.uri,
          range: params.range,
        },
      });
    }

    return result;
  },
  getEditsForAction: (
    params: ICodeActionParams,
    actionName: string,
  ): IRefactorEdit => {
    const checker = params.program.getTypeChecker();

    const nodeAtPosition = TreeUtils.getNamedDescendantForRange(
      params.sourceFile,
      params.range,
    );

    const definitionResult = checker.findDefinition(
      nodeAtPosition,
      params.sourceFile,
    );
    const definitionNode = TreeUtils.findParentOfType("value_declaration", definitionResult.symbol!.node);
    const definitionBody = definitionNode!.lastChild!;
    const references = References.find(definitionResult.symbol, params.program)

    const edits: TextEdit[] = references.flatMap((callRef) => {
      const callNode = callRef.node.parent?.parent?.parent;

      if (callNode && callNode.type === "function_call_expr") {
        const argValues = functionCallArguments(callNode)
        const bodyEdits: { start: number, end: number, newText: string }[] = [];
        const functionArgsSymbolMap = params.sourceFile.symbolLinks!.get(definitionNode!)!
        definitionNode!.firstNamedChild?.children.slice(1).forEach(
          (argNode, argIndex) => {
            const argSymbol = functionArgsSymbolMap.get(argNode.text);
            const argumentReferences = References.find(argSymbol, params.program);
            const replacementNode = argValues[argIndex]

            argumentReferences.forEach(argRef => {
              if (
                argRef.node.tree.uri === definitionBody.tree.uri
                && argRef.node.startIndex >= definitionBody.startIndex
                && argRef.node.endIndex <= definitionBody.endIndex) {
                bodyEdits.push({
                  start: argRef.node.startIndex - definitionBody.startIndex,
                  end: argRef.node.endIndex - definitionBody.startIndex,
                  newText: replacementNode.text,
                })
              }
            })
          }
        )

        const bodyText = applyEdits(bodyEdits, definitionBody.text).replace(
          new RegExp(`^${getSpaces(definitionBody.startPosition.column)}`, "gm"),
          "")

        return [
          TextEdit.replace(
            Range.create(
              PositionUtil.FROM_TS_POSITION(callNode.startPosition).toVSPosition(),
              PositionUtil.FROM_TS_POSITION(callNode.endPosition).toVSPosition(),
            ),
            bodyText.replace(/\n/g, "\n" + getSpaces(callNode.startPosition.column))
          )
        ]
      } else {
        return []
      }
    });

    const annotationNode = definitionNode?.previousSibling;
    if (annotationNode?.type === "type_annotation") {
      edits.push(
        TextEdit.del(Range.create(
          PositionUtil.FROM_TS_POSITION(annotationNode.startPosition).toVSPosition(),
          PositionUtil.FROM_TS_POSITION(annotationNode.endPosition).toVSPosition(),
        ))
      );
    }
    edits.push(
      TextEdit.del(
        Range.create(
          PositionUtil.FROM_TS_POSITION(definitionNode!.startPosition).toVSPosition(),
          PositionUtil.FROM_TS_POSITION(definitionNode!.endPosition).toVSPosition(),
        )
      )
    )
    return {
      edits: edits,
      renamePosition: {
        line: params.range.start.line,
        character: params.range.start.character,
      },
    };
  },
});

function functionCallArguments(node: SyntaxNode): SyntaxNode[] {
  return node.namedChildren.slice(1);
}

function applyEdits(edits: { start: number; end: number; newText: string; }[], text: string) {
  const sortedEdits = [...edits].sort(
    (a, b) => b.start - a.start
  )

  return sortedEdits.reduce(
    (acc, edit) =>
      acc.slice(0, edit.start) + edit.newText + acc.slice(edit.end),
    text,
  )
}
