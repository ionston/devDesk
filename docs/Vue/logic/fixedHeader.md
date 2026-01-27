좋습니다. 아래는 **최소침습 버전**을 “차례대로” 적용할 수 있게 **전체 코드(가정 포함)**를 한 번에 정리한 패키지입니다.

- 가정 1) meta 키: `route.meta.headerFixed`
    
- 가정 2) 고정 클래스: `.is-fixed`
    
- 가정 3) 기존 autoHide(헤더 자동 숨김/표시)는 **그대로 유지**(손대지 않음)
    
- 목표: **meta로 헤더 고정 주입하던 부분만** composable override로 대체 + 페이지 sticky(pin) 등록 가능
    

---

#### A. 적용 순서(이 순서대로 하면 안전)

1. `stores/layout.js`에 **override + scrollEl** 추가
    
2. `Body.vue`에서 scrollEl을 store에 등록(1~2줄)
    
3. `Header.vue`(또는 고정 클래스를 붙이는 파일)에서  
    **meta 대신 “override 우선” computed만 추가**
    
4. 고정이 필요한 페이지에서 `useHeaderPinned(true)` 호출
    
5. sticky 컨텐츠 필요 페이지에서 `useScrollPin().bindPin(...)` 등록
    

---

#### 1) `src/stores/layout.js` (기존 store에 추가)

```js
// src/stores/layout.js
import { defineStore } from "pinia";
import { ref } from "vue";

export const useLayoutStore = defineStore("layout", () => {
  /**
   * null: override 없음(기존 meta/기본값 사용)
   * true/false: 페이지 composable이 강제로 고정 여부 설정
   */
  const headerFixedOverride = ref(null);

  /**
   * pin 시스템이 사용할 스크롤 컨테이너(Body)
   */
  const scrollEl = ref(null);

  /**
   * @param {boolean|null} value
   */
  function setHeaderFixedOverride(value) {
    headerFixedOverride.value = value;
  }

  /**
   * @param {HTMLElement|null} el
   */
  function setScrollEl(el) {
    scrollEl.value = el;
  }

  return {
    headerFixedOverride,
    setHeaderFixedOverride,
    scrollEl,
    setScrollEl,
  };
});

```

---

#### 2) `src/components/layout/Body.vue` (scrollEl 등록만 추가)

```js
<!-- src/components/layout/Body.vue -->
<template>
  <div ref="scrollRef" class="layout-body-scroll">
    <slot />
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useLayoutStore } from "@/stores/layout";

const scrollRef = ref(null);
const layoutStore = useLayoutStore();

/**
 * ✅ 최소침습: 기존 구현 수정 없이
 * pin 시스템이 스크롤 루트를 알 수 있게 등록만 한다.
 */
onMounted(() => {
  layoutStore.setScrollEl(scrollRef.value);
});
</script>

<style scoped>
.layout-body-scroll {
  flex: 1;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
</style>

```

#### 3) `src/components/layout/Header.vue` (meta → override 우선으로만 변경)

> **중요:** autoHide가 “클래스 내부에서 동작”한다면, 그 클래스/로직은 건드리지 않습니다.  
> 여기서는 “헤더 고정 스타일 주입 조건”만 바꿉니다.

```js
<!-- src/components/layout/Header.vue -->
<template>
  <header
    class="layout-header"
    :class="{
      /**
       * ✅ 기존 고정 클래스명 그대로 유지 (가정: is-fixed)
       * ✅ 조건만 meta -> override 우선으로 교체
       */
      'is-fixed': isHeaderFixed
    }"
  >
    <slot />
  </header>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useLayoutStore } from "@/stores/layout";

const route = useRoute();
const layoutStore = useLayoutStore();

/**
 * ✅ 핵심: override 우선
 * - override가 null이면 기존 meta를 사용 (기존 동작 유지)
 * - override가 true/false면 meta 무시하고 강제
 */
const isHeaderFixed = computed(() => {
  const override = layoutStore.headerFixedOverride;
  if (override === null || override === undefined) {
    // 가정: meta 키 headerFixed
    return !!route.meta.headerFixed;
  }
  return !!override;
});
</script>

<style scoped>
/**
 * ⚠️ 프로젝트에 이미 퍼블리셔 CSS가 있으면 이 블록은 제거하세요.
 * 아래는 "가정"용 최소 스타일입니다.
 */
.layout-header.is-fixed {
  position: sticky;
  top: 0;
  z-index: 2000;
}
</style>

```

