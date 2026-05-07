import React from 'react';
import { ShoppingCart, TrendingUp, TrendingDown, Package, AlertTriangle, Truck, DollarSign, ArrowUpRight, ArrowDownRight } from 'lucide-react';
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
      <PageTitle
        title="电商中心"
        subtitle="订单、库存、物流、售后一站式管理"
        icon={<ShoppingCart size={22} />}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[#16a34a] mb-2">
            <DollarSign size={16} />
            <span className="text-xs font-medium">今日收入</span>
          </div>
          <p className="text-2xl font-bold text-[#1a1a1a]">¥12,580</p>
          <p className="text-[10px] text-[#16a34a] mt-1 flex items-center gap-1">
            <ArrowUpRight size={10} /> +15% vs 昨日
          </p>
        </div>
        <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[#dc3545] mb-2">
            <TrendingDown size={16} />
            <span className="text-xs font-medium">今日支出</span>
          </div>
          <p className="text-2xl font-bold text-[#1a1a1a]">¥3,200</p>
          <p className="text-[10px] text-[#dc3545] mt-1 flex items-center gap-1">
            <ArrowDownRight size={10} /> -5% vs 昨日
          </p>
        </div>
        <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[#2563eb] mb-2">
            <Package size={16} />
            <span className="text-xs font-medium">待发货</span>
          </div>
          <p className="text-2xl font-bold text-[#1a1a1a]">8 单</p>
          <p className="text-[10px] text-[#9ca3af] mt-1">需尽快处理</p>
        </div>
        <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4">
          <div className="flex items-center gap-2 text-[#f59e0b] mb-2">
            <AlertTriangle size={16} />
            <span className="text-xs font-medium">售后处理</span>
          </div>
          <p className="text-2xl font-bold text-[#1a1a1a]">3 件</p>
          <p className="text-[10px] text-[#dc3545] mt-1">1 件退款待审</p>
        </div>
      </div>

      {/* Alerts */}
      <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4">
        <h3 className="text-sm font-medium text-[#1a1a1a] mb-3 flex items-center gap-2">
          <AlertTriangle size={14} className="text-[#f59e0b]" />
          预警通知
        </h3>
        <div className="space-y-2">
          {MOCK_ALERTS.map((alert, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg text-xs ${
              alert.type === 'error' ? 'bg-[#fef2f2] text-[#dc3545]' :
              alert.type === 'warning' ? 'bg-[#fef7ed] text-[#c87d2f]' :
              'bg-[#eff6ff] text-[#2563eb]'
            }`}>
              <span className="flex-1">{alert.msg}</span>
              <span className="text-[10px] opacity-60">{alert.time}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Orders table */}
      <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#e5e2dd]">
          <h3 className="text-sm font-medium text-[#1a1a1a] flex items-center gap-2">
            <Truck size={14} className="text-[#6b7280]" />
            最近订单
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#f3f2ef]">
                <th className="text-left px-4 py-2 font-medium text-[#6b7280]">订单号</th>
                <th className="text-left px-4 py-2 font-medium text-[#6b7280]">客户</th>
                <th className="text-left px-4 py-2 font-medium text-[#6b7280]">商品</th>
                <th className="text-right px-4 py-2 font-medium text-[#6b7280]">金额</th>
                <th className="text-left px-4 py-2 font-medium text-[#6b7280]">状态</th>
                <th className="text-left px-4 py-2 font-medium text-[#6b7280]">物流</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5e2dd]">
              {MOCK_ORDERS.map((order) => (
                <tr key={order.id} className="hover:bg-[#fef7ed]">
                  <td className="px-4 py-2.5 font-mono text-[#6b7280]">{order.id}</td>
                  <td className="px-4 py-2.5 text-[#1a1a1a]">{order.customer}</td>
                  <td className="px-4 py-2.5 text-[#1a1a1a]">{order.product}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-[#1a1a1a]">¥{order.amount}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                      order.status === '已发货' ? 'bg-[#eff6ff] text-[#2563eb]' :
                      order.status === '待发货' ? 'bg-[#fef7ed] text-[#c87d2f]' :
                      order.status === '已签收' ? 'bg-[#f0fdf4] text-[#16a34a]' :
                      'bg-[#fef2f2] text-[#dc3545]'
                    }`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[#9ca3af] font-mono">{order.logistics}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
