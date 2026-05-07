import React from 'react';
import { Trophy, Calendar, Users, TrendingUp, Clock, MapPin } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_MATCHES = [
  { teamA: 'T1', teamB: 'GEN', score: '2:1', event: 'LCK 春季赛', time: '已结束', status: 'finished', highlight: true },
  { teamA: 'BLG', teamB: 'WBG', score: '0:0', event: 'LPL 春季赛', time: '19:00', status: 'upcoming', highlight: false },
  { teamA: 'JDG', teamB: 'TES', score: '1:0', event: 'LPL 春季赛', time: '进行中', status: 'live', highlight: true },
  { teamA: 'DRX', teamB: 'KT', score: '2:0', event: 'LCK 春季赛', time: '已结束', status: 'finished', highlight: false },
  { teamA: 'EDG', teamB: 'RNG', score: '0:0', event: 'LPL 春季赛', time: '明日 14:00', status: 'upcoming', highlight: false },
];

const MOCK_STANDINGS = [
  { rank: 1, team: 'T1', win: 12, lose: 2, rate: '85.7%' },
  { rank: 2, team: 'GEN', win: 11, lose: 3, rate: '78.6%' },
  { rank: 3, team: 'JDG', win: 10, lose: 4, rate: '71.4%' },
  { rank: 4, team: 'BLG', win: 9, lose: 5, rate: '64.3%' },
  { rank: 5, team: 'TES', win: 8, lose: 6, rate: '57.1%' },
];

export const EsportsPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="赛事数据"
        subtitle="实时赛况、战队排名、数据分析"
        icon={<Trophy size={22} />}
      />

      {/* Live match highlight */}
      {MOCK_MATCHES.filter((m) => m.status === 'live').map((match) => (
        <div key={match.teamA + match.teamB} className="bg-gradient-to-r from-[#fef2f2] to-[#fef7ed] border border-[#dc3545]/20 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 bg-[#dc3545] rounded-full animate-pulse" />
            <span className="text-xs font-bold text-[#dc3545]">正在进行</span>
            <span className="text-xs text-[#9ca3af] ml-auto">{match.event}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="w-12 h-12 bg-[#e5e2dd] rounded-full mx-auto mb-2 flex items-center justify-center text-lg font-bold text-[#1a1a1a]">
                {match.teamA[0]}
              </div>
              <p className="text-sm font-semibold text-[#1a1a1a]">{match.teamA}</p>
            </div>
            <div className="text-center px-6">
              <p className="text-3xl font-bold text-[#1a1a1a] font-mono">{match.score}</p>
              <p className="text-xs text-[#9ca3af] mt-1">BO3</p>
            </div>
            <div className="text-center flex-1">
              <div className="w-12 h-12 bg-[#e5e2dd] rounded-full mx-auto mb-2 flex items-center justify-center text-lg font-bold text-[#1a1a1a]">
                {match.teamB[0]}
              </div>
              <p className="text-sm font-semibold text-[#1a1a1a]">{match.teamB}</p>
            </div>
          </div>
        </div>
      ))}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent matches */}
        <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#e5e2dd] flex items-center gap-2">
            <Calendar size={14} className="text-[#6b7280]" />
            <h3 className="text-sm font-medium text-[#1a1a1a]">近期赛程</h3>
          </div>
          <div className="divide-y divide-[#e5e2dd]">
            {MOCK_MATCHES.map((match) => (
              <div key={match.teamA + match.teamB + match.time} className="flex items-center gap-3 px-4 py-3 hover:bg-[#fef7ed] transition-colors">
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-xs font-medium text-[#1a1a1a] w-10 text-right">{match.teamA}</span>
                  <span className="text-xs text-[#9ca3af]">vs</span>
                  <span className="text-xs font-medium text-[#1a1a1a] w-10">{match.teamB}</span>
                </div>
                <span className={`text-xs font-mono font-bold ${
                  match.status === 'live' ? 'text-[#dc3545]' :
                  match.status === 'finished' ? 'text-[#1a1a1a]' : 'text-[#9ca3af]'
                }`}>
                  {match.score}
                </span>
                <span className="text-[10px] text-[#9ca3af] w-16 text-right">{match.time}</span>
                {match.status === 'live' && (
                  <span className="w-1.5 h-1.5 bg-[#dc3545] rounded-full animate-pulse" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Standings */}
        <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#e5e2dd] flex items-center gap-2">
            <Users size={14} className="text-[#6b7280]" />
            <h3 className="text-sm font-medium text-[#1a1a1a]">战队排名</h3>
          </div>
          <div className="divide-y divide-[#e5e2dd]">
            {MOCK_STANDINGS.map((s) => (
              <div key={s.team} className="flex items-center gap-3 px-4 py-3 hover:bg-[#fef7ed] transition-colors">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  s.rank <= 3 ? 'bg-[#f59e0b] text-white' : 'bg-[#e5e2dd] text-[#6b7280]'
                }`}>
                  {s.rank}
                </span>
                <span className="flex-1 text-sm font-medium text-[#1a1a1a]">{s.team}</span>
                <span className="text-xs text-[#16a34a]">{s.win}W</span>
                <span className="text-xs text-[#dc3545]">{s.lose}L</span>
                <span className="text-xs font-mono text-[#6b7280] w-12 text-right">{s.rate}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stats overview */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4 text-center">
          <Trophy size={20} className="text-[#f59e0b] mx-auto mb-2" />
          <p className="text-xl font-bold text-[#1a1a1a]">156</p>
          <p className="text-[10px] text-[#9ca3af]">本赛季总场次</p>
        </div>
        <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4 text-center">
          <TrendingUp size={20} className="text-[#16a34a] mx-auto mb-2" />
          <p className="text-xl font-bold text-[#1a1a1a]">62%</p>
          <p className="text-[10px] text-[#9ca3af]">平均胜率</p>
        </div>
        <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4 text-center">
          <Clock size={20} className="text-[#2563eb] mx-auto mb-2" />
          <p className="text-xl font-bold text-[#1a1a1a]">32分钟</p>
          <p className="text-[10px] text-[#9ca3af]">平均时长</p>
        </div>
      </div>
    </div>
  );
};
