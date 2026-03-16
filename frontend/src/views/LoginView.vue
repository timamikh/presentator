<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import client from '../api/client'

const router = useRouter()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    const { data } = await client.post('/auth/login', {
      email: email.value,
      password: password.value
    })
    localStorage.setItem('token', data.token)
    router.push('/')
  } catch (err) {
    error.value = err.response?.data?.error || 'Ошибка авторизации. Проверьте данные.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <div class="bg-white rounded-2xl shadow-lg p-8">
        <div class="text-center mb-8">
          <div class="text-5xl mb-3">&#127912;</div>
          <h1 class="text-2xl font-bold text-gray-900">Presentator</h1>
          <p class="text-sm text-gray-500 mt-1">Генератор презентаций</p>
        </div>

        <form @submit.prevent="handleLogin" class="space-y-4">
          <div>
            <label for="email" class="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              v-model="email"
              type="email"
              required
              placeholder="user@example.com"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>

          <div>
            <label for="password" class="block text-sm font-medium text-gray-700 mb-1">
              Пароль
            </label>
            <input
              id="password"
              v-model="password"
              type="password"
              required
              placeholder="••••••••"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>

          <div v-if="error" class="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {{ error }}
          </div>

          <button
            type="submit"
            :disabled="loading"
            class="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span v-if="loading">Вход...</span>
            <span v-else>Войти</span>
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
