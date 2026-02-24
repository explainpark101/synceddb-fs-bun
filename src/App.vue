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
import { Share2, Github } from 'lucide-vue-next';

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

async function onShareClick() {
  let shareUrl = '';
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('server', getApiBase());
    url.searchParams.set('store', currentStore.value);
    shareUrl = url.toString();
    await navigator.clipboard.writeText(shareUrl);
    alert('공유 URL이 클립보드에 복사되었습니다.');
  } catch (e) {
    alert(
      shareUrl
        ? `URL 복사에 실패했습니다. 아래 링크를 수동으로 복사하세요.\n\n${shareUrl}`
        : 'URL 복사에 실패했습니다. 브라우저에서 수동으로 주소를 복사하세요.',
    );
  }
}

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
  <div class="max-w-lg mx-auto p-6 text-zinc-100 relative">
    <header class="mb-5 flex justify-between items-start gap-4">
      <div>
        <h1 class="text-2xl font-semibold mb-1 text-zinc-50">메모장</h1>
        <p class="text-sm text-zinc-500 m-0">SyncedDB · 로컬 저장 후 서버와 동기화</p>
      </div>
      <a
        href="https://github.com/explainpark101/synceddb-fs-bun/tree/main"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center select-none gap-2 shrink-0 p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        aria-label="GitHub 저장소"
        title="GitHub 저장소"
      >
        <Github class="size-6" />
        Backend Code
      </a>
    </header>
    <p v-if="loading" class="text-sm text-zinc-500 m-0">로딩 중…</p>
    <p v-else-if="error" class="text-sm text-rose-400 m-0">오류: {{ error }}</p>
    <template v-else>
    <div class="mb-5 p-3 rounded-lg bg-zinc-900 border border-zinc-700 relative">
      <div class="flex justify-end mb-3">
        <button
          type="button"
          class="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-emerald-600 text-white text-xs font-medium cursor-pointer hover:bg-emerald-500"
          @click="onShareClick"
        >
          <Share2 class="size-4" />
          공유 링크 복사
        </button>
      </div>
      <div class="space-y-3">
        <div>
          <label class="block text-xs text-zinc-400 mb-1">SyncedDB 서버 주소</label>
          <form class="flex gap-2" @submit.prevent="applyApiUrl">
            <input
              v-model="apiUrlInput"
              type="url"
              class="flex-1 min-w-0 py-1.5 px-2.5 border border-zinc-600 rounded-lg bg-zinc-800 text-zinc-200 text-sm placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              placeholder="http://localhost:3000"
              autocomplete="off"
            />
            <button type="submit" class="py-1.5 px-3 rounded-lg bg-emerald-600 text-white text-sm font-medium cursor-pointer hover:bg-emerald-500 shrink-0">적용</button>
          </form>
          <p v-if="apiUrlError" class="text-xs text-rose-400 mt-0.5 m-0">{{ apiUrlError }}</p>
          <p v-else class="text-xs text-zinc-500 mt-0.5 m-0">현재: {{ getApiBase() }}</p>
        </div>
        <div>
          <label class="block text-xs text-zinc-400 mb-1">스토어 이름</label>
          <form class="flex gap-2" @submit.prevent="applyStoreName">
            <input
              v-model="storeNameInput"
              type="text"
              class="flex-1 max-w-48 min-w-0 py-1.5 px-2.5 border border-zinc-600 rounded-lg bg-zinc-800 text-zinc-200 text-sm placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              placeholder="예: memos, todos"
              autocomplete="off"
            />
            <button type="submit" class="py-1.5 px-3 rounded-lg bg-emerald-600 text-white text-sm font-medium cursor-pointer hover:bg-emerald-500 shrink-0">적용</button>
          </form>
          <p v-if="storeError" class="text-xs text-rose-400 mt-0.5 m-0">{{ storeError }}</p>
          <p v-else class="text-xs text-zinc-500 mt-0.5 m-0">현재: {{ currentStore }}</p>
        </div>
      </div>
    </div>
    <div class="mb-5 p-3 rounded-lg bg-zinc-900 border border-zinc-700 flex flex-col gap-1">
      <button
        type="button"
        class="py-2 px-4 rounded-lg bg-emerald-600 text-white text-sm font-medium cursor-pointer hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="syncInProgress"
        @click="onSyncClick"
      >
        {{ syncInProgress ? '가져오는 중…' : 'Sync (서버에서 불러오기)' }}
      </button>
      <p v-if="syncError" class="text-sm text-rose-400 m-0">{{ syncError }}</p>
    </div>
    <form class="flex gap-2 mb-5" @submit.prevent="add">
      <input
        v-model="newText"
        type="text"
        class="flex-1 py-2 px-3 border border-zinc-600 rounded-lg bg-zinc-800 text-zinc-200 text-base placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        placeholder="메모 입력 후 Enter"
        autocomplete="off"
      />
      <button type="submit" class="py-2 px-4 rounded-lg bg-emerald-600 text-white text-sm font-medium cursor-pointer hover:bg-emerald-500">추가</button>
    </form>
    <ul v-if="memos.length" class="list-none m-0 p-0">
      <li v-for="m in memos" :key="m.id" class="flex items-center gap-2 py-2 px-3 rounded-lg bg-zinc-800 border border-zinc-700 mb-2">
        <span class="flex-1 wrap-break-word text-zinc-200">{{ m.text }}</span>
        <button type="button" class="shrink-0 w-7 h-7 border-0 rounded bg-transparent text-zinc-500 text-xl leading-none cursor-pointer p-0 hover:bg-rose-500/20 hover:text-rose-400" @click="remove(m.id)" aria-label="삭제">×</button>
      </li>
    </ul>
    <p v-else class="text-sm text-zinc-500 m-0">메모가 없습니다.</p>
    </template>
  </div>
</template>
