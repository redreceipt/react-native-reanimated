'use strict';

import * as BabelCore from '@babel/core';
import * as BabelTypes from '@babel/types';
import generate from '@babel/generator';
import traverse from '@babel/traverse';
import { transformSync } from '@babel/core';
import * as fs from 'fs';
import * as convertSourceMap from 'convert-source-map';

function hash(str: string): number {
  let i = str.length;
  let hash1 = 5381;
  let hash2 = 52711;

  while (i--) {
    const char = str.charCodeAt(i);
    hash1 = (hash1 * 33) ^ char;
    hash2 = (hash2 * 33) ^ char;
  }

  return (hash1 >>> 0) * 4096 + (hash2 >>> 0);
}

/**
 * holds a map of function names as keys and array of argument indexes as values which should be automatically workletized(they have to be functions)(starting from 0)
 */
const functionArgsToWorkletize = new Map([
  ['useFrameCallback', [0]],
  ['useAnimatedStyle', [0]],
  ['useAnimatedProps', [0]],
  ['createAnimatedPropAdapter', [0]],
  ['useDerivedValue', [0]],
  ['useAnimatedScrollHandler', [0]],
  ['useAnimatedReaction', [0, 1]],
  ['useWorkletCallback', [0]],
  // animations' callbacks
  ['withTiming', [2]],
  ['withSpring', [2]],
  ['withDecay', [1]],
  ['withRepeat', [3]],
]);

const objectHooks = new Set([
  'useAnimatedGestureHandler',
  'useAnimatedScrollHandler',
]);

const globals = new Set([
  'this',
  'console',
  'performance',
  'Date',
  'Array',
  'ArrayBuffer',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Uint16Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'Date',
  'HermesInternal',
  'JSON',
  'Math',
  'Number',
  'Object',
  'String',
  'Symbol',
  'undefined',
  'null',
  'UIManager',
  'requestAnimationFrame',
  'setImmediate',
  '_WORKLET',
  'arguments',
  'Boolean',
  'parseInt',
  'parseFloat',
  'Map',
  'WeakMap',
  'WeakRef',
  'Set',
  '_log',
  '_scheduleOnJS',
  '_makeShareableClone',
  '_updateDataSynchronously',
  'eval',
  '_updatePropsPaper',
  '_updatePropsFabric',
  '_removeShadowNodeFromRegistry',
  'RegExp',
  'Error',
  'ErrorUtils',
  'global',
  '_measure',
  '_scrollTo',
  '_dispatchCommand',
  '_setGestureState',
  '_getCurrentTime',
  'isNaN',
  'LayoutAnimationRepository',
  '_notifyAboutProgress',
  '_notifyAboutEnd',
]);

const gestureHandlerGestureObjects = new Set([
  // from https://github.com/software-mansion/react-native-gesture-handler/blob/new-api/src/handlers/gestures/gestureObjects.ts
  'Tap',
  'Pan',
  'Pinch',
  'Rotation',
  'Fling',
  'LongPress',
  'ForceTouch',
  'Native',
  'Manual',
  'Race',
  'Simultaneous',
  'Exclusive',
]);

const gestureHandlerBuilderMethods = new Set([
  'onBegin',
  'onStart',
  'onEnd',
  'onFinalize',
  'onUpdate',
  'onChange',
  'onTouchesDown',
  'onTouchesMove',
  'onTouchesUp',
  'onTouchesCancelled',
]);

function isRelease() {
  return (
    process.env.BABEL_ENV &&
    ['production', 'release'].includes(process.env.BABEL_ENV)
  );
}

function shouldGenerateSourceMap() {
  if (isRelease()) {
    return false;
  }

  if (process.env.REANIMATED_PLUGIN_TESTS === 'jest') {
    // We want to detect this, so we can disable source maps (because they break
    // snapshot tests with jest).
    return false;
  }

  return true;
}

interface BabelMapType {
  version: number;
  sources: string[];
  names: string[];
  sourceRoot?: string | undefined;
  sourcesContent?: string[] | undefined;
  mappings: string;
  file: string;
}

