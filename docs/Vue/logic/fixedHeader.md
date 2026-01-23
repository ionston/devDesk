 =====================================================================
 [JS 전체 예제 + 상세 주석 버전 - 한 번에 복사/붙여넣기용]
 
 목적
 - 라이브러리 레이아웃(LayoutContainer)이 헤더 높이를 실시간 측정하고(ResizeObserver)
 - Body(스크롤 컨테이너) 내에서 탭/필터/버튼바 등 “붙어야 하는 컴포넌트”들이
   헤더 바로 아래부터 order 순서대로 차례대로 sticky(top) 되도록 top 값을 계산해 제공
 
 핵심 포인트
 - 사용 화면에서는 orderMap을 한 번에 등록: useLayoutStickies({ tabs:10, ... })
 - id 충돌 방지를 위해 scope를 아예 없앰: 각 sticky 항목 id는 Symbol()로 자동 생성 → 충돌 불가
 - 퍼블리셔/사용 화면은 실제 sticky 처리(CSS position: sticky)는 유지하고
   라이브러리는 top/zIndex 계산 정보를 제공하는 역할(책임 분리)
 
 경로대로 파일을 생성해 그대로 붙여넣으세요.
 =====================================================================

 ---------------------------------------------------------------------
 파일: src/layout/keys.js
 역할
 - provide/inject에 사용할 Injection Key를 한 곳에 모아 관리
 - 키를 Symbol로 두면 키 충돌이 사실상 발생하지 않습니다.
 ---------------------------------------------------------------------
```js
export const StickyManagerKey = Symbol("StickyManagerKey");
```

 ---------------------------------------------------------------------
 파일: src/layout/useHeaderMeasure.js
 역할
 - LayoutContainer의 header DOM 요소를 대상으로
   "현재 헤더 높이"를 실시간(ref)으로 유지하는 컴포저블
 - 헤더 높이 변화는 다음 경우에 발생할 수 있음:
   - 배너/공지 영역이 나타남/사라짐
   - 글자 크기/반응형 레이아웃 변화
   - 동적 슬롯 내용 변경 등
 
 구현 포인트
 - ResizeObserver를 사용해 "높이가 변할 때만" 재측정 → 성능 안정
 - watch(headerElRef)로 ref 대상 DOM이 늦게 바인딩 되는 케이스도 커버
 ---------------------------------------------------------------------
```js
import { ref, onMounted, onUnmounted, watch } from "vue";

export function useHeaderMeasure(headerElRef) {
  // [반환] 현재 헤더 높이(px)
  const height = ref(0);

  // ResizeObserver 인스턴스 보관
  let ro = null;

  /**
   * measureOnce()
   * - headerElRef가 가리키는 DOM의 현재 높이를 측정하여 height에 반영
   * - getBoundingClientRect().height를 사용해 실제 렌더링 높이를 얻음
   */
  const measureOnce = () => {
    const el = headerElRef.value;
    if (!el) return;
    height.value = Math.round(el.getBoundingClientRect().height);
  };

  onMounted(() => {
    // 최초 1회 측정
    measureOnce();

    // 높이 변경 이벤트에만 반응
    ro = new ResizeObserver(() => measureOnce());

    // 현재 DOM이 이미 존재한다면 관찰 시작
    if (headerElRef.value) ro.observe(headerElRef.value);
  });

  /**
   * headerElRef.value가 나중에 바뀌는 경우(동적 렌더링/컴포넌트 교체 등)
   * - 이전 요소 unobserve
   * - 신규 요소 observe
   * - 이후 재측정
   */
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
    // 관찰 해제 및 리소스 정리
    ro?.disconnect();
    ro = null;
  });

  return { height };
}
```

 ---------------------------------------------------------------------
 파일: src/layout/createStickyManager.js
 역할
 - 헤더 높이(ref)를 기반으로
   Body 내부의 "sticky 대상"들을 order 기준으로 정렬하고
   각 sticky의 top 값을 "헤더 아래부터 누적" 계산해 제공하는 매니저
 
 왜 매니저가 필요한가?
 - sticky가 여러 개면 각각의 top이 서로 영향을 주기 때문에
   "한 곳에서" 누적 높이를 계산하는 단일 진실의 원천(Single Source of Truth)이 필요합니다.
 
 매니저가 관리하는 데이터(항목별)
 - id: symbol (충돌 방지)
 - name: 디버깅용 라벨(예: tabs, filter)
 - order: 우선순위(작을수록 위)
 - enabled: 스택 포함 여부(기본 true)
 - height: 항목의 실측 높이(px) → useLayoutSticky에서 ResizeObserver로 자동 업데이트
 - mountedAt: order가 같은 경우를 위한 안정 정렬 tie-breaker
 
 계산 규칙
 - active( enabled=true ) 항목을 order 오름차순으로 정렬
 - top(item1) = headerHeight
 - top(item2) = headerHeight + height(item1)
 - top(item3) = headerHeight + height(item1) + height(item2)
 ...
 ---------------------------------------------------------------------
