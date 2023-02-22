"use strict";(self.webpackChunkreact_native_reanimated_docs=self.webpackChunkreact_native_reanimated_docs||[]).push([[6681],{3258:(e,n,t)=>{t.r(n),t.d(n,{assets:()=>s,contentTitle:()=>i,default:()=>p,frontMatter:()=>o,metadata:()=>l,toc:()=>c});var r=t(7462),a=(t(7294),t(3905));const o={id:"runOnJS",title:"runOnJS",sidebar_label:"runOnJS"},i=void 0,l={unversionedId:"api/miscellaneous/runOnJS",id:"api/miscellaneous/runOnJS",title:"runOnJS",description:"When you call a function on the UI thread you can't be sure if you're calling a worklet or a callback from the JS thread. To make it more transparent we introduced runOnJS, which calls a callback asynchronously. An exception will be thrown if you call a JS callback without this function.",source:"@site/docs/api/miscellaneous/runonJS.md",sourceDirName:"api/miscellaneous",slug:"/api/miscellaneous/runOnJS",permalink:"/react-native-reanimated/docs/api/miscellaneous/runOnJS",draft:!1,tags:[],version:"current",frontMatter:{id:"runOnJS",title:"runOnJS",sidebar_label:"runOnJS"},sidebar:"docs",previous:{title:"Interpolate",permalink:"/react-native-reanimated/docs/api/miscellaneous/interpolate"},next:{title:"runOnUI",permalink:"/react-native-reanimated/docs/api/miscellaneous/runOnUI"}},s={},c=[{value:"Arguments",id:"arguments",level:3},{value:"<code>fn</code> function",id:"fn-function",level:4},{value:"Returns",id:"returns",level:3},{value:"Example",id:"example",level:2}],u={toc:c};function p(e){let{components:n,...t}=e;return(0,a.kt)("wrapper",(0,r.Z)({},u,t,{components:n,mdxType:"MDXLayout"}),(0,a.kt)("p",null,"When you call a function on the UI thread you can't be sure if you're calling a worklet or a callback from the JS thread. To make it more transparent we introduced ",(0,a.kt)("inlineCode",{parentName:"p"},"runOnJS"),", which calls a callback asynchronously. An exception will be thrown if you call a JS callback without this function."),(0,a.kt)("admonition",{type:"info"},(0,a.kt)("p",{parentName:"admonition"},"If you want to invoke some function from an external library in ",(0,a.kt)("inlineCode",{parentName:"p"},"runOnJS")," please wrap it in a separate function."),(0,a.kt)("p",{parentName:"admonition"},"Code like this may not work:"),(0,a.kt)("pre",{parentName:"admonition"},(0,a.kt)("code",{parentName:"pre",className:"language-js"},"useDerivedValue(() => {\n  runOnJS(externalLibraryFunction)(args);\n});\n")),(0,a.kt)("p",{parentName:"admonition"},"But something like this will work:"),(0,a.kt)("pre",{parentName:"admonition"},(0,a.kt)("code",{parentName:"pre",className:"language-js"},"const wrapper = (args) => {\n  externalLibraryFunction(args);\n};\nuseDerivedValue(() => {\n  runOnJS(wrapper)(args);\n});\n")),(0,a.kt)("p",{parentName:"admonition"},"This is because internally ",(0,a.kt)("inlineCode",{parentName:"p"},"runOnJS")," uses ",(0,a.kt)("inlineCode",{parentName:"p"},"Object.defineProperty"),". Therefore if we want to call a method of some object we may not have access to ",(0,a.kt)("inlineCode",{parentName:"p"},"this")," inside the called function."),(0,a.kt)("p",{parentName:"admonition"},"This code shows how it works:"),(0,a.kt)("pre",{parentName:"admonition"},(0,a.kt)("code",{parentName:"pre",className:"language-js"},"class A {\n  foo() {\n    //... playing with [this]\n  }\n}\n\nconst a = new A();\nconst ob = {};\n// We do something like this in runOnJS\nObject.defineProperty(ob, 'foo', { enumerable: false, value: a.foo });\n\na.foo(5); // Normal [this] access\nob.foo(5); // [this] is not correct\n"))),(0,a.kt)("h3",{id:"arguments"},"Arguments"),(0,a.kt)("h4",{id:"fn-function"},(0,a.kt)("inlineCode",{parentName:"h4"},"fn")," ","[function]"),(0,a.kt)("p",null,"The first and only argument is the function that is supposed to be run."),(0,a.kt)("h3",{id:"returns"},"Returns"),(0,a.kt)("p",null,(0,a.kt)("inlineCode",{parentName:"p"},"runOnJS")," returns a function which can be safely run from the UI thread."),(0,a.kt)("h2",{id:"example"},"Example"),(0,a.kt)("p",null,"Here is an example of calling a javascript callback from the UI thread:"),(0,a.kt)("pre",null,(0,a.kt)("code",{parentName:"pre",className:"language-js",metastring:"{22}","{22}":!0},"import {\n  useSharedValue,\n  runOnJS,\n  useDerivedValue,\n  useAnimatedReaction,\n} from 'react-native-reanimated';\nimport { View, Button } from 'react-native';\nimport React from 'react';\n\nexport default function App() {\n  const randomWidth = useSharedValue(10);\n  const lastResults = [];\n\n  const recordResult = (result) => {\n    lastResults.push(result);\n    if (lastResults.length > 3) {\n      lastResults.shift();\n    }\n  };\n\n  useDerivedValue(() => {\n    runOnJS(recordResult)(randomWidth.value);\n  });\n\n  return (\n    <View>\n      <Button\n        title=\"toggle\"\n        onPress={() => {\n          randomWidth.value = Math.round(Math.random() * 350);\n        }}\n      />\n    </View>\n  );\n}\n")))}p.isMDXComponent=!0},3905:(e,n,t)=>{t.d(n,{Zo:()=>u,kt:()=>d});var r=t(7294);function a(e,n,t){return n in e?Object.defineProperty(e,n,{value:t,enumerable:!0,configurable:!0,writable:!0}):e[n]=t,e}function o(e,n){var t=Object.keys(e);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);n&&(r=r.filter((function(n){return Object.getOwnPropertyDescriptor(e,n).enumerable}))),t.push.apply(t,r)}return t}function i(e){for(var n=1;n<arguments.length;n++){var t=null!=arguments[n]?arguments[n]:{};n%2?o(Object(t),!0).forEach((function(n){a(e,n,t[n])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(t)):o(Object(t)).forEach((function(n){Object.defineProperty(e,n,Object.getOwnPropertyDescriptor(t,n))}))}return e}function l(e,n){if(null==e)return{};var t,r,a=function(e,n){if(null==e)return{};var t,r,a={},o=Object.keys(e);for(r=0;r<o.length;r++)t=o[r],n.indexOf(t)>=0||(a[t]=e[t]);return a}(e,n);if(Object.getOwnPropertySymbols){var o=Object.getOwnPropertySymbols(e);for(r=0;r<o.length;r++)t=o[r],n.indexOf(t)>=0||Object.prototype.propertyIsEnumerable.call(e,t)&&(a[t]=e[t])}return a}var s=r.createContext({}),c=function(e){var n=r.useContext(s),t=n;return e&&(t="function"==typeof e?e(n):i(i({},n),e)),t},u=function(e){var n=c(e.components);return r.createElement(s.Provider,{value:n},e.children)},p={inlineCode:"code",wrapper:function(e){var n=e.children;return r.createElement(r.Fragment,{},n)}},m=r.forwardRef((function(e,n){var t=e.components,a=e.mdxType,o=e.originalType,s=e.parentName,u=l(e,["components","mdxType","originalType","parentName"]),m=c(t),d=a,f=m["".concat(s,".").concat(d)]||m[d]||p[d]||o;return t?r.createElement(f,i(i({ref:n},u),{},{components:t})):r.createElement(f,i({ref:n},u))}));function d(e,n){var t=arguments,a=n&&n.mdxType;if("string"==typeof e||a){var o=t.length,i=new Array(o);i[0]=m;var l={};for(var s in n)hasOwnProperty.call(n,s)&&(l[s]=n[s]);l.originalType=e,l.mdxType="string"==typeof e?e:a,i[1]=l;for(var c=2;c<o;c++)i[c]=t[c];return r.createElement.apply(null,i)}return r.createElement.apply(null,t)}m.displayName="MDXCreateElement"}}]);