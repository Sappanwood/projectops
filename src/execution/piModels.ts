import path from 'node:path';
import type { ModelRef } from './models.js';

export async function createPiModelRuntime() {
  const { ModelRuntime, getAgentDir } = await import('@earendil-works/pi-coding-agent');
  const agentDir = getAgentDir();
  return ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: path.join(agentDir, 'models.json') });
}

export async function listPiModels() {
  const runtime = await createPiModelRuntime();
  if (runtime.getError()) throw new Error('Pi 模型配置读取失败，请检查本地 Pi 配置后刷新。');
  return (await runtime.getAvailable()).map(({ provider, id, name }) => ({ provider, id, name }));
}

export async function resolvePiModel(repo: string, selected?: ModelRef): Promise<ModelRef> {
  const modelRuntime = await createPiModelRuntime();
  if (selected) {
    if (!(await modelRuntime.getAvailable()).some(m => m.provider === selected.provider && m.id === selected.id))
      throw new Error('所选模型不可用，请在本地 Pi 完成认证后刷新。');
    return { ...selected };
  }
  const { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent');
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(repo, agentDir);
  if (settingsManager.drainErrors().length) throw new Error('Pi 配置读取失败，请检查本地 Pi 配置。');
  const resourceLoader = new DefaultResourceLoader({ cwd: repo, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ cwd: repo, agentDir, settingsManager, modelRuntime,
    resourceLoader, tools: [], sessionManager: SessionManager.inMemory() });
  try {
    if (!session.model) throw new Error('没有可用模型，请在本地 Pi 完成认证后刷新。');
    return { provider: session.model.provider, id: session.model.id };
  } finally { session.dispose(); }
}