```js
import { reactive, computed } from "vue";

function clamp0(n) {
  return n < 0 ? 0 : n;
}

export function createStickyManager(headerHeightRef) {
  // reactive Map: key=symbol, value=state object
  const itemsById = reactive(new Map());

  /**
   * sortedActive
   * - enabled=true 인 항목만 추려서
   * - order, mountedAt 기준으로 안정 정렬된 배열을 제공
   */
  const sortedActive = computed(() => {
    const arr = Array.from(itemsById.values()).filter((x) => x.enabled);

    // 안정 정렬: order -> mountedAt
    arr.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.mountedAt - b.mountedAt;
    });

    return arr;
  });

  /**
   * tops
   * - 각 id별 top(px) 값을 계산해서 Map으로 제공
   * - top은 headerHeight부터 시작하여 "위의 sticky 높이"를 누적한 값
   */
  const tops = computed(() => {
    const map = new Map(); // key: symbol -> number(top)
    let acc = clamp0(headerHeightRef.value || 0);

    for (const item of sortedActive.value) {
      map.set(item.id, acc);
      acc += clamp0(item.height || 0);
    }
    return map;
  });


  /**
   * register()
   * - sticky 항목을 매니저에 등록
   * - 반환값: unregister 함수(해제용)
   *
   * 주의
   * - id는 symbol이어야 하며, useLayoutSticky가 자동 생성함
   * - order는 필수
   */
  function register({ id, name = "", order, enabled = true }) {
    if (typeof order !== "number") throw new Error("Sticky register: order is required");

    const now = Date.now();
    const prev = itemsById.get(id);

    itemsById.set(id, {
      id,
      name,
      order,
      enabled,
      height: prev?.height ?? 0,
      mountedAt: prev?.mountedAt ?? now,
    });

    return () => unregister(id);
  }

  /**
   * unregister()
   * - 항목을 제거(해제)
   * - 컴포넌트 unmount 시 호출되어 스택이 자동으로 정리됨
   */
  function unregister(id) {
    itemsById.delete(id);
  }

  /**
   * updateHeight()
   * - 항목 DOM의 실측 높이를 매니저에 업데이트
   * - ResizeObserver로 항목 높이가 변할 때마다 호출됨
   * - 높이가 변하면 computed(tops)가 자동으로 재계산됨
   */
  function updateHeight(id, height) {
    const item = itemsById.get(id);
    if (!item) return;
    item.height = clamp0(Math.round(height || 0));
    itemsById.set(id, item);
  }

  /**
   * getTop()
   * - 특정 sticky 항목의 최종 top(px) 값을 computed로 제공
   * - 항목이 아직 계산 Map에 없으면 headerHeight를 fallback으로 제공
   */
  function getTop(id) {
    return computed(() => tops.value.get(id) ?? clamp0(headerHeightRef.value || 0));
  }

  /**
   * getZIndex()
   * - 간단한 z-index 정책 제공
   * - order가 작을수록 위에 있어야 하므로 z-index를 더 크게(= 1000 - order)
   * - 디자인 시스템/퍼블리싱 규칙에 맞게 여기 정책을 교체하면 됨
   */
  function getZIndex(id) {
    return computed(() => {
      const item = itemsById.get(id);
      const order = item?.order ?? 9999;
      return 1000 - order;
    });
  }

  return { register, unregister, updateHeight, getTop, getZIndex };
}
```

 ---------------------------------------------------------------------
 파일: src/layout/useLayoutSticky.js
 역할
 - "sticky로 붙을 컴포넌트 하나"를 등록하고
 - 그 컴포넌트의 top/zIndex 값을 computed로 제공
 - sticky 대상 DOM의 높이를 ResizeObserver로 자동 측정하여 매니저에 반영
 
 사용 화면 관점
 - const tabs = useLayoutSticky({ order: 10, name: "tabs" })
 - template: ref="tabs.stickyRef", style.top = tabs.top
 
 충돌 방지
 - id를 Symbol(name)으로 생성 → scope 없이도 id 충돌 불가
 ---------------------------------------------------------------------
