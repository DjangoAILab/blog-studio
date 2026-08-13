import { motion } from 'motion/react';

import type { PreviewFallbackReason } from '../../app/api.js';

type PreviewMode = 'markdown' | 'enhanced';

const fallbackMessages: Readonly<Record<PreviewFallbackReason, string>> = {
  'missing-output': '主题没有生成当前文章页，已自动回到 Markdown 预览。',
  'route-error': '主题路由未返回当前文章，已自动回到 Markdown 预览。',
  'build-error': '站点生成器运行失败，已自动回到 Markdown 预览。',
  timeout: '站点生成器响应超时，已自动回到 Markdown 预览。',
  'unsupported-engine': '当前引擎不支持主题预览，Markdown 预览仍可用。',
  canceled: '主题预览已取消，Markdown 预览仍可用。',
  restart: '主题预览因服务重启中断，Markdown 预览仍可用。',
};

interface PreviewPaneProps {
  readonly enhancedAvailable: boolean;
  readonly error?: string | undefined;
  readonly fallback?: PreviewFallbackReason | undefined;
  readonly mode: PreviewMode;
  readonly state: 'idle' | 'building' | 'ready' | 'error';
  readonly url?: string | undefined;
  readonly onClose: () => void;
  readonly onPreview: (mode: PreviewMode) => void;
}

export function PreviewPane({
  enhancedAvailable,
  error,
  fallback,
  mode,
  state,
  url,
  onClose,
  onPreview,
}: PreviewPaneProps) {
  return (
    <section className="studio3-preview" aria-label="文章预览">
      <div className="studio3-preview-intro">
        <header className="studio3-preview-header">
          <div>
            <p>PREVIEW</p>
            <h2>全文预览</h2>
          </div>
          <div className="studio3-preview-controls">
            <button
              className="studio3-preview-back"
              type="button"
              onClick={onClose}
            >
              ← 返回编辑
            </button>
            <div className="studio3-preview-modes" aria-label="预览方式">
              <button
                aria-pressed={mode === 'markdown'}
                className={mode === 'markdown' ? 'is-active' : ''}
                type="button"
                onClick={() => onPreview('markdown')}
              >
                Markdown
              </button>
              <button
                aria-pressed={mode === 'enhanced'}
                className={mode === 'enhanced' ? 'is-active' : ''}
                disabled={!enhancedAvailable}
                title={
                  enhancedAvailable
                    ? '使用站点生成器和真实主题'
                    : '当前站点不支持主题预览'
                }
                type="button"
                onClick={() => onPreview('enhanced')}
              >
                站点主题
              </button>
            </div>
          </div>
        </header>

        {fallback ? (
          <p className="studio3-preview-fallback" role="status">
            <span aria-hidden="true">↘</span>
            {fallbackMessages[fallback]}
          </p>
        ) : null}
      </div>

      <div className="studio3-preview-canvas">
        {url && state === 'ready' ? (
          <motion.iframe
            animate={{ opacity: 1, scale: 1 }}
            initial={{ opacity: 0, scale: 0.995 }}
            sandbox=""
            src={url}
            title="文章全文预览"
          />
        ) : (
          <div
            className={`studio3-preview-state is-${state}`}
            aria-live="polite"
          >
            {state === 'building' ? (
              <span className="studio2-loading-orb" />
            ) : (
              <span className="studio3-preview-glyph" aria-hidden="true">
                {state === 'error' ? '!' : '◫'}
              </span>
            )}
            <h3>
              {state === 'building'
                ? mode === 'enhanced'
                  ? '正在启动主题预览，可能需要一会儿'
                  : '正在渲染 Markdown'
                : state === 'error'
                  ? '预览暂时不可用'
                  : '先看一遍完整文章'}
            </h3>
            <p>
              {state === 'error'
                ? error
                : state === 'building'
                  ? mode === 'enhanced'
                    ? '只有生成目标真实响应并包含会话标记后，才会在这里显示。'
                    : '本地安全渲染不依赖站点生成器。'
                  : 'Markdown 预览始终可用；站点主题是经过验证的增强能力。'}
            </p>
            {state === 'idle' || state === 'error' ? (
              <button type="button" onClick={() => onPreview('markdown')}>
                打开 Markdown 预览
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
