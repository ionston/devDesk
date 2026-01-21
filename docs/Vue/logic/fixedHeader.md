# fixed header

아래는 요청하신 전제(“**사용 프로젝트는 JS로 테스트**, 라이브러리는 **TS로 작성·빌드**해서 실제로 설치/사용”)를 그대로 반영한 **권장 구조 + 최소 구현 세트**입니다.

핵심 목표는 이것입니다.

- 라이브러리의 Layout(Container)이 **헤더 높이를 측정**하고 provide
    
- 사용 프로젝트의 “화면 컴포넌트(Body 안)”에서 `useLayoutSticky({ order })`만 호출하면
    
    - 탭/버튼 등 요소들이 **헤더 밑에 차례대로 sticky** 되도록
        
    - `top` 정보를 받는다
        
- 사용 프로젝트는 TS가 아니어도 된다(JS에서 그대로 사용)
    

---

# 1) 최종 사용 모습(사용 프로젝트: JS)

화면 컴포넌트에서 이렇게만 쓰는 게 목표입니다.

```js
<script setup>
import { useLayoutSticky } from "@your-scope/layout-kit";

const tabs = useLayoutSticky({ order: 10 });
const actions = useLayoutSticky({ order: 20 });
</script>

<template>
  <div
    ref="tabs.stickyRef"
    :style="{ position: 'sticky', top: tabs.top + 'px', zIndex: tabs.zIndex }"
  >
    Tabs
  </div>

  <div
    ref="actions.stickyRef"
    :style="{ position: 'sticky', top: actions.top + 'px', zIndex: actions.zIndex }"
  >
    Actions
  </div>

  <div style="padding:16px">
    <!-- 긴 컨텐츠 -->
  </div>
</template>

```
- 등록 순서 무관
    
- `order`만 주면 “차례대로” top이 쌓임
    
- 높이는 자동 측정(ResizeObserver)
    
- 헤더 높이가 변하면(배너 등) top 자동 갱신
    

---

# 2) 라이브러리(TS) 프로젝트 구조

예시 패키지명: `@your-scope/layout-kit`

```shell
packages/layout-kit/
  src/
    index.ts
    keys.ts
    types.ts
    composables/
      createStickyManager.ts
      useHeaderMeasure.ts
      useLayoutSticky.ts
    components/
      LayoutContainer.vue
  package.json
  tsconfig.json
  vite.config.ts

```

---

# 3) 라이브러리 핵심 구현(TS)

## 3-1) keys.ts

```ts
// packages/layout-kit/src/keys.ts
import type { InjectionKey, Ref } from "vue";
import type { StickyManager } from "./types";

export const HeaderHeightKey: InjectionKey<Ref<number>> = Symbol("HeaderHeightKey");
export const StickyManagerKey: InjectionKey<StickyManager> = Symbol("StickyManagerKey");

```

## 3-2) types.ts

```ts
// packages/layout-kit/src/types.ts
import type { ComputedRef } from "vue";

export type StickyId = string;

export interface StickyRegisterOptions {
  id: StickyId;
  order: number;       // 작을수록 위(헤더 바로 아래)
  enabled?: boolean;   // 기본 true
}

export interface StickyItemState {
  id: StickyId;
  order: number;
  enabled: boolean;
  height: number;
  mountedAt: number;   // tie-breaker(안정 정렬)
}

export interface StickyManager {
  register(opts: StickyRegisterOptions): () => void;
  unregister(id: StickyId): void;
  updateHeight(id: StickyId, height: number): void;
  setEnabled(id: StickyId, enabled: boolean): void;

  getTop(id: StickyId): ComputedRef<number>;
  getZIndex(id: StickyId): ComputedRef<number>;

  // 디버깅/확장용
  stackHeight: ComputedRef<number>;
}

```

## 3-3) useHeaderMeasure.ts (헤더 높이 측정)

