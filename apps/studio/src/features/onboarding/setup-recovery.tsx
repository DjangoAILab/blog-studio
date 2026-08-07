import type { StudioSetupStatus } from '@blog-studio/core';
import { motion } from 'motion/react';

interface SetupRecoveryProps {
  readonly status?: StudioSetupStatus | undefined;
  readonly error?: string | undefined;
  readonly retrying: boolean;
  readonly onRetry: () => void;
}

export function SetupRecovery({
  status,
  error,
  retrying,
  onRetry,
}: SetupRecoveryProps) {
  const credentialsReady = status?.credentials.state === 'ready';
  const configurationValid = status?.configuration.state === 'valid';
  const siteReady = status?.site.state === 'registered';

  return (
    <motion.main
      className="studio2-setup-recovery"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      <section className="studio2-setup-recovery-card">
        <p>TRUSTED-HOST RECOVERY</p>
        <h1>Studio 尚未准备好。</h1>
        <span>
          这里仅显示安全的状态和下一步。配置路径、解析错误与凭据不会进入浏览器。
        </span>

        <ol aria-label="首次运行状态">
          <li className={credentialsReady ? 'is-ready' : 'is-action'}>
            <i>{credentialsReady ? '✓' : '1'}</i>
            <div>
              <b>
                {credentialsReady ? 'Owner 凭据已就绪' : '需要设置 Owner 密码'}
              </b>
              <small>
                {credentialsReady
                  ? '浏览器登录入口已经启用。'
                  : '请在部署主机的可信终端完成首次所有权设置。'}
              </small>
              {!credentialsReady ? (
                <code>pnpm --filter @blog-studio/studio auth init</code>
              ) : null}
            </div>
          </li>
          <li className={configurationValid ? 'is-ready' : 'is-error'}>
            <i>{configurationValid ? '✓' : '!'}</i>
            <div>
              <b>{configurationValid ? '站点配置有效' : '站点配置需要修复'}</b>
              <small>
                {configurationValid
                  ? '允许的配置已通过校验。'
                  : '检查 BLOG_STUDIO_CONFIG_PATHS 指向的 YAML；修复后重启 Studio。'}
              </small>
            </div>
          </li>
          <li className={siteReady ? 'is-ready' : 'is-pending'}>
            <i>{siteReady ? '✓' : '3'}</i>
            <div>
              <b>{siteReady ? '站点已经注册' : '等待添加站点'}</b>
              <small>
                {!configurationValid
                  ? '配置恢复后才会开放站点发现。'
                  : '登录后通过站点发现确认要管理的博客。'}
              </small>
            </div>
          </li>
        </ol>

        {error ? (
          <p className="studio2-setup-retry-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <span>
            修复操作只在可信主机完成，浏览器不能领取所有权或改写配置。
          </span>
          <button disabled={retrying} type="button" onClick={onRetry}>
            {retrying ? '正在重新检查…' : '重新检查状态'}
          </button>
        </footer>
      </section>
    </motion.main>
  );
}
