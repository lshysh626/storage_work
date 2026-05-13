# 📖 예시: 노션처럼 정리하기

이 페이지는 노션(Notion)처럼 텍스트와 사진을 조합하여 정리하는 방법을 보여주는 예시입니다.

## 1. 노션의 Callout(콜아웃) 기능 활용하기

VitePress는 노션의 Callout처럼 사용할 수 있는 팁/경고 박스를 제공합니다.

::: info 💡 아이디어
이곳에 중요한 내용이나 아이디어를 노션처럼 돋보이게 적을 수 있습니다!
:::

::: tip 🚀 팁
코드 작성 팁이나 유용한 링크를 걸어둘 때 좋습니다.
:::

::: warning ⚠️ 주의사항
잊지 말아야 할 주의사항을 적어두세요.
:::

## 2. 코드 블록 작성하기 (문법 강조)

```javascript
// 노션처럼 코드 블록도 예쁘게 들어갑니다!
function greet(name) {
  console.log(`Hello, ${name}!`);
}
greet('GitHub');
```

## 3. 사진 첨부하기 🖼️

사진을 넣으려면 `docs/public` 폴더 안에 이미지 파일을 넣고, 아래처럼 작성하면 됩니다. 
(예: `docs/public/sample.png` 에 사진이 있다고 가정)

```markdown
![샘플 이미지](/sample.png)
```

아래는 웹 상의 이미지를 바로 불러온 예시입니다.

![Notion Style Workspace](https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?auto=format&fit=crop&w=800&q=80)

## 4. 할 일 목록 (To-Do) 만들기

- [x] VitePress 세팅하기
- [x] 노션 스타일 CSS 적용하기
- [ ] 깃허브 페이지에 연동 확인하기
- [ ] 나만의 내용 채워넣기

---
**이제 왼쪽 사이드바 파일(`.vitepress/config.mts`)에 이 문서를 등록하면 됩니다.**
