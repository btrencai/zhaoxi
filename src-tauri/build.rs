fn main() {
    // 编译期捕获 rustc 版本，供「技术栈」页展示真实工具链信息
    let rustc_version = std::process::Command::new("rustc")
        .arg("--version")
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "rustc unknown".to_string());
    println!("cargo:rustc-env=RUSTC_VERSION={rustc_version}");

    tauri_build::build()
}
