import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DefaultTheme } from 'vitepress'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCS_ROOT = path.resolve(__dirname, '..')
const HEADER_ROOT = path.join(DOCS_ROOT, 'header')
const EXCLUDE = ['.vitepress', '.obsidian']

// 자동 헤더 네비게이션 생성
function createHeaderNav(): DefaultTheme.NavItem[] {
  if (!fs.existsSync(HEADER_ROOT)) return []

  const entries = fs.readdirSync(HEADER_ROOT, { withFileTypes: true })

  return entries
    .filter(e => e.isDirectory())
    .filter(e => fs.existsSync(path.join(HEADER_ROOT, e.name, 'index.md')))
    .map(e => ({
      text: toTitle(e.name),
      link: `/header/${e.name}/`
    }))
}

// 자동 사이드바 생성
function createTreeSidebar(): DefaultTheme.Sidebar {
  return {
    '/': buildFolder(DOCS_ROOT, '/')
  }
}

function buildFolder(
  dir: string,
  base: string
): DefaultTheme.SidebarItem[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const items: DefaultTheme.SidebarItem[] = []

  /* 1️⃣ index.md → Overview 역할 */
  const indexPath = path.join(dir, 'index.md')
  if (fs.existsSync(indexPath)) {
    items.push({
      text: readSidebarTitle(indexPath) ?? '개요',
      link: base
    })
  }

  /* 2️⃣ 하위 폴더 */
  for (const entry of entries.filter(e => e.isDirectory())) {
    if (EXCLUDE.includes(entry.name)) continue

    const subDir = path.join(dir, entry.name)
    const subIndex = path.join(subDir, 'index.md')
    if (!fs.existsSync(subIndex)) continue

    items.push({
      text: readSidebarTitle(subIndex) ?? toTitle(entry.name),
      collapsed: true,
      items: buildFolder(subDir, `${base}${entry.name}/`)
    })
  }

  /* 3️⃣ 일반 md 파일 */
  for (const entry of entries.filter(
    e => e.isFile() && e.name.endsWith('.md') && e.name !== 'index.md'
  )) {
    const name = entry.name.replace(/\.md$/, '')
    items.push({
      text: toTitle(name),
      link: `${base}${name}`
    })
  }

  return items
}

/* frontmatter sidebarTitle 파싱 */
function readSidebarTitle(filePath: string): string | null {
  const content = fs.readFileSync(filePath, 'utf-8')

  const match = content.match(
    /^---[\s\S]*?sidebarTitle\s*:\s*(.+)[\s\S]*?---/
  )

  if (!match) return null
  return match[1].trim().replace(/^["']|["']$/g, '')
}

function toTitle(text: string) {
  return text
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export default defineConfig({
  title: 'devDesk',
  base: '/devDesk/',

  themeConfig: {
    search: { provider: 'local' },

    nav: createHeaderNav(),

    sidebar: createTreeSidebar()
  }
})
