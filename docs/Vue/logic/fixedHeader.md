22s 동안 생각함

그 구조가 기능적으로도, “역할 분리” 관점에서도 가장 명확합니다. 특히 **Layout 전용 모듈**이라는 전제에서:

- `core/layoutContext.js`는 **레이아웃 인프라(헤더/스크롤 DOM, topOffset, CSS 변수, 헤더 fixed 제어)**
    
- `composable/useHeaderControl.js`는 **페이지 단위 정책(헤더 고정 on/off)**
    
- `composable/sticky/*`는 **페이지 콘텐츠의 sticky/pin 동작(등록/해제/누적 top 처리)**
    

로 분리되기 때문에, JS로 소비 프로젝트에서 검증한 뒤 TS로 라이브러리에 이식할 때도 그대로 가져가기 좋습니다.

아래는 **바로 붙여넣어 테스트 가능한 JS 코드 세트** + **레이아웃 컴포넌트 최소 수정 포인트**입니다.

---

## 0) 최종 파일 구조

```
src/
  core/
    layoutContext.js
  composable/
    useHeaderControl.js
    sticky/
      useScrollPin.js
      scrollPinDirective.js

```

## 1) core/layoutContext.js

- Layout.vue에서 `provideLayoutContext()` 호출
    
- Header.vue/Body.vue에서 각각 `registerHeaderEl`, `registerScrollEl`로 DOM 등록
    
- topOffset을 계산해 `--app-top-offset` 등 CSS 변수로 노출
    
- 헤더 fixed 토글을 컨텍스트로 제어(메타 기반을 점진적으로 대체)

```js
// src/core/layoutContext.js
import { reactive, readonly, provide, inject, nextTick } from "vue";

export const LayoutContextKey = Symbol("LayoutContext");

export function createLayoutContext(options = {}) {
  const state = reactive({
    headerEl: null,
    scrollEl: null,

    headerFixed: false,

    headerHeight: 0,
    safeTop: 0,
    topOffset: 0,

    // 필요하면 토큰화
    zHeader: options.zHeader ?? 2000,
    zPinned: options.zPinned ?? 1500,
  });

  let headerRO = null;

  function measureSafeTop() {
    // 소비 프로젝트 JS 검증 단계에서는 0으로 고정해도 됩니다.
    // (iOS safe-area가 필요해지면 CSS env(safe-area-inset-top) 기반으로 보강)
    state.safeTop = 0;
  }

  function measureHeaderHeight() {
    if (!state.headerEl) {
      state.headerHeight = 0;
      return 0;
    }
    state.headerHeight = Math.round(state.headerEl.getBoundingClientRect().height);
    return state.headerHeight;
  }

  function recomputeTopOffset() {
    state.topOffset = state.headerFixed ? (state.headerHeight + state.safeTop) : 0;

    // 페이지/디렉티브가 계산하지 않도록 CSS 변수로 공표
    document.documentElement.style.setProperty("--app-header-h", `${state.headerHeight}px`);
    document.documentElement.style.setProperty("--app-safe-top", `${state.safeTop}px`);
    document.documentElement.style.setProperty("--app-top-offset", `${state.topOffset}px`);

    document.documentElement.style.setProperty("--z-header", `${state.zHeader}`);
    document.documentElement.style.setProperty("--z-pinned", `${state.zPinned}`);
  }

  async function init() {
    await nextTick();
    measureSafeTop();
    measureHeaderHeight();
    recomputeTopOffset();
  }

  function registerHeaderEl(el) {
    state.headerEl = el;

    // 헤더 높이가 동적으로 변할 수 있어 ResizeObserver 권장
    if (headerRO) headerRO.disconnect();
    if (el && "ResizeObserver" in window) {
      headerRO = new ResizeObserver(() => {
        measureHeaderHeight();
        recomputeTopOffset();
      });
      headerRO.observe(el);
    } else {
      headerRO = null;
    }

    measureHeaderHeight();
    recomputeTopOffset();
  }

  function registerScrollEl(el) {
    state.scrollEl = el;
  }

  function setHeaderFixed(value) {
    state.headerFixed = !!value;
    // fixed 토글에 따라 offset 재계산
    measureHeaderHeight();
    recomputeTopOffset();
  }

  function refreshMetrics() {
    measureSafeTop();
    measureHeaderHeight();
    recomputeTopOffset();
  }

  return {
    state: readonly(state),

    init,
    registerHeaderEl,
    registerScrollEl,

    setHeaderFixed,
    refreshMetrics,

    getScrollEl: () => state.scrollEl,
    getTopOffset: () => state.topOffset,
  };
}

export function provideLayoutContext(ctx) {
  provide(LayoutContextKey, ctx);
}

export function useLayoutContext() {
  const ctx = inject(LayoutContextKey, null);
  if (!ctx) throw new Error("LayoutContext not provided. Call provideLayoutContext() in Layout root.");
  return ctx;
}

```

