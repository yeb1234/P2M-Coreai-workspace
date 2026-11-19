import React from 'react';
import { Construction } from 'lucide-react';

/**
 * 「施工中」提示条。
 *
 * 用在 `dev: true` 的页面上（pageRegistry 里标了 17 个）。
 *
 * ## 为什么用横幅而不是侧边栏小圆点
 *
 * 侧边栏原来已经有个 1.5px 的状态点，但 24 个菜单里 13 个都带它 ——
 * 什么都标等于什么都没标，用户不会因为一个点就预期「这页可能不全」。
 * 所以侧边栏保留小点（成本低、扫描快），额外在这里给一条明确说明：
 * 进到页面里才知道「数据可能不完整」。
 *
 * 图标用 lucide 的 Construction（路障/栅栏），和用户提的「栅栏图标」一致。
 */
export const UnderConstructionBanner: React.FC<{ label?: string }> = ({ label }) => (
  <div
    role="status"
    className="mb-3 flex items-start gap-2 rounded-lg border border-dashed border-[var(--warn)]/50 bg-[var(--warn)]/8 px-3 py-2"
  >
    <Construction size={16} className="mt-0.5 shrink-0 text-[var(--warn)]" aria-hidden="true" />
    <div className="min-w-0">
      <p className="text-xs font-semibold text-[var(--text-primary)]">
        施工中{label ? `：${label}` : ''}
      </p>
      <p className="mt-0.5 text-[11px] leading-4 text-[var(--text-muted)]">
        这个页面的功能还没做完，数据可能不完整、交互可能变。用之前先当草稿看。
      </p>
    </div>
  </div>
);