#### 4) `src/composable/useHeaderPinned.js` (페이지에서 1줄로 고정 선언)
```js
// src/composable/useHeaderPinned.js
import { onMounted, onBeforeUnmount, onActivated, onDeactivated } from "vue";
import { useLayoutStore } from "@/stores/layout";

/**
 * 페이지 단위 헤더 고정 선언 (최소침습)
 * - 기존 meta/autoHide는 유지
 * - 이 페이지만 override로 고정 on/off
 */
export function useHeaderPinned(pinned = true, options = {}) {
  const layoutStore = useLayoutStore();
  const resetOnLeave = options.resetOnLeave ?? true;

  function apply() {
    layoutStore.setHeaderFixedOverride(!!pinned);
  }

  function reset() {
    if (resetOnLeave) layoutStore.setHeaderFixedOverride(null); // ✅ 원복: 기존 meta/기본값으로
  }

  onMounted(apply);
  onBeforeUnmount(reset);

  // keep-alive 대응
  onActivated(apply);
  onDeactivated(reset);

  return {
    setPinned: (v) => layoutStore.setHeaderFixedOverride(!!v),
    clear: () => layoutStore.setHeaderFixedOverride(null),
  };
}

```


#### 5) `src/composable/sticky/useScrollPin.js` (페이지 sticky 등록: id/order 필수)

> 최소침습이라 “레이아웃 오프셋”을 정확히 공유하기 어렵습니다.  
> 그래서 임시로 `layout-header` 높이를 DOM에서 읽습니다(가정).  
> **당장 동작 확인용**이며, 다음 단계에서 “기존 레이아웃이 쓰는 오프셋 변수/클래스”로 교체하면 완성도가 올라갑니다.

