import fs from 'node:fs'
import path from 'node:path'
import type { DefaultTheme } from 'vitepress'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCS_ROOT = path.resolve(__dirname, '..')
const EXCLUDE = ['.vitepress', '.obsidian']

export function createTreeSidebar(): DefaultTheme.Sidebar {
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

/* -----------------------------
   frontmatter sidebarTitle 파싱
--------------------------------*/
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
