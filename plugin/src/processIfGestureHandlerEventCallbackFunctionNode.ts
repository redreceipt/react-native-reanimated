import { NodePath } from '@babel/core';
import {
  FunctionDeclaration,
  FunctionExpression,
  ArrowFunctionExpression,
  isIdentifier,
  isCallExpression,
  Expression,
  isMemberExpression,
  isExpression,
} from '@babel/types';
import { ReanimatedPluginPass } from './commonInterfaces';
import { processIfWorkletFunction } from './processIfWorkletFunction';
import {
  gestureHandlerBuilderMethods,
  gestureHandlerGestureObjects,
} from './commonObjects';

function isGestureObject(node: Expression): boolean {
  // Checks if node matches `Gesture.Tap()` or similar.
  /*
  node: CallExpression(
    callee: MemberExpression(
      object: Identifier('Gesture')
      property: Identifier('Tap')
    )
  )
  */
  return (
    isCallExpression(node) &&
    isMemberExpression(node.callee) &&
    isIdentifier(node.callee.object) &&
    node.callee.object.name === 'Gesture' &&
    isIdentifier(node.callee.property) &&
    gestureHandlerGestureObjects.has(node.callee.property.name)
  );
}

function containsGestureObject(node: Expression): boolean {
  // Checks if node matches the pattern `Gesture.Foo()[*]`
  // where `[*]` represents any number of chained method calls, like `.something(42)`.

  // direct call
  if (isGestureObject(node)) {
    return true;
  }

  // method chaining
  if (
    isCallExpression(node) &&
    isMemberExpression(node.callee) &&
    containsGestureObject(node.callee.object)
  ) {
    return true;
  }

  return false;
}

function isGestureObjectEventCallbackMethod(node: Expression): boolean {
  // Checks if node matches the pattern `Gesture.Foo()[*].onBar`
  // where `[*]` represents any number of method calls.
  return (
    isMemberExpression(node) &&
    isIdentifier(node.property) &&
    gestureHandlerBuilderMethods.has(node.property.name) &&
    containsGestureObject(node.object)
  );
}

function processIfGestureHandlerEventCallbackFunctionNode(
  path: NodePath<
    FunctionDeclaration | FunctionExpression | ArrowFunctionExpression
  >,
  state: ReanimatedPluginPass
) {
  // Auto-workletizes React Native Gesture Handler callback functions.
  // Detects `Gesture.Tap().onEnd(<fun>)` or similar, but skips `something.onEnd(<fun>)`.
  // Supports method chaining as well, e.g. `Gesture.Tap().onStart(<fun1>).onUpdate(<fun2>).onEnd(<fun3>)`.

  // Example #1: `Gesture.Tap().onEnd(<fun>)`
  /*
  CallExpression(
    callee: MemberExpression(
      object: CallExpression(
        callee: MemberExpression(
          object: Identifier('Gesture')
          property: Identifier('Tap')
        )
      )
      property: Identifier('onEnd')
    )
    arguments: [fun]
  )
  */

  // Example #2: `Gesture.Tap().onStart(<fun1>).onUpdate(<fun2>).onEnd(<fun3>)`
  /*
  CallExpression(
    callee: MemberExpression(
      object: CallExpression(
        callee: MemberExpression(
          object: CallExpression(
            callee: MemberExpression(
              object: CallExpression(
                callee: MemberExpression(
                  object: Identifier('Gesture')
                  property: Identifier('Tap')
                )
              )
              property: Identifier('onStart')
            )
            arguments: [fun1]
          )
          property: Identifier('onUpdate')
        )
        arguments: [fun2]
      )
      property: Identifier('onEnd')
    )
    arguments: [fun3]
  )
  */

  if (
    isCallExpression(path.parent) &&
    isExpression(path.parent.callee) &&
    isGestureObjectEventCallbackMethod(path.parent.callee)
  ) {
    processIfWorkletFunction(path, state);
  }
}

export { processIfGestureHandlerEventCallbackFunctionNode };