```ts
// packages/layout-kit/src/composables/useHeaderMeasure.ts
import { ref, onMounted, onUnmounted, watch, type Ref } from "vue";

export function useHeaderMeasure(headerElRef: Ref<HTMLElement | null>) {
  const height = ref(0);
  let ro: ResizeObserver | null = null;

  const measureOnce = () => {
    const el = headerElRef.value;
    if (!el) return;
    height.value = Math.round(el.getBoundingClientRect().height);
  };

  onMounted(() => {
    measureOnce();
    ro = new ResizeObserver(() => measureOnce());

    if (headerElRef.value) ro.observe(headerElRef.value);
  });

  watch(
    () => headerElRef.value,
    (el, prev) => {
      if (!ro) return;
      if (prev) ro.unobserve(prev);
      if (el) ro.observe(el);
      measureOnce();
    }
  );

  onUnmounted(() => {
    ro?.disconnect();
    ro = null;
  });

  return { height };
}

```

## 3-4) createStickyManager.ts (order 기반 top 계산)

```ts
// packages/layout-kit/src/composables/createStickyManager.ts
import { computed, reactive, type Ref } from "vue";
import type { StickyItemState, StickyManager, StickyRegisterOptions } from "../types";

function clamp0(n: number) {
  return n < 0 ? 0 : n;
}

export function createStickyManager(headerHeightRef: Ref<number>): StickyManager {
  const itemsById = reactive(new Map<string, StickyItemState>());

  const sortedActive = computed(() => {
    const arr = Array.from(itemsById.values()).filter((x) => x.enabled);

    // 안정 정렬: order -> mountedAt
    arr.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.mountedAt - b.mountedAt;
    });

    return arr;
  });

  const tops = computed(() => {
    const map = new Map<string, number>();
    let acc = clamp0(headerHeightRef.value || 0);

    for (const item of sortedActive.value) {
      map.set(item.id, acc);
      acc += clamp0(item.height || 0);
    }
    return map;
  });

  const stackHeight = computed(() => {
    return sortedActive.value.reduce((sum, x) => sum + clamp0(x.height || 0), 0);
  });

  function register(opts: StickyRegisterOptions) {
    const { id, order } = opts;
    const enabled = opts.enabled ?? true;

    if (!id) throw new Error("Sticky register: id is required");
    if (typeof order !== "number") throw new Error("Sticky register: order is required");

    const now = Date.now();
    const prev = itemsById.get(id);

    itemsById.set(id, {
      id,
      order,
      enabled,
      height: prev?.height ?? 0,
      mountedAt: prev?.mountedAt ?? now,
    });

    return () => unregister(id);
  }

  function unregister(id: string) {
    itemsById.delete(id);
  }

  function updateHeight(id: string, height: number) {
    const item = itemsById.get(id);
    if (!item) return;
    item.height = clamp0(Math.round(height || 0));
    itemsById.set(id, item);
  }

  function setEnabled(id: string, enabled: boolean) {
    const item = itemsById.get(id);
    if (!item) return;
    item.enabled = !!enabled;
    itemsById.set(id, item);
  }

  function getTop(id: string) {
    return computed(() => tops.value.get(id) ?? clamp0(headerHeightRef.value || 0));
  }

  function getZIndex(id: string) {
    // 간단 정책: order가 작을수록 z-index 높게(위에 떠야 하니까)
    // 필요하면 프로젝트 규칙에 맞게 바꾸세요.
    return computed(() => {
      const item = itemsById.get(id);
      const order = item?.order ?? 9999;
      return 1000 - order; // order=10 => 990, order=20 => 980 ...
    });
  }

  return {
    register,
    unregister,
    updateHeight,
    setEnabled,
    getTop,
    getZIndex,
    stackHeight,
  };
}

```

## 3-5) useLayoutSticky.ts (컨슈머가 직접 쓰는 “단일” 컴포저블)

