import { NodePath } from '@babel/core';
import {
  FunctionDeclaration,
  FunctionExpression,
  ArrowFunctionExpression,
  isBlockStatement,
  isDirectiveLiteral,
  isFunctionDeclaration,
  isFunctionExpression,
  isArrowFunctionExpression,
} from '@babel/types';
import { ReanimatedPluginPass } from './commonInterfaces';
import { processIfWorkletFunction } from './processIfWorkletFunction';

function processIfWorkletNode(
  fun: NodePath<
    FunctionDeclaration | FunctionExpression | ArrowFunctionExpression
  >,
  state: ReanimatedPluginPass
): void {
  let shouldBeProcessed = false;
  fun.traverse({
    DirectiveLiteral(path) {
      const value = path.node.value;
      if (value === 'worklet' && isBlockStatement(fun.node.body)) {
        const parent = path.getFunctionParent();
        if (parent === fun) {
          // make sure "worklet" is listed among directives for the fun
          // this is necessary as because of some bug, babel will attempt to
          // process replaced function if it is nested inside another function
          const directives = fun.node.body.directives;
          if (
            directives &&
            directives.length > 0 &&
            directives.some(
              (directive) =>
                isDirectiveLiteral(directive.value) &&
                directive.value.value === 'worklet'
            )
          ) {
            shouldBeProcessed = true;
          }
        } else if (
          state.opts.useOnExitLogicForWorkletNodes &&
          (isFunctionDeclaration(parent) ||
            isFunctionExpression(parent) ||
            isArrowFunctionExpression(parent))
        ) {
          processIfWorkletNode(
            parent as NodePath<
              FunctionDeclaration | FunctionExpression | ArrowFunctionExpression
            >,
            state
          );
        }
      }
    },
  });
  if (shouldBeProcessed) processIfWorkletFunction(fun, state);
}

export { processIfWorkletNode };
