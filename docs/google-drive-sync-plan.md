# 구글 로그인 + 드라이브 저장 계획

다른 컴퓨터에서 이어서 작업하기 위한 정리 문서입니다. (2026-10-27 작성, 2026-10-28 OMR 연결까지 완료)

## 목표
index 화면에서 로그인하면 채점 JSON을 서버에 저장하고, 다른 PC에서도 이어서 채점할 수 있게 한다. 별도 서버는 두지 않는다.

## 결정한 내용과 이유
- **GitHub 저장소에는 채점 데이터를 올리지 않는다.**
  - `RamzThunder/forClass`는 공개 저장소이고 GitHub Pages(`https://ramzthunder.github.io/forClass/`)로 배포 중이다.
  - 백업 JSON 안에 `roster`(학생 명단)와 `records`(점수·답안)가 들어 있어서 커밋하면 학생 개인정보가 공개된다.
- **GitHub 비공개 저장소 + 토큰 방식은 쓰지 않는다.**
  - GitHub은 아이디·비밀번호로 API를 쓸 수 없고 토큰만 받는다.
  - 비밀번호로 토큰을 암호화해 사이트에 두는 방법은 약한 비밀번호일 때 뚫릴 수 있다.
  - GitHub OAuth 로그인은 client secret을 처리할 중계 서버(예: Cloudflare Worker)가 필요하다.
- **구글 로그인 + 구글 드라이브 저장으로 간다.**
  - Google Identity Services의 토큰 방식은 브라우저만으로 로그인할 수 있어서 서버가 필요 없다.
  - 사이트에 비밀 값을 넣지 않는다. 클라이언트 ID는 공개돼도 괜찮다.
  - 데이터는 각 선생님 본인 드라이브에 저장되고, 드라이브 버전 기록으로 되돌릴 수 있다.

## 사용 흐름 (목표 동작)
1. index에서 "Google로 로그인"을 누른다. 처음 한 번만 권한을 허용한다.
2. 채점기를 열면 드라이브 `forClass` 폴더에서 해당 채점 파일을 찾아 자동으로 불러온다.
3. 점수를 입력하면 몇 초 뒤 드라이브에 자동 저장하고, 화면에 "저장됨 · 14:32"처럼 상태를 표시한다.
4. 다른 PC에서 로그인하면 이어서 채점할 수 있다.

## 세부 설계
- **권한 범위**: `https://www.googleapis.com/auth/drive.file`
  - 앱이 만든 파일만 접근한다. 드라이브의 다른 파일은 볼 수 없다.
  - 민감하지 않은 범위라 앱 검수 부담이 적다.
- **기존 백업 옮기기**: 기존 JSON 백업을 "드라이브로 올리기"로 한 번 업로드한다.
- **충돌 처리**: 저장 직전에 드라이브 파일의 `modifiedTime`(또는 version)을 확인한다.
  - 다른 기기에서 그사이 바뀌었으면 덮어쓰지 않는다.
  - 대신 기존 JSON 병합 기능(`mergeJsonBackup`)으로 합칠지 묻는다.
- **오프라인**: 지금처럼 localStorage에도 계속 저장하고, 다시 연결되면 드라이브에 올린다.
- **로그인 만료**: 액세스 토큰이 약 1시간 뒤 만료되므로 가능하면 조용히 재발급하고, 안 되면 다시 로그인 버튼을 보여 준다.
- **공용 PC**: 로그아웃 버튼으로 토큰을 폐기하고 저장된 상태를 지운다.
- **공통 모듈**: `google-drive-sync.js`를 새로 만들어 세 채점기가 함께 쓴다. 기존 `shared-roster.js`와 같은 방식이다.
- **UI**: `AGENTS.md`의 스타일 규칙에 맞춰 기존 버튼·상태 문구 스타일을 재사용한다.
- 브라우저 저장소 안내 문구(index의 `heroSub`)도 드라이브 저장에 맞게 바꾼다.

## 코드 연결 지점 (b227685 기준)
OMR 채점기를 먼저 연결하고, 나머지 채점기는 그다음에 연결한다.

