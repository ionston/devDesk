import fs from 'node:fs'
import path from 'node:path'

const DOCS_ROOT = path.resolve(process.cwd(), 'docs')
const HEADER_ROOT = path.join(DOCS_ROOT, 'header')

export function createHeaderNav() {
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

function toTitle(text: string) {
  return text
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