function buildWorkletString(
  t: typeof BabelCore.types,
  fun: BabelCore.types.File,
  closureVariables: Array<BabelTypes.Identifier>,
  name: string,
  inputMap: BabelMapType | null | undefined
): Array<string | null | undefined> {
  function prependClosureVariablesIfNecessary() {
    const closureDeclaration = t.variableDeclaration('const', [
      t.variableDeclarator(
        t.objectPattern(
          closureVariables.map((variable) =>
            t.objectProperty(
              t.identifier(variable.name),
              t.identifier(variable.name),
              false,
              true
            )
          )
        ),
        t.memberExpression(t.thisExpression(), t.identifier('_closure'))
      ),
    ]);

    function prependClosure(
      path: BabelCore.NodePath<
        | BabelTypes.FunctionDeclaration
        | BabelTypes.FunctionExpression
        | BabelTypes.ArrowFunctionExpression
        | BabelTypes.ObjectMethod
      >
    ) {
      if (closureVariables.length === 0 || path.parent.type !== 'Program') {
        return;
      }

      if (!BabelTypes.isExpression(path.node.body))
        path.node.body.body.unshift(closureDeclaration);
    }

    function prependRecursiveDeclaration(
      path: BabelCore.NodePath<
        | BabelTypes.FunctionDeclaration
        | BabelTypes.FunctionExpression
        | BabelTypes.ArrowFunctionExpression
        | BabelTypes.ObjectMethod
      >
    ) {
      if (
        path.parent.type === 'Program' &&
        !BabelTypes.isArrowFunctionExpression(path.node) &&
        !BabelTypes.isObjectMethod(path.node) &&
        path.node.id &&
        path.scope.parent
      ) {
        const hasRecursiveCalls =
          path.scope.parent.bindings[path.node.id.name]?.references > 0;
        if (hasRecursiveCalls) {
          path.node.body.body.unshift(
            t.variableDeclaration('const', [
              t.variableDeclarator(
                t.identifier(path.node.id.name),
                t.memberExpression(t.thisExpression(), t.identifier('_recur'))
              ),
            ])
          );
        }
      }
    }

    return {
      visitor: {
        'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod':
          (
            path: BabelCore.NodePath<
              | BabelTypes.FunctionDeclaration
              | BabelTypes.FunctionExpression
              | BabelTypes.ArrowFunctionExpression
              | BabelTypes.ObjectMethod
            >
          ) => {
            prependClosure(path);
            prependRecursiveDeclaration(path);
          },
      },
    };
  }

  const draftExpression = (fun.program.body.find((obj) =>
    BabelTypes.isFunctionDeclaration(obj)
  ) ||
    fun.program.body.find((obj) => BabelTypes.isExpressionStatement(obj)) ||
    undefined) as
    | BabelTypes.FunctionDeclaration
    | BabelTypes.ExpressionStatement
    | undefined;

  if (!draftExpression) throw new Error("'draftExpression' is not defined\n"); // [TO DO] temporary

  const expression = BabelTypes.isFunctionDeclaration(draftExpression)
    ? draftExpression
    : draftExpression.expression;

  if (
    !BabelTypes.isFunctionDeclaration(expression) &&
    !BabelTypes.isFunctionExpression(expression) &&
    !BabelTypes.isObjectMethod(expression)
  )
    throw new Error(
      "'expression' is not FunctionDeclaration or FunctionExpression or ObjectMethod\n"
    ); // [TO DO] temporary

  const workletFunction = BabelTypes.functionExpression(
    BabelTypes.identifier(name),
    expression.params,
    expression.body
  );

  const code = generate(workletFunction).code;

  if (!inputMap) throw new Error("'inputMap' is not defined"); // temporary [TO DO]

  const includeSourceMap = shouldGenerateSourceMap();

  if (includeSourceMap) {
    // Clear contents array (should be empty anyways)
    inputMap.sourcesContent = [];
    // Include source contents in source map, because Flipper/iframe is not
    // allowed to read files from disk.
    for (const sourceFile of inputMap.sources) {
      inputMap.sourcesContent.push(
        fs.readFileSync(sourceFile).toString('utf-8')
      );
    }
  }

  const transformed = transformSync(code, {
    plugins: [prependClosureVariablesIfNecessary()],
    compact: !includeSourceMap,
    sourceMaps: includeSourceMap,
    inputSourceMap: inputMap,
    ast: false,
    babelrc: false,
    configFile: false,
    comments: false,
  });

  if (!transformed) throw new Error('transformed is null!\n');

  let sourceMap;
  if (includeSourceMap) {
    sourceMap = convertSourceMap.fromObject(transformed.map).toObject();
    // sourcesContent field contains a full source code of the file which contains the worklet
    // and is not needed by the source map interpreter in order to symbolicate a stack trace.
    // Therefore, we remove it to reduce the bandwith and avoid sending it potentially multiple times
    // in files that contain multiple worklets. Along with sourcesContent.
    delete sourceMap.sourcesContent;
  }

  return [transformed.code, JSON.stringify(sourceMap)];
}

