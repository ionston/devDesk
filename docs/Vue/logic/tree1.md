# Vue Tree Component

## 트리 구조 메뉴 컴포넌트

```js
import { computed, ref } from "vue";

// 입력 데이터
const rows = ref([
  {
    id: "menu-1",
    label: "업무",
    list: [
      { id: "g1", label: "조회", groupName: "조회" },
      { id: "m1", label: "거래내역", group: "조회", path: "/a" },
      { id: "m2", label: "계좌조회", group: "조회", path: "/b" },
      { id: "g2", label: "관리", groupName: "관리" },
      { id: "m3", label: "사용자", group: "관리", path: "/c" },
      { id: "m4", label: "즐겨찾기", path: "/fav" },
    ],
  },
]);

// 접기/펼치기 상태
const expanded = ref(new Set());

const isExpanded = (id) => expanded.value.has(id);

const toggle = (id) => {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
};

// 트리 변환 함수
function buildTreeFromList(list = []) {
  const groupMap = new Map();
  const standalone = [];

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

  for (const it of list) {
    if (!it) continue;
    if (it.groupName) continue;

    if (it.group) {
      const key = String(it.group);
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
```
