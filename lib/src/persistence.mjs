// round-table 持久化：状态文件 <dshHome>/data/round-table/state.json（原子写 + 防抖）。
// 状态结构：{ roles: [], rooms: [] }。读写失败不阻塞插件（状态仅本次运行有效）。
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const DATA_DIR_NAME = 'round-table'
export const STATE_FILENAME = 'state.json'

/** 归一化宿主注入的 home 值：新版 dsh 注入函数 dshHomePath(...segments)（无参调用返回 home），
 * 旧版注入字符串；统一返回字符串，保证 path.join 始终收到 string。函数调用失败返回 undefined。 */
function homeString(home) {
  if (typeof home !== 'function') return home
  try { return home() } catch { return undefined }
}

export function stateFilePath(dshHome) {
  return join(homeString(dshHome) ?? '', 'data', DATA_DIR_NAME, STATE_FILENAME)
}

/** 读取并归一化已保存状态；缺失/损坏返回 null。 */
export function loadState(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof raw !== 'object' || raw === null) return null
    return {
      roles: Array.isArray(raw.roles) ? raw.roles : [],
      rooms: Array.isArray(raw.rooms) ? raw.rooms : [],
    }
  } catch {
    return null
  }
}

/** 原子写：同目录 .tmp + rename；失败写入 /tmp 诊断日志（不阻塞插件）。 */
export function saveState(file, state) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(state), 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    try {
      writeFileSync('/tmp/round-table-persist.log', `${new Date().toISOString()} saveState FAIL file=${file} err=${String(error?.message ?? error)}\n`, { flag: 'a' })
    } catch { /* 诊断日志也失败则静默 */ }
  }
}