function makeWorkletName(
  t: typeof BabelCore.types,
  fun: BabelCore.NodePath<
    | BabelTypes.FunctionDeclaration
    | BabelTypes.FunctionExpression
    | BabelTypes.ObjectMethod
    | BabelTypes.ArrowFunctionExpression
  >
): string {
  if (BabelTypes.isObjectMethod(fun.node)) {
    // @ts-expect-error [TO DO] how to fix it cheap?
    return fun.node.key.name;
  }
  if (BabelTypes.isFunctionDeclaration(fun.node) && fun.node.id) {
    return fun.node.id.name;
  }
  if (
    BabelTypes.isFunctionExpression(fun.node) &&
    BabelTypes.isIdentifier(fun.node.id)
  ) {
    return fun.node.id.name;
  }
  return 'anonymous'; // fallback for ArrowFunctionExpression and unnamed FunctionExpression
}

function makeWorklet(
  t: typeof BabelCore.types,
  fun: BabelCore.NodePath<
    | BabelTypes.FunctionDeclaration
    | BabelTypes.FunctionExpression
    | BabelTypes.ObjectMethod
    | BabelTypes.ArrowFunctionExpression
  >,
  state: BabelCore.PluginPass
): BabelTypes.FunctionExpression {
  // Returns a new FunctionExpression which is a workletized version of provided
  // FunctionDeclaration, FunctionExpression, ArrowFunctionExpression or ObjectMethod.

  const functionName = makeWorkletName(t, fun);

  const closure = new Map<string, BabelTypes.Identifier>();

  // remove 'worklet'; directive before generating string
  fun.traverse({
    DirectiveLiteral(path) {
      if (path.node.value === 'worklet' && path.getFunctionParent() === fun) {
        path.parentPath.remove();
      }
    },
  });

  // We use copy because some of the plugins don't update bindings and
  // some even break them

  const codeObject = generate(fun.node, {
    sourceMaps: true,
    // //@ts-ignore [TO DO] how to type it?
    sourceFileName: state.file.opts.filename as string | undefined,
  });

  // We need to add a newline at the end, because there could potentially be a
  // comment after the function that gets included here, and then the closing
  // bracket would become part of the comment thus resulting in an error, since
  // there is a missing closing bracket.
  const code =
    '(' + (t.isObjectMethod(fun) ? 'function ' : '') + codeObject.code + '\n)';

  const transformed = transformSync(code, {
    // @ts-ignore [TO DO]
    filename: state.file.opts.filename,
    presets: ['@babel/preset-typescript'],
    plugins: [
      '@babel/plugin-transform-shorthand-properties',
      '@babel/plugin-transform-arrow-functions',
      '@babel/plugin-proposal-optional-chaining',
      '@babel/plugin-proposal-nullish-coalescing-operator',
      ['@babel/plugin-transform-template-literals', { loose: true }],
    ],
    ast: true,
    babelrc: false,
    configFile: false,
    inputSourceMap: codeObject.map,
  });

  if (!transformed || !transformed.ast)
    throw new Error("'transformed' or 'transformed.ast' is undefined\n"); // this is temporary [TO DO]

  traverse(transformed.ast, {
    Identifier(path) {
      if (!path.isReferencedIdentifier()) return;
      const name = path.node.name;
      if (
        globals.has(name) ||
        (!BabelTypes.isArrowFunctionExpression(fun.node) &&
          !BabelTypes.isObjectMethod(fun.node) &&
          fun.node.id &&
          fun.node.id.name === name)
      ) {
        return;
      }

      const parentNode = path.parent;

      if (
        parentNode.type === 'MemberExpression' &&
        parentNode.property === path.node &&
        !parentNode.computed
      ) {
        return;
      }

      if (
        parentNode.type === 'ObjectProperty' &&
        path.parentPath.parent.type === 'ObjectExpression' &&
        path.node !== parentNode.value
      ) {
        return;
      }

      let currentScope = path.scope;

      while (currentScope != null) {
        if (currentScope.bindings[name] != null) {
          return;
        }
        currentScope = currentScope.parent;
      }
      closure.set(name, path.node);
    },
  });

  const variables = Array.from(closure.values());

  const privateFunctionId = t.identifier('_f');
  const clone = t.cloneNode(fun.node);
  const funExpression = BabelTypes.isBlockStatement(clone.body)
    ? BabelTypes.functionExpression(null, clone.params, clone.body)
    : clone;

  const [funString, sourceMapString] = buildWorkletString(
    t,
    transformed.ast,
    variables,
    functionName,
    transformed.map
  );
  if (!funString) throw new Error("'funString' is not defined\n"); // this is temporary [TO DO]
  const workletHash = hash(funString);

  let location = state.file.opts.filename; // @ts-expect-error [TO DO]
  if (state.opts && state.opts.relativeSourceLocation) {
    const path = require('path');
    location = path.relative(state.cwd, location);
  }

  let lineOffset = 1;
  if (closure.size > 0) {
    // When worklet captures some variables, we append closure destructing at
    // the beginning of the function body. This effectively results in line
    // numbers shifting by the number of captured variables (size of the
    // closure) + 2 (for the opening and closing brackets of the destruct
    // statement)
    lineOffset -= closure.size + 2;
  }

  const pathForStringDefinitions = fun.parentPath.isProgram()
    ? fun
    : fun.findParent((path) => path.parentPath.isProgram());

  const initDataId =
    pathForStringDefinitions.parentPath.scope.generateUidIdentifier(
      `worklet_${workletHash}_init_data`
    );

  const initDataObjectExpression = t.objectExpression([
    t.objectProperty(
      t.identifier('code'),
      t.stringLiteral(funString as string)
    ), // [TO DO] this is temporary
    t.objectProperty(
      t.identifier('location'),
      t.stringLiteral(location as string)
    ),
  ]);

  if (sourceMapString) {
    initDataObjectExpression.properties.push(
      t.objectProperty(
        t.identifier('sourceMap'),
        t.stringLiteral(sourceMapString)
      )
    );
  }

  pathForStringDefinitions.insertBefore(
    t.variableDeclaration('const', [
      t.variableDeclarator(initDataId, initDataObjectExpression),
    ])
  );

  if (
    BabelTypes.isFunctionDeclaration(funExpression) ||
    BabelTypes.isObjectMethod(funExpression)
  )
    throw new Error("'funExpression' is not defined\n"); // [TO DO] temporary

  const statements: Array<
    | BabelTypes.VariableDeclaration
    | BabelTypes.ExpressionStatement
    | BabelTypes.ReturnStatement
  > = [
    BabelTypes.variableDeclaration('const', [
      BabelTypes.variableDeclarator(privateFunctionId, funExpression),
    ]),
    BabelTypes.expressionStatement(
      BabelTypes.assignmentExpression(
        '=',
        BabelTypes.memberExpression(
          privateFunctionId,
          t.identifier('_closure'),
          false
        ),
        BabelTypes.objectExpression(
          variables.map((variable) =>
            BabelTypes.objectProperty(
              t.identifier(variable.name),
              variable,
              false,
              true
            )
          )
        )
      )
    ),
    BabelTypes.expressionStatement(
      BabelTypes.assignmentExpression(
        '=',
        BabelTypes.memberExpression(
          privateFunctionId,
          t.identifier('__initData'),
          false
        ),
        initDataId
      )
    ),
    BabelTypes.expressionStatement(
      BabelTypes.assignmentExpression(
        '=',
        BabelTypes.memberExpression(
          privateFunctionId,
          t.identifier('__workletHash'),
          false
        ),
        BabelTypes.numericLiteral(workletHash)
      )
    ),
  ];

  if (!isRelease()) {
    statements.unshift(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier('_e'),
          t.arrayExpression([
            t.newExpression(t.identifier('Error'), []),
            t.numericLiteral(lineOffset),
            t.numericLiteral(-20), // the placement of opening bracket after Exception in line that defined '_e' variable
          ])
        ),
      ])
    );
    statements.push(
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.memberExpression(
            privateFunctionId,
            t.identifier('__stackDetails'),
            false
          ),
          t.identifier('_e')
        )
      )
    );
  }

  statements.push(t.returnStatement(privateFunctionId));

  const newFun = t.functionExpression(
    // !BabelTypes.isArrowFunctionExpression(fun.node) ? fun.node.id : undefined, // [TO DO] --- this never worked
    undefined,
    [],
    t.blockStatement(statements)
  );

  return newFun;
}

