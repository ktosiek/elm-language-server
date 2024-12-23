import { CodeActionKind, Position, Range, TextEdit } from "vscode-languageserver";
import { SyntaxNode } from "web-tree-sitter";
import { getSpaces, RefactorEditUtils } from "../../util/refactorEditUtils";
import { TreeUtils } from "../../util/treeUtils";
import { TFunction } from "../../../compiler/typeInference";
import dedent from "dedent";
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
    let node = TreeUtils.getNamedDescendantForRange(
      params.sourceFile,
      params.range,
    );

    const call = TreeUtils.findParentOfType("function_call_expr", node);

    const checker = params.program.getTypeChecker();
    const rootNode = params.sourceFile.tree.rootNode;

    const nodeAtPosition = TreeUtils.getNamedDescendantForRange(
      params.sourceFile,
      params.range,
    );

    const definitionNode = checker.findDefinition(
      nodeAtPosition,
      params.sourceFile,
    );
    const definitionBody = TreeUtils.findParentOfType("value_declaration", definitionNode.symbol!.node);
    const references = References.find(definitionNode.symbol, params.program)
    const calls = references.filter((ref) => ref.node.type === "function_call_expr")
    console.log({
      nodeAtPosition, definitionNode, references, calls,
      refnodes: references.map((ref) => ref.node.parent?.parent?.parent?.type)
    })

    const edits: TextEdit[] = references.flatMap((ref) => {
      const callNode = ref.node.parent?.parent?.parent;
      console.log("ref", callNode)
      if (callNode && callNode.type === "function_call_expr") {
        console.log("target", ref)
        const bodyText = definitionBody!.lastChild!.text.replace(
          new RegExp(`^${getSpaces(definitionBody!.lastChild!.startPosition.column)}`, "gm"),
          "")
        console.log("function body", bodyText)
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

    console.log(edits)

    return {
      edits: edits,
      renamePosition: {
        line: params.range.start.line,
        character: params.range.start.character,
      },
    };
  },
});
