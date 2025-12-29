데이터 형식
```js
const rows = [
  {
    id: "menu-1",
    label: "업무",
    list: [
      { id: "g1", label: "조회", groupName: "조회" },          // 부모
      { id: "m1", label: "거래내역", group: "조회", path: "/a" }, // 자식(조회 밑)
      { id: "m2", label: "계좌조회", group: "조회", path: "/b" },

      { id: "g2", label: "관리", groupName: "관리" },          // 부모
      { id: "m3", label: "사용자", group: "관리", path: "/c" },

      { id: "m4", label: "즐겨찾기", path: "/fav" }           // 그룹 없는 단독 노드
    ],
  },
];
```

변환 함수
```js
/**
 * rows: [{ id, label, list: [...] }]
 * - list 원소 중 groupName이 있으면 "부모 그룹"
 * - group이 있으면 group === groupName 인 부모 그룹의 children으로 편입
 */
export function buildMenuTree(rows) {
  return rows.map((row) => {
    const groupMap = new Map(); // key: groupName, value: groupNode
    const standalone = [];      // group/groupName 없는 항목들(루트 직속)

    // 1) 부모 그룹 노드 먼저 구성
    for (const item of row.list || []) {
      if (item.groupName) {
        const key = String(item.groupName);

        // 부모 그룹 노드는 children을 가진 노드로 표준화
        groupMap.set(key, {
          id: item.id ?? `group:${key}`,     // id 없으면 생성
          label: item.label ?? key,          // label 없으면 groupName 사용
          type: "group",
          groupName: key,
          children: [],
          raw: item,                          // 원본 필요하면 보관
        });
      }
    }

    // 2) 자식/단독 항목 처리
    for (const item of row.list || []) {
      // 부모 그룹 정의 아이템은 이미 처리했으므로 skip
      if (item.groupName) continue;

      // group이 있으면 해당 부모 그룹 아래로 편입
      if (item.group) {
        const key = String(item.group);

        // 부모가 list에 없을 수도 있으니 “암묵 부모”를 만들어서라도 붙입니다.
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            id: `group:${key}`,
            label: key,
            type: "group",
            groupName: key,
            children: [],
            raw: null,
          });
        }

        groupMap.get(key).children.push({
          id: item.id,
          label: item.label,
          type: "item",
          ...item,
        });
      } else {
        // group도 groupName도 없으면 루트 직속 단독 노드
        standalone.push({
          id: item.id,
          label: item.label,
          type: "item",
          ...item,
        });
      }
    }

    // 3) 최종 children 구성: [그룹들..., 단독들...]
    // 필요하면 정렬(예: 원래 순서 유지) 로직을 추가하세요.
    const groups = Array.from(groupMap.values());

    return {
      id: row.id,
      label: row.label,
      type: "root",
      children: [...groups, ...standalone],
      raw: row,
    };
  });
}

```

상태 모델
```js
import { ref } from "vue";

export function useTreeExpand() {
  const expanded = ref(new Set()); // Set<nodeId>

  const isExpanded = (id) => expanded.value.has(id);

  const toggle = (id) => {
    const next = new Set(expanded.value); // Vue 반응성 안전하게 새 Set
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded.value = next;
  };

  const expandAll = (nodes) => {
    const next = new Set();
    const walk = (n) => {
      if (!n) return;
      if (Array.isArray(n.children) && n.children.length) {
        next.add(n.id);
        n.children.forEach(walk);
      }
    };
    nodes.forEach(walk);
    expanded.value = next;
  };

  const collapseAll = () => {
    expanded.value = new Set();
  };

  return { expanded, isExpanded, toggle, expandAll, collapseAll };
}

```

재귀 랜더링
```js
<template>
  <div class="tree-node">
    <!-- 그룹 노드 -->
    <div
      v-if="node.type === 'group' || (node.children && node.children.length)"
      class="row clickable"
      role="button"
      tabindex="0"
      :aria-expanded="isExpanded(node.id)"
      @click="toggle(node.id)"
      @keydown.enter.prevent="toggle(node.id)"
      @keydown.space.prevent="toggle(node.id)"
    >
      <span class="chev">{{ isExpanded(node.id) ? "▾" : "▸" }}</span>
      <span class="label">{{ node.label }}</span>
    </div>

    <!-- 일반 노드 -->
    <div
      v-else
      class="row leaf"
      @click="$emit('select', node)"
    >
      <span class="chev"></span>
      <span class="label">{{ node.label }}</span>
    </div>

    <!-- 자식 영역 (펼침 상태일 때만 렌더) -->
    <div v-if="node.children && node.children.length && isExpanded(node.id)" class="children">
      <TreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :isExpanded="isExpanded"
        :toggle="toggle"
        @select="$emit('select', $event)"
      />
    </div>
  </div>
</template>

<script setup>
/**
 * node: { id, label, type, children? }
 * isExpanded: (id) => boolean
 * toggle: (id) => void
 */
defineProps({
  node: { type: Object, required: true },
  isExpanded: { type: Function, required: true },
  toggle: { type: Function, required: true },
});

defineEmits(["select"]);
</script>

<style scoped>
.tree-node { font-size: 14px; }
.row { display: flex; align-items: center; padding: 6px 8px; }
.clickable { cursor: pointer; user-select: none; }
.leaf { cursor: pointer; }
.children { margin-left: 18px; border-left: 1px solid #ddd; padding-left: 10px; }
.chev { width: 16px; display: inline-block; }
.label { line-height: 1.2; }
</style>

```

부모 컴포넌트
```js
<template>
  <div>
    <div class="toolbar">
      <button @click="expandAll(tree)">전체 펼치기</button>
      <button @click="collapseAll()">전체 접기</button>
    </div>

    <div v-for="root in tree" :key="root.id" class="root">
      <div class="root-title">{{ root.label }}</div>

      <TreeNode
        v-for="child in root.children"
        :key="child.id"
        :node="child"
        :isExpanded="isExpanded"
        :toggle="toggle"
        @select="onSelect"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import TreeNode from "./TreeNode.vue";
import { buildMenuTree } from "./buildMenuTree";
import { useTreeExpand } from "./useTreeExpand";

const rows = /* 원본 데이터 */;
const tree = computed(() => buildMenuTree(rows));

const { isExpanded, toggle, expandAll, collapseAll } = useTreeExpand();

const onSelect = (node) => {
  // leaf 클릭 시 라우팅/액션 처리
  // 예: if (node.path) router.push(node.path)
  console.log("selected:", node);
};
</script>

<style scoped>
.root { margin-bottom: 12px; }
.root-title { font-weight: 700; padding: 8px; }
.toolbar { display: flex; gap: 8px; margin-bottom: 10px; }
</style>

```