function processWorkletFunction(
  t: typeof BabelCore.types,
  fun: BabelCore.NodePath<
    | BabelTypes.FunctionDeclaration
    | BabelTypes.FunctionExpression
    | BabelTypes.ArrowFunctionExpression
  >,
  state: BabelCore.PluginPass
) {
  // Replaces FunctionDeclaration, FunctionExpression or ArrowFunctionExpression
  // with a workletized version of itself.

  if (!t.isFunctionParent(fun)) {
    return;
  }

  const newFun = makeWorklet(t, fun, state);

  const replacement = t.callExpression(newFun, []);

  // we check if function needs to be assigned to variable declaration.
  // This is needed if function definition directly in a scope. Some other ways
  // where function definition can be used is for example with variable declaration:
  // const ggg = function foo() { }
  // ^ in such a case we don't need to define variable for the function
  const needDeclaration =
    t.isScopable(fun.parent) || t.isExportNamedDeclaration(fun.parent);
  fun.replaceWith(
    !BabelTypes.isArrowFunctionExpression(fun.node) &&
      fun.node.id &&
      needDeclaration
      ? t.variableDeclaration('const', [
          t.variableDeclarator(fun.node.id, replacement),
        ])
      : replacement
  );
}

function processWorkletObjectMethod(
  t: typeof BabelCore.types,
  path: BabelCore.NodePath<BabelTypes.ObjectMethod>,
  state: BabelCore.PluginPass
) {
  // Replaces ObjectMethod with a workletized version of itself.

  if (!BabelTypes.isFunctionParent(path)) return;

  const newFun = makeWorklet(t, path, state);

  const replacement = BabelTypes.objectProperty(
    BabelTypes.identifier(
      BabelTypes.isIdentifier(path.node.key) ? path.node.key.name : ''
    ),
    t.callExpression(newFun, [])
  );

  path.replaceWith(replacement);
}

