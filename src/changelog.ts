/** 版本日志：与仓库根目录 CHANGELOG.md 保持同步（发版时一并更新）。 */

export interface ChangelogEntry {
  version: string;
  date: string;
  highlights: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.1.0",
    date: "2026-09-12",
    highlights: [
      "新增「版本与更新」：一键检查最新发布，发现新版本可直接下载",
      "版本检测与下载走官方服务器通道（国内直连），GitHub Releases 作为海外备用源",
      "新增「更新日志」：应用内随时查阅历次版本的主要变化",
      "新增「打开外链」能力：调用系统默认浏览器（仅放行 http/https，安全校验）",
      "版本号体系统一：应用内、安装包与仓库标签保持一致的语义化版本",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-09-11",
    highlights: [
      "首个正式版本：待办事项、便签、专注（番茄钟）、剪贴板历史与统计",
      "本地优先：数据只存本机 %APPDATA%，原子写入 + 损坏自愈",
      "邮箱账号体系（注册需邮箱验证码）与可选云同步",
      "系统托盘、全局快捷键 Ctrl+Alt+Space、开机自启、深浅色跟随系统",
      "Tauri 2 + Rust + 系统 WebView2 · 无捆绑内核 · 主程序约 5 MB",
    ],
  },
];
