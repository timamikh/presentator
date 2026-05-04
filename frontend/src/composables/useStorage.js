import { ref, computed } from 'vue'
import client from '../api/client'

// Centralized state for the storage view: folders tree, current folder selection,
// list of attachments in the current folder, and CRUD helpers. Both StorageView
// and StoragePicker use this composable so they share semantics (and a single source
// of truth per usage if used as a singleton — here each call creates a new instance,
// which is intentional: the picker must not affect the storage page state).
export function useStorage() {
  const folders = ref([])
  const attachments = ref([])
  // null = root level, 'all' = whole library (search), otherwise UUID
  const currentFolderId = ref(null)
  const searchQuery = ref('')
  const kindFilter = ref('')
  const loading = ref(false)
  const error = ref('')

  const folderById = computed(() => {
    const map = new Map()
    for (const f of folders.value) map.set(f.id, f)
    return map
  })

  // Builds an in-memory tree from a flat list of folders.
  const folderTree = computed(() => {
    const byParent = new Map()
    for (const f of folders.value) {
      const key = f.parent_folder_id || '__root__'
      if (!byParent.has(key)) byParent.set(key, [])
      byParent.get(key).push(f)
    }
    function build(parentKey) {
      const children = byParent.get(parentKey) || []
      return children
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .map((f) => ({ ...f, children: build(f.id) }))
    }
    return build('__root__')
  })

  const breadcrumbs = computed(() => {
    if (!currentFolderId.value || currentFolderId.value === 'all') return []
    const path = []
    let cursor = folderById.value.get(currentFolderId.value)
    const guard = new Set()
    while (cursor && !guard.has(cursor.id)) {
      path.unshift(cursor)
      guard.add(cursor.id)
      cursor = cursor.parent_folder_id ? folderById.value.get(cursor.parent_folder_id) : null
    }
    return path
  })

  async function loadFolders() {
    const { data } = await client.get('/folders')
    folders.value = data
  }

  async function loadAttachments() {
    const params = {}
    if (currentFolderId.value === 'all') params.folderId = 'all'
    else if (currentFolderId.value) params.folderId = currentFolderId.value
    else params.folderId = 'root'
    if (searchQuery.value.trim()) params.q = searchQuery.value.trim()
    if (kindFilter.value) params.kind = kindFilter.value

    const { data } = await client.get('/attachments', { params })
    attachments.value = data
  }

  async function refresh() {
    loading.value = true
    error.value = ''
    try {
      await Promise.all([loadFolders(), loadAttachments()])
    } catch (e) {
      error.value = e.response?.data?.error || 'Не удалось загрузить хранилище'
    } finally {
      loading.value = false
    }
  }

  async function selectFolder(folderId) {
    currentFolderId.value = folderId
    searchQuery.value = ''
    kindFilter.value = ''
    await loadAttachments()
  }

  async function createFolder(name, parentId = null) {
    const { data } = await client.post('/folders', { name, parentId })
    folders.value.push(data)
    return data
  }

  async function renameFolder(id, name) {
    const { data } = await client.patch(`/folders/${id}`, { name })
    const idx = folders.value.findIndex((f) => f.id === id)
    if (idx !== -1) folders.value[idx] = data
    return data
  }

  async function moveFolder(id, parentId) {
    const { data } = await client.patch(`/folders/${id}`, { parentId })
    const idx = folders.value.findIndex((f) => f.id === id)
    if (idx !== -1) folders.value[idx] = data
    return data
  }

  async function deleteFolder(id, force = false) {
    await client.delete(`/folders/${id}`, { params: force ? { force: true } : {} })
    folders.value = folders.value.filter((f) => f.id !== id)
    if (currentFolderId.value === id) {
      currentFolderId.value = null
      await loadAttachments()
    } else if (force) {
      // children may now be re-parented; reload tree to be safe
      await loadFolders()
      await loadAttachments()
    }
  }

  async function uploadAttachment(file, { folderId, description } = {}) {
    const fd = new FormData()
    fd.append('file', file)
    if (folderId) fd.append('folderId', folderId)
    if (description) fd.append('description', description)
    const { data } = await client.post('/attachments', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    attachments.value.unshift(data)
    return data
  }

  async function updateAttachment(id, patch) {
    const { data } = await client.patch(`/attachments/${id}`, patch)
    const idx = attachments.value.findIndex((a) => a.id === id)
    if (idx !== -1) attachments.value[idx] = data
    return data
  }

  async function deleteAttachment(id, force = false) {
    await client.delete(`/attachments/${id}`, { params: force ? { force: true } : {} })
    attachments.value = attachments.value.filter((a) => a.id !== id)
  }

  // Helpers for the picker / preview integrations.
  function attachmentPreviewUrl(attachmentId) {
    const token = localStorage.getItem('token') || ''
    return `/api/files/attachment/${attachmentId}?token=${encodeURIComponent(token)}`
  }

  return {
    folders,
    attachments,
    currentFolderId,
    searchQuery,
    kindFilter,
    loading,
    error,
    folderById,
    folderTree,
    breadcrumbs,
    loadFolders,
    loadAttachments,
    refresh,
    selectFolder,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    uploadAttachment,
    updateAttachment,
    deleteAttachment,
    attachmentPreviewUrl,
  }
}