function processIfWorkletNode(
  t: typeof BabelCore.types,
  fun: BabelCore.NodePath<
    | BabelTypes.FunctionDeclaration
    | BabelTypes.FunctionExpression
    | BabelTypes.ArrowFunctionExpression
  >,
  state: BabelCore.PluginPass
) {
  fun.traverse({
    DirectiveLiteral(path) {
      const value = path.node.value;
      if (
        value === 'worklet' &&
        path.getFunctionParent() === fun &&
        BabelTypes.isBlockStatement(fun.node.body)
      ) {
        // make sure "worklet" is listed among directives for the fun
        // this is necessary as because of some bug, babel will attempt to
        // process replaced function if it is nested inside another function
        const directives = fun.node.body.directives;
        if (
          directives &&
          directives.length > 0 &&
          directives.some(
            (directive) =>
              t.isDirectiveLiteral(directive.value) &&
              directive.value.value === 'worklet'
          )
        ) {
          processWorkletFunction(t, fun, state);
        }
      }
    },
  });
}

function processIfGestureHandlerEventCallbackFunctionNode(
  t: typeof BabelCore.types,
  fun: BabelCore.NodePath<
    | BabelTypes.FunctionDeclaration
    | BabelTypes.FunctionExpression
    | BabelTypes.ArrowFunctionExpression
  >,
  state: BabelCore.PluginPass
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
    t.isCallExpression(fun.parent) &&
    isGestureObjectEventCallbackMethod(
      t,
      fun.parent.callee as BabelTypes.Expression
    ) // [TO DO] this is temporary
  ) {
    processWorkletFunction(t, fun, state);
  }
}

function isGestureObjectEventCallbackMethod(
  t: typeof BabelCore.types,
  node: BabelTypes.Expression
) {
  // Checks if node matches the pattern `Gesture.Foo()[*].onBar`
  // where `[*]` represents any number of method calls.
  return (
    t.isMemberExpression(node) &&
    t.isIdentifier(node.property) &&
    gestureHandlerBuilderMethods.has(node.property.name) &&
    containsGestureObject(t, node.object)
  );
}

