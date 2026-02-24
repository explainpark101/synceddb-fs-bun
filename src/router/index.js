import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'memo',
      component: () => import('../views/Memo.vue'),
      meta: { title: '메모장' },
    },
  ],
});

export default router;