```js
// src/composable/sticky/useScrollPin.js
import { nextTick, onBeforeUnmount } from "vue";
import { useLayoutStore } from "@/stores/layout";

const px = (n) => `${Math.round(n)}px`;

function createSentinel() {
  const s = document.createElement("div");
  s.style.height = "1px";
  s.style.width = "1px";
  s.style.pointerEvents = "none";
  return s;
}

function createPlaceholder(height) {
  const ph = document.createElement("div");
  ph.style.height = px(height);
  ph.style.width = "100%";
  ph.style.pointerEvents = "none";
  return ph;
}

async function waitForScrollEl(layoutStore, maxFrames = 30) {
  await nextTick();
  for (let i = 0; i < maxFrames; i++) {
    if (layoutStore.scrollEl) return layoutStore.scrollEl;
    await new Promise((r) => requestAnimationFrame(r));
  }
  throw new Error("useScrollPin: scrollEl not ready. Check Body.vue setScrollEl().");
}

/**
 * 임시 헤더 오프셋: 헤더 높이
 * - 프로젝트에 기존 오프셋 변수(CSS var, store 값)가 있으면 그걸로 교체 추천
 */
function getHeaderOffset() {
  const header = document.querySelector(".layout-header");
  if (!header) return 0;
  return Math.round(header.getBoundingClientRect().height);
}

export function useScrollPin() {
  const layoutStore = useLayoutStore();

  const items = new Map(); // id -> item
  let pinnedIds = [];

  let io = null;
  let ro = null;

  function sortPinned() {
    pinnedIds.sort((a, b) => (items.get(a)?.order ?? 0) - (items.get(b)?.order ?? 0));
  }

  function computePinnedTop(targetId) {
    const base = getHeaderOffset();
    let acc = 0;
    for (const id of pinnedIds) {
      if (id === targetId) break;
      const it = items.get(id);
      if (!it?.isPinned) continue;
      acc += it.height;
    }
    return base + acc;
  }

  function refreshPinnedLayout() {
    for (const id of pinnedIds) {
      const it = items.get(id);
      if (!it?.isPinned) continue;
      const h = Math.round(it.el.getBoundingClientRect().height);
      it.height = h;
      if (it.placeholderEl) it.placeholderEl.style.height = px(h);
    }
    for (const id of pinnedIds) {
      const it = items.get(id);
      if (!it?.isPinned) continue;
      it.el.style.top = px(computePinnedTop(id));
    }
  }

  function pin(id) {
    const it = items.get(id);
    if (!it || it.isPinned) return;

    const rect = it.el.getBoundingClientRect();
    const h = Math.round(rect.height);
    it.height = h;

    it.placeholderEl = createPlaceholder(h);
    it.sentinelEl.insertAdjacentElement("afterend", it.placeholderEl);

    if (!pinnedIds.includes(id)) pinnedIds.push(id);
    sortPinned();

    it.el.style.position = "fixed";
    it.el.style.left = px(rect.left);
    it.el.style.width = px(rect.width);
    it.el.style.zIndex = String(it.zIndex);
    it.el.style.margin = "0";
    it.el.style.top = px(computePinnedTop(id));

    it.isPinned = true;
    refreshPinnedLayout();
  }

  function unpin(id) {
    const it = items.get(id);
    if (!it || !it.isPinned) return;

    pinnedIds = pinnedIds.filter((x) => x !== id);

    it.el.style.position = "";
    it.el.style.top = "";
    it.el.style.left = "";
    it.el.style.width = "";
    it.el.style.zIndex = "";
    it.el.style.margin = "";

    if (it.placeholderEl) {
      it.placeholderEl.remove();
      it.placeholderEl = null;
    }

    it.isPinned = false;
    refreshPinnedLayout();
  }

  function ensureObservers(scrollEl) {
    if (!io) {
      io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const it = entry.target.__pinItem;
            if (!it) continue;
            if (entry.isIntersecting) unpin(it.id);
            else pin(it.id);
          }
        },
        {
          root: scrollEl,
          threshold: 0,
          rootMargin: `-${getHeaderOffset()}px 0px 0px 0px`,
        }
      );
    }
    if (!ro && "ResizeObserver" in window) {
      ro = new ResizeObserver(() => refreshPinnedLayout());
    }
  }

  function rebuildObserver() {
    const scrollEl = layoutStore.scrollEl;
    if (!scrollEl) return;

    if (io) {
      io.disconnect();
      io = null;
    }
    ensureObservers(scrollEl);

    for (const it of items.values()) io.observe(it.sentinelEl);
    refreshPinnedLayout();
  }

  async function register(el, options) {
    if (!el) throw new Error("useScrollPin.register: el is required.");

    const id = options?.id;
    const order = options?.order;

    if (!id || typeof id !== "string") throw new Error("useScrollPin.register: options.id(string) is required.");
    if (!Number.isFinite(order)) throw new Error("useScrollPin.register: options.order(number) is required.");
    if (items.has(id)) throw new Error(`useScrollPin.register: duplicated id "${id}".`);

    const scrollEl = await waitForScrollEl(layoutStore);
    ensureObservers(scrollEl);

    const sentinelEl = createSentinel();
    el.insertAdjacentElement("beforebegin", sentinelEl);

    const it = {
      id,
      order,
      el,
      sentinelEl,
      placeholderEl: null,
      isPinned: false,
      height: 0,
      zIndex: Number.isFinite(options?.zIndex) ? options.zIndex : 1500,
    };

    sentinelEl.__pinItem = it;

    items.set(id, it);
    io.observe(sentinelEl);
    if (ro) ro.observe(el);

    // 최초 1회 기준선 반영
    rebuildObserver();

    return () => unregister(id);
  }

  function unregister(id) {
    const it = items.get(id);
    if (!it) return;

    unpin(id);

    if (io) io.unobserve(it.sentinelEl);
    if (ro) ro.unobserve(it.el);

    it.sentinelEl.remove();
    if (it.placeholderEl) it.placeholderEl.remove();

    items.delete(id);
  }

  function destroy() {
    for (const id of [...items.keys()]) unregister(id);
    if (ro) ro.disconnect();
    if (io) io.disconnect();
    ro = null;
    io = null;
    pinnedIds = [];
  }

  function bindPin(refEl, options) {
    let unreg = null;

    nextTick(async () => {
      if (!refEl?.value) throw new Error("useScrollPin.bindPin: refEl.value is empty.");
      unreg = await register(refEl.value, options);
    });

    return () => {
      if (unreg) unreg();
    };
  }

  onBeforeUnmount(() => destroy());

  return { register, unregister, rebuildObserver, refreshPinnedLayout, destroy, bindPin };
}

```
6) 페이지 사용 예시 (딱 2줄로 끝)
```js
<script setup>
import { ref } from "vue";
import { useHeaderPinned } from "@/composable/useHeaderPinned";
import { useScrollPin } from "@/composable/sticky/useScrollPin";

useHeaderPinned(true); // 이 페이지에서만 헤더 고정(필요 없으면 삭제)

const { bindPin } = useScrollPin();
const tabsRef = ref(null);

bindPin(tabsRef, { id: "tabs", order: 10 });
</script>

```
#### 최소침습 버전에서 “바로 검증할 체크 포인트”

1. meta가 없는 페이지(기본 autoHide)에서 **동작 그대로인지**
    
2. `useHeaderPinned(true)`를 쓴 페이지에서 헤더 고정 클래스가 **정상 주입되는지**
    
3. 페이지 이동 시(특히 keep-alive 포함) override가 **원복되는지**
    
4. pin 요소가 헤더 아래로 **붙는지**
    

---

#### 다음 단계(필요할 때만)

pin이 “헤더 숨김 상태”까지 정확히 따라가야 한다면, 지금 `getHeaderOffset()`의 임시 로직을  
**기존 레이아웃이 이미 쓰는 값(예: CSS 변수, 헤더 상태 클래스, store 값)**으로 교체하면 됩니다.  
(이건 당신 프로젝트의 실제 클래스/변수명을 알아야 정확하게 맞춰드릴 수 있습니다.)

원하면, 다음엔 **“DOM query 없이”** 가능한 3가지 대체안(기존 CSS 변수 읽기 / 헤더 상태 클래스 판독 / 기존 store 값 재사용) 중 가장 낮은 침습을 골라서 적용 코드까지 바로 제시하겠습니다.