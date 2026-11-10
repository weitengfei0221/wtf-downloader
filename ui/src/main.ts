import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
// 主题：深色优先跟随系统；Tauri 主题事件源就绪后接管（api/theme 预留接口）
import { watchSystemTheme, watchTauriTheme } from './api/theme';
// Token 唯一引入点（design-tokens.css 生成自 design-tokens.json，禁手改）
import './styles/design-tokens.css';
import './styles/base.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');

// 主题装配：先挂系统 prefers-color-scheme 监听写 data-theme；
// Tauri 主题事件可用时切换为 Tauri 事件源（DESIGN.md §9.1）
const stopSystemTheme = watchSystemTheme();
void watchTauriTheme().then((unlisten) => {
  if (unlisten) stopSystemTheme();
});
