import { type IconType } from '@/components/Icon/index.vue'

declare module 'vue-router' {
  interface RouteMeta {
    name?: string
    icon?: IconType
    group?: 'control' | 'config' | 'system'
    hidden?: boolean
    public?: boolean
  }
}