function containsGestureObject(
  t: typeof BabelCore.types,
  node: BabelTypes.Expression
) {
  // Checks if node matches the pattern `Gesture.Foo()[*]`
  // where `[*]` represents any number of chained method calls, like `.something(42)`.

  // direct call
  if (isGestureObject(t, node)) {
    return true;
  }

  // method chaining
  if (
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    containsGestureObject(t, node.callee.object)
  ) {
    return true;
  }

  return false;
}

function isGestureObject(
  t: typeof BabelCore.types,
  node: BabelTypes.Expression
) {
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
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    t.isIdentifier(node.callee.object) &&
    node.callee.object.name === 'Gesture' &&
    t.isIdentifier(node.callee.property) &&
    gestureHandlerGestureObjects.has(node.callee.property.name)
  );
}

function processWorklets(
  t: typeof BabelCore.types,
  path: BabelCore.NodePath<BabelTypes.CallExpression>,
  state: BabelCore.PluginPass
) {
  // const callee =
  //   path.node.callee.type === 'SequenceExpression'
  //     ? path.node.callee.expressions[path.node.callee.expressions.length - 1]
  //     : path.node.callee;

  const callee = BabelTypes.isSequenceExpression(path.node.callee)
    ? path.node.callee.expressions[path.node.callee.expressions.length - 1]
    : path.node.callee;

  const name = BabelTypes.isMemberExpression(callee) // @ts-expect-error [TO DO]
    ? callee.property.name // @ts-expect-error [TO DO]
    : callee.name;

  if (
    objectHooks.has(name) &&
    BabelTypes.isObjectExpression(
      (path.get('arguments.0') as BabelCore.NodePath<BabelTypes.Expression>)
        .node
    )
  ) {
    const properties = path.get('arguments.0.properties') as Array<
      BabelCore.NodePath<BabelTypes.ObjectMethod | BabelTypes.ObjectProperty>
    >;
    for (const property of properties) {
      if (BabelTypes.isObjectMethod(property.node)) {
        processWorkletObjectMethod(
          t,
          property as BabelCore.NodePath<BabelTypes.ObjectMethod>,
          state
        );
      } else {
        const value = property.get(
          'value'
        ) as BabelCore.NodePath<BabelTypes.Expression>;
        processWorkletFunction(
          t,
          value as BabelCore.NodePath<
            | BabelTypes.FunctionDeclaration
            | BabelTypes.FunctionExpression
            | BabelTypes.ArrowFunctionExpression
          >,
          state
        ); // temporarily given 3 types [TO DO]
      }
    }
  } else {
    const indexes = functionArgsToWorkletize.get(name);
    if (Array.isArray(indexes)) {
      indexes.forEach((index) => {
        processWorkletFunction(
          t,
          path.get(`arguments.${index}`) as BabelCore.NodePath<
            | BabelTypes.FunctionDeclaration
            | BabelTypes.FunctionExpression
            | BabelTypes.ArrowFunctionExpression
          >,
          state
        ); // temporarily given 3 types [TO DO]
      });
    }
  }
}

function generateInlineStylesWarning(
  t: typeof BabelCore.types,
  memberExpression: BabelCore.NodePath<BabelTypes.MemberExpression>
) {
  // replaces `sharedvalue.value` with `(()=>{console.warn(require('react-native-reanimated').getUseOfValueInStyleWarning());return sharedvalue.value;})()`
  return t.callExpression(
    t.arrowFunctionExpression(
      [],
      t.blockStatement([
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(t.identifier('console'), t.identifier('warn')),
            [
              t.callExpression(
                t.memberExpression(
                  t.callExpression(t.identifier('require'), [
                    t.stringLiteral('react-native-reanimated'),
                  ]),
                  t.identifier('getUseOfValueInStyleWarning')
                ),
                []
              ),
            ]
          )
        ),
        t.returnStatement(memberExpression.node),
      ])
    ),
    []
  );
}

