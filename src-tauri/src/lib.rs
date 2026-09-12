use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

const MAX_TEXT_LEN: usize = 120;

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Todo {
    id: String,
    text: String,
    done: bool,
    created_at: i64,
    updated_at: i64,
    /// 0 无 / 1 低 / 2 中 / 3 高
    #[serde(default)]
    priority: u8,
    /// 截止日期（本地零点的毫秒时间戳）
    #[serde(default)]
    due: Option<i64>,
    /// 完成时间（勾选完成时记录，取消完成清空）
    #[serde(default)]
    completed_at: Option<i64>,
    /// 重复规则：null / daily / weekly / monthly / weekday
    #[serde(default)]
    repeat: Option<String>,
    /// 标签（从文本 #标签 解析，去重限量）
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppMeta {
    tauri: String,
    rustc: String,
    version: String,
    exe_size: u64,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn make_id() -> String {
    let seq = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{:x}-{:x}", now_ms(), seq)
}

// ── 数据层 ─────────────────────────────────────────────

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("无法获取应用数据目录：{err}"))
}

fn data_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("todos.json"))
}

/// 旧版（Electron）应用的数据文件，用于首次运行时的一次性导入
fn legacy_data_file() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(|base| Path::new(&base).join("simple-desktop-app").join("todos.json"))
}

/// 将任意输入规范化为合法待办项；非法项返回 None
fn normalize(raw: &Todo) -> Option<Todo> {
    let text = raw.text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }
    let now = now_ms();
    let id = raw.id.trim();
    let updated_at = if raw.updated_at > 0 { raw.updated_at } else { now };
    let repeat = raw
        .repeat
        .as_deref()
        .filter(|r| matches!(*r, "daily" | "weekly" | "monthly" | "weekday"))
        .map(|r| r.to_string());
    let mut tags: Vec<String> = Vec::new();
    for tag in &raw.tags {
        let clean = tag.trim().trim_start_matches('#').trim();
        if clean.is_empty() || clean.chars().count() > 16 {
            continue;
        }
        if tags.iter().any(|existing| existing == clean) {
            continue;
        }
        if tags.len() >= 6 {
            break;
        }
        tags.push(clean.to_string());
    }
    Some(Todo {
        id: if id.is_empty() { make_id() } else { id.to_string() },
        text: text.chars().take(MAX_TEXT_LEN).collect(),
        done: raw.done,
        created_at: if raw.created_at > 0 { raw.created_at } else { now },
        updated_at,
        priority: raw.priority.min(3),
        due: raw.due.filter(|d| *d > 0),
        // 旧数据补全：已完成但缺少完成时间的，以最后更新时间兜底
        completed_at: if raw.done { raw.completed_at.or(Some(updated_at)) } else { None },
        repeat,
        tags,
    })
}

/// 宽松解析：元素逐个容错，非数组 / 非法 JSON 返回 None
fn parse_todos(raw: &str) -> Option<Vec<Todo>> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let array = value.as_array()?;
    Some(
        array
            .iter()
            .filter_map(|item| serde_json::from_value::<Todo>(item.clone()).ok())
            .filter_map(|todo| normalize(&todo))
            .collect(),
    )
}

/// 解析失败时先备份损坏文件，避免下一次保存静默覆盖导致数据永久丢失
fn backup_corrupt_file(file: &Path) {
    if !file.exists() {
        return;
    }
    let backup = PathBuf::from(format!("{}.corrupt-{}.bak", file.display(), now_ms()));
    if let Err(err) = fs::copy(file, &backup) {
        eprintln!("备份损坏数据文件失败：{err}");
    } else {
        eprintln!("已备份损坏的数据文件到：{}", backup.display());
    }
}

/// 原子写入任意可序列化的 JSON 数据
fn write_json_atomic<T: Serialize>(file: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建数据目录失败：{err}"))?;
    }
    let payload = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;

    let mut tmp = file.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);

    fs::write(&tmp, payload.as_bytes()).map_err(|err| format!("写入临时文件失败：{err}"))?;
    if let Err(err) = fs::rename(&tmp, file) {
        // 个别环境（杀毒软件短暂锁定等）rename 可能失败，退回直接写入
        eprintln!("原子替换失败，退回直接写入：{err}");
        fs::write(file, payload.as_bytes()).map_err(|err| format!("写入数据文件失败：{err}"))?;
        let _ = fs::remove_file(&tmp);
    }
    Ok(())
}