---

## 2) composable/useHeaderControl.js

- 페이지에서 헤더 고정 여부를 “선언”하면 자동 적용/해제
    
- keep-alive 대응: activated/deactivated에서 재적용/해제
```js
// src/composable/useHeaderControl.js
import { onMounted, onBeforeUnmount, onActivated, onDeactivated } from "vue";
import { useLayoutContext } from "@/core/layoutContext";

export function useHeaderControl(options = {}) {
  const ctx = useLayoutContext();

  const fixed = !!options.fixed;
  const resetOnLeave = options.resetOnLeave ?? true;

  function apply() {
    ctx.setHeaderFixed(fixed);
  }

  function reset() {
    if (resetOnLeave) ctx.setHeaderFixed(false);
  }

  onMounted(apply);
  onBeforeUnmount(reset);

  // keep-alive
  onActivated(apply);
  onDeactivated(reset);

  return {
    setFixed: ctx.setHeaderFixed,
    refreshMetrics: ctx.refreshMetrics,
    getTopOffset: ctx.getTopOffset,
  };
}

```

---

## 3) composable/sticky/useScrollPin.js

- “등록된 요소”가 헤더 기준선을 지나가면 **헤더 밑으로 pin**
    
- 다시 기준선 아래로 돌아오면 **원위치(flow)로 복귀**
    
- placeholder로 레이아웃 점프 방지
    
