<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { LiveQuery } from 'synceddb';
import {
  getDB,
  getSyncManager,
  getApiBase,
  setApiBase,
  getCurrentStoreName,
  setCurrentStoreName,
  addStoreName,
  triggerSync,
  STORE_NAME_REGEX,
} from './db';

const memos = ref([]);
const newText = ref('');
const loading = ref(true);
const error = ref(null);
const apiUrlInput = ref(getApiBase());
const apiUrlError = ref('');
const storeNameInput = ref(getCurrentStoreName());
const currentStore = ref(getCurrentStoreName());
const storeError = ref('');
const syncError = ref('');
const syncInProgress = ref(false);
let db = null;
let query = null;

function initQuery(storeName) {
  query?.close();
  query = new LiveQuery([storeName], async () => {
    const all = await db.getAll(storeName);
    memos.value = (all || []).filter((m) => m.version !== -1);
  });
  return query.run();
}

/** 스토어 이름 적용: localStorage/IndexedDB만 변경. 서버 연결 여부와 무관하게 동작 */
async function applyStoreName() {
  const name = storeNameInput.value.trim();
  storeError.value = '';
  if (!name) {
    storeError.value = '스토어 이름을 입력하세요.';
    return;
  }
  if (!STORE_NAME_REGEX.test(name)) {
    storeError.value = '영문, 숫자, _, - 만 사용할 수 있습니다.';
    return;
  }
  try {
    addStoreName(name);
    setCurrentStoreName(name);
    currentStore.value = name;
    db = await getDB();
    await initQuery(name);
  } catch (e) {
    storeError.value = e?.message || String(e);
  }
}

/** 서버 주소 적용: URL 형식만 검사하고 localStorage에 저장. 실제 연결/404는 검사하지 않음 */
function applyApiUrl() {
  apiUrlError.value = '';
  const url = apiUrlInput.value.trim();
  if (!url) {
    apiUrlError.value = '서버 주소를 입력하세요.';
    return;
  }
  if (!setApiBase(url)) {
    apiUrlError.value = '올바른 URL을 입력하세요. (예: http://localhost:3000)';
    return;
  }
  apiUrlInput.value = getApiBase();
  apiUrlInput.value = getApiBase();
  getSyncManager();
}

/** 서버에서 강제로 불러오기 */
async function onSyncClick() {
  syncError.value = '';
  syncInProgress.value = true;
  try {
    const result = await triggerSync();
    if (result.ok) {
      await initQuery(currentStore.value);
    } else {
      syncError.value = result.message;
    }
  } catch (e) {
    syncError.value = e?.message || String(e);
  } finally {
    syncInProgress.value = false;
  }
}

onMounted(async () => {
  try {
    db = await getDB();
    getSyncManager();
    await initQuery(currentStore.value);
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  query?.close();
});

async function add() {
  if (!db) return;
  const text = newText.value.trim();
  if (!text) return;
  const store = currentStore.value;
  await db.add(store, { id: crypto.randomUUID(), text });
  newText.value = '';
}

function remove(id) {
  return db?.delete(currentStore.value, id);
}
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>메모장</h1>
      <p class="sub">SyncedDB · 로컬 저장 후 서버와 동기화</p>
    </header>
    <p v-if="loading" class="status">로딩 중…</p>
    <p v-else-if="error" class="status error">오류: {{ error }}</p>
    <template v-else>
    <div class="store-row">
      <label class="store-label">SyncedDB 서버 주소</label>
      <form class="form store-form" @submit.prevent="applyApiUrl">
        <input
          v-model="apiUrlInput"
          type="url"
          class="input store-input store-input-wide"
          placeholder="http://localhost:3000"
          autocomplete="off"
        />
        <button type="submit" class="btn btn-store">적용</button>
      </form>
      <p v-if="apiUrlError" class="status error">{{ apiUrlError }}</p>
      <p v-else class="store-current">현재: {{ getApiBase() }}</p>
    </div>
    <div class="store-row">
      <label class="store-label">스토어 이름</label>
      <form class="form store-form" @submit.prevent="applyStoreName">
        <input
          v-model="storeNameInput"
          type="text"
          class="input store-input"
          placeholder="예: memos, todos"
          autocomplete="off"
        />
        <button type="submit" class="btn btn-store">적용</button>
      </form>
      <p v-if="storeError" class="status error">{{ storeError }}</p>
      <p v-else class="store-current">현재: {{ currentStore }}</p>
    </div>
    <div class="store-row sync-row">
      <button
        type="button"
        class="btn btn-sync"
        :disabled="syncInProgress"
        @click="onSyncClick"
      >
        {{ syncInProgress ? '가져오는 중…' : 'Sync (서버에서 불러오기)' }}
      </button>
      <p v-if="syncError" class="status error">{{ syncError }}</p>
    </div>
    <form class="form" @submit.prevent="add">
      <input
        v-model="newText"
        type="text"
        class="input"
        placeholder="메모 입력 후 Enter"
        autocomplete="off"
      />
      <button type="submit" class="btn">추가</button>
    </form>
    <ul class="list" v-if="memos.length">
      <li v-for="m in memos" :key="m.id" class="item">
        <span class="text">{{ m.text }}</span>
        <button type="button" class="btn-delete" @click="remove(m.id)" aria-label="삭제">×</button>
      </li>
    </ul>
    <p v-else class="empty">메모가 없습니다.</p>
    </template>
  </div>
</template>

<style scoped>
.app {
  max-width: 32rem;
  margin: 0 auto;
  padding: 1.5rem;
}
.header {
  margin-bottom: 1.25rem;
}
.header h1 {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0 0 0.25rem 0;
}
.sub {
  font-size: 0.875rem;
  color: var(--color-muted, #64748b);
  margin: 0;
}
.store-row {
  margin-bottom: 1.25rem;
  padding: 0.75rem;
  border-radius: 6px;
  background: var(--color-bg, #1e293b);
  border: 1px solid var(--color-border, #334155);
}
.store-label {
  display: block;
  font-size: 0.75rem;
  color: var(--color-muted, #94a3b8);
  margin-bottom: 0.5rem;
}
.store-form {
  margin-bottom: 0.25rem;
}
.store-form .store-input {
  max-width: 12rem;
}
.store-form .store-input-wide {
  max-width: none;
}
.store-current {
  font-size: 0.75rem;
  color: var(--color-muted, #94a3b8);
  margin: 0.25rem 0 0 0;
}
.sync-row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.btn-sync:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.form {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}
.input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 6px;
  font-size: 1rem;
}
.input:focus {
  outline: none;
  border-color: var(--color-focus, #3b82f6);
}
.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  background: var(--color-primary, #3b82f6);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}
.btn:hover {
  opacity: 0.9;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: var(--color-bg, #f8fafc);
  margin-bottom: 0.5rem;
}
.text {
  flex: 1;
  word-break: break-word;
}
.btn-delete {
  flex-shrink: 0;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-muted, #64748b);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.btn-delete:hover {
  background: #fee2e2;
  color: #b91c1c;
}
.empty {
  color: var(--color-muted, #64748b);
  font-size: 0.875rem;
  margin: 0;
}
.status {
  color: var(--color-muted, #64748b);
  font-size: 0.875rem;
  margin: 0;
}
.status.error {
  color: #b91c1c;
}
</style>
