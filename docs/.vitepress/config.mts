import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'devDesk',
  base: '/devDesk/',

  themeConfig: {
    search: { provider: 'local' },

    nav: [
      { text: 'Guide', link: '/header/guide/' },
      { text: 'Search', link: '/header/search/' },
      { text: 'Shortcuts', link: '/header/shortcuts/' }
    ],

    sidebar: {
      '/': [
        {
          text: '시작하기',
          link: '/'
        },
        {
          text: 'Vue',
          collapsed: true,
          items: [
            { text: 'Vue', link: '/Vue/' },
            {
              text: 'API',
              collapsed: true,
              items: [
                { text: 'api', link: '/Vue/api/' },
                { text: 'Api', link: '/Vue/api/api' }
              ]
            },
            {
              text: 'Logic',
              collapsed: true,
              items: [
                { text: 'vue 로직 모음', link: '/Vue/logic/' },
                { text: 'Tree1', link: '/Vue/logic/tree1' }
              ]
            }
          ]
        },
        {
          text: 'Header',
          collapsed: true,
          items: [
            { text: 'Guide', link: '/header/guide/' },
            { text: 'Search', link: '/header/search/' },
            { text: 'Shortcuts', link: '/header/shortcuts/' }
          ]
        }
      ]
    }
  }
})
