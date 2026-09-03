import { motion } from 'motion/react';
import { useState } from 'react';

interface SystemSettingsProps {
  readonly authenticationMode: 'none' | 'password';
  readonly onChangePassword: (input: {
    readonly currentPassword: string;
    readonly newPassword: string;
  }) => Promise<{ readonly credentialGeneration: number }>;
  readonly onLogout: () => Promise<void>;
}

export function SystemSettings({
  authenticationMode,
  onChangePassword,
  onLogout,
}: SystemSettingsProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState('');

  return (
    <motion.main
      className="studio2-page studio2-settings-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="studio2-breadcrumb" aria-label="当前位置">
        <span>系统</span>
        <i>/</i>
        <b>安全与运行</b>
      </div>
      <header className="studio2-settings-heading">
        <p>SYSTEM</p>
        <h1>系统设置</h1>
        <span>
          {authenticationMode === 'password'
            ? '管理 Owner 凭据和 Studio 本身。站点资料留在“站点”对象中。'
            : '当前为本地优先的无密码模式。站点资料留在“站点”对象中。'}
        </span>
      </header>

      <div className="studio2-settings-grid">
        <section className="studio2-settings-intro">
          <span className="studio2-settings-icon" aria-hidden="true">
            ◌
          </span>
          <h2>
            {authenticationMode === 'password' ? 'Owner 安全' : '访问方式'}
          </h2>
          {authenticationMode === 'password' ? (
            <>
              <p>
                修改密码会轮换凭据版本，并使其他已登录会话立即失效。CLI
                重置仍然是无法登录时的可信恢复入口。
              </p>
              <code>pnpm --filter @blog-studio/studio auth reset</code>
            </>
          ) : (
            <p>
              Studio
              不要求登录。局域网内能访问此地址的人也能使用编辑功能；如需保护，请将
              <code>BLOG_STUDIO_AUTH_MODE=password</code> 并初始化 Owner 密码。
            </p>
          )}
        </section>

        {authenticationMode === 'password' ? (
          <form
            className="studio2-security-form"
            onSubmit={(event) => {
              event.preventDefault();
              setMessage('');
              if (newPassword !== confirmPassword) {
                setState('error');
                setMessage('两次输入的新密码不一致');
                return;
              }
              setState('saving');
              void onChangePassword({ currentPassword, newPassword })
                .then(({ credentialGeneration }) => {
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setState('saved');
                  setMessage(
                    `密码已更新（凭据版本 ${credentialGeneration}），其他会话已退出`,
                  );
                })
                .catch((reason: unknown) => {
                  setState('error');
                  setMessage(
                    reason instanceof Error ? reason.message : '密码更新失败',
                  );
                });
            }}
          >
            <label>
              当前密码
              <input
                autoComplete="current-password"
                required
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              新密码
              <input
                autoComplete="new-password"
                minLength={12}
                required
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              确认新密码
              <input
                autoComplete="new-password"
                minLength={12}
                required
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {message ? (
              <p
                className={`studio2-form-message is-${state}`}
                role={state === 'error' ? 'alert' : 'status'}
              >
                {message}
              </p>
            ) : null}
            <div className="studio2-form-actions">
              <button
                className="studio2-prepare-button"
                disabled={state === 'saving'}
                type="submit"
              >
                {state === 'saving' ? '正在更新…' : '更新密码'}
              </button>
              <button
                className="studio2-quiet-danger"
                type="button"
                onClick={() => void onLogout()}
              >
                退出登录
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </motion.main>
  );
}
