# 첫 노트 (공부)

공부 노트 예시입니다. 이미지 첨부 방법을 함께 보여드릴게요.

## 이미지 넣는 두 가지 방법

### 방법 1. `docs/public/` 폴더에 사진 올리기 (추천)

1. 깃허브 웹에서 `docs/public/images/` 폴더를 만들고 사진을 업로드
2. 노트에서 아래처럼 참조

```markdown
![설명 텍스트](/images/내사진.png)
```

`/images/내사진.png` 처럼 **앞에 슬래시**가 붙은 절대 경로를 쓰면 사이트 어느 페이지에서든 잘 보입니다.

### 방법 2. 노트 옆에 사진을 두고 상대경로로 참조

같은 폴더에 `screenshot.png` 가 있다면:

```markdown
![스크린샷](./screenshot.png)
```

## 글에 활용할 수 있는 요소들

### 강조 박스

::: tip 팁
중요한 핵심은 이렇게 강조할 수 있어요.
:::

::: warning 주의
헷갈리기 쉬운 부분은 여기에.
:::

::: details 펼쳐보기
처음엔 숨기고 클릭해야 보이는 내용도 가능합니다.
:::

### 수식 / 코드

````md
```python
def hello(name: str) -> str:
    return f"Hello, {name}!"
```
````

### 링크

- [VitePress 공식 문서](https://vitepress.dev/) — 더 많은 기능이 궁금할 때
- [Markdown 가이드](https://www.markdownguide.org/) — 문법 정리
