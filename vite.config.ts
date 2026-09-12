import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error type error without @types/node package
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

/** 读取 node_modules 中某个包的版本号，供「技术栈」页展示真实版本 */
function pkgVersion(pkg: string): string {
  try {
    const p = join(process.cwd(), "node_modules", pkg, "package.json");
    return JSON.parse(readFileSync(p, "utf8")).version as string;
  } catch {
    return "0.0.0";
  }
}

// https://vite.dev/config/
export default defineConfig(() => ({
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  define: {
    __TS_VERSION__: JSON.stringify(pkgVersion("typescript")),
    __VITE_VERSION__: JSON.stringify(pkgVersion("vite")),
    // 内置官方云服务器地址（构建时可用环境变量 CLOUD_SERVER 写死）
    __CLOUD_SERVER__: JSON.stringify((process.env.CLOUD_SERVER || "").trim()),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