- 다중 등록 시 stackOrder로 쌓임(top 누적)
```js
// src/composable/sticky/useScrollPin.js
import { onBeforeUnmount } from "vue";
import { useLayoutContext } from "@/core/layoutContext";

const px = (n) => `${Math.round(n)}px`;

function createSentinel() {
  const s = document.createElement("div");
  s.style.height = "1px";
  s.style.width = "1px";
  s.style.pointerEvents = "none";
  return s;
}

function createPlaceholder(heightPx) {
  const ph = document.createElement("div");
  ph.style.height = heightPx;
  ph.style.width = "100%";
  ph.style.pointerEvents = "none";
  ph.__isPinPlaceholder = true;
  return ph;
}

export function createScrollPinManager(layoutCtx) {
  const items = new Map(); // id -> item
  let pinnedOrder = []; // pinned ids sorted by stackOrder
  let io = null;
  let ro = null;

  function ensureObservers() {
    const root = layoutCtx.getScrollEl();
    if (!root) throw new Error("ScrollPin: scrollEl not registered. Call registerScrollEl in Body.vue.");

    if (!io) {
      io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const item = entry.target.__pinItem;
            if (!item) continue;

            // sentinel이 보이면 FLOW, 안 보이면 PINNED
            if (entry.isIntersecting) unpin(item.id);
            else pin(item.id);
          }
        },
        {
          root,
          threshold: 0,
          // 헤더 아래 기준선 보정
          rootMargin: `-${layoutCtx.getTopOffset()}px 0px 0px 0px`,
        }
      );
    }

    if (!ro && "ResizeObserver" in window) {
      ro = new ResizeObserver(() => refreshPinnedPositions());
    }
  }

  function rebuildObserver() {
    // topOffset이 바뀌면 rootMargin도 바뀌어야 하므로 재생성
    if (io) {
      io.disconnect();
      io = null;
    }
    ensureObservers();
    for (const item of items.values()) io.observe(item.sentinelEl);
    refreshPinnedPositions();
  }

  function sortPinned() {
    pinnedOrder.sort((a, b) => {
      const ia = items.get(a);
      const ib = items.get(b);
      return (ia?.stackOrder ?? 0) - (ib?.stackOrder ?? 0);
    });
  }

  function computeStackTop(targetId) {
    const base = layoutCtx.getTopOffset();
    let acc = 0;
    for (const id of pinnedOrder) {
      if (id === targetId) break;
      const it = items.get(id);
      if (!it) continue;
      acc += it.height;
    }
    return base + acc;
  }

  function refreshPinnedPositions() {
    // pinned 요소들 height 재측정 후 top 재적용
    for (const id of pinnedOrder) {
      const item = items.get(id);
      if (!item?.isPinned) continue;

      const h = Math.round(item.el.getBoundingClientRect().height);
      item.height = h;
      if (item.placeholderEl) item.placeholderEl.style.height = px(h);
    }

    for (const id of pinnedOrder) {
      const item = items.get(id);
      if (!item?.isPinned) continue;
      item.el.style.top = px(computeStackTop(id));
    }
  }

  function pin(id) {
    const item = items.get(id);
    if (!item || item.isPinned) return;

    const rect = item.el.getBoundingClientRect();

    // placeholder로 자리 보전
    const h = Math.round(rect.height);
    item.height = h;
    item.placeholderEl = createPlaceholder(px(h));
    item.sentinelEl.insertAdjacentElement("afterend", item.placeholderEl);

    // pinnedOrder 등록
    if (!pinnedOrder.includes(id)) pinnedOrder.push(id);
    sortPinned();

    // fixed로 띄우기 (viewport 기준)
    item.el.style.position = "fixed";
    item.el.style.left = px(rect.left);
    item.el.style.width = px(rect.width);
    item.el.style.zIndex = String(item.zIndex);
    item.el.style.margin = "0";
    item.el.style.top = px(computeStackTop(id));

    item.isPinned = true;
    refreshPinnedPositions();
  }

  function unpin(id) {
    const item = items.get(id);
    if (!item || !item.isPinned) return;

    pinnedOrder = pinnedOrder.filter((x) => x !== id);

    // 스타일 원복
    item.el.style.position = "";
    item.el.style.top = "";
    item.el.style.left = "";
    item.el.style.width = "";
    item.el.style.zIndex = "";
    item.el.style.margin = "";

    // placeholder 제거
    if (item.placeholderEl) {
      item.placeholderEl.remove();
      item.placeholderEl = null;
    }

    item.isPinned = false;
    refreshPinnedPositions();
  }

  function register(el, options = {}) {
    ensureObservers();

    const id = options.id ?? `pin_${Math.random().toString(16).slice(2)}`;
    const stackOrder = Number.isFinite(options.stackOrder) ? options.stackOrder : 0;
    const zIndex = Number.isFinite(options.zIndex)
      ? options.zIndex
      : (layoutCtx.state?.zPinned ?? 1500);

    const sentinelEl = createSentinel();
    el.insertAdjacentElement("beforebegin", sentinelEl);

    const item = {
      id,
      el,
      sentinelEl,
      placeholderEl: null,
      isPinned: false,
      height: 0,
      stackOrder,
      zIndex,
    };

    sentinelEl.__pinItem = item;

    items.set(id, item);

    io.observe(sentinelEl);
    if (ro) ro.observe(el);

    return () => unregister(id);
  }

  function unregister(id) {
    const item = items.get(id);
    if (!item) return;

    unpin(id);

    if (io) io.unobserve(item.sentinelEl);
    if (ro) ro.unobserve(item.el);

    item.sentinelEl.remove();
    if (item.placeholderEl) item.placeholderEl.remove();

    items.delete(id);
  }

  function destroy() {
    for (const id of [...items.keys()]) unregister(id);
    if (ro) {
      ro.disconnect();
      ro = null;
    }
    if (io) {
      io.disconnect();
      io = null;
    }
    pinnedOrder = [];
  }

  return {
    register,
    unregister,
    rebuildObserver, // 헤더 fixed 토글로 topOffset 바뀌면 호출
    refreshPinnedPositions,
    destroy,
  };
}

export function useScrollPin() {
  const ctx = useLayoutContext();
  const manager = createScrollPinManager(ctx);

  onBeforeUnmount(() => manager.destroy());

  return manager;
}

```
---

## 4) composable/sticky/scrollPinDirective.js

- 디렉티브는 각 컴포넌트 인스턴스별로 manager를 1개 캐시합니다(WeakMap)
    
- 같은 페이지에서 여러 요소에 붙여도 manager는 하나만 생성됩니다.
```js
// src/composable/sticky/scrollPinDirective.js
import { LayoutContextKey } from "@/core/layoutContext";
import { createScrollPinManager } from "./useScrollPin";

const mgrMap = new WeakMap(); // instance -> manager

function getLayoutCtxFromInstance(binding) {
  const inst = binding?.instance;
  const internal = inst?.$; // Vue 내부 인스턴스
  const provides = internal?.provides;
  const ctx = provides ? provides[LayoutContextKey] : null;
  if (!ctx) throw new Error("v-scroll-pin: LayoutContext not found. Ensure Layout.vue provides it.");
  return ctx;
}

function getManager(binding) {
  const inst = binding.instance?.$;
  if (!inst) throw new Error("v-scroll-pin: component instance not found.");

  if (mgrMap.has(inst)) return mgrMap.get(inst);

  const ctx = getLayoutCtxFromInstance(binding);
  const mgr = createScrollPinManager(ctx);
  mgrMap.set(inst, mgr);

  return mgr;
}

export const scrollPinDirective = {
  mounted(el, binding) {
    const mgr = getManager(binding);
    const opts = binding.value ?? {};
    el.__unpin = mgr.register(el, opts);
  },
  updated(el, binding) {
    // 옵션이 바뀌는 케이스가 있으면 재등록도 가능 (필요 시 사용)
    // 기본은 no-op
  },
  beforeUnmount(el, binding) {
    if (el.__unpin) el.__unpin();
    el.__unpin = null;

    // 컴포넌트 단위 cleanup은 directive만으로 완벽히 감지하기 어렵기 때문에
    // 페이지(unmount) 시 manager.destroy는 useScrollPin()를 쓰는 화면에서 처리하거나,
    // keep-alive가 없다면 사실상 자동 GC로 충분합니다.
    // (TS 이식 단계에서 더 정교하게 정리 권장)
  },
};

```


