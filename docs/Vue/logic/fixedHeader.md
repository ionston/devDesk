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
```js
let lastOverlap = null;
let rafId = null;

function scheduleObserverRefresh() {
  const scrollEl = layoutStore.scrollEl;
  if (!scrollEl) return;

  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    const overlap = getHeaderOverlap(scrollEl);

    if (lastOverlap === null) lastOverlap = overlap;

    if (Math.abs(overlap - lastOverlap) >= 1) {
      lastOverlap = overlap;
      rebuildObserver(); // 기존 함수
    }
  });
}

async function attachScrollListenerOnce() {
  const scrollEl = await waitForScrollEl(layoutStore);

  if (scrollEl.__pinScrollListenerAttached) return;
  scrollEl.__pinScrollListenerAttached = true;

  lastOverlap = getHeaderOverlap(scrollEl);
  scrollEl.addEventListener("scroll", scheduleObserverRefresh, { passive: true });
}
```

```js
await attachScrollListenerOnce();
```

```js
function destroy() {
  const scrollEl = layoutStore.scrollEl;
  if (scrollEl && scrollEl.__pinScrollListenerAttached) {
    scrollEl.removeEventListener("scroll", scheduleObserverRefresh);
    delete scrollEl.__pinScrollListenerAttached;
  }
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  lastOverlap = null;

  // ...기존 destroy 로직 계속
}
```

-----------------------------------------------------------------------

```js
function getHeaderOverlap(scrollEl) {
  const header = document.querySelector(".layout-header");
  if (!header || !scrollEl) return 0;

  const headerRect = header.getBoundingClientRect();
  const scrollRect = scrollEl.getBoundingClientRect();
  return Math.max(0, Math.round(headerRect.bottom - scrollRect.top));
}

function evaluatePins() {
  const scrollEl = layoutStore.scrollEl;
  if (!scrollEl) return;

  const scrollRect = scrollEl.getBoundingClientRect();
  const overlap = getHeaderOverlap(scrollEl);
  const line = scrollRect.top + overlap; // ✅ 헤더 아래 기준선(뷰포트 기준)

  // order 순서대로 처리(스택 안정화)
  const ordered = Array.from(items.values()).sort((a, b) => a.order - b.order);

  for (const it of ordered) {
    const sRect = it.sentinelEl.getBoundingClientRect();
    const shouldPin = sRect.top < line;

    if (shouldPin && !it.isPinned) pin(it.id);
    if (!shouldPin && it.isPinned) unpin(it.id);
  }
}

```

```js
let rafTick = null;

function onScrollTick() {
  if (rafTick) return;
  rafTick = requestAnimationFrame(() => {
    rafTick = null;
    evaluatePins();
    refreshPinnedLayout(); // 높이/스택 보정(안전)
  });
}

```
```js
async function attachScrollListenerOnce() {
  const scrollEl = await waitForScrollEl(layoutStore);
  if (scrollEl.__pinScrollListenerAttached) return;
  scrollEl.__pinScrollListenerAttached = true;

  scrollEl.addEventListener("scroll", onScrollTick, { passive: true });

  // 초기 1회 판정(로드 직후 붙는 문제도 여기서 제어 가능)
  onScrollTick();
}

```

```js
await attachScrollListenerOnce();

```

```js
function destroy() {
  const scrollEl = layoutStore.scrollEl;
  if (scrollEl && scrollEl.__pinScrollListenerAttached) {
    scrollEl.removeEventListener("scroll", onScrollTick);
    delete scrollEl.__pinScrollListenerAttached;
  }
  if (rafTick) cancelAnimationFrame(rafTick);
  rafTick = null;

  // 기존 destroy 로직(등록 해제/observer 정리 등) 이어서...
}

```

---
```js
function evaluatePins() {
  const scrollEl = layoutStore.scrollEl;
  if (!scrollEl) return;

  const scrollRect = scrollEl.getBoundingClientRect();
  const overlap = getHeaderOverlap(scrollEl);

  // ✅ 스택의 "첫 기준선": 헤더 아래(뷰포트 기준)
  const baseLine = scrollRect.top + overlap;

  // ✅ order 순으로 스냅샷
  const ordered = Array.from(items.values()).sort((a, b) => a.order - b.order);

  // 1) 먼저 각 item의 sentinel 위치/높이를 스냅샷으로 잡아둠
  const snap = ordered.map((it) => {
    const sRect = it.sentinelEl.getBoundingClientRect();
    const h = Math.round(it.el.getBoundingClientRect().height) || it.height || 0;
    return { it, sTop: sRect.top, h };
  });

  // 2) 스택 기준선을 누적하면서 “이번 tick에서 최종적으로 pin 되어야 하는지”를 결정
  //    - pinned 결정된 것들의 높이를 acc로 쌓음(= 다음 아이템 기준선이 내려감)
  let acc = 0;
  const decisions = [];

  // ✅ threshold 튐 방지용 버퍼(1~4px 정도 추천)
  const EPS = 2;

  for (const s of snap) {
    const threshold = baseLine + acc;

    // shouldPin: sentinel이 기준선보다 위로 올라갔으면 pin
    const shouldPin = s.sTop < threshold - EPS;

    decisions.push({ it: s.it, shouldPin, h: s.h });

    // ✅ 다음 기준선 누적: "이번 tick에서 pin되어야 하는 것"만 누적
    if (shouldPin) acc += s.h;
  }

  // 3) 결정 적용 (여기서 DOM 변경)
  for (const d of decisions) {
    // 높이 최신화(스택 계산 안정화)
    d.it.height = d.h;

    if (d.shouldPin && !d.it.isPinned) pin(d.it.id);
    if (!d.shouldPin && d.it.isPinned) unpin(d.it.id);
  }
}

```

