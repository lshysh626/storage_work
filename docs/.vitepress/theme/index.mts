import DefaultTheme from 'vitepress/theme'
import './style.css'
import { onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vitepress'

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute()
    
    if (typeof window !== 'undefined') {
      const initResizer = () => {
        const sidebar = document.querySelector('.VPSidebar') as HTMLElement;
        if (!sidebar || document.querySelector('.sidebar-resizer')) return;

        const resizer = document.createElement('div');
        resizer.className = 'sidebar-resizer';
        sidebar.appendChild(resizer);

        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
          isResizing = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none'; // 드래그 중 텍스트 선택 방지
        });

        document.addEventListener('mousemove', (e) => {
          if (!isResizing) return;
          const newWidth = e.clientX;
          // 최소 200px, 최대 600px까지만 조절 가능
          if (newWidth > 200 && newWidth < 600) {
            document.documentElement.style.setProperty('--vp-sidebar-width', `${newWidth}px`);
          }
        });

        document.addEventListener('mouseup', () => {
          isResizing = false;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        });
      };

      onMounted(() => {
        initResizer();
      });

      watch(() => route.path, () => {
        nextTick(() => {
          initResizer();
        });
      });
    }
  }
}