// ── 命令 ───────────────────────────────────────────────

#[tauri::command]
fn load_todos(app: AppHandle) -> Result<Vec<Todo>, String> {
    let file = data_file(&app)?;
    if !file.exists() {
        // 首次运行：尝试从旧版（Electron）数据目录一次性导入
        if let Some(legacy) = legacy_data_file() {
            if let Ok(raw) = fs::read_to_string(&legacy) {
                if let Some(todos) = parse_todos(&raw) {
                    let _ = write_json_atomic(&file, &todos);
                    return Ok(todos);
                }
            }
        }
        return Ok(Vec::new());
    }
    match fs::read_to_string(&file) {
        Ok(raw) => match parse_todos(&raw) {
            Some(todos) => Ok(todos),
            None => {
                backup_corrupt_file(&file);
                Ok(Vec::new())
            }
        },
        Err(err) => Err(format!("读取数据文件失败：{err}")),
    }
}

#[tauri::command]
fn save_todos(app: AppHandle, todos: Vec<Todo>) -> Result<bool, String> {
    let file = data_file(&app)?;
    let cleaned: Vec<Todo> = todos.iter().filter_map(normalize).collect();
    write_json_atomic(&file, &cleaned)?;
    Ok(true)
}

// ── 便签 ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Note {
    id: String,
    text: String,
    created_at: i64,
    updated_at: i64,
}

fn notes_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("notes.json"))
}

fn normalize_note(raw: &Note) -> Note {
    let now = now_ms();
    Note {
        id: if raw.id.trim().is_empty() { make_id() } else { raw.id.trim().to_string() },
        text: raw.text.chars().take(20_000).collect(),
        created_at: if raw.created_at > 0 { raw.created_at } else { now },
        updated_at: if raw.updated_at > 0 { raw.updated_at } else { now },
    }
}

#[tauri::command]
fn load_notes(app: AppHandle) -> Result<Vec<Note>, String> {
    let file = notes_file(&app)?;
    if !file.exists() {
        return Ok(Vec::new());
    }
    match fs::read_to_string(&file) {
        Ok(raw) => {
            let parsed = serde_json::from_str::<serde_json::Value>(&raw)
                .ok()
                .and_then(|value| value.as_array().cloned());
            match parsed {
                Some(array) => Ok(array
                    .iter()
                    .filter_map(|item| serde_json::from_value::<Note>(item.clone()).ok())
                    .map(|note| normalize_note(&note))
                    .collect()),
                None => {
                    backup_corrupt_file(&file);
                    Ok(Vec::new())
                }
            }
        }
        Err(err) => Err(format!("读取便签失败：{err}")),
    }
}

#[tauri::command]
fn save_notes(app: AppHandle, notes: Vec<Note>) -> Result<bool, String> {
    let file = notes_file(&app)?;
    let cleaned: Vec<Note> = notes.iter().map(normalize_note).collect();
    write_json_atomic(&file, &cleaned)?;
    Ok(true)
}

// ── 云端账户与同步元数据 ───────────────────────────────

fn json_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(name))
}

fn load_json_value(file: &Path) -> serde_json::Value {
    fs::read_to_string(file)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(serde_json::Value::Null)
}

#[tauri::command]
fn load_meta(app: AppHandle) -> serde_json::Value {
    match json_file(&app, "meta.json") {
        Ok(file) => load_json_value(&file),
        Err(_) => serde_json::Value::Null,
    }
}

#[tauri::command]
fn save_meta(app: AppHandle, meta: serde_json::Value) -> Result<bool, String> {
    let file = json_file(&app, "meta.json")?;
    write_json_atomic(&file, &meta)?;
    Ok(true)
}

#[tauri::command]
fn load_cloud_account(app: AppHandle) -> serde_json::Value {
    match json_file(&app, "account.json") {
        Ok(file) => load_json_value(&file),
        Err(_) => serde_json::Value::Null,
    }
}

