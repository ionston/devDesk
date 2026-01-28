```js

// src/composable/sticky/useScrollPin.js
// ✅ 완전 JS 버전 (ref + bindPin 매치용)
// ✅ “남는 문제(특히 3/4번째)”를 구조적으로 없애기 위해
//    position: fixed 로 떼어내는 방식 대신,
//    pin 시 DOM을 헤더 아래 pinStack 컨테이너로 “이동”시키는 방식입니다.
//    (unpin은 placeholder 위치로 “원복”)

import { nextTick, onBeforeUnmount } from "vue";
import { useLayoutStore } from "@/stores/layout";

/**
 * --- 전역(싱글톤) pinStack 관리 ---
 * 여러 페이지/인스턴스에서 써도 stack 1개만 유지하고, refCount로 정리합니다.
 */
const GLOBAL_STACK_KEY = "__USE_SCROLL_PIN_STACK__";
const GLOBAL_STACK_REFCOUNT_KEY = "__USE_SCROLL_PIN_STACK_REFCOUNT__";

/** px 유틸 */
const px = (n) => `${Math.round(n)}px`;

/** Vue 컴포넌트 ref / Element 정규화 */
function resolveDom(maybe) {
  if (maybe && maybe.$el) maybe = maybe.$el;
  return maybe instanceof Element ? maybe : null;
}

/** sentinel 생성(원래 자리 기준점) */
function createSentinel() {
  const s = document.createElement("div");
  s.style.height = "1px";
  s.style.width = "1px";
  s.style.pointerEvents = "none";
  s.style.margin = "0";
  s.style.padding = "0";
  return s;
}

/** placeholder 생성(원래 자리 공간 유지 + 원복 앵커) */
function createPlaceholder() {
  const ph = document.createElement("div");
  ph.style.height = "0px";
  ph.style.width = "100%";
  ph.style.pointerEvents = "none";
  ph.style.margin = "0";
  ph.style.padding = "0";
  return ph;
}

/**
 * 헤더가 scrollEl(스크롤 컨테이너) 상단을 얼마나 덮는지(px).
 * - autoHide로 헤더가 올라가/내려가도 여기 값이 변합니다.
 */
function getHeaderOverlap(scrollEl) {
  const header = document.querySelector(".layout-header");
  if (!header || !scrollEl) return 0;

  const headerRect = header.getBoundingClientRect();
  const scrollRect = scrollEl.getBoundingClientRect();

  // scrollEl 상단 기준으로 헤더가 덮는 양
  return Math.max(0, Math.round(headerRect.bottom - scrollRect.top));
}

/** sentinel의 위치를 “스크롤 컨텐츠 좌표계(0~)”로 환산 */
function getSentinelYInScroll(scrollEl, sentinelEl) {
  const scrollRect = scrollEl.getBoundingClientRect();
  const sRect = sentinelEl.getBoundingClientRect();
  return scrollEl.scrollTop + (sRect.top - scrollRect.top);
}

/** pinStack 생성/획득 (전역 싱글톤) */
function ensureGlobalPinStack() {
  let stack = document[GLOBAL_STACK_KEY];
  if (stack && stack.isConnected) return stack;

  stack = document.querySelector("[data-pin-stack='1']");
  if (!stack) {
    stack = document.createElement("div");
    stack.setAttribute("data-pin-stack", "1");

    // 헤더 아래 고정 영역(뷰포트 기준)
    stack.style.position = "fixed";
    stack.style.left = "0";
    stack.style.right = "0";
    stack.style.top = "0px";
    stack.style.zIndex = "2500"; // 필요시 조정(헤더 z-index와 관계)
    stack.style.margin = "0";
    stack.style.padding = "0";

    // 여기 영역은 실제로 버튼/탭 등 클릭이 필요할 수 있으니 auto
    stack.style.pointerEvents = "auto";

    // 레이아웃 영향 방지
    stack.style.display = "block";

    document.body.appendChild(stack);
  }

  document[GLOBAL_STACK_KEY] = stack;
  return stack;
}

function incStackRef() {
  const n = Number(document[GLOBAL_STACK_REFCOUNT_KEY] || 0);
  document[GLOBAL_STACK_REFCOUNT_KEY] = n + 1;
}

function decStackRef() {
  const n = Number(document[GLOBAL_STACK_REFCOUNT_KEY] || 0);
  const next = Math.max(0, n - 1);
  document[GLOBAL_STACK_REFCOUNT_KEY] = next;

  // 참조 0이면 stack 제거(남아있으면 다음 페이지에 찌꺼기 가능)
  if (next === 0) {
    const stack = document[GLOBAL_STACK_KEY] || document.querySelector("[data-pin-stack='1']");
    if (stack && stack.isConnected) stack.remove();
    document[GLOBAL_STACK_KEY] = null;
  }
}

/**
 * scrollEl이 준비될 때까지 기다림 (Body.vue에서 setScrollEl을 onMounted로 등록한다고 가정)
 */
async function waitForScrollEl(layoutStore, maxFrames = 60) {
  await nextTick();
  for (let i = 0; i < maxFrames; i++) {
    if (layoutStore.scrollEl) return layoutStore.scrollEl;
    await new Promise((r) => requestAnimationFrame(r));
  }
  throw new Error("useScrollPin: scrollEl not ready. Check Body.vue setScrollEl().");
}

export function useScrollPin() {
  const layoutStore = useLayoutStore();

  /**
   * items: id -> item
   * item 구조:
   * {
   *   id, order, el, sentinelEl, placeholderEl,
   *   isPinned, height
   * }
   */
  const items = new Map();

  // rAF로 스크롤/리사이즈 이벤트 과다 호출 방지
  let rafTick = null;

  // stack 참조 관리(이 인스턴스에서만 1회 증가/감소)
  let stackRefed = false;

  /** pinStack top은 “scrollEl viewport top + headerOverlap” */
  function computeStackTop(scrollEl) {
    const scrollRect = scrollEl.getBoundingClientRect();
    const overlap = getHeaderOverlap(scrollEl);
    return Math.round(scrollRect.top + overlap);
  }

  /** stack 내부 children을 order 순으로 정렬 */
  function sortStackChildren(stack) {
    const children = Array.from(stack.children);
    children.sort((a, b) => {
      const ida = a.__pinId;
      const idb = b.__pinId;
      const oa = items.get(ida)?.order ?? 0;
      const ob = items.get(idb)?.order ?? 0;
      return oa - ob;
    });
    for (const ch of children) stack.appendChild(ch);
  }

  /** pinStack 준비 + refcount 증가 */
  function ensureStackRef() {
    if (stackRefed) return;
    ensureGlobalPinStack();
    incStackRef();
    stackRefed = true;
  }

  /**
   * pin: 엘리먼트를 pinStack으로 이동
   * - placeholder는 원래 자리에서 공간 유지 + 원복 앵커
   */
  function pin(id) {
    const it = items.get(id);
    if (!it || it.isPinned) return;

    const scrollEl = layoutStore.scrollEl;
    if (!scrollEl) return;

    ensureStackRef();

    const stack = ensureGlobalPinStack();

    // 높이 측정 → placeholder에 반영
    const h = Math.round(it.el.getBoundingClientRect().height) || it.height || 0;
    it.height = h;
    if (it.placeholderEl) it.placeholderEl.style.height = px(h);

    // element를 stack으로 이동
    it.el.__pinId = id;
    it.el.style.width = "100%";
    it.el.style.margin = "0";
    it.el.style.padding = it.el.style.padding || ""; // 기존 유지

    stack.appendChild(it.el);
    sortStackChildren(stack);

    it.isPinned = true;
  }

  /**
   * unpin: placeholder 위치로 element 원복
   */
  function unpin(id) {
    const it = items.get(id);
    if (!it || !it.isPinned) return;

    const ph = it.placeholderEl;
    const parent = ph?.parentNode;

    if (parent) {
      parent.insertBefore(it.el, ph.nextSibling);
    }

    it.isPinned = false;

    // 원복 시 placeholder 높이는 0으로 돌리지 않음:
    // - 바로 위로 내릴 때 깜빡임 방지 위해 refresh에서 다시 계산해서 맞춤
    // 필요하면 아래 줄을 켜도 됨:
    // if (it.placeholderEl) it.placeholderEl.style.height = "0px";
  }

  /**
   * refreshPinnedLayout:
   * - stack top 갱신(헤더 아래)
   * - pinned 요소 높이/placeholder 갱신
   * - stack order 정렬
   */
  function refreshPinnedLayout() {
    const scrollEl = layoutStore.scrollEl;
    if (!scrollEl) return;

    const stack = ensureGlobalPinStack();
    if (!stack) return;

    // stack top 재설정
    stack.style.top = px(computeStackTop(scrollEl));

    // pinned 목록 order 순
    const pinned = Array.from(items.values())
      .filter((it) => it.isPinned)
      .sort((a, b) => a.order - b.order);

    // 높이 재측정 → placeholder 반영
    for (const it of pinned) {
      const h = Math.round(it.el.getBoundingClientRect().height) || it.height || 0;
      it.height = h;
      if (it.placeholderEl) it.placeholderEl.style.height = px(h);
    }

    sortStackChildren(stack);
  }

  /**
   * evaluatePins:
   * - 스크롤 좌표계 기준으로 “붙여야 하는지/떼야 하는지” 결정
   * - 스택 기준선(앞 pin 높이 누적)을 반영해서 3/4번째가 남는 문제를 방지
   */
  function evaluatePins() {
    const scrollEl = layoutStore.scrollEl;
    if (!scrollEl) return;

    const overlap = getHeaderOverlap(scrollEl);

    // ✅ 스크롤 좌표계 기준선 시작: 현재 scrollTop + overlap
    const baseLine = scrollEl.scrollTop + overlap;

    const ordered = Array.from(items.values()).sort((a, b) => a.order - b.order);

    // 스냅샷(이번 프레임 기준 흔들림 방지)
    const snap = ordered.map((it) => {
      const y = getSentinelYInScroll(scrollEl, it.sentinelEl);
      const h = Math.round(it.el.getBoundingClientRect().height) || it.height || 0;
      return { it, y, h };
    });

    let acc = 0;

    // 경계 튐 방지 버퍼(헤더 애니메이션 있으면 4~8 권장)
    const EPS = 6;

    // 결정/적용을 분리(중간에 DOM 이동(pin)해도 기준이 바뀌지 않게)
    const decisions = [];

    for (const s of snap) {
      const threshold = baseLine + acc;
      const shouldPin = s.y < threshold - EPS;

      decisions.push({ it: s.it, shouldPin, h: s.h });

      if (shouldPin) acc += s.h;
    }

    for (const d of decisions) {
      d.it.height = d.h;

      if (d.shouldPin) pin(d.it.id);
      else unpin(d.it.id);
    }
  }

  /** 스크롤 tick: 1프레임 1회 */
  function onScrollTick() {
    if (rafTick) return;
    rafTick = requestAnimationFrame(() => {
      rafTick = null;
      evaluatePins();
      refreshPinnedLayout();
    });
  }

  /** scroll/resize 리스너를 1회만 부착 */
  async function attachListenersOnce() {
    const scrollEl = await waitForScrollEl(layoutStore);

    if (scrollEl.__pinListenersAttached) return;
    scrollEl.__pinListenersAttached = true;

    // stack ref 1회 확보(등록 시점에서 확실히)
    ensureStackRef();

    scrollEl.addEventListener("scroll", onScrollTick, { passive: true });
    window.addEventListener("resize", onScrollTick, { passive: true });

    // 최초 1회 평가
    onScrollTick();
  }

  /**
   * register: DOM element를 pin 시스템에 등록
   * - sentinel + placeholder는 “원래 자리”에 고정으로 설치
   * - pin 시 element는 stack으로 이동
   */
  async function register(el, options) {
    el = resolveDom(el);
    if (!el) throw new Error("useScrollPin.register: expected a DOM Element.");

    const id = options?.id;
    const order = options?.order;

    if (!id || typeof id !== "string") throw new Error("useScrollPin.register: options.id(string) is required.");
    if (!Number.isFinite(order)) throw new Error("useScrollPin.register: options.order(number) is required.");
    if (items.has(id)) throw new Error(`useScrollPin.register: duplicated id "${id}".`);

    const parent = el.parentNode;
    if (!parent) throw new Error("useScrollPin.register: target element has no parentNode.");

    // sentinel 삽입 (el 바로 앞)
    const sentinelEl = createSentinel();
    parent.insertBefore(sentinelEl, el);

    // placeholder 삽입 (sentinel 바로 뒤)
    const placeholderEl = createPlaceholder();
    sentinelEl.insertAdjacentElement("afterend", placeholderEl);

    const it = {
      id,
      order,
      el,
      sentinelEl,
      placeholderEl,
      isPinned: false,
      height: 0,
    };

    sentinelEl.__pinItem = it;
    items.set(id, it);

    await attachListenersOnce();
    onScrollTick();

    // cleanup 반환
    return () => unregister(id);
  }

  /** unregister: 등록 해제 + 원복 + DOM 정리 */
  function unregister(id) {
    const it = items.get(id);
    if (!it) return;

    // pinned 상태면 원복
    if (it.isPinned) {
      try {
        unpin(id);
      } catch (_) {}
    }

    // DOM 정리
    if (it.placeholderEl && it.placeholderEl.isConnected) it.placeholderEl.remove();
    if (it.sentinelEl && it.sentinelEl.isConnected) it.sentinelEl.remove();

    items.delete(id);

    // 더 이상 아이템이 없으면 stack/top도 필요 없으니 refcount 정리
    if (items.size === 0) {
      cleanupListeners();
    }
  }

  /** 리스너/stack ref 정리 */
  function cleanupListeners() {
    const scrollEl = layoutStore.scrollEl;

    if (scrollEl && scrollEl.__pinListenersAttached) {
      scrollEl.removeEventListener("scroll", onScrollTick);
      window.removeEventListener("resize", onScrollTick);
      delete scrollEl.__pinListenersAttached;
    }

    if (rafTick) cancelAnimationFrame(rafTick);
    rafTick = null;

    if (stackRefed) {
      decStackRef();
      stackRefed = false;
    }
  }

  /** 전체 파괴 */
  function destroy() {
    // 등록된 것들 모두 해제
    for (const id of Array.from(items.keys())) unregister(id);
    cleanupListeners();
  }

  /**
   * bindPin: ref 기반으로 간단하게 등록하는 헬퍼
   * - ref는 DOM wrapper에 달아야 가장 안정적
   * - 그래도 컴포넌트 ref가 오면 $el로 흡수
   */
  function bindPin(refEl, options) {
    let unreg = null;
    let cancelled = false;

    (async () => {
      // ref가 늦게 생기는 케이스 대응(최대 60프레임)
      for (let i = 0; i < 60; i++) {
        if (cancelled) return;

        const dom = resolveDom(refEl?.value);
        if (dom) {
          unreg = await register(dom, options);
          return;
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      // 필요하면 throw 대신 warn으로 바꿔도 됨
      throw new Error("useScrollPin.bindPin: target ref element not rendered. Check v-if/timing/ref target.");
    })();

    return () => {
      cancelled = true;
      if (unreg) unreg();
    };
  }

  onBeforeUnmount(() => {
    destroy();
  });

  return {
    register,
    unregister,
    bindPin,
    refreshPinnedLayout,
    destroy,
  };
}
```