```js
import { inject, ref, onMounted, onUnmounted, watch, computed } from "vue";
import { StickyManagerKey } from "./keys";

export function useLayoutSticky({ order, name = "", enabled = true } = {}) {
  const manager = inject(StickyManagerKey);
  if (!manager) throw new Error("useLayoutSticky(): StickyManager not provided.");
  if (typeof order !== "number") throw new Error("useLayoutSticky(): order is required");

  // 고유 id(충돌 불가). name은 디버깅 라벨로만 의미
  const id = Symbol(name || "sticky");

  // sticky 적용할 DOM을 template ref로 연결받음
  const stickyRef = ref(null);

  // 매니저가 계산해주는 top/zIndex computed를 구독
  const topRef = manager.getTop(id);
  const zIndexRef = manager.getZIndex(id);

  let unregister = null;
  let ro = null;

  /**
   * measureOnce()
   * - stickyRef가 가리키는 DOM의 현재 높이를 측정하여 매니저에 업데이트
   * - 이 높이가 "다음 sticky의 top" 계산에 영향을 줌
   */
  const measureOnce = () => {
    const el = stickyRef.value;
    if (!el) return;
    manager.updateHeight(id, el.getBoundingClientRect().height);
  };

  onMounted(() => {
    // 매니저에 등록
    unregister = manager.register({ id, name, order, enabled });

    // 최초 1회 측정
    measureOnce();

    // 높이 변경 시 자동 갱신
    ro = new ResizeObserver(() => measureOnce());
    if (stickyRef.value) ro.observe(stickyRef.value);
  });

  /**
   * stickyRef DOM이 늦게 설정되거나 바뀌는 경우를 커버
   * - 이전 요소 unobserve
   * - 신규 요소 observe
   * - 즉시 재측정
   */
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
    // 관찰 해제
    ro?.disconnect();
    ro = null;

    // 등록 해제
    unregister?.();
    unregister = null;
  });

  return {
    // template에서 ref로 연결할 대상
    stickyRef,

    // 퍼블리싱/화면에서 top/zIndex 값만 사용하면 됨
    top: computed(() => topRef.value),
    zIndex: computed(() => zIndexRef.value),
  };
}
```

 ---------------------------------------------------------------------
 파일: src/layout/useLayoutStickies.js
 역할
 - 사용 화면에서 여러 sticky 항목을 "한 번에" 등록하기 위한 편의 API
 
 사용법(사용 화면)
 - const stickies = useLayoutStickies({ tabs:10, filter:20, actions:30 })
 - stickies.tabs, stickies.filter 처럼 사용
 
 내부 동작
 - 각 name에 대해 useLayoutSticky를 호출하고 결과를 객체로 반환
 ---------------------------------------------------------------------
```js
import { useLayoutSticky } from "./useLayoutSticky";

export function useLayoutStickies(orderMap) {
  const result = {};

  // orderMap: { tabs: 10, filter: 20, actions: 30 }
  for (const [name, order] of Object.entries(orderMap)) {
    result[name] = useLayoutSticky({ order, name });
  }

  return result;
}
```
 ---------------------------------------------------------------------
 파일: src/layout/LayoutContainer.vue
 역할
 - 라이브러리 레이아웃의 핵심 컨테이너
 - 구조: Header(고정) + Body(스크롤) 형제 레벨
 - 헤더 DOM을 측정해 headerHeight를 만들고
 - StickyManager를 생성해 provide 하여 Body 트리에서 사용 가능하게 함
 
 구현 포인트
 - Header는 fixed이므로 Body 상단이 가려지지 않도록 paddingTop=headerHeight 적용
 - Body가 스크롤 컨테이너라는 전제(지금 요구조건)
 ---------------------------------------------------------------------