```ts
// packages/layout-kit/src/composables/useLayoutSticky.ts
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { StickyManagerKey } from "../keys";
import type { StickyId } from "../types";

let __uid = 0;
function genId(prefix = "sticky") {
  __uid += 1;
  return `${prefix}-${Date.now()}-${__uid}`;
}

export function useLayoutSticky(opts: { order: number; id?: StickyId; enabled?: boolean }) {
  const manager = inject(StickyManagerKey);
  if (!manager) {
    throw new Error("useLayoutSticky(): StickyManager is not provided. Ensure LayoutContainer is used.");
  }

  const id = opts.id ?? genId();
  const order = opts.order;
  const enabled = opts.enabled ?? true;

  const stickyRef = ref<HTMLElement | null>(null);
  const top = manager.getTop(id);
  const zIndex = manager.getZIndex(id);

  let unregister: (() => void) | null = null;
  let ro: ResizeObserver | null = null;

  const measureOnce = () => {
    const el = stickyRef.value;
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    manager.updateHeight(id, h);
  };

  onMounted(() => {
    unregister = manager.register({ id, order, enabled });
    measureOnce();

    ro = new ResizeObserver(() => measureOnce());
    if (stickyRef.value) ro.observe(stickyRef.value);
  });

  watch(
    () => stickyRef.value,
    (el, prev) => {
      if (!ro) return;
      if (prev) ro.unobserve(prev);
      if (el) ro.observe(el);
      measureOnce();
    }
  );

  onUnmounted(() => {
    ro?.disconnect();
    ro = null;
    unregister?.();
    unregister = null;
  });

  function setEnabled(next: boolean) {
    manager.setEnabled(id, !!next);
  }

  return {
    id,
    stickyRef,
    top: computed(() => top.value),
    zIndex: computed(() => zIndex.value),
    setEnabled,
  };
}

```

---

# 4) 라이브러리 LayoutContainer.vue (provide를 여기서 한다)

이 컴포넌트를 사용 프로젝트에서 레이아웃으로 감싸기만 하면, Body 안 모든 화면에서 `useLayoutSticky()` 사용 가능해집니다.

```vue
<!-- packages/layout-kit/src/components/LayoutContainer.vue -->
<template>
  <div class="lk-root">
    <header ref="headerEl" class="lk-header">
      <slot name="header" />
    </header>

    <main class="lk-body" :style="{ paddingTop: headerHeight + 'px' }">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, provide, computed } from "vue";
import { HeaderHeightKey, StickyManagerKey } from "../keys";
import { useHeaderMeasure } from "../composables/useHeaderMeasure";
import { createStickyManager } from "../composables/createStickyManager";

const headerEl = ref<HTMLElement | null>(null);

const { height } = useHeaderMeasure(headerEl);
const headerHeight = computed(() => height.value);

// provide: 헤더 높이(필요하면 컨슈머가 직접 쓸 수도 있음)
provide(HeaderHeightKey, headerHeight);

// provide: sticky 매니저
const manager = createStickyManager(headerHeight);
provide(StickyManagerKey, manager);
</script>

<style scoped>
.lk-root {
  height: 100vh;
  overflow: hidden;
}

.lk-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2000;
  background: #fff;
  border-bottom: 1px solid #e5e5e5;
}

.lk-body {
  height: 100%;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  background: #f7f7f7;
}
</style>

```

---

# 5) 라이브러리 엔트리 export (index.ts)


```ts
// packages/layout-kit/src/index.ts
export { default as LayoutContainer } from "./components/LayoutContainer.vue";
export { useLayoutSticky } from "./composables/useLayoutSticky";
export { HeaderHeightKey, StickyManagerKey } from "./keys";
export type { StickyManager } from "./types";
```

---

# 6) 라이브러리 빌드 설정 (Vite library mode)

## vite.config.ts (TS)

```ts
// packages/layout-kit/vite.config.ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "LayoutKit",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: ["vue"], // peerDependencies로 처리
      output: {
        globals: {
          vue: "Vue",
        },
      },
    },
  },
});

```

## package.json (라이브러리)

