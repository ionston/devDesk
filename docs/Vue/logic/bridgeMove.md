```js
// common/nativeNavigator.js
function resolveNav() {
  return window?.bridge?.navigator || window?.navigatorBridge;
}

function invoke(method, ...args) {
  const nav = resolveNav();
  const fn = nav?.[method];
  if (typeof fn !== "function") throw new Error(`Unknown: ${method}`);
  return fn.apply(nav, args);
}

export const nativeNavigator = {
  open: (url, opts) => invoke("open", url, opts),
  main: () => invoke("main"),
  // 앞으로 필요한 것만 “공식 API”로 추가
};
```