```js
<template>
  <div class="root">
    <!-- 헤더는 고정 영역. 슬롯으로 헤더 UI를 주입받음 -->
    <header ref="headerEl" class="header">
      <slot name="header" />
    </header>

    <!-- Body는 스크롤 컨테이너.
         paddingTop으로 헤더 높이만큼 내려서 헤더에 가리지 않게 처리 -->
    <main class="body" :style="{ paddingTop: headerHeight + 'px' }">
      <slot />
    </main>
  </div>
</template>

<script setup>
import { ref, computed, provide } from "vue";
import { StickyManagerKey } from "./keys";
import { useHeaderMeasure } from "./useHeaderMeasure";
import { createStickyManager } from "./createStickyManager";

// 헤더 DOM ref
const headerEl = ref(null);

// 헤더 높이 측정(실시간)
const { height } = useHeaderMeasure(headerEl);
const headerHeight = computed(() => height.value);

// sticky 매니저 생성 및 provide
const manager = createStickyManager(headerHeight);
provide(StickyManagerKey, manager);
</script>

<style scoped>
.root {
  height: 100vh;
  overflow: hidden;
}
.header {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 2000;
  background:  fff;
  border-bottom: 1px solid  e5e5e5;
}
.body {
  height: 100%;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  background:  f7f7f7;
}
</style>
```

 ---------------------------------------------------------------------
 파일: src/pages/DemoPage.vue
 역할
 - 실제 사용 화면 예제(Body 슬롯 안에 들어가는 화면)
 - useLayoutStickies로 tabs/filter/actions를 한 번에 등록
 - 각 항목은 position: sticky + top(계산값) 적용
 - 컨텐츠를 길게 만들어 스크롤 테스트 가능하게 함
 ---------------------------------------------------------------------

```js
<template>
  <!-- Tabs: 헤더 아래 첫 번째로 붙음(order=10) -->
  <div
    ref="stickies.tabs.stickyRef"
    :style="stickyStyle(stickies.tabs)"
    class="stickyBox"
  >
    Tabs (order=10) top={{ stickies.tabs.top }}
  </div>

  <!-- Filter: Tabs 아래 두 번째로 붙음(order=20) -->
  <div
    ref="stickies.filter.stickyRef"
    :style="stickyStyle(stickies.filter)"
    class="stickyBox"
  >
    Filter (order=20) top={{ stickies.filter.top }}
  </div>

  <!-- Actions: Filter 아래 세 번째로 붙음(order=30) -->
  <div
    ref="stickies.actions.stickyRef"
    :style="stickyStyle(stickies.actions)"
    class="stickyBox"
  >
    Actions (order=30) top={{ stickies.actions.top }}
  </div>

  <!-- 긴 컨텐츠로 스크롤 유도 -->
  <div class="content">
    <div v-for="i in 80" :key="i" class="row">Row {{ i }}</div>
  </div>
</template>

<script setup>
import { useLayoutStickies } from "../layout/useLayoutStickies";

/**
 * useLayoutStickies()
 * - orderMap을 한 번에 전달해서 tabs/filter/actions를 등록
 * - 반환값 stickies.tabs / stickies.filter / stickies.actions 각각이
 *   stickyRef, top, zIndex를 제공
 */
const stickies = useLayoutStickies({
  tabs: 10,
  filter: 20,
  actions: 30,
});

/**
 * stickyStyle()
 * - 퍼블리셔가 실제 sticky 스타일을 결정하는 영역
 * - 라이브러리는 top/zIndex 같은 "정보"만 제공하고
 *   style 적용은 사용 화면에서 수행(책임 분리)
 */
function stickyStyle(item) {
  return {
    position: "sticky",
    top: item.top + "px",
    zIndex: item.zIndex,
    background: " fff",
    borderBottom: "1px solid  ddd",
  };
}
</script>

<style scoped>
.stickyBox {
  padding: 12px 16px;
}
.content {
  padding: 16px;
}
.row {
  background:  fff;
  border: 1px solid  eee;
  margin-bottom: 8px;
  padding: 12px;
}
</style>
```

 ---------------------------------------------------------------------
 파일: src/App.vue
 역할
 - LayoutContainer로 앱(또는 라우트)을 감싸서
   Body 내부 어디서든 sticky 기능을 쓸 수 있도록 컨텍스트를 제공
 ---------------------------------------------------------------------

```js
<template>
  <LayoutContainer>
    <template  header>
      <div style="padding:16px">
        <div style="font-weight:700">Fixed Header</div>
        <div style="font-size:12px;opacity:.7">
          헤더 높이 변경 시 sticky top 자동 갱신
        </div>
      </div>
    </template>

    <DemoPage />
  </LayoutContainer>s
</template>

<script setup>
import LayoutContainer from "./layout/LayoutContainer.vue";
import DemoPage from "./pages/DemoPage.vue";
</script>
```
