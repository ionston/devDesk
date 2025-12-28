import { defineConfig } from 'vitepress'
import { createTreeSidebar } from './sidebar.mts'
import { createHeaderNav } from './header.mts'

export default defineConfig({
  title: 'devDesk',

  themeConfig: {
    nav: createHeaderNav(),      // ✅ 헤더 메뉴
    sidebar: createTreeSidebar(),// ✅ 사이드바
    search: { provider: 'local' }
  }
})
