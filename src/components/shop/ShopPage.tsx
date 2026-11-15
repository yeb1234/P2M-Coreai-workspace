import React from 'react';
import { ShoppingCart, TrendingDown, Package, AlertTriangle, Truck, DollarSign, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_ORDERS = [
  { id: 'ORD-2024', customer: '张三', product: '机械键盘', amount: 399, status: '已发货', logistics: '顺丰 SF1234567' },
  { id: 'ORD-2025', customer: '李四', product: '显示器支架', amount: 128, status: '待发货', logistics: '-' },
  { id: 'ORD-2026', customer: '王五', product: 'USB-C扩展坞', amount: 259, status: '已签收', logistics: '圆通 YT9876543' },
  { id: 'ORD-2027', customer: '赵六', product: '鼠标垫', amount: 49, status: '退款中', logistics: '-' },
];

const MOCK_ALERTS = [
  { type: 'warning', msg: '商品「机械键盘 K8」库存不足 (剩 3 件)', time: '2小时前' },
  { type: 'error', msg: '订单 ORD-2027 申请退款，需处理', time: '4小时前' },
  { type: 'info', msg: '快递 SF1234567 已到达北京中转站', time: '6小时前' },
];

export const ShopPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle dev
        title="电商中心"
        subtitle="订单、库存、物流、售后一站式管理"
        icon={<ShoppingCart size={22} />}
      />

      {/* Stats */}
      <div className="auto-grid-cards">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--success)] mb-2">
            <DollarSign size={16} />
            <span className="text-xs font-medium">今日收入</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">¥12,580</p>
          <p className="text-xs text-[var(--success)] mt-1 flex items-center gap-1">
            <ArrowUpRight size={10} /> +15% vs 昨日
          </p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--danger)] mb-2">
            <TrendingDown size={16} />
            <span className="text-xs font-medium">今日支出</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">¥3,200</p>
          <p className="text-xs text-[var(--danger)] mt-1 flex items-center gap-1">
            <ArrowDownRight size={10} /> -5% vs 昨日
          </p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--info)] mb-2">
            <Package size={16} />
            <span className="text-xs font-medium">待发货</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">8 单</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">需尽快处理</p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[var(--warn)] mb-2">
            <AlertTriangle size={16} />
            <span className="text-xs font-medium">售后处理</span>
          </div>
          <p className="text-2xl font-bold text-[var(--text-primary)]">3 件</p>
          <p className="text-xs text-[var(--danger)] mt-1">1 件退款待审</p>
        </div>
      </div>

      {/* Alerts */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl p-4">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <AlertTriangle size={14} className="text-[var(--warn)]" />
          预警通知
        </h3>
        <div className="space-y-2">
          {MOCK_ALERTS.map((alert, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg text-xs ${
              alert.type === 'error' ? 'bg-[var(--danger-bg)] text-[var(--danger)]' :
              alert.type === 'warning' ? 'bg-[var(--bg-accent)] text-[var(--accent)]' :
              'bg-[var(--info-bg)] text-[var(--info)]'
            }`}>
              <span className="flex-1">{alert.msg}</span>
              <span className="text-xs opacity-60">{alert.time}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Orders table */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-light)] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[var(--border-light)]">
          <h3 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
            <Truck size={14} className="text-[var(--text-secondary)]" />
            最近订单
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--bg-base)]">
                <th className="text-left px-4 py-2 font-medium text-[var(--text-secondary)]">订单号</th>
                <th className="text-left px-4 py-2 font-medium text-[var(--text-secondary)]">客户</th>
                <th className="text-left px-4 py-2 font-medium text-[var(--text-secondary)]">商品</th>
                <th className="text-right px-4 py-2 font-medium text-[var(--text-secondary)]">金额</th>
                <th className="text-left px-4 py-2 font-medium text-[var(--text-secondary)]">状态</th>
                <th className="text-left px-4 py-2 font-medium text-[var(--text-secondary)]">物流</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-light)]">
              {MOCK_ORDERS.map((order) => (
                <tr key={order.id} className="hover:bg-[var(--bg-accent)]">
                  <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">{order.id}</td>
                  <td className="px-4 py-2.5 text-[var(--text-primary)]">{order.customer}</td>
                  <td className="px-4 py-2.5 text-[var(--text-primary)]">{order.product}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-[var(--text-primary)]">¥{order.amount}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      order.status === '已发货' ? 'bg-[var(--info-bg)] text-[var(--info)]' :
                      order.status === '待发货' ? 'bg-[var(--bg-accent)] text-[var(--accent)]' :
                      order.status === '已签收' ? 'bg-[var(--success-bg)] text-[var(--success)]' :
                      'bg-[var(--danger-bg)] text-[var(--danger)]'
                    }`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)] font-mono">{order.logistics}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
