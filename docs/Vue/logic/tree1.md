```js
<script setup>
import { computed, ref } from "vue";

/**
 * ===== 1) 입력 데이터(예시) =====
 * 실제로는 props 또는 API/스토어에서 받아오면 됩니다.
 */
const rows = ref([
  {
    id: "menu-1",
    label: "업무",
    list: [
      { id: "g1", label: "조회", groupName: "조회" },
      { id: "m1", label: "거래내역", group: "조회", path: "/a" },~~~~
      { id: "m2", label: "계좌조회", group: "조회", path: "/b" },

      { id: "g2", label: "관리", groupName: "관리" },
      { id: "m3", label: "사용자", group: "관리", path: "/c" },

      { id: "m4", label: "즐겨찾기", path: "/fav" },
    ],
  },
]);

/**
 * ===== 2) 접기/펼치기 상태 =====
 * Set으로 확장된 노드 id를 관리합니다.
 */
const expanded = ref(new Set());

const isExpanded = (id) => expanded.value.has(id);

const toggle = (id) => {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
};

/**
 * ===== 3) rows(list)를 트리로 변환 =====
 * 규칙:
 * - groupName: 부모 그룹 노드
 * - group: groupName과 매칭되는 부모 밑으로 편입
 * - 둘 다 없으면 단독 리프(루트 직속)
 */
function buildTreeFromList(list = []) {
  const groupMap = new Map(); // key=groupName, value=groupNode
  const standalone = []; // group/groupName 없는 항목

  // 3-1) 부모 그룹 생성
  for (const it of list) {
    if (!it?.groupName) continue;
    const key = String(it.groupName);

    groupMap.set(key, {
      id: it.id ?? `group:${key}`,
      label: it.label ?? key,
      type: "group",
      groupName: key,
      children: [],
      raw: it,
    });
  }

  // 3-2) 자식/단독 처리
  for (const it of list) {
    if (!it) continue;
    if (it.groupName) continue; // 부모 정의 항목은 skip

    if (it.group) {
      const key = String(it.group);

      // 부모가 없으면 암묵 생성
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
        id: it.id,
        label: it.label,
        type: "item",
        ...it,
      });
    } else {
      standalone.push({
        id: it.id,
        label: it.label,
        type: "item",
        ...it,
      });
    }
  }

  return {
    groups: Array.from(groupMap.values()),
    standalone,
  };
}

/**
 * ===== 4) 트리를 "보이는 노드 목록"으로 평탄화 =====
 * - 렌더는 v-for 한 번
 * - expanded 상태에 따라 children을 포함/제외
 */
function flattenVisible(nodes, depth = 0, out = []) {
  for (const node of nodes) {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;

    out.push({
      key: `${node.id}:${depth}`, // depth 포함(같은 id가 있을 가능성 방지용)
      id: node.id,
      label: node.label,
      depth,
      hasChildren,
      raw: node,
      // leaf 선택에 필요한 값은 raw에 있으니 raw로 접근 가능
      path: node.path,
      type: node.type,
    });

    if (hasChildren && isExpanded(node.id)) {
      flattenVisible(node.children, depth + 1, out);
    }
  }
  return out;
}

/**
 * ===== 5) 최종 화면 모델 =====
 * root(row)마다 children 트리 + visibleNodes(flat)를 함께 만들어 둡니다.
 */
const roots = computed(() => {
  return (rows.value || []).map((row) => {
    const { groups, standalone } = buildTreeFromList(row.list || []);

    // 루트 직속 children = [그룹..., 단독...]
    const children = [...groups, ...standalone];

    // visibleNodes는 expanded 상태에 따라 매번 재계산
    const visibleNodes = flattenVisible(children, 0, []);

    return {
      id: row.id,
      label: row.label,
      children,
      visibleNodes,
      raw: row,
    };
  });
});

/**
 * ===== 6) 리프 클릭 동작 =====
 * 라우팅/선택 결과 처리
 */
function onSelect(node) {
  // node.raw 에 원본 속성이 있습니다.
  // 예: router.push(node.raw.path)
  console.log("selected leaf:", node);
}
</script>

<style scoped>
.menu-tree {
  font-size: 14px;
}
.root {
  margin-bottom: 12px;
}
.root-title {
  font-weight: 700;
  padding: 8px 6px;
}
.row {
  display: flex;
  align-items: center;
  padding: 6px 6px;
  gap: 6px;
}
.toggle {
  width: 26px;
  height: 26px;
  line-height: 26px;
  cursor: pointer;
}
.toggle-spacer {
  display: inline-block;
  width: 26px;
}
.label {
  cursor: pointer;
  user-select: none;
}
.label.group {
  font-weight: 600;
}
.label.leaf {
  font-weight: 400;
}
</style>

```
