import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { now } from '../utils.js';

export const SETTING_KEYS = ['siteName', 'siteDescription', 'registrationMode', 'maxUploadBytes', 'sessionDays', 'trashRetentionDays', 'maxVersionsPerResource', 'defaultShareRole', 'defaultRequireApproval', 'allowAnonymousShareView'] as const;
export type SettingKey = typeof SETTING_KEYS[number];

type ValueKind = 'string' | 'number' | 'boolean';

interface SettingDefinition {
  key: SettingKey;
  label: string;
  group: '站点信息' | '账号与注册' | '内容与存储' | '分享与权限';
  description: string;
  kind: ValueKind;
  envFallback: () => string | number | boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: { value: string; label: string }[];
  unit?: string;
}

export const settingDefinitions: SettingDefinition[] = [
  { key: 'siteName', label: '站点名称', group: '站点信息', description: '展示在登录页和工作台标题中', kind: 'string', envFallback: () => 'Together Docs', maxLength: 60 },
  { key: 'siteDescription', label: '站点简介', group: '站点信息', description: '用于登录页说明，不会对外公开索引', kind: 'string', envFallback: () => '私有化协作文档平台', maxLength: 300 },
  { key: 'registrationMode', label: '注册方式', group: '账号与注册', description: '邀请制：仅凭站长发放的邀请链接注册；关闭注册：邀请链接也不可用于注册', kind: 'string', envFallback: () => 'invite', options: [{ value: 'invite', label: '邀请注册' }, { value: 'closed', label: '关闭注册' }] },
  { key: 'sessionDays', label: '会话有效期', group: '账号与注册', description: '新登录会话的有效天数，修改后对已有会话不生效', kind: 'number', envFallback: () => config.sessionDays, min: 1, max: 365, unit: '天' },
  { key: 'maxUploadBytes', label: '上传大小上限', group: '内容与存储', description: `单个文件的最大字节数，不能超过启动环境变量 MAX_UPLOAD_BYTES（当前 ${config.maxUploadBytes} 字节）`, kind: 'number', envFallback: () => config.maxUploadBytes, min: 1, max: config.maxUploadBytes, unit: '字节' },
  { key: 'trashRetentionDays', label: '回收站保留天数', group: '内容与存储', description: '超过该天数的回收站资源会在执行数据清理时被永久删除', kind: 'number', envFallback: () => 30, min: 1, max: 3650, unit: '天' },
  { key: 'maxVersionsPerResource', label: '历史版本保留数', group: '内容与存储', description: '每个资源保留的版本数量，执行清理时裁剪，始终保留最新版本', kind: 'number', envFallback: () => 100, min: 1, max: 10000, unit: '个' },
  { key: 'defaultShareRole', label: '分享默认角色', group: '分享与权限', description: '创建分享链接时使用的默认申请角色', kind: 'string', envFallback: () => 'viewer', options: [{ value: 'viewer', label: '浏览者' }, { value: 'commenter', label: '评论者' }, { value: 'editor', label: '编辑者' }] },
  { key: 'defaultRequireApproval', label: '分享申请需审批', group: '分享与权限', description: '新建分享链接默认是否需要管理员审批', kind: 'boolean', envFallback: () => true },
  { key: 'allowAnonymousShareView', label: '允许匿名查看分享内容', group: '分享与权限', description: '关闭时未登录用户只能看到资源名称与登录提示', kind: 'boolean', envFallback: () => false },
];

const definitions = new Map(settingDefinitions.map(item => [item.key, item]));

export function parseSetting(definition: SettingDefinition, input: unknown) {
  if (definition.kind === 'boolean') {
    if (typeof input !== 'boolean') throw Object.assign(new Error(`${definition.key} 必须是布尔值`), { statusCode: 400 });
    return String(input);
  }
  if (definition.kind === 'number') {
    if (typeof input !== 'number' || !Number.isInteger(input) || input < definition.min! || input > definition.max!) {
      throw Object.assign(new Error(`${definition.key} 应为 ${definition.min}–${definition.max} 之间的整数`), { statusCode: 400 });
    }
    return String(input);
  }
  if (typeof input !== 'string' || input.length > definition.maxLength!) {
    throw Object.assign(new Error(`${definition.key} 文本无效或过长`), { statusCode: 400 });
  }
  if (definition.options && !definition.options.some(option => option.value === input)) {
    throw Object.assign(new Error(`${definition.key} 取值无效`), { statusCode: 400 });
  }
  return input;
}

export function siteSettings(): Record<SettingKey, string | number | boolean> {
  const rows = db.select().from(schema.siteSettings).all();
  const stored = new Map(rows.map(row => [row.key, row.value]));
  const result = {} as Record<SettingKey, string | number | boolean>;
  for (const definition of settingDefinitions) {
    const raw = stored.get(definition.key);
    if (raw === undefined) { result[definition.key] = definition.envFallback(); continue; }
    if (definition.kind === 'number') {
      const parsed = Number(raw);
      // 备份恢复或环境变量变更后，已存值可能越界；按当前定义裁剪，始终返回有效数值。
      result[definition.key] = Number.isFinite(parsed) && Number.isInteger(parsed)
        ? Math.min(definition.max!, Math.max(definition.min!, parsed))
        : definition.envFallback() as number;
    } else if (definition.kind === 'boolean') result[definition.key] = raw === 'true';
    else if (definition.options && !definition.options.some(option => option.value === raw)) result[definition.key] = definition.envFallback() as string;
    else if (raw.length > (definition.maxLength || 300)) result[definition.key] = definition.envFallback() as string;
    else result[definition.key] = raw;
  }
  return result;
}

export function effectiveMaxUploadBytes() { return siteSettings().maxUploadBytes as number; }
export function effectiveSessionDays() { return siteSettings().sessionDays as number; }

export function updateSiteSettings(patch: Record<string, unknown>) {
  const entries = Object.entries(patch);
  if (!entries.length) throw Object.assign(new Error('没有需要更新的配置'), { statusCode: 400 });
  const normalized = entries.map(([key, value]) => {
    const definition = definitions.get(key as SettingKey);
    if (!definition) throw Object.assign(new Error(`未知配置项：${key}`), { statusCode: 400 });
    return { key: definition.key, value: parseSetting(definition, value), updatedAt: now() };
  });
  db.transaction(tx => {
    for (const item of normalized) {
      tx.insert(schema.siteSettings).values(item).onConflictDoUpdate({ target: schema.siteSettings.key, set: { value: item.value, updatedAt: item.updatedAt } }).run();
    }
  });
  return siteSettings();
}
