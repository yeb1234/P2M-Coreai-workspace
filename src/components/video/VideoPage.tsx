import React from 'react';
import { PlayCircle, Film, Search, Download, Subtitles, Database, Clock, Star } from 'lucide-react';
import { PageTitle } from '../shared';

const FEATURE_CARDS = [
  { icon: <PlayCircle size={20} />, title: '在线播放', desc: '类似B站的流畅播放体验，支持倍速、画质切换', color: 'text-[#ec4899]' },
  { icon: <Download size={20} />, title: '视频下载', desc: '一键缓存到本地，离线也能看', color: 'text-[#8b5cf6]' },
  { icon: <Subtitles size={20} />, title: 'AI 字幕转录', desc: '自动识别语音生成字幕，支持中英双语', color: 'text-[#06b6d4]' },
  { icon: <Database size={20} />, title: '智能索引', desc: 'AI 总结视频内容，构建可搜索的知识库', color: 'text-[#f59e0b]' },
];

const MOCK_VIDEOS = [
  { title: 'React 19 新特性全面解析', channel: '前端深夜课堂', duration: '32:15', views: '12.4万', tag: 'React' },
  { title: 'TypeScript 5.5 类型体操进阶', channel: 'TS大师', duration: '45:30', views: '8.2万', tag: 'TypeScript' },
  { title: 'Zustand vs Jotai 状态管理对决', channel: '状态管理研究所', duration: '28:40', views: '5.6万', tag: '状态管理' },
  { title: 'Vite 6 从入门到生产部署', channel: '构建工具达人', duration: '55:10', views: '3.8万', tag: 'Vite' },
  { title: 'Tailwind CSS v4 设计系统实战', channel: 'CSS魔法屋', duration: '41:20', views: '6.1万', tag: 'CSS' },
  { title: '2026 前端面试高频题精讲', channel: '面试急救站', duration: '1:12:00', views: '21.3万', tag: '面试' },
];

export const VideoPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="视频站"
        subtitle="整合学习资源，AI 驱动的知识引擎"
        icon={<PlayCircle size={22} />}
      />

      {/* Search bar */}
      <div className="relative max-w-2xl">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
        <input
          type="text"
          placeholder="搜索视频、频道、关键词..."
          className="w-full pl-10 pr-4 py-2.5 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl text-sm focus:border-[#ec4899] focus:ring-2 focus:ring-[#ec4899]/10 outline-none"
        />
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {FEATURE_CARDS.map((card) => (
          <div key={card.title} className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4 hover:shadow-md transition-shadow">
            <div className={`${card.color} mb-2`}>{card.icon}</div>
            <h3 className="text-sm font-semibold text-[#1a1a1a] mb-1">{card.title}</h3>
            <p className="text-xs text-[#6b7280] leading-relaxed">{card.desc}</p>
          </div>
        ))}
      </div>

      {/* Video grid */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Film size={16} className="text-[#6b7280]" />
          <h3 className="text-sm font-medium text-[#1a1a1a]">推荐学习</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MOCK_VIDEOS.map((video) => (
            <div key={video.title} className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl overflow-hidden hover:shadow-md transition-shadow group cursor-pointer">
              {/* Thumbnail placeholder */}
              <div className="aspect-video bg-gradient-to-br from-[#f3f2ef] to-[#e5e2dd] flex items-center justify-center relative">
                <PlayCircle size={40} className="text-[#d1cdc6] group-hover:text-[#ec4899] transition-colors" />
                <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                  {video.duration}
                </span>
              </div>
              <div className="p-3">
                <div className="flex items-start gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#ec4899] to-[#8b5cf6] flex-shrink-0 flex items-center justify-center">
                    <span className="text-white text-[10px] font-bold">{video.channel[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-[#1a1a1a] line-clamp-2 group-hover:text-[#ec4899] transition-colors">
                      {video.title}
                    </h4>
                    <p className="text-xs text-[#9ca3af] mt-1">{video.channel}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-[#b8b4ac]">{video.views}播放</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-[#fef7ed] text-[#c87d2f] rounded">{video.tag}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-6 p-4 bg-[#faf9f7] border border-[#e5e2dd] rounded-xl">
        <div className="flex items-center gap-2 text-xs text-[#6b7280]">
          <Clock size={14} />
          <span>本周学习 <strong className="text-[#1a1a1a]">4.2小时</strong></span>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#6b7280]">
          <Film size={14} />
          <span>已收录 <strong className="text-[#1a1a1a]">128</strong> 个视频</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#6b7280]">
          <Star size={14} />
          <span>收藏 <strong className="text-[#1a1a1a]">23</strong> 个</span>
        </div>
      </div>
    </div>
  );
};
