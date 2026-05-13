# storage_work

업무 + 공부를 정리하는 개인 노트 사이트 ([VitePress](https://vitepress.dev/) 기반).

배포 주소: <https://lshysh626.github.io/storage_work/>

## 폴더 구조

```
.
├── .github/workflows/deploy.yml   # GitHub Actions 자동 빌드/배포
├── docs/
│   ├── .vitepress/config.mts      # 사이트 설정 (제목, 사이드바, 검색 등)
│   ├── public/                    # 이미지 등 정적 파일 (사진 업로드 위치)
│   ├── work/                      # 업무 노트
│   └── study/                     # 공부 노트
├── package.json
└── .gitignore
```

## 새 노트 추가 (깃허브 웹에서)

1. 원하는 카테고리 폴더(`docs/work/` 또는 `docs/study/`) 들어가기
2. `Add file` → `Create new file`
3. 파일명 입력 (예: `2026-05-13-회의록.md`) 후 마크다운 작성
4. `Commit changes` 누르면 GitHub Actions가 자동으로 빌드/배포 (1~2분 소요)
5. 메뉴에 노출하려면 `docs/.vitepress/config.mts` 의 `sidebar` 에 한 줄 추가

## 사진 첨부

`docs/public/images/` 에 사진 업로드 후 마크다운에서:

```markdown
![설명](/images/파일명.png)
```

자세한 예시는 `docs/study/welcome.md` 참고.
