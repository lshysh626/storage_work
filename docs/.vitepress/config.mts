import { defineConfig } from 'vitepress'
import { generateSidebar } from 'vitepress-sidebar'

export default defineConfig({
  lang: 'ko-KR',
  title: '나의 정리장',
  description: '업무와 공부를 한곳에 모아두는 개인 노트',
  base: '/storage_work/',
  lastUpdated: true,
  cleanUrls: true,

  head: [
    ['meta', { name: 'theme-color', content: '#3c8772' }]
  ],

  themeConfig: {
    nav: [
      { text: '홈', link: '/' },
      { text: '업무', link: '/work/' },
      { text: '공부', link: '/study/' }
    ],

    sidebar: generateSidebar([
      {
        documentRootPath: 'docs',
        scanStartPath: 'work',
        resolvePath: '/work/',
        useTitleFromFileHeading: true,
        useTitleFromFrontmatter: true,
        useFolderTitleFromIndexFile: true,
        collapsed: false,
      },
      {
        documentRootPath: 'docs',
        scanStartPath: 'study',
        resolvePath: '/study/',
        useTitleFromFileHeading: true,
        useTitleFromFrontmatter: true,
        useFolderTitleFromIndexFile: true,
        collapsed: false,
      }
    ]),

    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: '검색',
                buttonAriaLabel: '검색'
              },
              modal: {
                noResultsText: '검색 결과 없음',
                resetButtonTitle: '초기화',
                footer: {
                  selectText: '선택',
                  navigateText: '이동',
                  closeText: '닫기'
                }
              }
            }
          }
        }
      }
    },

    outline: {
      label: '이 페이지 내용',
      level: [2, 3]
    },

    docFooter: {
      prev: '이전',
      next: '다음'
    },

    lastUpdatedText: '마지막 업데이트',

    socialLinks: [
      { icon: 'github', link: 'https://github.com/lshysh626/storage_work' }
    ],

    footer: {
      message: '개인 정리용 공간',
      copyright: '© lshysh626'
    }
  }
})
