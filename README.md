# Backend — SyncedDB file storage API

SyncedDB 호환 REST API 서버. IndexedDB와 동기화할 수 있도록 JSON 파일 기반 스토리지를 제공합니다.

- [SyncedDB](https://github.com/darrachequesne/synceddb) 클라이언트와 연동
- 스토어 이름에 따라 동적 경로 지원 (예: `/memos`, `/todos`)
- 로컬: `./data` 또는 `STORAGE_PATH`에 JSON 파일 저장
- Docker: `/mnt`에 볼륨 마운트해 데이터 영속화

---

## 요구 사항

- [Bun](https://bun.sh) (로컬 실행 시)
- Docker & Docker Compose (컨테이너 실행 시)

---

## 로컬에서 실행

```bash
# 의존성 설치
bun install

# 서버 실행 (기본: http://localhost:3000, 스토리지: ./data)
bun run start
```

**환경 변수** (선택, `.env` 파일 사용 가능):

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3000` | 서버 포트 |
| `STORAGE_PATH` | `./data` | JSON 파일이 저장되는 디렉터리 |

예: `STORAGE_PATH=./data bun run start`

---

## Docker Compose로 실행

프로젝트 데이터를 호스트의 `./data`에 두고, 컨테이너 내부에서는 `/mnt`로 사용합니다.

```bash
# backend 디렉터리에서
cd backend

# 이미지 빌드 후 백그라운드 실행
docker compose up --build -d

# 로그 보기
docker compose logs -f

# 중지
docker compose down
```

- **API 주소**: http://localhost:3000
- **스토리지**: `backend/data` → 컨테이너 `/mnt` (재시작 후에도 유지)

---

## API 요약

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/:storeName` | 목록 (쿼리: `size`, `after`, `after_id`) |
| `POST` | `/:storeName` | 생성 (body에 `id` 필수) |
| `PUT` | `/:storeName/:id` | 수정 (버전 충돌 시 409) |
| `DELETE` | `/:storeName/:id` | 삭제 (톰스톤 기록) |

스토어 이름은 영문·숫자·`_`·`-`만 허용됩니다. 자세한 규격은 [SyncedDB — Expectations for the REST API](https://github.com/darrachequesne/synceddb#expectations-for-the-rest-api)를 참고하세요.