---

## 5) 레이아웃 컴포넌트 최소 수정 포인트

### 5-1) components/layout/Layout.vue

- 컨텍스트 생성/Provide (한 번)
    
- init 호출(헤더 높이 계산용)

```js
// Layout.vue (script)
import { createLayoutContext, provideLayoutContext } from "@/core/layoutContext";

const layoutCtx = createLayoutContext({ zHeader: 2000, zPinned: 1500 });
provideLayoutContext(layoutCtx);
layoutCtx.init();

```

	`script setup`이면 위 3줄이면 충분합니다.


---

### 5-2) components/layout/Header.vue

- 헤더 root DOM에 ref를 걸고 등록
    
- 기존 meta 기반 fixed 처리 대신(또는 병행으로) `layoutCtx.state.headerFixed`를 반영

```js
// Header.vue (script)
import { ref, onMounted } from "vue";
import { useLayoutContext } from "@/core/layoutContext";

const ctx = useLayoutContext();
const headerRef = ref(null);

onMounted(() => {
  ctx.registerHeaderEl(headerRef.value);
});

```
템플릿 예:
```js
<header ref="headerRef" :class="{ 'is-fixed': ctx.state.headerFixed }">
  ...
</header>

```

---

### 5-3) components/layout/Body.vue

- “실제로 스크롤 되는 엘리먼트”에 ref를 걸고 등록해야 합니다.
    
- Body 스크롤 모델을 권장합니다(이 패턴이 가장 안정적).

```js
// Body.vue (script)
import { ref, onMounted } from "vue";
import { useLayoutContext } from "@/core/layoutContext";

const ctx = useLayoutContext();
const scrollRef = ref(null);

onMounted(() => {
  ctx.registerScrollEl(scrollRef.value);
});
```

템플릿 예:
```js
<div ref="scrollRef" class="body-scroll">
  <slot />
</div>

```

CSS(필수 개념):
```css
.body-scroll {
  height: 100%;
  overflow: auto;
  /* 헤더 fixed일 때 컨텐츠가 가려지지 않게 */
  padding-top: var(--app-top-offset);
}

```
---

## 6) main.js(또는 main.ts)에서 directive 등록

```js
import { createApp } from "vue";
import App from "./App.vue";
import { scrollPinDirective } from "@/composable/sticky/scrollPinDirective";

const app = createApp(App);
app.directive("scroll-pin", scrollPinDirective);
app.mount("#app");

```

## 7) 페이지에서 사용 방식(검증용 최소 형태)

1. 페이지에서 헤더 고정 여부를 설정:
```js
import { useHeaderControl } from "@/composable/useHeaderControl";
useHeaderControl({ fixed: true });

```
2. 헤더 아래 붙일 요소에 선언:
```js
<div v-scroll-pin="{ id: 'filters', stackOrder: 0 }">
  <!-- 필터/탭/타이틀 등 -->
</div>

```

다중 고정이면 stackOrder만 다르게 주면 됩니다.

---

## 8) 중요 운영 포인트(테스트 시 바로 확인)

- `Body.vue`에서 등록한 `scrollRef`가 **진짜로 스크롤되는 컨테이너인지**가 1순위입니다.
    
- 헤더 fixed 토글 후 topOffset이 바뀌면, observer rootMargin 갱신이 필요할 수 있습니다.  
    테스트 중에 “헤더 fixed on/off를 페이지에서 바꿀” 계획이 있으면, 페이지에서 한 번 `rebuildObserver()`를 호출하는 흐름을 넣으면 됩니다(다음 단계에서 TS로 올릴 때는 컨텍스트 변경 감지로 자동화 가능).
    

---

원하시면, 다음 단계로 바로 **“헤더 고정(meta) → composable 우선순위로 대체”**까지 포함해서, 충돌 없는 정책(기본값/meta/override/cleanup)을 정리하고 TS 변환 가이드까지 이어서 드리겠습니다.

