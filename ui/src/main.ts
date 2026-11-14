import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
// 主题：三态偏好（跟随系统 / 浅色 / 深色），见 api/theme 与 stores/config
import { activateTheme, readThemePreference } from './api/theme';
// Token 唯一引入点（design-tokens.css 生成自 design-tokens.json，禁手改）
import './styles/design-tokens.css';
import './styles/base.css';

/**
 * 主题首装（DESIGN.md §4.2 / §9.1）：
 * config 是异步取的，若等它回来再上色，固定深色的用户开机时会先闪一帧浅色（默认
 * :root 是浅色）。所以先读 localStorage 镜像同步应用一次，config 加载完成后由
 * `stores/config.ts` 的 `load()` 按真实值重应用（那里会先停掉这条监听）。
 */
activateTheme(readThemePreference());

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
