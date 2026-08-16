// round-table 配置（L1 体验层）。零依赖：plain 默认值 + 轻量校验。
// 宿主 settings 服务可注册该命名空间；注册失败（如重复注册/headless 缺失）回退 DEFAULTS。
export const NAMESPACE = 'round-table'

export const DEFAULTS = {
  enabled: true,          // 网页端渲染开关
  maxRounds: 5,           // 默认最大讨论轮数（1–20，防死循环硬上限）
  defaultMode: 'manual',  // 房间默认发言模式：manual | all | chain
  pauseOnPageLeave: true, // 页面离开默认暂停（D2）；false = 后台继续
  pollMs: 3000,           // client 状态轮询间隔（SSE 断线兜底）
}

export function normalizeConfig(input) {
  const cfg = { ...DEFAULTS, ...(input ?? {}) }
  if (typeof cfg.enabled !== 'boolean') cfg.enabled = DEFAULTS.enabled
  if (!Number.isSafeInteger(cfg.maxRounds) || cfg.maxRounds < 1) cfg.maxRounds = DEFAULTS.maxRounds
  if (cfg.maxRounds > 20) cfg.maxRounds = 20
  if (!['manual', 'all', 'chain'].includes(cfg.defaultMode)) cfg.defaultMode = DEFAULTS.defaultMode
  if (typeof cfg.pauseOnPageLeave !== 'boolean') cfg.pauseOnPageLeave = DEFAULTS.pauseOnPageLeave
  if (!Number.isSafeInteger(cfg.pollMs) || cfg.pollMs < 500) cfg.pollMs = DEFAULTS.pollMs
  return cfg
}