#[tauri::command]
fn save_cloud_account(app: AppHandle, account: serde_json::Value) -> Result<bool, String> {
    let file = json_file(&app, "account.json")?;
    write_json_atomic(&file, &account)?;
    Ok(true)
}

#[tauri::command]
fn clear_cloud_account(app: AppHandle) -> Result<bool, String> {
    let file = json_file(&app, "account.json")?;
    if file.exists() {
        let _ = fs::remove_file(&file);
    }
    Ok(true)
}

#[tauri::command]
fn load_owner(app: AppHandle) -> serde_json::Value {
    match json_file(&app, "owner.json") {
        Ok(file) => load_json_value(&file),
        Err(_) => serde_json::Value::Null,
    }
}

#[tauri::command]
fn save_owner(app: AppHandle, owner: serde_json::Value) -> Result<bool, String> {
    let file = json_file(&app, "owner.json")?;
    write_json_atomic(&file, &owner)?;
    Ok(true)
}

/// 切换账号时调用：把本地数据文件（todos/notes/focus/meta）移入 backups/ 归档，返回备份目录路径。
#[tauri::command]
fn archive_and_clear_data(app: AppHandle, reason: String) -> Result<String, String> {
    let dir = data_dir(&app)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let safe: String = reason
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '@' | '.'))
        .take(48)
        .collect();
    let label = if safe.is_empty() { "switch".to_string() } else { safe };
    let backup = dir.join("backups").join(format!("{label}-{stamp}"));
    fs::create_dir_all(&backup).map_err(|e| e.to_string())?;
    for name in ["todos.json", "notes.json", "focus.json", "meta.json"] {
        let file = dir.join(name);
        if file.exists() {
            fs::rename(&file, backup.join(name))
                .or_else(|_| {
                    fs::copy(&file, backup.join(name))
                        .map(|_| ())
                        .and_then(|_| fs::remove_file(&file))
                })
                .map_err(|e| format!("{name}: {e}"))?;
        }
    }
    Ok(backup.to_string_lossy().to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    // 登录门专用：无条件退出应用（不经「关闭到托盘」逻辑）
    app.exit(0);
}

// ── 专注统计（每日番茄数） ─────────────────────────────

fn focus_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("focus.json"))
}

fn read_focus_stats(file: &Path) -> std::collections::BTreeMap<String, u32> {
    fs::read_to_string(file)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn load_focus_stats(app: AppHandle) -> std::collections::BTreeMap<String, u32> {
    match focus_file(&app) {
        Ok(file) => read_focus_stats(&file),
        Err(_) => std::collections::BTreeMap::new(),
    }
}

#[tauri::command]
fn add_focus_session(app: AppHandle, day: String) -> Result<u32, String> {
    let day = day.trim().to_string();
    if day.is_empty() || day.chars().count() > 12 {
        return Err("日期格式无效".to_string());
    }
    let file = focus_file(&app)?;
    let mut stats = read_focus_stats(&file);
    let entry = stats.entry(day).or_insert(0);
    *entry = entry.saturating_add(1);
    let value = *entry;
    write_json_atomic(&file, &stats)?;
    Ok(value)
}

#[tauri::command]
fn app_meta(app: AppHandle) -> AppMeta {
    let exe_size = std::env::current_exe()
        .and_then(|path| fs::metadata(path))
        .map(|meta| meta.len())
        .unwrap_or(0);
    AppMeta {
        tauri: tauri::VERSION.to_string(),
        rustc: env!("RUSTC_VERSION").to_string(),
        version: app.package_info().version.to_string(),
        exe_size,
    }
}

#[tauri::command]
fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let _ = fs::create_dir_all(&dir);
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|err| format!("打开数据目录失败：{err}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = &dir;
    }
    Ok(())
}

/// 导出当前数据到数据目录的 exports/ 文件夹，返回导出文件路径
#[tauri::command]
fn export_todos(app: AppHandle) -> Result<String, String> {
    let dir = data_dir(&app)?;
    let source = dir.join("todos.json");
    if !source.exists() {
        return Err("暂无可导出的数据".into());
    }
    let export_dir = dir.join("exports");
    fs::create_dir_all(&export_dir).map_err(|err| format!("创建导出目录失败：{err}"))?;
    let target = export_dir.join(format!("todos-{}.json", now_ms()));
    fs::copy(&source, &target).map_err(|err| format!("导出失败：{err}"))?;
    Ok(target.display().to_string())
}

