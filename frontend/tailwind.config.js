/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      /* ─── 圆角：把 Tailwind 的档位映射到三档 token ───
       *
       * 组件里原本混着 rounded-lg(8) / rounded-xl(12) / rounded-2xl(16)，
       * 同一屏能看到三种以上圆角的卡片，显得随意。
       *
       * 这里**在配置层收敛**，而不是去改几百处类名：
       *   rounded-md / lg  → 6px   控件（按钮、输入框、小标签）
       *   rounded-xl / 2xl → 10px  卡片
       *   rounded-3xl      → 14px  外层容器
       *
       * 改这里等于全站生效，组件一个字都不用动。rounded-full 不受影响。
       */
      borderRadius: {
        md: 'var(--r-1)',
        lg: 'var(--r-1)',
        xl: 'var(--r-2)',
        '2xl': 'var(--r-2)',
        '3xl': 'var(--r-3)',
      },

      /* ─── 阴影：原来 shadow-sm 几乎是 0，卡片层级只能靠边框 ─── */
      boxShadow: {
        sm: 'var(--shadow-1)',
        DEFAULT: 'var(--shadow-1)',
        md: 'var(--shadow-2)',
      },

      /* ─── 过渡曲线：让不带参数的 transition 也走统一曲线 ─── */
      transitionTimingFunction: {
        DEFAULT: 'var(--ease)',
      },
      transitionDuration: {
        DEFAULT: 'var(--dur)',
      },
    },
  },
  plugins: [],
}