| 파일 | 위치 | 역할 |
|---|---|---|
| `omr-grader.html` | `persist()` (~1975행) | localStorage 저장, 70곳 이상에서 호출된다. 여기에 디바운스한 드라이브 저장을 건다. |
| `omr-grader.html` | `buildJsonBackup()` (~8286행) | 드라이브에 올릴 JSON을 만든다. |
| `omr-grader.html` | `importJsonBackup()` (~8379행) | 드라이브에서 받은 JSON을 적용한다. |
| `omr-grader.html` | `mergeJsonBackup()` (~8530행) | 충돌 시 병합에 쓴다. |
| `omr-grader.html` | `loadSavedState()` (~1690행) | 시작 시 드라이브 불러오기를 연결한다. |
| `argument-writing-grader.html` | `persistState()` (~2774행) | 글쓰기 채점기 저장 지점 |
| `logical-speaking-grader.html` | 저장 함수 (~875행, `LS`/`LS_MIRROR`) | 말하기 채점기 저장 지점 |

## 진행 상황
- [x] Google Cloud 등록, 클라이언트 ID 발급 (`google-drive-sync.js`의 `CLIENT_ID`)
  - 승인된 JavaScript 원본: `https://ramzthunder.github.io`, `http://localhost:8000`
  - 동의 화면이 "테스트" 상태라 **테스트 사용자로 등록한 계정만** 로그인할 수 있다.
- [x] `google-drive-sync.js`: 로그인·로그아웃, 폴더·파일 찾기, 업로드·다운로드, 변경 비교, 충돌 처리
  - 드라이브 폴더 이름은 「평가 도구 모음」이고, 파일은 `appProperties.forClassApp`(예: `omr`)으로 구분한다.
  - 채점 내용이 바뀌었는지는 JSON 지문(화면 위치 등 `volatileKeys` 제외)으로 판단한다. 그래서 문항이나 반만 바꿔 보는 건 저장하지 않는다.
  - 드라이브 쪽 변경은 파일 `version`으로 판단한다.
- [x] index에 「구글 드라이브 연결」 카드(로그인/로그아웃)
- [x] OMR 채점기(v1.9.0) 연결
  - 상단 구름 버튼에 상태 점이 표시된다(초록: 저장됨, 주황: 저장 중·오프라인, 빨강: 확인 필요). 누르면 드라이브 창이 열린다.
  - `persist()`가 불릴 때마다 3초 뒤 자동 저장한다. 다른 탭에 갔다 돌아오면 드라이브 변경을 확인한다.
  - "전체 초기화"를 하면 이전 파일과 연결을 끊고, 다음 채점부터 새 파일(`[OMR] 시험제목.json`)에 저장한다.
- [x] 테스트: `tests/google-drive-sync.test.cjs` (가짜 드라이브로 저장·받기·충돌·오프라인·만료 흐름)

- [x] 시험 PDF 브라우저 보관 + 드라이브 저장 (OMR v1.10.0)
  - 연 PDF를 IndexedDB(`publicOmrEssayGraderFiles.v1` / `lastPdfBlob`)에 하나만 보관한다. 다음에 열 때 권한 요청 없이 바로 열린다(사파리·아이패드 포함). 새 PDF를 열거나 전체 초기화하면 이전 것은 지운다.
  - 로그인 상태에서 PDF를 열면 드라이브에 올릴지 한 번 묻는다(거절하면 같은 PDF는 다시 묻지 않음). 8MB씩 재개 가능 업로드를 한다.
  - 드라이브 PDF는 `appProperties.forClassApp='omr-pdf'`, `forClassKey=hash(이름|크기)`로 찾는다. 채점 기록의 `settings.pdfDriveFile`에 연결 정보를 넣어 다른 기기가 알 수 있게 한다.
  - 시작 순서: 브라우저 보관 PDF → (크롬) 파일 위치 기억 → 드라이브 PDF 받기 제안.

## 남은 일
- [ ] 실제 구글 계정으로 GitHub Pages에서 로그인·저장·다른 기기 불러오기 확인
- [ ] 글쓰기 채점기 연결 (`persistState()`에 `driveDoc.changed()`, 백업/복원 함수로 build·apply·merge 연결)
- [ ] 말하기 채점기 연결
- [ ] 계속 쓸 거면 동의 화면을 "프로덕션"으로 게시하는 것을 검토 (`drive.file`은 민감하지 않은 범위라 검수 부담이 적다)

## 주의
- 루트의 중간고사 백업 JSON 2개는 학생 데이터라 커밋하지 않는다. 같은 패턴은 `.gitignore`에 추가해 두었다.
