<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const isLoggedIn = computed(() => !!localStorage.getItem('token'))

function logout() {
  localStorage.removeItem('token')
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <nav
      v-if="isLoggedIn"
      class="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm"
    >
      <div class="flex items-center gap-6">
        <router-link to="/" class="text-xl font-bold text-blue-600 tracking-tight">
          &#127912; Presentator
        </router-link>
        <div class="flex items-center gap-3 text-sm">
          <router-link
            to="/"
            class="text-gray-600 hover:text-gray-900"
            active-class="text-gray-900 font-semibold"
          >
            Презентации
          </router-link>
          <router-link
            to="/storage"
            class="text-gray-600 hover:text-gray-900"
            active-class="text-gray-900 font-semibold"
          >
            Хранилище
          </router-link>
          <router-link
            to="/create"
            class="text-gray-600 hover:text-gray-900"
            active-class="text-gray-900 font-semibold"
          >
            Создать
          </router-link>
        </div>
      </div>
      <button @click="logout" class="text-sm text-gray-500 hover:text-red-500 transition-colors cursor-pointer">
        Выйти
      </button>
    </nav>
    <main class="flex-1">
      <router-view />
    </main>
  </div>
</template>