// ── 应用设置 ───────────────────────────────────────────

fn default_true() -> bool {
    true
}

fn default_close_action() -> String {
    "tray".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    /// 显示系统托盘图标
    #[serde(default = "default_true")]
    tray_enabled: bool,
    /// 关闭主窗口行为："tray" 最小化到托盘 / "quit" 退出应用
    #[serde(default = "default_close_action")]
    close_action: String,
    /// 启动时隐藏到托盘
    #[serde(default)]
    start_minimized: bool,
    /// 全局快捷键快速呼出
    #[serde(default)]
    quick_hotkey: bool,
    /// 窗口置顶
    #[serde(default)]
    always_on_top: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            tray_enabled: true,
            close_action: default_close_action(),
            start_minimized: false,
            quick_hotkey: false,
            always_on_top: false,
        }
    }
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("settings.json"))
}

fn read_settings(app: &AppHandle) -> AppSettings {
    settings_file(app)
        .ok()
        .and_then(|file| fs::read_to_string(file).ok())
        .and_then(|raw| serde_json::from_str::<AppSettings>(&raw).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn load_settings(app: AppHandle) -> AppSettings {
    read_settings(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: AppSettings) -> Result<bool, String> {
    let file = settings_file(&app)?;
    write_json_atomic(&file, &settings)?;
    Ok(true)
}

/// 显示并聚焦主窗口（托盘点击 / 全局快捷键 / 单实例唤醒共用）
fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
fn set_tray_visible(app: AppHandle, visible: bool) -> Result<bool, String> {
    match app.tray_by_id("main") {
        Some(tray) => {
            tray.set_visible(visible)
                .map_err(|err| format!("切换托盘失败：{err}"))?;
            Ok(true)
        }
        None => Err("托盘未创建".to_string()),
    }
}

/// 用系统默认浏览器打开 http/https 链接（仅允许这两种协议，防注入）
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("仅允许打开 http/https 链接".to_string());
    }
    if trimmed.contains('"') || trimmed.contains('\'') || trimmed.contains('&') || trimmed.contains('|') || trimmed.contains(' ') {
        return Err("链接包含非法字符".to_string());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW：避免控制台闪窗
            .spawn()
            .map_err(|e| format!("打开链接失败：{e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("打开链接失败：{e}"))?;
        Ok(())
    }
}

/// 创建系统托盘：左键单击唤出主窗口；菜单含 打开 / 快速新建 / 退出
fn setup_tray(app: &tauri::App) -> Result<(), String> {
    let show_item = MenuItem::with_id(app, "show", "打开主界面", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let quick_item = MenuItem::with_id(app, "quick", "快速新建待办", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let quit_item =
        MenuItem::with_id(app, "quit", "退出", true, None::<&str>).map_err(|err| err.to_string())?;
    let menu = Menu::with_items(app, &[&show_item, &quick_item, &quit_item])
        .map_err(|err| err.to_string())?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "缺少窗口图标".to_string())?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("朝夕")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quick" => {
                show_main(app);
                let _ = app.emit("focus-input", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 第二个实例被拦截时，唤出并聚焦已有窗口
            show_main(app);
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            setup_tray(app).map_err(|err| format!("创建系统托盘失败：{err}"))?;

            // 按设置应用托盘可见性与启动行为
            let settings = read_settings(&handle);
            if let Some(tray) = handle.tray_by_id("main") {
                let _ = tray.set_visible(settings.tray_enabled);
            }
            if settings.tray_enabled && settings.start_minimized {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let settings = read_settings(app);
                // 托盘常驻模式：拦截关闭，隐藏到托盘继续后台驻留
                if settings.tray_enabled && settings.close_action == "tray" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_todos,
            save_todos,
            app_meta,
            open_data_dir,
            export_todos,
            load_notes,
            save_notes,
            load_settings,
            save_settings,
            set_tray_visible,
            show_main_window,
            load_focus_stats,
            add_focus_session,
            load_meta,
            save_meta,
            load_cloud_account,
            save_cloud_account,
            clear_cloud_account,
            load_owner,
            save_owner,
            archive_and_clear_data,
            quit_app,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
