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

type FragmentEdit = {
  start: number;
  end: number;
  newText: string;
};

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
        title: "Inline all calls of this function",
        kind: CodeActionKind.RefactorInline,
        data: {
          actionName: "inline_all_calls",
          refactorName,
          uri: params.sourceFile.uri,
          range: params.range,
        },
      }, {
        title: "Inline function and remove definition",
        kind: CodeActionKind.RefactorInline,
        data: {
          actionName: "inline_all_and_remove_function",
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
    const removeDefinition = !!actionName.match(/remove/)

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
        const bodyEdits: FragmentEdit[] = [];
        const functionArgsSymbolMap = params.sourceFile.symbolLinks!.get(definitionNode!)!
        const letClauses: string[] = []
        definitionNode!.firstNamedChild?.namedChildren.slice(1).forEach(
          (argNode, argIndex) => {
            const argSymbol = functionArgsSymbolMap.get(argNode.text);
            const argumentReferences = References.find(argSymbol, params.program);
            const replacementNode = argValues[argIndex]

            switch (argNode.type) {
              case "lower_pattern":
                // Simple argument, like in `f myArg = ...`
                bodyEdits.push(
                  ...replaceReferencesInFragment(
                    argumentReferences.map(ref => ref.node),
                    replacementNode.text,
                    definitionBody)
                )
                break;

              case "pattern":
                // Any other pattern, like in `f (T myArg) = ...`
                letClauses.push(
                  `(${argNode.text}) = ${replacementNode.text}`
                )
                break;

              default:
                console.warn(`Unknown function parameter node type "${argNode.type}" for argument "${argNode.text}"`)
            }
          }
        )

        bodyEdits.push(...addLetClauses(letClauses, definitionBody));

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
    if (removeDefinition && annotationNode?.type === "type_annotation") {
      edits.push(
        TextEdit.del(Range.create(
          PositionUtil.FROM_TS_POSITION(annotationNode.startPosition).toVSPosition(),
          PositionUtil.FROM_TS_POSITION(annotationNode.endPosition).toVSPosition(),
        ))
      );
    }
    if (removeDefinition) {
      edits.push(
        TextEdit.del(
          Range.create(
            PositionUtil.FROM_TS_POSITION(definitionNode!.startPosition).toVSPosition(),
            PositionUtil.FROM_TS_POSITION(definitionNode!.endPosition).toVSPosition(),
          )
        )
      )
    }
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

function applyEdits(edits: FragmentEdit[], text: string) {
  const sortedEdits = [...edits].sort(
    (a, b) => b.start - a.start
  )

  return sortedEdits.reduce(
    (acc, edit) =>
      acc.slice(0, edit.start) + edit.newText + acc.slice(edit.end),
    text,
  )
}

function replaceReferencesInFragment(
  argumentReferences: SyntaxNode[],
  replacementText: string,
  definitionBody: SyntaxNode
): FragmentEdit[] {
  const bodyEdits: FragmentEdit[] = []

  argumentReferences.forEach(argRef => {
    if (
      argRef.tree.uri === definitionBody.tree.uri
      && argRef.startIndex >= definitionBody.startIndex
      && argRef.endIndex <= definitionBody.endIndex) {
      bodyEdits.push({
        start: argRef.startIndex - definitionBody.startIndex,
        end: argRef.endIndex - definitionBody.startIndex,
        newText: replacementText,
      })
    }
  })

  return bodyEdits;
}

function addLetClauses(letClauses: string[], definitionBody: SyntaxNode): FragmentEdit[] {
  if (letClauses.length === 0) {
    return []
  } else {
    const clausePrefix = "\n" + getSpaces(definitionBody.startPosition.column + 4)

    return [{
      start: 0,
      end: 0,
      newText: `${["let", ...letClauses].join(clausePrefix)}\nin\n`
    }]
  }
}