function processPropertyValueForInlineStylesWarning(
  t: typeof BabelCore.types,
  path: BabelCore.NodePath<BabelTypes.ObjectProperty['value']>
) {
  // if it's something like object.value then raise a warning
  if (t.isMemberExpression(path.node) && t.isIdentifier(path.node.property)) {
    if (path.node.property.name === 'value') {
      path.replaceWith(
        generateInlineStylesWarning(
          t,
          path as BabelCore.NodePath<BabelTypes.MemberExpression>
        )
      );
    }
  }
}

function processTransformPropertyForInlineStylesWarning(
  t: typeof BabelCore.types,
  path: BabelCore.NodePath<BabelTypes.ObjectProperty['value']>
) {
  if (t.isArrayExpression(path.node)) {
    const elements = path.get('elements') as Array<
      BabelCore.NodePath<BabelTypes.ArrayExpression['elements'][number]>
    >;
    for (const element of elements) {
      if (t.isObjectExpression(element.node)) {
        processStyleObjectForInlineStylesWarning(
          t,
          element as BabelCore.NodePath<BabelTypes.ObjectExpression>
        ); //why is it not inferred? [TO DO]
      }
    }
  }
}

function processStyleObjectForInlineStylesWarning(
  t: typeof BabelCore.types,
  path: BabelCore.NodePath<BabelTypes.ObjectExpression>
) {
  const properties = path.get('properties') as Array<
    BabelCore.NodePath<BabelTypes.ObjectExpression['properties'][number]>
  >;
  for (const property of properties) {
    if (!BabelTypes.isObjectProperty(property.node)) continue;
    const value = property.get('value') as BabelCore.NodePath<
      BabelTypes.ObjectProperty['value']
    >;
    if (t.isObjectProperty(property)) {
      if (
        t.isIdentifier(property.node.key) &&
        property.node.key.name === 'transform'
      ) {
        processTransformPropertyForInlineStylesWarning(t, value);
      } else {
        processPropertyValueForInlineStylesWarning(t, value);
      }
    }
  }
}

function processInlineStylesWarning(
  t: typeof BabelCore.types,
  path: BabelCore.NodePath<BabelTypes.JSXAttribute>,
  state: BabelCore.PluginPass
) {
  if (isRelease()) return; // @ts-expect-error [TO DO]
  if (state.opts.disableInlineStylesWarning) return;
  if (path.node.name.name !== 'style') return;
  if (!t.isJSXExpressionContainer(path.node.value)) return;

  const expression = path
    .get('value')
    .get('expression') as BabelCore.NodePath<BabelTypes.Expression>;
  // style={[{...}, {...}]}
  if (BabelTypes.isArrayExpression(expression.node)) {
    const elements = expression.get('elements') as Array<
      BabelCore.NodePath<BabelTypes.ArrayExpression['elements'][number]>
    >;
    for (const element of elements) {
      if (t.isObjectExpression(element.node)) {
        processStyleObjectForInlineStylesWarning(
          t,
          element as BabelCore.NodePath<BabelTypes.ObjectExpression>
        ); // temporary [TO DO]
      }
    }
  }
  // style={{...}}
  else if (t.isObjectExpression(expression.node)) {
    processStyleObjectForInlineStylesWarning(
      t,
      expression as BabelCore.NodePath<BabelTypes.ObjectExpression>
    ); //why is it not inferred? [TO DO]
  }
}

module.exports = function ({
  types: t,
}: typeof BabelCore): BabelCore.PluginItem {
  return {
    pre() {
      // allows adding custom globals such as host-functions
      if (this.opts != null && Array.isArray(this.opts.globals)) {
        this.opts.globals.forEach((name: string) => {
          globals.add(name);
        });
      }
    },
    visitor: {
      CallExpression: {
        enter(
          path: BabelCore.NodePath<BabelTypes.CallExpression>,
          state: BabelCore.PluginPass
        ) {
          processWorklets(t, path, state);
        },
      },
      'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression': {
        enter(
          path: BabelCore.NodePath<
            | BabelTypes.FunctionDeclaration
            | BabelTypes.FunctionExpression
            | BabelTypes.ArrowFunctionExpression
          >,
          state: BabelCore.PluginPass
        ) {
          processIfWorkletNode(t, path, state);
          processIfGestureHandlerEventCallbackFunctionNode(t, path, state);
        },
      },
      JSXAttribute: {
        enter(path, state) {
          processInlineStylesWarning(t, path, state);
        },
      },
    },
  };
};
