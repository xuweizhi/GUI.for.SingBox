import { type RouteRecordRaw } from 'vue-router'

import HomeView from '@/views/HomeView/index.vue'
import LoginView from '@/views/LoginView/index.vue'
import NetCheckView from '@/views/NetCheckView/index.vue'
import NodeGroupsView from '@/views/NodeGroupsView/index.vue'
import PluginsView from '@/views/PluginsView/index.vue'
import ProfilesView from '@/views/ProfilesView/index.vue'
import RulesetsView from '@/views/RulesetsView/index.vue'
import ScheduledTasksView from '@/views/ScheduledTasksView/index.vue'
import SettingsView from '@/views/SettingsView/index.vue'
import SubscribesView from '@/views/SubscribesView/index.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: LoginView,
    meta: {
      name: 'auth.title',
      public: true,
      hidden: true,
    },
  },
  {
    path: '/',
    name: 'Overview',
    component: HomeView,
    meta: {
      name: 'router.overview',
      icon: 'overview',
      group: 'control',
    },
  },
  {
    path: '/netcheck',
    name: 'NetCheck',
    component: NetCheckView,
    meta: {
      name: 'router.netcheck',
      icon: 'speedTest',
      group: 'control',
    },
  },
  {
    path: '/profiles',
    name: 'Profiles',
    component: ProfilesView,
    meta: {
      name: 'router.profiles',
      icon: 'profiles',
      group: 'config',
    },
  },
  {
    path: '/subscriptions',
    name: 'Subscriptions',
    component: SubscribesView,
    meta: {
      name: 'router.subscriptions',
      icon: 'subscriptions',
      group: 'config',
    },
  },
  {
    path: '/node-groups',
    name: 'NodeGroups',
    component: NodeGroupsView,
    meta: {
      name: 'router.nodeGroups',
      icon: 'folder',
      group: 'config',
      hidden: false,
    },
  },
  {
    path: '/rulesets',
    name: 'Rulesets',
    component: RulesetsView,
    meta: {
      name: 'router.rulesets',
      icon: 'rulesets',
      group: 'config',
    },
  },
  {
    path: '/plugins',
    name: 'Plugins',
    component: PluginsView,
    meta: {
      name: 'router.plugins',
      icon: 'plugins',
      group: 'system',
    },
  },
  {
    path: '/scheduledtasks',
    name: 'ScheduledTasks',
    component: ScheduledTasksView,
    meta: {
      name: 'router.scheduledtasks',
      icon: 'scheduledTasks',
      group: 'system',
    },
  },
  {
    path: '/settings',
    name: 'Settings',
    component: SettingsView,
    meta: {
      name: 'router.settings',
      icon: 'settings2',
      group: 'system',
      hidden: false,
    },
  },
]

export default routes
