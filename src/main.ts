import { createApp } from 'vue'
import { init } from '@neutralinojs/lib'
import App from './App.vue'
import './styles.css'

if (typeof window.NL_PATH === 'string') init()
createApp(App).mount('#app')