```json
{
  "name": "@your-scope/layout-kit",
  "version": "0.0.1",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "peerDependencies": {
    "vue": "^3.3.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "@vitejs/plugin-vue": "^5.0.0",
    "typescript": "^5.0.0",
    "vue-tsc": "^2.0.0"
  },
  "scripts": {
    "build": "vue-tsc --declaration --emitDeclarationOnly --outDir dist && vite build"
  }
}

```

> 타입 선언 파일(`index.d.ts`)은 `vue-tsc`로 `dist`에 내보내고, Vite로 JS 번들을 만듭니다.

---

# 7) 사용 프로젝트(JS)에서 테스트하는 방법

## 7-1) 설치(로컬 tgz로 테스트)

라이브러리에서:

```bash
cd packages/layout-kit
npm run build
npm pack
# => @your-scope-layout-kit-0.0.1.tgz 생성

```

사용 프로젝트에서:

```bash
npm i ../packages/layout-kit/@your-scope-layout-kit-0.0.1.tgz
# 또는 pnpm add file:...

```

## 7-2) 사용 프로젝트 화면(JS) 예제

### App.vue 또는 라우트 레이아웃

```vue
<script setup>
import { LayoutContainer } from "@your-scope/layout-kit";
import DemoPage from "./pages/DemoPage.vue";
</script>

<template>
  <LayoutContainer>
    <template #header>
      <div style="padding:16px">
        <div style="font-weight:700">Fixed Header</div>
        <div style="font-size:12px;opacity:.7">헤더 높이 변해도 sticky top 자동 갱신</div>
      </div>
    </template>

    <DemoPage />
  </LayoutContainer>
</template>

```

### DemoPage.vue (JS)

```vue
<script setup>
import { useLayoutSticky } from "@your-scope/layout-kit";

const tabs = useLayoutSticky({ order: 10 });
const filter = useLayoutSticky({ order: 20 });
const actions = useLayoutSticky({ order: 30 });
</script>

<template>
  <div
    ref="tabs.stickyRef"
    :style="{ position: 'sticky', top: tabs.top + 'px', zIndex: tabs.zIndex, background:'#fff', borderBottom:'1px solid #ddd' }"
  >
    <div style="padding:12px 16px">Tabs (order=10) top={{ tabs.top }}</div>
  </div>

  <div
    ref="filter.stickyRef"
    :style="{ position: 'sticky', top: filter.top + 'px', zIndex: filter.zIndex, background:'#fff', borderBottom:'1px solid #ddd' }"
  >
    <div style="padding:12px 16px">Filter (order=20) top={{ filter.top }}</div>
  </div>

  <div
    ref="actions.stickyRef"
    :style="{ position: 'sticky', top: actions.top + 'px', zIndex: actions.zIndex, background:'#fff', borderBottom:'1px solid #ddd' }"
  >
    <div style="padding:12px 16px">Actions (order=30) top={{ actions.top }}</div>
  </div>

  <div style="padding:16px">
    <div v-for="i in 80" :key="i" style="background:#fff;border:1px solid #eee;margin-bottom:8px;padding:12px">
      Row {{ i }}
    </div>
  </div>
</template>

```

---

# 8) 중요한 운영 포인트(지금 단계에서 딱 2개만)

1. **헤더가 fixed이면 Body에 paddingTop을 headerHeight만큼 주는 것**이 필수입니다.  
    그래야 컨텐츠가 헤더에 가려지지 않습니다. (위 `LayoutContainer`에 반영)
    
2. “차례대로 고정”은 결국 CSS sticky + top 계산의 문제입니다.  
    라이브러리는 `top`을 정확히 계산해주고, 사용 프로젝트는 `position: sticky`만 적용하면 됩니다.
    

---

원하시면, 다음 단계로 “헤더가 translate로 숨겨질 때(유효 높이 감소)까지 반영한 `effectiveHeaderHeight`” 버전으로 확장해 드리겠습니다. 지금 제공한 구현은 **헤더 높이 변화(배너 등)** 와 **여러 sticky 스택**을 먼저 안정적으로 해결하는 최소 세트입니다.