```js
function evaluatePins() {
  const scrollEl = layoutStore.scrollEl;
  if (!scrollEl) return;

  const scrollRect = scrollEl.getBoundingClientRect();
  const overlap = getHeaderOverlap(scrollEl);

  // ✅ 헤더 아래 기준선(뷰포트 기준)
  const baseLine = scrollRect.top + overlap;

  // ✅ order 순
  const ordered = Array.from(items.values()).sort((a, b) => a.order - b.order);

  // 1) 스냅샷(이번 프레임에서 변하지 않게)
  const snap = ordered.map((it) => {
    const sTop = it.sentinelEl.getBoundingClientRect().top;
    const h = Math.round(it.el.getBoundingClientRect().height) || it.height || 0;
    return { it, sTop, h };
  });

  // 2) 스택 누적 기준선으로 결정
  let acc = 0;

  // ✅ 경계 튐 방지 버퍼
  const EPS = 3;

  const decisions = [];
  for (const s of snap) {
    const threshold = baseLine + acc;

    // sentinel이 threshold 위로 올라가면 pin
    const shouldPin = s.sTop < threshold - EPS;

    decisions.push({ it: s.it, shouldPin, h: s.h });

    // ✅ "이번 프레임에서 pin될 것"만 누적
    if (shouldPin) acc += s.h;
  }

  // 3) 적용
  for (const d of decisions) {
    d.it.height = d.h;
    if (d.shouldPin && !d.it.isPinned) pin(d.it.id);
    if (!d.shouldPin && d.it.isPinned) unpin(d.it.id);
  }
}

```
```js
function refreshPinnedLayout() {
  const scrollEl = layoutStore.scrollEl;
  if (!scrollEl) return;

  // ✅ viewport 기준으로 scrollEl의 위치
  const scrollRect = scrollEl.getBoundingClientRect();

  // ✅ scrollEl 기준으로 헤더가 덮는 높이(스크롤 컨테이너 기준)
  const overlap = getHeaderOverlap(scrollEl);

  // ✅ pin이 시작해야 하는 viewport top (헤더 아래)
  const baseTop = Math.round(scrollRect.top + overlap);

  // ✅ 현재 pin 된 것들만 order 순으로 정렬
  const pinned = Array.from(items.values())
    .filter((it) => it.isPinned)
    .sort((a, b) => a.order - b.order);

  // 1) 높이 스냅샷 & placeholder 반영
  for (const it of pinned) {
    // fixed 상태에서도 높이는 측정 가능
    const h = Math.round(it.el.getBoundingClientRect().height) || it.height || 0;
    it.height = h;

    if (it.placeholderEl) {
      it.placeholderEl.style.height = `${h}px`;
    }
  }

  // 2) top 재배치 (스택 누적)
  let acc = 0;
  for (const it of pinned) {
    const top = baseTop + acc;
    it.el.style.top = `${top}px`;
    acc += it.height;
  }
}


```

```js
function getSentinelYInScroll(scrollEl, sentinelEl) {
  // sentinel의 "스크롤 컨텐츠 좌표" (0부터 시작)
  const scrollRect = scrollEl.getBoundingClientRect();
  const sRect = sentinelEl.getBoundingClientRect();

  // (sentinel이 화면에서 scrollEl top에서 얼마나 떨어져 있나) + scrollTop
  return scrollEl.scrollTop + (sRect.top - scrollRect.top);
}

function evaluatePins() {
  const scrollEl = layoutStore.scrollEl;
  if (!scrollEl) return;

  const overlap = getHeaderOverlap(scrollEl);

  // ✅ 스크롤 좌표계 기준선 시작점
  const baseLine = scrollEl.scrollTop + overlap;

  const ordered = Array.from(items.values()).sort((a, b) => a.order - b.order);

  // 1) 스냅샷 (이번 프레임에서 기준 흔들림 방지)
  const snap = ordered.map((it) => {
    const y = getSentinelYInScroll(scrollEl, it.sentinelEl);
    const h = Math.round(it.el.getBoundingClientRect().height) || it.height || 0;
    return { it, y, h };
  });

  // 2) 누적 기준선(스택)으로 shouldPin 결정
  let acc = 0;

  // ✅ 경계 튐 방지 (2~6 사이로 튜닝)
  const EPS = 4;

  const decisions = [];
  for (const s of snap) {
    const threshold = baseLine + acc;
    const shouldPin = s.y < threshold - EPS;

    decisions.push({ it: s.it, shouldPin, h: s.h });

    if (shouldPin) acc += s.h;
  }

  // 3) 적용
  for (const d of decisions) {
    d.it.height = d.h;

    if (d.shouldPin && !d.it.isPinned) pin(d.it.id);
    if (!d.shouldPin && d.it.isPinned) unpin(d.it.id);
  }
}

```